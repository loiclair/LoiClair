# import_questions.py
# Importe les questions parlementaires (AN + Sénat) dans la base.
#
# AN     : 3 ZIP JSON (QG, QOSD, QE) depuis data.assemblee-nationale.fr
# Sénat  : 1 ZIP SQL (dump PostgreSQL, toutes natures) depuis data.senat.fr
#
# Alimente :
#   - public.questions                    (métadonnées seulement, pas de verbatim)
#   - public.acteurs.nb_questions_orales  (QG + QOSD + QO)
#   - public.acteurs.nb_questions_ecrites (QE)
#
# Fenêtre : 17e législature AN (>= 2024-06-01), Sénat depuis la dernière
# élection (>= 2023-10-02, cf. sync_senat.py).
#
# Les rappels ne sont pas des questions (D-309) : une question écrite du Sénat qui
# porte `refquerappelee` (« Rappel de la question n° … ») n'est ni importée ni
# comptée, et la ligne déjà en base est effacée. L'Assemblée ne marque aucun rappel,
# ni par un champ ni dans le texte (vérifié sur le dump du 2026-10-29) : rien n'y
# est écarté.
#
# Exécuter avec : python import_questions.py

import io
import json
import re
import sqlite3
import sys
import unicodedata
import zipfile
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire, mettre_a_jour  # noqa: E402
from _sync_cache import upsert_si_change  # noqa: E402
from _telechargement import telecharger  # noqa: E402

# ===================================================================
# Configuration
# ===================================================================

URL_AN_QG = "https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_gouvernement/Questions_gouvernement.json.zip"
URL_AN_QOSD = "https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_orales_sans_debat/Questions_orales_sans_debat.json.zip"
URL_AN_QE = "https://data.assemblee-nationale.fr/static/openData/repository/17/questions/questions_ecrites/Questions_ecrites.json.zip"
URL_SENAT_QUESTIONS = "https://data.senat.fr/data/questions/questions.zip"

LEGISLATURE_AN = "17"
AN_DEBUT = date(2024, 6, 1)
SENAT_DERNIERE_ELECTION = date(2023, 10, 2)

# Codes "natquecod" du dump Sénat. Mapping (via table naturequestion) :
#   QOSD = Questions orales (sans débat)
#   QOAD = Questions orales avec débat
#   QOAE = Questions orales européennes
#   QG   = Questions au Gouvernement
#   QC   = Questions cribles d'actualité (équivalent QG AN)
#   QE   = Questions écrites
SENAT_NATURES_ORALES = {"QOSD", "QOAD", "QOAE", "QG", "QC"}
SENAT_NATURES_ECRITES = {"QE"}

# Tables à extraire du dump SQL Sénat
TABLES_SENAT_QUESTIONS = {"naturequestion", "tam_questions", "tam_reponses"}

# ===================================================================
# Connexion Postgres
# ===================================================================

# Les variables `PG*` (voir `_db.py`) viennent de l'environnement ou de `.env.local`.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ===================================================================
# Utilitaires
# ===================================================================


def _normalize_name(s: str) -> str:
    """Normalise un nom : supprime les accents, met en majuscules, espaces simples."""
    if not s:
        return ""
    n = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return " ".join(n.upper().split())


def _parse_iso_date(s: str | None) -> str | None:
    """Extrait YYYY-MM-DD depuis un timestamp ISO éventuellement avec heure/zone."""
    if not s:
        return None
    return s[:10]


def _https(url: str | None) -> str | None:
    """Normalise une URL en HTTPS."""
    if not url:
        return None
    url = url.strip()
    if url.startswith("http://"):
        return "https://" + url[len("http://"):]
    return url


# ===================================================================
# Pré-chargement : mapping Sénat (nom, prenom) → uid
# ===================================================================


def build_senat_name_to_uid() -> dict[tuple[str, str], str]:
    """Construit le mapping (NOM, PRENOM) normalisés → uid pour tous les
    sénateurs actuels ET anciens (utile si une question date d'un mandat précédent)."""
    # `order by uid` : en cas de collision de nom, la première ligne gagne (`setdefault`
    # plus bas), donc l'ordre doit être fixe d'une nuit à l'autre.
    with connexion() as conn:
        rows = lire(conn, "select uid, nom, prenom from acteurs order by uid")

    mapping: dict[tuple[str, str], str] = {}
    for s in rows:
        key = (_normalize_name(s.get("nom") or ""), _normalize_name(s.get("prenom") or ""))
        if key == ("", ""):
            continue
        # En cas de collision on ne remplace pas une entrée existante par une plus
        # tardive : la première, par uid, est gardée.
        mapping.setdefault(key, s["uid"])
    return mapping


# ===================================================================
# Téléchargement / extraction
# ===================================================================


def _download(url: str) -> bytes:
    """Télécharge une archive de questions de l'Assemblée, avec les bornes par défaut
    de `telecharger`. Appelée par `process_an`, une fois par type de question."""
    print(f"📥 {url}")
    contenu = telecharger(url)
    print(f"   Taille : {len(contenu) / 1024 / 1024:.1f} Mo")
    return contenu


# ===================================================================
# Parsing AN
# ===================================================================


def _parse_an_question(data: dict, type_: str) -> dict | None:
    """Extrait les métadonnées d'un JSON question AN. Renvoie None si incomplet."""
    q = data.get("question", data)

    numero = (q.get("identifiant") or {}).get("numero")
    if not numero:
        return None

    auteur = ((q.get("auteur") or {}).get("identite") or {})
    acteur_ref = auteur.get("acteurRef")

    # Date JO : prioriser la réponse si présente, sinon la question
    textes_reponse = q.get("textesReponse") or {}
    texte_reponse = textes_reponse.get("texteReponse") if textes_reponse else None
    textes_question = q.get("textesQuestion") or {}
    texte_question = textes_question.get("texteQuestion") if textes_question else None

    def _first(node):
        # Un texte peut être une liste ou un dict unique selon le JSON
        if isinstance(node, list):
            return node[0] if node else None
        return node

    tr = _first(texte_reponse)
    tq = _first(texte_question)

    date_jo = None
    if tr:
        info = tr.get("infoJO") or {}
        date_jo = _parse_iso_date(info.get("dateJO"))
    if not date_jo and tq:
        info = tq.get("infoJO") or {}
        date_jo = _parse_iso_date(info.get("dateJO"))

    # Indexation : rubrique + titre
    indexation = q.get("indexationAN") or {}
    rubrique = indexation.get("rubrique")
    # Le titre éditorial vrai vit dans indexationAN.analyses.analyse (peut être
    # une string ou une liste de strings selon le nombre d'analyses).
    analyses_node = (indexation.get("analyses") or {}).get("analyse")
    if isinstance(analyses_node, list):
        analyse_titre = next((a for a in analyses_node if a), None)
    else:
        analyse_titre = analyses_node
    titre = indexation.get("teteAnalyse") or analyse_titre or rubrique

    # Ministère interrogé
    min_int = q.get("minInt") or {}
    ministere = min_int.get("developpe") or min_int.get("abrege")

    a_reponse = bool(tr)

    return {
        "uid": f"AN-{type_}-{numero}",
        "uid_auteur": acteur_ref,
        "chambre": "AN",
        "type": type_,
        "date_jo": date_jo,
        "titre": titre,
        "rubrique": rubrique,
        "ministere": ministere,
        "a_reponse": a_reponse,
        "url_source": f"https://questions.assemblee-nationale.fr/q{LEGISLATURE_AN}/{LEGISLATURE_AN}-{numero}{type_}.htm",
    }


def process_an(type_: str, url: str, known_acteur_uids: set[str]) -> list[dict]:
    """Télécharge, parse et renvoie la liste des lignes à upserter pour un type donné."""
    print("\n" + "=" * 60)
    print(f"🏛️  ASSEMBLÉE NATIONALE — {type_}")
    print("=" * 60)

    content = _download(url)
    zf = zipfile.ZipFile(io.BytesIO(content))
    names = [n for n in zf.namelist() if n.endswith(".json")]
    print(f"   {len(names)} fichiers JSON")

    rows: list[dict] = []
    skipped_date = 0
    skipped_auteur = 0
    parse_errors = 0

    for name in tqdm(names, desc=f"AN {type_}"):
        try:
            with zf.open(name) as f:
                data = json.load(f)
        except (json.JSONDecodeError, KeyError):
            parse_errors += 1
            continue

        row = _parse_an_question(data, type_)
        if not row:
            parse_errors += 1
            continue

        # Filtre date : 17e législature
        if row["date_jo"]:
            try:
                if date.fromisoformat(row["date_jo"]) < AN_DEBUT:
                    skipped_date += 1
                    continue
            except ValueError:
                pass

        # L'auteur doit exister dans acteurs (sinon FK échoue)
        if not row["uid_auteur"] or row["uid_auteur"] not in known_acteur_uids:
            skipped_auteur += 1
            continue

        rows.append(row)

    print(f"   ✅ {len(rows)} questions retenues")
    if skipped_date:
        print(f"   ⏭️  {skipped_date} hors fenêtre temporelle")
    if skipped_auteur:
        print(f"   ⏭️  {skipped_auteur} sans auteur connu en base")
    if parse_errors:
        print(f"   ⚠️  {parse_errors} fichiers ignorés (parse error ou incomplet)")

    return rows


# ===================================================================
# Parsing Sénat
# ===================================================================


def _parse_senat_dump_to_sqlite(zip_bytes: io.BytesIO) -> sqlite3.Connection:
    """Parse le dump SQL Sénat (questions.zip) et charge les tables utiles en SQLite.
    Pattern calqué sur parse_ameli_to_sqlite (cf. import_amendements.py)."""
    print("🔄 Parsing du dump Sénat vers SQLite…")
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    zf = zipfile.ZipFile(zip_bytes)
    sql_files = [n for n in zf.namelist() if n.lower().endswith(".sql")]
    if not sql_files:
        raise FileNotFoundError("Aucun fichier .sql trouvé dans questions.zip")
    sql_name = sql_files[0]
    print(f"   Fichier : {sql_name}")

    tables_loaded: dict[str, int] = {}

    with zf.open(sql_name) as f:
        lines = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
        current_table: str | None = None
        columns: list[str] = []
        rows_buffer: list[list] = []

        for line in lines:
            if line.startswith("COPY "):
                match = re.match(r"COPY (?:\w+\.)?(\w+) \((.+?)\) FROM stdin;", line)
                if match:
                    table_name = match.group(1)
                    if table_name in TABLES_SENAT_QUESTIONS:
                        current_table = table_name
                        columns = [c.strip() for c in match.group(2).split(",")]
                        rows_buffer = []
                        cols_def = ", ".join(f'"{c}" TEXT' for c in columns)
                        cur.execute(f'DROP TABLE IF EXISTS "{current_table}"')
                        cur.execute(f'CREATE TABLE "{current_table}" ({cols_def})')
                continue

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

            if current_table:
                values = line.rstrip("\n").split("\t")
                values = [None if v == "\\N" else v for v in values]
                if len(values) == len(columns):
                    rows_buffer.append(values)

    conn.commit()
    for table, count in tables_loaded.items():
        print(f"   {table} : {count} lignes")

    # Index utiles
    try:
        cur.execute('CREATE INDEX IF NOT EXISTS idx_tq_nat ON tam_questions(natquecod)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_tq_id ON tam_questions(id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_tr_idque ON tam_reponses(idque)')
    except Exception:
        pass
    conn.commit()
    return conn


def process_senat(name_to_uid: dict[tuple[str, str], str]) -> tuple[list[dict], list[str]]:
    """Télécharge le dump Sénat, filtre sur la date de dernière élection, et
    renvoie les questions orales (QOSD/QOAD/QOAE/QG) + écrites (QE), puis les uid
    des questions écrites de rappel écartées (D-309), que `main` efface de la base."""
    print("\n" + "=" * 60)
    print("🏛️  SÉNAT — Questions")
    print("=" * 60)

    print(f"📥 Téléchargement {URL_SENAT_QUESTIONS} …")
    # 269 Mo : le deuxième plus gros dump du cron, il passait sans reprise possible.
    contenu = telecharger(URL_SENAT_QUESTIONS)
    print(f"   Taille : {len(contenu) / 1024 / 1024:.1f} Mo")

    conn = _parse_senat_dump_to_sqlite(io.BytesIO(contenu))
    cur = conn.cursor()

    retained_natures = SENAT_NATURES_ORALES | SENAT_NATURES_ECRITES
    placeholders = ",".join("?" for _ in retained_natures)
    cur.execute(f"""
        SELECT id, natquecod, numero, reference, titre, nom, prenom, rubrique, datejodepot, mindepotlib,
               refquerappelee
        FROM tam_questions
        WHERE natquecod IN ({placeholders})
    """, list(retained_natures))

    questions = cur.fetchall()

    # Pré-charger toutes les réponses pour lookup O(1)
    cur.execute("SELECT idque, datejorep, urlrep FROM tam_reponses")
    reponses_map: dict[str, dict] = {}
    for r in cur.fetchall():
        idque = r["idque"]
        if idque:
            reponses_map[idque] = {"datejorep": r["datejorep"], "urlrep": r["urlrep"]}

    rows: list[dict] = []
    uids_rappels: list[str] = []
    skipped_date = 0
    unmatched_count = 0
    unmatched_samples: list[tuple[str, str]] = []

    for q in tqdm(questions, desc="Sénat QO"):
        # Date : datejodepot au format "YYYY-MM-DD HH:MM:SS" ou "YYYY-MM-DD"
        raw_date = q["datejodepot"]
        date_jo: str | None = None
        if raw_date:
            date_jo = raw_date[:10]
            try:
                if date.fromisoformat(date_jo) < SENAT_DERNIERE_ELECTION:
                    skipped_date += 1
                    continue
            except ValueError:
                date_jo = None

        nature = q["natquecod"]
        # On utilise `id` (PK tam_questions) pour garantir l'unicité : le couple
        # (nature, numero) se répète entre années/sessions parlementaires.
        uid = f"SENAT-{nature}-{q['id']}"

        # Un rappel redemande une question restée sans réponse : le compter faisait
        # passer en tête ceux qui relancent (au 2026-10-29, 1 168 questions écrites pour
        # Hervé Maurey, dont 512 rappels). Le marqueur est la référence de la question
        # rappelée ; le dump l'accompagne toujours du renvoi « Question de rappel » (les
        # deux ensemble sur les 1 558 rappels de la fenêtre au 2026-10-29). Des doublons
        # auteur + titre sans ce marqueur restent : ce sont des questions déposées à
        # nouveau, pas des rappels. Le test passe avant le rapprochement de l'auteur :
        # un rappel déjà en base dont l'auteur ne se retrouverait plus un soir doit
        # quand même en être effacé. Une réponse publiée sous le rappel ne se perd pas :
        # au 2026-10-29, 2 rappels répondus sur 986 avaient une question d'origine sans
        # réponse.
        if nature in SENAT_NATURES_ECRITES and (q["refquerappelee"] or "").strip():
            uids_rappels.append(uid)
            continue

        nom = q["nom"] or ""
        prenom = q["prenom"] or ""
        key = (_normalize_name(nom), _normalize_name(prenom))
        uid_auteur = name_to_uid.get(key)
        if not uid_auteur:
            unmatched_count += 1
            if len(unmatched_samples) < 10:
                unmatched_samples.append((nom, prenom))
            continue

        rep = reponses_map.get(q["id"])
        a_reponse = bool(rep and rep.get("datejorep"))

        # URL officielle Sénat : on privilégie l'url de réponse (page JO complète
        # question + réponse), sinon on reconstruit l'URL de la question à partir
        # de la `reference` SEQ… qui existe pour toutes les questions du dump.
        url_source: str | None = None
        if rep and rep.get("urlrep"):
            url_source = _https(rep["urlrep"])
        elif q["reference"] and raw_date:
            year = raw_date[:4]
            url_source = f"https://www.senat.fr/questions/base/{year}/q{q['reference']}.html"

        # Type stocké : QE pour les écrites, QO pour toutes les natures orales
        stored_type = "QE" if nature in SENAT_NATURES_ECRITES else "QO"

        rows.append({
            "uid": uid,
            "uid_auteur": uid_auteur,
            "chambre": "SENAT",
            "type": stored_type,
            "date_jo": date_jo,
            "titre": (q["titre"] or q["rubrique"] or None),
            "rubrique": q["rubrique"] or None,
            "ministere": q["mindepotlib"] or None,
            "a_reponse": a_reponse,
            "url_source": url_source,
        })

    conn.close()

    nb_orales = sum(1 for r in rows if r["type"] == "QO")
    nb_ecrites = sum(1 for r in rows if r["type"] == "QE")
    print(f"   ✅ {len(rows)} questions retenues sur {len(questions)} candidates ({nb_orales} orales, {nb_ecrites} écrites)")
    print(f"   ⏭️  {len(uids_rappels)} questions écrites de rappel écartées (D-309)")
    if skipped_date:
        print(f"   ⏭️  {skipped_date} hors fenêtre (< {SENAT_DERNIERE_ELECTION})")
    if unmatched_count:
        print(f"   ⚠️  {unmatched_count} sans match en base (ex : {unmatched_samples[:5]})")

    return rows, uids_rappels


# ===================================================================
# Mise à jour des compteurs `acteurs`
# ===================================================================


def supprimer_rappels(uids: list[str]) -> bool:
    """Efface de `questions` les rappels déjà importés (D-309), en une requête.

    Appelée par `main` avec tous les rappels de la fenêtre du dump : la plupart ne sont
    plus en base après la première passe, et le `DELETE` ne touche alors rien. Rend
    False si l'effacement a échoué ; `main` calcule quand même les compteurs, qui
    ignorent déjà les rappels, puis sort en échec.

    """
    if not uids:
        return True
    try:
        with connexion() as conn:
            n = conn.execute("DELETE FROM questions WHERE uid = ANY(%s)", (uids,)).rowcount
            conn.commit()
    except Exception as e:
        print(f"   ❌ Effacement des rappels : {type(e).__name__}: {e}")
        return False
    print(f"   🗑️  {n} rappel(s) effacé(s) de questions")
    return True


def update_counters(all_rows: list[dict]) -> None:
    """Écrit nb_questions_orales et nb_questions_ecrites sur acteurs, en une requête.

    `all_rows` est le relevé complet de la nuit, pas seulement ce qui a changé : les
    compteurs se recalculent donc depuis zéro. Les parlementaires en exercice absents du
    relevé sont remis à 0 dans la même transaction. Sans ce passage, qui manquait alors
    que l'ancien commentaire l'annonçait, un élu dont toutes les questions sortaient de
    la fenêtre gardait indéfiniment son ancien compteur, et son score d'activité avec.
    Même patron que les amendements et `recalc_nb_prises_parole()` (D-036).

    Un parlementaire en exercice ne compte que les questions de sa chambre actuelle.
    Les deux chambres s'additionnaient par uid : un député élu sénateur le 1er octobre
    2026 gardait ses questions de député, jusqu'à 78 questions écrites le 2026-10-15.
    Un élu qui ne siège plus garde les deux, aucun score ne le lisant.
    """
    print("\n" + "=" * 60)
    print("📤 COMPTEURS ACTEURS")
    print("=" * 60)

    orales: dict[str, int] = defaultdict(int)
    ecrites: dict[str, int] = defaultdict(int)

    with connexion() as conn:
        chambre_actuelle = dict(conn.execute(
            "select uid, case when est_depute_actuel then 'AN' else 'SENAT' end from acteurs"
            " where est_depute_actuel or est_senateur_actuel"
        ).fetchall())

        for r in all_rows:
            uid = r["uid_auteur"]
            if not uid:
                continue
            if chambre_actuelle.get(uid, r["chambre"]) != r["chambre"]:
                continue
            if r["type"] in ("QG", "QOSD", "QO"):
                orales[uid] += 1
            elif r["type"] == "QE":
                ecrites[uid] += 1

        lignes = [
            {"uid": uid, "nb_questions_orales": orales.get(uid, 0),
             "nb_questions_ecrites": ecrites.get(uid, 0)}
            for uid in sorted(set(orales) | set(ecrites))
        ]
        n = mettre_a_jour(
            conn, "acteurs", "uid",
            {"nb_questions_orales": "int", "nb_questions_ecrites": "int"},
            lignes,
            remise_a_zero="t.est_depute_actuel OR t.est_senateur_actuel",
        )
    print(f"   👤 {len(lignes)} acteurs comptés, {n} ligne(s) modifiée(s)")


# ===================================================================
# Chargement acteurs
# ===================================================================


def load_all_acteur_uids() -> set[str]:
    with connexion() as conn:
        uids = {r["uid"] for r in lire(conn, "select uid from acteurs")}
    print(f"📋 {len(uids)} acteurs connus en base")
    return uids


# ===================================================================
# Main
# ===================================================================


def main() -> None:
    print("=" * 60)
    print("IMPORT DES QUESTIONS (AN + SÉNAT)")
    print("=" * 60)

    known_acteurs = load_all_acteur_uids()
    senat_name_map = build_senat_name_to_uid()
    print(f"📋 {len(senat_name_map)} clés (nom, prénom) pour matching Sénat")

    all_rows: list[dict] = []

    # Les quatre passes doivent réussir avant d'écrire quoi que ce soit. `update_counters`
    # plus bas ne fait pas un incrément mais écrit des totaux absolus recalculés depuis
    # `all_rows` : une passe manquante, et les compteurs de tous les élus concernés sont
    # réécrits à la baisse. La passe QE pèse à elle seule l'essentiel du volume, donc son
    # échec suffisait à dégonfler le score d'activité, sans que rien n'alerte.
    # Même garde que `import_amendements.py`, pour la même raison.
    echecs: list[str] = []

    for type_, url in [("QG", URL_AN_QG), ("QOSD", URL_AN_QOSD), ("QE", URL_AN_QE)]:
        try:
            all_rows.extend(process_an(type_, url, known_acteurs))
        except Exception as e:
            print(f"❌ Erreur AN {type_} : {e}")
            import traceback; traceback.print_exc()
            echecs.append(f"AN {type_}")

    uids_rappels: list[str] = []
    try:
        rows_senat, uids_rappels = process_senat(senat_name_map)
        all_rows.extend(rows_senat)
    except Exception as e:
        print(f"❌ Erreur Sénat : {e}")
        import traceback; traceback.print_exc()
        echecs.append("Sénat")

    if echecs:
        print(f"\n❌ Passe(s) en échec : {', '.join(echecs)} — aucune écriture.")
        print("   Les questions et les compteurs de la veille restent en place.")
        sys.exit(1)

    print("\n" + "=" * 60)
    print(f"📤 UPSERT {len(all_rows)} questions → base")
    print("=" * 60)

    # Toutes les questions partent chaque nuit, et la base n'écrit que celles qui sont
    # nouvelles ou changées : ce qui évite le bloat (le purge_table() précédent supprimait
    # tout avant ré-insertion → 100 % de tuples morts à chaque run).
    ecrites, perdues = upsert_si_change("questions", all_rows, "uid", journal=tqdm.write)
    print(f"   {ecrites} écrite(s) (nouvelles ou changées), {len(all_rows) - ecrites - len(perdues)} inchangées")
    if perdues:
        print(f"   ❌ {len(perdues)} question(s) non écrite(s)")

    rappels_effaces = supprimer_rappels(uids_rappels)
    update_counters(all_rows)

    # Résumé
    by_chambre: dict[tuple[str, str], int] = defaultdict(int)
    for r in all_rows:
        by_chambre[(r["chambre"], r["type"])] += 1
    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ")
    print("=" * 60)
    for (chambre, type_), n in sorted(by_chambre.items()):
        print(f"   {chambre:6s} {type_:5s} : {n}")

    if not rappels_effaces:
        print("\n❌ Rappels non effacés de questions : à rejouer.")
        sys.exit(1)


if __name__ == "__main__":
    main()
