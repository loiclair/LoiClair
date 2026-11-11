# import_actes_legislatifs_cloud.py
# Script pour importer tous les actes législatifs nested des JSON dossiers commençant par 'DLR'
# depuis le ZIP AN dans la table 'actes_legislatifs'.
# Exécute avec : python import_actes_legislatifs_cloud.py

import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
import psycopg
from psycopg.types.json import Json
from dotenv import load_dotenv
import requests
import io
import zipfile
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import signaler_anomalie
from _db import connexion, lire
from _motions_censure import (
    CODE_DEPOT_MOTION,
    est_motion_sans_vote,
    motion_adoptee,
    trouver_scrutin_motion,
)
from _refs_an import SUFFIXE_UID_VOTE_RECONSTITUE, extraire_vote_refs
from _sync_cache import (
    NotModified,
    confirmer_import,
    creer_organes_manquants,
    download_zip_if_modified,
    upsert_si_change,
)


# ==================== DÉPENDANCES (batch insert) ====================

def batch_insert_textes(textes_refs: dict):
    """textes_refs = {texte_uid: dossier_uid}

    Ne touche pas un texte déjà en base (`DO NOTHING`) : sa ligne complète appartient à
    `import_textes_cloud.py`, ceci ne crée que la ligne minimale qu'exige la clé étrangère
    des actes. Une erreur (un dossier absent, par la clé étrangère de `dossier_ref`) lève,
    comme avant : sans ces textes, les actes qui les citent seraient rejetés un à un.
    """
    if not textes_refs:
        return
    uids = list(textes_refs)
    with connexion(autocommit=True) as conn:
        conn.execute(
            "INSERT INTO textes (uid, dossier_ref) SELECT * FROM unnest(%s::text[], %s::text[])"
            " ON CONFLICT (uid) DO NOTHING",
            (uids, [textes_refs[u] for u in uids]),
        )
    print(f"✅ {len(uids)} textes traités (déjà existants ignorés)")


def batch_insert_organes(organe_uids: set):
    if not organe_uids:
        return
    creer_organes_manquants(organe_uids)
    print(f"✅ {len(organe_uids)} organes traités (déjà existants ignorés)")


def mettre_a_jour_actes(conn, types: dict[str, str], lignes: list[dict]) -> int:
    """Écrit `types` (colonne -> type SQL) sur les actes `lignes`, repérés par leur clé
    primaire (uid, dossier_uid), et rend le nombre de lignes touchées.

    Une requête par lot de 1 000 lignes, au lieu d'un UPDATE par acte (`_db.mettre_a_jour`
    ne convient pas : sa clé est une seule colonne, et celle des actes en compte deux).
    Chaque ligne porte `uid`, `dossier_uid` et toutes les colonnes de `types`. Les noms de
    colonnes et leurs types viennent du code, jamais d'une donnée. Chaque lot est une
    transaction : il passe en entier ou pas du tout.
    """
    if not lignes:
        return 0
    definition = ", ".join(["uid text", "dossier_uid text"] + [f"{c} {t}" for c, t in types.items()])
    affectations = ", ".join(f"{c} = v.{c}" for c in types)
    touchees = 0
    for i in range(0, len(lignes), 1000):
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(
                f"UPDATE actes_legislatifs t SET {affectations}"
                f" FROM jsonb_to_recordset(%s::jsonb) AS v({definition})"
                " WHERE t.uid = v.uid AND t.dossier_uid = v.dossier_uid",
                (Json(lignes[i:i + 1000]),),
            )
            touchees += cur.rowcount
    return touchees


def download_zip(url: str) -> zipfile.ZipFile:
    print(f"Téléchargement du ZIP depuis : {url}")
    response = requests.get(url)
    response.raise_for_status()
    return zipfile.ZipFile(io.BytesIO(response.content))


# Plus de client propre à ce script : les lectures passent par `_db` (connexion directe)
# et les écritures par `_sync_cache` (`upsert_si_change`), qui lisent leurs variables.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ==================== PARSING ====================

def parser_acte(acte_data, dossier_uid, parent_uid=None):
    """Parse un acte et retourne liste de payloads (récursif pour enfants)."""
    payloads = []
    try:
        uid = acte_data.get("uid")
        code_acte = acte_data.get("codeActe")
        type_acte = acte_data.get("@xsi:type")
        organe_ref = acte_data.get("organeRef")
        libelle_acte = (acte_data.get("libelleActe") or {}).get("nomCanonique")

        # Nettoyage date ISO
        date_acte_raw = acte_data.get("dateActe")
        date_acte = None
        if date_acte_raw:
            try:
                cleaned = date_acte_raw.replace("Z", "+00:00")
                if "+" in cleaned:
                    cleaned = cleaned.split("+")[0] + "+00:00"
                date_acte = datetime.fromisoformat(cleaned).isoformat()
            except ValueError:
                date_acte = date_acte_raw

        statut_conclusion = (acte_data.get("statutConclusion") or acte_data.get("decision") or {}).get("libelle")

        # textes_associes : liste text[] — inclut TAP et BTA, exclut doublons
        try:
            textes_raw = acte_data.get("textesAssocies") or acte_data.get("texteAssocie")
            refs = []
            if textes_raw:
                if isinstance(textes_raw, dict):
                    nested = textes_raw.get("textesAssocies") or textes_raw.get("texteAssocie")
                    if nested:
                        textes_raw = nested
                items = [textes_raw] if not isinstance(textes_raw, list) else textes_raw
                for item in items:
                    if isinstance(item, dict):
                        ref = item.get("refTexteAssocie") or item.get("texteAssocie")
                        if ref:
                            refs.append(ref.strip().replace("»", ""))
                    elif isinstance(item, str):
                        refs.append(item.strip().replace("»", ""))
            textes_associes = refs if refs else None
        except Exception:
            textes_associes = None

        rapporteurs = acte_data.get("rapporteurs") or None
        reunion_ref = acte_data.get("reunionRef")

        # vote_refs : liste text[] — déduplication, conserve tous les votes
        try:
            vote_refs = extraire_vote_refs(acte_data) or None
        except Exception as e:
            # Signalé : ce repli muet a laissé la décision du PLFSS 2027 sans vote
            # pendant des jours (voir ajouter_refs de `_refs_an.py`). Une autre forme
            # inattendue de la source doit se voir dans le journal du cron.
            print(f"Erreur vote_refs pour acte {uid} dans dossier {dossier_uid}: {e}")
            vote_refs = None

        provenance = acte_data.get("provenance")
        texte_adopte = acte_data.get("texteAdopte")
        code_loi = acte_data.get("codeLoi")
        titre_loi = acte_data.get("titreLoi")
        # Fallback : dériver code_loi depuis l'UID texteAdopte (ex. LOI2025989 → 2025-989)
        if not code_loi and texte_adopte:
            m = re.match(r'^LOI(\d{4})(\d+)$', str(texte_adopte))
            if m:
                code_loi = f"{m.group(1)}-{int(m.group(2))}"

        autres_infos = {
            "depotInitialLectureDefinitiveRef": acte_data.get("depotInitialLectureDefinitiveRef"),
            "infoJO": acte_data.get("infoJO"),
            "urlEcheancierLoi": acte_data.get("urlEcheancierLoi"),
        }
        autres_infos = {k: v for k, v in autres_infos.items() if v is not None} or None

        # Champs spécifiques aux décisions CC
        url_conclusion = acte_data.get("urlConclusion")
        num_decision = acte_data.get("numDecision")
        annee_decision = acte_data.get("anneeDecision")

        payloads.append({
            "uid": uid,
            "dossier_uid": dossier_uid,
            "parent_uid": parent_uid,
            "code_acte": code_acte,
            "libelle_acte": libelle_acte,
            "organe_ref": organe_ref,
            "date_acte": date_acte,
            "type_acte": type_acte,
            "statut_conclusion": statut_conclusion,
            "textes_associes": textes_associes,
            "rapporteurs": rapporteurs,
            "reunion_ref": reunion_ref,
            "vote_refs": vote_refs,
            "provenance": provenance,
            "texte_adopte": texte_adopte,
            "code_loi": code_loi,
            "titre_loi": titre_loi,
            "autres_infos": autres_infos,
            "url_conclusion": url_conclusion,
            "num_decision": num_decision,
            "annee_decision": annee_decision,
        })

        # Récursion sur enfants
        actes_legis = acte_data.get("actesLegislatifs")
        if actes_legis:
            enfants_raw = (actes_legis.get("acteLegislatif") or [])
            enfants = [enfants_raw] if not isinstance(enfants_raw, list) else enfants_raw
            for enfant in enfants:
                payloads.extend(parser_acte(enfant, dossier_uid, parent_uid=uid))

    except Exception as e:
        print(f"Erreur pour acte {acte_data.get('uid', 'inconnu')} dans dossier {dossier_uid}: {e}")

    return payloads


def requalifier_cc_non_conforme(payloads: list) -> None:
    """Corrige sur place un « Non conforme » que l'AN pose sur une loi promulguée.

    On recopie tel quel le référentiel AN (TCD01 Conforme, TCD02 Partiellement
    conforme, TCD03 Conforme avec réserve, TCD04 Non conforme). Sur DLR5L17N53187
    (loi n° 2026-813) l'AN a posé TCD04 alors que le Conseil constitutionnel n'a
    censuré que l'article 1er et que la loi a été promulguée le 24/08/2026.
    Un « Non conforme » interdisant la promulgation, la présence d'un acte PROM
    dans le même dossier suffit à prouver que le code est faux : c'est une censure
    partielle. Voir D-103.
    """
    if not any(p.get("code_acte") == "PROM" for p in payloads):
        return
    for p in payloads:
        if p.get("code_acte") == "CC-CONCLUSION" and p.get("statut_conclusion") == "Non conforme":
            p["statut_conclusion"] = "Partiellement conforme"


# Décisions du Conseil constitutionnel que l'Assemblée code mal, et que rien dans le
# dossier ne permet de requalifier (à la différence de `requalifier_cc_non_conforme`).
# Clé : uid de l'acte CC-CONCLUSION ; valeur : libellé du référentiel AN à écrire.
# Chaque ligne se recoupe sur la page de la décision (conseil-constitutionnel.fr).
# - L17-VD233256CCC, décision 2026-910 DC (loi fin de vie, DLR5L17N51670) : codée
#   TCD01 « Conforme », alors que le Conseil la classe « Conformité - réserve » et
#   déclare la loi conforme « sous les réserves énoncées », vérifié le 2026-10-28.
CORRECTIONS_CC = {
    "L17-VD233256CCC": "Conforme avec réserve",
}

# Mêmes règles pour la date, écrite à chaque import comme le statut. Clé : uid de l'acte
# CC-CONCLUSION ; valeur : date de la décision, au format que rend `parser_acte`.
# - L17-VD230654CCC, décision 2026-902 DC (Jeux de 2030, DLR5L17N52100) : datée du 20 mars
#   2026 par l'AN, alors que la décision porte « Rendu public le 19 mars 2026 », vérifié le
#   2026-11-06. Seul écart sur les 43 décisions dont la date a pu être lue (2025-888 non).
CORRECTIONS_DATES_CC = {
    "L17-VD230654CCC": "2026-03-19T00:00:00+00:00",
}


def corriger_cc_manuellement(payloads: list) -> None:
    """Applique `CORRECTIONS_CC` et `CORRECTIONS_DATES_CC` sur place. Appelée par `importer_dossier`."""
    for p in payloads:
        if p.get("code_acte") != "CC-CONCLUSION":
            continue
        if p.get("uid") in CORRECTIONS_CC:
            p["statut_conclusion"] = CORRECTIONS_CC[p["uid"]]
        if p.get("uid") in CORRECTIONS_DATES_CC:
            p["date_acte"] = CORRECTIONS_DATES_CC[p["uid"]]


def importer_dossier(texte_data, file_name):
    """Parse un JSON dossier et extrait actes législatifs récursivement."""
    try:
        data = texte_data["dossierParlementaire"]
        dossier_uid = data.get("uid")
        # `actesLegislatifs` vaut null pour un dossier ouvert dont aucun acte n'est
        # encore publié (constaté sur DLR5L17N54629, le projet de loi de finances pour
        # 2027). Sans le `or {}`, l'exception partait dans le `except` ci-dessous, qui
        # rend une liste vide sans rien compter : le dossier s'affichait sur le site
        # avec zéro acte législatif, et rien ne le signalait. Même correction qu'à
        # `import_dossiers_cloud.py`, et même forme qu'à la ligne 709 plus bas.
        actes_root = (data.get("actesLegislatifs") or {}).get("acteLegislatif") or []
        actes_root = [actes_root] if not isinstance(actes_root, list) else actes_root
        payloads = []
        for acte in actes_root:
            payloads.extend(parser_acte(acte, dossier_uid))
        requalifier_cc_non_conforme(payloads)
        corriger_cc_manuellement(payloads)
        return payloads
    except Exception as e:
        print(f"Erreur générale pour {file_name}: {e}")
        return []


# ==================== ÉCRITURE DES ACTES ====================

# Colonnes qu'un autre geste de la nuit remplit sur un acte que la source laisse vide :
# `vote_refs` (enrichissement par séance, `enrichir_vote_refs_via_reunion_ref`),
# `textes_associes` (`lier_textes_prom_pub`), et les trois champs d'une décision du Conseil
# constitutionnel (`backfill_cc_url_conclusion`). Une valeur nulle dans la source ne doit
# donc pas être comparée à celle de la base : sans cela, chaque acte enrichi paraîtrait
# modifié, serait réécrit à NULL puis ré-enrichi, chaque nuit. L'ancien cache d'empreintes
# évitait cela en n'envoyant pas du tout un acte dont la source n'avait pas bougé.
# Non nulle dans la source, la colonne reste comparée : l'AN qui publie un vote sur un acte
# est vu et écrit.
COLONNES_ENRICHIES = ("vote_refs", "textes_associes", "url_conclusion", "num_decision", "annee_decision")


def ecrire_actes(payloads: list) -> tuple[int, list[dict]]:
    """Envoie `payloads` à la base, qui n'écrit que les actes nouveaux ou modifiés, et
    rend `(actes écrits, actes perdus)`.

    Les actes partent par groupes selon celles de `COLONNES_ENRICHIES` que la source leur
    laisse vides, chaque groupe comparant les autres colonnes. Le découpage en lots d'environ
    1 Mo, l'isolement d'une ligne fautive et la reprise sur panne passagère sont ceux de
    `upsert_si_change`.
    """
    groupes: dict[tuple[str, ...], list[dict]] = {}
    for p in payloads:
        vides = tuple(c for c in COLONNES_ENRICHIES if p.get(c) is None)
        groupes.setdefault(vides, []).append(p)
    ecrites = 0
    perdus: list[dict] = []
    for vides, groupe in groupes.items():
        e, perdues = upsert_si_change(
            "actes_legislatifs", groupe, "uid,dossier_uid", sans_comparer=vides, journal=tqdm.write
        )
        ecrites += e
        perdus.extend(perdues)
    return ecrites, perdus


# ==================== IMPORT PRINCIPAL ====================

def importer_actes_from_zip(zip_ref: zipfile.ZipFile) -> int:
    """Importe les actes législatifs du ZIP.

    Retourne le nombre d'actes perdus en écriture, que l'appelant transforme en code de
    sortie. Les échecs de parsing, eux, ne sont pas comptés ici : `parser_acte` se
    contente d'un message.
    """
    # Filtre DLR directement à la construction de la liste
    json_files = [
        f for f in zip_ref.namelist()
        if f.startswith("json/dossierParlementaire/")
        and f.endswith(".json")
        and f.split("/")[-1].startswith("DLR")
    ]
    print(f"\n{len(json_files)} fichiers dossiers DLR trouvés dans le ZIP\n")

    all_payloads = []
    texte_refs: dict = {}
    organe_refs: set = set()

    # 1. Lecture + parsing (une seule passe)
    for file_name in tqdm(json_files, desc="Lecture & parsing", unit="fichier"):
        with zip_ref.open(file_name) as f:
            dossier_data = json.load(f)

        payloads = importer_dossier(dossier_data, file_name)
        if not payloads:
            continue

        # Déduplication par uid dans le dossier
        unique_payloads = {p["uid"]: p for p in payloads if p.get("uid")}
        payloads = list(unique_payloads.values())
        all_payloads.extend(payloads)

        # Collecte des dépendances pour batch insert
        dossier_uid = payloads[0]["dossier_uid"] if payloads else None
        for p in payloads:
            for t in (p.get("textes_associes") or []):
                if t not in texte_refs:
                    texte_refs[t] = dossier_uid
            if p.get("texte_adopte"):
                t = p["texte_adopte"]
                if t not in texte_refs:
                    texte_refs[t] = dossier_uid
            if p.get("organe_ref"):
                organe_refs.add(p["organe_ref"])
            if p.get("provenance"):
                organe_refs.add(p["provenance"])

    print(f"\nTotal actes à importer : {len(all_payloads)}")
    print(f"Textes uniques référencés : {len(texte_refs)}")
    print(f"Organes uniques référencés : {len(organe_refs)}")

    # 2. Insertion batch des dépendances
    batch_insert_textes(texte_refs)
    batch_insert_organes(organe_refs)

    # 2bis. Références de vote déjà réparées dans ce qu'on envoie. Sinon un acte dont la
    # source écrit `VTSNR` sur un scrutin de l'Assemblée serait réécrit chaque nuit avec
    # sa référence fautive, puis réparé aussitôt par `reparer_refs_orphelines` : une
    # écriture et un état faux passager pour rien (l'ancien cache d'empreintes n'envoyait
    # pas cet acte, la source n'ayant pas bougé).
    with connexion(autocommit=True) as conn:
        scrutins_connus = {r["uid"] for r in lire(conn, "select uid from scrutins")}
    for p in all_payloads:
        if p.get("vote_refs"):
            p["vote_refs"] = refs_reparees(p["vote_refs"], scrutins_connus)

    # 3. Écriture des actes : tous partent, la base écarte ceux qui n'ont pas changé
    ecrites, perdus = ecrire_actes(all_payloads)
    failed = len(perdus)

    print(f"\n{'='*60}")
    print(f"IMPORT ACTES TERMINÉ")
    print(f" Écrits (nouveaux ou modifiés) : {ecrites} actes")
    print(f" Inchangés                     : {len(all_payloads) - ecrites - failed} actes")
    print(f" Échecs                        : {failed} actes")
    print(f"{'='*60}")

    return failed


# ==================== ENRICHISSEMENT vote_refs via reunion_ref ====================

# Motifs de titre d'une motion de procédure (rejet préalable, renvoi en commission).
# Adoptée, c'est un vote final : le texte est écarté sans être examiné. Mais son titre
# cite le texte en entier, donc elle marque exactement le même score que le vote sur
# l'ensemble du même texte : d'où le besoin de la distinguer au départage, voir
# est_motion_procedure().
MOTION_PROCEDURE_PATTERNS = [
    "motion de rejet",
    "motion de renvoi",
]

# Motifs de titre qui identifient un vote final (et non un vote d'amendement)
DECISION_TITRE_PATTERNS = [
    "l'ensemble",
    "l'article unique",
    "commission mixte paritaire",
    *MOTION_PROCEDURE_PATTERNS,
]

# Débuts de titre d'un vote sur le texte entier quand l'AN omet « l'ensemble » : au
# 2026-10-23, 3 scrutins de la 17ᵉ (V6284, V8705, V8706) contre 219 en « l'ensemble », et la
# source n'avait donné le numéro de scrutin dans l'acte que pour le premier. Une
# résolution est aussi un vote final (D-118), et 13 de ses scrutins s'intitulent ainsi.
# Comparé au début du titre seulement : un amendement ou un article cite aussi ces
# mots, mais plus loin (« l'amendement n° 1 … de la proposition de loi … »).
DECISION_TITRE_DEBUTS = (
    "la proposition de loi",
    "le projet de loi",
    "la proposition de résolution",
)

# Libellés d'actes auxquels on veut relier des scrutins
DECISION_LIBELLES = [
    "Décision",
    "Décision de la CMP",
    "Conclusion du conseil constitutionnel",
]

# Préfixes de référence de scrutin. La source AN écrit parfois `VTSNR` (préfixe Sénat)
# sur un numéro de scrutin AN : la référence ne résout alors rien.
PREFIXE_REF_SENAT = "VTSNR"
PREFIXE_REF_AN = "VTANR"


_STOPWORDS = {
    "le", "la", "les", "de", "du", "des", "un", "une", "au", "aux",
    "en", "sur", "par", "pour", "et", "ou", "à", "l", "d", "que",
    "qui", "dans", "avec", "ce", "se", "est", "son", "sa", "ses",
    "sur", "une", "dont", "cette", "leur", "leurs", "tout", "plus",
}


# Débuts de titre d'un vote sur un amendement, écarté même quand il cite un motif de vote
# final : « l'amendement n° 25 … à l'article unique de la proposition… » laissait 17
# candidats ex aequo dans la séance de la résolution sur Boualem Sansal (acte
# L17-VD225561DEC), dont le vrai vote, V1570, n'était jamais relié. Au 2026-10-29,
# 247 scrutins en « l'amendement » et 46 en « le sous-amendement » passaient pour des
# votes finaux.
AMENDEMENT_TITRE_DEBUTS = (
    "l'amendement",
    "le sous-amendement",
)


def est_vote_decision(titre: str | None) -> bool:
    """Retourne True si le titre du scrutin correspond à un vote final (pas un amendement)."""
    if not titre:
        return False
    # Apostrophe courbe ramenée à la droite des motifs : l'AN écrit parfois
    # « l’ensemble », et 9 votes finaux de la 17ᵉ n'étaient pas reconnus (V2107, au
    # 2026-10-23). V3018, qui l'est désormais, reste refusé à la ratification
    # DLR5L17N51352 par l'étape 4bis, puisque DLR5L17N50692 le porte déjà (D-286).
    t = titre.lower().replace("’", "'")
    if t.startswith(AMENDEMENT_TITRE_DEBUTS):
        return False
    return any(p in t for p in DECISION_TITRE_PATTERNS) or t.startswith(DECISION_TITRE_DEBUTS)


def est_motion_procedure(titre: str | None) -> bool:
    """Retourne True si le scrutin porte sur une motion de rejet ou de renvoi."""
    if not titre:
        return False
    t = titre.lower()
    return any(p in t for p in MOTION_PROCEDURE_PATTERNS)


def _tokenize(text: str) -> set[str]:
    """Extrait les mots significatifs d'un texte (≥4 chars, hors stopwords)."""
    mots = re.findall(r"[a-zàâäéèêëîïôùûüçœ]+", text.lower())
    return {m for m in mots if len(m) >= 4 and m not in _STOPWORDS}


def _score(titre_scrutin: str, titre_ref: str) -> int:
    """Nombre de tokens communs entre deux titres."""
    return len(_tokenize(titre_scrutin) & _tokenize(titre_ref))


def refs_reparees(refs: list[str], scrutins_connus: set[str]) -> list[str]:
    """Les `refs` d'un acte, avec le préfixe `VTSNR` réécrit en `VTANR` partout où la
    référence ne résout aucun scrutin et où son jumeau `VTANR` existe. Trié et
    dédoublonné, comme à l'import (`extraire_vote_refs`) : la réparation peut rejoindre une
    référence `VTANR` déjà présente sur l'acte. Appelée par `reparer_refs_orphelines` et
    par `importer_actes_from_zip`."""
    return sorted({
        PREFIXE_REF_AN + r[len(PREFIXE_REF_SENAT):]
        if r not in scrutins_connus
        and r.startswith(PREFIXE_REF_SENAT)
        and PREFIXE_REF_AN + r[len(PREFIXE_REF_SENAT):] in scrutins_connus
        else r
        for r in refs
    })


def reparer_refs_orphelines(conn, scrutins_connus: set[str]) -> None:
    """Corrige les vote_refs qui ne résolvent aucun scrutin, quand un jumeau existe.

    La source AN écrit parfois le préfixe Sénat `VTSNR` sur un numéro de scrutin AN.
    La référence ne pointe alors sur rien, le vote final sort du dénominateur de
    participation, et rien ne le signale. Le jumeau `VTANR` de même numéro existe et
    porte bien le titre du texte du dossier : on réécrit le préfixe.

    Chaque référence orpheline est réparée, même au milieu de références valides : un
    acte mixte perdait sinon en silence le vote mal préfixé (aucun cas au 2026-10-29).
    Le jumeau exigé protège les vraies références Sénat, de forme `VTSNR2023V1`, dont le
    jumeau `VTANR2023V1` n'existe pas. Les références L15/L16 sont elles aussi absentes
    de `scrutins` (l'archive commence à la 17ᵉ législature) mais n'ont pas de jumeau :
    elles restent intactes.

    L'import des actes applique déjà cette réparation avant d'écrire (voir
    `importer_actes_from_zip`) : ce passage rattrape les actes que la source ne ré-émet
    pas, et les scrutins arrivés depuis.

    Appelé par enrichir_vote_refs_via_reunion_ref().
    """
    actes = lire(
        conn,
        "select uid, dossier_uid, vote_refs from actes_legislatifs"
        " where vote_refs is not null order by uid, dossier_uid",
    )

    updates = []
    for a in actes:
        refs = a.get("vote_refs") or []
        reparees = refs_reparees(refs, scrutins_connus)
        if reparees != sorted(set(refs)):
            updates.append({"uid": a["uid"], "dossier_uid": a["dossier_uid"], "vote_refs": reparees})

    mettre_a_jour_actes(conn, {"vote_refs": "text[]"}, updates)

    print(f"  {len(updates)} actes dont les vote_refs orphelines ont été repréfixées {PREFIXE_REF_SENAT} → {PREFIXE_REF_AN}")


def enrichir_vote_refs_via_reunion_ref(conn):
    """Pour les actes DECISION sans vote_refs, peuple vote_refs via seance_ref = reunion_ref.
    - Séance avec 1 seul vote final → lien direct
    - Séance ambiguë (N votes finaux) → comparaison de titres pour trouver le bon scrutin
    - Un vote ne va jamais à un dossier quand un autre dossier le porte déjà, ni quand
      plusieurs dossiers le recevraient dans la même passe (voir l'étape 4bis)

    Répare d'abord les références qui ne résolvent aucun scrutin (voir
    reparer_refs_orphelines) : elles se comportent comme une absence de référence."""
    print("\nEnrichissement vote_refs via reunion_ref (votes finaux uniquement)...")

    # 1. Charge tous les scrutins avec seance_ref + titre
    scrutins_data = lire(conn, "select uid, seance_ref, titre from scrutins order by uid")
    # Carte uid → titre pour la comparaison
    scrutin_titre_map: dict[str, str] = {s["uid"]: (s.get("titre") or "") for s in scrutins_data}
    scrutins_connus: set[str] = set(scrutin_titre_map)

    # Carte seance → liste des uids de votes finaux
    scrutin_by_seance: dict[str, list[str]] = {}
    for s in scrutins_data:
        if s.get("seance_ref") and est_vote_decision(s.get("titre")):
            scrutin_by_seance.setdefault(s["seance_ref"], []).append(s["uid"])

    seances_uniques = {k for k, v in scrutin_by_seance.items() if len(v) == 1}
    seances_ambigues = {k: v for k, v in scrutin_by_seance.items() if len(v) > 1}
    print(f"  {len(scrutins_data)} scrutins chargés, {len(seances_uniques)} séances claires, {len(seances_ambigues)} ambiguës")

    # 1bis. Répare les références orphelines avant de chercher les actes sans référence
    reparer_refs_orphelines(conn, scrutins_connus)

    # 2. Charge les actes DECISION sans vote_refs (la clé primaire (uid, dossier_uid)
    #    ferme le tri : l'ordre des ex aequo ne dépend pas du plan d'exécution)
    actes_data = lire(
        conn,
        "select uid, dossier_uid, reunion_ref from actes_legislatifs"
        " where reunion_ref is not null and vote_refs is null and dossier_uid is not null"
        " and libelle_acte = ANY(%s) order by uid, dossier_uid",
        (DECISION_LIBELLES,),
    )
    print(f"  {len(actes_data)} actes DECISION sans vote_refs avec reunion_ref")

    # 3. Charge les titres des dossiers pour les actes en séance ambiguë
    dossiers_uids_ambigus = list({
        a["dossier_uid"] for a in actes_data
        if a["reunion_ref"] in seances_ambigues
    })
    dossier_titre_map: dict[str, str] = {}
    if dossiers_uids_ambigus:
        for d in lire(
            conn, "select uid, titre from dossiers_legislatifs where uid = ANY(%s)", (dossiers_uids_ambigus,)
        ):
            if d.get("titre"):
                dossier_titre_map[d["uid"]] = d["titre"]
    print(f"  {len(dossier_titre_map)} titres de dossiers chargés pour résolution des ambiguïtés")

    # 4. Construit les updates
    updates = []
    non_resolus = 0
    for a in actes_data:
        refs = scrutin_by_seance.get(a["reunion_ref"])
        if not refs:
            continue

        if len(refs) == 1:
            # Séance claire : lien direct
            updates.append({"uid": a["uid"], "dossier_uid": a["dossier_uid"], "vote_refs": refs})
            continue

        # Séance ambiguë : comparaison par titre
        titre_dossier = dossier_titre_map.get(a["dossier_uid"], "")
        if not titre_dossier:
            non_resolus += 1
            continue

        scores = [(ref, _score(scrutin_titre_map.get(ref, ""), titre_dossier)) for ref in refs]
        best_score = max(sc for _, sc in scores)
        ex_aequo = [ref for ref, sc in scores if sc == best_score]

        # Départage des ex aequo. Une motion de procédure cite le titre entier du texte
        # qu'elle rejette : elle marque donc exactement le même score que le vote sur
        # l'ensemble du même texte, et la règle « un seul en tête » les refusait tous les
        # deux (cas VTANR5L17V2957, séance du 2025-07-08). À égalité, c'est le vote sur
        # l'ensemble qui l'emporte, puisque c'est lui qui tranche le sort du texte.
        #
        # Ne jamais écarter une motion avant de compter les points : quand elle gagne
        # seule, elle EST le vote final du dossier, et le filtrer décrochait les motions
        # adoptées (trois perdues le 2026-09-01 en l'écartant en amont, dont celles des
        # séances 29497 et 29538, où le seul autre candidat portait sur un autre texte).
        if len(ex_aequo) > 1:
            hors_motion = [r for r in ex_aequo if not est_motion_procedure(scrutin_titre_map.get(r))]
            if len(hors_motion) == 1:
                ex_aequo = hors_motion

        # Match retenu si score ≥ 3 mots en commun ET un seul candidat en tête
        if best_score >= 3 and len(ex_aequo) == 1:
            updates.append({"uid": a["uid"], "dossier_uid": a["dossier_uid"], "vote_refs": [ex_aequo[0]]})
        else:
            non_resolus += 1

    # 4bis. Un vote, un seul dossier. Un texte adopté à main levée n'a pas de scrutin : le
    # seul vote final de sa séance appartient alors à un autre texte, et la règle « séance
    # claire » le lui donnait quand même. Mesuré le 2026-10-26 : 12 liens faux sur 54
    # ajoutés ici, dont V805, déjà cité par l'AN dans DLR5L17N50690 et donné en plus à
    # deux dossiers de la 16ᵉ, et V1333, donné à trois ratifications d'une même séance.
    # On compte des dossiers au lieu de comparer des intitulés : un texte renommé en
    # commission garde un vote juste sous un titre différent (V2283, DLR5L17N51423).
    # Revers assumé : quand plusieurs textes de la séance attendent tous le même vote,
    # aucun ne le reçoit, un vote absent valant mieux qu'un vote faux.
    porteurs = lire(
        conn,
        "select dossier_uid, vote_refs from actes_legislatifs"
        " where vote_refs is not null and libelle_acte = ANY(%s) order by uid, dossier_uid",
        (DECISION_LIBELLES,),
    )
    dossiers_par_vote: dict[str, set[str]] = {}
    for a in porteurs:
        for ref in a.get("vote_refs") or []:
            dossiers_par_vote.setdefault(ref, set()).add(a["dossier_uid"])
    # Chaque update ne porte qu'un vote : les deux branches ci-dessus n'en retiennent qu'un.
    recu_par: dict[str, set[str]] = {}
    for upd in updates:
        recu_par.setdefault(upd["vote_refs"][0], set()).add(upd["dossier_uid"])
    retenus = [
        upd for upd in updates
        if not (dossiers_par_vote.get(upd["vote_refs"][0], set()) - {upd["dossier_uid"]})
        and len(recu_par[upd["vote_refs"][0]]) == 1
    ]
    refuses = len(updates) - len(retenus)
    updates = retenus

    print(
        f"  {len(updates)} actes enrichissables, {non_resolus} non résolus (ambiguïté persistante), "
        f"{refuses} refusés : vote déjà rattaché ailleurs ou disputé dans la passe"
    )

    # 5. Update
    if updates:
        mettre_a_jour_actes(conn, {"vote_refs": "text[]"}, updates)
        print(f"✅ {len(updates)} actes enrichis avec vote_refs via reunion_ref")
    else:
        print("  Aucun acte à enrichir")


# ==================== VOTE DES MOTIONS DE CENSURE SANS ACTE SOURCE ====================


def reconstituer_votes_motions_censure(conn) -> int:
    """Crée l'acte `AN21-MOTION-VOTE` qu'une motion de censure n'a pas dans la source.

    La source AN omet parfois cet acte alors que le scrutin est en base (voir
    `_motions_censure.py`). Sans lui, le vote n'apparaît ni dans le parcours du dossier
    (l'étape `MOTION` du front ne naît que d'un acte `-MOTION-VOTE`, D-110), ni dans le fil
    du mois, ni parmi les votes finaux qui servent au taux de participation.

    L'acte reproduit la forme d'un acte source : enfant de l'acte de dépôt de la motion,
    daté du scrutin, même libellé, conclusion tirée du sort du scrutin. Il est réécrit
    chaque nuit (la base ne l'écrit que s'il a changé), et supprimé dès que la source publie son propre acte de vote ou que le
    rapprochement cesse d'être sûr : `import_dossiers_cloud.py` applique la même règle
    au statut du dossier, les deux restent donc d'accord.

    Travaille sur la base et non sur le ZIP, comme les autres enrichissements : les
    scrutins sont importés après ce script dans le nocturne, donc le vote d'une motion
    n'est visible ici que la nuit suivante, ZIP modifié ou non.

    Rend le nombre d'actes qui n'ont pas pu être écrits (le script sort alors en échec).
    """
    print("\nVotes des motions de censure absents de la source...")

    scrutins_moc = lire(
        conn,
        "select uid, seance_ref, titre, sort_code, date_scrutin from scrutins"
        " where type_vote_code = 'MOC' order by uid",
    )
    depots = lire(
        conn,
        "select uid, dossier_uid, organe_ref from actes_legislatifs"
        " where code_acte = %s order by uid, dossier_uid",
        (CODE_DEPOT_MOTION,),
    )
    dossier_uids = sorted({d["dossier_uid"] for d in depots})

    actes_par_dossier: dict[str, list[dict]] = {}
    titre_par_dossier: dict[str, str] = {}
    if dossier_uids:
        for a in lire(
            conn,
            "select uid, dossier_uid, code_acte, reunion_ref from actes_legislatifs"
            " where dossier_uid = ANY(%s) order by uid, dossier_uid",
            (dossier_uids,),
        ):
            actes_par_dossier.setdefault(a["dossier_uid"], []).append(a)
        for d in lire(conn, "select uid, titre from dossiers_legislatifs where uid = ANY(%s)", (dossier_uids,)):
            titre_par_dossier[d["uid"]] = d.get("titre") or ""

    depot_par_dossier = {d["dossier_uid"]: d for d in depots}
    a_ecrire: list[dict] = []
    a_supprimer: list[dict] = []
    for dossier_uid in dossier_uids:
        actes = actes_par_dossier.get(dossier_uid, [])
        reconstitues = [a for a in actes if a["uid"].endswith(SUFFIXE_UID_VOTE_RECONSTITUE)]
        codes_source = [
            a["code_acte"] for a in actes if not a["uid"].endswith(SUFFIXE_UID_VOTE_RECONSTITUE)
        ]
        seances = {a["reunion_ref"] for a in actes if a.get("reunion_ref")}

        scrutin = None
        if est_motion_sans_vote(codes_source):
            scrutin = trouver_scrutin_motion(titre_par_dossier.get(dossier_uid), seances, scrutins_moc)
        adoptee = motion_adoptee(scrutin) if scrutin else None

        # `est_motion_sans_vote` garantit un seul acte de dépôt : celui de la table est le bon.
        depot = depot_par_dossier[dossier_uid]
        uid_vote = depot["uid"] + SUFFIXE_UID_VOTE_RECONSTITUE
        a_supprimer.extend(a for a in reconstitues if adoptee is None or a["uid"] != uid_vote)
        if adoptee is None:
            continue
        a_ecrire.append({
            "uid": uid_vote,
            "dossier_uid": dossier_uid,
            "parent_uid": depot["uid"],
            "code_acte": "AN21-MOTION-VOTE",
            "libelle_acte": "Décision sur une motion de censure",
            "organe_ref": depot.get("organe_ref"),
            "date_acte": scrutin.get("date_scrutin"),
            "type_acte": "DecisionMotionCensure_Type",
            "statut_conclusion": "Motion adoptée" if adoptee else "Motion rejetée",
            "vote_refs": [scrutin["uid"]],
        })

    if a_supprimer:
        # Une seule suppression pour tous les couples, dépliés côté base.
        conn.execute(
            "DELETE FROM actes_legislatifs t"
            " USING unnest(%s::text[], %s::text[]) AS v(uid, dossier_uid)"
            " WHERE t.uid = v.uid AND t.dossier_uid = v.dossier_uid",
            ([a["uid"] for a in a_supprimer], [a["dossier_uid"] for a in a_supprimer]),
        )
    perdus: list[dict] = []
    if a_ecrire:
        _, perdus = upsert_si_change("actes_legislatifs", a_ecrire, "uid,dossier_uid", journal=tqdm.write)

    print(f"  {len(depots)} dépôts de motion, {len(a_ecrire)} votes reconstitués, {len(a_supprimer)} reconstitutions retirées")
    return len(perdus)


# ==================== LIAISON TEXTES → ACTES PROM-PUB ====================

def lier_textes_prom_pub(conn):
    """Lie les textes PROMULGUE aux actes PROM-PUB et DECAPP-PUB via textes_associes.

    Seuls les actes dont `textes_associes` est encore nul sont concernés, et il n'y en a
    presque jamais : on les lit d'abord, puis on n'écrit que ceux-là. L'ancienne version
    envoyait deux UPDATE par texte promulgué (296 requêtes, environ 55 s) qui, dès le
    deuxième passage, ne touchaient plus aucune ligne.
    Appelé après l'import des actes (les textes sont déjà en base à ce stade).
    """
    print(f"\n{'='*60}")
    print(f"   LIAISON TEXTES → ACTES PROM-PUB + DECAPP-PUB")
    print(f"{'='*60}")

    actes_sans_texte = lire(
        conn,
        "select uid, code_acte, dossier_uid from actes_legislatifs"
        " where code_acte = ANY(%s) and textes_associes is null order by uid, dossier_uid",
        (["PROM-PUB", "DECAPP-PUB"],),
    )
    if not actes_sans_texte:
        print("   ✓ Aucun acte à lier.")
        print(f"{'='*60}")
        return

    textes_prom = lire(
        conn,
        "select uid, dossier_ref from textes"
        " where statut_adoption = 'PROMULGUE' and dossier_ref is not null order by uid",
    )
    # Un texte par dossier, le premier par uid : un choix stable quand un dossier en
    # porte deux (l'ancienne boucle prenait le premier dans l'ordre, non garanti, de
    # la base).
    texte_par_dossier: dict[str, str] = {}
    nb_skip = 0
    for t in textes_prom:
        if not t.get("dossier_ref") or not t.get("uid"):
            nb_skip += 1
            continue
        texte_par_dossier.setdefault(t["dossier_ref"], t["uid"])

    nb_ok = 0
    nb_decapp_ok = 0
    liaisons: list[dict] = []
    for acte in actes_sans_texte:
        texte_uid = texte_par_dossier.get(acte["dossier_uid"])
        if not texte_uid:
            continue
        # Repéré par (uid, dossier_uid) : un décret d'application qui applique plusieurs lois
        # a le même uid dans chacun de leurs dossiers (8 uid dans ce cas au 2026-11-05), et
        # l'ancien filtre sur l'uid seul donnait à toutes ces lignes le texte de la dernière.
        liaisons.append({"uid": acte["uid"], "dossier_uid": acte["dossier_uid"], "textes_associes": [texte_uid]})
        if acte["code_acte"] == "PROM-PUB":
            nb_ok += 1
        else:
            nb_decapp_ok += 1
    mettre_a_jour_actes(conn, {"textes_associes": "text[]"}, liaisons)

    print(f"   ✅ {nb_ok} actes PROM-PUB liés à leur texte PROMULGUE")
    print(f"   ✅ {nb_decapp_ok} actes DECAPP-PUB liés à leur texte PROMULGUE")
    if nb_skip:
        print(f"   ⚠️  {nb_skip} textes ignorés (dossier_ref ou uid manquant)")
    print(f"{'='*60}")


# ==================== BACKFILL CC DÉCISIONS ====================

def _trouver_acte_par_uid(actes_raw, target_uid: str) -> dict | None:
    """Cherche récursivement un acte par uid dans la structure JSON AN."""
    items = [actes_raw] if not isinstance(actes_raw, list) else actes_raw
    for acte in items:
        if not isinstance(acte, dict):
            continue
        if acte.get("uid") == target_uid:
            return acte
        enfants_raw = (acte.get("actesLegislatifs") or {}).get("acteLegislatif")
        if enfants_raw:
            found = _trouver_acte_par_uid(enfants_raw, target_uid)
            if found:
                return found
    return None


def backfill_cc_url_conclusion(conn):
    """Peuple url_conclusion/num_decision/annee_decision sur les actes CC-CONCLUSION existants.

    Lit les données depuis le JSON dossier stocké dans dossiers_legislatifs.actes_legislatifs
    pour éviter de retélécharger le ZIP entier.
    """
    print(f"\n{'='*60}")
    print("   BACKFILL CC — url_conclusion / num_decision / annee_decision")
    print(f"{'='*60}")

    # 1. Tous les actes CC-CONCLUSION sans url_conclusion
    actes_cc = lire(
        conn,
        "select uid, dossier_uid from actes_legislatifs"
        " where code_acte = 'CC-CONCLUSION' and url_conclusion is null",
    )
    print(f"  {len(actes_cc)} actes CC-CONCLUSION à enrichir")
    if not actes_cc:
        return

    # 2. Charge les dossiers concernés (colonne actes_legislatifs = JSON AN brut)
    dossier_uids = list({a["dossier_uid"] for a in actes_cc if a.get("dossier_uid")})
    dossier_json_map: dict[str, list] = {}
    for row in lire(
        conn, "select uid, actes_legislatifs from dossiers_legislatifs where uid = ANY(%s)", (dossier_uids,)
    ):
        actes_raw = row.get("actes_legislatifs")
        if actes_raw:
            dossier_json_map[row["uid"]] = actes_raw

    # 3. Pour chaque acte CC-CONCLUSION, trouve ses champs dans le JSON dossier
    updates = []
    for a in actes_cc:
        dossier_uid = a.get("dossier_uid")
        actes_raw = dossier_json_map.get(dossier_uid)
        if not actes_raw:
            continue
        acte_json = _trouver_acte_par_uid(actes_raw, a["uid"])
        if not acte_json:
            continue
        url = acte_json.get("urlConclusion")
        num = acte_json.get("numDecision")
        annee = acte_json.get("anneeDecision")
        if url or num or annee:
            updates.append({
                "uid": a["uid"],
                "dossier_uid": dossier_uid,
                "url_conclusion": url,
                "num_decision": num,
                "annee_decision": annee,
            })

    print(f"  {len(updates)} actes avec données CC trouvées dans le JSON dossier")

    # 4. Update
    mettre_a_jour_actes(
        conn,
        {"url_conclusion": "text", "num_decision": "text", "annee_decision": "text"},
        updates,
    )

    print(f"  ✅ {len(updates)} actes CC enrichis")
    print(f"{'='*60}")


# ==================== EXÉCUTION ====================

if __name__ == "__main__":
    URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip"
    # Initialisés avant le `try` : un ZIP inchangé laisserait sinon les variables
    # indéfinies au moment des tests plus bas.
    echecs_ecriture = 0
    zip_traite = False
    try:
        zip_ref = download_zip_if_modified(URL, label="actes")
        echecs_ecriture = importer_actes_from_zip(zip_ref)
        zip_traite = True
    except NotModified:
        print("ZIP actes inchangé depuis le dernier import — parsing ignoré.")

    # Les étapes ci-dessous sont des enrichissements sur la base existante
    # (aucun ZIP impliqué), donc elles tournent de toute façon. Autocommit : chaque
    # écriture est validée seule, et aucune lecture ne laisse de transaction ouverte.
    with connexion(autocommit=True) as conn:
        enrichir_vote_refs_via_reunion_ref(conn)
        echecs_ecriture += reconstituer_votes_motions_censure(conn)
        lier_textes_prom_pub(conn)
        backfill_cc_url_conclusion(conn)
    print("\nTout est terminé !")

    # Décision différée jusqu'ici pour que les trois enrichissements ci-dessus aient
    # leur passage : ils ne dépendent pas du ZIP.
    #
    # Ce compte ne porte que les pertes en écriture, donc du passager : bloquer est la
    # bonne réponse. Les échecs de parsing, eux, ne sont comptés nulle part dans ce
    # script — `parser_acte` et `importer_dossier` se contentent d'un message. C'est un
    # trou connu, non traité ici pour ne pas mélanger deux chantiers.
    if echecs_ecriture:
        print(f"❌ {echecs_ecriture} acte(s) perdus en écriture.")
        sys.exit(1)

    if zip_traite:
        confirmer_import(URL, label="actes")
