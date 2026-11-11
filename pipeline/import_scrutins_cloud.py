# import_scrutins_cloud.py
# Script pour importer les scrutins (votes) de l'AN 17e législature dans la base
# et calculer des statistiques de vote par député (acteurs) et par groupe (organes).
#
# Source : https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip
# Exécuter avec : python import_scrutins_cloud.py

import json
import os
import sys
import traceback
from pathlib import Path
import psycopg
from dotenv import load_dotenv
import requests
import io
import zipfile
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import signaler_anomalie
from _positions_groupe import GROUPE_ALIAS, groupe_au_depot, position_de_groupe
from _db import connexion, lire
from _votes_amendements import est_vote_sur_amendement, relier_votes
from _sync_cache import (
    NotModified,
    confirmer_import,
    download_zip_if_modified,
    upsert_si_change,
)

# Plus de client propre à ce script : les lectures passent par `_db` (connexion directe)
# et les écritures par `_sync_cache` (`upsert_si_change`), qui lisent leurs variables.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ===================================================================
# Utilitaires généraux
# ===================================================================

def download_zip(url: str) -> zipfile.ZipFile:
    """Télécharge un ZIP en mémoire depuis l'URL et renvoie l'objet ZipFile."""
    print(f"Téléchargement de {url} ...")
    response = requests.get(url, timeout=180)
    response.raise_for_status()
    print("Téléchargement terminé.")
    return zipfile.ZipFile(io.BytesIO(response.content))


# Total des lignes perdues en écriture sur tout le run. Compteur de module plutôt que
# valeur remontée : `upsert_batch` est appelé depuis six endroits d'une fonction de
# cinq cents lignes, et faire circuler un retour partout coûterait plus que ça ne
# rapporte pour un simple total. Lu une fois, à la fin, par `importer_scrutins_from_zip`.
lignes_perdues_ecriture = 0

# Lignes réellement insérées ou modifiées, et lignes perdues, par table, sur tout le run
# (même raison que ci-dessus). Les lignes envoyées moins ces deux nombres donnent les
# « inchangées » du rapport.
lignes_ecrites: dict[str, int] = {}
lignes_perdues_par_table: dict[str, int] = {}


def upsert_batch(table: str, rows: list, conflict: str, cle: str = "uid") -> int:
    """Envoie `rows` à la base, qui n'écrit que les lignes nouvelles ou changées
    (`upsert_si_change`), et rend le nombre de lignes qui n'ont pas pu être écrites.

    Le découpage en lots d'environ 1 Mo et l'isolement d'une ligne fautive sont ceux de
    `_sync_cache` : un lot rejeté est coupé en deux jusqu'à ne perdre que la ligne en
    cause, et une coupure passagère est rejouée. La perte est ajoutée au total du run
    (`lignes_perdues_ecriture`), le nombre de lignes écrites à `lignes_ecrites`. `cle` est la
    colonne citée dans le journal d'une ligne perdue.
    """
    global lignes_perdues_ecriture
    if not rows:
        return 0
    ecrites, perdues = upsert_si_change(table, rows, conflict, cle=cle, journal=tqdm.write)
    lignes_ecrites[table] = lignes_ecrites.get(table, 0) + ecrites
    lignes_perdues_par_table[table] = lignes_perdues_par_table.get(table, 0) + len(perdues)
    lignes_perdues_ecriture += len(perdues)
    return len(perdues)


def fetch_all_rows(conn, table: str, columns: str, filtre_eq: tuple[str, object] | None = None) -> list:
    """Lit toutes les lignes d'une table (`columns` et `table` viennent du code).

    `filtre_eq` restreint au serveur, sous la forme (colonne, valeur) : utile quand la
    colonne demandée est volumineuse et qu'une fraction des lignes suffit. La table doit
    avoir `uid` pour clé primaire (`acteurs`, `organes`) : le tri sur elle rend un ordre
    stable. Une seule requête, sans plafond de lignes à contourner.
    """
    requete = f"select {columns} from {table}"
    params: tuple = ()
    if filtre_eq:
        requete += f" where {filtre_eq[0]} = %s"
        params = (filtre_eq[1],)
    return lire(conn, requete + " order by uid", params)


def purger_positions_sans_groupe(
    conn, scrutins_recalcules: set[str], positions_valides: set[str]
) -> int:
    """Supprime les positions de groupe AN qui n'ont plus lieu d'être.

    Appelée une fois par run, après l'écriture des positions. `scrutins_recalcules`
    porte les scrutins dont toutes les positions ont été recalculées pendant ce run,
    `positions_valides` les clés « scrutin|groupe » qui en ont une. Une ligne en base
    pour un de ces scrutins, absente des valides, est obsolète : plus aucun membre du
    groupe n'y a voté, ou ses options de tête sont passées à égalité. Les scrutins illisibles ce soir ne sont
    pas dans `scrutins_recalcules`, et leurs lignes restent. Une motion de censure y
    entre sans aucune clé valide : toutes ses lignes sont obsolètes, puisqu'une motion
    n'a plus de position de groupe.

    Sans cette purge, l'upsert ne retirait jamais rien : une position invalidée
    restait affichée.

    Retourne le nombre de lignes qui n'ont pas pu être supprimées, et l'ajoute au
    total du run pour que le script sorte en échec et retélécharge la nuit suivante.
    """
    global lignes_perdues_ecriture
    existantes = [
        f"{r['scrutin_uid']}|{r['groupe_uid']}"
        for r in lire(conn, "select scrutin_uid, groupe_uid from scrutins_groupes_positions where chambre = 'AN'")
    ]

    obsoletes = sorted(
        cle for cle in existantes
        if cle.split("|", 1)[0] in scrutins_recalcules and cle not in positions_valides
    )
    print(f"\nPositions de groupe AN obsolètes à supprimer : {len(obsoletes)}")
    if not obsoletes:
        return 0

    # Une seule suppression pour tous les couples (au lieu d'une requête par scrutin) : les
    # deux listes parallèles sont dépliées côté base, et la requête reste en transaction
    # unique, donc tout part ou rien.
    scrutins = [cle.split("|", 1)[0] for cle in obsoletes]
    groupes = [cle.split("|", 1)[1] for cle in obsoletes]
    try:
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                "DELETE FROM scrutins_groupes_positions t"
                " USING unnest(%s::text[], %s::text[]) AS v(scrutin_uid, groupe_uid)"
                " WHERE t.scrutin_uid = v.scrutin_uid AND t.groupe_uid = v.groupe_uid",
                (scrutins, groupes),
            )
            supprimees = cur.rowcount
        echecs = 0
    except psycopg.Error as e:
        supprimees, echecs = 0, len(obsoletes)
        tqdm.write(f"❌ Suppression de {len(obsoletes)} positions : {type(e).__name__}: {e}")

    print(f"  → {supprimees} positions supprimées, {echecs} en échec.")
    lignes_perdues_ecriture += echecs
    return echecs


def safe_int(value, default=0) -> int:
    """Convertit une valeur en entier. Retourne `default` si impossible."""
    try:
        return int(value) if value is not None else default
    except (ValueError, TypeError):
        return default


# ===================================================================
# Extraction des votes nominatifs
# ===================================================================

def extraire_votes_actifs(bucket) -> list[tuple[str, bool]]:
    """(acteurRef, par_delegation) pour un bucket pours, contres ou abstentions.

    Gère tous les formats de la source : null, dict unique, liste de dicts.
    `parDelegation` vaut la chaîne "true" quand un collègue a déposé le vote à la place du
    député (vu dans le dump de la 17ᵉ : "true" ou "false", jamais absent sur ces buckets).
    Le booléen est aussi accepté, au cas où la source changerait de forme. Lu par
    `parser_scrutin`, pour le seul taux de délégation (voir les stats acteurs).
    """
    if bucket is None:
        return []
    votants = bucket.get("votant")
    if isinstance(votants, dict):
        votants = [votants]
    if not isinstance(votants, list):
        return []
    return [
        (v["acteurRef"], str(v.get("parDelegation") or "").lower() == "true")
        for v in votants
        if isinstance(v, dict) and v.get("acteurRef")
    ]


def extraire_nonvotants_avec_cause(bucket) -> list[tuple[str, str | None]]:
    """
    Extrait (acteurRef, causePositionVote) depuis le bucket nonVotants.

    causePositionVote distingue les raisons institutionnelles des absences volontaires :
    - 'MG' = Membre du Gouvernement (ministre — ne vote pas à l'AN)
    - 'PAN' = Président de l'Assemblée nationale (ne vote pas par impartialité)
    - 'PSE' = Président de séance (préside le débat, ne prend pas part au vote)
    - 'PP'  = Position personnelle (choix volontaire de ne pas voter)
    """
    if bucket is None:
        return []
    votants = bucket.get("votant")
    if votants is None:
        return []
    if isinstance(votants, dict):
        ref = votants.get("acteurRef")
        cause = votants.get("causePositionVote")
        return [(ref, cause)] if ref else []
    if isinstance(votants, list):
        return [
            (v.get("acteurRef"), v.get("causePositionVote"))
            for v in votants
            if isinstance(v, dict) and v.get("acteurRef")
        ]
    return []


def extraire_votants_mise_au_point(bucket) -> list[str]:
    """
    Extrait les acteurRef depuis un bucket de miseAuPoint.

    La structure miseAuPoint diffère du decompteNominatif : les votants sont
    enveloppés dans {"votant": {"acteurRef": ..., "mandatRef": ...}} et
    certaines entrées de la liste sont null.
    """
    if bucket is None:
        return []
    # Cas dict unique (une seule correction)
    if isinstance(bucket, dict):
        votant = bucket.get("votant")
        if isinstance(votant, dict):
            ref = votant.get("acteurRef")
            return [ref] if ref else []
        return []
    # Cas liste (plusieurs corrections, avec des null possibles)
    if isinstance(bucket, list):
        refs = []
        for entry in bucket:
            if not isinstance(entry, dict):
                continue
            votant = entry.get("votant")
            if isinstance(votant, dict):
                ref = votant.get("acteurRef")
                if ref:
                    refs.append(ref)
        return refs
    return []


# ===================================================================
# Parsing d'un scrutin
# ===================================================================

def parser_scrutin(data: dict) -> tuple:
    """
    Parse un dict JSON de scrutin.

    Retourne un tuple de 3 éléments :
    - payload_scrutin (dict)     : données à insérer dans la table `scrutins`
    - votes_par_acteur (dict)    : {acteurRef: {"position": str, "groupe_ref": str, "cause": str|None,
                                                 "par_delegation": bool}}
    - votes_par_organe (dict)    : {organeRef: {"positionMajoritaire": str|None, "pour": int, ...}}

    Le champ "cause" n'est présent que pour les nonVotants (MG, PAN, PSE, PP), et
    "par_delegation" que pour les votes actifs (pour, contre, abstention).
    Les corrections miseAuPoint sont appliquées avant le retour. Elles changent la
    position, pas le drapeau de délégation, car le vote a bien été déposé par un collègue.

    Retourne (None, {}, {}) si le JSON est invalide.
    """
    scrutin = (data.get("scrutin") or {})
    uid = scrutin.get("uid")
    if not uid:
        return None, {}, {}

    synthese = scrutin.get("syntheseVote") or {}
    decompte = synthese.get("decompte") or {}

    payload_scrutin = {
        "uid": uid,
        "chambre": "Assemblée Nationale",
        "numero": safe_int(scrutin.get("numero")),
        "organe_ref": scrutin.get("organeRef"),
        "legislature": safe_int(scrutin.get("legislature")),
        "session_ref": scrutin.get("sessionRef"),
        "seance_ref": scrutin.get("seanceRef"),
        "date_scrutin": scrutin.get("dateScrutin"),
        "quantieme_jour_seance": safe_int(scrutin.get("quantiemeJourSeance")),
        "type_vote_code": (scrutin.get("typeVote") or {}).get("codeTypeVote"),
        "type_vote_libelle": (scrutin.get("typeVote") or {}).get("libelleTypeVote"),
        "type_majorite": (scrutin.get("typeVote") or {}).get("typeMajorite"),
        "sort_code": (scrutin.get("sort") or {}).get("code"),
        "sort_libelle": (scrutin.get("sort") or {}).get("libelle"),
        "titre": scrutin.get("titre", ""),
        "demandeur_texte": (scrutin.get("demandeur") or {}).get("texte"),
        "objet_libelle": (scrutin.get("objet") or {}).get("libelle"),
        "synthese_nombre_votants": safe_int(synthese.get("nombreVotants")),
        "synthese_suffrages_exprimes": safe_int(synthese.get("suffragesExprimes")),
        "synthese_suffrages_requis": safe_int(synthese.get("nbrSuffragesRequis")),
        "synthese_annonce": synthese.get("annonce"),
        "synthese_pour": safe_int(decompte.get("pour")),
        "synthese_contre": safe_int(decompte.get("contre")),
        "synthese_abstentions": safe_int(decompte.get("abstentions")),
        "synthese_non_votants": safe_int(decompte.get("nonVotants")),
        "lieu_vote": scrutin.get("lieuVote"),
    }

    # --- Ventilation par groupe politique ---
    votes_par_acteur = {}  # {acteurRef: {"position": "pour"|"contre"|"abstention"|"nonVotant", "groupe_ref": str}}
    votes_par_organe = {}  # {organeRef: {"positionMajoritaire": str|None, "pour": int, "contre": int, ...}}

    ventilation = scrutin.get("ventilationVotes") or {}
    organe_ventilation = ventilation.get("organe") or {}
    groupes_data = organe_ventilation.get("groupes") or {}
    groupes = groupes_data.get("groupe") or []

    # L'API renvoie parfois un dict unique au lieu d'une liste
    if isinstance(groupes, dict):
        groupes = [groupes]

    for groupe in groupes:
        if not isinstance(groupe, dict):
            continue

        organe_ref = groupe.get("organeRef")
        if not organe_ref or organe_ref == "PO0":
            continue

        nombre_membres = safe_int(groupe.get("nombreMembresGroupe"))
        vote = groupe.get("vote") or {}
        decompte_voix = vote.get("decompteVoix") or {}
        nb_pour = safe_int(decompte_voix.get("pour"))
        nb_contre = safe_int(decompte_voix.get("contre"))
        nb_abstentions = safe_int(decompte_voix.get("abstentions"))

        # La position se déduit du décompte du groupe, avec la règle commune aux deux
        # chambres (aucune sans votant ni à égalité). Le champ `positionMajoritaire` de
        # l'open data AN n'est délibérément pas utilisé : il contredit le décompte du
        # même enregistrement dans environ 3 % des cas, et vaut « pour » quand aucun
        # membre du groupe n'a voté. Voir `position_de_groupe` et D-269.
        # `nombreMembresGroupe` est l'effectif déclaré du groupe au jour du scrutin.
        votes_par_organe[organe_ref] = {
            "positionMajoritaire": position_de_groupe(nb_pour, nb_contre, nb_abstentions),
            "pour": nb_pour,
            "contre": nb_contre,
            "abstentions": nb_abstentions,
            "nonVotants": safe_int(decompte_voix.get("nonVotants")),
            "nombreMembres": nombre_membres,
        }

        # Extraction des votes nominatifs (qui a voté quoi)
        nominatif = vote.get("decompteNominatif") or {}

        # Buckets "actifs" : pour, contre, abstention
        for position, bucket_key in [("pour", "pours"), ("contre", "contres"), ("abstention", "abstentions")]:
            for acteur_ref, par_delegation in extraire_votes_actifs(nominatif.get(bucket_key)):
                votes_par_acteur[acteur_ref] = {
                    "position": position,
                    "groupe_ref": organe_ref,
                    "par_delegation": par_delegation,
                }

        # Bucket nonVotants : on conserve la cause (MG/PAN/PSE/PP) pour le calcul de participation
        for acteur_ref, cause in extraire_nonvotants_avec_cause(nominatif.get("nonVotants")):
            votes_par_acteur[acteur_ref] = {
                "position": "nonVotant",
                "groupe_ref": organe_ref,
                "cause": cause,
            }

    # --- Corrections miseAuPoint ---
    # Certains députés corrigent leur vote après le scrutin (erreur de bouton, etc.)
    # La miseAuPoint remplace la position initiale par la position corrigée.
    # Impact : ~400 corrections individuelles sur ~5 800 scrutins (17e lég.)
    mise_au_point = scrutin.get("miseAuPoint") or {}
    if not (isinstance(mise_au_point, dict) and mise_au_point.get("@xsi:nil")):
        corrections_buckets = [
            ("pour", "pours"),
            ("contre", "contres"),
            ("abstention", "abstentions"),
            ("nonVotant", "nonVotants"),
            ("nonVotant", "nonVotantsVolontaires"),
        ]
        for position, bucket_key in corrections_buckets:
            for acteur_ref in extraire_votants_mise_au_point(mise_au_point.get(bucket_key)):
                if acteur_ref in votes_par_acteur:
                    votes_par_acteur[acteur_ref]["position"] = position

    # Nombre de non-votants institutionnels (MG/PAN/PSE) dans ce scrutin
    # → stocké pour calculer la base d'éligibles réels (577 − institutionnels) côté frontend
    payload_scrutin["non_votants_institutionnels"] = sum(
        1 for v in votes_par_acteur.values()
        if v["position"] == "nonVotant" and v.get("cause") in CAUSES_INSTITUTIONNELLES
    )

    return payload_scrutin, votes_par_acteur, votes_par_organe


# Causes institutionnelles de non-vote (schéma XSD : causePositionVote)
# Ces députés ne votent pas en raison de leur fonction, pas par choix personnel.
# Ils ne doivent pas être pénalisés dans le calcul de participation :
# le scrutin est exclu de leur numérateur ET de leur dénominateur.
CAUSES_INSTITUTIONNELLES = {"MG", "PAN", "PSE"}


def est_president_assemblee(mandats) -> bool:
    """Vrai si l'acteur préside l'Assemblée nationale aujourd'hui.

    Le président porte un mandat `BUREAU` de qualité `Président` encore ouvert ; les
    autres membres du Bureau (vice-présidents, questeurs, secrétaires) y siègent sous
    une autre qualité. Même critère que la colonne `est_president_chambre` de
    `activite_elus_mv`, pour que les deux ne puissent pas diverger.
    """
    if not isinstance(mandats, list):
        return False
    return any(
        m.get("typeOrgane") == "BUREAU"
        and (m.get("infosQualite") or {}).get("codeQualite") == "Président"
        and m.get("dateFin") is None
        for m in mandats
        if isinstance(m, dict)
    )


# ===================================================================
# Boucle principale
# ===================================================================

def importer_scrutins_from_zip(zip_ref: zipfile.ZipFile) -> int:
    """
    Boucle sur tous les JSON de scrutins du ZIP.

    Étapes :
    1. Parcourt chaque scrutin et accumule les stats en mémoire
    2. Insère les données brutes dans la table `scrutins`
    3. Met à jour les colonnes de stats dans `acteurs` et `organes`

    Retourne `(echecs_parsing, echecs_ecriture)`. Les deux se traitent
    différemment : un parsing qui échoue est durable et s'alerte, une écriture
    perdue est passagère et bloque. Voir `_alertes.signaler_anomalie`.
    """

    # --- Pré-chargement depuis la base pour éviter N+1 requêtes ---
    # Autocommit : aucune transaction ouverte entre deux lectures. Fermée dès la dernière
    # lecture du pré-chargement : gardée pendant les minutes du parsing, elle pouvait être
    # coupée (tunnel SSH) et faire tomber la purge des positions, en fin de run,
    # après toutes les écritures. La purge ouvre la sienne ; les écritures passent par la
    # connexion de `_sync_cache`.
    conn = connexion(autocommit=True)
    print("Chargement des données existantes depuis la base...")
    acteurs_rows = fetch_all_rows(conn, "acteurs", "uid,groupe,date_debut_mandat,date_fin_mandat,periodes_mandat_assemblee,periodes_depute_17,est_senateur_actuel,historique_groupes")
    known_acteur_uids = {row["uid"] for row in acteurs_rows}
    # Les colonnes de vote d'un sénateur en exercice appartiennent à `sync_senat.py`. Un
    # député élu sénateur garde son uid : sans cette exclusion, son taux de député
    # s'écrivait ici chaque nuit et restait en place tant qu'il n'avait pas voté au Sénat.
    senateurs_actuels = {row["uid"] for row in acteurs_rows if row.get("est_senateur_actuel")}
    # Groupe actuel : l'étiquette de l'élu aujourd'hui, qui ne sert qu'à taire la loyauté
    # d'un député devenu non-inscrit. Aucun vote ne s'y rattache (D-278) : un vote compte
    # dans le `groupe_ref` que la source lui donne le jour du scrutin.
    acteur_to_groupe = {row["uid"]: row["groupe"] for row in acteurs_rows if row.get("groupe")}
    # Fenêtre de mandat par acteur : (date_debut, date_fin) — date_fin = None si encore en exercice
    acteur_mandate_range = {
        row["uid"]: (row.get("date_debut_mandat"), row.get("date_fin_mandat"))
        for row in acteurs_rows
        if row.get("date_debut_mandat")
    }
    # Périodes multi-mandat (ex-ministres revenus) — liste [{debut, fin}] ou None
    acteur_periods_list = {
        row["uid"]: row.get("periodes_mandat_assemblee")
        for row in acteurs_rows
        if row.get("periodes_mandat_assemblee")
    }

    # Tous les députés de la 17e, partis depuis compris, avec leurs périodes de mandat :
    # ceux que la liste d'un scrutin peut devoir nommer sans que la source les cite.
    periodes_depute = {
        row["uid"]: row["periodes_depute_17"]
        for row in acteurs_rows
        if row.get("periodes_depute_17")
    }
    # Colonne vide (acteurs pas encore importés depuis sa création, l'étape `acteurs`
    # sautant un ZIP inchangé et n'arrêtant pas le cron quand elle échoue) : continuer
    # écrirait une liste d'absents vide sur chaque scrutin à liste nominative. On bloque,
    # le ZIP reste non confirmé et sera relu la nuit suivante.
    if not periodes_depute:
        raise RuntimeError("acteurs.periodes_depute_17 est vide : lancer d'abord l'import des acteurs.")
    # Seule source du groupe d'un député sans vote : la source ne cite pas ces députés.
    historique_groupes = {row["uid"]: row.get("historique_groupes") for row in acteurs_rows}

    # `mandats` est volumineux : on ne le charge que pour les députés en exercice, et
    # uniquement pour repérer le président de l'Assemblée (voir plus bas, taux de
    # participation).
    deputes_actuels_rows = fetch_all_rows(conn, "acteurs", "uid,mandats", ("est_depute_actuel", True))
    presidents_assemblee = {
        row["uid"]
        for row in deputes_actuels_rows
        if est_president_assemblee(row.get("mandats"))
    }

    def _siegeait_a_l_assemblee(uid, date_str):
        """True si le député `uid` siégeait à l'Assemblée le jour `date_str` (« YYYY-MM-DD »).

        Appelée pour chaque député de `periodes_depute` que la source ne cite pas dans un
        scrutin, bornes des périodes incluses.
        """
        return bool(date_str and any(
            date_str >= p["debut"] and (p["fin"] is None or date_str <= p["fin"])
            for p in periodes_depute[uid]
        ))

    def _groupe_du_jour(uid, date_str):
        """Groupe de `uid` le jour `date_str`, d'après l'AMO, pour un député que la source ne cite pas."""
        return groupe_au_depot(historique_groupes.get(uid), (date_str or "")[:10])

    organes_rows = fetch_all_rows(conn, "organes", "uid,code_type,libelle_abrev")
    known_organe_uids = {row["uid"] for row in organes_rows}
    # Les non-inscrits ont un « groupe » dans l'open data (un par législature, sigle
    # NI), mais ce n'est qu'un regroupement administratif d'élus sans groupe : ni ligne
    # commune, ni discipline de vote. Une cohésion calculée par rapport à lui ne
    # mesure rien, et elle s'affichait pourtant comme un taux de loyauté (86,53 % pour
    # le groupe NI de la 17ᵉ au 2026-09-14). Voir la cohésion des acteurs et des organes.
    # Pour la même raison, ils n'ont aucune ligne de position de groupe (D-313) : une
    # position majoritaire calculée sur eux plaçait « Horizons ↔ Non inscrit » parmi
    # les paires les plus alignées de /Facts/alliances.
    organes_non_inscrits = {
        row["uid"] for row in organes_rows
        if row.get("code_type") == "GP" and row.get("libelle_abrev") == "NI"
    }

    print(f"  → {len(known_acteur_uids)} acteurs, {len(known_organe_uids)} organes chargés.\n")

    # --- Chargement des UIDs de scrutins "votes finaux" (liés à un acte législatif) ---
    # import_actes_legislatifs_cloud.py tourne avant ce script dans le CI/CD,
    # donc vote_refs est déjà renseigné en base au moment où on calcule les stats.
    print("Chargement des scrutins 'votes finaux' depuis actes_legislatifs...")
    # `distinct unnest` : seules les références comptent, et la base les déplie au lieu de
    # renvoyer les tableaux de chaque acte.
    votes_finaux_uids: set[str] = {
        r["uid"] for r in lire(
            conn,
            "select distinct unnest(vote_refs) as uid from actes_legislatifs where vote_refs is not null",
        )
        if r["uid"]
    }
    conn.close()
    print(f"  → {len(votes_finaux_uids)} scrutins identifiés comme votes finaux.\n")

    # --- Détection des fichiers scrutin dans le ZIP ---
    # Les fichiers de scrutin ont un nom du type VTANR5L17Vxxx.json
    all_files = zip_ref.namelist()
    json_files = [
        f for f in all_files
        if f.endswith(".json") and os.path.basename(f).startswith("VTANR")
    ]
    if not json_files:
        # Fallback : on prend tous les .json
        json_files = [f for f in all_files if f.endswith(".json")]

    print(f"Nombre de scrutins à traiter : {len(json_files)}\n")

    # --- Structures d'accumulation en mémoire ---
    # Par acteur :
    #   votes_total                : scrutins où l'acteur apparaît (hors nonVotants institutionnels MG/PAN/PSE)
    #   votes_pour/contre/abstentions : votes exercés, en personne ou par délégation
    #   votes_absent               : nonVotant volontaire (PP) ou cause inconnue — absence choisie
    #   taux_participation_votes_finaux : (pour + contre + abstentions) / (scrutins_finaux_pendant_mandat) × 100
    #                                ↳ abstention = vote exercé (choix délibéré), jamais une absence
    #                                ↳ ce taux mesure le mandat exercé, PAS la présence dans l'hémicycle :
    #                                  un vote peut être pris par un collègue porteur d'une délégation
    #                                  (champ `parDelegation` du JSON, jamais lu pour la participation).
    #                                  Mesuré sur les scrutins solennels de la 17ᵉ : 30 % des votes
    #                                  enregistrés sont délégués, jusqu'à 87 % chez un député. C'est
    #                                  voulu, une délégation est un vote valide.
    #                                ↳ nonVotant institutionnel (MG/PAN/PSE) = EXCLU du calcul (ni num. ni dénom.)
    #                                ↳ motion de censure (MOC) = EXCLUE du calcul (ni num. ni dénom.)
    #                                ↳ les absents SANS délégation n'apparaissent pas du tout dans le JSON
    #   votes_actifs_importants    : votes actifs (pour/contre/abstention) sur scrutins SPS uniquement
    #   taux_participation_votes_solennels : votes_actifs_importants / scrutins_solennels_pendant_mandat × 100
    #   votes_finaux_solennels     : votes actifs sur les scrutins finaux OU solennels, motions de
    #                                censure exclues : les votes des deux taux de participation réunis
    #   votes_delegues             : parmi eux, ceux déposés par un collègue (`parDelegation`). Seul
    #                                usage de ce champ : il ne retire rien à la participation, il
    #                                dit quelle part en a été déléguée.
    #   taux_delegation            : votes_delegues / votes_finaux_solennels × 100
    #   cohesion_eligible          : scrutins où l'acteur a voté et son groupe a une position connue
    #                                (au moins un votant, pas d'égalité), motions de censure
    #                                exclues (accord garanti, elles ne recensent que les votes
    #                                favorables), votes sous l'étiquette non-inscrit exclus
    #   cohesion_accord            : parmi les éligibles, ceux où il a voté comme la position majoritaire du groupe
    #   scrutin_dates_exclues      : dates des scrutins institutionnels (pour ajuster le dénominateur)
    stats_acteurs = {}

    # Par organe (groupe politique) :
    #   scrutins_total                      : nombre de scrutins où le groupe a participé
    #   votants_finaux_cumul                : somme des membres qui ont voté (pour, contre,
    #                                         abstention) sur les votes finaux hors motions
    #   possibles_finaux_cumul              : somme des membres qui pouvaient voter sur ces
    #                                         mêmes scrutins (effectif moins MG/PAN/PSE)
    #   votants_solennels_cumul             : idem, restreint aux scrutins SPS (les MOC en sont
    #   possibles_solennels_cumul             sorties par D-107, comme du taux de participation)
    #   votants_finaux_solennels_cumul      : somme des membres qui ont voté sur les scrutins finaux
    #                                         ou solennels (chacun compté une fois), motions exclues
    #   delegues_cumul                      : parmi eux, les votes déposés par délégation
    #   cohesion_votes_cumul                : somme des membres ayant voté comme la position majoritaire
    #   cohesion_eligible_cumul             : somme des membres présents (éligibles à la cohésion),
    #                                         motions de censure exclues (accord garanti)
    stats_organes = {}

    # Les scrutins et positions partent par paquets de BATCH_SIZE pendant le parsing, pour
    # ne pas accumuler les ~6 000 scrutins en mémoire ; la base écarte elle-même les lignes
    # inchangées (voir `upsert_batch`).
    BATCH_SIZE = 500
    pending_scrutins = []  # buffer pour le streaming d'upserts
    pending_positions = []  # buffer scrutins_groupes_positions (votes finaux uniquement)
    # Pour la purge de fin de run (`purger_positions_sans_groupe`) : les scrutins dont
    # les positions ont toutes été recalculées, et les clés qui en ont une.
    scrutins_positions_recalculees: set[str] = set()
    positions_valides: set[str] = set()
    # Votes adoptés sur un amendement, écrits à part dans `votes_amendements` : ils
    # n'entrent ni dans `scrutins.votes_nominatifs` ni dans aucun taux de participation.
    votes_amendement: list[dict] = []
    success = 0            # total de scrutins parsés avec succès
    success_importants = 0 # parmi eux : scrutins « importants » (MOC + SPS)
    scrutins_envoyes = 0   # envoyés à la base, qui n'en écrit que les nouveaux ou modifiés
    positions_envoyees = 0
    total_corrections_map = 0  # corrections miseAuPoint appliquées
    failed = 0
    # Collecte des dates de scrutins pour calculer les dénominateurs personnels par mandat
    # Chaque entrée : (date_scrutin: str | None, is_important: bool, is_final: bool)
    scrutin_dates: list[tuple[str | None, bool, bool]] = []

    # --- Boucle de parsing ---
    for file_path in tqdm(json_files, desc="Parsing scrutins", unit="scrutin"):
        try:
            with zip_ref.open(file_path) as f:
                data = json.load(f)

            payload_scrutin, votes_par_acteur, votes_par_organe = parser_scrutin(data)

            if payload_scrutin is None:
                failed += 1
                continue

            success += 1

            # Détection scrutin "important" (Motion de Censure ou Scrutin Public Solennel)
            is_scrutin_important = payload_scrutin.get("type_vote_code") in ("MOC", "SPS")
            # Détection scrutin "vote final" (lié à un acte législatif via vote_refs)
            is_vote_final = payload_scrutin.get("uid") in votes_finaux_uids

            # Une motion de censure ne fait recenser que les votes favorables (Constitution,
            # art. 49) : `contre` et `abstention` y sont toujours à zéro. S'y opposer est donc
            # indistinguable d'une absence, et l'inclure dans un taux de participation pénalise
            # mécaniquement les élus qui soutiennent le Gouvernement (mesuré au 2026-08-31 :
            # 11 points de participation pour le groupe EPR, 240 députés n'ayant voté aucune
            # motion). Elle sort donc des deux taux, numérateur ET dénominateur, comme les
            # statuts institutionnels MG/PAN/PSE. Elle sort aussi de la cohésion (D-120) et
            # des positions de groupe (voir « Persistance des positions de groupe » plus
            # bas), et reste partout ailleurs : votes nominatifs persistés, fiche dossier.
            is_motion_censure = payload_scrutin.get("type_vote_code") == "MOC"
            compte_participation_finale = is_vote_final and not is_motion_censure
            compte_participation_solennelle = is_scrutin_important and not is_motion_censure

            est_amendement_adopte = (
                payload_scrutin.get("sort_code") == "adopté"
                and est_vote_sur_amendement(payload_scrutin.get("objet_libelle") or payload_scrutin.get("titre"))
            )

            # Votes nominatifs individuels — persistés uniquement pour les scrutins ciblés,
            # dans `scrutins` ou, pour un amendement adopté, dans `votes_amendements`.
            if is_scrutin_important or is_vote_final or est_amendement_adopte:
                date_scrutin = payload_scrutin.get("date_scrutin")
                vn: dict[str, list[str]] = {
                    "pour": [], "contre": [], "abstentions": [],
                    "nonVotants": [], "institutionnels": [], "absents": [],
                }
                present_uids: set[str] = set()
                # Groupe du jour de chaque nom, lu par le volet de détail du vote. C'est le
                # `groupe_ref` sous lequel la source le décompte, donc le même que les
                # positions de groupe : relire l'AMO à la place rangeait un élu ailleurs
                # que son décompte quand l'AMO publiait un groupe en retard (D-278).
                groupes_votants: dict[str, str | None] = {}

                for acteur_ref, vote_info in votes_par_acteur.items():
                    position = vote_info["position"]
                    cause = vote_info.get("cause")
                    present_uids.add(acteur_ref)
                    groupes_votants[acteur_ref] = GROUPE_ALIAS.get(vote_info["groupe_ref"], vote_info["groupe_ref"])
                    if position == "pour":
                        vn["pour"].append(acteur_ref)
                    elif position == "contre":
                        vn["contre"].append(acteur_ref)
                    elif position == "abstention":
                        vn["abstentions"].append(acteur_ref)
                    elif position == "nonVotant":
                        if cause in CAUSES_INSTITUTIONNELLES:
                            vn["institutionnels"].append(acteur_ref)
                        else:
                            vn["nonVotants"].append(acteur_ref)

                # Absents AN : députés qui siégeaient à la date du scrutin, partis depuis
                # compris, et que le JSON source ne cite pas. Sans les partis, leurs sièges
                # restaient vides dans l'hémicycle du vote.
                for uid in periodes_depute:
                    if uid not in present_uids and _siegeait_a_l_assemblee(uid, date_scrutin):
                        vn["absents"].append(uid)
                        # La source ne range pas les absents : leur groupe vient de l'AMO.
                        groupes_votants[uid] = _groupe_du_jour(uid, date_scrutin)

                # Listes triées, comme au Sénat : les absents viennent d'un set, dont
                # l'ordre change d'une exécution à l'autre. Sans tri, l'empreinte du
                # scrutin changeait chaque nuit et les ~300 scrutins à liste nominative
                # étaient réécrits pour rien. Aucun lecteur ne dépend de l'ordre.
                listes_triees = {cat: sorted(uids) for cat, uids in vn.items()}
                groupes_tries = dict(sorted(groupes_votants.items()))
                if is_scrutin_important or is_vote_final:
                    payload_scrutin["votes_nominatifs"] = listes_triees
                    payload_scrutin["groupes_votants"] = groupes_tries

                if est_amendement_adopte:
                    # Mêmes exclusions que les positions de `scrutins_groupes_positions` :
                    # pas de ligne sans position ni pour les non-inscrits (D-313).
                    positions_groupes = sorted(
                        (
                            {
                                "groupe_uid": GROUPE_ALIAS.get(organe_ref, organe_ref),
                                "position_majoritaire": gstats["positionMajoritaire"],
                                "nb_pour": gstats["pour"],
                                "nb_contre": gstats["contre"],
                                "nb_abstentions": gstats["abstentions"],
                                "nb_membres": gstats["nombreMembres"],
                            }
                            for organe_ref, gstats in votes_par_organe.items()
                            if gstats["positionMajoritaire"]
                            and GROUPE_ALIAS.get(organe_ref, organe_ref) not in organes_non_inscrits
                        ),
                        key=lambda p: p["groupe_uid"],
                    )
                    votes_amendement.append({
                        "uid": payload_scrutin["uid"],
                        "chambre": "AN",
                        "date_scrutin": date_scrutin,
                        "titre": payload_scrutin.get("objet_libelle") or payload_scrutin.get("titre"),
                        "pour": payload_scrutin.get("synthese_pour"),
                        "contre": payload_scrutin.get("synthese_contre"),
                        "abstentions": payload_scrutin.get("synthese_abstentions"),
                        "votants": payload_scrutin.get("synthese_nombre_votants"),
                        "non_votants": payload_scrutin.get("synthese_non_votants"),
                        "suffrages_requis": payload_scrutin.get("synthese_suffrages_requis"),
                        "votes_nominatifs": listes_triees,
                        "groupes_votants": groupes_tries,
                        "positions_groupes": positions_groupes,
                    })

            # Tous les scrutins partent chaque nuit : la base écarte ceux qui n'ont pas
            # changé. Les stats acteurs/organes ci-dessous sont de toute façon
            # recalculées à partir de l'ensemble des scrutins.
            pending_scrutins.append(payload_scrutin)
            scrutins_envoyes += 1

            # Flush par batch pendant le parsing pour éviter l'accumulation mémoire
            if len(pending_scrutins) >= BATCH_SIZE:
                upsert_batch("scrutins", pending_scrutins, "uid")
                pending_scrutins = []

            if is_scrutin_important:
                success_importants += 1

            # Enregistrer la date pour calculer les dénominateurs personnels par mandat
            scrutin_dates.append((payload_scrutin.get("date_scrutin"), compte_participation_solennelle, compte_participation_finale))

            # --- Persistance des positions de groupe (votes finaux uniquement) ---
            # Alimente scrutins_groupes_positions pour la page /Facts/alliances.
            if is_vote_final:
                scrutin_uid = payload_scrutin.get("uid")
                # Une motion de censure n'a aucune position de groupe. Seuls les « pour » y sont
                # recensés : avec une position dès un votant (D-269), tout groupe ayant un votant
                # recevait « pour », même à 1 voix sur 49 (DR, 25/02/2026). 121 lignes sur 23
                # motions, dont 45 où moins de la moitié du groupe avait voté la censure. Le
                # scrutin entre quand même dans `scrutins_positions_recalculees` : la purge de fin
                # de run efface ainsi les lignes déjà écrites, hash compris. Les pages qui lisent
                # la table n'ont donc plus à écarter les motions. Les non-inscrits non plus
                # (D-313) : leurs lignes déjà en base partent par la même purge.
                if not is_motion_censure:
                    for organe_ref, gstats in votes_par_organe.items():
                        pm = gstats.get("positionMajoritaire")
                        if pm not in ("pour", "contre", "abstention"):
                            continue
                        groupe_uid_cible = GROUPE_ALIAS.get(organe_ref, organe_ref)
                        if groupe_uid_cible in organes_non_inscrits:
                            continue
                        position_payload = {
                            "scrutin_uid": scrutin_uid,
                            "groupe_uid": groupe_uid_cible,
                            "chambre": "AN",
                            "position_majoritaire": pm,
                            "nb_pour": gstats.get("pour"),
                            "nb_contre": gstats.get("contre"),
                            "nb_abstentions": gstats.get("abstentions"),
                            "nb_membres": gstats.get("nombreMembres"),
                        }
                        position_key = f"{scrutin_uid}|{groupe_uid_cible}"
                        positions_valides.add(position_key)
                        pending_positions.append(position_payload)
                        positions_envoyees += 1
                # Ajouté après la boucle, pas avant : un scrutin interrompu en route ne
                # doit pas voir purger les positions qu'il n'a pas eu le temps de valider.
                scrutins_positions_recalculees.add(scrutin_uid)
                if len(pending_positions) >= BATCH_SIZE:
                    upsert_batch("scrutins_groupes_positions", pending_positions,
                                 "scrutin_uid,groupe_uid", cle="scrutin_uid")
                    pending_positions = []

            # Votants et non-votants institutionnels de chaque groupe sur ce scrutin, lus
            # dans la liste nominative, donc après les corrections miseAuPoint : ce sont les
            # positions que compte le taux individuel. Le groupe est celui que la source
            # donne ce jour-là (`groupe_ref`).
            votants_par_groupe: dict[str, int] = {}
            delegues_par_groupe: dict[str, int] = {}
            institutionnels_par_groupe: dict[str, int] = {}
            for vote_info in votes_par_acteur.values():
                g = vote_info["groupe_ref"]
                if vote_info["position"] in ("pour", "contre", "abstention"):
                    votants_par_groupe[g] = votants_par_groupe.get(g, 0) + 1
                    if vote_info.get("par_delegation"):
                        delegues_par_groupe[g] = delegues_par_groupe.get(g, 0) + 1
                elif vote_info.get("cause") in CAUSES_INSTITUTIONNELLES:
                    institutionnels_par_groupe[g] = institutionnels_par_groupe.get(g, 0) + 1

            # Accumulation stats organes
            for organe_source, stats in votes_par_organe.items():
                # Redirection : si ce groupe a été renommé, on cumule sous le nouveau nom
                organe_ref = GROUPE_ALIAS.get(organe_source, organe_source)
                if organe_ref not in stats_organes:
                    stats_organes[organe_ref] = {
                        "scrutins_total": 0,
                        "votants_finaux_cumul": 0,
                        "possibles_finaux_cumul": 0,
                        "votants_solennels_cumul": 0,
                        "possibles_solennels_cumul": 0,
                        "votants_finaux_solennels_cumul": 0,
                        "delegues_cumul": 0,
                        "cohesion_votes_cumul": 0,
                        "cohesion_eligible_cumul": 0,
                    }
                s = stats_organes[organe_ref]
                s["scrutins_total"] += 1

                # Membres présents = ceux qui ont voté (pour + contre + abstentions)
                membres_presents = stats["pour"] + stats["contre"] + stats["abstentions"]

                # Participation du groupe : ses votes sur ses votes possibles, scrutin par
                # scrutin, avec l'effectif qu'il avait ce jour-là (D-278). Un vote compte
                # donc dans le groupe où il a été émis, y compris celui d'un député parti
                # depuis ou passé dans un autre groupe. Mêmes exclusions que le taux
                # individuel : motions de censure (voir `is_motion_censure`) et
                # non-votants institutionnels MG/PAN/PSE, ni votants ni votes possibles.
                votants = votants_par_groupe.get(organe_source, 0)
                possibles = stats["nombreMembres"] - institutionnels_par_groupe.get(organe_source, 0)
                if compte_participation_finale:
                    s["votants_finaux_cumul"] += votants
                    s["possibles_finaux_cumul"] += possibles
                if compte_participation_solennelle:
                    s["votants_solennels_cumul"] += votants
                    s["possibles_solennels_cumul"] += possibles
                # Délégation : les votes des deux taux réunis, un scrutin à la fois solennel
                # et final ne comptant qu'une fois.
                if compte_participation_finale or compte_participation_solennelle:
                    s["votants_finaux_solennels_cumul"] += votants
                    s["delegues_cumul"] += delegues_par_groupe.get(organe_source, 0)

                # Cohésion interne : % de membres qui votent comme la position majoritaire du groupe.
                # Les motions de censure en sont écartées : la Constitution n'y fait recenser que
                # les votes favorables, donc la position majoritaire y est « pour » par construction
                # et tout membre recensé est d'accord avec elle. Chaque motion ajoutait ainsi une
                # ligne d'accord garanti aux seuls groupes qui les votent (11,5 motions en moyenne
                # par député concerné, mesuré au 2026-08-31), ce qui pousse leur cohésion vers le
                # haut sans mesurer aucune discipline de vote.
                #
                # Votes finaux seulement, sur la même assiette que la cohésion individuelle
                # (`cohesion_eligible` plus bas) : la page de la loyauté affiche les deux côte à
                # côte, la moyenne d'un groupe et le taux de chacun de ses membres, et deux
                # périmètres différents les rendraient incomparables sans que rien ne le dise.
                pm = stats["positionMajoritaire"]
                if pm and membres_presents > 0 and compte_participation_finale and not is_motion_censure:
                    if pm == "pour":
                        votes_en_accord = stats["pour"]
                    elif pm == "contre":
                        votes_en_accord = stats["contre"]
                    elif pm == "abstention":
                        votes_en_accord = stats["abstentions"]
                    else:
                        votes_en_accord = 0
                    s["cohesion_votes_cumul"] += votes_en_accord
                    s["cohesion_eligible_cumul"] += membres_presents

            # Accumulation stats acteurs
            for acteur_ref, vote_info in votes_par_acteur.items():
                if acteur_ref not in stats_acteurs:
                    stats_acteurs[acteur_ref] = {
                        "votes_total": 0,
                        "votes_pour": 0,
                        "votes_contre": 0,
                        "votes_abstentions": 0,
                        "votes_absent": 0,
                        "votes_actifs_importants": 0,
                        "cohesion_eligible": 0,
                        "cohesion_accord": 0,
                        "vote_dates": [],  # [(date, position, is_important, is_final, par_delegation)] — pour filtrage par mandat
                        "scrutin_dates_exclues": [],  # dates des scrutins institutionnels (MG/PAN/PSE)
                    }
                s = stats_acteurs[acteur_ref]
                position = vote_info["position"]
                groupe_ref_scrutin = vote_info["groupe_ref"]
                cause = vote_info.get("cause")  # None pour pour/contre/abstention ; str pour nonVotants

                # NonVotant institutionnel (MG, PAN, PSE) → ce scrutin ne compte pas pour ce député
                # Ni au numérateur (il n'a pas voté) ni au dénominateur (il ne pouvait pas voter)
                if position == "nonVotant" and cause in CAUSES_INSTITUTIONNELLES:
                    s["scrutin_dates_exclues"].append((payload_scrutin.get("date_scrutin"), compte_participation_solennelle, compte_participation_finale))
                    continue

                s["votes_total"] += 1
                if position == "pour":
                    s["votes_pour"] += 1
                elif position == "contre":
                    s["votes_contre"] += 1
                elif position == "abstention":
                    s["votes_abstentions"] += 1
                elif position == "nonVotant":
                    # PP (Position personnelle) ou cause inconnue → absence volontaire
                    s["votes_absent"] += 1

                # Participation aux scrutins solennels : vote actif, exercé ou délégué
                if compte_participation_solennelle and position != "nonVotant":
                    s["votes_actifs_importants"] += 1

                # Enregistrer la date de vote pour filtrage par mandat (numérateur cohérent)
                if position != "nonVotant":
                    s["vote_dates"].append((
                        payload_scrutin.get("date_scrutin"), position, compte_participation_solennelle,
                        compte_participation_finale, bool(vote_info.get("par_delegation")),
                    ))

                # Cohésion : compare la position de l'acteur avec la position majoritaire de son groupe.
                # On n'inclut ni les absents, ni les motions de censure (accord garanti, voir la
                # cohésion interne des organes plus haut), ni les votes émis sous l'étiquette
                # non-inscrit (voir `organes_non_inscrits`). Le groupe est celui que la source
                # donne au jour du scrutin : un député qui a changé de groupe est jugé sur le
                # groupe de chaque vote, pas sur son groupe actuel.
                #
                # Votes finaux seulement (`compte_participation_finale`), comme le taux de
                # participation et comme la cohésion du Sénat (D-189). Sans ce filtre
                # l'Assemblée comptait tous ses scrutins publics : la fiche affichait alors un
                # taux calculé sur quelques milliers de votes à côté des 267 scrutins finaux du
                # mandat, deux nombres sans rapport dont aucun lecteur ne pouvait refaire le
                # calcul. Le dénominateur est désormais un sous-ensemble de celui qui est
                # affiché, et les deux chambres mesurent la même chose.
                if (
                    position != "nonVotant"
                    and compte_participation_finale
                    and not is_motion_censure
                    and groupe_ref_scrutin in votes_par_organe
                    and groupe_ref_scrutin not in organes_non_inscrits
                ):
                    pm = votes_par_organe[groupe_ref_scrutin]["positionMajoritaire"]
                    if pm:
                        s["cohesion_eligible"] += 1
                        if position == pm:
                            s["cohesion_accord"] += 1

        except Exception as e:
            tqdm.write(f"❌ Erreur sur {file_path}: {type(e).__name__}: {e}")
            traceback.print_exc()
            failed += 1

    # ===================================================================
    # Upsert des scrutins bruts (flush du buffer restant)
    # ===================================================================
    if pending_scrutins:
        print(f"\nInsertion des {len(pending_scrutins)} derniers scrutins dans la base...")
        upsert_batch("scrutins", pending_scrutins, "uid")
    else:
        print("\nTous les scrutins ont déjà été streamés vers la base.")

    # Flush final des positions de groupe (votes finaux)
    if pending_positions:
        print(f"Insertion des {len(pending_positions)} dernières positions de groupe (AN)...")
        upsert_batch("scrutins_groupes_positions", pending_positions,
                     "scrutin_uid,groupe_uid", cle="scrutin_uid")
        pending_positions = []

    # Après l'écriture : la purge ne touche que des clés absentes de `positions_valides`,
    # donc jamais une position écrite ce soir.
    with connexion(autocommit=True) as conn:
        purger_positions_sans_groupe(conn, scrutins_positions_recalculees, positions_valides)

    # ===================================================================
    # Mise à jour des stats acteurs
    # ===================================================================
    print(f"\nMise à jour des stats pour {len(stats_acteurs)} acteurs...")
    batch_acteurs = []
    skipped_acteurs = 0

    for acteur_ref, s in stats_acteurs.items():
        # On ne met à jour que les acteurs déjà présents dans notre base
        if acteur_ref not in known_acteur_uids:
            skipped_acteurs += 1
            continue
        if acteur_ref in senateurs_actuels:
            continue

        # Calcul du dénominateur personnalisé selon la fenêtre de mandat
        # → on ne compte que les scrutins qui se sont déroulés pendant le(s) mandat(s) du député
        debut, fin = acteur_mandate_range.get(acteur_ref, (None, None))
        periods = acteur_periods_list.get(acteur_ref)  # [{debut, fin}] ou None (multi-périodes)

        # Fonction de test : la date tombe-t-elle dans un mandat actif ?
        if periods:
            # Multi-période : ex-ministre revenu (ex: Rist) — on additionne ses deux mandats ASSEMBLEE
            in_period = lambda d: d and any(
                d >= p["debut"] and (p["fin"] is None or d <= p["fin"])
                for p in periods
            )
        elif debut:
            # Période unique : fenêtre debut → fin (ou aujourd'hui)
            in_period = lambda d: d and d >= debut and (fin is None or d <= fin)
        else:
            # Pas de date de mandat connue → tout compter
            in_period = lambda d: bool(d)

        # Dénominateur brut : scrutins pendant le(s) mandat(s)
        # taux_participation_votes_finaux → votes finaux uniquement (liés à un acte), comparable au Sénat
        # taux_participation_votes_solennels → MOC + SPS (sous-ensemble politiquement significatif)
        scrutins_finaux_brut = sum(1 for d, _, fin in scrutin_dates if in_period(d) and fin)
        scrutins_importants_brut = sum(1 for d, imp, _ in scrutin_dates if in_period(d) and imp)

        # Retirer les scrutins où le député était nonVotant institutionnel (MG/PAN/PSE)
        # → ces scrutins ne doivent compter ni au numérateur ni au dénominateur
        exclus = (s.get("scrutin_dates_exclues") or [])
        exclus_finaux = sum(1 for d, _, fin in exclus if in_period(d) and fin)
        exclus_importants = sum(1 for d, imp, _ in exclus if in_period(d) and imp)

        scrutins_finaux_en_mandat = scrutins_finaux_brut - exclus_finaux
        scrutins_importants_en_mandat = scrutins_importants_brut - exclus_importants

        # Numérateur : votes pendant le(s) mandat(s) — garantit votes_actifs ≤ scrutins_pendant_mandat
        vd = [v for v in s["vote_dates"] if in_period(v[0])]
        votes_pour_m = sum(1 for _, p, _, _, _ in vd if p == "pour")
        votes_contre_m = sum(1 for _, p, _, _, _ in vd if p == "contre")
        votes_abstentions_m = sum(1 for _, p, _, _, _ in vd if p == "abstention")
        votes_actifs_finaux_m = sum(1 for _, p, _, fin, _ in vd if fin and p in ("pour", "contre", "abstention"))
        votes_actifs_importants_m = sum(1 for _, _, imp, _, _ in vd if imp)
        # Part déléguée des votes de ses deux taux de participation réunis (finaux ou
        # solennels), un scrutin à la fois final et solennel ne comptant qu'une fois.
        votes_finaux_solennels_m = sum(1 for _, _, imp, fin, _ in vd if imp or fin)
        votes_delegues_m = sum(1 for _, _, imp, fin, deleg in vd if (imp or fin) and deleg)
        taux_delegation = (
            round(votes_delegues_m / votes_finaux_solennels_m * 100, 2)
            if votes_finaux_solennels_m > 0 else None
        )

        taux_participation_votes_finaux = (
            round(votes_actifs_finaux_m / scrutins_finaux_en_mandat * 100, 2)
            if scrutins_finaux_en_mandat > 0 else None
        )
        taux_participation_votes_solennels = (
            round(votes_actifs_importants_m / scrutins_importants_en_mandat * 100, 2)
            if scrutins_importants_en_mandat > 0 else None
        )
        # Le président de l'Assemblée n'a pas de taux de participation publiable. Les
        # scrutins qu'il préside sortent du calcul (codes PAN/PSE ci-dessus), si bien
        # qu'au 2026-09-05 le sien se mesurait sur 24 scrutins là où les autres députés
        # en comptaient 267 : un 100 % qu'aucune absence ne peut faire baisser, affiché
        # comme 57 points au-dessus de la chambre. Le Sénat neutralise déjà le taux de
        # son propre président ; l'Assemblée s'aligne, plutôt que de publier un chiffre
        # calculé sur 9 % de l'assiette des autres. Les compteurs bruts, eux, restent.
        # Même règle pour sa part de votes délégués, mesurée sur la même assiette tronquée.
        if acteur_ref in presidents_assemblee:
            taux_participation_votes_finaux = None
            taux_participation_votes_solennels = None
            taux_delegation = None

        ce = s["cohesion_eligible"]
        taux_cohesion = round(s["cohesion_accord"] / ce * 100, 2) if ce > 0 else None
        # Un non-inscrit n'a pas de groupe à qui être fidèle. Ses votes sous l'étiquette NI
        # sont déjà hors du calcul, mais un député devenu non-inscrit garderait sinon le taux
        # de son ancien groupe, affiché sous l'étiquette NI. NULL écrit explicitement :
        # l'upsert remplace ainsi la valeur des nuits précédentes.
        if acteur_to_groupe.get(acteur_ref) in organes_non_inscrits:
            taux_cohesion = None

        batch_acteurs.append({
            "uid": acteur_ref,
            "votes_total": s["votes_total"],
            "votes_pour": votes_pour_m,
            "votes_contre": votes_contre_m,
            "votes_abstentions": votes_abstentions_m,
            "votes_absent": s["votes_absent"],
            "votes_actifs_importants": votes_actifs_importants_m,
            "scrutins_finaux_pendant_mandat": scrutins_finaux_en_mandat,
            "scrutins_solennels_pendant_mandat": scrutins_importants_en_mandat,
            "taux_participation_votes_finaux": taux_participation_votes_finaux,
            "taux_participation_votes_solennels": taux_participation_votes_solennels,
            "votes_finaux_solennels": votes_finaux_solennels_m,
            "votes_delegues": votes_delegues_m,
            "taux_delegation": taux_delegation,
            "taux_cohesion_groupe": taux_cohesion,
        })

    ecrites_avant = lignes_ecrites.get("acteurs", 0)
    upsert_batch("acteurs", batch_acteurs, "uid")
    print(f"  → {len(batch_acteurs)} acteurs calculés, {lignes_ecrites.get('acteurs', 0) - ecrites_avant} modifiés, {skipped_acteurs} ignorés (non trouvés en base).")

    # ===================================================================
    # Mise à jour des stats organes
    # ===================================================================
    print(f"\nMise à jour des stats pour {len(stats_organes)} organes...")

    batch_organes = []
    skipped_organes = 0

    for organe_ref, s in stats_organes.items():
        # On ne met à jour que les organes déjà présents dans notre base
        if organe_ref not in known_organe_uids:
            print(f"  ⚠️  Organe ignoré (non trouvé en base) : {organe_ref}")
            skipped_organes += 1
            continue

        # Le nom des colonnes dit « moyen » : c'est la moyenne des votes possibles du
        # groupe, pondérée par scrutin, et non plus celle des taux de ses membres actuels.
        # Celle-ci comptait dans un groupe les votes qu'un député y avait émis avant de le
        # rejoindre, et sortait ceux des députés partis depuis (D-278).
        pf = s["possibles_finaux_cumul"]
        taux_participation_votes_finaux_moyen = round(s["votants_finaux_cumul"] / pf * 100, 2) if pf > 0 else None
        ps = s["possibles_solennels_cumul"]
        taux_participation_votes_solennels_moyen = round(s["votants_solennels_cumul"] / ps * 100, 2) if ps > 0 else None
        vfs = s["votants_finaux_solennels_cumul"]
        taux_delegation_moyen = round(s["delegues_cumul"] / vfs * 100, 2) if vfs > 0 else None

        ce = s["cohesion_eligible_cumul"]
        taux_cohesion = round(s["cohesion_votes_cumul"] / ce * 100, 2) if ce > 0 else None
        # Pas de cohésion interne pour le regroupement des non-inscrits (voir
        # `organes_non_inscrits`) : NULL écrit, pour effacer le taux déjà en base.
        if organe_ref in organes_non_inscrits:
            taux_cohesion = None

        batch_organes.append({
            "uid": organe_ref,
            "scrutins_total": s["scrutins_total"],
            "taux_participation_votes_finaux_moyen": taux_participation_votes_finaux_moyen,
            "taux_participation_votes_solennels_moyen": taux_participation_votes_solennels_moyen,
            "taux_delegation_moyen": taux_delegation_moyen,
            "taux_cohesion_interne": taux_cohesion,
        })

    ecrites_avant = lignes_ecrites.get("organes", 0)
    upsert_batch("organes", batch_organes, "uid")
    print(f"  → {len(batch_organes)} organes calculés, {lignes_ecrites.get('organes', 0) - ecrites_avant} modifiés, {skipped_organes} ignorés (non trouvés en base).")

    # ===================================================================
    # Votes sur les amendements adoptés (table à part)
    # ===================================================================
    # En dernier : une panne ici laisse intactes toutes les écritures ci-dessus, et le
    # script sort en échec, donc la nuit suivante retente.
    print(f"\nRapprochement de {len(votes_amendement)} votes d'amendements adoptés...")
    lignes_votes, compteurs_votes = relier_votes(votes_amendement, "AN")
    upsert_batch("votes_amendements", lignes_votes, "uid")
    print(f"  → {compteurs_votes}, {lignes_ecrites.get('votes_amendements', 0)} ligne(s) écrite(s).")

    # ===================================================================
    # Rapport final
    # ===================================================================
    # Compteurs dérivés
    total_exclus_institutionnels = sum(len(s.get("scrutin_dates_exclues") or []) for s in stats_acteurs.values())

    print(f"\n{'='*60}")
    print(f"           IMPORT SCRUTINS TERMINÉ")
    print(f"{'='*60}")
    print(f"   Scrutins importés            : {success}")
    print(f"   dont importants (MOC + SPS)  : {success_importants}")
    ecrits = lignes_ecrites.get("scrutins", 0)
    print(f"   Scrutins écrits (nouveaux ou modifiés) : {ecrits}")
    print(f"   Scrutins inchangés           : {scrutins_envoyes - ecrits - lignes_perdues_par_table.get('scrutins', 0)}")
    ecrites_pos = lignes_ecrites.get("scrutins_groupes_positions", 0)
    print(f"   Positions écrites            : {ecrites_pos}")
    print(f"   Positions inchangées         : {positions_envoyees - ecrites_pos - lignes_perdues_par_table.get('scrutins_groupes_positions', 0)}")
    print(f"   Scrutins en erreur           : {failed}")
    print(f"   Lignes perdues en écriture   : {lignes_perdues_ecriture}")
    print(f"   Total traités                : {success + failed} / {len(json_files)}")
    print(f"   Acteurs modifiés             : {lignes_ecrites.get('acteurs', 0)} sur {len(batch_acteurs)}")
    print(f"   Organes modifiés             : {lignes_ecrites.get('organes', 0)} sur {len(batch_organes)}")
    print(f"   NonVotants institutionnels    : {total_exclus_institutionnels} (MG/PAN/PSE exclus du calcul)")
    print(f"{'='*60}")

    return failed, lignes_perdues_ecriture


# ===================================================================
# Exécution
# ===================================================================

if __name__ == "__main__":
    URL_SCRUTINS = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/scrutins/Scrutins.json.zip"
    try:
        zip_ref = download_zip_if_modified(URL_SCRUTINS)
    except NotModified:
        # ZIP inchangé → les stats dérivées sont identiques, on ne fait rien.
        print("ZIP scrutins inchangé depuis le dernier import — sortie.")
        sys.exit(0)
    echecs_parsing, echecs_ecriture = importer_scrutins_from_zip(zip_ref)
    print("Import terminé !")

    # Le compte était affiché puis oublié : le script sortait en 0 avec des scrutins
    # manquants, et le cron enchaînait sans que rien ne le signale.
    if echecs_ecriture:
        print(f"❌ {echecs_ecriture} ligne(s) perdues en écriture.")
        sys.exit(1)

    if echecs_parsing:
        signaler_anomalie(
            "scrutins",
            f"{echecs_parsing} scrutin(s) illisibles dans le dump AN — à corriger dans le parseur",
        )

    confirmer_import(URL_SCRUTINS)
