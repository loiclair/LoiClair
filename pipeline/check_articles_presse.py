"""
check_articles_presse.py
Re-vérifie les URLs des articles de presse dont la dernière vérification date de > 7 jours.

Pour chaque article accessible dont last_checked_at > 7 jours :
  - HEAD request → met à jour url_accessible + last_checked_at

Ce que ce contrôle mesure vraiment, et ce qu'il ne mesure pas. Les URLs stockées sont
toutes des redirections `news.google.com/rss/articles/…`, jamais l'adresse du site de
l'éditeur. Le HEAD ne quitte donc jamais le domaine de Google : il suit une redirection
interne qui ajoute `&hl=…&gl=…` et s'arrête là. Ce script détecte uniquement les
identifiants Google périmés. Un article retiré par son journal, un paywall installé
après coup ou un éditeur disparu restent invisibles ici.

Lancé chaque mardi par `.github/workflows/check-articles-presse-weekly.yml`, avec
`--limit 2000`.

Prérequis :
- Variables de connexion Postgres `PG*` (voir `_db.connexion`)
"""

import json
import sys
import time
import argparse
import psycopg
import requests
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from dotenv import load_dotenv
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire  # noqa: E402

# ── Configuration ─────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# ── Constantes ────────────────────────────────────────────────────────────────

CHECK_BATCH_SIZE = 500
HEAD_TIMEOUT = 5
# HEAD lancés en parallèle. Un par un, à environ une seconde chacun, les 2 000 URLs du
# lot hebdomadaire dépassaient les 30 minutes du workflow, qui coupait le job avant la
# fin (runs des 22 et 29 septembre 2026). Les écritures, elles, restent dans le fil
# principal : une connexion psycopg ne se partage pas entre threads.
PARALLELISME = 4

# Garde-fou contre un blocage global de Google. Il n'y a plus de pause entre les
# requêtes : mesuré sur les vraies URLs de la base, des centaines de HEAD consécutifs
# passent sans un seul 429. Mais ces essais partaient d'une IP résidentielle, alors que
# le script tourne depuis un runner GitHub, dont l'IP de datacenter peut être traitée
# plus sévèrement. Si Google se mettait à tout refuser, le script marquerait 2 000
# articles morts d'un coup sans que rien ne le signale : on s'arrête donc en erreur au
# bout des cent premières URLs si le taux d'échec dépasse le seuil. En régime normal il
# est proche de zéro.
GARDE_FOU_APRES = 100
GARDE_FOU_SEUIL = 0.30
# Verdicts écrits par requête : 500 lignes de {uuid, booléen}, quelques dizaines de Ko.
TAILLE_ECRITURE = 500


# ── Fonctions ─────────────────────────────────────────────────────────────────

def fetch_articles_a_verifier(conn, limit: int) -> list[dict]:
    """Récupère les articles accessibles vérifiés (ou importés) il y a plus de 7 jours.

    Les plus anciennes vérifications passent d'abord, l'id départage les ex æquo.

    Le `LIMIT` est volontaire : on veut un lot borné, pas toute la table.
    """
    il_y_a_7_jours = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 7 * 86400))
    return lire(
        conn,
        "SELECT id, url FROM articles_presse "
        "WHERE url_accessible = true AND last_checked_at < %s::timestamptz "
        "ORDER BY last_checked_at, id LIMIT %s",
        (il_y_a_7_jours, limit),
    )


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


def main():
    parser = argparse.ArgumentParser(description="Re-vérifie les URLs des articles de presse")
    parser.add_argument("--limit", type=int, default=CHECK_BATCH_SIZE, help=f"Nombre d'articles à vérifier (défaut: {CHECK_BATCH_SIZE})")
    parser.add_argument("--dry-run", action="store_true", help="Afficher sans écrire en base")
    args = parser.parse_args()

    print(f"\n🔗 Vérification des URLs articles de presse — {'DRY RUN' if args.dry_run else 'PRODUCTION'}")
    print(f"   Batch: {args.limit} articles\n")

    conn = connexion(autocommit=True)
    try:
        _verifier(conn, args)
    finally:
        conn.close()


def _verifier(conn, args) -> None:
    articles = fetch_articles_a_verifier(conn, args.limit)
    if not articles:
        print("✅ Aucun article à re-vérifier.")
        return

    print(f"📋 {len(articles)} articles à vérifier\n")

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    # `map` rend les résultats dans l'ordre des articles, ce qui garde le garde-fou et
    # les écritures séquentiels. `cancel_futures` évite, si le garde-fou arrête tout,
    # d'attendre la fin des HEAD déjà programmés.
    executeur = ThreadPoolExecutor(max_workers=PARALLELISME)
    resultats = executeur.map(verifier_url, [a["url"] for a in articles])
    try:
        _verifier_lot(conn, articles, resultats, now, args.dry_run)
    finally:
        executeur.shutdown(wait=False, cancel_futures=True)


def _ecrire_verdicts(conn, lot: list[tuple[dict, bool]], now: str) -> None:
    """Écrit les verdicts d'un lot en une requête (une transaction, tout ou rien)."""
    valeurs = json.dumps(
        [{"id": a["id"], "url_accessible": ok} for a, ok in lot], ensure_ascii=False
    )
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            UPDATE articles_presse t
            SET url_accessible = v.url_accessible, last_checked_at = %s::timestamptz
            FROM jsonb_to_recordset(%s::jsonb) AS v(id uuid, url_accessible boolean)
            WHERE t.id = v.id
            """,
            (now, valeurs),
        )


def _verifier_lot(conn, articles: list[dict], resultats, now: str, dry_run: bool) -> None:
    """Écrit le verdict de chaque article, par lots, et affiche le rapport.

    Les verdicts s'accumulent et partent en une requête par lot de `TAILLE_ECRITURE`
    (avant, un `UPDATE` par article). Un lot dont l'écriture échoue compte ses articles
    en erreurs, comme avant où chaque échec d'écriture en comptait un ; ils ne
    sont alors comptés ni « OK » ni « cassés ». Le lot est écrit avant le test du
    garde-fou, pour que les cent premiers articles soient en base quand il s'arrête,
    comme quand chaque article était écrit seul.
    """
    still_ok = 0
    now_broken = 0
    errors = 0
    en_attente: list[tuple[dict, bool]] = []

    def vider() -> None:
        nonlocal still_ok, now_broken, errors, en_attente
        if not en_attente:
            return
        try:
            if not dry_run:
                _ecrire_verdicts(conn, en_attente, now)
        except psycopg.Error as e:
            errors += len(en_attente)
            tqdm.write(f"  ⚠ Erreur : {e}")
        else:
            for article, accessible in en_attente:
                if accessible:
                    still_ok += 1
                else:
                    now_broken += 1
                    tqdm.write(f"  ✗ URL cassée : {article['url'][:80]}…")
        en_attente = []

    for i, (article, accessible) in enumerate(
        zip(tqdm(articles, desc="Vérification", unit="url"), resultats), start=1
    ):
        en_attente.append((article, accessible))
        if i == GARDE_FOU_APRES or len(en_attente) >= TAILLE_ECRITURE:
            vider()

        if i == GARDE_FOU_APRES and (now_broken + errors) / i > GARDE_FOU_SEUIL:
            print(
                f"\n🔥 {now_broken + errors} échecs sur les {i} premières URLs "
                f"(seuil : {GARDE_FOU_SEUIL:.0%}). Google bloque probablement le runner. "
                f"Arrêt avant de marquer tout le lot comme inaccessible."
            )
            sys.exit(1)
    vider()

    # Rapport final
    print(f"\n{'─' * 50}")
    print(f"📊 Rapport final :")
    print(f"   Articles vérifiés : {len(articles)}")
    print(f"   Toujours OK : {still_ok}")
    print(f"   Devenus inaccessibles : {now_broken}")
    print(f"   Erreurs : {errors}")
    if dry_run:
        print(f"   ⚠ Mode DRY RUN — rien n'a été écrit en base")
    print()


if __name__ == "__main__":
    main()
