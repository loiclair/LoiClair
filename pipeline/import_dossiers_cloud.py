# import_dossiers_cloud.py
# Script pour importer TOUS les JSON dossiers législatifs (AN Jan 2026) dans la table 'dossiers_legislatifs' depuis URL AN
# Exécute avec : python import_dossiers.py


import json
import sys
import traceback
from pathlib import Path
from dotenv import load_dotenv
import requests
import io
import zipfile
from tqdm import tqdm
from datetime import datetime

# Ajouter le dossier du script au path pour importer les modules voisins (_alertes…)
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import signaler_anomalie
from _db import connexion, lire
from _motions_censure import est_motion_sans_vote, motion_adoptee, trouver_scrutin_motion
from _positions_groupe import groupe_au_depot
from _refs_an import ajouter_refs, extraire_vote_refs
from _statuts import dossiers_appliques, dossiers_rejetes_au_senat, verifier_statuts
from _sync_cache import (
    NotModified,
    confirmer_import,
    creer_organes_manquants,
    download_zip_if_modified,
    upsert_si_change,
)

# Charger .env.local (chemin relatif au script, portable sur toutes les machines) : les
# variables PG* de `connexion()` et de `_sync_cache` y vivent en local.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ===================================================================
# Fonctions utilitaires
# ===================================================================

def parse_date_acte(s: str | None):
    """Parse une date d'acte (YYYY-MM-DD ou ISO) en datetime. Retourne None si invalide."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00") if "T" in s else s + "T00:00:00")
    except (ValueError, AttributeError):
        return None


def reconstruire_lien_an(legislature, titre_chemin):
    """Reconstruit le lien Assemblée nationale."""
    if legislature and titre_chemin:
        return f"https://www.assemblee-nationale.fr/dyn/{legislature}/dossiers/{titre_chemin}"
    return None


def extraire_refs_recursif(actes, key, result_set, sub_key=None):
    """Extrait récursivement les références texteAssocie / texteAdopte.
    Amélioration : gère les refs nichées dans 'textesAssocies' (ex. : list de dicts avec 'refTexteAssocie').
    Les références de vote passent par extraire_vote_refs (`_refs_an.py`), commune
    aux deux imports AN.
    """
    if actes is None:
        return
    if isinstance(actes, list):
        for item in actes:
            extraire_refs_recursif(item, key, result_set, sub_key)
    elif isinstance(actes, dict):
        value = actes.get(key)
        if value:
            if isinstance(value, str):
                result_set.add(value)
            elif isinstance(value, list):
                for v in value:
                    if isinstance(v, str):
                        result_set.add(v)
                    elif isinstance(v, dict) and sub_key and sub_key in v:
                        ajouter_refs(v[sub_key], result_set)
            elif isinstance(value, dict) and sub_key and sub_key in value:
                ajouter_refs(value[sub_key], result_set)

        # Ajout : plonge dans 'textesAssocies' si key est texte-related (avec sub_key adapté pour refs imbriquées)
        if key in ["texteAssocie", "texteAdopte"]:
            textes_associes = actes.get("textesAssocies")
            if textes_associes:
                extraire_refs_recursif(
                    textes_associes, key, result_set, "refTexteAssocie"
                )

        # Récursion sur sous-actes (normalisé comme dans version fonctionnelle)
        sous = actes.get("actesLegislatifs")
        if sous is not None:
            extraire_refs_recursif(sous.get("acteLegislatif"), key, result_set, sub_key)


def extraire_statut_final_et_prom(actes):
    """Extrait statut_final, date_promulgation, code_loi, titre_loi, url_legifrance de façon ultra-robuste."""
    statut_final = "en_cours"
    date_promulgation = None
    code_loi = None
    titre_loi = None
    url_legifrance = None
    if actes is None:
        return statut_final, date_promulgation, code_loi, titre_loi, url_legifrance
    # Normalisation : on veut toujours une liste d'actes
    if isinstance(actes, dict):
        actes = actes.get("acteLegislatif") or []
    if not isinstance(actes, list):
        actes = [actes] if actes else []
    for acte in actes:
        if not isinstance(acte, dict):
            continue
        code_acte = acte.get("codeActe")
        # === Cas PROM (promulgation) ===
        if code_acte == "PROM":
            statut_final = "promulguee"
            sub = acte.get("actesLegislatifs")
            # Gestion ultra-robuste du sous-acte PROM (peut être dict, list, ou dict dans dict)
            prom = {}
            if sub is not None:
                if isinstance(sub, dict):
                    prom = (sub.get("acteLegislatif") or {})
                elif isinstance(sub, list) and sub:
                    prom = sub[0] if isinstance(sub[0], dict) else {}
            if not isinstance(prom, dict):
                prom = {}
            date_promulgation = prom.get("dateActe")
            code_loi = prom.get("codeLoi")
            titre_loi = prom.get("titreLoi")
            url_legifrance = (prom.get("infoJO") or {}).get("urlLegifrance")
        # === Cas DEC adoptée ou rejetée ===
        elif code_acte == "DEC":
            conclusion = (acte.get("statutConclusion") or {})
            libelle = (conclusion.get("libelle") or "").lower()
            fam_code = conclusion.get("fam_code", "")
            if fam_code in ["TSORTF01", "TSORTF18"] or "adopté" in libelle:
                statut_final = "adoptee"
            elif "rejet" in libelle:
                statut_final = "rejetee"
        # Récursion sur sous-actes (normalisé comme dans version fonctionnelle)
        sous_actes = acte.get("actesLegislatifs")
        if sous_actes is not None:
            sub_statut, sub_date, sub_code, sub_titre, sub_url = (
                extraire_statut_final_et_prom(sous_actes.get("acteLegislatif"))
            )
            if sub_statut != "en_cours":
                statut_final = sub_statut
                date_promulgation = sub_date or date_promulgation
                code_loi = sub_code or code_loi
                titre_loi = sub_titre or titre_loi
                url_legifrance = sub_url or url_legifrance
    return statut_final, date_promulgation, code_loi, titre_loi, url_legifrance

def a_ete_retire(actes) -> bool:
    """Vrai si l'arbre des actes porte un retrait du texte par son auteur (`AN1-RTRINI`,
    `SN1-RTRINI`…). La source ne publie alors aucune décision : sans cette lecture, le
    texte restait « pas encore voté » pour toujours (85 dossiers au 2026-11-09, dont le
    délit de séjour irrégulier, retiré le jour où son article unique a été supprimé)."""
    if isinstance(actes, dict):
        if str(actes.get("codeActe") or "").endswith("RTRINI"):
            return True
        return any(a_ete_retire(v) for v in actes.values() if isinstance(v, (dict, list)))
    if isinstance(actes, list):
        return any(a_ete_retire(a) for a in actes)
    return False


def lire_decision(libelle: str) -> tuple[bool, bool, bool, bool]:
    """(adopté, rejeté, modifié, conforme) d'un libellé de conclusion, en minuscules.

    Appelée par les deux fonctions de statut ci-dessous. Une chambre qui « modifie » un
    texte l'adopte dans une autre version, et une résolution « considérée comme
    définitive » (article 151-7 du Règlement) est adoptée sans vote : jusqu'au
    2026-10-28, seuls « adopt » et « rejet » étaient lus, et 30 résolutions restaient
    « pas encore voté », l'abrogation du Code noir modifiée par le Sénat restait
    « Adopté par l'Assemblée nationale ». « Sans modification » marque une adoption
    conforme, qui clôt la navette ; la lecture définitive aussi, mais elle se lit dans
    le code de l'acte (voir `determiner_statut_final_precis`).
    """
    conforme = "sans modification" in libelle
    modifie = "modifi" in libelle and not conforme
    # « définitiv » couvre les deux genres, comme `estAdopte` dans les pages Facts.
    adopte = "adopt" in libelle or "définitiv" in libelle or modifie
    rejete = "rejet" in libelle
    return adopte, rejete, modifie, conforme


def determiner_statut_final_precis(actes) -> str:
    """
    Statut d'un dossier à deux chambres, lu dans ses décisions (DEC) en séance.
    Appelée par la boucle d'import pour tout dossier ni promulgué ni à chambre unique.

    On garde la dernière décision de chaque chambre (une nouvelle lecture remplace un
    rejet). Deux rejets donnent « Rejeté ». « Adopté par le Parlement » demande que la
    décision la plus récente soit une adoption qui ne modifie pas le texte, et qu'elle
    soit conforme ou que l'autre chambre l'ait elle aussi adopté sans le modifier : un
    texte modifié par le Sénat repart à l'Assemblée, il n'est pas adopté par les deux.
    Sinon c'est la décision la plus récente des deux chambres qui parle : un rejet par
    une seule chambre n'arrête pas forcément le texte (le PLFSS rejeté par l'Assemblée
    est transmis au Sénat), mais c'est bien là qu'il en est. Jusqu'au 2026-10-27, une
    adoption l'emportait sur un rejet quel que soit l'ordre, et un rejet seul restait
    « pas encore voté » : le PLFSS 2027 rejeté par l'Assemblée s'affichait non voté, la
    loi constitutionnelle sur la Corse adoptée par le Sénat puis rejetée par
    l'Assemblée s'affichait adoptée. À date égale, l'adoption l'emporte.
    """
    if not actes:
        return "Déposé - pas encore voté"

    # Stocke les décisions par assemblée avec leur date
    decisions_an = []   # liste de (date, est_adopte, est_modifie, est_conforme)
    decisions_sn = []

    def recurse(acte_list):
        if isinstance(acte_list, dict):
            acte_list = [acte_list]
        if not isinstance(acte_list, list):
            return

        for acte in acte_list:
            if not isinstance(acte, dict):
                continue

            code_acte = (acte.get("codeActe") or "")
            date_acte = acte.get("dateActe")
            conclusion = acte.get("statutConclusion") or {}
            libelle = str((conclusion.get("libelle") or "")).lower()

            is_decision = "DEC" in code_acte
            is_adopte, is_rejete, is_modifie, is_conforme = lire_decision(libelle)
            # Lecture définitive (ANLDEF, art. 45 al. 4 de la Constitution) : l'Assemblée
            # a le dernier mot, son adoption clôt la navette quel que soit le libellé.
            if "LDEF" in code_acte and is_adopte:
                is_conforme = True

            if is_decision and date_acte and (is_adopte or is_rejete):
                dt = parse_date_acte(date_acte)
                if dt:
                    if "AN" in code_acte:
                        decisions_an.append((dt, is_adopte, is_modifie, is_conforme))
                    elif "SN" in code_acte:
                        decisions_sn.append((dt, is_adopte, is_modifie, is_conforme))

            # Récursion
            sous = acte.get("actesLegislatifs")
            if sous:
                if isinstance(sous, dict) and "acteLegislatif" in sous:
                    recurse(sous["acteLegislatif"])
                elif isinstance(sous, list):
                    recurse(sous)

    recurse(actes)

    # === Prendre la décision la plus récente par assemblée ===
    # La clé départage une égalité de date au profit de l'adoption, puis de l'adoption
    # conforme sur la modification : sans ce second critère, deux décisions du même jour
    # seraient départagées par l'ordre du JSON source.
    def cle(d):
        return (d[0], d[1], d[3], not d[2])

    latest_an = max(decisions_an, key=cle) if decisions_an else None
    latest_sn = max(decisions_sn, key=cle) if decisions_sn else None

    candidates = []
    if latest_an:
        candidates.append((latest_an, "AN"))
    if latest_sn:
        candidates.append((latest_sn, "SN"))
    if not candidates:
        return "Déposé - pas encore voté"
    (_, adopte, modifie, conforme), chambre = max(candidates, key=lambda x: cle(x[0]))

    # === Application des règles ===
    if latest_an and latest_sn and not latest_an[1] and not latest_sn[1]:
        return "Rejeté"
    autre = latest_sn if chambre == "AN" else latest_an
    if adopte and not modifie and (conforme or (autre and autre[1] and not autre[2])):
        return "Adopté par le Parlement"

    # Une chambre seule, deux décisions contraires, ou une navette en cours : la
    # décision la plus récente l'emporte.
    if chambre == "AN":
        return "Adopté par l'Assemblée nationale" if adopte else "Rejeté par l'Assemblée nationale"
    return "Adopté par le Sénat" if adopte else "Rejeté par le Sénat"


def morte_a_la_premiere_chambre(statut: str, procedure_libelle: str | None, actes) -> bool:
    """Vrai pour une proposition de loi rejetée par la seule chambre qui l'a examinée.

    Rejetée par la première chambre, une proposition de loi ne va jamais à l'autre :
    elle est morte, et vaut « Rejeté » (D-323), le seul statut qui ferme la frise.
    « Rejeté par l'Assemblée nationale » laissait « Sénat 1re lecture, en attente » sur
    DLR5L17N50453 et DLR5L17N52787 (2 au 2026-11-03). Un projet de loi rejeté part
    quand même à l'autre chambre (le PLFSS 2027), d'où la restriction aux propositions :
    seul « Proposition de loi ordinaire » les désigne sans ambiguïté, les libellés
    organique et constitutionnel couvrant aussi les projets. `actes` : les actes racines
    du dump AN (dict seul ou liste) ; l'autre chambre n'en a aucun.
    """
    if procedure_libelle != "Proposition de loi ordinaire":
        return False
    autre = {"Rejeté par l'Assemblée nationale": "SN", "Rejeté par le Sénat": "AN"}.get(statut)
    if not autre:
        return False
    racines = actes if isinstance(actes, list) else [actes]
    return not any(
        isinstance(a, dict) and str(a.get("codeActe") or "").startswith((autre, "CMP"))
        for a in racines
    )


def determiner_statut_final_chambre_unique(actes) -> str:
    """
    Pour les procédures à chambre unique (codes 8, 13, 22).
    Seul le dernier vote DEC trouvé est pris en compte (tout se passe à l'AN).
    """
    if not actes:
        return "Déposé - pas encore voté"

    decisions = []

    def recurse(acte_list):
        if isinstance(acte_list, dict):
            acte_list = [acte_list]
        if not isinstance(acte_list, list):
            return
        for acte in acte_list:
            if not isinstance(acte, dict):
                continue
            code_acte = (acte.get("codeActe") or "")
            date_acte = acte.get("dateActe")
            conclusion = acte.get("statutConclusion") or acte.get("decision") or {}
            libelle = str((conclusion.get("libelle") or "")).lower()
            is_adopte, is_rejete, _, _ = lire_decision(libelle)
            if ("DEC" in code_acte or "VOTE" in code_acte) and date_acte and (is_adopte or is_rejete):
                dt = parse_date_acte(date_acte)
                if dt:
                    decisions.append((dt, is_adopte))
            sous = acte.get("actesLegislatifs")
            if sous:
                if isinstance(sous, dict) and "acteLegislatif" in sous:
                    recurse(sous["acteLegislatif"])
                elif isinstance(sous, list):
                    recurse(sous)

    recurse(actes)

    if not decisions:
        return "Déposé - pas encore voté"

    latest = max(decisions, key=lambda x: x[0])
    return "Adopté par l'Assemblée nationale" if latest[1] else "Rejeté"


def statut_motion_depuis_scrutin(actes, titre: str | None, scrutins_moc: list) -> str | None:
    """Statut d'un dossier de motion de censure dont la source a omis l'acte de vote.

    `actes` : l'arbre `acteLegislatif` brut du dossier. `scrutins_moc` : scrutins de type
    MOC lus en base. Rend les mêmes libellés que `determiner_statut_final_chambre_unique`,
    ou None si le dossier n'est pas concerné ou si le scrutin ne se rapproche pas sans
    doute (règle dans `_motions_censure.py`). `import_actes_legislatifs_cloud.py`
    reconstitue l'acte de vote avec la même règle.
    """
    codes: list[str] = []
    seances: set[str] = set()
    pile = [actes]
    while pile:
        noeud = pile.pop()
        if isinstance(noeud, list):
            pile.extend(noeud)
        elif isinstance(noeud, dict):
            if noeud.get("codeActe"):
                codes.append(noeud["codeActe"])
            if noeud.get("reunionRef"):
                seances.add(noeud["reunionRef"])
            sous = noeud.get("actesLegislatifs")
            if isinstance(sous, dict):
                pile.append(sous.get("acteLegislatif"))
            elif isinstance(sous, list):
                pile.append(sous)

    if not est_motion_sans_vote(codes):
        return None
    scrutin = trouver_scrutin_motion(titre, seances, scrutins_moc)
    adoptee = motion_adoptee(scrutin) if scrutin else None
    if adoptee is None:
        return None
    return "Adopté par l'Assemblée nationale" if adoptee else "Rejeté"


# Actes de dépôt en première lecture, et en lecture unique pour les résolutions. Le champ
# est `codeActe` dans le JSON de l'Assemblée (constaté sur DLR5L17N52428 : `AN1-DEPOT`,
# dateActe 2025-10-14 ; sur DLR5L17N50739 : `ANLUNI-DEPOT`, précédé d'une nomination).
CODES_ACTE_DEPOT = {"AN1-DEPOT", "SN1-DEPOT", "ANLUNI-DEPOT"}


def extraire_date_depot_min(actes):
    """Date de dépôt du dossier : la plus ancienne `dateActe` des actes de dépôt en
    première lecture (`AN1-DEPOT`, `SN1-DEPOT`) ou en lecture unique (`ANLUNI-DEPOT`) ; à défaut, la plus ancienne de tout
    l'arbre. Appelée par `importer_dossier`.

    Le repli existe pour les dossiers sans acte de dépôt (766 des 3 379 dossiers de
    l'Assemblée au 2026-10-29, avant l'ajout de `ANLUNI-DEPOT`).
    Prendre l'arbre entier pour tous était faux pour les budgets, les traités et les
    textes du Gouvernement : les rapporteurs y sont nommés avant le dépôt (PLF 2026 daté
    du 2025-06-03 par une nomination, alors que l'acte de dépôt est du 2025-10-14).
    """
    if not actes:
        return None

    dates = []
    dates_depot = []

    def recurse(obj):
        if isinstance(obj, dict):
            date_str = obj.get("dateActe")
            if date_str and isinstance(date_str, str):
                dt = parse_date_acte(date_str)
                if dt:
                    dates.append(dt)
                    if obj.get("codeActe") in CODES_ACTE_DEPOT:
                        dates_depot.append(dt)
            # Récursion sur toutes les sous-clés
            for v in obj.values():
                recurse(v)
        elif isinstance(obj, list):
            for item in obj:
                recurse(item)
    
    recurse(actes)
    
    retenues = dates_depot or dates
    return min(retenues) if retenues else None



# ===================================================================
# Téléchargement du ZIP
# ===================================================================
def download_zip(url: str) -> zipfile.ZipFile:
    """Télécharge le ZIP en mémoire depuis l'URL et renvoie l'objet ZipFile ouvert.
    Gère les erreurs HTTP pour robustesse.
    """
    response = requests.get(url, timeout=120)
    response.raise_for_status()  # Lève une exception si code HTTP != 200 (ex. : lien mort)
    return zipfile.ZipFile(
        io.BytesIO(response.content)
    )  # Tout en RAM pour éviter I/O disque


# ===================================================================
# Boucle sur les JSON du ZIP  → VERSION CORRIGÉE
# ===================================================================
def importer_dossiers_from_zip(
    zip_ref: zipfile.ZipFile, dossier_prefix: str = "json/dossierParlementaire/"
) -> int:
    """Boucle sur tous les .json avec batch upsert + résumé final à la fin seulement.

    Retourne `(echecs_parsing, echecs_ecriture)`. Les deux se traitent
    différemment : un parsing qui échoue est durable et s'alerte, une écriture
    perdue est passagère et bloque. Voir `_alertes.signaler_anomalie`.
    """

    # --- Pré-chargement des lookups (évite N+1 requêtes dans la boucle) ---
    # Connexion fermée dès les lectures faites : la boucle d'écriture a la sienne
    # (`_sync_cache`), et celle-ci resterait inutilement ouverte pendant tout l'import.
    with connexion(autocommit=True) as conn:
        print("Chargement des acteurs et organes en mémoire...")
        # Historique brut des groupes de chaque acteur, lu par `groupe_au_depot`.
        acteur_to_periodes: dict[str, list[dict]] = {
            row["uid"]: row["historique_groupes"]
            for row in lire(
                conn,
                "SELECT uid, historique_groupes FROM acteurs "
                "WHERE historique_groupes IS NOT NULL ORDER BY uid",
            )
        }

        # Libellés de tous les groupes qu'un historique peut rendre (uid déjà actifs, l'alias
        # étant appliqué à l'écriture) : un texte peut être rangé dans un groupe disparu depuis.
        groupe_uids = list({
            h["groupe"]
            for historique in acteur_to_periodes.values() for h in historique
        })
        organe_to_libelle: dict = {}
        if groupe_uids:
            for row in lire(conn, "SELECT uid, libelle FROM organes WHERE uid = ANY(%s)", (groupe_uids,)):
                organe_to_libelle[row["uid"]] = row["libelle"]

        print(f"  → {len(acteur_to_periodes)} acteurs, {len(organe_to_libelle)} organes chargés.")

        # Chargement des gouvernements (pour attribuer le bon gouvernement selon la date de dépôt)
        gvt_rows = lire(
            conn,
            "SELECT uid, libelle_abrege, date_debut, date_fin FROM organes WHERE code_type = 'GOUVERNEMENT'",
        )
        gouvernements = []  # liste de (date_debut, date_fin_ou_None, uid)
        gouvernements_uids = set()
        for g in gvt_rows:
            if not g.get("date_debut"):
                continue
            deb = parse_date_acte(g["date_debut"])
            fin = parse_date_acte(g["date_fin"]) if g.get("date_fin") else None
            if not deb:
                continue
            gouvernements.append((deb, fin, g["uid"]))
            gouvernements_uids.add(g["uid"])
        gouvernements.sort(key=lambda x: x[0])
        print(f"  → {len(gouvernements)} gouvernements chargés.")

        # Scrutins de motion de censure, pour les dossiers de motion sans acte de vote (voir
        # statut_motion_depuis_scrutin). Une vingtaine par législature. Ils sont importés
        # après ce script dans le nocturne : une motion votée le jour J reçoit son statut la
        # nuit suivante.
        scrutins_moc = lire(
            conn,
            "SELECT uid, seance_ref, titre, sort_code FROM scrutins WHERE type_vote_code = 'MOC' ORDER BY uid",
        )
        print(f"  → {len(scrutins_moc)} scrutins de motion de censure chargés.")

        # Lois appliquées : la source de l'Assemblée ne connaît que « promulguée ». Sans ce
        # rappel, toute ligne réécrite repassait à « Promulguée » jusqu'au passage
        # d'import_application_lois.py, plus tard dans la nuit.
        appliques = dossiers_appliques(conn)
        print(f"  → {len(appliques)} dossiers appliqués chargés.")

        # Textes rejetés par le Sénat en 1re lecture, que la source laisse « Déposé » (voir
        # `dossiers_rejetes_au_senat`).
        rejetes_senat = dossiers_rejetes_au_senat(conn)
        print(f"  → {len(rejetes_senat)} dossiers rejetés au Sénat chargés.\n")
    # ----------------------------------------------------------------------

    success = 0
    # Deux compteurs, deux gravités. Un parsing qui échoue est durable : il
    # recommencera à l'identique demain, donc il s'alerte sans bloquer. Une écriture
    # perdue est passagère : elle bloque, pour qu'on retente la nuit suivante.
    echecs_parsing = 0
    echecs_ecriture = 0
    skipped_unchanged = 0

    json_files = [
        f
        for f in zip_ref.namelist()
        if f.startswith(dossier_prefix) and f.endswith(".json")
    ]
    print(f"Nombre total de JSON à traiter : {len(json_files)}\n")

    batch_size = 500
    batch = []

    def flush_batch(b: list) -> tuple[int, int, int]:
        """Écrit un lot et rend (écrits, perdus, inchangés).

        Les organes initiateurs absents de `organes` y sont d'abord créés, sans quoi la
        clé étrangère rejetterait le dossier (voir `creer_organes_manquants`). Tous les
        dossiers partent chaque nuit, et la base n'écrit que ceux qui ont changé : les
        « inchangés » sont ceux qu'elle a laissés tels quels. Une ligne perdue sera
        retentée la nuit suivante. Un statut inconnu du site arrête l'import avant
        l'écriture du lot (voir `_statuts.py`).
        """
        verifier_statuts(b)
        creer_organes_manquants(p.get("initiateur_organe_ref") for p in b)
        # `lien_senat` n'est pas comparé : `sync_senat.py` le remplit plus tard dans la
        # nuit pour des dossiers dont le dump de l'Assemblée ne le donne pas. Comparé, il
        # était remis à vide chaque nuit puis rétabli (constaté le 2026-11-05 sur trois
        # dossiers). Il s'écrit avec le reste quand une autre colonne change, comme
        # quand le cache d'empreintes décidait de l'envoi.
        ecrites, perdues = upsert_si_change(
            "dossiers_legislatifs", b, "uid", sans_comparer=("lien_senat",), journal=tqdm.write
        )
        return ecrites, len(perdues), len(b) - ecrites - len(perdues)

    # Boucle principale
    parsed = 0
    for idx, file_path in enumerate(
        tqdm(json_files, desc="Import dossiers législatifs", unit="dossier")
    ):
        with zip_ref.open(file_path) as json_stream:
            dossier_data = json.load(json_stream)

            payload = importer_dossier(dossier_data, file_path, acteur_to_periodes, organe_to_libelle, gouvernements, gouvernements_uids, scrutins_moc, appliques, rejetes_senat)

            if payload is not None:
                parsed += 1
                batch.append(payload)
            else:
                echecs_parsing += 1

            # Upsert par batch
            if len(batch) >= batch_size:
                s, f, i = flush_batch(batch)
                success += s
                echecs_ecriture += f
                skipped_unchanged += i
                batch = []

    if batch:  # Envoi final du batch restant
        s, f, i = flush_batch(batch)
        success += s
        echecs_ecriture += f
        skipped_unchanged += i

    # ←══════════════════════════════════════════════════════════════
    #                  RAPPORT FINAL (Une seule fois !)
    # ←══════════════════════════════════════════════════════════════
    print(f"\n{'='*60}")
    print(f"                  IMPORT TERMINÉ")
    print(f"{'='*60}")
    print(f"   Parsés         : {parsed}")
    print(f"   Inchangés       : {skipped_unchanged}")
    print(f"   Upserts        : {success}")
    print(f"   Échecs parsing : {echecs_parsing}")
    print(f"   Échecs écriture: {echecs_ecriture}")
    print(f"   Total          : {parsed + echecs_parsing} / {len(json_files)}")
    print(f"{'='*60}")

    return echecs_parsing, echecs_ecriture


# ===================================================================
# Import d'un seul dossier
# ===================================================================
def importer_dossier(data: dict, file_path: str = "unknown.json", acteur_to_periodes: dict = None, organe_to_libelle: dict = None, gouvernements: list = None, gouvernements_uids: set = None, scrutins_moc: list = None, appliques: set | None = None, rejetes_senat: set | None = None):
    """Parse un JSON dossier du dump AN et rend le payload `dossiers_legislatifs`, ou None.

    Les tables de correspondance sont préchargées par `importer_dossiers_from_zip` pour
    éviter une requête par dossier. `scrutins_moc` ne sert qu'au statut des motions de
    censure dont la source a omis l'acte de vote ; `appliques` (uid des lois appliquées,
    `dossiers_appliques`) garde « Appliquée » à une loi que la source dit promulguée ;
    `rejetes_senat` (`dossiers_rejetes_au_senat`) passe à « Rejeté » un texte mort au
    Sénat que la source laisse « Déposé ».
    """

    try:
        dossier = (data.get("dossierParlementaire") or {})
        if not dossier:
            tqdm.write(f"⚠️  Format invalide → {file_path}")
            return None

        uid = dossier.get("uid")
        if not uid:
            tqdm.write(f"⚠️  UID manquant → {file_path}")
            return None

        legislature = (
            int(dossier.get("legislature")) if dossier.get("legislature") else None
        )
        titre_dossier = dossier.get("titreDossier") or {}
        titre = titre_dossier.get("titre")
        titre_chemin = titre_dossier.get("titreChemin")
        senat_chemin = titre_dossier.get("senatChemin")
        procedure = dossier.get("procedureParlementaire") or {}
        procedure_code = procedure.get("code")
        procedure_libelle = procedure.get("libelle")
        initiateur = dossier.get("initiateur") or {}
        # Acteurs (gère liste multiple)
        acteurs_data = initiateur.get("acteurs") or {}
        acteurs_list = acteurs_data.get("acteur") or []
        if not isinstance(acteurs_list, list):
            acteurs_list = [acteurs_list] if acteurs_list else []
        # Premier comme initiateur principal
        initiateur_acteur_ref = None
        initiateur_mandat_ref = None
        if acteurs_list:
            premier = acteurs_list[0] if isinstance(acteurs_list[0], dict) else {}
            initiateur_acteur_ref = premier.get("acteurRef")
            initiateur_mandat_ref = premier.get("mandatRef")
        # Reste comme co-auteurs (liste d'UIDs acteurRef pour query facile via = ANY())
        co_auteurs = [
            a.get("acteurRef")
            for a in acteurs_list[1:]
            if isinstance(a, dict) and a.get("acteurRef")
        ]
        # Organes (inchangé, par sécurité)
        organes_data = initiateur.get("organes") or {}
        organe = organes_data.get("organe") or {}
        if isinstance(organe, list) and organe:
            organe = organe[0] if isinstance(organe[0], dict) else {}
        if not isinstance(organe, dict):
            organe = {}
        organe_ref = organe.get("organeRef") or {}
        initiateur_organe_ref = (
            organe_ref.get("uid") if isinstance(organe_ref, dict) else organe_ref
        )

        # `actesLegislatifs` vaut parfois null dans le dump AN, pour un dossier ouvert
        # dont aucun acte n'est encore publié (constaté sur DLR5L17N54629, le projet de
        # loi de finances pour 2027). La valeur par défaut d'un `.get()` ne sert que si
        # la clé manque, pas si elle porte null : sans le `or {}`, le dossier partait en
        # AttributeError et se retrouvait absent du site.
        actes_legislatifs = (
            (dossier.get("actesLegislatifs") or {}).get("acteLegislatif") or []
        )
        fusion_dossier = dossier.get("fusionDossier")
        # Extraction textes et votes
        textes_set = set()
        extraire_refs_recursif(actes_legislatifs, "texteAssocie", textes_set)
        extraire_refs_recursif(actes_legislatifs, "texteAdopte", textes_set)
        # Triés : l'ordre d'un `set` de chaînes change d'une exécution à l'autre, et
        # rendait donc la liste différente de celle en base. Environ 630 dossiers étaient réécrits
        # chaque nuit sans qu'aucune valeur ne bouge (constaté le 2026-10-08).
        textes_associes_refs = sorted(textes_set)
        votes_refs = extraire_vote_refs(actes_legislatifs)

        # `date_depot` est une colonne `date` : on écrit le jour civil, lu dans le
        # décalage d'origine de `dateActe` (+01:00 ou +02:00), donc le jour de Paris.
        # L'horodatage reste gardé pour la recherche du gouvernement plus bas, dont les
        # bornes sont des horodatages avec fuseau : un jour nu n'y serait pas comparable.
        dt_depot = extraire_date_depot_min(actes_legislatifs)
        date_depot = dt_depot.date().isoformat() if dt_depot else None

        # Lookup groupe depuis les dicts pré-chargés (pas de requête en base ici)
        initiateur_groupe_uid = None
        initiateur_groupe_libelle = None

        # Origine gouvernementale prouvée par le type du texte déposé, que le préfixe de
        # son uid donne sans ambiguïté : `PRJL` pour un projet de loi, `DECL` pour une
        # déclaration du Gouvernement (49-1 et 49-3). `procedure_code` ne suffirait pas,
        # les codes 5 et 7 s'appelant « Projet OU proposition de loi organique /
        # constitutionnelle » (D-152).
        origine_gouvernementale = any(
            ref.startswith("PRJL") or ref.startswith("DECL") for ref in textes_associes_refs
        )

        # 1. Cas gouvernemental : l'initiateur est directement un organe gouvernement connu.
        if gouvernements_uids and initiateur_organe_ref and initiateur_organe_ref in gouvernements_uids:
            initiateur_groupe_uid = initiateur_organe_ref
            initiateur_groupe_libelle = "Gouvernement"

        # 2. Texte du Gouvernement : le gouvernement en fonction à la date de dépôt, uid
        #    et libellé, avant tout regard sur l'acteur initiateur.
        #
        #    Ce cas passait autrefois après celui de l'acteur, comme simple repli. Or
        #    l'initiateur d'un projet de loi est le ministre qui le porte, et
        #    `acteurs.groupe` ne connaît que son groupe d'aujourd'hui : au 2026-09-14,
        #    26 projets de loi étaient rangés dans un groupe parlementaire, dont le budget
        #    2025 (DLR5L17N50198), classé dans le groupe actuel de son acteur initiateur.
        #
        #    L'uid écrit est celui d'un organe GOUVERNEMENT : les pages qui groupent par
        #    `initiateur_groupe_uid` reconnaissent ce type et fusionnent tous les
        #    gouvernements en une seule entrée, sans créer de second « Gouvernement ».
        #    Faute de gouvernement couvrant la date, le dossier reste sans groupe : jamais
        #    celui du ministre.
        elif origine_gouvernementale:
            if dt_depot and gouvernements:
                for deb, fin, gvt_uid in gouvernements:
                    if deb <= dt_depot and (fin is None or fin >= dt_depot):
                        initiateur_groupe_uid = gvt_uid
                        initiateur_groupe_libelle = "Gouvernement"
                        break

        # 3. Cas parlementaire (proposition de loi) : le groupe de l'auteur le jour du
        #    dépôt, lu dans `acteurs.historique_groupes`. `acteurs.groupe` ne donnait que
        #    le groupe d'aujourd'hui : un texte suivait son auteur dans un nouveau groupe,
        #    et 396 propositions de la 17ᵉ législature n'en avaient aucun le 2026-10-08
        #    (sénateurs dont l'AMO avait clos le groupe sans publier le nouveau, auteurs
        #    partis ou devenus ministres). L'alias range l'UDR et l'UDDPLR ensemble.
        #
        #    Aucun repli sur le groupe actuel : un auteur sans groupe ce jour-là laisse le
        #    texte sans groupe, mieux vaut aucune attribution qu'une fausse (même principe
        #    que D-152). Aucun repli gouvernemental non plus : les rapports
        #    d'information et commissions d'enquête, qui n'ont aucun initiateur dans la
        #    source, et les motions de censure, déposées par des députés, restent sans
        #    groupe. Un repli ouvert à tous les dossiers en attribuait 465 au Gouvernement
        #    à tort.
        #
        #    L'historique ne contient que des mandats GP et GROUPESENAT : un uid de
        #    gouvernement ne peut pas en sortir, d'où l'absence de filtre ici.
        elif initiateur_acteur_ref and acteur_to_periodes:
            groupe_uid = groupe_au_depot(acteur_to_periodes.get(initiateur_acteur_ref), date_depot)
            if groupe_uid:
                initiateur_groupe_uid = groupe_uid
                if organe_to_libelle:
                    initiateur_groupe_libelle = organe_to_libelle.get(initiateur_groupe_uid)

        # Statut de base (promulgation + rejets simples via ancienne fonction)
        statut_base, date_promulgation, code_loi, titre_loi, url_legifrance = (
            extraire_statut_final_et_prom(actes_legislatifs)
        )

        # === NOUVELLE LOGIQUE PRINCIPALE (plus précise) ===
        PROCEDURES_CHAMBRE_UNIQUE = {"8", "13", "22"}

        # Types de textes qui n'ont pas vocation à être votés
        # (rapports, missions, commissions d'enquête, pétitions, allocutions)
        PROCEDURES_NON_VOTABLES = {
            "Rapport d'information sans mission",
            "Mission d'information",
            "Commission d'enquête",
            "Pétitions",
            "Allocution du Président de l'Assemblée nationale",
        }

        if statut_base == "promulguee":
            statut_final = "Promulguée"
        elif procedure_libelle in PROCEDURES_NON_VOTABLES:
            statut_final = "Publié"
        elif str(procedure_code or "") in PROCEDURES_CHAMBRE_UNIQUE:
            statut_final = determiner_statut_final_chambre_unique(actes_legislatifs)
        else:
            statut_final = determiner_statut_final_precis(actes_legislatifs)

        if statut_final == "Déposé - pas encore voté" and a_ete_retire(actes_legislatifs):
            statut_final = "Retiré"

        # Motion de censure dont la source a omis l'acte de vote : le statut se lit dans
        # son scrutin, sinon il resterait « pas encore voté » pour toujours.
        if statut_final == "Déposé - pas encore voté" and scrutins_moc:
            statut_final = (
                statut_motion_depuis_scrutin(actes_legislatifs, titre, scrutins_moc)
                or statut_final
            )

        # Texte rejeté par le Sénat en 1re lecture : la source ne publie pas la décision,
        # sync_senat.py la recrée d'après le scrutin (voir `dossiers_rejetes_au_senat`).
        if statut_final == "Déposé - pas encore voté" and uid in (rejetes_senat or ()):
            statut_final = "Rejeté"
        # Même texte mort, quand la source publie la décision : proposition de loi
        # rejetée par la première chambre, que l'autre ne recevra jamais.
        if morte_a_la_premiere_chambre(statut_final, procedure_libelle, actes_legislatifs):
            statut_final = "Rejeté"

        if statut_final == "Promulguée" and uid in (appliques or ()):
            statut_final = "Appliquée"

        # Lien AN
        lien_an = reconstruire_lien_an(legislature, titre_chemin)
        # Préparation payload
        payload = {
            "uid": uid,
            "legislature": legislature,
            "titre": titre,
            "titre_chemin": titre_chemin,
            "lien_senat": senat_chemin,
            "procedure_code": procedure_code,
            "procedure_libelle": procedure_libelle,
            "initiateur_acteur_ref": initiateur_acteur_ref,
            "initiateur_mandat_ref": initiateur_mandat_ref,
            "initiateur_organe_ref": initiateur_organe_ref,
            "co_auteurs": co_auteurs or None,  # text[] — queryable via = ANY()
            "actes_legislatifs": actes_legislatifs or [],
            "fusion_dossier": fusion_dossier or None,
            "statut_final": statut_final,
            "date_depot": date_depot,
            "date_promulgation": date_promulgation,
            "code_loi": code_loi,
            "titre_loi": titre_loi,
            "url_legifrance": url_legifrance,
            "textes_associes_refs": textes_associes_refs,
            "votes_refs": votes_refs,
            "lien_an": lien_an,
            "initiateur_groupe_uid": initiateur_groupe_uid,
            "initiateur_groupe_libelle": initiateur_groupe_libelle,
            # Pas de `themes` : generate_search_summaries.py les écrit, et une clé
            # présente ici les écraserait à chaque import (l'upsert met à jour
            # toutes les colonnes du payload, et seulement elles).
        }

        return payload

    except Exception as e:
        tqdm.write(f"🔥 ERREUR CRITIQUE dans {file_path}")
        tqdm.write(f"   → {type(e).__name__}: {e}")
        traceback.print_exc()
        return None


# ===================================================================
# Exécution
# ===================================================================

if __name__ == "__main__":
    URL_DOSSIERS = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip"
    try:
        zip_ref = download_zip_if_modified(URL_DOSSIERS, label="dossiers")
    except NotModified:
        print("ZIP dossiers inchangé depuis le dernier import — sortie.")
        sys.exit(0)
    echecs_parsing, echecs_ecriture = importer_dossiers_from_zip(zip_ref)
    print("Import terminé !")

    # Une écriture perdue est passagère : on bloque, le cache n'est pas confirmé, et la
    # nuit suivante retéléchargera pour retenter.
    if echecs_ecriture:
        print(f"❌ {echecs_ecriture} dossier(s) perdus en écriture.")
        sys.exit(1)

    # Un parsing qui échoue est durable : il recommencera à l'identique demain. C'était
    # le cas du projet de loi de finances pour 2027, dont le `Échecs : 1` s'affichait
    # chaque nuit sans que personne ne le lise. On alerte donc sans bloquer : bloquer
    # ferait retélécharger 200 Mo tous les soirs pour rien et gèlerait la date affichée
    # sur tout le site, alors que celui-ci est à jour à ce dossier près.
    if echecs_parsing:
        signaler_anomalie(
            "dossiers",
            f"{echecs_parsing} dossier(s) illisibles dans le dump AN — à corriger dans le parseur",
        )

    confirmer_import(URL_DOSSIERS, label="dossiers")
