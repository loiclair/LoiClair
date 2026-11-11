# sync_senat.py
# Synchronise les données du Sénat avec la base.
# Télécharge le dump open data Sénat, le charge en SQLite,
# puis corrige/enrichit les données en base.
#
# Exécuter avec : python sync_senat.py
#
# Étapes actuelles :
#   1. Compléter les lien_senat manquants sur dossiers_legislatifs
#   2. Corriger les URLs des textes Sénat en 404
#   3. Importer les scrutins Sénat (votes finaux), et recréer l'acte de décision que
#      l'Assemblée ne publie pas pour certains d'entre eux
#   4. Calculer les stats agrégées des sénateurs et de leurs groupes
#   5. Enrichir les coordonnées des sénateurs (siège, email, réseaux)
#   6. Importer les présences en commission Sénat
#   7. Créer les dossiers de loi du Sénat de 2023-2024 absents de l'Assemblée
#   8. Importer les cosignataires des textes Sénat
#   9. Importer les mandats internes des sénateurs (commissions, groupes, OEP)
#  10. Importer les rapports de contrôle du Sénat
#  11. Importer les avis et rapports législatifs du Sénat
#  12. Importer les propositions de résolution du Sénat
#
# Extensible : ajouter des fonctions à STEPS pour enrichir davantage.
# Note : la migration PDF→HTML (ancienne étape 2) a été retirée — import_textes_cloud.py
# génère directement du HTML, et le stock de PDFs en base est vide depuis mai 2026.

import argparse
import io
import os
import re
import sqlite3
import sys
import time
import traceback
import unicodedata
import zipfile
from datetime import date

import psycopg
import requests
from dotenv import load_dotenv
from pathlib import Path
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire, mettre_a_jour, mettre_a_jour_par_colonnes  # noqa: E402
from _signets import charger_signets, dossier_du_signet  # noqa: E402
from _colonnes_senat import COLONNES_COORDONNEES_SENAT  # noqa: E402
from _alertes import signaler_anomalie  # noqa: E402
from _statuts import verifier_statuts  # noqa: E402
from _refs_an import SUFFIXE_UID_VOTE_RECONSTITUE  # noqa: E402
from _sync_cache import upsert_si_change  # noqa: E402
from _telechargement import telecharger  # noqa: E402
from _votes_amendements import est_vote_sur_amendement, relier_votes  # noqa: E402
# Règle de position des groupes commune aux deux chambres, et groupe d'un sénateur au
# jour d'un vote : fonctions pures, contrôlables sans base.
from _positions_groupe import (  # noqa: E402
    CODES_SENAT_SANS_GROUPE,
    GROUPES_SENAT_VERS_ORGANE,
    groupe_au_depot,
    groupe_au_jour,
    position_de_groupe,
)

# ===================================================================
# Configuration
# ===================================================================

URL_SENAT = "https://data.senat.fr/data/dosleg/dosleg.zip"
URL_SENAT_SENATORS = "https://data.senat.fr/data/senateurs/export_sens.zip"

# Date de la dernière élection sénatoriale (prise de fonction des élus 2023).
# Tous les calculs de cohésion (individuel + groupe) sont restreints à cette date, et
# c'est aussi l'ouverture de la fenêtre dans laquelle on lit le début de mandat d'un
# sénateur (voir `_debut_mandat_fenetre`).
SENAT_DERNIERE_ELECTION = "2023-10-02"

# Posé par `--dry-run`. Seules les étapes qui créent des lignes le consultent : les
# étapes historiques enrichissent des lignes existantes et écrivent toujours.
DRY_RUN = False
TABLES_A_CHARGER = {"loi", "texte", "rap", "lecture", "lecass", "lecassrap", "scr", "date_seance", "votsen", "auteur",
                    # `ecr` lie un texte à ses signataires avec leur rôle (`rolsig` : o = primo-signataire,
                    # n = coauteur, p = président). C'est la seule source complète des cosignatures du Sénat :
                    # l'open data de l'Assemblée, d'où viennent nos lignes `textes`, en résume trois par texte.
                    "ecr", "rolsig",
                    # `denrap` porte la dénomination d'un rapport (`coddenrap`) et la rattache à son
                    # type (`typraprap`, table `typrap`) : c'est le seul endroit qui distingue un
                    # rapport législatif d'un rapport d'information ou de commission d'enquête.
                    "denrap", "typrap"}
TABLES_SENATORS = {"sen", "senurl", "pcs", "pcs24", "pcs42", "pcs8", "activite", "activite_participant"}  # Tables à charger depuis export_sens.zip
# Tables des mandats internes, lues par la seule étape `import_mandats_senat`.
# Tenues à part de `TABLES_SENATORS` parce que le contrôle de complétude ne porte
# que sur celle-ci : y fondre ces quatorze tables ferait tomber les scrutins, les
# coordonnées et les présences des 348 sénateurs le jour où le Sénat renomme
# `fondelega`, dix-neuf lignes de libellés de fonction. L'étape vérifie ses
# propres tables et n'échoue qu'elle-même.
# `libcom` et `libdelega` n'y sont volontairement pas : vérifié sur le dump du
# 2026-09-06, leurs libellés à fin nulle sont identiques à `com.evelib` et
# `delega.evelib`, aux deux seules différences près d'un espace parasite et de la
# pseudo-commission `NEANT`.
TABLES_MANDATS = {"memgrpsen", "memcom", "memdelega", "memextpar",     # les mandats
                  "grpsenami", "com", "delega", "orgext",              # les organes
                  "fonmemcom", "fonmemgrpsen", "fonmemdelega",         # les fonctions exercées
                  "foncom", "fongrpsen", "fondelega"}                  # leurs libellés
# Historique des appartenances aux groupes POLITIQUES, lu par `compute_senateur_stats`
# pour rattacher chaque vote au groupe du jour. À ne pas confondre avec `memgrpsen`
# ci-dessus, qui porte les groupes d'amitié et d'études (`grpsenami`). Tenue à part
# des deux ensembles pour la même raison que `TABLES_MANDATS` : son absence ne doit
# faire tomber que l'étape qui la lit.
TABLES_GROUPES_POLITIQUES = {"memgrppol"}
# Adresses de permanence, lues par `enrich_senateurs_coordonnees` (`adresse_permanence`).
# Tenues à part pour la même raison : sans elles, seule l'adresse manque, les autres
# coordonnées s'écrivent quand même.
TABLES_PERMANENCES = {"poicon", "adresse", "typvoi", "typbister"}
# Plancher de taille pour repérer l'ébauche d'export_sens.zip servie le matin (voir
# `download_senators_dump`) : le vrai dump pèse ~8,5 Mo, l'ébauche moins de 52 Ko.
EXPORT_SENS_TAILLE_MINIMALE = 1_000_000
EXPORT_SENS_DELAIS = [600, 600]  # secondes entre les tentatives ; 3 essais au total
HEAD_TIMEOUT = 5
HEAD_PAUSE = 0.3
# Posée le lundi par `nightly.py` (ou à la main). Les liens déjà connus pour morts ne
# se revérifient que ce jour-là : 41 URLs toujours en 404, retestées chaque nuit pour
# rien, coûtaient 50 s par run.
VERIF_COMPLETE = bool(os.getenv("VERIF_COMPLETE"))

# Les préfixes d'uid des textes que ce script crée lui-même, le dump de l'Assemblée ne
# portant que ce qui touche un dossier de l'Assemblée : rapports de contrôle, avis et
# rapports généraux, propositions de résolution. Leur URL vient du dump du Sénat et se
# vérifie telle quelle — il n'y a rien à retrouver, contrairement aux textes que
# l'Assemblée nous transmet avec une URL parfois périmée.
UID_PREFIXES_CREES_ICI = ("RCTLSNR", "RAVISSNR", "PRESSNR")

# ===================================================================
# Variables d'environnement
# ===================================================================

# Les variables `PG*` de la connexion Postgres (`_db.connexion`), ouverte étape par étape
# dans le `__main__`.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ===================================================================
# Infrastructure : téléchargement et parsing du dump Sénat
# ===================================================================


def download_senat_dump() -> io.BytesIO:
    """Télécharge le ZIP Sénat en mémoire."""
    print(f"📥 Téléchargement du dump Sénat depuis {URL_SENAT}...")
    contenu = telecharger(URL_SENAT)
    print(f"   Taille : {len(contenu) / 1024 / 1024:.1f} Mo")
    return io.BytesIO(contenu)


def download_senators_dump() -> io.BytesIO:
    """Télécharge le ZIP sénateurs, en réessayant tant qu'il arrive en ébauche.

    Du 2026-09-02 au 2026-09-06, à l'heure où tourne le cron (~06h40 UTC),
    data.senat.fr a servi un export_sens.zip de moins de 52 Ko : un ZIP valide, mais
    sans aucune des tables attendues. Le même fichier pèse 8,5 Mo dans la journée, et
    porte une date de régénération vers 10h58 UTC. Le Sénat semble donc vider le
    fichier puis le reconstruire, et le cron tombait chaque nuit dans ce trou.

    Une réponse 200 ne prouvant rien ici, on compare à un plancher de taille. Réessayer
    coûte quelques minutes ; ne pas le faire coûtait l'e-mail, la profession, la place
    en hémicycle et les présences en commission de 354 sénateurs, sans le moindre
    signal dans les logs.
    """
    print(f"📥 Téléchargement du dump sénateurs depuis {URL_SENAT_SENATORS}...")
    for tentative in range(len(EXPORT_SENS_DELAIS) + 1):
        contenu = telecharger(URL_SENAT_SENATORS)
        taille = len(contenu)
        print(f"   Taille : {taille / 1024 / 1024:.1f} Mo")
        if taille >= EXPORT_SENS_TAILLE_MINIMALE:
            return io.BytesIO(contenu)
        if tentative == len(EXPORT_SENS_DELAIS):
            raise RuntimeError(
                f"export_sens.zip toujours en ébauche après {tentative + 1} essais "
                f"({taille} octets, minimum attendu {EXPORT_SENS_TAILLE_MINIMALE})"
            )
        attente = EXPORT_SENS_DELAIS[tentative]
        print(f"   ⚠️  Dump en ébauche ({taille} octets) — nouvel essai dans {attente // 60} min")
        time.sleep(attente)


def parse_dump_to_sqlite(zip_bytes: io.BytesIO) -> sqlite3.Connection:
    """Parse le dump SQL PostgreSQL et charge les tables utiles en SQLite."""
    print("🔄 Parsing du dump SQL vers SQLite...")

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    zf = zipfile.ZipFile(zip_bytes)
    # Trouver le fichier .sql dans le ZIP
    sql_files = [n for n in zf.namelist() if n.endswith(".sql")]
    if not sql_files:
        raise FileNotFoundError("Aucun fichier .sql trouvé dans le ZIP")
    sql_name = sql_files[0]
    print(f"   Fichier : {sql_name}")

    tables_loaded = {}

    with zf.open(sql_name) as f:
        lines = io.TextIOWrapper(f, encoding="utf-8")
        current_table = None
        columns = []
        rows_buffer = []

        for line in lines:
            # Détecter un bloc COPY
            if line.startswith("COPY "):
                match = re.match(r"COPY (\w+) \((.+?)\) FROM stdin;", line)
                if match:
                    table_name = match.group(1)
                    if table_name in TABLES_A_CHARGER:
                        current_table = table_name
                        columns = [
                            c.strip() for c in match.group(2).split(",")
                        ]
                        rows_buffer = []
                        # Créer la table SQLite (tout en TEXT)
                        cols_def = ", ".join(
                            f'"{c}" TEXT' for c in columns
                        )
                        cur.execute(
                            f'DROP TABLE IF EXISTS "{current_table}"'
                        )
                        cur.execute(
                            f'CREATE TABLE "{current_table}" ({cols_def})'
                        )
                continue

            # Fin d'un bloc COPY
            if current_table and line.startswith("\\."):
                if rows_buffer:
                    placeholders = ", ".join("?" for _ in columns)
                    cur.executemany(
                        f'INSERT INTO "{current_table}" VALUES ({placeholders})',
                        rows_buffer,
                    )
                tables_loaded[current_table] = len(rows_buffer)
                current_table = None
                columns = []
                rows_buffer = []
                continue

            # Ligne de données TSV
            if current_table:
                values = line.rstrip("\n").split("\t")
                # \N → None
                values = [None if v == "\\N" else v for v in values]
                # Ajuster si le nombre de colonnes ne matche pas
                if len(values) == len(columns):
                    rows_buffer.append(values)

    conn.commit()

    # Créer les index pour les requêtes rapides
    indexes = [
        ("loi", "signet"),
        ("loi", "url_an"),
        ("texte", "texnum"),
        ("texte", "lecassidt"),
        ("rap", "rapnum"),
        ("lecture", "loicod"),
        ("lecture", "lecidt"),
        ("lecass", "lecassidt"),
        ("lecass", "lecidt"),
        ("lecassrap", "lecassidt"),
        ("lecassrap", "rapcod"),
        ("scr", "code"),
        ("scr", "sesann"),
        ("date_seance", "code"),
        ("date_seance", "lecidt"),
        ("votsen", "senmat"),
        ("votsen", "sesann"),
        ("auteur", "autmat"),
        ("auteur", "typautcod"),
        ("auteur", "autcod"),
        ("ecr", "texcod"),
        ("ecr", "rapcod"),
        ("texte", "texnum"),
        ("rap", "coddenrap"),
        ("rap", "sesann"),
        ("denrap", "coddenrap"),
    ]
    for table, col in indexes:
        if table in tables_loaded:
            cur.execute(
                f'CREATE INDEX IF NOT EXISTS "idx_{table}_{col}" ON "{table}" ("{col}")'
            )
    # Sur l'expression, pas sur les colonnes : `_build_senmat_sortis_map` joint `votsen`
    # à `scr` par `trim(...)`, qui n'utilise pas un index de colonne. Sans celui-ci,
    # SQLite parcourt les 1,67 million de votes pour chacun des 4 813 scrutins, soit 146
    # à 176 s par nuit dans le cron (2026-11-04 et 2026-11-05) ; avec lui, 0,0 s.
    if "votsen" in tables_loaded:
        cur.execute("CREATE INDEX IF NOT EXISTS idx_votsen_scrutin ON votsen (trim(sesann), trim(scrnum))")
    conn.commit()

    for table, count in tables_loaded.items():
        print(f"   {table} : {count} lignes")

    return conn


def parse_senators_dump_to_sqlite(conn: sqlite3.Connection, zip_bytes: io.BytesIO) -> None:
    """Parse le dump export_sens.zip et charge sen + senurl dans la connexion SQLite existante."""
    print("🔄 Parsing du dump sénateurs (export_sens.zip)...")
    zf = zipfile.ZipFile(zip_bytes)
    sql_files = [n for n in zf.namelist() if n.endswith(".sql")]
    if not sql_files:
        raise FileNotFoundError("Aucun fichier .sql dans export_sens.zip")

    cur = conn.cursor()
    tables_loaded = {}

    with zf.open(sql_files[0]) as f:
        lines = io.TextIOWrapper(f, encoding="utf-8")
        current_table = None
        columns = []
        rows_buffer = []

        for line in lines:
            if line.startswith("COPY "):
                match = re.match(r"COPY (\w+) \((.+?)\) FROM stdin;", line)
                if match:
                    table_name = match.group(1)
                    if table_name in TABLES_SENATORS | TABLES_MANDATS | TABLES_GROUPES_POLITIQUES | TABLES_PERMANENCES:
                        current_table = table_name
                        columns = [c.strip() for c in match.group(2).split(",")]
                        rows_buffer = []
                        cur.execute(f"DROP TABLE IF EXISTS {table_name}")
                        cols_def = ", ".join(f"{c} TEXT" for c in columns)
                        cur.execute(f"CREATE TABLE {table_name} ({cols_def})")
                    else:
                        current_table = None
                continue

            if current_table and line.startswith("\\."):
                if rows_buffer:
                    placeholders = ", ".join("?" for _ in columns)
                    cur.executemany(
                        f"INSERT INTO {current_table} VALUES ({placeholders})",
                        rows_buffer,
                    )
                tables_loaded[current_table] = len(rows_buffer)
                current_table = None
                rows_buffer = []
                continue

            if current_table:
                vals = line.rstrip("\n").split("\t")
                vals = [None if v == "\\N" else v for v in vals]
                if len(vals) == len(columns):
                    rows_buffer.append(vals)

    conn.commit()
    for t, n in tables_loaded.items():
        print(f"   Table '{t}' : {n} lignes chargées")

    # Sans ce garde-fou, un dump amputé passait inaperçu : les étapes qui lisent ces
    # tables échouent une par une dans le `try` du `main`, et le run reste vert avec un
    # simple ❌ noyé dans les logs. C'est ainsi que les coordonnées des sénateurs et les
    # présences en commission ont manqué pendant des semaines.
    manquantes = TABLES_SENATORS - tables_loaded.keys()
    if manquantes:
        raise RuntimeError(
            f"export_sens.zip incomplet : tables absentes {sorted(manquantes)}"
        )


# ===================================================================
# Helpers
# ===================================================================


def ecrire(table: str, lignes: list[dict], on_conflict: str, *, cle: str = "uid") -> int:
    """Upsert `lignes` et rend le nombre de lignes réellement écrites (nouvelles ou changées).

    La base compare elle-même (`upsert_si_change`) : une ligne identique à celle en base
    n'est ni réécrite ni comptée. Une ligne que la base refuse, ou une panne qui persiste,
    lève : l'étape s'arrête et entre dans les échecs du `__main__`.
    Appelée par les étapes qui créent des dossiers, textes ou actes.
    """
    ecrites, perdues = upsert_si_change(table, lignes, on_conflict, cle=cle, journal=tqdm.write)
    if perdues:
        raise RuntimeError(f"{table} : {len(perdues)} ligne(s) non écrite(s)")
    return ecrites


def verifier_url(url: str) -> bool:
    """HEAD request pour vérifier l'accessibilité d'une URL."""
    try:
        resp = requests.head(
            url,
            timeout=HEAD_TIMEOUT,
            allow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; LoiClair/1.0)"},
        )
        return resp.status_code < 400
    except Exception:
        return False


def sesann_from_date(date_str: str) -> int | None:
    """Calcule l'année de session Sénat depuis une date (format ISO)."""
    if not date_str:
        return None
    try:
        # Gérer les formats avec/sans timezone
        clean = date_str.split("+")[0].split("Z")[0].strip()
        from datetime import datetime
        dt = datetime.fromisoformat(clean)
        return dt.year if dt.month >= 10 else dt.year - 1
    except Exception:
        return None


def extract_num_from_uid(uid: str) -> int | None:
    """Extrait le numéro depuis un UID Sénat (après le dernier 'B')."""
    # RAPPSNR5S459B0034 → 34, PIONSNR5S479BTA0076 → 76
    match = re.search(r"B(?:TA|TC)?(\d+)$", uid)
    if match:
        return int(match.group(1))
    return None


def build_full_senat_url(relative_url: str, is_rapport: bool) -> str | None:
    """Construit l'URL absolue depuis une URL relative du dump Sénat."""
    if not relative_url:
        return None
    url = relative_url.strip()
    # Déjà absolue
    if url.startswith("http"):
        return url
    # Rapport : https://www.senat.fr/rap/{url}
    if is_rapport:
        return f"https://www.senat.fr/rap/{url}"
    # Texte législatif : https://www.senat.fr/leg/{url}
    return f"https://www.senat.fr/leg/{url}"


# ===================================================================
# Étape 1 : Compléter les lien_senat manquants
# ===================================================================


def fix_liens_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Trouve les dossiers AN sans lien_senat et les matche avec le dump Sénat."""
    # Récupérer les dossiers 17e legislature sans lien_senat (2 208 le 2026-09-30).
    dossiers = lire(
        pg,
        """
        SELECT uid, titre_chemin FROM dossiers_legislatifs
        WHERE legislature = 17 AND (lien_senat IS NULL OR lien_senat = '')
          AND titre_chemin IS NOT NULL
        ORDER BY uid
        """,
    )

    if not dossiers:
        print("   Aucun dossier sans lien_senat. ✓")
        return

    print(f"   Dossiers sans lien_senat : {len(dossiers)}")
    cur = conn.cursor()
    fixed = 0
    # Liens retrouvés, écrits d'un seul coup après la boucle : un UPDATE par dossier coûte
    # un aller-retour chacun vers la base.
    liens_trouves: list[dict] = []
    # La plupart de ces dossiers ne passeront jamais au Sénat (propositions restées à
    # l'Assemblée) : les lister un par un écrivait plus de 2 000 lignes par nuit dans le
    # journal. On garde un compte et quelques exemples.
    sans_match: list[str] = []

    for d in tqdm(dossiers, desc="Fix lien_senat", unit="dossier"):
        titre_chemin = d["titre_chemin"]
        if not titre_chemin:
            continue

        # Chercher dans url_an du Sénat (format: .../dossiers/{slug})
        # Essayer avec le chemin exact, puis sans le suffixe _17e
        variants = [titre_chemin]
        if titre_chemin.endswith("_17e"):
            variants.append(titre_chemin[:-4])

        signet = None
        for variant in variants:
            cur.execute(
                "SELECT signet FROM loi WHERE url_an LIKE ? LIMIT 1",
                (f"%/dossiers/{variant}%",),
            )
            row = cur.fetchone()
            if row:
                signet = row["signet"].strip() if row["signet"] else None
                break

        if signet:
            lien = f"http://www.senat.fr/dossier-legislatif/{signet}.html"
            liens_trouves.append({"uid": d["uid"], "lien_senat": lien})
            fixed += 1
            tqdm.write(f"   ✅ {d['uid']} → {signet}")
        else:
            sans_match.append(f"{d['uid']} ({titre_chemin})")

    if liens_trouves:
        mettre_a_jour(pg, "dossiers_legislatifs", "uid", {"lien_senat": "text"}, liens_trouves)
    print(f"   Corrigés : {fixed}/{len(dossiers)}")
    if sans_match:
        print(f"   Sans correspondance au Sénat : {len(sans_match)}, dont :")
        for exemple in sans_match[:10]:
            print(f"      {exemple}")


# ===================================================================
# Étape 2 : Corriger les URLs des textes Sénat en 404
# ===================================================================


def fix_textes_urls(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Corrige les URLs des textes Sénat non accessibles via le dump.

    Chaque nuit : les textes jamais vérifiés (`url_accessible` nul). Le lundi, ou avec
    `VERIF_COMPLETE`, aussi ceux déjà marqués inaccessibles, pour retrouver une URL
    réparée depuis. Un lien mort revient donc au plus sept jours plus tard.
    """
    filtre = "url_accessible IS NULL OR url_accessible = false" if VERIF_COMPLETE else "url_accessible IS NULL"
    textes = lire(
        pg,
        f"""
        SELECT uid, lien_texte, num_notice, date_depot, date_creation, date_publication
        FROM textes WHERE chambre = %s AND ({filtre}) ORDER BY uid
        """,
        ("Sénat",),
    )

    if not textes:
        print("   Aucun texte Sénat avec URL cassée. ✓")
        return

    print(f"   Textes Sénat à corriger : {len(textes)}")
    cur = conn.cursor()
    fixed = 0
    verifies = 0
    not_found = 0
    still_broken = 0

    # Les résultats s'écrivent par paquets pendant la boucle, pas un par un (un UPDATE
    # chacun, soit un aller-retour par texte) ni tous à la fin : les vérifications HEAD
    # durent plusieurs minutes, et un cron coupé en route perdrait tout son travail.
    a_ecrire: list[dict] = []

    def vider() -> None:
        if a_ecrire:
            mettre_a_jour_par_colonnes(
                pg, "textes", "uid", {"url_accessible": "boolean", "lien_texte": "text"}, a_ecrire
            )
            a_ecrire.clear()

    for texte in tqdm(textes, desc="Fix URLs Sénat", unit="texte"):
        if len(a_ecrire) >= 50:
            vider()
        uid = texte["uid"]

        # Les lignes créées par ce script (rapports de contrôle, avis, résolutions) tiennent
        # leur URL du dump, écrite au moment de leur création : il n'y a rien à retrouver,
        # seulement à vérifier. Elles passent donc avant `extract_num_from_uid`, qui ne sait
        # pas les lire et ne doit surtout pas l'apprendre — c'est ce qui empêche
        # `import_cosignataires_senat` de prendre un numéro de rapport pour un numéro de
        # texte. Sans cette branche elles revenaient chaque nuit, faute d'un `url_accessible`
        # que rien ne posait, et pour ressortir en « impossible d'extraire le numéro ».
        if uid.startswith(UID_PREFIXES_CREES_ICI):
            lien = texte.get("lien_texte")
            if not lien:
                tqdm.write(f"   ⚠ {uid} : aucune URL à vérifier")
                not_found += 1
                continue
            time.sleep(HEAD_PAUSE)
            accessible = verifier_url(lien)
            a_ecrire.append({"uid": uid, "url_accessible": accessible})
            if accessible:
                verifies += 1
            else:
                still_broken += 1
                tqdm.write(f"   ⚠ {uid} : URL inaccessible ({lien})")
            continue

        num = extract_num_from_uid(uid)
        if num is None:
            tqdm.write(f"   ⚠ {uid} : impossible d'extraire le numéro")
            not_found += 1
            continue

        # Un texte adopté n'a pas de date de dépôt : sans les deux autres, il partait sans
        # session vers la recherche par numéro seul, qui a donné au texte adopté n° 3 de
        # 2026-2027 (radio) celui de 2025-2026, et au n° 5 le projet de loi `pjl26-005`.
        # L'ordre est celui de `date_texte_adopte_senat` d'import_textes_cloud.py, qui ne
        # le réserve qu'aux textes adoptés ; ici il vaut pour tous les uid. Rejoué sur les
        # 2 003 textes PION/PRJL du Sénat le 2026-10-19, il redonnait à chacun le lien en
        # base, sauf ceux que le dump ne connaît pas encore et le texte des Balkans corrigé.
        sesann = sesann_from_date(
            texte.get("date_depot") or texte.get("date_creation") or texte.get("date_publication")
        )
        new_url = None

        # --- Textes déposés / adoptés (PIONSNR / PRJLSNR, et RAPPSNR en `BTA`) ---
        # Un uid `RAPPSNR…BTA` est le texte adopté issu d'un rapport, publié en `tas` comme
        # le construit `import_textes_cloud` (`RAPPSNR5S459BTA0173` → `tas24-173`). Le
        # chercher dans la table `rap` rendait le rapport de même numéro, qui répond 200.
        if uid.startswith(("PIONSNR", "PRJLSNR")) or (uid.startswith("RAPPSNR") and "BTA" in uid):
            new_url = _find_texte_url(cur, uid, num, sesann)

        # --- Rapports (RAPPSNR / AVISSNR) ---
        elif uid.startswith(("RAPPSNR", "AVISSNR")):
            new_url = _find_rapport_url(cur, num, sesann)

        if not new_url:
            tqdm.write(f"   ⚠ {uid} (num={num}) : pas trouvé dans dump Sénat")
            not_found += 1
            continue

        # Vérifier que la nouvelle URL est accessible
        time.sleep(HEAD_PAUSE)
        if verifier_url(new_url):
            a_ecrire.append({"uid": uid, "lien_texte": new_url, "url_accessible": True})
            fixed += 1
            tqdm.write(f"   ✅ {uid} → {new_url}")
        else:
            a_ecrire.append({"uid": uid, "lien_texte": new_url, "url_accessible": False})
            still_broken += 1
            tqdm.write(f"   ⚠ {uid} : URL Sénat aussi inaccessible ({new_url})")

    vider()

    # « Corrigés » et « Vérifiés » disent deux choses différentes : une URL retrouvée dans
    # le dump et remplacée, contre une URL déjà en base dont on vient d'établir qu'elle
    # répond. Les confondre ferait lire un travail de réparation là où il n'y en a pas.
    print(f"   Corrigés : {fixed}")
    print(f"   Vérifiés (URL déjà en base) : {verifies}")
    print(f"   Non trouvés dans dump : {not_found}")
    print(f"   Toujours inaccessibles : {still_broken}")


def _find_rapport_url(
    cur: sqlite3.Cursor, rapnum: int, sesann: int | None
) -> str | None:
    """Cherche l'URL d'un rapport dans le dump Sénat."""
    # D'abord chercher avec raptom=1 (multi-tomes)
    if sesann:
        cur.execute(
            "SELECT rapurl FROM rap WHERE CAST(rapnum AS INTEGER) = ? AND CAST(sesann AS INTEGER) = ? AND raptom = '1' LIMIT 1",
            (rapnum, sesann),
        )
        row = cur.fetchone()
        if row:
            return build_full_senat_url(row["rapurl"], is_rapport=True)

        # Pas de tome 1 → chercher sans tome (mono-rapport), URLs lc en dernier recours
        cur.execute(
            "SELECT rapurl FROM rap WHERE CAST(rapnum AS INTEGER) = ? AND CAST(sesann AS INTEGER) = ? AND (raptom IS NULL OR raptom = '') "
            "ORDER BY CASE WHEN rapurl LIKE 'lc%' THEN 1 ELSE 0 END ASC LIMIT 1",
            (rapnum, sesann),
        )
        row = cur.fetchone()
        if row:
            return build_full_senat_url(row["rapurl"], is_rapport=True)

    # Fallback sans filtre session — uniquement si la date est absente
    if not sesann:
        cur.execute(
            "SELECT rapurl, sesann FROM rap WHERE CAST(rapnum AS INTEGER) = ? AND raptom = '1' ORDER BY CAST(sesann AS INTEGER) DESC LIMIT 1",
            (rapnum,),
        )
        row = cur.fetchone()
        if row:
            return build_full_senat_url(row["rapurl"], is_rapport=True)

        cur.execute(
            "SELECT rapurl FROM rap WHERE CAST(rapnum AS INTEGER) = ? AND (raptom IS NULL OR raptom = '') "
            "ORDER BY CAST(sesann AS INTEGER) DESC, CASE WHEN rapurl LIKE 'lc%' THEN 1 ELSE 0 END ASC LIMIT 1",
            (rapnum,),
        )
        row = cur.fetchone()
        if row:
            return build_full_senat_url(row["rapurl"], is_rapport=True)

    return None


def nature_texte_senat(uid: str) -> str:
    """Préfixe de la page Sénat d'un texte PION/PRJL (ou RAPP en `BTA`), lu dans son uid.

    Un numéro ne désigne un texte du dump qu'avec sa session et sa nature. La
    numérotation repart de 1 à chaque session ; dans une même session, textes déposés et
    textes adoptés partagent les numéros (en 2023-2024, le n° 50 est à la fois
    `pjl23-050` et `tas23-050`) ; et la table `texte` range aussi des textes de
    l'Assemblée sous leur propre numéro (`l17b0050_…`). La nature tranche : `BTA` donne
    `tas`, sinon `pjl` pour un projet et `ppl` pour une proposition, règle suivie par les
    2 009 liens en base au 2026-10-19. `texurl` commence par le même préfixe.
    Lue par `_find_texte_url` et `import_cosignataires_senat`.
    """
    return "tas" if "BTA" in uid else "pjl" if uid.startswith("PRJLSNR") else "ppl"


def _find_texte_url(
    cur: sqlite3.Cursor,
    uid: str,
    texnum: int,
    sesann: int | None,
) -> str | None:
    """Cherche l'URL d'un texte dans le dump Sénat, par numéro, session et nature
    (`nature_texte_senat`).

    Quand la session est connue et que le dump n'a rien pour elle (texte pas encore
    publié), on rend None plutôt que le même numéro d'une autre année, qui répondrait 200
    et passerait pour une réparation. La recherche par numéro seul reste pour un texte
    sans aucune date, comme dans `_find_rapport_url`.
    """
    prefixe = nature_texte_senat(uid)
    if sesann:
        cur.execute(
            "SELECT texurl, typurl FROM texte WHERE CAST(texnum AS INTEGER) = ? AND CAST(sesann AS INTEGER) = ? "
            "AND texurl LIKE ? LIMIT 1",
            (texnum, sesann, f"{prefixe}%"),
        )
        row = cur.fetchone()
        if row and row["texurl"]:
            return build_full_senat_url(
                row["texurl"], is_rapport=False
            )
        return None

    # Sans date : numéro seul, le plus récent d'abord
    cur.execute(
        "SELECT texurl, typurl FROM texte WHERE CAST(texnum AS INTEGER) = ? AND texurl LIKE ? "
        "ORDER BY txtoritxtdat DESC LIMIT 1",
        (texnum, f"{prefixe}%"),
    )
    row = cur.fetchone()
    if row and row["texurl"]:
        return build_full_senat_url(row["texurl"], is_rapport=False)

    return None


# ===================================================================
# Étape 3 : Importer les scrutins Sénat (votes finaux : "sur l'ensemble", et
# motions de procédure adoptées qui rejettent le texte)
# ===================================================================


def _est_motion_rejet_adoptee(titre: str, pour: int, contre: int) -> bool:
    """Vrai pour une question préalable ou une exception d'irrecevabilité adoptée.

    Adoptée, l'une comme l'autre rejette le texte : c'est le dernier vote du Sénat
    sur cette lecture, donc un vote final, comme une motion de procédure adoptée à
    l'Assemblée (D-118). Un renvoi en commission adopté ne tranche rien, le texte
    revenant voté plus tard. `titre` est l'intitulé brut du dump : aucun des deux
    motifs ne contient d'apostrophe, le \\u0092 du dump n'y change donc rien. La règle
    d'adoption est celle de `sort_code`.
    """
    t = (titre or "").casefold()
    est_motion_rejet = "question préalable" in t or "irrecevabilité" in t
    return est_motion_rejet and pour > contre


def _est_vote_sur_ensemble(titre: str) -> bool:
    """Vrai pour un scrutin sur l'ensemble d'un texte, d'après son intitulé brut.

    Deux formes au Sénat : « sur l'ensemble du projet de loi… » (CMP et première partie
    d'un budget comprises, D-118), et « sur l'article unique (ou l'article 3)
    constituant l'ensemble de la proposition de loi… » pour un texte réduit à un
    article. Le mot « ensemble » ailleurs ne suffit pas : « à l'article unique
    constituant l'ensemble » au milieu d'un amendement, « l'ensemble des membres du
    groupe », « sur l'ensemble du territoire ». Un `LIKE '%ensemble%'` retenait ainsi 11 votes sur des amendements ou
    des articles (relevé le 2026-11-07, dont 7 sur la loi Ultramarins du 2026-10-19), qui
    comptaient dans la participation des sénateurs. `\\u0092` est l'apostrophe Windows-1252
    du dump, `’` celle qu'il pourrait un jour écrire à la place.
    """
    t = (titre or "").replace("\u0092", "'").replace("’", "'").strip().casefold()
    if t.startswith("sur l'ensemble"):
        return True
    return t.startswith("sur l'article") and "constituant l'ensemble" in t


def _get_lecture_prefix(codass: str, typleccod: str) -> str | None:
    """Convertit codass + typleccod en préfixe code_acte."""
    codass = (codass or "").strip()
    typleccod = (typleccod or "").strip()
    if codass == "S" and typleccod == "1":
        return "SN1"
    if codass == "S" and typleccod == "2":
        return "SN2"
    if codass == "I" and typleccod == "4":
        return "CMP"
    if codass == "S" and typleccod == "5":
        return "SNNLEC"
    if codass == "S" and typleccod == "6":
        return "SNDEF"
    return None


def _get_code_acte_dec(prefix: str) -> str:
    """Construit le code_acte DEC depuis le préfixe lecture."""
    if prefix == "CMP":
        return "CMP-DEBATS-SN-DEC"
    return f"{prefix}-DEBATS-DEC"


# Tous les codes de décision que `import_scrutins_senat` peut rattacher, donc recréer.
# Sert à reconnaître, parmi les actes à suffixe `SUFFIXE_UID_VOTE_RECONSTITUE`, ceux qui
# sont à ce script : les votes de motion de censure portent le même suffixe et
# appartiennent à import_actes_legislatifs_cloud.py.
CODES_ACTE_DEC_SENAT = tuple(_get_code_acte_dec(p) for p in ("SN1", "SN2", "CMP", "SNNLEC", "SNDEF"))


def _codes_acte_parent(code_acte_dec: str) -> tuple[str, ...]:
    """Codes des actes sous lesquels recréer une décision du Sénat absente de la source,
    par ordre de préférence : le premier présent dans le dossier l'emporte.

    Pour la CMP, `CMP-DEBATS-SN` : l'Assemblée publie cette étape sans son enfant
    `-DEC` (loi d'orientation agricole, DLR5L16N49726). À défaut, l'acte racine `CMP`,
    quel que soit le dossier : les dossiers d'`import_lois_senat` n'ont que `CMP` et
    `CMP-DEC` (12 votes de CMP du Sénat sans acte au 2026-11-07, aucun dossier de
    l'Assemblée dans ce cas ce jour-là). L'acte racine de la lecture sinon (`SN1`…) : une
    proposition de loi rejetée par le Sénat en 1re lecture s'arrête dans le dump à
    `SN1-COM-FOND-*`, sans étape `SN1-DEBATS` où se ranger, et les dossiers
    d'`import_lois_senat` n'ont pas d'étape `-DEBATS` du tout. Le site ne lit
    `parent_uid` que pour reconnaître les actes racines : le parent choisi ne change
    donc rien à l'affichage, seulement à la cohérence de l'arbre.
    """
    if code_acte_dec == "CMP-DEBATS-SN-DEC":
        return ("CMP-DEBATS-SN", "CMP")
    return (code_acte_dec.removesuffix("-DEBATS-DEC"),)


def import_scrutins_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Importe les scrutins Sénat (votes finaux) et les lie aux actes législatifs.

    Recrée l'acte de décision que l'Assemblée ne publie pas, et le retire quand elle
    le publie (`_decisions_a_recreer`). Le statut « Rejeté » qui en découle pour un
    texte mort au Sénat est écrit par import_dossiers_cloud.py, pas ici
    (`dossiers_rejetes_au_senat` de `_statuts.py`).
    """

    # 1. Construire le mapping signet → dossier_uid
    signet_map = charger_signets(pg)
    print(f"   Dossiers avec lien_senat : {len(signet_map)}")

    # 2. Récupérer les votes finaux depuis SQLite, avec le chemin complet vers le
    #    dossier : les scrutins sur l'ensemble (`_est_vote_sur_ensemble`), et les motions
    #    qui rejettent le texte quand elles sont adoptées (`_est_motion_rejet_adoptee`).
    #    Le SQL ne fait que dégrossir, le tri fin se fait en Python sur le titre. La borne
    #    de date est ce qui limite l'assiette : elle était
    #    portée jusqu'ici par le rattachement à un dossier en base, et sans elle le dump
    #    remonte jusqu'en 2006.
    cur = conn.cursor()
    cur.execute("""
        SELECT s.sesann, s.scrnum, s.scrdat, s.scrint,
               s.scrpou, s.scrcon, s.scrvot, s.scrsuf,
               trim(loi.signet) as signet,
               la.codass, l.typleccod
        FROM scr s
        JOIN date_seance ds ON CAST(s.code AS INTEGER) = CAST(ds.code AS INTEGER)
        JOIN lecass la ON trim(ds.lecidt) = trim(la.lecassidt)
        JOIN lecture l ON trim(la.lecidt) = trim(l.lecidt)
        JOIN loi ON trim(l.loicod) = trim(loi.loicod)
        WHERE (s.scrint LIKE '%ensemble%' OR s.scrint LIKE '%motion%')
          AND s.scrdat >= ?
        ORDER BY s.scrdat DESC
    """, (SENAT_DERNIERE_ELECTION,))
    scrutins_senat = []
    motions_retenues = 0
    for row in cur.fetchall():
        row = dict(row)
        row["sur_ensemble"] = _est_vote_sur_ensemble(row["scrint"])
        if row["sur_ensemble"]:
            scrutins_senat.append(row)
            continue
        if _est_motion_rejet_adoptee(row["scrint"], int(row["scrpou"] or 0), int(row["scrcon"] or 0)):
            scrutins_senat.append(row)
            motions_retenues += 1
    print(f"   Votes finaux dans le dump : {len(scrutins_senat)} "
          f"(dont {motions_retenues} motion(s) de rejet adoptée(s))")

    # 3. Un scrutin est importé même si son dossier n'est pas en base : le taux de
    # participation des sénateurs se calcule sur les scrutins de `scrutins`, et écarter
    # ceux dont le dossier manque amputait la fenêtre sénatoriale de ses premiers mois.
    # Nos dossiers viennent du dump de l'Assemblée, borné à la 17ᵉ législature, alors que
    # le Sénat votait déjà en octobre 2023 sur des textes de la 16ᵉ : 52 votes finaux sur
    # 242 manquaient, dont 26 des 31 de l'année 2023.
    #
    # Sans dossier, il n'y a rien à rattacher : le scrutin est créé, mais pas son lien
    # vers un acte de décision.
    scrutins_to_import = []
    sans_dossier = 0
    for row in scrutins_senat:
        signet = row["signet"]
        dossier_uid = dossier_du_signet(signet_map, signet, row["scrdat"])
        if not dossier_uid:
            sans_dossier += 1
        prefix = _get_lecture_prefix(row["codass"], row["typleccod"])
        # Déduire la legislature depuis le dossier_uid (DLR5L17N... → 17)
        leg_match = re.search(r"DLR5L(\d+)N", dossier_uid or "")
        legislature = int(leg_match.group(1)) if leg_match else 17

        scrutins_to_import.append({
            "sesann": row["sesann"],
            "scrnum": row["scrnum"],
            "scrdat": row["scrdat"],
            "scrint": row["scrint"],
            "scrpou": int(row["scrpou"] or 0),
            "scrcon": int(row["scrcon"] or 0),
            "scrvot": int(row["scrvot"] or 0),
            "scrsuf": int(row["scrsuf"] or 0),
            "signet": signet,
            "dossier_uid": dossier_uid,
            "code_acte_dec": _get_code_acte_dec(prefix) if prefix else None,
            "legislature": legislature,
            "sur_ensemble": row["sur_ensemble"],
        })

    print(f"   Scrutins à importer : {len(scrutins_to_import)} "
          f"(dont {sans_dossier} sans dossier en base, importés quand même)")

    if not scrutins_to_import:
        print("   Aucun scrutin à importer.")
        return

    # 4. Récupérer les scrutins Sénat déjà importés (pour éviter les doublons)
    existing = lire(pg, "SELECT uid FROM scrutins WHERE chambre = %s", ("Sénat",))
    existing_uids = {r["uid"] for r in existing}

    # 5. Upsert les scrutins dans la table scrutins, en un seul appel. Une requête par
    # scrutin coûtait 46 s par nuit pour 242 lignes toujours identiques. Le dict garde
    # la dernière version d'un uid vu deux fois (la jointure SQLite peut en rendre),
    # comme le faisaient les upserts successifs, et parce qu'un même lot ne peut pas
    # toucher deux fois la même ligne en `ON CONFLICT`.
    new_scrutins = 0
    scrutin_acte_links = []  # (scrutin_uid, dossier_uid, code_acte_dec)
    # Ce qu'un acte de décision recréé dit du scrutin : (date, numéro, conclusion).
    # Une motion retenue est une motion de rejet adoptée : le texte est rejeté, alors que
    # le `sort_code` du scrutin, lui, dit la motion « adopté ».
    decision_par_scrutin: dict[str, tuple[str, int, str]] = {}
    payloads: dict[str, dict] = {}

    for s in scrutins_to_import:
        uid = f"VTSNR{s['sesann']}V{s['scrnum']}"

        # Nettoyer le titre : remplacer les \u0092 (apostrophe Windows-1252) par '
        titre = (s["scrint"] or "").replace("\u0092", "'").replace("\u009C", "œ").strip()

        # Déduire le résultat
        pour = s["scrpou"]
        contre = s["scrcon"]
        votants = s["scrvot"]
        suffrages = s["scrsuf"]
        abstentions = votants - pour - contre
        if abstentions < 0:
            abstentions = 0

        sort_libelle = "adopté par le Sénat" if pour > contre else "rejeté par le Sénat"
        sort_code = "adopté" if pour > contre else "rejeté"

        payload = {
            "uid": uid,
            "numero": int(s["scrnum"]),
            "chambre": "Sénat",
            "organe_ref": "PO78718",  # Sénat (5ème République)
            "legislature": s["legislature"],
            "date_scrutin": s["scrdat"],
            "titre": titre,
            "sort_code": sort_code,
            "sort_libelle": sort_libelle,
            "type_vote_libelle": "scrutin public",
            "synthese_pour": pour,
            "synthese_contre": contre,
            "synthese_abstentions": abstentions,
            "synthese_nombre_votants": votants,
            "synthese_suffrages_exprimes": suffrages,
        }

        if uid not in existing_uids:
            new_scrutins += 1
            existing_uids.add(uid)

        payloads[uid] = payload
        decision_par_scrutin[uid] = (
            s["scrdat"] or "",
            int(s["scrnum"]),
            "adopté" if s["sur_ensemble"] and pour > contre else "rejeté",
        )

        # Préparer le lien vers l'acte, quand il y a un dossier à lier. Les dossiers de
        # `import_lois_senat` en font partie : ils n'ont aucun acte de décision, qui est
        # donc toujours recréé (`_decisions_a_recreer`). Les en écarter laissait 46 votes
        # sans dossier au 2026-11-07, sur la fiche de l'élu comme sur la page du vote.
        if s["dossier_uid"] and s["code_acte_dec"]:
            scrutin_acte_links.append((uid, s["dossier_uid"], s["code_acte_dec"]))

    ecrites = ecrire("scrutins", list(payloads.values()), "uid")

    print(f"   Scrutins importés (nouveaux) : {new_scrutins}")
    print(f"   Scrutins mis à jour (total) : {len(payloads)} ({ecrites} écrit(s))")

    # 6. Lier les scrutins aux actes législatifs (ajouter vote_refs).
    # Les actes candidats se lisent en une fois, au lieu d'un SELECT par lien : 190
    # allers-retours pour, la plupart des nuits, aucune écriture.
    # Seuls les actes auxquels il manque un scrutin sont réécrits.
    #
    # Quand l'Assemblée ne publie pas l'acte de décision, il est recréé sous l'acte
    # parent (`_codes_acte_parent`), et retiré dès que le vrai acte arrive : voir
    # `_decisions_a_recreer`. Les parents se lisent dans la même requête.
    dossiers = sorted({d for _, d, _ in scrutin_acte_links})
    codes = sorted({c for _, _, c in scrutin_acte_links})
    codes_parents = sorted({p for c in codes for p in _codes_acte_parent(c)})
    actes_par_cle: dict[tuple[str, str], dict] = {}
    parents_par_cle: dict[tuple[str, str], dict] = {}
    lignes = lire(
        pg,
        """
        SELECT uid, vote_refs, dossier_uid, code_acte FROM actes_legislatifs
        WHERE dossier_uid = ANY(%s) AND code_acte = ANY(%s)
        ORDER BY uid, dossier_uid
        """,
        (dossiers, codes + codes_parents),
    )
    for acte in lignes:
        # Un acte recréé ne compte jamais comme le vrai : il se lit à part, plus bas.
        if acte["uid"].endswith(SUFFIXE_UID_VOTE_RECONSTITUE):
            continue
        cle = (acte["dossier_uid"], acte["code_acte"])
        # Le premier par uid, pour un choix stable quand un dossier porte deux actes
        # du même code (l'ancien `actes[0]` suivait l'ordre non garanti de la base).
        if acte["code_acte"] in codes_parents:
            parents_par_cle.setdefault(cle, acte)
        else:
            actes_par_cle.setdefault(cle, acte)

    linked = 0
    a_ecrire: dict[str, list[str]] = {}
    for scrutin_uid, dossier_uid, code_acte_dec in scrutin_acte_links:
        acte = actes_par_cle.get((dossier_uid, code_acte_dec))
        if not acte:
            continue
        refs = a_ecrire.get(acte["uid"], acte.get("vote_refs") or [])
        if scrutin_uid not in refs:
            a_ecrire[acte["uid"]] = refs + [scrutin_uid]
        linked += 1

    if a_ecrire:
        mettre_a_jour(
            pg, "actes_legislatifs", "uid", {"vote_refs": "text[]"},
            [{"uid": acte_uid, "vote_refs": refs} for acte_uid, refs in a_ecrire.items()],
        )

    voulus, non_trouves = _decisions_a_recreer(
        scrutin_acte_links, actes_par_cle, parents_par_cle, decision_par_scrutin
    )
    for dossier_uid, code_acte_dec in non_trouves:
        print(f"   ⚠ Acte {code_acte_dec} non trouvé pour {dossier_uid}")

    # Tous les actes recréés par ce script, pas seulement ceux des dossiers de la passe :
    # un dossier qui a perdu son lien Sénat garde sinon un vote qu'aucune passe ne lit
    # plus. Une dizaine de lignes, une requête suffit.
    existants = lire(
        pg,
        f"""
        SELECT {", ".join(COLONNES_DECISION_RECREEE)} FROM actes_legislatifs
        WHERE uid LIKE %s AND code_acte = ANY(%s)
        ORDER BY uid, dossier_uid
        """,
        (f"%{SUFFIXE_UID_VOTE_RECONSTITUE}", list(CODES_ACTE_DEC_SENAT)),
    )
    a_upserter, a_supprimer = _ecarts_decisions_recreees(voulus, existants, SENAT_DERNIERE_ELECTION)

    # Suppression d'abord, écriture ensuite, comme avant.
    if a_supprimer:
        pg.execute("DELETE FROM actes_legislatifs WHERE uid = ANY(%s)", (a_supprimer,))
    ecrites_actes = ecrire("actes_legislatifs", a_upserter, "uid,dossier_uid")

    print(f"   Liens scrutin → acte vérifiés : {linked} (dont {len(a_ecrire)} acte(s) complété(s))")
    print(f"   Actes de décision recréés : {len(voulus)} (dont {ecrites_actes} écrit(s)), "
          f"retirés : {len(a_supprimer)}")
    print(f"   Actes non trouvés : {len(non_trouves)}")


# Colonnes d'un acte de décision recréé : celles qu'écrit `_decisions_a_recreer`, donc
# celles qu'on relit pour n'écrire que ce qui change.
COLONNES_DECISION_RECREEE = (
    "uid", "dossier_uid", "parent_uid", "code_acte", "libelle_acte", "type_acte",
    "organe_ref", "date_acte", "statut_conclusion", "vote_refs",
)


def _decisions_a_recreer(
    liens: list[tuple[str, str, str]],
    actes_par_cle: dict[tuple[str, str], dict],
    parents_par_cle: dict[tuple[str, str], dict],
    decision_par_scrutin: dict[str, tuple[str, int, str]],
) -> tuple[dict[tuple[str, str], dict], list[tuple[str, str]]]:
    """Actes de décision du Sénat à recréer, et liens restés sans acte ni parent.

    L'Assemblée ne publie pas toujours l'acte de décision d'un vote du Sénat :
    - une proposition de loi née au Sénat et rejetée par lui en 1re lecture ne va
      jamais à l'Assemblée, dont le dossier s'arrête à `SN1-COM-FOND-*` (8 au
      2026-11-03, dont DLR5L17N53258) ;
    - une CMP dont `CMP-DEBATS-SN` n'a pas d'enfant `-DEC` (DLR5L16N49726) ;
    - tout dossier d'`import_lois_senat`, que l'Assemblée ne publie pas (43 actes au
      2026-11-07). Le vrai n'y arrive jamais : l'acte recréé y reste.
    Sans l'acte, le vote n'apparaît pas sur la fiche, et le texte rejeté reste
    « Déposé ». L'acte recréé reprend la forme d'un vrai `SN1-DEBATS-DEC` de rejet
    (L17-VD230780DEC). Il n'est voulu que tant que le vrai manque : quand l'Assemblée
    le publie, il sort de cette liste, `_ecarts_decisions_recreees` le supprime, et le
    vote passe sur le vrai acte par le chemin habituel.

    `actes_par_cle` et `parents_par_cle` ne contiennent que des actes de la source,
    clés (dossier_uid, code_acte). Pure : se teste sans base.
    """
    voulus: dict[tuple[str, str], dict] = {}
    scrutins_par_cle: dict[tuple[str, str], list[str]] = {}
    non_trouves: list[tuple[str, str]] = []
    for scrutin_uid, dossier_uid, code_acte_dec in liens:
        cle = (dossier_uid, code_acte_dec)
        if cle in actes_par_cle:
            continue
        parent = next(
            (parents_par_cle[(dossier_uid, p)] for p in _codes_acte_parent(code_acte_dec)
             if (dossier_uid, p) in parents_par_cle),
            None,
        )
        if not parent:
            if cle not in non_trouves:
                non_trouves.append(cle)
            continue
        scrutins_par_cle.setdefault(cle, []).append(scrutin_uid)
        if cle in voulus:
            continue
        voulus[cle] = {
            "uid": f"{dossier_uid}-{code_acte_dec}{SUFFIXE_UID_VOTE_RECONSTITUE}",
            "dossier_uid": dossier_uid,
            "parent_uid": parent["uid"],
            "code_acte": code_acte_dec,
            "libelle_acte": "Décision",
            "type_acte": "Decision_Type",
            "organe_ref": "PO78718",  # Sénat (5ème République)
        }
    for cle, scrutins in scrutins_par_cle.items():
        # Plusieurs scrutins pour une même décision : la date et la conclusion sont
        # celles du dernier, qui clôt la lecture ; tous restent dans `vote_refs`.
        dernier = max(scrutins, key=lambda u: decision_par_scrutin[u][:2])
        date_scrutin, _, conclusion = decision_par_scrutin[dernier]
        voulus[cle]["date_acte"] = date_scrutin or None
        voulus[cle]["statut_conclusion"] = conclusion
        voulus[cle]["vote_refs"] = sorted(set(scrutins))
    return voulus, non_trouves


def _ecarts_decisions_recreees(
    voulus: dict[tuple[str, str], dict], existants: list[dict], borne: str
) -> tuple[list[dict], list[str]]:
    """Ce qu'il faut écrire et supprimer pour que la base porte exactement `voulus`.

    `existants` : les actes recréés par ce script, tels que lus en base. Un acte voulu
    identique n'est pas réécrit. La date se compare sur le jour : la base rend un
    horodatage (`2026-02-25T00:00:00`), le dump du Sénat une date. Rend les lignes à
    écrire et les uids à supprimer (ils portent le dossier, donc sont uniques).

    `borne` : date à partir de laquelle la passe lit les scrutins
    (`SENAT_DERNIERE_ELECTION`). Un acte recréé daté d'avant n'est jamais supprimé :
    la passe ne voit plus son scrutin, donc son absence de `voulus` ne prouve pas que
    le vrai acte est arrivé. Avancer la borne à la prochaine élection supprimait sinon
    tous les actes recréés plus anciens, et leurs dossiers repassaient à « Déposé »
    sans alerte.
    """
    def jour(v) -> str | None:
        return str(v)[:10] if v else None

    existants_par_uid = {e["uid"]: e for e in existants}
    a_ecrire = []
    for acte in voulus.values():
        ancien = existants_par_uid.get(acte["uid"])
        if ancien is not None and all(
            (jour(ancien.get(c)) == jour(acte.get(c))) if c == "date_acte"
            else ((ancien.get(c) or None) == (acte.get(c) or None))
            for c in COLONNES_DECISION_RECREEE
        ):
            continue
        a_ecrire.append(acte)
    uids_voulus = {a["uid"] for a in voulus.values()}
    a_supprimer = sorted(
        u for u, e in existants_par_uid.items()
        if u not in uids_voulus and not (jour(e.get("date_acte")) and jour(e.get("date_acte")) < borne)
    )
    return a_ecrire, a_supprimer


# ===================================================================
# Main : download once, parse once, run all steps
# ===================================================================

# ===================================================================
# Étape 4 : Calculer les stats agrégées des sénateurs et de leurs groupes
# ===================================================================

# Statuts spéciaux pour les non-votants
STAVOT_PRESENT_NON_VOTANT = {"8", "12"}  # Président de séance, Déport
STAVOT_EXCLU = {"9"}  # Membre du gouvernement — scrutin non applicable
# Tout autre stavotidt avec posvotcod=4 = absent (0=sans statut, 5=congé, 6=excusé)

# Non-votants qui ne comptent pas dans l'effectif d'un groupe sur un scrutin, écrit
# dans `scrutins_groupes_positions.nb_membres`. Le président de séance (8) et le
# sénateur membre du gouvernement (9) ne peuvent pas voter du fait de leur fonction :
# ils ne sont pas des membres qui auraient pu prendre part au vote. Le déport (12)
# reste compté : c'est le choix d'un membre qui pouvait voter, comme une absence. Ne s'applique qu'avec `posvotcod` 4 : le dump du
# 2026-09-14 porte 15 votes exprimés sous le statut 8 depuis 2023, qui comptent comme
# des votes.
STAVOT_HORS_EFFECTIF = {"8", "9"}

# L'uid d'organe des non-inscrits du Sénat. Leur « groupe » n'est qu'une réunion
# administrative d'élus sans groupe, sans ligne commune : aucune position de groupe
# n'est écrite pour lui dans `scrutins_groupes_positions` (D-313), et aucune cohésion
# n'est calculée par rapport à lui, ni pour lui (97,62 % affichés au 2026-09-14).
ORGANE_NON_INSCRITS_SENAT = GROUPES_SENAT_VERS_ORGANE["NI"]


def _debut_mandat_fenetre(periodes: list | None, date_debut_mandat: str | None) -> str | None:
    """Début du mandat à partir duquel les votes d'un sénateur comptent.

    C'est le début de la première période de `acteurs.periodes_mandat_assemblee`
    encore ouverte à la dernière élection (fin nulle ou postérieure à
    `SENAT_DERNIERE_ELECTION`). `date_debut_mandat`, lu jusqu'ici, est le début du
    mandat en cours : un sénateur réélu le 1er octobre 2026 y aurait perdu tous ses
    votes antérieurs, alors que ses périodes contiguës sont fusionnées en une seule.

    Repli sur `date_debut_mandat` quand la colonne est vide : au 2026-09-14, c'était le
    cas des 142 sénateurs élus avant 2023, dont `import_acteurs_organes_cloud.py` ne
    gardait pas encore le mandat ouvert à cette date. Cet import tourne avant ce script
    dans le cron, mais s'il échoue la nuit où sa correction arrive, la colonne reste
    vide, et sans repli leurs votes compteraient depuis le début du dump (2006).
    """
    debuts = [
        p["debut"]
        for p in (periodes or [])
        if isinstance(p, dict) and p.get("debut")
        and (p.get("fin") is None or p["fin"] >= SENAT_DERNIERE_ELECTION)
    ]
    return min(debuts) if debuts else date_debut_mandat


def _historique_groupes_senat(conn: sqlite3.Connection) -> dict[str, list[tuple[str | None, str | None, str]]]:
    """senmat → appartenances aux groupes politiques [(debut, fin, code)], tous sénateurs.

    Lu dans `memgrppol` (export_sens.zip), sortants compris : ils ont voté, leurs votes
    comptent dans la position de leur groupe du jour. Appelée par `compute_senateur_stats`.

    Pas de filtre sur `temvalcod` : l'export ODSEN_HISTOGROUPES que le Sénat publie de la
    même base n'en pose pas, et sa lecture sans filtre donnait au 2026-09-14 le groupe
    actuel exact des 348 sénateurs et aucun chevauchement depuis 2023.

    Lève si la table manque (dump sénateurs absent ou en ébauche) : se replier sur le
    groupe actuel referait attribuer à un sénateur tous ses votes depuis 2023 au groupe
    qu'il vient de rejoindre. Les chiffres de la veille restent alors en base.
    """
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memgrppol'")
    if cur.fetchone() is None:
        raise RuntimeError(
            "export_sens.zip sans la table memgrppol : groupe du jour des votes introuvable"
        )
    # `trim()` et `substr()` : le dump est en `bpchar` et ses dates portent une heure.
    cur.execute("""
        SELECT trim(senmat) AS senmat, trim(grppolcod) AS code,
               substr(trim(memgrppoldatdeb), 1, 10) AS debut,
               substr(trim(memgrppoldatfin), 1, 10) AS fin
        FROM memgrppol
        WHERE senmat IS NOT NULL AND grppolcod IS NOT NULL
    """)
    historique: dict[str, list[tuple[str | None, str | None, str]]] = {}
    for r in cur.fetchall():
        historique.setdefault(r["senmat"], []).append((r["debut"] or None, r["fin"] or None, r["code"]))
    return historique


def _is_president_senat(sesann: str, periods: list) -> bool:
    """Retourne True si le sénateur était Président du Sénat pendant la session sesann.

    Les sessions parlementaires sénatoriales débutent en octobre. La présidence du Sénat
    commence et se termine également en octobre, ce qui permet un alignement exact :
    sesann "2014" couvre oct 2014 – sept 2015, et la présidence de Larcher débute le 1er oct 2014.
    """
    if not periods:
        return False
    try:
        year = int(sesann)
    except (ValueError, TypeError):
        return False
    # La session sesann couvre approximativement oct sesann – sept sesann+1
    sess_start = f"{year}-10-01"
    sess_end = f"{year + 1}-09-30"
    for p in periods:
        debut = p.get("debut") or "0000-01-01"
        fin = p.get("fin") or "9999-12-31"
        if sess_start <= fin and sess_end >= debut:
            return True
    return False


def _normalize_name(s: str) -> str:
    """Normalise un nom pour la comparaison : supprime les accents et met en majuscules."""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").upper().strip()


def _build_senmat_to_uid_map(conn: sqlite3.Connection, pg: psycopg.Connection) -> dict:
    """Construit un mapping senmat (dump Sénat) → uid par nom/prénom.

    Sénateurs en exercice seulement. `debut_mandat_fenetre` (voir
    `_debut_mandat_fenetre`) borne les votes comptés dans leurs statistiques. Les
    sénateurs partis depuis la dernière élection ont leur propre correspondance,
    `_build_senmat_sortis_map` (D-308), qui ne sert qu'aux listes nominatives.
    """
    # Récupérer les sénateurs actuels en base
    # Trié par uid : deux homonymes donnent toujours le même gagnant dans `acteurs_par_nom`.
    senateurs = lire(
        pg,
        """
        SELECT uid, nom, prenom, groupe, qualite_actuelle, periodes_president_senat,
               date_debut_mandat, periodes_mandat_assemblee
        FROM acteurs WHERE est_senateur_actuel ORDER BY uid
        """,
    )

    # Indexer par (NOM_NORMALISÉ, PRENOM_NORMALISÉ) — sans accents pour résister aux
    # divergences d'encodage entre le dump Sénat et la base (ex: NICOLAY vs NICOLAŸ)
    acteurs_par_nom = {}
    for s in senateurs:
        key = (_normalize_name(s["nom"] or ""), _normalize_name(s["prenom"] or ""))
        acteurs_par_nom[key] = {
            "uid": s["uid"],
            "groupe": s["groupe"],
            "qualite_actuelle": s.get("qualite_actuelle"),
            "periodes_president_senat": s.get("periodes_president_senat") or [],
            "debut_mandat_fenetre": _debut_mandat_fenetre(
                s.get("periodes_mandat_assemblee"), s.get("date_debut_mandat")
            ),
        }

    # Récupérer les sénateurs du dump avec leur autmat (= senmat dans votsen)
    cur = conn.cursor()
    cur.execute("""
        SELECT trim(autmat) as autmat, trim(nomuse) as nom, trim(prenom) as prenom
        FROM auteur
        WHERE trim(typautcod) = '1' AND autmat IS NOT NULL AND trim(autmat) != ''
    """)

    mapping = {}  # senmat → {uid, groupe}
    for row in cur.fetchall():
        key = (_normalize_name(row["nom"] or ""), _normalize_name(row["prenom"] or ""))
        if key in acteurs_par_nom:
            mapping[row["autmat"]] = acteurs_par_nom[key]

    return mapping


def _build_senmat_sortis_map(conn: sqlite3.Connection, pg: psycopg.Connection, actuels: dict) -> dict[str, str]:
    """senmat → uid des sénateurs qui ont siégé depuis `SENAT_DERNIERE_ELECTION` et ne sont
    plus en fonction (D-308). `actuels` est la correspondance des sénateurs en exercice.

    Siéger se lit dans `votsen`, qui liste à chaque scrutin les sénateurs en fonction ce
    jour-là, absents compris. Le rapprochement passe par `acteurs.matricule_senat`, que
    l'enrichissement des coordonnées écrit tant que le sénateur est en exercice et ne
    retire pas ensuite : exact, il évite l'homonyme que le rapprochement par nom de
    `_build_senmat_to_uid_map` peut prendre. Au 2026-10-28, les 90 sortis de la fenêtre
    l'avaient tous. Un sortant sans matricule resterait absent de la liste nominative,
    comme avant. Seuls les uid qui ne sont plus sénateurs en exercice sont retenus : un
    sénateur en exercice que le rapprochement par nom manque (nom d'usage changé) reste
    signalé par le compte « Sénateurs matchés », au lieu d'être pris pour un sortant.

    Cette correspondance ne sert qu'à la liste nominative des scrutins (`votes_nominatifs`,
    `groupes_votants`). Les colonnes de vote d'`acteurs` restent calculées pour les seuls
    sénateurs en exercice : un sortant devenu député (un cas au 2026-10-28) y perdrait
    ses chiffres de député.
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT DISTINCT trim(v.senmat) AS senmat
        FROM votsen v
        JOIN scr s ON trim(s.sesann) = trim(v.sesann) AND trim(s.scrnum) = trim(v.scrnum)
        WHERE s.scrdat >= ?
    """, (SENAT_DERNIERE_ELECTION,))
    candidats = sorted({r["senmat"] for r in cur.fetchall() if r["senmat"]} - set(actuels))
    if not candidats:
        return {}
    rows = lire(
        pg,
        """
        SELECT uid, matricule_senat FROM acteurs
        WHERE matricule_senat = ANY(%s) AND NOT est_senateur_actuel
        ORDER BY uid
        """,
        (candidats,),
    )
    return {r["matricule_senat"]: r["uid"] for r in rows}


def _votes_amendement_adoptes(conn: sqlite3.Connection) -> dict[tuple[str, str], dict]:
    """Scrutins du Sénat sur un amendement adopté depuis le renouvellement de 2023.

    {(sesann, scrnum) → ligne de `scr` avec le signet du dossier}. Adopté se lit `pour >
    contre`, la règle de `sort_code` dans `import_scrutins_senat`, le dump ne publiant pas
    de sort. Rien de ceci n'entre dans `scrutins` : la participation s'y calcule.
    """
    lignes = conn.execute("""
        SELECT trim(s.sesann) AS sesann, trim(s.scrnum) AS scrnum, s.scrdat, s.scrint,
               s.scrpou, s.scrcon, s.scrvot, s.scrmaj, trim(loi.signet) AS signet
        FROM scr s
        JOIN date_seance ds ON CAST(s.code AS INTEGER) = CAST(ds.code AS INTEGER)
        JOIN lecass la ON trim(ds.lecidt) = trim(la.lecassidt)
        JOIN lecture l ON trim(la.lecidt) = trim(l.lecidt)
        JOIN loi ON trim(l.loicod) = trim(loi.loicod)
        WHERE s.scrdat >= ?
    """, (SENAT_DERNIERE_ELECTION,)).fetchall()
    return {
        (r["sesann"], r["scrnum"]): dict(r)
        for r in lignes
        if int(r["scrpou"] or 0) > int(r["scrcon"] or 0) and est_vote_sur_amendement(r["scrint"])
    }


def _ecrire_votes_amendements(pg: psycopg.Connection, votes_amendement: dict[tuple[str, str], dict],
                              votes_by_scrutin: dict, groupes_by_scrutin: dict,
                              group_votes: dict, group_majority: dict, position_de_code: dict) -> None:
    """Écrit dans `votes_amendements` les scrutins de `_votes_amendement_adoptes`.

    Appelée en fin de `compute_senateur_stats`, dont elle reprend les structures déjà
    calculées (noms, groupe du jour, position de groupe), donc les mêmes règles que les
    votes finaux. En dernier : une panne laisse intactes les colonnes des sénateurs.
    """
    signets = charger_signets(pg)
    positions: dict[tuple[str, str], list[dict]] = {}
    for (sesann, scrnum, groupe_uid), code in group_majority.items():
        if (sesann, scrnum) not in votes_amendement or groupe_uid == ORGANE_NON_INSCRITS_SENAT:
            continue
        compte = group_votes[(sesann, scrnum, groupe_uid)]
        positions.setdefault((sesann, scrnum), []).append({
            "groupe_uid": groupe_uid,
            "position_majoritaire": position_de_code[code],
            "nb_pour": compte["1"],
            "nb_contre": compte["2"],
            "nb_abstentions": compte["3"],
            "nb_membres": compte["effectif"],
        })

    votes = []
    for cle, s in votes_amendement.items():
        vn = votes_by_scrutin.get(cle)
        # Un scrutin sans aucun nom rapproché ne montrerait qu'un décompte sans hémicycle.
        if not vn:
            continue
        pour, contre, votants = int(s["scrpou"] or 0), int(s["scrcon"] or 0), int(s["scrvot"] or 0)
        votes.append({
            "uid": f"VTSNR{cle[0]}V{cle[1]}",
            "chambre": "SN",
            "date_scrutin": (s["scrdat"] or "")[:10],
            "titre": (s["scrint"] or "").replace("\u0092", "'").replace("\u009C", "œ").strip(),
            "pour": pour,
            "contre": contre,
            "abstentions": max(votants - pour - contre, 0),
            "votants": votants,
            # 0 comme sur les autres scrutins du Sénat, dont le décompte ne donne pas ce chiffre :
            # la page en dirait « qui ne pouvaient pas voter » de sénateurs simplement absents.
            "non_votants": 0,
            "suffrages_requis": int(s["scrmaj"]) if s["scrmaj"] else None,
            "votes_nominatifs": {cat: sorted(uids) for cat, uids in vn.items()},
            "groupes_votants": dict(sorted(groupes_by_scrutin.get(cle, {}).items())),
            "positions_groupes": sorted(positions.get(cle, []), key=lambda p: p["groupe_uid"]),
            "dossier_uid": dossier_du_signet(signets, s["signet"], s["scrdat"]),
        })

    lignes, compteurs = relier_votes(votes, "SN")
    print(f"   Votes d'amendements adoptés (Sénat) : {compteurs}, "
          f"{ecrire('votes_amendements', lignes, 'uid')} ligne(s) écrite(s)")


def _fetch_votes_finaux_senat(pg: psycopg.Connection) -> set[tuple[str, str]]:
    """Retourne l'ensemble des (sesann, scrnum) correspondant aux scrutins finaux
    du Sénat présents dans notre table `scrutins` (format uid : VTSNR{sesann}V{scrnum})."""
    rows = lire(pg, "SELECT uid FROM scrutins WHERE chambre = %s", ("Sénat",))

    result = set()
    for row in rows:
        uid = row.get("uid", "") or ""
        m = re.match(r"VTSNR(\d+)V(\d+)$", uid)
        if m:
            result.add((m.group(1), m.group(2)))
    return result


def compute_senateur_stats(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Calcule les stats de vote des sénateurs et de leurs groupes : positions de groupe,
    votes nominatifs, colonnes de vote d'`acteurs`, stats des groupes dans `organes`."""

    # 1. Construire le mapping senmat → uid
    senmat_map = _build_senmat_to_uid_map(conn, pg)
    print(f"   Sénateurs matchés (dump → base) : {len(senmat_map)}/348")

    # Zéro sénateur matché n'est jamais un cas normal : il y en a 348 en permanence.
    # C'est le symptôme d'un dump amputé ou d'un changement de schéma. On lève pour que
    # la boucle du `main` compte l'étape en échec, au lieu de sortir sans rien dire.
    if not senmat_map:
        raise RuntimeError("Aucun sénateur matché entre le dump et la base.")

    # 1a. Les sénateurs partis depuis la dernière élection, pour la seule liste
    # nominative des scrutins (D-308, voir `_build_senmat_sortis_map`).
    senmat_sortis = _build_senmat_sortis_map(conn, pg, senmat_map)
    print(f"   Sénateurs sortis depuis {SENAT_DERNIERE_ELECTION}, nommés dans les scrutins : {len(senmat_sortis)}")

    # 1b. Charger les scrutins finaux (présents dans notre table scrutins)
    votes_finaux_set = _fetch_votes_finaux_senat(pg)
    print(f"   Scrutins finaux Sénat chargés : {len(votes_finaux_set)}")

    # 2. Calculer les stats par sénateur depuis votsen
    cur = conn.cursor()

    # Lookup date de scrutin : (sesann, scrnum) → scrdat (ex: "2024-03-15")
    cur.execute("SELECT trim(sesann) as sesann, trim(scrnum) as scrnum, scrdat FROM scr WHERE scrdat IS NOT NULL")
    scrutin_date_map = {
        (row["sesann"], row["scrnum"]): (row["scrdat"] or "").strip()
        for row in cur.fetchall()
    }

    # Groupe politique de chaque sénateur au jour de chaque vote. Le groupe actuel,
    # lu jusqu'ici dans `acteurs.groupe`, attribuait à un sénateur qui a changé de
    # groupe tous ses votes depuis 2023 au groupe qu'il venait de rejoindre : Gilbert-Luc
    # Devinaz, socialiste jusqu'au 2026-07-19 puis RDSE, passait pour le sénateur le
    # moins fidèle à son groupe (66,25 %) en votant comme les socialistes.
    historique_groupes = _historique_groupes_senat(conn)
    codes_inconnus: dict[str, int] = {}

    def organe_du_jour(senmat: str, scrdat: str) -> str | None:
        """Uid d'organe du groupe de `senmat` le jour `scrdat`, None hors de tout groupe."""
        code = groupe_au_jour(historique_groupes.get(senmat) or [], scrdat[:10])
        if code is None or code in CODES_SENAT_SANS_GROUPE:
            return None
        organe = GROUPES_SENAT_VERS_ORGANE.get(code)
        if organe is None:
            codes_inconnus[code] = codes_inconnus.get(code, 0) + 1
        return organe

    # D'abord, calculer la position majoritaire de chaque groupe pour chaque scrutin
    # (nécessaire pour la cohésion)
    print("   Calcul des positions majoritaires par groupe...")
    cur.execute("""
        SELECT v.sesann, v.scrnum, v.senmat, v.posvotcod, v.stavotidt
        FROM votsen v
    """)
    all_votes = cur.fetchall()

    # Organiser les votes par sénateur et par scrutin
    # Structure: senmat → [(sesann, scrnum, posvotcod, stavotidt), ...]
    votes_by_senator = {}
    # (sesann, scrnum, groupe_uid) → {"1": pour, "2": contre, "3": abstentions,
    #                                  "effectif": n, "votants": n, "possibles": n}
    group_votes = {}

    for v in all_votes:
        senmat = (v["senmat"] or "").strip()
        sesann = (v["sesann"] or "").strip()
        scrnum = (v["scrnum"] or "").strip()
        posvotcod = (v["posvotcod"] or "").strip()
        stavotidt = (v["stavotidt"] or "0").strip()

        if senmat in senmat_map:
            votes_by_senator.setdefault(senmat, []).append(
                (sesann, scrnum, posvotcod, stavotidt)
            )

        # Décompte des groupes : tous les sénateurs listés pour ce scrutin, en exercice
        # ou partis depuis, chacun dans son groupe du jour. `votsen` ne liste que les
        # 348 sénateurs qui siégeaient ce jour-là : aucun filtre de mandat n'est donc
        # nécessaire. Seuls les scrutins depuis la dernière élection servent (positions
        # des votes finaux, tous postérieurs, et cohésion, bornée à cette date).
        scrdat = scrutin_date_map.get((sesann, scrnum), "")
        if not scrdat or scrdat < SENAT_DERNIERE_ELECTION:
            continue
        groupe = organe_du_jour(senmat, scrdat)
        if groupe is None:
            continue
        compte = group_votes.setdefault(
            (sesann, scrnum, groupe),
            {"1": 0, "2": 0, "3": 0, "effectif": 0, "votants": 0, "possibles": 0},
        )
        # L'effectif du groupe sur ce scrutin (colonne `nb_membres`) : ses membres
        # listés dans `votsen`, absents compris (le Sénat liste chaque sénateur à chaque
        # scrutin), hors statuts `STAVOT_HORS_EFFECTIF`.
        if posvotcod in ("1", "2", "3"):
            compte[posvotcod] += 1
            compte["effectif"] += 1
        elif posvotcod == "4" and stavotidt not in STAVOT_HORS_EFFECTIF:
            compte["effectif"] += 1

        # Participation du groupe (D-278) : votants et votes possibles, avec les mêmes
        # exclusions que le taux individuel plus bas, ni au numérateur ni au
        # dénominateur : gouvernement, présidence de séance, déport, et le président du
        # Sénat pendant sa présidence. `effectif` ne retire pas le déport, d'où deux
        # compteurs à part. Sénateurs partis depuis compris, dans leur groupe du jour.
        presidence = (senmat_map.get(senmat) or {}).get("periodes_president_senat") or []
        if not _is_president_senat(sesann, presidence):
            if posvotcod in ("1", "2", "3"):
                compte["votants"] += 1
                compte["possibles"] += 1
            elif posvotcod == "4" and stavotidt not in STAVOT_EXCLU and stavotidt not in STAVOT_PRESENT_NON_VOTANT:
                compte["possibles"] += 1

    print(f"   Sénateurs avec votes : {len(votes_by_senator)}")

    # Un code de groupe absent de la table de correspondance (groupe créé après le
    # renouvellement, par exemple) ferait disparaître ce groupe des positions et de la
    # cohésion sans un mot. On lève avant toute écriture : les chiffres de la veille
    # restent, et le code à ajouter à `GROUPES_SENAT_VERS_ORGANE` est dans le message.
    if codes_inconnus:
        raise RuntimeError(
            f"Codes de groupe du Sénat sans organe connu : {codes_inconnus}. "
            "Les ajouter à GROUPES_SENAT_VERS_ORGANE (_positions_groupe.py)."
        )

    # Contrôle de la table de correspondance : le groupe du jour doit être le groupe
    # actuel de `acteurs`. Un écart isolé peut venir d'un décalage d'un jour entre les
    # deux sources ; beaucoup d'écarts disent qu'un code a changé de sens.
    aujourdhui = date.today().isoformat()
    ecarts = [
        s["uid"] for m, s in senmat_map.items()
        if s.get("groupe") and organe_du_jour(m, aujourdhui) != s["groupe"]
    ]
    if ecarts:
        print(f"   ⚠️  {len(ecarts)} sénateurs dont le groupe du jour diffère de acteurs.groupe : {ecarts[:10]}")

    POSVOT_TO_POSITION = {"1": "pour", "2": "contre", "3": "abstention"}
    POSITION_TO_POSVOT = {p: c for c, p in POSVOT_TO_POSITION.items()}

    # Position de chaque groupe par scrutin, avec la règle commune aux deux chambres :
    # pas de position sans votant ni en cas d'égalité. Le Sénat ne publie aucune
    # position de groupe : elle n'existe que par ce calcul.
    group_majority = {}  # (sesann, scrnum, groupe) → "1"/"2"/"3"
    for key, counts in group_votes.items():
        position = position_de_groupe(counts["1"], counts["2"], counts["3"])
        if position:
            group_majority[key] = POSITION_TO_POSVOT[position]

    # 2b. Persister les positions de groupe sur les votes finaux
    # → alimente scrutins_groupes_positions pour la page /Facts/alliances.
    # Les non-inscrits n'en reçoivent aucune (D-313) : leurs lignes déjà en base partent
    # par la purge ci-dessous, puisqu'elles ne sont plus dans `ecrites`.
    positions_rows = []
    for (sesann, scrnum, groupe_uid), posvotcod in group_majority.items():
        if (sesann, scrnum) not in votes_finaux_set:
            continue
        if groupe_uid == ORGANE_NON_INSCRITS_SENAT:
            continue
        counts = group_votes[(sesann, scrnum, groupe_uid)]
        positions_rows.append({
            "scrutin_uid": f"VTSNR{sesann}V{scrnum}",
            "groupe_uid": groupe_uid,
            "chambre": "SN",
            "position_majoritaire": POSVOT_TO_POSITION[posvotcod],
            "nb_pour": counts["1"],
            "nb_contre": counts["2"],
            "nb_abstentions": counts["3"],
            # Effectif du groupe sur le scrutin (voir plus haut), et non la somme des
            # votants : c'est le sens de la colonne côté Assemblée (`nombreMembresGroupe`).
            "nb_membres": counts["effectif"],
        })

    print(f"   Positions de groupe (SN) à upserter : {len(positions_rows)}")
    ecrites_positions = ecrire(
        "scrutins_groupes_positions", positions_rows, "scrutin_uid,groupe_uid", cle="scrutin_uid"
    )
    print(f"   Positions de groupe (SN) écrites : {ecrites_positions}")

    # Purge des positions qui n'ont plus lieu d'être : groupe passé sous le seuil ou à
    # égalité, ou vote réattribué à un autre groupe. L'upsert seul ne retire jamais
    # rien. Upsert d'abord, suppression ensuite, comme `import_mandats_senat` : une
    # ligne en trop une seconde se voit moins qu'une ligne qui manque. La purge ne
    # touche que les scrutins finaux dont `votsen` porte des votes ce soir.
    scrutins_recalcules = {
        f"VTSNR{sesann}V{scrnum}"
        for (sesann, scrnum, _) in group_votes
        if (sesann, scrnum) in votes_finaux_set
    }
    ecrites = {(r["scrutin_uid"], r["groupe_uid"]) for r in positions_rows}
    existantes = lire(
        pg,
        """
        SELECT scrutin_uid, groupe_uid FROM scrutins_groupes_positions
        WHERE chambre = 'SN' ORDER BY scrutin_uid, groupe_uid
        """,
    )
    obsoletes = [
        (r["scrutin_uid"], r["groupe_uid"]) for r in existantes
        if r["scrutin_uid"] in scrutins_recalcules and (r["scrutin_uid"], r["groupe_uid"]) not in ecrites
    ]
    print(f"   Positions de groupe (SN) obsolètes supprimées : {len(obsoletes)}")
    if obsoletes:
        pg.execute(
            """
            DELETE FROM scrutins_groupes_positions t
            USING unnest(%s::text[], %s::text[]) AS v(scrutin_uid, groupe_uid)
            WHERE t.scrutin_uid = v.scrutin_uid AND t.groupe_uid = v.groupe_uid
            """,
            ([s for s, _ in obsoletes], [g for _, g in obsoletes]),
        )

    # 2c. Votes nominatifs individuels sur les scrutins finaux Sénat
    # Pivot : (sesann, scrnum) → {pour: [...], contre: [...], ...}
    print("   Construction des votes nominatifs par scrutin (Sénat)...")
    votes_amendement = _votes_amendement_adoptes(conn)
    votes_by_scrutin: dict = {}
    # Groupe du jour de chaque nom, lu par le volet de détail du vote : `organe_du_jour`,
    # la même source que le décompte des groupes plus haut. Relire l'AMO à la place
    # rangeait un sénateur ailleurs que son décompte, par exemple dans les jours qui ont
    # suivi le renouvellement, où l'AMO a publié les groupes avec retard (D-278).
    groupes_by_scrutin: dict[tuple[str, str], dict[str, str | None]] = {}
    for v in all_votes:
        senmat = (v["senmat"] or "").strip()
        sesann = (v["sesann"] or "").strip()
        scrnum = (v["scrnum"] or "").strip()
        # Sénateurs partis compris (D-308) : sans eux, 242 des 258 scrutins nominatifs du
        # Sénat avaient une liste plus courte que leur décompte officiel (2026-10-28). Sur
        # les seuls scrutins depuis la dernière élection, que D-308 couvre : avant, la
        # liste reste partielle pour tous les sortants, pas seulement pour une partie.
        uid = (senmat_map.get(senmat) or {}).get("uid")
        if not uid and scrutin_date_map.get((sesann, scrnum), "") >= SENAT_DERNIERE_ELECTION:
            uid = senmat_sortis.get(senmat)
        if not uid:
            continue
        posvotcod = (v["posvotcod"] or "").strip()
        stavotidt = (v["stavotidt"] or "0").strip()
        key = (sesann, scrnum)
        if key not in votes_by_scrutin:
            votes_by_scrutin[key] = {
                "pour": [], "contre": [], "abstentions": [],
                "nonVotants": [], "institutionnels": [], "absents": [],
            }
        vn = votes_by_scrutin[key]
        if posvotcod == "1":
            vn["pour"].append(uid)
        elif posvotcod == "2":
            vn["contre"].append(uid)
        elif posvotcod == "3":
            vn["abstentions"].append(uid)
        elif posvotcod == "4":
            if stavotidt in STAVOT_EXCLU or stavotidt in STAVOT_PRESENT_NON_VOTANT:
                vn["institutionnels"].append(uid)
            else:
                vn["absents"].append(uid)
        # Seuls les scrutins finaux (`lignes_vn`) et les votes d'amendement adoptés
        # (`_ecrire_votes_amendements`) sont écrits : calculer le groupe des autres, soit
        # l'essentiel de `votsen`, ne servirait à rien.
        if posvotcod in ("1", "2", "3", "4") and (key in votes_finaux_set or key in votes_amendement):
            scrdat = scrutin_date_map.get(key, "")
            groupes_by_scrutin.setdefault(key, {})[uid] = organe_du_jour(senmat, scrdat) if scrdat else None

    # Listes triées : l'ordre de lecture du dump n'est pas garanti d'une nuit à l'autre,
    # et deux listes identiques dans un autre ordre compteraient comme un changement.
    lignes_vn = [
        {
            "uid": f"VTSNR{key[0]}V{key[1]}",
            "votes_nominatifs": {cat: sorted(uids) for cat, uids in vn.items()},
            "groupes_votants": dict(sorted(groupes_by_scrutin.get(key, {}).items())),
        }
        for key, vn in votes_by_scrutin.items()
        if key in votes_finaux_set
    ]
    # Par lots de 50 scrutins, environ 0,7 Mo chacun, une transaction par lot (l'écriture
    # est rejouable) : les deux colonnes ensemble pèsent plus de 2 Mo, et un envoi
    # unique de 1 Mo, les seuls votes nominatifs, perdait déjà sa connexion sur « SSL
    # error: bad record mac » depuis un poste local, le 2026-10-27, deux fois sur deux.
    n = 0
    for i in range(0, len(lignes_vn), 50):
        n += mettre_a_jour(
            pg, "scrutins", "uid", {"votes_nominatifs": "jsonb", "groupes_votants": "jsonb"},
            lignes_vn[i:i + 50],
        )
    print(f"   Votes nominatifs Sénat : {len(lignes_vn)} scrutins, {n} modifié(s)")

    # 3. Calculer les stats par sénateur
    print("   Calcul des stats individuelles...")
    updates = []

    for senmat, votes in votes_by_senator.items():
        info = senmat_map[senmat]
        uid = info["uid"]

        pour = 0
        contre = 0
        abstentions = 0
        present_non_votant = 0  # président, déport
        absent = 0
        exclu = 0  # membre du gouvernement
        # Compteurs restreints aux scrutins finaux (présents dans notre table scrutins)
        pour_final = 0
        contre_final = 0
        abstentions_final = 0
        absent_final = 0
        cohesion_accord = 0
        cohesion_total = 0

        president_periods = info.get("periodes_president_senat") or []

        for sesann, scrnum, posvotcod, stavotidt in votes:
            scrdat = scrutin_date_map.get((sesann, scrnum), "")

            # Scrutin sans date → exclu de tous les compteurs pour rester cohérent
            if not scrdat:
                continue

            # Filtrer aux votes du mandat, lu sur ses périodes (voir `_debut_mandat_fenetre`)
            mandate_start = info.get("debut_mandat_fenetre")
            if mandate_start and scrdat and scrdat < mandate_start:
                continue  # Vote avant la prise de mandat → ignoré

            # Pendant sa présidence du Sénat, un sénateur ne vote pas par convention.
            # Ces scrutins sont exclus du numérateur ET du dénominateur.
            if _is_president_senat(sesann, president_periods):
                continue

            is_final = (sesann, scrnum) in votes_finaux_set

            if posvotcod in ("1", "2", "3"):
                # A voté — présent
                if posvotcod == "1":
                    pour += 1
                    if is_final:
                        pour_final += 1
                elif posvotcod == "2":
                    contre += 1
                    if is_final:
                        contre_final += 1
                else:
                    abstentions += 1
                    if is_final:
                        abstentions_final += 1

                # Cohésion : votes finaux seulement, comme à l'Assemblée (D-189), et depuis la
                # dernière élection (période commune à tous les sénateurs), contre la position
                # du groupe auquel il appartenait ce jour-là. Le dump liste tous les scrutins
                # publics du Sénat, pas seulement les finaux : sans ce filtre, la loyauté d'un
                # sénateur se mesurait sur une autre assiette que celle d'un député, et que le
                # nombre de scrutins finaux affiché à côté d'elle. Un vote émis hors de tout
                # groupe ou comme non-inscrit n'a pas de ligne à suivre et reste hors du calcul.
                groupe_jour = organe_du_jour(senmat, scrdat) if is_final and scrdat >= SENAT_DERNIERE_ELECTION else None
                if groupe_jour and groupe_jour != ORGANE_NON_INSCRITS_SENAT:
                    majority = group_majority.get((sesann, scrnum, groupe_jour))
                    if majority:
                        cohesion_total += 1
                        if posvotcod == majority:
                            cohesion_accord += 1

            elif posvotcod == "4":
                if stavotidt in STAVOT_EXCLU:
                    exclu += 1
                elif stavotidt in STAVOT_PRESENT_NON_VOTANT:
                    present_non_votant += 1
                else:
                    absent += 1
                    if is_final:
                        absent_final += 1

        # votes_total : tous scrutins pertinents (hors gouvernement ET hors président/déport)
        votes_total = pour + contre + abstentions + absent
        if votes_total == 0:
            # Aucun vote applicable (ex : président du Sénat tout au long de son mandat).
            # On écrase quand même les éventuelles valeurs résiduelles avec null.
            updates.append({
                "uid": uid,
                "votes_total": 0,
                "votes_pour": 0,
                "votes_contre": 0,
                "votes_abstentions": 0,
                "votes_absent": 0,
                "scrutins_finaux_pendant_mandat": 0,
                "taux_participation_votes_finaux": None,
                "taux_cohesion_groupe": None,
            })
            continue

        # scrutins_finaux_pendant_mandat : uniquement les scrutins finaux (= présents dans
        # notre table scrutins), en excluant les mêmes statuts institutionnels
        scrutins_finaux = pour_final + contre_final + abstentions_final + absent_final

        taux_participation_votes_finaux = (
            round((pour_final + contre_final + abstentions_final) / scrutins_finaux * 100, 2)
            if scrutins_finaux > 0 else None
        )
        taux_cohesion = (
            round(cohesion_accord / cohesion_total * 100, 2)
            if cohesion_total > 0
            else None
        )
        # Un non-inscrit n'a pas de groupe à qui être fidèle. Ses votes sous l'étiquette NI
        # sont déjà hors du calcul, mais un sénateur devenu non-inscrit garderait sinon le
        # taux de son ancien groupe, affiché sous l'étiquette NI. NULL écrit explicitement,
        # pour remplacer la valeur des nuits précédentes.
        if info.get("groupe") == ORGANE_NON_INSCRITS_SENAT:
            taux_cohesion = None

        updates.append({
            "uid": uid,
            "votes_total": votes_total,
            "votes_pour": pour,
            "votes_contre": contre,
            "votes_abstentions": abstentions,
            "votes_absent": absent,
            "scrutins_finaux_pendant_mandat": scrutins_finaux,
            "taux_participation_votes_finaux": taux_participation_votes_finaux,
            "taux_cohesion_groupe": taux_cohesion,
        })

    # Sénateur absent de `votsen` : aucun scrutin depuis son arrivée. Même écriture que
    # pour `votes_total == 0` ci-dessus. Sans elle, ses colonnes de vote gardaient leur
    # valeur d'avant : le 2026-10-15, neuf sénateurs élus le 1er octobre et anciens
    # députés affichaient encore leur taux de participation à l'Assemblée.
    #
    # Le test porte sur l'uid et non sur le matricule : `_build_senmat_to_uid_map`
    # rattache par nom, donc un homonyme ancien de la table `auteur` reçoit le même uid
    # qu'un sénateur en exercice. Une ligne à zéro de plus pour cet uid ferait deux
    # lignes de même clé dans `mettre_a_jour`, et l'`UPDATE ... FROM` en choisit une au
    # hasard ; les nuits où les vrais chiffres n'ont pas bougé, seule la ligne à zéro
    # passe le filtre `IS DISTINCT FROM` et les écrase.
    uids_ecrits = {u["uid"] for u in updates}
    for senmat, info in senmat_map.items():
        if senmat in votes_by_senator or info["uid"] in uids_ecrits:
            continue
        uids_ecrits.add(info["uid"])
        updates.append({
            "uid": info["uid"],
            "votes_total": 0,
            "votes_pour": 0,
            "votes_contre": 0,
            "votes_abstentions": 0,
            "votes_absent": 0,
            "scrutins_finaux_pendant_mandat": 0,
            "taux_participation_votes_finaux": None,
            "taux_cohesion_groupe": None,
        })

    # Ces colonnes ne se calculent que sur les scrutins de l'Assemblée : vides pour tout
    # sénateur. Le Sénat a aussi des scrutins publics solennels, décidés par la Conférence
    # des présidents, mais son dump ne les marque pas, et ce script n'en tire aucun taux
    # (vérifié le 2026-11-10 : seule la présence de délégations nominatives, colonne
    # `votsen.senmatdel`, les trahit). Sans ce vidage, un député élu sénateur gardait son
    # taux de député, qu'`import_scrutins_cloud.py`
    # n'écrit plus pour lui (93 % pour l'un d'eux le 2026-10-15) : la fiche le cache,
    # mais le serveur MCP le renvoyait, et il faisait afficher le bloc des taux vide.
    # Sa part de votes délégués suit la même règle : elle ne se calcule que sur les
    # scrutins de l'Assemblée.
    for u in updates:
        u["taux_participation_votes_solennels"] = None
        u["scrutins_solennels_pendant_mandat"] = None
        u["votes_actifs_importants"] = None
        u["votes_finaux_solennels"] = None
        u["votes_delegues"] = None
        u["taux_delegation"] = None

    print(f"   Sénateurs à mettre à jour : {len(updates)}")

    # 4. Écriture en une requête : seuls les sénateurs dont un chiffre a bougé sont
    # réécrits, c'est-à-dire aucun pendant l'intersession. Les taux sont déjà arrondis à
    # deux décimales, l'échelle de leur colonne : sans ça, chaque ligne paraîtrait
    # changée.
    n = mettre_a_jour(
        pg, "acteurs", "uid",
        {"votes_total": "int", "votes_pour": "int", "votes_contre": "int",
         "votes_abstentions": "int", "votes_absent": "int",
         "scrutins_finaux_pendant_mandat": "int",
         "taux_participation_votes_finaux": "numeric",
         "taux_cohesion_groupe": "numeric",
         "taux_participation_votes_solennels": "numeric",
         "scrutins_solennels_pendant_mandat": "int",
         "votes_actifs_importants": "int",
         "votes_finaux_solennels": "int",
         "votes_delegues": "int",
         "taux_delegation": "numeric"},
        updates,
    )
    print(f"   Sénateurs mis à jour : {n} sur {len(updates)}")

    # 5. Stats des groupes, tirées du décompte de chaque scrutin final par groupe du jour
    # (D-278), et non plus des taux des membres actuels : une moyenne de ceux-ci comptait
    # dans un groupe les votes qu'un sénateur y avait émis avant de le rejoindre, et
    # sortait ceux des sénateurs partis depuis. Même définition qu'à l'Assemblée :
    # participation = votes sur votes possibles, cohésion interne = voix sur la position
    # du groupe parmi ses votants. Les colonnes gardent leur nom en « moyen » : c'est une
    # moyenne pondérée par scrutin.
    stats_groupes: dict[str, dict[str, int]] = {}
    for (sesann, scrnum, groupe_uid), counts in group_votes.items():
        if (sesann, scrnum) not in votes_finaux_set:
            continue
        g = stats_groupes.setdefault(groupe_uid, {"votants": 0, "possibles": 0, "accord": 0, "exprimes": 0})
        g["votants"] += counts["votants"]
        g["possibles"] += counts["possibles"]
        majority = group_majority.get((sesann, scrnum, groupe_uid))
        # Pas de cohésion pour les non-inscrits (voir `ORGANE_NON_INSCRITS_SENAT`) : la
        # colonne est écrite à NULL, pour effacer un taux d'avant.
        if majority and groupe_uid != ORGANE_NON_INSCRITS_SENAT:
            g["accord"] += counts[majority]
            g["exprimes"] += counts["1"] + counts["2"] + counts["3"]

    lignes_groupes = [
        {
            "uid": groupe_uid,
            "taux_participation_votes_finaux_moyen": (
                round(g["votants"] / g["possibles"] * 100, 2) if g["possibles"] > 0 else None
            ),
            "taux_cohesion_interne": (
                round(g["accord"] / g["exprimes"] * 100, 2) if g["exprimes"] > 0 else None
            ),
        }
        for groupe_uid, g in stats_groupes.items()
    ]
    n = mettre_a_jour(
        pg, "organes", "uid",
        {"taux_participation_votes_finaux_moyen": "numeric", "taux_cohesion_interne": "numeric"},
        lignes_groupes,
    )
    print(f"   Groupes sénatoriaux mis à jour : {n} sur {len(lignes_groupes)}")

    _ecrire_votes_amendements(
        pg, votes_amendement, votes_by_scrutin, groupes_by_scrutin,
        group_votes, group_majority, POSVOT_TO_POSITION,
    )


# ===================================================================
# Étape 5 : Enrichir les coordonnées des sénateurs (siège, email, réseaux)
# ===================================================================

TYPE_TO_FIELD = {
    "TWEETER":   "twitter_url",
    "LINKEDIN":  "linkedin_url",
    "INSTAGRAM": "instagram_url",
    "FACEBOOK":  "facebook_url",
    "PAGPER":    "profil_url",
    "BLOG":      "profil_url",  # fallback si pas de PAGPER
}

# Une colonne ajoutée ici sans l'être à `COLONNES_COORDONNEES_SENAT` ferait lever
# `mettre_a_jour_par_colonnes` (type inconnu) en fin d'étape, et l'import de
# l'Assemblée continuerait de l'écrire pour les sénateurs en exercice.
assert set(TYPE_TO_FIELD.values()) <= set(COLONNES_COORDONNEES_SENAT), \
    "TYPE_TO_FIELD écrit une colonne absente de COLONNES_COORDONNEES_SENAT"

# Premiers mots qui disent déjà le type de voie : devant eux, le `typvoi` du dump ne
# s'ajoute pas (« 159 » + RUE + « Allée du Château » ferait « 159 rue Allée du Château »).
_DEBUTS_DE_VOIE = {
    "rue", "ruelle", "avenue", "boulevard", "place", "quai", "allée", "route", "chemin",
    "cours", "impasse", "passage", "square", "esplanade", "faubourg", "chaussée", "voie",
    "rond-point", "résidence", "espace", "mairie", "bp", "lieu-dit",
}
# Valeurs de formulaire restées dans le dump à la place d'un champ vide.
_GABARITS_VIDES = {"nouvelle adresse", "nouvelle ville"}
_CODE_POSTAL = re.compile(r"\d{5}")


def adresse_permanence(row: dict) -> str | None:
    """Remet en ordre une adresse de permanence du dump Sénat (`poicon` PERM + `adresse`).

    `row` porte les colonnes de `adresse`, plus `typvoilib` et `typbisterlib` de leurs
    tables de libellés. Rend « rue, complément, code postal commune », la forme de
    l'import de l'Assemblée ; None sans voie ni commune. Les champs sont saisis à la main et souvent mal rangés : chaque règle
    ci-dessous répond à un cas des 84 adresses de sénateurs en exercice du 2026-10-25.
    """
    def champ(cle: str) -> str:
        v = " ".join((row.get(cle) or "").split())
        return "" if v.lower() in _GABARITS_VIDES else v

    numero, nom_voie = champ("adrnumvoi"), champ("adrnomvoi")
    complements = [champ("adrcmp"), champ("adrcmp2")]
    # « 125, boulevard Aristide Briand »
    nom_voie = re.sub(r"^(\d+)\s*,\s*", r"\1 ", nom_voie)
    # « Nouvelle adresse » dans le nom, la voie dans le complément (« 21 » QUAI « Lamennais »).
    if not nom_voie and complements[0] and not complements[0][0].isdigit():
        nom_voie, complements[0] = complements[0], ""
    # Un nom de résidence dans le champ du numéro passe en tête, comme un complément.
    tete = []
    if numero and not numero[0].isdigit():
        tete, numero = [numero], ""

    rue = ""
    if nom_voie:
        type_voie = (row.get("typvoilib") or "").strip()
        premier = nom_voie.split()[0].lower()
        if (type_voie and type_voie != "A définir" and not nom_voie[0].isdigit()
                and premier not in _DEBUTS_DE_VOIE):
            nom_voie = f"{type_voie} {nom_voie}"
        bis = (row.get("typbisterlib") or "").strip().lower()
        rue = " ".join(filter(None, [numero, bis if numero else "", nom_voie]))

    # La commune est dans `adrcom` ou dans `adrburdis` (bureau distributeur), parfois
    # déjà précédée du code postal. Le code postal manque alors de `adrcodpos`, qui
    # porte parfois une boîte postale (« BP 60 »), ou se trouve dans les champs du cedex.
    commune = champ("adrcom") or champ("adrburdis")
    code_postal = champ("adrcodpos")
    if code_postal and not _CODE_POSTAL.fullmatch(code_postal):
        complements.append(code_postal)
        code_postal = ""
    if not code_postal:
        code_postal = next(
            (v for v in (champ("adrcdxcod"), champ("adrcdxlib")) if _CODE_POSTAL.fullmatch(v)), ""
        )
    if commune and _CODE_POSTAL.match(commune):
        code_postal = ""
    if not (rue or any(complements) or tete) or not commune:
        return None
    return ", ".join(filter(None, [
        *tete, rue, *complements, " ".join(filter(None, [code_postal, commune])),
    ]))


def enrich_senateurs_coordonnees(conn: sqlite3.Connection, pg: psycopg.Connection):
    """
    Enrichit les sénateurs actifs depuis le dump export_sens.zip (déjà chargé dans conn) :
    - place_hemicycle (sennumsie)
    - departement_election (sencircou)
    - email (senema)
    - libelle_profession (sendespro), cat_soc_pro (pcs24), fam_soc_pro (pcs8)
    - twitter_url, linkedin_url, instagram_url, facebook_url, profil_url (senurl)
    - adresse_circonscription (poicon PERM + adresse, voir `adresse_permanence`)
    """
    # 1. Mapping senmat → uid
    senmat_map = _build_senmat_to_uid_map(conn, pg)
    print(f"   Sénateurs matchés : {len(senmat_map)}")
    if not senmat_map:
        raise RuntimeError("Aucun sénateur matché entre le dump et la base.")

    # Un sénateur en exercice que le nom ne rapproche pas (accent, nom d'usage) n'a plus
    # aucune coordonnée : l'import de l'Assemblée ne les écrit plus pour lui
    # (`_colonnes_senat.py`), et il disparaît de « Mes élus » et de la carte. Ses votes
    # et ses présences, rapprochés de la même façon, sont faux aussi. Signalé chaque
    # nuit jusqu'à correction du rapprochement, sans faire échouer l'étape.
    rapproches = {info["uid"] for info in senmat_map.values()}
    en_exercice = lire(pg, "SELECT uid, prenom, nom FROM acteurs WHERE est_senateur_actuel ORDER BY uid")
    for s in en_exercice:
        if s["uid"] not in rapproches:
            signaler_anomalie(
                "sync_senat",
                f"sénateur en exercice non rapproché du dump du Sénat par son nom : {s['uid']} "
                f"{s['prenom']} {s['nom']}, sans coordonnées ni votes",
            )

    cur = conn.cursor()

    # 2. Coordonnées de base + profession (sendespro, pcscod) depuis table sen
    placeholders = ",".join("?" * len(senmat_map))
    cur.execute(f"""
        SELECT trim(senmat), senema, sennumsie, sencircou, sendespro, trim(pcscod)
        FROM sen
        WHERE trim(etasencod) = 'ACTIF' AND trim(senmat) IN ({placeholders})
    """, list(senmat_map.keys()))
    sen_rows = {row[0]: row[1:] for row in cur.fetchall()}

    # 3. Mapping pcscod → (cat_soc_pro = pcs24lib, fam_soc_pro = pcs8lil)
    #    via la chaîne INSEE pcs → pcs42 → pcs24 → pcs8
    cur.execute("""
        SELECT trim(pcs.pcscod), trim(pcs24.pcs24lib), trim(pcs8.pcs8lil)
        FROM pcs
        JOIN pcs42 ON trim(pcs42.pcs42cod) = trim(pcs.pcs42cod)
        JOIN pcs24 ON trim(pcs24.pcs24cod) = trim(pcs42.pcs24cod)
        JOIN pcs8  ON trim(pcs8.pcs8cod)  = trim(pcs24.pcs8cod)
    """)
    pcs_lookup = {row[0]: (row[1], row[2]) for row in cur.fetchall()}

    # 4. Réseaux sociaux depuis table senurl (une ligne par type par sénateur)
    #    Le champ temvalcod est NULL pour la majorité des URLs (= actives par
    #    défaut) ; on n'exclut que celles explicitement archivées.
    cur.execute(f"""
        SELECT trim(senmat), typurlcod, senurlurl
        FROM senurl
        WHERE (temvalcod IS NULL OR trim(temvalcod) = '' OR trim(temvalcod) = 'ACTIF')
          AND trim(senmat) IN ({placeholders})
          AND typurlcod IN ('TWEETER','LINKEDIN','INSTAGRAM','FACEBOOK','PAGPER','BLOG')
        ORDER BY CAST(senurlnumtri AS INTEGER)
    """, list(senmat_map.keys()))

    urls_by_senmat = {}
    for senmat, typurl, url in cur.fetchall():
        urls_by_senmat.setdefault(senmat, {}).setdefault(typurl, url)

    # 4 bis. Adresse de permanence : la première de type PERM, dans l'ordre du Sénat.
    # 84 sénateurs en exercice sur 348 en ont une au 2026-10-25. Contrairement aux autres
    # coordonnées, une absence efface la colonne (point 5) : la base gardait sinon la
    # permanence d'un ancien mandat de député, affichée sur la fiche comme l'actuelle
    # (deux sénateurs au 2026-10-25), et une permanence fermée au Sénat ne partait jamais.
    # `adresses_lues` reste faux si les tables manquent : rien n'est alors effacé.
    adresses_by_senmat: dict[str, str] = {}
    adresses_lues = False
    cur.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    manquantes = TABLES_PERMANENCES - {r[0] for r in cur.fetchall()}
    if manquantes:
        signaler_anomalie(
            "sync_senat",
            f"export_sens.zip sans les tables d'adresse {sorted(manquantes)} : "
            "adresses de permanence non mises à jour",
        )
    else:
        cur.execute(f"""
            SELECT trim(p.senmat), a.adrnumvoi, b.typbisterlib, v.typvoilib, a.adrnomvoi,
                   a.adrcmp, a.adrcmp2, a.adrcodpos, a.adrcom, a.adrburdis, a.adrcdxcod,
                   a.adrcdxlib
            FROM poicon p
            JOIN adresse a ON a.poiconid = p.poiconid
            LEFT JOIN typvoi v ON v.typvoicod = a.typvoicod
            LEFT JOIN typbister b ON b.typbistercod = a.typbistercod
            WHERE trim(p.typpoiconcod) = 'PERM' AND trim(p.senmat) IN ({placeholders})
            ORDER BY CAST(p.poiconnumtri AS INTEGER), CAST(a.adrnumtri AS INTEGER), a.adrid
        """, list(senmat_map.keys()))
        for ligne in cur.fetchall():
            adresse = adresse_permanence(dict(ligne))  # `conn.row_factory` est `sqlite3.Row`
            if adresse:
                adresses_by_senmat.setdefault(ligne[0], adresse)
        adresses_lues = True
        print(f"   Adresses de permanence : {len(adresses_by_senmat)}")

    # 5. Construire les payloads, puis tout écrire en une passe. Un champ vide dans le
    # dump n'entre pas dans le payload, donc ne touche pas la colonne : la valeur déjà
    # en base reste en place, sauf l'adresse de permanence (point 4 bis). L'import de l'Assemblée n'écrit plus ces colonnes pour un
    # sénateur en exercice (`_colonnes_senat.py`), donc cette valeur vient d'une nuit
    # précédente du Sénat, ou de l'Assemblée avant le 2026-10-25, et ne se rafraîchit plus.
    payloads = []
    for senmat, info in senmat_map.items():
        uid = info["uid"]
        payload = {"uid": uid}

        sen = sen_rows.get(senmat)
        if sen:
            senema, sennumsie, sencircou, sendespro, pcscod = sen
            if sennumsie is not None:
                payload["place_hemicycle"] = str(sennumsie)
            if sencircou:
                payload["departement_election"] = sencircou
            if senema:
                payload["email"] = senema
            if sendespro:
                payload["libelle_profession"] = sendespro
            if pcscod:
                pcs_match = pcs_lookup.get(pcscod)
                if pcs_match:
                    cat_lib, fam_lib = pcs_match
                    if cat_lib:
                        payload["cat_soc_pro"] = cat_lib
                    if fam_lib:
                        payload["fam_soc_pro"] = fam_lib

        for typurl in ("TWEETER", "LINKEDIN", "INSTAGRAM", "FACEBOOK", "PAGPER", "BLOG"):
            url = (urls_by_senmat.get(senmat) or {}).get(typurl)
            if url:
                field = TYPE_TO_FIELD[typurl]
                if field not in payload:  # PAGPER prioritaire sur BLOG pour profil_url
                    payload[field] = url

        if adresses_lues:
            payload["adresse_circonscription"] = adresses_by_senmat.get(senmat)

        payload["matricule_senat"] = senmat  # toujours écrit pour maintenir le lien dump→base
        payloads.append(payload)

    colonnes = [*COLONNES_COORDONNEES_SENAT, "matricule_senat"]
    n = mettre_a_jour_par_colonnes(pg, "acteurs", "uid", {c: "text" for c in colonnes}, payloads)
    print(f"   Sénateurs enrichis : {n} modifié(s) sur {len(payloads)}")


# ===================================================================
# Étape 6 : Importer les présences en commission Sénat
# ===================================================================

# Instances dont les réunions comptent comme travail en commission, alignées sur ce que
# l'Assemblée compte de son côté : commissions permanentes, d'enquête, spéciales,
# européennes, missions, CMP, MECSS, mais aussi délégations, groupes d'amitié et groupes
# d'études, que l'agenda de l'Assemblée fait entrer dans le même compteur (COMPER, CNPE,
# CNPS, GA, DELEG, MISINFOPRE, CMP, OFFPAR, GEVI).
#
# Restent dehors : la séance plénière, qui n'a pas d'équivalent à l'Assemblée — celle-ci
# ne publie aucune feuille de présence pour l'hémicycle — et les organes de gestion
# interne (Bureau, Questure, Conférence des présidents, déontologie).
COMMISSION_TYPACTCOD = (
    "COM_PERMANENTE", "COM_SPECIALE", "COM_ENQUETE", "COM_EURO",
    "MISSION", "CMP", "MECSS", "DELEGATION", "GIA", "ETUDES",
)

# Catégories exclues, plutôt qu'une liste blanche : c'est la règle de D-141 écrite telle
# qu'elle est énoncée, « auditions et déplacements exclus », et une catégorie nouvelle
# entre dans le compte au lieu d'en disparaître sans bruit. La liste blanche `AUTRE`
# écartait 4 558 présences qui ne sont ni des auditions ni des déplacements, dont les
# 4 028 des réunions plénières de commission d'enquête.
COMMISSION_CATACTCOD_EXCLUES = ("AUDRAP", "DEPLACEMENT")
PRESENCE_SEN_TO_STATUT = {"PRESENT": "present", "EXCUSE": "excuse"}


def import_presences_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Importe les réunions de commission Sénat + présences nominatives.

    Source : tables `activite` + `activite_participant` du dump export_sens.zip.
    Mapping senmat → acteurs.uid via la colonne acteurs.matricule_senat.
    """
    cur = conn.cursor()

    # 1. Mapping senmat → uid (uniquement sénateurs avec matricule_senat renseigné).
    rows_acteurs = lire(
        pg,
        "SELECT uid, matricule_senat, est_depute_actuel FROM acteurs "
        "WHERE matricule_senat IS NOT NULL ORDER BY uid",
    )
    senmat_to_uid: dict[str, str] = {
        (r.get("matricule_senat") or "").strip(): r["uid"]
        for r in rows_acteurs
        if r.get("matricule_senat")
    }
    deputes = {r["uid"] for r in rows_acteurs if r.get("est_depute_actuel")}
    print(f"   Sénateurs avec matricule connu : {len(senmat_to_uid)}")
    # Cette étape dépend de `enrich_senateurs_coordonnees`, qui écrit `matricule_senat`.
    # Quand celle-ci tombait, celle-là « abandonnait » proprement et le script restait
    # vert : deux étapes mortes, aucun signal.
    if not senmat_to_uid:
        raise RuntimeError(
            "Aucun matricule_senat en base "
            "(l'étape « Enrichissement coordonnées sénateurs » a-t-elle réussi ?)."
        )

    # 2. Sélection des activités retenues — fenêtre = depuis la dernière élection
    # sénatoriale (cohérent avec les autres scores Sénat de LoiClair).
    placeholders = ",".join("?" for _ in COMMISSION_TYPACTCOD)
    exclues = ",".join("?" for _ in COMMISSION_CATACTCOD_EXCLUES)
    cur.execute(
        f"""
        SELECT trim(actid) AS actid,
               trim(typactcod) AS typactcod,
               trim(comcod) AS comcod,
               substr(trim(datdeb), 1, 10) AS date_reunion
        FROM activite
        WHERE trim(typactcod) IN ({placeholders})
          AND trim(catactcod) NOT IN ({exclues})
          AND datdeb IS NOT NULL AND datdeb != ''
          AND substr(trim(datdeb), 1, 10) >= ?
        """,
        (*COMMISSION_TYPACTCOD, *COMMISSION_CATACTCOD_EXCLUES, SENAT_DERNIERE_ELECTION),
    )
    activites = cur.fetchall()
    print(f"   Activités retenues : {len(activites)}")

    if not activites:
        print("   Aucune activité à importer.")
        return

    # 3. Construire payloads commission_reunions
    actids = {row["actid"] for row in activites if row["actid"]}
    reunions_payloads = [
        {
            "uid": f"SEN:{row['actid']}",
            "chambre": "SEN",
            "organe_ref": row["comcod"],
            "date_reunion": row["date_reunion"],
            "type_reunion": row["typactcod"],
            "url_source": None,
        }
        for row in activites
        if row["actid"] and row["date_reunion"]
    ]

    # 4. Récupérer les participants pour ces activités
    if not actids:
        return
    actids_list = list(actids)
    participants_rows: list[sqlite3.Row] = []
    BATCH = 500
    for i in range(0, len(actids_list), BATCH):
        sub = actids_list[i : i + BATCH]
        ph = ",".join("?" for _ in sub)
        cur.execute(
            f"""
            SELECT trim(actid) AS actid,
                   trim(senmat) AS senmat,
                   trim(typactparcod) AS typactparcod
            FROM activite_participant
            WHERE trim(actid) IN ({ph})
            """,
            sub,
        )
        participants_rows.extend(cur.fetchall())

    print(f"   Lignes activite_participant : {len(participants_rows)}")

    presences_payloads: list[dict] = []
    counts: dict[str, int] = {}
    skipped_unknown_senmat = 0
    skipped_unknown_statut = 0
    seen_keys: set[tuple[str, str]] = set()

    for p in participants_rows:
        senmat = p["senmat"]
        actid = p["actid"]
        typactparcod = p["typactparcod"]
        if not senmat or not actid:
            continue
        statut = PRESENCE_SEN_TO_STATUT.get(typactparcod or "")
        if not statut:
            skipped_unknown_statut += 1
            continue
        acteur_uid = senmat_to_uid.get(senmat)
        if not acteur_uid:
            skipped_unknown_senmat += 1
            continue
        reunion_uid = f"SEN:{actid}"
        key = (reunion_uid, acteur_uid)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        presences_payloads.append({
            "reunion_uid": reunion_uid,
            "acteur_uid": acteur_uid,
            "statut": statut,
        })
        if statut == "present":
            counts[acteur_uid] = counts.get(acteur_uid, 0) + 1

    print(f"   Présences à importer        : {len(presences_payloads)}")
    print(f"   Skip — senmat inconnu       : {skipped_unknown_senmat}")
    print(f"   Skip — statut non reconnu   : {skipped_unknown_statut}")

    # 5. Upsert
    # Un lot rejeté ne perd que ses lignes fautives, et une coupure réseau est rejouée
    # (`upsert_si_change`), qui n'écrit que les lignes nouvelles ou changées. Les pertes
    # restantes font échouer l'étape : jusqu'au 2026-09-30 elles n'étaient qu'affichées,
    # et l'étape se disait réussie.
    print("   📤 Upload réunions Sénat …")
    ecrites_r, perdues_r = upsert_si_change("commission_reunions", reunions_payloads, "uid",
                                            journal=tqdm.write)
    print("   📤 Upload présences Sénat …")
    ecrites_p, perdues_p = upsert_si_change("commission_presences", presences_payloads,
                                            "reunion_uid,acteur_uid", cle="acteur_uid",
                                            journal=tqdm.write)
    perdues = len(perdues_r) + len(perdues_p)
    print(f"   Écrites : {ecrites_r} réunion(s), {ecrites_p} présence(s)")

    # 6. Recalcul du compteur acteurs, en une transaction avec sa remise à zéro. Sans la
    # remise à zéro, un sénateur qui disparaît de la feuille de présence garderait sa
    # vieille valeur. Elle épargne les `null`, qui veulent dire « pas de commission »
    # (D-033) et sortent du score, là où un zéro veut dire « siège mais n'y va pas ».
    #
    # Les députés en exercice sont écartés du compteur, pas de la table : un ancien
    # sénateur devenu député (Létard, Bonnecarrère, Taillé-Polian, qui ont siégé au Sénat
    # depuis 2023) est compté par `import_reunions_an.py`, et son décompte du Sénat
    # remplacerait chaque nuit celui de l'Assemblée. C'est le pendant du filtre que ce
    # script applique dans l'autre sens.
    lignes = [
        {"uid": uid, "nb_commission_presences": cnt}
        for uid, cnt in sorted(counts.items())
        if uid not in deputes
    ]
    n = mettre_a_jour(
        pg, "acteurs", "uid", {"nb_commission_presences": "int"}, lignes,
        remise_a_zero="t.est_senateur_actuel",
    )
    print(f"   🔄 nb_commission_presences : {len(lignes)} sénateurs comptés, {n} modifié(s)")

    # Après le recalcul des compteurs, qui ne dépend que du dump et reste juste.
    if perdues:
        raise RuntimeError(f"{perdues} réunion(s) ou présence(s) Sénat perdues en écriture")


# ===================================================================
# Étape : mandats internes du Sénat
# ===================================================================

# Deux tables du dump mélangent plusieurs natures d'organe, et une colonne les
# distingue : `grpsenami` sépare groupes d'amitié et groupes d'études par
# `typgrpsencod`, `com` sépare permanentes, spéciales, d'enquête, missions
# d'information et CMP par `typorgcod`. On les ramène aux codes `typeOrgane` de
# l'Assemblée, seuls codes que `TYPES_MANDAT` sait traduire côté fiche élu.
#
# `COMENQSENAT` est la seule exception : l'Assemblée n'a pas de code de
# commission d'enquête, la fiche élu en déclare donc un pour le Sénat. Sans lui,
# les 84 lignes des quatre commissions d'enquête ouvertes s'afficheraient
# « Commission permanente », ce qu'elles ne sont pas.
#
# `COMEUR` (Affaires européennes) rejoint les permanentes : c'est la seule
# commission du Sénat que le dump range à part, et elle siège comme les autres.
#
# `CMP` est volontairement absent : les 55 commissions mixtes paritaires vivantes
# du dump n'ont plus une seule appartenance ouverte, donc pas une ligne à typer.
# Le jour où il y en aurait une, elle ressortirait dans le bilan de la nuit sous
# « type d'organe inconnu (CMP) », et non en silence.
TYPE_PAR_ORGANE = {
    "grpsenami": ("typgrpsencod", {"AMITIE": "GA", "ETUDES": "GE", "LIAISON": "GE", "INFO": "GE"}),
    "com": ("typorgcod", {
        "COM": "COMSENAT",
        "COMEUR": "COMSENAT",
        "COMSPE": "COMSPSENAT",
        "COMSPEAPU": "COMSPSENAT",
        "MISINFCOM": "MISINFOCOM",
        "COMENQ": "COMENQSENAT",
    }),
}

# Les libellés de `com` répètent la nature de l'organe en tête : « MI Souffrance
# psychique au travail », « CE Universités », « CS Cybersécurité ». Depuis que
# `typorgcod` porte cette nature dans la colonne `type`, la fiche l'affiche déjà
# en pastille et le préfixe fait doublon. Les 37 libellés concernés le perdent,
# les autres ne bougent pas — dont ceux qui écrivent la nature en toutes lettres
# (« Commission d'enquête sur les pratiques des industriels de l'eau en
# bouteille »), où elle est dans la phrase et non en préfixe.
PREFIXES_NATURE = ("CE ", "CS ", "MI ")

# Qualités qui ne distinguent personne : le dump écrit « Membre » en toutes
# lettres (`DELEGUEDEL`) ou un simple espace (`MEMBRECOM`, `MEMBRE`) pour
# l'appartenance ordinaire. On les écarte à l'import comme `qualiteSignificative()`
# les écarte à l'affichage. « Membre suppléant » et « Membre titulaire », eux,
# restent : ils disent quelque chose que les autres lignes ne disent pas.
QUALITES_BANALES = {"membre", "senateur", "depute"}

# Une entrée par table d'appartenance. Chaque requête porte le premier des deux
# filtres qui font tout l'enjeu de l'étape : le mandat est ACTIF **et** sa date de
# fin est nulle ou future. Filtrer sur la seule date nulle rendrait zéro ligne —
# les 30 539 lignes de `memgrpsen` en portent toutes une, les actives portant une
# date à venir. Le second filtre, l'organe encore vivant, est appliqué en Python
# contre `_organes_vivants`.
# `trim()` partout parce que le dump est en `bpchar` : 26 lignes `memcom.orgcod`
# et une ligne `com.orgcod` arrivent complétées d'espaces à droite, et sans lui
# elles ne se rejoignent pas.
# La jointure sur les fonctions donne la qualité exercée. `LEFT`, parce qu'un
# mandat sans fonction ouverte reste un mandat ; et le libellé vit dans la table
# de nomenclature (`foncom`, `fongrpsen`, `fondelega`), `fonmemcom.evelib` étant
# vide sur ses 20 246 lignes.
# Chaque table de nomenclature porte les deux genres, complets sur toutes ses
# lignes. On ramène les deux et `sen.senfem` choisit : sans cela, 112 sénatrices
# en exercice s'afficheraient « Vice-Président ».
REQUETES_MANDATS = [
    ("grpsenami", None, """
        SELECT trim(m.senmat) AS senmat, trim(m.orgcod) AS orgcod,
               substr(trim(m.memgrpsendatent), 1, 10) AS date_debut,
               f.fongrpsenlib AS qualite, f.fongrpsenlibfem AS qualite_fem
        FROM memgrpsen m
        LEFT JOIN fonmemgrpsen fm ON fm.memgrpsenid = m.memgrpsenid
              AND trim(fm.temvalcod) = 'ACTIF'
              AND (fm.fonmemgrpsendatfin IS NULL OR substr(trim(fm.fonmemgrpsendatfin), 1, 10) >= ?)
        LEFT JOIN fongrpsen f ON f.fongrpsencod = fm.fongrpsencod
        WHERE trim(m.temvalcod) = 'ACTIF'
          AND (m.memgrpsendatsor IS NULL OR substr(trim(m.memgrpsendatsor), 1, 10) >= ?)
    """),
    ("com", None, """
        SELECT trim(m.senmat) AS senmat, trim(m.orgcod) AS orgcod,
               substr(trim(m.memcomdatdeb), 1, 10) AS date_debut,
               f.foncomlib AS qualite, f.foncomlibfem AS qualite_fem
        FROM memcom m
        LEFT JOIN fonmemcom fm ON fm.memcomid = m.memcomid
              AND trim(fm.temvalcod) = 'ACTIF'
              AND (fm.fonmemcomdatfin IS NULL OR substr(trim(fm.fonmemcomdatfin), 1, 10) >= ?)
        LEFT JOIN foncom f ON f.foncomcod = fm.foncomcod
        WHERE trim(m.temvalcod) = 'ACTIF'
          AND (m.memcomdatfin IS NULL OR substr(trim(m.memcomdatfin), 1, 10) >= ?)
    """),
    ("delega", "DELEGSENAT", """
        SELECT trim(m.senmat) AS senmat, trim(m.orgcod) AS orgcod,
               substr(trim(m.memdelegadatdeb), 1, 10) AS date_debut,
               f.fondellib AS qualite, f.fondellibfem AS qualite_fem
        FROM memdelega m
        LEFT JOIN fonmemdelega fm ON fm.memdelegaid = m.memdelegaid
              AND trim(fm.temvalcod) = 'ACTIF'
              AND (fm.fonmemdeldatfin IS NULL OR substr(trim(fm.fonmemdeldatfin), 1, 10) >= ?)
        LEFT JOIN fondelega f ON f.fondelcod = fm.fondelcod
        WHERE trim(m.temvalcod) = 'ACTIF'
          AND (m.memdelegadatfin IS NULL OR substr(trim(m.memdelegadatfin), 1, 10) >= ?)
    """),
    # `memextpar` n'a pas de table de fonctions : `memextpartitsup` dit seulement
    # TITULAIRE ou SUPPLEANT. Le second est la seule chose qui distingue deux
    # lignes d'un même sénateur dans un même organisme, donc la seule chose qui
    # départage la collision de clé que cette table produit.
    ("orgext", "ORGEXTPARL", """
        SELECT trim(m.senmat) AS senmat, trim(m.orgcod) AS orgcod,
               substr(trim(m.memextpardatdeb), 1, 10) AS date_debut,
               CASE WHEN trim(m.memextpartitsup) = 'SUPPLEANT' THEN 'Membre suppléant' END AS qualite,
               CASE WHEN trim(m.memextpartitsup) = 'SUPPLEANT' THEN 'Membre suppléante' END AS qualite_fem
        FROM memextpar m
        WHERE trim(m.temvalcod) = 'ACTIF'
          AND (m.memextpardatfin IS NULL OR substr(trim(m.memextpardatfin), 1, 10) >= ?)
    """),
]

# Colonne qui porte le libellé de l'organe. `orgext` est l'exception : son
# `evelib` est vide sur les 447 lignes de la table, le nom vit dans `evelil`.
LIBELLE_ORGANE = {"grpsenami": "evelib", "com": "evelib", "delega": "evelib", "orgext": "evelil"}


def _libelle_sans_prefixe(libelle: str) -> str:
    """Retire le préfixe de nature d'un libellé de commission, et remajusculise.

    « CS numérique » devient « Numérique » : le reste du libellé commence tantôt
    par une majuscule, tantôt par une minuscule, le préfixe ayant tenu lieu de
    début de phrase. N'est appelée que sur la table `com`, seule à porter ces
    préfixes — vérifié sur le dump du 2026-09-07, zéro libellé préfixé dans
    `delega`, `grpsenami` et `orgext`.
    """
    for prefixe in PREFIXES_NATURE:
        if libelle.startswith(prefixe):
            reste = libelle[len(prefixe):].strip()
            return reste[:1].upper() + reste[1:] if reste else libelle
    return libelle


def _qualite_mandat_senat(brut: str | None) -> str | None:
    """La qualité exercée dans l'organe, si elle distingue vraiment son titulaire.

    Pendant serveur de `qualiteSignificative()` (fiche élu) : on ne stocke pas ce
    que le front effacerait à l'affichage.
    """
    propre = (brut or "").strip()
    if not propre:
        return None
    sans_accent = unicodedata.normalize("NFKD", propre).encode("ascii", "ignore").decode("ascii")
    return None if sans_accent.lower() in QUALITES_BANALES else propre


def import_mandats_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Importe les mandats internes du Sénat dans `mandats_senat`.

    Commissions, délégations, groupes d'amitié, groupes d'études et organismes
    extraparlementaires, soit ce que le jsonb `acteurs.mandats` ne dit pas : il
    vient de l'open data de l'Assemblée, qui ne connaît qu'une commission par
    sénateur et aucun groupe d'études ni d'amitié.

    Le rapprochement passe par `acteurs.matricule_senat`, comme
    `import_presences_senat`. L'étape doit donc rester après
    `enrich_senateurs_coordonnees`, qui écrit cette colonne.
    """
    cur = conn.cursor()

    # 1. Le dump porte-t-il nos tables ? Le contrôle de
    # `parse_senators_dump_to_sqlite` ne couvre que `TABLES_SENATORS` : c'est ici
    # qu'on vérifie les nôtres, pour que leur absence ne coûte que cette étape.
    cur.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    manquantes = TABLES_MANDATS - {r["name"] for r in cur.fetchall()}
    if manquantes:
        raise RuntimeError(
            f"export_sens.zip sans les tables de mandats : {sorted(manquantes)}"
        )

    # 2. senmat → uid, sur les seuls sénateurs en exercice. Le filtre compte :
    # 791 lignes du dump portent des mandats encore ouverts au nom de sénateurs
    # partis, `matricule_senat` n'étant jamais effacé de `acteurs`.
    rows_acteurs = lire(
        pg,
        "SELECT uid, matricule_senat FROM acteurs "
        "WHERE est_senateur_actuel AND matricule_senat IS NOT NULL ORDER BY uid",
    )
    senmat_to_uid: dict[str, str] = {
        (r.get("matricule_senat") or "").strip(): r["uid"]
        for r in rows_acteurs
        if r.get("matricule_senat")
    }
    print(f"   Sénateurs avec matricule connu : {len(senmat_to_uid)}")
    if not senmat_to_uid:
        raise RuntimeError(
            "Aucun matricule_senat en base "
            "(l'étape « Enrichissement coordonnées sénateurs » a-t-elle réussi ?)."
        )

    # 3. Les organes encore vivants, par table. C'est le second filtre, et le
    # seul garde-fou contre les mandats terminés : 683 lignes `memcom` marquées
    # ACTIF pointent vers des organes morts — mission « Uberisation » close en
    # 2021, commission d'enquête Lubrizol de 2019, des CMP de 2009.
    aujourdhui = date.today().isoformat()
    organes: dict[str, dict[str, sqlite3.Row]] = {}
    for table, colonne in LIBELLE_ORGANE.items():
        colonne_type = TYPE_PAR_ORGANE.get(table, (None,))[0]
        extra = f", trim({colonne_type}) AS {colonne_type}" if colonne_type else ""
        cur.execute(
            f"SELECT trim(orgcod) AS orgcod, trim({colonne}) AS libelle{extra} "
            f"FROM {table} WHERE trim(temvalcod) = 'ACTIF'"
        )
        organes[table] = {r["orgcod"]: r for r in cur.fetchall()}
    print("   Organes vivants : " + ", ".join(f"{t} {len(o)}" for t, o in organes.items()))

    # Le genre, pour accorder la qualité. `sen` vient de `TABLES_SENATORS` et est
    # donc déjà chargée ; son absence est bloquante bien avant cette étape.
    cur.execute("SELECT trim(senmat) AS senmat FROM sen WHERE trim(senfem) = 'OUI'")
    senatrices = {r["senmat"] for r in cur.fetchall()}

    # 4. Les quatre requêtes d'appartenance, fondues dans un dict indexé par la
    # clé primaire. Le dict, et non une liste : deux lignes de même clé dans un
    # même lot font lever Postgres (« ON CONFLICT DO UPDATE command cannot affect
    # row a second time »), et la jointure sur les fonctions en produit — un
    # sénateur à la fois membre et vice-président d'un groupe d'études.
    lignes: dict[tuple[str, str, str], dict] = {}
    ecartes: dict[str, int] = {}

    def ecarter(motif: str) -> None:
        ecartes[motif] = ecartes.get(motif, 0) + 1

    for table_organes, type_fixe, sql in REQUETES_MANDATS:
        params = (aujourdhui,) * sql.count("?")
        cur.execute(sql, params)
        for r in cur.fetchall():
            uid = senmat_to_uid.get(r["senmat"])
            if not uid:
                ecarter("sénateur hors exercice")
                continue
            organe = organes[table_organes].get(r["orgcod"])
            if organe is None:
                ecarter("organe éteint")
                continue
            libelle = (organe["libelle"] or "").strip()
            if not libelle:
                # Dont la pseudo-commission `NEANT`, au libellé vide, qui marque
                # le président du Sénat : il n'appartient à aucune commission, et
                # c'est sa seule ligne. 347 sénateurs sur 348, et c'est correct.
                ecarter("organe sans libellé")
                continue
            if type_fixe is None:
                colonne_type, correspondance = TYPE_PAR_ORGANE[table_organes]
                code = organe[colonne_type]
                type_mandat = correspondance.get(code)
                if not type_mandat:
                    # Le code est dans le motif : c'est lui qu'il faudra ajouter
                    # à `TYPE_PAR_ORGANE` le jour où le Sénat crée une nature
                    # d'organe qu'on ne connaît pas.
                    ecarter(f"type d'organe inconnu ({code})")
                    continue
                if table_organes == "com":
                    libelle = _libelle_sans_prefixe(libelle)
            else:
                type_mandat = type_fixe
            # Repli sur le masculin si la nomenclature n'a pas de féminin : elle
            # en a un partout aujourd'hui, mais la colonne est nullable.
            brut = (r["qualite_fem"] if r["senmat"] in senatrices else None) or r["qualite"]
            ligne = {
                "uid": uid,
                "type": type_mandat,
                "libelle": libelle,
                "qualite": _qualite_mandat_senat(brut),
                "date_debut": r["date_debut"] or None,
            }
            cle = (uid, type_mandat, libelle)
            retenue = lignes.get(cle)
            if retenue is None:
                lignes[cle] = ligne
                continue
            ecarter("doublon absorbé")
            # Même arbitrage que la déduplication par organe de la fiche élu :
            # la ligne qui porte une fonction l'emporte sur celle qui n'en porte
            # pas. Entre deux fonctions réelles (trois cas, tous des présidences
            # doublées d'une présidence déléguée), l'ordre alphabétique tranche —
            # arbitraire, mais stable d'une nuit à l'autre, là où l'ordre du dump
            # ferait changer la table sans que rien n'ait bougé au Sénat.
            if ligne["qualite"] and (
                not retenue["qualite"] or ligne["qualite"] < retenue["qualite"]
            ):
                lignes[cle] = ligne

    par_uid = {cle[0] for cle in lignes}
    print(f"   Mandats retenus : {len(lignes)} pour {len(par_uid)} sénateurs")
    for type_mandat in ("GA", "GE", "ORGEXTPARL", "COMSENAT", "COMSPSENAT",
                        "MISINFOCOM", "COMENQSENAT", "DELEGSENAT"):
        print(f"      {type_mandat:11} {sum(1 for l in lignes.values() if l['type'] == type_mandat)}")
    print(f"   Avec une qualité : {sum(1 for l in lignes.values() if l['qualite'])}")
    for motif, n in sorted(ecartes.items()):
        print(f"   Écarté — {motif} : {n}")

    # 5. Upsert d'abord, suppression ensuite. `sync_senat.py` tourne pendant que
    # les pages ISR des fiches se régénèrent : une ligne en trop pendant une
    # seconde se voit moins qu'une ligne qui manque. Un lot rejeté est coupé en deux
    # par `upsert_si_change`, jusqu'à isoler la ligne fautive, et les pertes se comptent
    # au lieu de disparaître dans un `print`.
    echecs = 0
    ecrites, perdues = upsert_si_change(
        "mandats_senat", list(lignes.values()), "uid,type,libelle", journal=tqdm.write
    )
    echecs += len(perdues)
    print(f"   Mandats écrits : {ecrites}")

    # 6. Réconciliation plutôt que purge : vider la table d'un coup la laisserait
    # vide le temps de la réinsertion, sous les yeux des pages qui se régénèrent.
    anciennes = {
        (l["uid"], l["type"], l["libelle"])
        for l in lire(pg, "SELECT uid, type, libelle FROM mandats_senat")
    }

    obsoletes = sorted(anciennes - set(lignes))
    if obsoletes:
        print(f"   🗑️  {len(obsoletes)} mandats disparus du dump")
        try:
            pg.execute(
                """
                DELETE FROM mandats_senat t
                USING unnest(%s::text[], %s::text[], %s::text[]) AS v(uid, type, libelle)
                WHERE t.uid = v.uid AND t.type = v.type AND t.libelle = v.libelle
                """,
                ([o[0] for o in obsoletes], [o[1] for o in obsoletes], [o[2] for o in obsoletes]),
            )
        except psycopg.Error as e:
            echecs += len(obsoletes)
            tqdm.write(f"❌ Suppression de {len(obsoletes)} mandats : {type(e).__name__}: {e}")

    # 7. Lever, pour que l'étape entre dans `echecs` et que le script sorte en 1.
    if echecs:
        raise RuntimeError(f"{echecs} lignes n'ont pas été écrites dans mandats_senat")


# ===================================================================
# Étape : cosignataires des textes du Sénat
# ===================================================================


def _build_autcod_to_uid_map(conn: sqlite3.Connection, pg: psycopg.Connection) -> dict:
    """Construit un mapping autcod (dump Sénat) → uid, par nom normalisé.

    Même principe que `_build_senmat_to_uid_map`, mais sur `autcod` : c'est la clé que
    `ecr` utilise pour désigner un signataire, alors que `votsen` utilise `autmat`.
    """
    senateurs = lire(pg, "SELECT uid, nom, prenom FROM acteurs WHERE est_senateur_actuel ORDER BY uid")
    par_nom = {}
    for s in senateurs:
        cle = (_normalize_name(s["nom"] or ""), _normalize_name(s["prenom"] or ""))
        if cle in par_nom:
            print(f"   ⚠️  Homonymes : {s['prenom']} {s['nom']} — {par_nom[cle]} et {s['uid']} "
                  f"partagent le même nom normalisé, leurs cosignatures seront confondues.")
        par_nom[cle] = s["uid"]

    cur = conn.cursor()
    cur.execute(
        "SELECT trim(autcod) AS autcod, trim(nomuse) AS nom, trim(prenom) AS prenom "
        "FROM auteur WHERE trim(typautcod) = '1' AND autcod IS NOT NULL AND trim(autcod) != ''"
    )
    mapping = {}
    for row in cur.fetchall():
        cle = (_normalize_name(row["nom"] or ""), _normalize_name(row["prenom"] or ""))
        if cle in par_nom:
            mapping[row["autcod"]] = par_nom[cle]
    return mapping


def import_cosignataires_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Remplit `textes.cosignataires_refs` pour les textes du Sénat.

    Nos lignes `textes` viennent toutes de l'open data de l'Assemblée, qui résume les
    signataires d'un texte sénatorial à trois en moyenne. Le Sénat, lui, publie la liste
    complète dans `ecr`, avec le rôle de chacun (`rolsig` : `o` primo-signataire,
    `n` coauteur, `p` président). On ne garde que les coauteurs : le primo-signataire est
    l'initiateur, que le score écarte déjà.

    Le rattachement passe par (numéro de texte, année de session, nature), la même clé
    que `_find_texte_url` (voir `nature_texte_senat`). Sur la seule paire numéro-session,
    75 propositions et projets déposés depuis octobre 2023 tombaient au 2026-10-19 sur un
    texte de l'Assemblée de même numéro, signé de députés que `autcod_map` ne connaît
    pas : rien ne s'écrivait. La clé à trois termes a rendu ce jour-là 1 491
    cosignatures à 43 d'entre eux, et leur liste d'auteurs à 17. Les rapports
    (`RAPPSNR`) n'ont pas leur place dans la table `texte` : ils sont écartés au lieu
    d'être rattachés au hasard d'un numéro.
    """
    autcod_map = _build_autcod_to_uid_map(conn, pg)
    print(f"   Sénateurs matchés (autcod → uid) : {len(autcod_map)}")
    if not autcod_map:
        raise RuntimeError("Aucun sénateur matché (autcod → uid) entre le dump et la base.")

    textes = [
        t for t in lire(
            pg,
            "SELECT uid, date_depot FROM textes WHERE chambre = %s AND date_depot >= %s ORDER BY uid",
            ("Sénat", SENAT_DERNIERE_ELECTION),
        )
        if t["uid"].startswith(("PIONSNR", "PRJLSNR"))
    ]
    print(f"   Textes Sénat dans la fenêtre du mandat : {len(textes)}")
    if not textes:
        return

    cur = conn.cursor()

    # (texnum, sesann, nature) → texcod, la nature étant le préfixe de `texurl`. Les
    # lignes d'une autre forme (textes de l'Assemblée, URL absolues) n'entrent pas.
    # `CAST` rend 0 sur une valeur non numérique au lieu d'échouer : le GLOB écarte ces
    # lignes en amont plutôt que de laisser entrer une clé (0, session) qui ne désigne rien.
    cur.execute(
        "SELECT trim(texcod) AS texcod, CAST(texnum AS INTEGER) AS texnum, CAST(sesann AS INTEGER) AS sesann, "
        "substr(trim(texurl), 1, 3) AS nature "
        "FROM texte WHERE texnum GLOB '[0-9]*' AND sesann GLOB '[0-9]*' "
        "AND substr(trim(texurl), 1, 3) IN ('tas', 'ppl', 'pjl')"
    )
    texcod_par_cle = {}
    for row in cur.fetchall():
        texcod_par_cle.setdefault((row["texnum"], row["sesann"], row["nature"]), row["texcod"])

    # texcod → uid, par rôle, dans l'ordre du dump. Le rôle `o` désigne les
    # primo-signataires, et le Sénat en déclare souvent plusieurs sur un même texte (310
    # depuis le 2023-10-02, deux à cinq le plus souvent), tous auteurs à égalité.
    # L'open data de l'Assemblée, d'où viennent nos `auteurs_refs`, ne fait pas la
    # distinction et y empile tous les signataires : 5,2 par texte sénatorial en moyenne,
    # jusqu'à 100. C'est donc ici que `auteurs_refs` est remis d'aplomb, comme
    # `cosignataires_refs` l'est déjà (D-116).
    par_role: dict[str, dict[str, list]] = {"o": {}, "n": {}}
    cur.execute(
        "SELECT trim(texcod) AS texcod, trim(autcod) AS autcod, trim(signataire) AS role FROM ecr "
        "WHERE trim(signataire) IN ('o', 'n') AND texcod IS NOT NULL AND autcod IS NOT NULL"
    )
    for row in cur.fetchall():
        uid = autcod_map.get(row["autcod"])
        if not uid:
            continue
        liste = par_role[row["role"]].setdefault(row["texcod"], [])
        if uid not in liste:
            liste.append(uid)
    coauteurs_par_texcod = par_role["n"]
    auteurs_par_texcod = par_role["o"]

    updates = []
    sans_correspondance = 0
    for texte in textes:
        texnum = extract_num_from_uid(texte["uid"])
        sesann = sesann_from_date(texte.get("date_depot"))
        if texnum is None or sesann is None:
            sans_correspondance += 1
            continue
        texcod = texcod_par_cle.get((texnum, sesann, nature_texte_senat(texte["uid"])))
        if texcod is None:
            sans_correspondance += 1
            continue
        champs = {}
        cosign = coauteurs_par_texcod.get(texcod)
        if cosign:
            champs["cosignataires_refs"] = cosign
        auteurs = auteurs_par_texcod.get(texcod)
        if auteurs:
            champs["auteurs_refs"] = auteurs
        if champs:
            updates.append((texte["uid"], champs))

    print(f"   Textes rattachés au dump : {len(textes) - sans_correspondance}/{len(textes)}")
    print(f"   Textes corrigés : {len(updates)}")
    print(f"   Cosignatures : {sum(len(u[1].get('cosignataires_refs') or []) for u in updates)}")
    print(f"   Auteurs remis d'aplomb : {sum(len(u[1].get('auteurs_refs') or []) for u in updates)}")

    # Une seule passe, qui ne réécrit que les textes dont une liste a changé, ordre
    # compris : `import_textes_cloud` ne remet la version de l'Assemblée que sur les
    # textes dont une colonne comparée a bougé, donc en général quelques-uns par nuit.
    # Les auteurs et cosignataires des textes du Sénat n'y sont pas comparés
    # (`sans_comparer`) : ils ne rouvrent pas un texte à eux seuls.
    n = mettre_a_jour_par_colonnes(
        pg, "textes", "uid",
        {"cosignataires_refs": "text[]", "auteurs_refs": "text[]"},
        [{"uid": uid, **champs} for uid, champs in updates],
    )
    print(f"   Textes réécrits : {n}")


# ===================================================================
# Étape : rapports de contrôle du Sénat
# ===================================================================

# Tables du dump dosleg dont dépend l'étape. Vérifiées ici et non dans
# `parse_dump_to_sqlite`, dont le contrôle de complétude ne porte que sur le dump
# sénateurs : une étape qui manque sa source doit échouer seule, pas emporter les autres.
TABLES_RAPPORTS = {"rap", "denrap", "ecr", "auteur"}

# Les trois natures de rapport que le Sénat produit hors examen d'un texte : information,
# commission d'enquête, office parlementaire. Les études de législation comparée (LCOMP)
# en sont exclues — travaux administratifs des services, sans auteur parlementaire.
#
# Chaque nature reçoit la forme que l'Assemblée donne déjà à la sienne, pour que la vue
# d'activité n'ait qu'une seule liste de procédures à connaître et que le filtre par type
# de `/dossiers-legislatifs` ne gagne aucune option : procédure 19 pour un rapport
# d'information, 9 pour une commission d'enquête.
NATURES_RAPPORT_CONTROLE = {
    "INFOR": ("19", "Rapport d'information sans mission", "RINF", "Rapport d'information"),
    "OFFPA": ("19", "Rapport d'information sans mission", "RINF", "Rapport d'information"),
    "ENQUE": ("9", "Commission d'enquête", "RAPP", "Rapport"),
}


def _uid_rapport_controle(sesann: str, num: int) -> tuple[str, str]:
    """Rend (uid du texte, uid du dossier) d'un rapport de contrôle.

    Trois contraintes portent ces préfixes, chacune vérifiée dans le code existant :
    `deduire_chambre` (import_textes_cloud) rend « Sénat » sur un uid contenant `SNR` ;
    `extract_num_from_uid` capture un numéro sur un uid finissant par `B<chiffres>`, ce
    qui ferait lire un numéro de rapport comme un numéro de texte par
    `import_cosignataires_senat` ; et deux scripts déduisent une législature de
    l'Assemblée d'un uid de dossier commençant par `DLR5L`. D'où un uid qui porte `SNR`,
    ne finit pas par `B<chiffres>`, et ne commence pas par `DLR5L`.

    Le padding à quatre chiffres est obligatoire : sans lui, les rapports 902 et 0902
    d'une même session produiraient deux lignes pour le même rapport.
    """
    return f"RCTLSNR{sesann}N{num:04d}", f"DSNRAP{sesann}N{num:04d}"


def import_rapports_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Crée un dossier, un texte et deux actes par rapport de contrôle du Sénat.

    Ces rapports n'existent nulle part en base : nos lignes `textes` viennent de l'open
    data de l'Assemblée, qui ne publie que ce qui touche un de ses dossiers. Les 400 et
    quelques rapports d'information, d'enquête et d'office du Sénat ne comptaient donc
    dans aucune métrique, alors que leurs équivalents de l'Assemblée y comptent.

    Un rapport en plusieurs tomes est une seule mission : le regroupement se fait sur
    (session, numéro), sans quoi un rapport en trois tomes vaudrait trois rapports.

    Le dossier n'a pas d'initiateur — c'est une commission qui décide de se saisir d'un
    sujet, pas une personne — ce qui reproduit exactement l'état des dossiers de rapport
    d'information de l'Assemblée et évite que ces rapports comptent aussi en « dossier
    initié ». Pour la même raison, le texte ne porte que `rapporteurs_refs`.
    """
    cur = conn.cursor()
    presentes = {r["name"] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    manquantes = TABLES_RAPPORTS - presentes
    if manquantes:
        raise RuntimeError(f"Tables absentes du dump dosleg : {', '.join(sorted(manquantes))}")

    autcod_map = _build_autcod_to_uid_map(conn, pg)
    print(f"   Sénateurs matchés (autcod → uid) : {len(autcod_map)}")
    if not autcod_map:
        raise RuntimeError("Aucun sénateur matché (autcod → uid) entre le dump et la base.")

    # Un rapport = une ligne par tome. On garde le titre et l'URL du premier tome, le
    # `min(date_depot)` de la mission, et `group_concat` des rapcod pour retrouver les
    # auteurs de tous les tomes. `rapnum` peut être nul ou non numérique : le filtre
    # GLOB écarte ces lignes plutôt que de les laisser miner l'uid N0000.
    cur.execute(
        """
        SELECT r.sesann,
               CAST(r.rapnum AS INTEGER)          AS num,
               d.typraprap                        AS nature,
               MIN(r.date_depot)                  AS depot,
               group_concat(r.rapcod)             AS rapcods,
               -- Le tome 1 porte le titre de la mission ; les suivants portent le leur.
               (SELECT COALESCE(NULLIF(trim(r2.raptil), ''), trim(r2.raptitcou))
                  FROM rap r2 WHERE r2.sesann = r.sesann AND r2.rapnum = r.rapnum
                 ORDER BY COALESCE(r2.raptom, 0) LIMIT 1)  AS titre,
               (SELECT trim(r3.rapurl)
                  FROM rap r3 WHERE r3.sesann = r.sesann AND r3.rapnum = r.rapnum
                 ORDER BY COALESCE(r3.raptom, 0) LIMIT 1)  AS url
          FROM rap r
          JOIN denrap d ON d.coddenrap = r.coddenrap
         WHERE r.date_depot >= ?
           AND d.typraprap IN ('INFOR', 'OFFPA', 'ENQUE')
           AND r.rapnum GLOB '[0-9]*'
           -- Session 0 : trois rapports de l'Assemblée que le dump du Sénat référence
           -- pour mémoire, sans titre et avec une URL assemblee-nationale.fr. Ils sont
           -- déjà en base par l'open data de l'Assemblée.
           AND trim(r.sesann) != '0'
         GROUP BY r.sesann, r.rapnum
        """,
        (SENAT_DERNIERE_ELECTION,),
    )
    missions = cur.fetchall()
    print(f"   Rapports de contrôle depuis {SENAT_DERNIERE_ELECTION} : {len(missions)}")

    # Auteurs : rôle `o` seulement. Le rôle `p` désigne le président de la commission
    # d'enquête, que l'Assemblée ne liste jamais parmi les rapporteurs — le compter
    # créerait un écart entre les deux chambres au lieu d'en corriger un.
    auteurs_par_rapcod: dict[str, list[str]] = {}
    cur.execute(
        "SELECT rapcod, trim(autcod) AS autcod FROM ecr "
        "WHERE rapcod IS NOT NULL AND trim(signataire) = 'o'"
    )
    for row in cur.fetchall():
        auteurs_par_rapcod.setdefault(str(row["rapcod"]), []).append(row["autcod"])

    dossiers, textes, actes = [], [], []
    sans_auteur = sans_titre = 0
    for m in missions:
        nature = NATURES_RAPPORT_CONTROLE[m["nature"]]
        proc_code, proc_libelle, type_code, type_libelle = nature
        titre = _nettoyer_texte_dump(m["titre"])
        if not titre:
            sans_titre += 1
            continue

        uid_texte, uid_dossier = _uid_rapport_controle(m["sesann"], m["num"])
        depot = (m["depot"] or "")[:10] or None

        refs = []
        for rapcod in (m["rapcods"] or "").split(","):
            for autcod in (auteurs_par_rapcod.get(rapcod) or []):
                uid = autcod_map.get(autcod)
                if uid and uid not in refs:
                    refs.append(uid)
        if not refs:
            sans_auteur += 1

        dossiers.append({
            "uid": uid_dossier,
            "legislature": 17,
            "titre": titre,
            "procedure_code": proc_code,
            "procedure_libelle": proc_libelle,
            "statut_final": "Publié",
            "date_depot": depot,
            # Pas de `themes` : generate_search_summaries.py les écrit, et cet upsert
            # écrit toutes les colonnes de son payload dès qu'une ligne change.
            "lien_senat": build_full_senat_url(m["url"], is_rapport=True),
        })
        textes.append({
            "uid": uid_texte,
            "dossier_ref": uid_dossier,
            "chambre": "Sénat",
            "type_code": type_code,
            "type_libelle": type_libelle,
            "denomination": type_libelle,
            "depot_code": "RAPAUT",
            "depot_libelle": "Rapport autonome",
            "provenance": "Commission",
            "titre_principal": titre,
            "titre_principal_court": titre[:250],
            "date_depot": depot,
            "num_notice": str(m["num"]),
            "lien_texte": build_full_senat_url(m["url"], is_rapport=True),
            "rapporteurs_refs": refs or None,
        })
        # Deux actes, comme l'Assemblée en pose sur ses rapports d'information : une
        # racine sans date, puis le dépôt daté. Le suffixe `-RAPPORT` est ce que
        # `acteLabelKey` (src/lib/legislative-steps.ts) traduit déjà en « Dépôt de
        # rapport », dans les deux langues et sans nouvelle clé.
        actes.append({
            "uid": f"SN20-{m['sesann']}-{m['num']:04d}",
            "dossier_uid": uid_dossier,
            "code_acte": "SN20",
            "libelle_acte": "Travaux",
        })
        actes.append({
            "uid": f"SN20-RAPPORT-{m['sesann']}-{m['num']:04d}",
            "dossier_uid": uid_dossier,
            "code_acte": "SN20-RAPPORT",
            "libelle_acte": "Dépôt de rapport",
            "date_acte": depot,
        })

    print(f"   Dossiers à écrire : {len(dossiers)} · textes : {len(textes)} · actes : {len(actes)}")
    print(f"   Rapports sans auteur identifié : {sans_auteur} · sans titre (ignorés) : {sans_titre}")
    porteurs = {ref for t in textes for ref in (t["rapporteurs_refs"] or [])}
    print(f"   Sénateurs porteurs d'au moins un rapport : {len(porteurs)}")

    # Avant le mode sec, pour qu'un essai à blanc signale aussi un statut inconnu.
    verifier_statuts(dossiers)

    if DRY_RUN:
        print("   MODE SEC : rien n'est écrit.")
        return

    _verifier_urls_nouveaux_textes(pg, textes)

    for table, payloads, conflit in (
        ("dossiers_legislatifs", dossiers, "uid"),
        ("textes", textes, "uid"),
        ("actes_legislatifs", actes, "uid,dossier_uid"),
    ):
        print(f"   📤 Upload {table} ({len(payloads)}) …")
        print(f"      {ecrire(table, payloads, conflit)} ligne(s) écrite(s)")


# Les cinq natures de proposition de résolution du Sénat, ramenées aux deux procédures
# que l'Assemblée utilise pour les siennes. `enq` (proposition tendant à créer une
# commission d'enquête) est bien une résolution qui crédite son auteur : à l'Assemblée,
# elle est rangée en « Résolution » avec son initiateur, et c'est le dossier de la
# commission elle-même, créé ensuite, qui n'a pas d'initiateur.
NATURES_RESOLUTION = {
    "pac":  ("8", "Résolution"),
    "ppra": ("8", "Résolution"),
    "ppre": ("8", "Résolution"),
    "enq":  ("8", "Résolution"),
    "pprp": ("22", "Résolution Article 34-1"),
}

# `loi.etaloicod` → `statut_final`, d'après la table `etaloi` du dump : 04 « promulgué ou
# adopté (ppr) », 03 « rejeté », 06 « retiré », comme un texte de l'Assemblée retiré par
# son auteur (`a_ete_retire`, `import_dossiers_cloud.py`). Les autres états (01 en cours,
# 05 caduc) restent « déposés », comme les dossiers de l'Assemblée dans le même cas. Au 2026-10-09, les comptes recoupent les
# textes du dump : 59 adoptées pour 59 textes « adopté » ou « devenu résolution du
# Sénat », 1 rejetée pour 1 texte « rejeté par le Sénat ».
STATUT_RESOLUTION = {
    "04": "Adopté par le Sénat",
    "03": "Rejeté",
    "06": "Retiré",
}


def _ranger_dans_groupe_au_depot(pg: psycopg.Connection, dossiers: list[dict]) -> int:
    """Remplit `initiateur_groupe_uid` et `initiateur_groupe_libelle` des `dossiers`.

    Même règle que les propositions de l'Assemblée dans `import_dossiers_cloud.py` : le
    groupe de l'initiateur le jour du dépôt, lu dans `acteurs.historique_groupes`, sans
    repli sur son groupe actuel. Sans ces colonnes, les 88 résolutions du Sénat déposées
    par un auteur identifié restaient sans groupe au 2026-10-08, et sortaient des taux
    par groupe de /Facts/succes-legislatif/efficacite. Rend le nombre de dossiers ayant
    un initiateur mais pas de groupe ce jour-là. Appelée par `import_resolutions_senat`.
    """
    refs = sorted({d["initiateur_acteur_ref"] for d in dossiers if d["initiateur_acteur_ref"]})
    historiques: dict[str, list[dict] | None] = {
        row["uid"]: row["historique_groupes"]
        for row in lire(pg, "SELECT uid, historique_groupes FROM acteurs WHERE uid = ANY(%s)", (refs,))
    }

    groupes: dict[str, str | None] = {
        d["uid"]: groupe_au_depot(historiques.get(d["initiateur_acteur_ref"]), d["date_depot"])
        if d["initiateur_acteur_ref"] else None
        for d in dossiers
    }

    uids = sorted({g for g in groupes.values() if g})
    libelles: dict[str, str] = {
        row["uid"]: row["libelle"]
        for row in lire(pg, "SELECT uid, libelle FROM organes WHERE uid = ANY(%s)", (uids,))
    }

    sans_groupe = 0
    for d in dossiers:
        groupe = groupes[d["uid"]]
        d["initiateur_groupe_uid"] = groupe
        d["initiateur_groupe_libelle"] = libelles.get(groupe) if groupe else None
        if d["initiateur_acteur_ref"] and not groupe:
            sans_groupe += 1
    return sans_groupe


def import_resolutions_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Crée les dossiers des propositions de résolution déposées au Sénat.

    Elles n'existent pas en base — l'open data de l'Assemblée ne les transporte pas —
    alors que ses 407 résolutions à elle comptent en « dossier initié ». Un sénateur qui
    dépose une proposition de résolution européenne n'en tirait donc rien.
    """
    cur = conn.cursor()
    presentes = {r["name"] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    manquantes = {"texte", "lecass", "lecture", "loi", "ecr", "auteur"} - presentes
    if manquantes:
        raise RuntimeError(f"Tables absentes du dump dosleg : {', '.join(sorted(manquantes))}")

    autcod_map = _build_autcod_to_uid_map(conn, pg)
    print(f"   Sénateurs matchés (autcod → uid) : {len(autcod_map)}")
    if not autcod_map:
        raise RuntimeError("Aucun sénateur matché (autcod → uid) entre le dump et la base.")

    # `oritxtcod = '1'` : « déposé au Sénat », donc le texte initial et non une version
    # de commission ou un texte transmis. Un dossier peut en porter plusieurs (dépôt
    # rectifié) : on garde le plus ancien, celui qui vaut dépôt.
    cur.execute(
        """
        SELECT l.loicod                    AS loicod,
               l.typloicod                 AS nature,
               t.txtoritxtdat              AS depot,
               t.texcod                    AS texcod,
               t.sesann                    AS sesann,
               CAST(t.texnum AS INTEGER)   AS num,
               trim(t.texurl)              AS url,
               trim(l.etaloicod)           AS etat,
               trim(l.loiint)              AS titre_court,
               trim(l.loitit)              AS titre_long
          FROM texte t
          JOIN lecass la  ON la.lecassidt = t.lecassidt
          JOIN lecture lc ON lc.lecidt    = la.lecidt
          JOIN loi l      ON l.loicod     = lc.loicod
         -- `trim` obligatoire : le dump vient de colonnes CHAR(n), dont le parseur
         -- garde le remplissage à blanc. `oritxtcod = '1'` ne rend rien, alors que
         -- `trim(oritxtcod) = '1'` rend les 9 982 dépôts au Sénat.
         WHERE trim(t.oritxtcod) = '1'
           AND t.txtoritxtdat >= ?
           AND trim(l.typloicod) IN ('pac', 'ppra', 'ppre', 'enq', 'pprp')
           AND t.texnum GLOB '[0-9]*'
           AND trim(t.sesann) != '0'
         ORDER BY t.txtoritxtdat
        """,
        (SENAT_DERNIERE_ELECTION,),
    )
    # Un dossier peut porter plusieurs dépôts (texte rectifié) : le premier vaut dépôt.
    # Le tri par date rend le regroupement déterministe.
    par_dossier: dict[str, sqlite3.Row] = {}
    for row in cur.fetchall():
        par_dossier.setdefault(row["loicod"], row)
    resolutions = list(par_dossier.values())

    # Deux rôles distincts sur un texte : `o` le primo-signataire, qui devient
    # l'initiateur du dossier, `n` les coauteurs, qui deviennent ses cosignataires.
    #
    # Ces cosignatures sont écrites ici et non par `import_cosignataires_senat`, qui
    # retrouve un texte par `extract_num_from_uid` : cette fonction exige un uid
    # finissant par `B<chiffres>`, ce que nos uid n'ont volontairement pas. Sans ces
    # lignes, les 2 045 cosignatures de résolution du Sénat ne compteraient nulle part,
    # alors que les 19 111 de l'Assemblée comptent.
    primo: dict[str, list[str]] = {}
    coauteurs: dict[str, list[str]] = {}
    cur.execute(
        "SELECT texcod, trim(autcod) AS autcod, trim(signataire) AS role FROM ecr "
        "WHERE texcod IS NOT NULL AND trim(signataire) IN ('o', 'n')"
    )
    for row in cur.fetchall():
        cible = primo if row["role"] == "o" else coauteurs
        cible.setdefault(str(row["texcod"]), []).append(row["autcod"])

    dossiers, textes, actes = [], [], []
    sans_auteur = 0
    for r in resolutions:
        proc_code, proc_libelle = NATURES_RESOLUTION[(r["nature"] or "").strip()]
        titre = _nettoyer_texte_dump(r["titre_long"]) or _nettoyer_texte_dump(r["titre_court"])
        if not titre:
            continue
        uid_texte = f"PRESSNR{r['sesann']}N{r['num']:04d}"
        uid_dossier = f"DSNRES{r['sesann']}N{r['num']:04d}"
        depot = (r["depot"] or "")[:10] or None

        # Le premier signataire est l'initiateur du dossier ; les suivants sont des
        # coauteurs, que `import_cosignataires_senat` traite déjà pour les autres textes.
        initiateur = None
        for autcod in (primo.get(str(r["texcod"])) or []):
            initiateur = autcod_map.get(autcod)
            if initiateur:
                break
        if not initiateur:
            sans_auteur += 1

        cosignataires = []
        for autcod in (coauteurs.get(str(r["texcod"])) or []):
            uid = autcod_map.get(autcod)
            if uid and uid != initiateur and uid not in cosignataires:
                cosignataires.append(uid)

        dossiers.append({
            "uid": uid_dossier,
            "legislature": 17,
            "titre": titre,
            "procedure_code": proc_code,
            "procedure_libelle": proc_libelle,
            # Toujours un libellé de `STATUT_MAP` (`src/lib/statut.ts`) : toute autre
            # valeur s'y affiche en clair, comme `en_cours` jusqu'au 2026-10-09.
            # verifier_statuts l'impose avant l'écriture.
            "statut_final": STATUT_RESOLUTION.get(r["etat"] or "", "Déposé - pas encore voté"),
            "date_depot": depot,
            "initiateur_acteur_ref": initiateur,
            # Pas de `themes` : generate_search_summaries.py les écrit, et cet upsert
            # écrit toutes les colonnes de son payload dès qu'une ligne change.
        })
        textes.append({
            "uid": uid_texte,
            "dossier_ref": uid_dossier,
            "chambre": "Sénat",
            "type_code": "PNRE",
            "type_libelle": "Proposition de résolution",
            "denomination": "Proposition de résolution",
            "depot_code": "INITDEP",
            "depot_libelle": "Initiative en 1er Dépôt",
            "provenance": "Texte Déposé",
            "titre_principal": titre,
            "titre_principal_court": titre[:250],
            "date_depot": depot,
            "num_notice": str(r["num"]),
            "lien_texte": build_full_senat_url(r["url"], is_rapport=False),
            "auteurs_refs": [initiateur] if initiateur else None,
            "cosignataires_refs": cosignataires or None,
        })
        actes.append({
            "uid": f"SNLUNI-{r['sesann']}-{r['num']:04d}",
            "dossier_uid": uid_dossier,
            "code_acte": "SNLUNI",
            "libelle_acte": "Lecture unique",
        })
        actes.append({
            "uid": f"SNLUNI-DEPOT-{r['sesann']}-{r['num']:04d}",
            "dossier_uid": uid_dossier,
            "code_acte": "SNLUNI-DEPOT",
            "libelle_acte": "1er dépôt d'une initiative.",
            "date_acte": depot,
        })

    sans_groupe = _ranger_dans_groupe_au_depot(pg, dossiers)

    print(f"   Propositions de résolution depuis {SENAT_DERNIERE_ELECTION} : {len(dossiers)}")
    print(f"   Sans initiateur identifié : {sans_auteur}")
    print(f"   Initiateur sans groupe connu le jour du dépôt : {sans_groupe}")
    total_cosign = sum(len(t["cosignataires_refs"] or []) for t in textes)
    print(f"   Cosignatures rattachées : {total_cosign}")

    verifier_statuts(dossiers)

    if DRY_RUN:
        print("   MODE SEC : rien n'est écrit.")
        return

    _verifier_urls_nouveaux_textes(pg, textes, prefixe="PRESSNR%")

    for table, payloads, conflit in (
        ("dossiers_legislatifs", dossiers, "uid"),
        ("textes", textes, "uid"),
        ("actes_legislatifs", actes, "uid,dossier_uid"),
    ):
        print(f"   📤 Upload {table} ({len(payloads)}) …")
        print(f"      {ecrire(table, payloads, conflit)} ligne(s) écrite(s)")


# ===================================================================
# Étape : dossiers de loi du Sénat que l'Assemblée ne publie pas
# ===================================================================

# Fin de la fenêtre que l'étape comble. Le dump de l'Assemblée (17ᵉ législature), d'où
# viennent nos dossiers de loi, porte tous les textes du Sénat déposés depuis cette
# date, mais avant elle seulement ceux qui sont passés par l'Assemblée. Le score des
# sénateurs compte pourtant depuis le 2023-10-02 : au 2026-10-29, 214 dossiers ayant
# une activité au Sénat dans l'intervalle manquaient, et avec eux leurs textes,
# rapports, cosignatures, amendements et débats. La borne est nécessaire : après elle,
# un dossier absent de la base est un dossier que l'Assemblée n'a pas encore publié, et
# le créer ici ferait un doublon le lendemain.
FIN_FENETRE_LOIS_SENAT = "2024-07-18"

# `loi.typloicod` → (procedure_code, procedure_libelle, nature écrite en tête du titre).
# Codes et libellés de procédure sont ceux que l'Assemblée donne à ses dossiers de même
# nature, pour que la vue d'activité et le filtre par type de /dossiers-legislatifs
# n'aient rien de neuf à connaître. Les résolutions n'y sont pas :
# `import_resolutions_senat` les traite.
NATURES_LOI = {
    "ppl":  ("2", "Proposition de loi ordinaire", "Proposition de loi"),
    "ppro": ("2", "Proposition de loi ordinaire", "Proposition de loi"),
    "pplo": ("5", "Projet ou proposition de loi organique", "Proposition de loi organique"),
    "pplc": ("7", "Projet ou proposition de loi constitutionnelle", "Proposition de loi constitutionnelle"),
    "pjl":  ("1", "Projet de loi ordinaire", "Projet de loi"),
    "prog": ("1", "Projet de loi ordinaire", "Projet de loi"),
    "pjlo": ("5", "Projet ou proposition de loi organique", "Projet de loi organique"),
    "pjlc": ("7", "Projet ou proposition de loi constitutionnelle", "Projet de loi constitutionnelle"),
    "cvn":  ("6", "Projet de ratification des traités et conventions", "Projet de loi"),
    "pjlf": ("3", "Projet de loi de finances de l'année", "Projet de loi de finances"),
    "pjlr": ("21", "Projet de loi de finances rectificative", "Projet de loi de finances rectificative"),
    "pjfs": ("4", "Projet de loi de financement de la sécurité sociale",
             "Projet de loi de financement de la sécurité sociale"),
}

# `texte.oritxtcod` (table `oritxt` du dump) des textes qui disent une adoption par
# chaque chambre : `oritxtado` à O ou D, hors commission (29, 30, 23, 33).
ORIGINES_ADOPTE_SENAT = {"2", "6", "7", "9", "11"}
ORIGINES_ADOPTE_AN = {"5", "14", "17", "18", "19", "22", "44"}
# Adoption définitive (`oritxtado` à D) : 9 par le Sénat, 14 et 44 par l'Assemblée.
ORIGINES_ADOPTE_DEFINITIF = {"9", "14", "44"}

# Préfixes d'uid des dossiers créés par `import_lois_senat`, lus aussi par
# `import_avis_senat` pour ne leur rattacher que les rapports au fond.
UID_DOSSIERS_LOI_SENAT = ("DSNPPL", "DSNPJL", "DSNPLF", "DSNPSS")

# (`lecass.codass`, `lecture.typleccod`) → étape du parcours de la fiche (`STEP_CONFIG`).
# `codass` : S Sénat, A Assemblée, I commission mixte paritaire ; `typleccod` : table
# `typlec` du dump (1 première lecture, 2 deuxième, 4 CMP, 5 nouvelle, 6 définitive).
ETAPES_LECTURE = {
    ("A", "1"): "AN1", ("S", "1"): "SN1", ("I", "4"): "CMP",
    ("A", "2"): "AN2", ("S", "2"): "SN2",
    ("A", "5"): "ANNLEC", ("S", "5"): "SNNLEC", ("A", "6"): "ANLDEF",
}
# Étape → (libellé de l'étape, libellé de son acte daté quand ce n'est pas le premier
# du dossier), repris des actes de l'Assemblée de même code (relevé en base le
# 2026-10-29). Une première lecture précise en plus la chambre saisie en premier.
LIBELLES_ETAPE = {
    "AN1": ("1ère lecture", "Dépôt d'une initiative en navette"),
    "SN1": ("1ère lecture", "Dépôt d'une initiative en navette"),
    "CMP": ("Commission Mixte Paritaire", "Décision de la CMP"),
    "AN2": ("deuxième lecture", "Dépôt d'une initiative en navette"),
    "SN2": ("deuxième lecture", "Dépôt d'une initiative en navette"),
    "ANNLEC": ("Nouvelle Lecture", "Dépôt d'une initiative en navette"),
    "SNNLEC": ("Nouvelle Lecture", "Dépôt d'une initiative en navette"),
    "ANLDEF": ("Lecture définitive", "Dépôt d'une initiative en navette"),
}


def _uid_dossier_loi(signet: str) -> str | None:
    """Rend l'uid d'un dossier de loi du Sénat, tiré de son signet, ou None.

    Le signet est la clé du dossier au Sénat (`ppl23-022`, `pjl22-569`, `pjlf2024`,
    `plfss2024`). Le numéro seul ne suffit pas : dans une même session, une proposition
    et un projet portent le même numéro. La forme `DSN<3 lettres><année>N<chiffres>`
    est celle que `estUidDossier` (`src/lib/uid-fiches.ts`) accepte déjà pour les
    rapports et résolutions du Sénat ; une autre rendrait la fiche en 404. Elle ne
    commence pas par `DLR5L`, d'où deux scripts déduisent une législature de
    l'Assemblée.
    """
    m = re.fullmatch(r"(ppl|pjl)(\d{2})-(\d{1,5})", signet)
    if m:
        return f"DSN{m.group(1).upper()}{2000 + int(m.group(2))}N{int(m.group(3)):04d}"
    m = re.fullmatch(r"pjlf(\d{4})", signet)
    if m:
        return f"DSNPLF{m.group(1)}N0001"
    m = re.fullmatch(r"plfss(\d{4})", signet)
    if m:
        return f"DSNPSS{m.group(1)}N0001"
    return None


def _uid_texte_depot_senat(url: str, num: int) -> str | None:
    """Rend l'uid d'un texte déposé au Sénat en 2023-2024, au format de l'Assemblée.

    Même forme que les textes du Sénat que l'Assemblée transmet (`PIONSNR5S419B0022`) :
    `import_cosignataires_senat` y lit le numéro (`extract_num_from_uid`) et la nature
    (`nature_texte_senat`) pour remplir auteurs et cosignataires, et `fix_textes_urls`
    sait le retrouver dans le dump. `5S419` est le code de la session 2023-2024 que
    portent les 215 textes du Sénat en base pour cette période (relevé le 2026-10-29) ;
    l'appelant ne passe que des textes de cette session. Si l'Assemblée publie un jour le
    même texte, son import écrit sur la même ligne au lieu d'en créer une seconde.
    """
    if url.startswith("ppl"):
        return f"PIONSNR5S419B{num:04d}"
    if url.startswith("pjl"):
        return f"PRJLSNR5S419B{num:04d}"
    return None


def import_lois_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Crée les dossiers de loi qui ont eu une activité au Sénat avant le 18 juillet 2024
    sans être passés par l'Assemblée depuis (voir `FIN_FENETRE_LOIS_SENAT`).

    Chaque dossier reçoit ses textes déposés au Sénat dans la fenêtre, une étape datée par
    lecture du dump, et ses actes de promulgation s'il y a lieu. Ils sont marqués
    `hors_liste` : comptés dans le score, absents de la liste des textes. Le reste suit
    par les étapes existantes,
    qui retrouvent un dossier par son signet (`lien_senat`) : cosignatures et auteurs
    (« Import cosignataires », qui doit donc passer après), avis et rapports
    (`import_avis_senat`), amendements (`import_amendements.py`) et débats
    (`debats/import_debats.py`).

    Un signet déjà porté par un dossier de l'Assemblée est sauté. Les dossiers déjà créés
    ici ne reçoivent plus que leurs colonnes qui peuvent changer (statut, promulgation),
    leurs actes de même, par une mise à jour qui n'écrit que ce qui diffère ; les textes
    ne sont insérés que s'ils manquent. Une seconde passe sur le même dump n'écrit donc
    rien.
    """
    cur = conn.cursor()
    presentes = {r["name"] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    manquantes = {"texte", "lecass", "lecture", "loi", "ecr", "auteur", "rap", "lecassrap"} - presentes
    if manquantes:
        raise RuntimeError(f"Tables absentes du dump dosleg : {', '.join(sorted(manquantes))}")

    autcod_map = _build_autcod_to_uid_map(conn, pg)
    if not autcod_map:
        raise RuntimeError("Aucun sénateur matché (autcod → uid) entre le dump et la base.")

    # Signets déjà en base, et par qui : un dossier de l'Assemblée l'emporte toujours.
    signets_an: set[str] = set()
    for r in lire(pg, "SELECT uid, lien_senat FROM dossiers_legislatifs WHERE lien_senat IS NOT NULL ORDER BY uid"):
        m = re.search(r"/dossier-legislatif/([^/.]+)", r["lien_senat"] or "")
        if m and not r["uid"].startswith(UID_DOSSIERS_LOI_SENAT):
            signets_an.add(m.group(1).strip())
    # uid → signet des dossiers déjà créés ici.
    deja_crees = {
        r["uid"]: (re.search(r"/dossier-legislatif/([^/.]+)", r["lien_senat"] or "") or [None, None])[1]
        for r in lire(
            pg,
            "SELECT uid, lien_senat FROM dossiers_legislatifs WHERE uid LIKE ANY(%s) ORDER BY uid",
            ([f"{prefixe}%" for prefixe in UID_DOSSIERS_LOI_SENAT],),
        )
    }

    # Activité au Sénat dans la fenêtre : un texte ou un rapport législatif publié par le
    # Sénat, à une lecture du Sénat (`codass` S) ou en commission mixte paritaire (I),
    # où siègent sept sénateurs. Les 214 dossiers manquants du 2026-10-29 ont tous l'un ou
    # l'autre. Les tables `texte` et `rap` portent aussi les documents de l'Assemblée
    # sur les mêmes dossiers, reconnaissables à leur URL absolue : sans les écarter,
    # quatre propositions du Sénat de 2023, passées à l'Assemblée en 2023-2024, entraient
    # sans aucune activité au Sénat. Sans la CMP, sept dossiers en sortaient, dont la loi
    # de programmation de la justice, adoptée définitivement par le Sénat le 2023-10-11.
    natures = tuple(NATURES_LOI)
    marques = ", ".join("?" for _ in natures)
    cur.execute(
        f"""
        SELECT trim(l.loicod)     AS loicod,
               trim(l.signet)     AS signet,
               trim(l.typloicod)  AS nature,
               trim(l.etaloicod)  AS etat,
               trim(l.loitit)     AS titre,
               trim(l.loiint)     AS intitule,
               trim(l.numero)     AS numero,
               l.date_loi         AS date_loi,
               trim(l.loititjo)   AS titre_jo,
               trim(l.url_jo)     AS url_jo
          FROM loi l
         WHERE trim(l.typloicod) IN ({marques})
           AND l.signet IS NOT NULL AND trim(l.signet) != ''
           AND (EXISTS (SELECT 1 FROM lecture lc
                          JOIN lecass la ON la.lecidt = lc.lecidt
                          JOIN texte t   ON t.lecassidt = la.lecassidt
                         WHERE lc.loicod = l.loicod AND trim(la.codass) IN ('S', 'I')
                           AND COALESCE(trim(t.texurl), '') NOT LIKE 'http%'
                           AND t.txtoritxtdat >= ? AND t.txtoritxtdat < ?)
                OR EXISTS (SELECT 1 FROM lecture lc
                             JOIN lecass la    ON la.lecidt = lc.lecidt
                             JOIN lecassrap lr ON lr.lecassidt = la.lecassidt
                             JOIN rap r        ON r.rapcod = lr.rapcod
                            WHERE lc.loicod = l.loicod AND trim(la.codass) IN ('S', 'I')
                              AND COALESCE(trim(r.rapurl), '') NOT LIKE 'http%'
                              AND trim(r.coddenrap) IN ('LEGIS', 'SUPPL', 'AVISL', 'GENER')
                              AND r.date_depot >= ? AND r.date_depot < ?))
         ORDER BY trim(l.signet)
        """,
        (*natures, SENAT_DERNIERE_ELECTION, FIN_FENETRE_LOIS_SENAT,
         SENAT_DERNIERE_ELECTION, FIN_FENETRE_LOIS_SENAT),
    )
    candidats = [r for r in cur.fetchall() if r["signet"] not in signets_an]

    # Tous les textes de ces dossiers, des deux chambres : la date de dépôt du dossier et
    # son statut se lisent sur l'ensemble, les textes à créer sur ceux du Sénat seuls.
    textes_par_loi: dict[str, list[sqlite3.Row]] = {}
    cur.execute(
        """
        SELECT trim(lc.loicod)   AS loicod,
               trim(t.texcod)    AS texcod,
               trim(t.oritxtcod) AS origine,
               t.txtoritxtdat    AS depot,
               trim(t.sesann)    AS sesann,
               t.texnum          AS num,
               trim(t.texurl)    AS url,
               trim(la.codass)   AS chambre,
               trim(lc.typleccod) AS typlec
          FROM texte t
          JOIN lecass la  ON la.lecassidt = t.lecassidt
          JOIN lecture lc ON lc.lecidt    = la.lecidt
         ORDER BY t.txtoritxtdat, t.texnum
        """
    )
    voulus = {c["loicod"] for c in candidats}
    for row in cur.fetchall():
        if row["loicod"] in voulus:
            textes_par_loi.setdefault(row["loicod"], []).append(row)

    # Primo-signataires (`o`) par texte, dans l'ordre du dump : le premier reconnu devient
    # l'initiateur, comme pour les résolutions. Les coauteurs sont écrits par
    # « Import cosignataires », qui lit nos uid au format de l'Assemblée.
    primo: dict[str, list[str]] = {}
    cur.execute("SELECT trim(texcod) AS texcod, trim(autcod) AS autcod FROM ecr "
                "WHERE texcod IS NOT NULL AND trim(signataire) = 'o'")
    for row in cur.fetchall():
        primo.setdefault(row["texcod"], []).append(row["autcod"])

    dossiers, textes, actes = [], [], []
    signet_illisible: list[str] = []
    for c in candidats:
        uid_dossier = _uid_dossier_loi(c["signet"])
        if not uid_dossier:
            signet_illisible.append(c["signet"])
            continue
        proc_code, proc_libelle, nature_titre = NATURES_LOI[c["nature"]]
        # Natures du groupe `pjl` de la table `typloi`, conventions comprises.
        est_gouvernement = c["nature"].startswith("pj") or c["nature"] in ("cvn", "prog")
        # `loitit` est l'objet du texte (« visant à… »), sauf pour une convention, où il
        # est souvent un résumé (« accord entre… ») et où `loiint` porte l'intitulé
        # officiel (« autorisant l'approbation… »). Un projet de loi de programmation
        # perd « de programmation » dans les deux (« pour la refondation de Mayotte »).
        intitule = _nettoyer_texte_dump(c["intitule"])
        objet = intitule if intitule.startswith("autorisant") else _nettoyer_texte_dump(c["titre"])
        if not objet:
            continue
        if c["nature"] in ("prog", "ppro") and "programmation" not in objet:
            nature_titre += " de programmation"
        tous = textes_par_loi.get(c["loicod"]) or []

        # Dépôt du dossier : le premier dépôt, dans l'une ou l'autre chambre (`1` au
        # Sénat, `4` à l'Assemblée), sinon le premier texte connu.
        depots = [t["depot"] for t in tous if t["origine"] in ("1", "4") and t["depot"]]
        dates = depots or [t["depot"] for t in tous if t["depot"]]
        date_depot = min(dates)[:10] if dates else None

        # Statut, sur les libellés de `STATUT_MAP` : `loi.etaloicod` 04 « promulgué »,
        # 03 « rejeté » ; sinon une adoption définitive (`ORIGINES_ADOPTE_DEFINITIF`) vaut
        # « Adopté par le Parlement », et à défaut la chambre de la dernière adoption en
        # date. Caducs (05), retirés (06) et en cours (01) gardent l'adoption qu'ils ont
        # obtenue, comme les dossiers de l'Assemblée dans le même cas ; un retiré sans
        # adoption passe à « Retiré », comme eux aussi.
        adoptions = sorted((t["depot"] or "", t["origine"]) for t in tous
                           if t["origine"] in ORIGINES_ADOPTE_SENAT | ORIGINES_ADOPTE_AN)
        promulguee = c["etat"] == "04" and bool(c["date_loi"])
        if promulguee:
            statut = "Promulguée"
        elif c["etat"] == "03":
            statut = "Rejeté"
        elif any(o in ORIGINES_ADOPTE_DEFINITIF for _, o in adoptions):
            statut = "Adopté par le Parlement"
        elif adoptions and adoptions[-1][1] in ORIGINES_ADOPTE_SENAT:
            statut = "Adopté par le Sénat"
        elif adoptions:
            statut = "Adopté par l'Assemblée nationale"
        elif c["etat"] == "06":
            statut = "Retiré"
        else:
            statut = "Déposé - pas encore voté"

        # Textes déposés au Sénat dans la fenêtre. Hors de la session 2023-2024, le code
        # de session de l'uid (`5S419`) ne vaudrait plus : la fenêtre n'en contient pas
        # d'autre, la condition le garantit.
        initiateur = None
        uids_textes = []
        for t in tous:
            if not (t["chambre"] == "S" and t["origine"] == "1" and t["depot"]
                    and SENAT_DERNIERE_ELECTION <= t["depot"] < FIN_FENETRE_LOIS_SENAT
                    and t["sesann"] == "2023" and str(t["num"] or "").isdigit()):
                continue
            uid_texte = _uid_texte_depot_senat(t["url"] or "", int(t["num"]))
            if not uid_texte or uid_texte in uids_textes:
                continue
            if initiateur is None:
                for autcod in primo.get(t["texcod"]) or []:
                    initiateur = autcod_map.get(autcod)
                    if initiateur:
                        break
            uids_textes.append(uid_texte)
            textes.append({
                "uid": uid_texte,
                "dossier_ref": uid_dossier,
                "chambre": "Sénat",
                "type_code": "PRJL" if uid_texte.startswith("PRJL") else "PION",
                "type_libelle": "Projet de loi" if uid_texte.startswith("PRJL") else "Proposition de loi",
                "denomination": "Projet de loi" if uid_texte.startswith("PRJL") else "Proposition de loi",
                "depot_code": "INITDEP",
                "depot_libelle": "Initiative en 1er Dépôt",
                "provenance": "Texte Déposé",
                "titre_principal": objet[:1].upper() + objet[1:],
                "titre_principal_court": (objet[:1].upper() + objet[1:])[:250],
                "date_depot": t["depot"][:10],
                "num_notice": str(int(t["num"])),
                "lien_texte": build_full_senat_url(t["url"], is_rapport=False),
            })

        dossiers.append({
            "uid": uid_dossier,
            "legislature": 17,
            "titre": f"{nature_titre} {objet}",
            "procedure_code": proc_code,
            "procedure_libelle": proc_libelle,
            "statut_final": statut,
            "date_depot": date_depot,
            # Même forme que les liens écrits par `fix_liens_senat`.
            "lien_senat": f"http://www.senat.fr/dossier-legislatif/{c['signet']}.html",
            # Comptés dans le score, mais hors de la liste des textes, qui ne montre que
            # la législature en cours (choix d'Alex, 2026-10-29). Voir la migration
            # 2026-10-29_dossiers_hors_liste.sql pour ce que la colonne écarte.
            "hors_liste": True,
            # Un projet de loi n'a pas d'initiateur parlementaire : le Gouvernement. La
            # vue d'activité reconnaît un dossier du Gouvernement à un texte `PRJL` de
            # cette liste.
            "initiateur_acteur_ref": None if est_gouvernement else initiateur,
            "textes_associes_refs": uids_textes,
            "date_promulgation": c["date_loi"][:10] if promulguee else None,
            "code_loi": (c["numero"] or None) if promulguee else None,
            "titre_loi": (_nettoyer_texte_dump(c["titre_jo"]) or None) if promulguee else None,
            "url_legifrance": (c["url_jo"] or None) if promulguee else None,
        })

        # Une étape par lecture du dump, datée de son premier texte (dépôt ou
        # transmission), sous les codes que le parcours de la fiche connaît
        # (`STEP_CONFIG`, src/lib/legislative-steps.ts) : il date une étape par ses actes
        # enfants `CODE-…`. Avec le seul dépôt au Sénat, la fiche d'une loi promulguée
        # affichait « Assemblée nationale, 1re lecture : en attente » après la
        # promulgation (budget 2024, constaté le 2026-10-29). Les lectures au-delà de la
        # deuxième et le Congrès n'ont pas d'étape dans le parcours : elles sont sautées.
        etapes: dict[str, str] = {}
        for t in tous:
            code = ETAPES_LECTURE.get((t["chambre"], t["typlec"]))
            if code and t["depot"] and (code not in etapes or t["depot"] < etapes[code]):
                etapes[code] = t["depot"]
        premiere = min(etapes.values(), default=None)
        for code, date in sorted(etapes.items(), key=lambda e: e[1]):
            libelle_etape, libelle_depot = LIBELLES_ETAPE[code]
            if code in ("AN1", "SN1"):
                libelle_etape += " (1ère assemblée saisie)" if date == premiere else " (2ème assemblée saisie)"
            organe = "PO78718" if code.startswith("SN") else None
            actes.append({"uid": f"{uid_dossier}-{code}", "dossier_uid": uid_dossier, "parent_uid": None,
                          "code_acte": code, "libelle_acte": libelle_etape, "organe_ref": organe,
                          "date_acte": None, "type_acte": "Etape_Type"})
            # La fiche ne charge que les codes de `KPI_ACTE_CODES`, où la CMP n'a pas de
            # `CMP-DEPOT` : elle se date par sa décision, le jour où elle adopte le texte
            # que le dump date. Sans texte (CMP en échec), le dump n'a pas de lecture CMP.
            enfant = "CMP-DEC" if code == "CMP" else f"{code}-DEPOT"
            actes.append({"uid": f"{uid_dossier}-{enfant}", "dossier_uid": uid_dossier,
                          "parent_uid": f"{uid_dossier}-{code}", "code_acte": enfant,
                          "libelle_acte": "1er dépôt d'une initiative." if date == premiere else libelle_depot,
                          "organe_ref": organe, "date_acte": date[:10],
                          "type_acte": "Decision_Type" if code == "CMP" else "DepotInitiative_Type"})
        if promulguee:
            prom = f"{uid_dossier}-PROM"
            actes.append({"uid": prom, "dossier_uid": uid_dossier, "parent_uid": None, "code_acte": "PROM",
                          "libelle_acte": "Promulgation de la loi", "organe_ref": None,
                          "date_acte": None, "type_acte": "Etape_Type"})
            actes.append({"uid": f"{uid_dossier}-PROM-PUB", "dossier_uid": uid_dossier,
                          "parent_uid": prom, "code_acte": "PROM-PUB",
                          "libelle_acte": "Promulgation d'une loi", "organe_ref": None,
                          "date_acte": c["date_loi"][:10], "type_acte": "Promulgation_Type"})

    sans_groupe = _ranger_dans_groupe_au_depot(pg, dossiers)
    verifier_statuts(dossiers)

    nouveaux = [d for d in dossiers if d["uid"] not in deja_crees]
    print(f"   Dossiers de loi absents de l'Assemblée : {len(dossiers)} "
          f"(dont {len(nouveaux)} nouveaux, {len(dossiers) - len(nouveaux)} déjà créés)")
    par_procedure: dict[str, int] = {}
    for d in dossiers:
        par_procedure[d["procedure_libelle"]] = par_procedure.get(d["procedure_libelle"], 0) + 1
    print("   Par procédure : " + ", ".join(f"{lib} {n}" for lib, n in sorted(par_procedure.items())))
    print(f"   Promulgués : {sum(1 for d in dossiers if d['date_promulgation'])} · "
          f"avec initiateur sénateur : {sum(1 for d in dossiers if d['initiateur_acteur_ref'])} · "
          f"initiateur sans groupe le jour du dépôt : {sans_groupe}")
    print(f"   Textes de dépôt : {len(textes)} · actes : {len(actes)}")
    if signet_illisible:
        print(f"   ⚠️  Signets de forme inconnue, écartés : {', '.join(signet_illisible)}")

    # Un dossier créé ici dont le signet apparaît ensuite chez l'Assemblée serait un
    # doublon : ses amendements iraient au nôtre (`build_signet_to_dossier_map` garde le
    # plus grand uid), et les deux compteraient dans le score. On ne le supprime pas à
    # l'aveugle, ses lignes liées partiraient avec lui : on le signale, pour une
    # décision à la main. Un dossier qui sort des candidats pour une autre raison (dump
    # modifié) n'est pas un doublon : il garde ses lignes, et le journal le dit.
    doublons = sorted(u for u, signet in deja_crees.items() if signet in signets_an)
    if doublons:
        signaler_anomalie(
            "sync_senat",
            f"{len(doublons)} dossier(s) de loi créés par import_lois_senat ont un signet que "
            f"l'Assemblée publie désormais (doublon, à retirer à la main) : {', '.join(doublons[:10])}",
        )
    sortis = sorted(u for u in deja_crees if u not in {d["uid"] for d in dossiers} and u not in doublons)
    if sortis:
        print(f"   ⚠️  Dossiers déjà créés qui ne sont plus candidats : {', '.join(sortis[:10])}")

    if DRY_RUN:
        for d in dossiers[:5]:
            print(f"      {d['uid']} · {d['statut_final']} · {d['titre'][:90]}")
        print("   MODE SEC : rien n'est écrit.")
        return

    # Textes : insérés s'ils manquent, jamais réécrits. Leur contenu est figé (la fenêtre
    # est close), et `fix_textes_urls` tient leurs URL ensuite. Actes : insérés s'ils
    # manquent, puis mis à jour plus bas, une étape pouvant encore s'ajouter à un dossier
    # resté en navette.
    textes_connus = {r["uid"] for r in lire(pg, "SELECT uid FROM textes WHERE uid LIKE %s", ("P%SNR5S419B%",))}
    textes_neufs = [t for t in textes if t["uid"] not in textes_connus]
    actes_connus = {
        r["uid"] for r in lire(
            pg, "SELECT uid FROM actes_legislatifs WHERE uid LIKE ANY(%s)",
            ([f"{prefixe}%" for prefixe in UID_DOSSIERS_LOI_SENAT],),
        )
    }
    actes_neufs = [a for a in actes if a["uid"] not in actes_connus]
    _verifier_urls_nouveaux_textes(pg, textes_neufs, prefixe="P%SNR5S419B%")

    # Les dossiers d'abord (clé étrangère des textes et des actes). Ces lignes sont
    # absentes de la base par construction : l'upsert les insère, et une ligne que la base
    # refuse lève, comme l'insertion d'avant.
    for table, payloads, conflit in (("dossiers_legislatifs", nouveaux, "uid"),
                                     ("textes", textes_neufs, "uid"),
                                     ("actes_legislatifs", actes_neufs, "uid,dossier_uid")):
        print(f"   📤 Insertion {table} ({len(payloads)}) …")
        ecrire(table, payloads, conflit)

    # Dossiers déjà créés : seules les colonnes qui peuvent encore changer, et seulement
    # si elles diffèrent (`mettre_a_jour`).
    existants = [
        {k: d[k] for k in ("uid", "statut_final", "date_promulgation", "code_loi", "titre_loi", "url_legifrance")}
        for d in dossiers if d["uid"] in deja_crees
    ]
    if existants:
        n = mettre_a_jour(
            pg, "dossiers_legislatifs", "uid",
            {"statut_final": "text", "date_promulgation": "timestamp", "code_loi": "text",
             "titre_loi": "text", "url_legifrance": "text"},
            existants,
        )
        print(f"   Dossiers déjà créés mis à jour : {n}")

    # Actes déjà en base : mêmes colonnes que l'insertion, hors clés, écrites seulement si
    # elles diffèrent. `uid` suffit à la jointure : nos uid portent celui du dossier.
    actes_existants = [
        {k: a[k] for k in ("uid", "parent_uid", "libelle_acte", "organe_ref", "date_acte")}
        for a in actes if a["uid"] in actes_connus
    ]
    if actes_existants:
        n = mettre_a_jour(
            pg, "actes_legislatifs", "uid",
            {"parent_uid": "text", "libelle_acte": "text", "organe_ref": "text", "date_acte": "timestamp"},
            actes_existants,
        )
        print(f"   Actes déjà créés mis à jour : {n}")


def import_avis_senat(conn: sqlite3.Connection, pg: psycopg.Connection):
    """Rattache les avis, rapports généraux et rapports au fond du Sénat aux dossiers de loi.

    Une commission saisie pour avis désigne son rapporteur, et la commission des finances
    ses rapporteurs spéciaux sous un rapport général : deux charges de rapporteur que
    l'open data de l'Assemblée ne transporte pas pour le Sénat, et qui ne comptaient donc
    nulle part. Côté Assemblée, les mêmes qualités existent et sont désormais lues.

    Contrairement aux rapports de contrôle, ceux-ci ne créent pas de dossier : ils portent
    sur un texte de loi qui a déjà le sien. Le rattachement passe par le signet du dossier
    Sénat (`loi.signet`), la même clé que `import_scrutins_senat` utilise déjà.

    Les rapports au fond (`LEGIS`) et supplémentaires (`SUPPL`) ne sont rattachés qu'aux
    dossiers créés par `import_lois_senat`. Ceux des dossiers de l'Assemblée arrivent déjà
    par son open data (`RAPPSNR…`) : les reprendre ici les doublerait sur la fiche.
    """
    cur = conn.cursor()
    presentes = {r["name"] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    manquantes = (TABLES_RAPPORTS | {"lecassrap", "lecass", "lecture", "loi"}) - presentes
    if manquantes:
        raise RuntimeError(f"Tables absentes du dump dosleg : {', '.join(sorted(manquantes))}")

    autcod_map = _build_autcod_to_uid_map(conn, pg)
    signet_map = charger_signets(pg)
    print(f"   Sénateurs matchés : {len(autcod_map)} · dossiers avec signet : {len(signet_map)}")
    if not autcod_map or not signet_map:
        raise RuntimeError("Mapping sénateurs ou dossiers vide : rattachement impossible.")

    # `AVISL` = avis d'une commission saisie pour avis, `GENER` = rapport général du
    # budget, dont chaque tome est rapporté par un rapporteur spécial, `LEGIS` et `SUPPL`
    # = rapport de la commission au fond. Tous sont des rapports législatifs, pas du
    # contrôle : ils accompagnent un texte en discussion.
    cur.execute(
        """
        SELECT r.sesann,
               CAST(r.rapnum AS INTEGER)  AS num,
               d.typraprap                AS nature,
               r.coddenrap                AS denom,
               MIN(r.date_depot)          AS depot,
               group_concat(r.rapcod)     AS rapcods,
               (SELECT trim(l.signet)
                  FROM lecassrap lr
                  JOIN lecass la  ON la.lecassidt = lr.lecassidt
                  JOIN lecture lc ON lc.lecidt    = la.lecidt
                  JOIN loi l      ON l.loicod     = lc.loicod
                 WHERE lr.rapcod IN (SELECT r4.rapcod FROM rap r4
                                      WHERE r4.sesann = r.sesann AND r4.rapnum = r.rapnum)
                   AND l.signet IS NOT NULL AND trim(l.signet) != ''
                 LIMIT 1)                 AS signet,
               (SELECT COALESCE(NULLIF(trim(r2.raptil), ''), trim(r2.raptitcou))
                  FROM rap r2 WHERE r2.sesann = r.sesann AND r2.rapnum = r.rapnum
                 ORDER BY COALESCE(r2.raptom, 0) LIMIT 1)  AS titre,
               (SELECT trim(r3.rapurl)
                  FROM rap r3 WHERE r3.sesann = r.sesann AND r3.rapnum = r.rapnum
                 ORDER BY COALESCE(r3.raptom, 0) LIMIT 1)  AS url
          FROM rap r
          JOIN denrap d ON d.coddenrap = r.coddenrap
         WHERE r.date_depot >= ?
           AND (r.coddenrap IN ('AVISL', 'GENER')
                -- La table `rap` porte aussi les rapports au fond de l'Assemblée sur les
                -- mêmes dossiers, sous leur propre numéro et une URL absolue.
                -- COALESCE : une URL absente n'est pas celle de l'Assemblée, et
                -- `import_lois_senat` compte ce rapport comme activité du Sénat.
                OR (r.coddenrap IN ('LEGIS', 'SUPPL') AND COALESCE(trim(r.rapurl), '') NOT LIKE 'http%'))
           AND r.rapnum GLOB '[0-9]*'
           AND trim(r.sesann) != '0'
         GROUP BY r.sesann, r.rapnum
        """,
        (SENAT_DERNIERE_ELECTION,),
    )
    missions = cur.fetchall()

    auteurs_par_rapcod: dict[str, list[str]] = {}
    cur.execute(
        "SELECT rapcod, trim(autcod) AS autcod FROM ecr "
        "WHERE rapcod IS NOT NULL AND trim(signataire) = 'o'"
    )
    for row in cur.fetchall():
        auteurs_par_rapcod.setdefault(str(row["rapcod"]), []).append(row["autcod"])

    textes = []
    sans_dossier = sans_auteur = au_fond_assemblee = 0
    for m in missions:
        dossier_uid = dossier_du_signet(signet_map, m["signet"], m["depot"])
        au_fond = m["denom"] in ("LEGIS", "SUPPL")
        if au_fond and dossier_uid and not dossier_uid.startswith(UID_DOSSIERS_LOI_SENAT):
            au_fond_assemblee += 1
            continue
        if not dossier_uid:
            # Un avis dont le dossier de loi n'est pas en base ne peut pas être rattaché,
            # et un texte sans `dossier_ref` ne compte pas : la vue agrège par dossier.
            sans_dossier += 1
            continue
        titre = _nettoyer_texte_dump(m["titre"])
        refs = []
        for rapcod in (m["rapcods"] or "").split(","):
            for autcod in (auteurs_par_rapcod.get(rapcod) or []):
                uid = autcod_map.get(autcod)
                if uid and uid not in refs:
                    refs.append(uid)
        if not refs:
            sans_auteur += 1
            continue

        est_avis = m["denom"] == "AVISL"
        textes.append({
            "uid": f"RAVISSNR{m['sesann']}N{m['num']:04d}",
            "dossier_ref": dossier_uid,
            "chambre": "Sénat",
            "type_code": "AVIS" if est_avis else "RAPP",
            "type_libelle": "Avis" if est_avis else "Rapport",
            "denomination": {"AVISL": "Avis", "GENER": "Rapport général", "LEGIS": "Rapport",
                             "SUPPL": "Rapport supplémentaire"}[m["denom"]],
            "provenance": "Commission",
            "titre_principal": titre or None,
            "titre_principal_court": (titre or None) and titre[:250],
            "date_depot": (m["depot"] or "")[:10] or None,
            "num_notice": str(m["num"]),
            "lien_texte": build_full_senat_url(m["url"], is_rapport=True),
            "rapporteurs_refs": refs,
        })

    print(f"   Avis et rapports : {len(missions)} missions, {len(textes)} rattachées")
    print(f"   Sans dossier en base : {sans_dossier} · sans auteur identifié : {sans_auteur} · "
          f"au fond d'un dossier de l'Assemblée (déjà importés par elle) : {au_fond_assemblee}")
    porteurs = {ref for t in textes for ref in t["rapporteurs_refs"]}
    print(f"   Sénateurs porteurs : {len(porteurs)}")

    if DRY_RUN:
        print("   MODE SEC : rien n'est écrit.")
        return

    _verifier_urls_nouveaux_textes(pg, textes, prefixe="RAVISSNR%")

    print(f"   📤 Upload textes ({len(textes)}) …")
    print(f"      {ecrire('textes', textes, 'uid')} ligne(s) écrite(s)")


def _nettoyer_texte_dump(valeur: str | None) -> str:
    """Rend un titre lisible depuis une colonne texte du dump.

    Le parseur COPY ne dé-échappe pas les séquences de pg_dump : un titre contenant un
    retour à la ligne arrive avec un `\\n` littéral, qui s'afficherait tel quel sur le
    site. Les colonnes de titre du Sénat sont du texte libre, donc concernées.
    """
    if not valeur:
        return ""
    return " ".join(valeur.replace("\\n", " ").replace("\\t", " ").replace("\\\\", "\\").split())


def _verifier_urls_nouveaux_textes(pg: psycopg.Connection, textes: list[dict], prefixe: str = "RCTLSNR%") -> None:
    """Renseigne `url_accessible` sur tout le lot, avant que l'appelant ne l'upserte.

    Les textes que cette étape découvre, ou qui n'ont jamais été vérifiés, sont testés
    par une requête HEAD ; les autres se voient réaffirmer la valeur qu'ils portent déjà
    en base, `false` compris. Un rapport déjà connu pour mort n'est plus retesté ici
    chaque nuit : `fix_textes_urls` et `verifier_urls_textes` le reprennent le lundi.

    `verifier_urls_textes` (import_textes_cloud) tourne avant cette étape dans le cron :
    sans cette passe, les nouvelles lignes attendraient un jour de plus, et surtout
    `generate_search_summaries` les ignorerait, faute d'URL déclarée lisible — elles
    resteraient hors de l'index de recherche.

    `date_accessible` reste nulle à dessein : `verifier_urls_textes` la pose lui-même la
    nuit suivante sur les lignes accessibles qui n'en ont pas.
    """
    connus = {
        r["uid"]: r["url_accessible"]
        for r in lire(pg, "SELECT uid, url_accessible FROM textes WHERE uid LIKE %s", (prefixe,))
    }
    a_verifier = [t for t in textes if connus.get(t["uid"]) is None and t.get("lien_texte")]
    if not a_verifier:
        return
    print(f"   🔎 Vérification de {len(a_verifier)} URL(s) de rapport …")
    ok = 0
    for t in tqdm(a_verifier, desc="HEAD", unit="url"):
        accessible = verifier_url(t["lien_texte"])
        t["url_accessible"] = accessible
        ok += 1 if accessible else 0
        time.sleep(HEAD_PAUSE)
    print(f"   ✓ {ok}/{len(a_verifier)} URL(s) accessibles")

    # Les lignes qu'on ne revérifie pas n'ont pas la clé `url_accessible` : `upsert_si_change`
    # n'écrit que les colonnes d'une ligne, donc leur valeur en base reste en place, y
    # compris le `true` que `verifier_urls_textes` a posé vingt minutes plus tôt dans le
    # même cron. Avec l'ancien upsert, qui écrivait l'union des clés d'un lot
    # (NULL pour la clé manquante), un seul rapport neuf suffisait à effacer ce `true` sur
    # tous les autres : 500 rapports RCTLSNR et PRESSNR à NULL le 2026-09-12, donc hors de
    # l'index de recherche, et 500 dossiers affichant « texte non publié » à tort.


STEPS = [
    ("Correction lien_senat manquants", fix_liens_senat),
    ("Correction URLs textes Sénat", fix_textes_urls),
    ("Import scrutins Sénat (votes finaux)", import_scrutins_senat),
    ("Stats agrégées des sénateurs", compute_senateur_stats),
    ("Enrichissement coordonnées sénateurs", enrich_senateurs_coordonnees),
    ("Import présences en commission Sénat", import_presences_senat),
    # Avant « Import cosignataires », qui remplit auteurs et cosignataires des textes que
    # cette étape crée. Elle n'a pas besoin d'être en fin de liste comme les rapports :
    # ses textes ont la forme de l'Assemblée, que « Correction URLs » sait relire.
    ("Import dossiers de loi du Sénat absents de l'Assemblée", import_lois_senat),
    ("Import cosignataires des textes Sénat", import_cosignataires_senat),
    # Après « Enrichissement coordonnées sénateurs », qui écrit la colonne
    # `acteurs.matricule_senat` par laquelle cette étape rapproche ses lignes.
    ("Import mandats internes du Sénat", import_mandats_senat),
    # En fin de liste : l'étape crée des lignes que « Correction URLs textes Sénat »
    # chercherait à réparer si elle passait après, faute de les trouver dans le dump
    # par leur numéro de texte — ce sont des rapports, une autre numérotation.
    ("Import rapports de contrôle du Sénat", import_rapports_senat),
    ("Import avis et rapports législatifs du Sénat", import_avis_senat),
    ("Import propositions de résolution du Sénat", import_resolutions_senat),
    # Futurs :
    # ("Enrichissement Conseil Constitutionnel", enrich_conseil_constitutionnel),
    # ("Import thèmes Sénat", import_themes_senat),
]


if __name__ == "__main__":
    # Sans argument, le comportement est celui que le cron attend : toutes les étapes,
    # écritures comprises. Les deux options servent au développement, où rejouer les
    # neuf étapes pour en tester une coûte deux téléchargements et un parse complet.
    parser = argparse.ArgumentParser(description="Synchronisation des données du Sénat.")
    parser.add_argument("--step", metavar="MOTIF",
                        help="ne jouer que les étapes dont le nom contient MOTIF (insensible à la casse)")
    parser.add_argument("--dry-run", action="store_true",
                        help="compter sans écrire (seules les étapes qui créent des lignes le respectent)")
    args = parser.parse_args()
    DRY_RUN = args.dry_run

    steps = STEPS
    if args.step:
        motif = args.step.casefold()
        steps = [(n, f) for n, f in STEPS if motif in n.casefold()]
        if not steps:
            print(f"❌ Aucune étape ne correspond à « {args.step} ». Étapes connues :")
            for n, _ in STEPS:
                print(f"   · {n}")
            sys.exit(2)

    print("=" * 60)
    print("   SYNCHRONISATION DONNÉES SÉNAT")
    if args.dry_run:
        print("   MODE SEC : aucune écriture")
    if args.step:
        print(f"   ÉTAPES RETENUES : {len(steps)}/{len(STEPS)}")
    print("=" * 60)

    # Les étapes restent isolées les unes des autres : une passe qui tombe ne doit pas
    # priver les autres de leur travail. Mais le script sortait ensuite en 0 en
    # annonçant « terminée ! » quoi qu'il arrive, et le cron enchaînait. C'est ainsi que
    # l'enrichissement des sénateurs et les présences en commission ont échoué chaque
    # nuit pendant des semaines sous des runs verts, jusqu'au 2026-09-06.
    echecs: list[str] = []

    zip_bytes = download_senat_dump()
    conn = parse_dump_to_sqlite(zip_bytes)

    # Le dump sénateurs n'alimente que cinq des neuf étapes. Son échec était levé
    # ici, hors de la boucle, et emportait donc aussi les trois qui ne lisent que le
    # dump principal. On l'enregistre comme un échec de plus et on laisse la boucle se
    # dérouler : les étapes qui ont besoin de ces tables lèveront d'elles-mêmes un
    # `no such table`, une par une, et seront comptées individuellement.
    try:
        senators_zip = download_senators_dump()
        parse_senators_dump_to_sqlite(conn, senators_zip)
    except Exception as e:
        print(f"❌ Dump sénateurs indisponible : {e}")
        traceback.print_exc()
        echecs.append("Dump sénateurs")

    etapes_ratees = 0
    for name, step_fn in steps:
        print(f"\n{'=' * 60}")
        print(f"   {name}")
        print(f"{'=' * 60}")
        try:
            # Une connexion par étape : celle d'une étape tombée ne prive pas les suivantes,
            # et aucune ne reste ouverte pendant les longues vérifications HEAD des autres.
            with connexion(autocommit=True) as pg:
                step_fn(conn, pg)
        except Exception as e:
            print(f"❌ Erreur dans '{name}': {e}")
            traceback.print_exc()
            echecs.append(name)
            etapes_ratees += 1

    conn.close()

    # Compté à part de `echecs`, qui peut aussi porter l'échec du dump sénateurs :
    # ce n'est pas une étape, et l'inclure fausserait le rapport.
    print(f"\n{'=' * 60}")
    print(f"   RÉSUMÉ : {len(steps) - etapes_ratees}/{len(steps)} étapes réussies")
    print("=" * 60)
    if echecs:
        for name in echecs:
            print(f"   ❌ {name}")
        print("\n❌ Synchronisation Sénat incomplète.")
        sys.exit(1)

    print("   ✅ Synchronisation Sénat terminée !")
