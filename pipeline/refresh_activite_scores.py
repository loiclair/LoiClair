"""
refresh_activite_scores.py
Rafraîchit la vue matérialisée `activite_elus_mv` qui contient le score
d'activité (centiles + score composite + rang) des parlementaires, puis
`themes_elus_mv`, leurs trois sujets de prédilection.

À exécuter en fin de cron nightly, après tous les imports qui alimentent
les compteurs sources (acteurs, dossiers, textes, amendements, questions,
prises de parole, présences en commission).

Le script pose `SET statement_timeout = 0` pour la session : un délai de requête
ferait échouer le rafraîchissement en cas de pic de charge.

Prérequis :
- Variables `PG*` (voir `_db.py`).
"""

import sys
from pathlib import Path
from dotenv import load_dotenv

from _db import connexion

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

print("⏳ Rafraîchissement de activite_elus_mv…")
try:
    conn = connexion(autocommit=True)
except Exception as e:
    print(f"❌ Connexion Postgres impossible : {e}", file=sys.stderr)
    sys.exit(1)

with conn:
    with conn.cursor() as cur:
        cur.execute("SET statement_timeout = 0")
        cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY public.activite_elus_mv")
    print("✅ activite_elus_mv rafraîchie")

    # Sujets de prédilection de la fiche élu : la vue lit les amendements, prises de
    # parole et présences par dossier, que les imports de la nuit viennent d'écrire.
    # En dernier : une vue absente (migration pas encore appliquée) ou en échec fait
    # échouer le job, après que `activite_elus_mv` a déjà été rafraîchie.
    print("⏳ Rafraîchissement de themes_elus_mv…")
    with conn.cursor() as cur:
        cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY public.themes_elus_mv")
    print("✅ themes_elus_mv rafraîchie")
