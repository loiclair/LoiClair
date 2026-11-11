"""
import_articles_presse.py
Importe des articles de presse liés aux dossiers législatifs depuis Google News RSS.

Pour chaque dossier jamais recherché, ou recherché il y a plus de 30 jours (180 jours
pour un dossier déposé il y a plus d'un an) :
  1. Extrait des mots-clés du titre du dossier
  2. Cherche sur Google News RSS
  3. Upsert dans la table articles_presse

L'accessibilité des URLs n'est pas testée ici : un nouvel article entre avec
`url_accessible = true` et `last_checked_at` à l'instant de l'import (colonne NOT NULL),
et `check_articles_presse.py` le vérifie au bout de sept jours, comme les autres. Le test fait ici ne sortait de toute façon jamais
de chez Google (les URLs stockées sont des redirections `news.google.com`) et
répondait « accessible » à chaque fois, pour une à deux minutes par nuit.

Prérequis :
- Variables de connexion Postgres `PG*` (voir `_db.connexion`)
- pip install feedparser
"""

import re
import sys
import json
import time
import argparse
import requests
from pathlib import Path
from urllib.parse import quote_plus
from dotenv import load_dotenv
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire  # noqa: E402

try:
    import feedparser
except ImportError:
    print("❌ feedparser non installé — pip install feedparser")
    sys.exit(1)

# ── Configuration ─────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# ── Constantes ────────────────────────────────────────────────────────────────

BATCH_SIZE = 200
ARTICLES_PAR_DOSSIER = 5
GOOGLE_PAUSE = 1.5        # Pause entre requêtes Google News (secondes)
# Délai avant de rechercher à nouveau la presse d'un dossier. Un dossier déposé il y a
# plus d'un an ne fait presque plus parler de lui : le rechercher tous les mois
# ramenait chaque nuit ~120 dossiers, dont les deux tiers anciens, à 3 s chacun.
DELAI_RECENT_JOURS = 30
DELAI_ANCIEN_JOURS = 180
AGE_ANCIEN_JOURS = 365

# Préfixes législatifs à retirer du titre pour extraire des mots-clés pertinents
PREFIXES_LEGISLATIFS = re.compile(
    r"^(projet de loi|proposition de loi|proposition de résolution|"
    r"texte de la commission|rapport|avis|motion|amendement)\s*"
    r"(organique\s*|constitutionnelle?\s*|de programmation\s*|"
    r"portant\s*|relative?\s*[àa]\s*|visant\s*[àa]\s*|tendant\s*[àa]\s*|"
    r"pour\s*|sur\s*|autorisant\s*|habilitant\s*|ratifiant\s*)*",
    re.IGNORECASE,
)

# Références légales à retirer (n° 2026-31 du 28 janvier 2026, ordonnance, décret…)
REFS_LEGALES = re.compile(
    r"(?:l['\u2019\u0027]ordonnance|l['\u2019\u0027]?ordonnance|le décret|la loi)\s*"
    r"n[°]?\s*\d[\d\-/]*"
    r"(?:\s+du\s+\d{1,2}\s+\w+\s+\d{4})?"
    r"|n[°]?\s*\d[\d\-/]*(?:\s+du\s+\d{1,2}\s+\w+\s+\d{4})?"
    r"|\bdu\s+\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4}\b",
    re.IGNORECASE,
)

# Mots vides à exclure des mots-clés de recherche
STOPWORDS = {
    "le", "la", "les", "de", "du", "des", "un", "une", "et", "ou", "en",
    "au", "aux", "à", "ce", "ces", "son", "sa", "ses", "que", "qui", "dont",
    "par", "pour", "dans", "sur", "avec", "est", "sont", "été", "être",
    "avoir", "fait", "plus", "moins", "entre", "après", "avant", "cette",
    "tout", "tous", "toute", "toutes", "leur", "leurs", "nos", "notre",
    "ses", "mon", "ma", "mes", "votre", "vos", "il", "elle", "ils", "elles",
    "ne", "pas", "n", "l", "d", "s", "c", "qu", "se", "si", "y",
    "certaines", "certains", "diverses", "divers", "plusieurs", "autres",
    "même", "aussi", "donc", "car", "mais", "ni", "non", "oui",
    # Mots de liaison législatifs (déjà retirés par le préfixe, mais parfois restants)
    "relative", "relatif", "relatives", "relatifs", "fournissant",
    "ordonnance", "décret", "décrets", "arrêté", "arrêtés",
}


# ── Fonctions ─────────────────────────────────────────────────────────────────

def fetch_dossiers_a_traiter(conn, batch_size: int) -> list[dict]:
    """Récupère les dossiers à rechercher : jamais cherchés, ou cherchés depuis trop longtemps.

    Trop longtemps veut dire 30 jours pour un dossier déposé depuis moins d'un an (ou sans
    date de dépôt), 180 jours au-delà. Les plus anciennes recherches passent d'abord, et
    l'uid départage les ex æquo pour un ordre stable d'une nuit à l'autre.
    """
    from datetime import datetime, timedelta, timezone
    maintenant = datetime.now(timezone.utc)
    limite_recent = (maintenant - timedelta(days=DELAI_RECENT_JOURS)).isoformat()
    limite_ancien = (maintenant - timedelta(days=DELAI_ANCIEN_JOURS)).isoformat()
    depot_ancien = (maintenant - timedelta(days=AGE_ANCIEN_JOURS)).date().isoformat()
    # `hors_liste` : dossiers absents des listes (migration
    # 2026-10-29_dossiers_hors_liste.sql), qu'on ne fait pas vivre dans la presse.
    # `lire` rend `date_depot` en chaîne ISO : la suite du script
    # (`fetch_google_news_rss`) la lit ainsi.
    return lire(
        conn,
        """
        SELECT uid, titre, date_depot
        FROM dossiers_legislatifs
        WHERE hors_liste = false
          AND (
            last_press_searched_at IS NULL
            OR (date_depot IS NULL AND last_press_searched_at < %(recent)s::timestamptz)
            OR (date_depot >= %(depot)s::date AND last_press_searched_at < %(recent)s::timestamptz)
            OR (date_depot < %(depot)s::date AND last_press_searched_at < %(ancien)s::timestamptz)
          )
        ORDER BY last_press_searched_at ASC NULLS FIRST, uid
        LIMIT %(lot)s
        """,
        {"recent": limite_recent, "ancien": limite_ancien, "depot": depot_ancien, "lot": batch_size},
    )


def extraire_mots_cles(titre: str) -> str:
    """Extrait les mots-clés pertinents du titre d'un dossier législatif.

    Stratégie :
    1. Retirer préfixes législatifs et références légales (n°, dates, ordonnance…)
    2. Extraire les mots significatifs
    3. Construire une expression entre guillemets (3-5 premiers mots = sujet principal)
       + mots de contexte libres + "loi"
    """
    # Retirer les préfixes législatifs
    cleaned = PREFIXES_LEGISLATIFS.sub("", titre).strip()
    if not cleaned:
        cleaned = titre

    # Retirer les références légales (n° 2026-31 du 28 janvier 2026…)
    cleaned = REFS_LEGALES.sub(" ", cleaned)

    # Retirer la ponctuation et normaliser
    cleaned = re.sub(r"['''\u2018\u2019\u201C\u201D\"«»()\[\]{},;:!?.…–—/°]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # Filtrer les stopwords, mots trop courts, et dédupliquer (garder l'ordre)
    seen = set()
    words = []
    for w in cleaned.lower().split():
        if w not in STOPWORDS and len(w) > 2 and w not in seen:
            seen.add(w)
            words.append(w)

    if not words:
        # Fallback : titre brut simplifié
        return titre[:80] + " loi"

    # Limiter à 6 mots-clés les plus significatifs + contexte "loi"
    keywords = words[:6]
    if "loi" not in keywords:
        keywords.append("loi")

    return " ".join(keywords)


def fetch_google_news_rss(keywords: str, date_depot: str | None = None) -> list[dict]:
    """Cherche sur Google News RSS et retourne les entrées brutes.

    Si date_depot est fourni (format ISO), filtre les résultats côté client
    pour ne garder que les articles publiés après le dépôt du dossier.
    """
    url = f"https://news.google.com/rss/search?q={quote_plus(keywords)}&hl=fr&gl=FR&ceid=FR:fr"
    # feedparser sans User-Agent se fait bloquer par Google — on fetch d'abord avec requests
    try:
        resp = requests.get(url, timeout=10, headers={"User-Agent": "Mozilla/5.0 (compatible; LoiClair/1.0)"})
        feed = feedparser.parse(resp.content)
    except Exception:
        feed = feedparser.parse(url)

    entries = feed.entries

    # Filtrer par date de dépôt si disponible
    if date_depot:
        depot_date = date_depot[:10]  # YYYY-MM-DD
        filtered = []
        for entry in entries:
            published = entry.get("published_parsed") or entry.get("updated_parsed")
            if published:
                entry_date = time.strftime("%Y-%m-%d", published)
                if entry_date >= depot_date:
                    filtered.append(entry)
            else:
                # Pas de date → on garde par défaut
                filtered.append(entry)
        entries = filtered

    return entries[:ARTICLES_PAR_DOSSIER * 2]  # Prendre plus pour compenser les échecs


def extraire_source(entry: dict) -> tuple[str, str | None]:
    """Extrait le nom et l'URL de la source depuis une entrée Google News RSS."""
    # Google News met la source dans source.title/source.href
    if hasattr(entry, "source"):
        name = getattr(entry.source, "title", None)
        href = getattr(entry.source, "href", None)
        if name:
            return name, href
    parts = entry.get("title", "").rsplit(" - ", 1)
    return (parts[-1].strip(), None) if len(parts) > 1 else ("Source inconnue", None)


def nettoyer_titre(titre_brut: str, source_nom: str) -> str:
    """Retire le suffixe ' - Source' du titre RSS Google News."""
    # Google News ajoute " - NomSource" à la fin de chaque titre
    suffixe = f" - {source_nom}"
    if titre_brut.endswith(suffixe):
        return titre_brut[: -len(suffixe)].strip()
    # Fallback : retirer tout ce qui suit le dernier " - "
    parts = titre_brut.rsplit(" - ", 1)
    return parts[0].strip() if len(parts) > 1 else titre_brut


def extraire_date(entry: dict) -> str | None:
    """Extrait la date de publication d'une entrée RSS au format YYYY-MM-DD."""
    published = entry.get("published_parsed") or entry.get("updated_parsed")
    if published:
        try:
            return time.strftime("%Y-%m-%d", published)
        except Exception:
            pass
    return None


def ecrire_articles(conn, articles: list[dict]) -> None:
    """Insère les articles d'un dossier, ou met à jour ceux déjà connus.

    Un article est reconnu par `(dossier_uid, md5(url))`, la clé de l'index unique
    `idx_articles_presse_dossier_url_md5` (migration `2026-10-29_articles_presse_index_md5.sql`) :
    l'index sur l'url entière pesait 17 Mo pour des url de 326 octets en moyenne.
    L'écriture vise cet index sur une expression par `ON CONFLICT (dossier_uid, md5(url))`.
    Elle réécrit toutes les colonnes envoyées, y compris `url_accessible` et
    `last_checked_at`. Appelée par `traiter_dossier`, dans sa transaction (le
    `conn.transaction()` d'ici devient alors un point de sauvegarde).
    """
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO articles_presse (dossier_uid, titre, url, source_nom, source_url,
                                         date_publication, url_accessible, last_checked_at, search_keywords)
            SELECT dossier_uid, titre, url, source_nom, source_url,
                   date_publication, url_accessible, last_checked_at, search_keywords
            FROM jsonb_to_recordset(%s::jsonb) AS v(
                dossier_uid text, titre text, url text, source_nom text, source_url text,
                date_publication date, url_accessible boolean, last_checked_at timestamptz,
                search_keywords text)
            ON CONFLICT (dossier_uid, md5(url)) DO UPDATE SET
                titre = excluded.titre, url = excluded.url, source_nom = excluded.source_nom,
                source_url = excluded.source_url, date_publication = excluded.date_publication,
                url_accessible = excluded.url_accessible, last_checked_at = excluded.last_checked_at,
                search_keywords = excluded.search_keywords
            """,
            (json.dumps(articles, ensure_ascii=False),),
        )


def traiter_dossier(conn, dossier: dict, dry_run: bool = False) -> dict:
    """Traite un dossier : recherche articles, résout URLs, upsert."""
    uid = dossier["uid"]
    titre = dossier["titre"] or uid

    keywords = extraire_mots_cles(titre)
    date_depot = dossier.get("date_depot")
    entries = fetch_google_news_rss(keywords, date_depot)

    articles = []
    for entry in entries:
        if len(articles) >= ARTICLES_PAR_DOSSIER:
            break

        # Utiliser l'URL Google News RSS directement (redirige côté navigateur)
        article_url = entry.get("link", "")
        if not article_url:
            continue

        # Vérifier que l'URL n'est pas un doublon dans ce batch
        if any(a["url"] == article_url for a in articles):
            continue


        source_nom, source_url = extraire_source(entry)
        source_nom = source_nom[:128]
        titre_clean = nettoyer_titre(entry.get("title", "Sans titre"), source_nom)

        articles.append({
            "dossier_uid": uid,
            "titre": titre_clean[:512],
            "url": article_url[:2048],
            "source_nom": source_nom,
            "source_url": source_url,
            "date_publication": extraire_date(entry),
            # Accessible jusqu'à preuve du contraire. `last_checked_at` est remplacé par
            # l'instant de l'upsert juste avant l'envoi (la colonne est NOT NULL) : le
            # contrôle hebdomadaire le reprendra sept jours plus tard.
            "url_accessible": True,
            "last_checked_at": "now()",
            "search_keywords": keywords[:500],
        })

    stats = {"uid": uid, "keywords": keywords, "found": len(articles)}

    if dry_run:
        return stats

    # Articles et marque « cherché » dans une même transaction : si l'écriture des
    # articles échoue, le dossier n'est pas marqué et sera retenté la nuit suivante,
    # comme avant (l'exception remontait avant la marque).
    with conn.transaction():
        if articles:
            # Remplacer "now()" par l'instant présent, envoyé comme valeur
            now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            for a in articles:
                a["last_checked_at"] = now

            ecrire_articles(conn, articles)

        with conn.cursor() as cur:
            cur.execute(
                "UPDATE dossiers_legislatifs SET last_press_searched_at = %s::timestamptz "
                "WHERE uid = %s",
                (time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), uid),
            )

    return stats


def main():
    parser = argparse.ArgumentParser(description="Import articles de presse depuis Google News RSS")
    parser.add_argument("--limit", type=int, default=BATCH_SIZE, help=f"Nombre de dossiers à traiter (défaut: {BATCH_SIZE})")
    parser.add_argument("--dry-run", action="store_true", help="Afficher les résultats sans écrire en base")
    args = parser.parse_args()

    print(f"\n📰 Import articles de presse — {'DRY RUN' if args.dry_run else 'PRODUCTION'}")
    print(f"   Batch: {args.limit} dossiers\n")

    # Une connexion pour tout le script (jusqu'à 200 dossiers, 1,5 s de pause entre
    # deux). En autocommit pour ne jamais rester dans une transaction ouverte pendant
    # ces pauses ; chaque dossier a sa propre transaction (`traiter_dossier`).
    conn = connexion(autocommit=True)
    try:
        _traiter(conn, args)
    finally:
        conn.close()


def _traiter(conn, args) -> None:
    dossiers = fetch_dossiers_a_traiter(conn, args.limit)
    if not dossiers:
        print("✅ Aucun dossier à traiter.")
        return

    print(f"📋 {len(dossiers)} dossiers à traiter\n")

    total_found = 0
    errors = 0

    for dossier in tqdm(dossiers, desc="Dossiers", unit="dossier"):
        # Une coupure de connexion ne coûte que le dossier en cours : le suivant repart
        # sur une connexion neuve au lieu d'échouer à son tour.
        if conn.broken or conn.closed:
            conn = connexion(autocommit=True)
        try:
            stats = traiter_dossier(conn, dossier, dry_run=args.dry_run)
            total_found += stats["found"]

            if stats["found"] == 0:
                tqdm.write(f"  ⚠ {stats['uid']}: aucun article trouvé (mots-clés: {stats['keywords']})")
            else:
                tqdm.write(f"  ✓ {stats['uid']}: {stats['found']} articles")

        except Exception as e:
            errors += 1
            tqdm.write(f"  ✗ {dossier['uid']}: {e}")

        # Pause entre requêtes Google News
        time.sleep(GOOGLE_PAUSE)

    # Rapport final
    print(f"\n{'─' * 50}")
    print(f"📊 Rapport final :")
    print(f"   Dossiers traités : {len(dossiers)}")
    print(f"   Articles trouvés : {total_found}")
    print(f"   Erreurs : {errors}")
    if args.dry_run:
        print(f"   ⚠ Mode DRY RUN — rien n'a été écrit en base")
    print()


if __name__ == "__main__":
    main()
