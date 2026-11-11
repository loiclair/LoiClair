"""
refresh_dossier_debats_cache.py
Recalcule `dossier_debats_cache` : pour chaque dossier ayant des débats, ses orateurs
(le résultat de la vue `dossier_orateurs`) et l'empreinte de ses débats
(`empreinte_debats`), rangés en une ligne.

Pourquoi : la fiche dossier (`elus-actifs.ts`) et `/api/resume-debats` relisaient chacune
les ~38 000 interventions du PLF 2026 à chaque affichage, 160 à 500 ms de calcul pur, et
pouvaient dépasser le délai de 8 s du rôle `authenticator` sous charge. Les débats ne
changent qu'à l'import de nuit : le résultat se calcule une fois ici et se lit en une
ligne. Voir `migrations/2026-10-29_dossier_debats_cache.sql`.

Étape `cache-debats` de `nightly.py`, juste après `debats` : l'empreinte dépend aussi du
groupe des orateurs (`acteurs.historique_groupes`) et des libellés d'`organes`, écrits
plus haut par `acteurs` et `senat`. Un dossier dont les débats ne sont pas encore passés
n'a pas de ligne, et le site retombe sur le calcul d'origine.

Tout se fait côté Postgres, en une transaction et une requête : `dossier_debats_calculer()`
lit la table des interventions d'un seul passage (une dizaine de secondes pour 521
dossiers), puis seules les lignes qui changent sont écrites (`IS DISTINCT FROM`, donc ni
ligne morte ni écriture quand rien n'a bougé). Les lignes des dossiers qui n'ont plus
d'intervention sont supprimées. Aucune donnée ne transite par le runner.

Prérequis : les variables `PG*` (voir `_db.py`) et la migration appliquée. Appliquer la
migration avant de pousser ce code sur `main` : la synchro de nuit part de `main`, pas de
`production`. Sans elle, le script échoue et la nuit continue ; le site lit le calcul
d'origine pour les dossiers sans ligne, et les lignes de la veille pour les autres.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

from _db import connexion

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# `calcule_le` ne change que si la valeur change : il dit depuis quand la ligne est
# juste, pas quand le script a tourné.
REQUETE = """
WITH calcul AS (
  SELECT dossier_uid, orateurs, empreinte FROM public.dossier_debats_calculer()
),
ecrites AS (
  INSERT INTO public.dossier_debats_cache AS t (dossier_uid, orateurs, empreinte)
  SELECT dossier_uid, orateurs, empreinte FROM calcul
  ON CONFLICT (dossier_uid) DO UPDATE
    SET orateurs = EXCLUDED.orateurs, empreinte = EXCLUDED.empreinte, calcule_le = now()
    WHERE (t.orateurs, t.empreinte) IS DISTINCT FROM (EXCLUDED.orateurs, EXCLUDED.empreinte)
  RETURNING 1
),
retirees AS (
  DELETE FROM public.dossier_debats_cache t
  WHERE NOT EXISTS (SELECT 1 FROM calcul c WHERE c.dossier_uid = t.dossier_uid)
  RETURNING 1
)
SELECT (SELECT count(*) FROM calcul), (SELECT count(*) FROM ecrites), (SELECT count(*) FROM retirees)
"""

print("⏳ Pré-calcul des orateurs et des empreintes de débats…")
try:
    conn = connexion(autocommit=True)
except Exception as e:
    print(f"❌ Connexion Postgres impossible : {e}", file=sys.stderr)
    sys.exit(1)

with conn:
    try:
        with conn.cursor() as cur:
            # Le délai du rôle (2 min pour `postgres`) serait suffisant, mais ce pré-calcul
            # grossit avec les débats : mieux vaut qu'il ne soit jamais le maillon coupé.
            cur.execute("SET statement_timeout = 0")
            cur.execute(REQUETE)
            total, ecrites, retirees = cur.fetchone()
    except Exception as e:
        print(f"❌ Pré-calcul impossible (migration 2026-10-29_dossier_debats_cache appliquée ?) : {e}", file=sys.stderr)
        sys.exit(1)

print(f"✅ dossier_debats_cache : {total} dossier(s) calculé(s), {ecrites} ligne(s) écrite(s), {retirees} retirée(s)")
