"""
reset_view_counts_monthly.py
Remet à zéro les compteurs mensuels de vues (dossiers législatifs + élus).
Exécuté le 1er de chaque mois via reset-popular-dossiers-monthly.yml.

Prérequis : variables de connexion Postgres `PG*` (voir `_db.connexion`).
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion  # noqa: E402

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# Chaque remise à zéro a sa transaction : si la seconde échoue, la première reste
# acquise. `> 0` écarte les lignes déjà à zéro (et les NULL), donc le décompte affiché
# est celui des lignes réellement changées.
with connexion() as conn:
    print("⏳ Reset view_count_month — dossiers législatifs…")
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("UPDATE dossiers_legislatifs SET view_count_month = 0 WHERE view_count_month > 0")
        print(f"✅ Dossiers réinitialisés ({cur.rowcount} lignes)")

    print("⏳ Reset view_count_month — élus…")
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("UPDATE acteurs SET view_count_month = 0 WHERE view_count_month > 0")
        print(f"✅ Élus réinitialisés ({cur.rowcount} lignes)")
