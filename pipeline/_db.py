"""Connexion directe à Postgres, et mise à jour groupée de colonnes.

Pourquoi ce module : les imports écrivaient leurs compteurs une ligne à la fois, par
un `UPDATE` chacun, soit environ 5 000 allers-retours par nuit depuis le runner GitHub,
dont la plupart réécrivaient la valeur déjà en base. `mettre_a_jour` envoie tout le lot
en une requête, et Postgres n'écrit que les lignes qui changent vraiment.

Appelé par `import_amendements.py`, `import_questions.py`, `import_reunions_an.py`,
`sync_senat.py`, `refresh_activite_scores.py`, `import_acteurs_organes_cloud.py`,
`import_articles_presse.py`, `debats/import_debats.py`, et par `_sync_cache.py` pour
ses écritures. `ecrire_lot` sert à `import_hatvp.py`, `import_rne.py`,
`import_transparence_an.py` et `import_transparence_senat.py`. Demande les variables
libpq standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` et `PGSSLMODE`,
les mêmes que le site (`src/lib/db.ts`).
"""

from __future__ import annotations

import json
import os

import psycopg
from psycopg import sql as psql
from psycopg.types.json import Json


def _variable(nom: str) -> str | None:
    """Une variable d'environnement sans le saut de ligne qu'un secret collé depuis un
    terminal embarque souvent, ou None si elle est vide."""
    valeur = (os.getenv(nom) or "").strip()
    return valeur or None


def connexion(autocommit: bool = False) -> psycopg.Connection:
    """Ouvre une connexion à partir des variables `PG*`.

    Paramètres nommés et jamais une URL : libpq re-parse mal une URL dont le mot de
    passe contient un caractère spécial non encodé (`@`, `/`), et rend un hostname
    tronqué avec « Name or service not known ».

    `PGSSLMODE` absent vaut `require` ; derrière le tunnel SSH du VPS, le workflow le
    règle lui-même.
    """
    hote = _variable("PGHOST")
    mot_de_passe = _variable("PGPASSWORD")
    if not hote or not mot_de_passe:
        raise RuntimeError("Variables de connexion Postgres manquantes (PGHOST, PGPASSWORD)")
    return psycopg.connect(
        host=hote,
        port=int(_variable("PGPORT") or 5432),
        dbname=_variable("PGDATABASE") or "postgres",
        user=_variable("PGUSER") or "postgres",
        password=mot_de_passe,
        sslmode=_variable("PGSSLMODE") or "require",
        autocommit=autocommit,
    )


def lire(conn: psycopg.Connection, requete: str, params: tuple | dict | None = None) -> list[dict]:
    """Rend les lignes de `requete` en dicts dont les valeurs sont celles du JSON de
    Postgres.

    psycopg rend sinon une date en `datetime.date`, un `numeric` en `Decimal`, un
    horodatage en `datetime` : les appelants, qui comparent des chaînes ISO ou passent
    les valeurs à `json.dumps`, casseraient sans erreur claire. `to_json` sur la ligne
    entière garde l'ordre des colonnes du `select` et le format qu'ils attendent (dates
    ISO, `+00:00`, nombres JSON). `requete` vient du code ; les valeurs passent dans
    `params`.
    """
    with conn.cursor() as cur:
        cur.execute(f"SELECT to_json(q) FROM ({requete}) q", params)
        return [ligne[0] for ligne in cur.fetchall()]


def ecrire_lot(conn: psycopg.Connection, table: str, lot: list[dict], conflict: str) -> None:
    """Un upsert en une requête : les lignes sont insérées, ou réécrites sur conflit.

    `json_populate_recordset(NULL::table, …)` convertit chaque valeur JSON au type de sa
    colonne (un texte ISO devient une date). Les colonnes écrites sont l'union de celles
    des lignes, une ligne qui en omet une y met NULL. `table`, `conflict` et
    les noms de colonnes viennent du code, jamais d'une donnée. Transaction propre : un
    lot rejeté n'empêche pas la moitié suivante du découpage de passer.
    """
    colonnes = list(dict.fromkeys(c for ligne in lot for c in ligne))
    cles = [c.strip() for c in conflict.split(",")]
    requete = psql.SQL(
        "INSERT INTO {t} ({cols}) SELECT {cols} FROM json_populate_recordset(NULL::{t}, %s) "
        "ON CONFLICT ({conflit}) DO UPDATE SET {maj}"
    ).format(
        t=psql.Identifier(table),
        cols=psql.SQL(", ").join(map(psql.Identifier, colonnes)),
        conflit=psql.SQL(", ").join(map(psql.Identifier, cles)),
        maj=psql.SQL(", ").join(
            psql.SQL("{c} = excluded.{c}").format(c=psql.Identifier(c))
            for c in colonnes if c not in cles
        ),
    )
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(requete, (Json(lot),))


def mettre_a_jour(
    conn: psycopg.Connection,
    table: str,
    cle: str,
    types: dict[str, str],
    lignes: list[dict],
    remise_a_zero: str | None = None,
) -> int:
    """Écrit `lignes` dans `table` en une requête, et renvoie le nombre de lignes changées.

    - `cle` : colonne de jointure (texte), présente dans chaque ligne.
    - `types` : {colonne: type SQL} des colonnes à écrire, par exemple
      `{"nb_questions_orales": "int"}`. Une ligne ne peut pas omettre une colonne du
      lot : absente, elle serait lue comme NULL et écrite telle quelle.
    - `remise_a_zero` : condition SQL sur `t` (par exemple `t.est_depute_actuel`).
      Les lignes qui la remplissent, absentes du lot, et dont une des colonnes est
      différente de 0, sont remises à 0. C'est le motif « recompter depuis zéro » des
      compteurs : un élu qui disparaît de la source ne doit pas garder sa vieille
      valeur. Un NULL n'est jamais touché : sur `nb_commission_presences`, il veut dire
      « pas de commission » et sort du score (D-033), là où 0 veut dire « siège mais
      n'y va pas ». Réservé aux colonnes numériques.

    `table`, `cle`, `types` et `remise_a_zero` sont écrits en dur par l'appelant, jamais
    tirés d'une donnée : ils entrent tels quels dans le SQL. Les valeurs, elles, passent
    en paramètre (un seul jsonb).

    `IS DISTINCT FROM` écarte les lignes déjà à jour : elles ne déclenchent pas les
    triggers `BEFORE UPDATE` (dont `acteurs_search_trigger`) et ne laissent pas de ligne
    morte. Remise à zéro et mise à jour tiennent dans la même transaction, validée à la
    sortie : le site ne voit jamais de compteurs à 0 le temps de l'import, ce qui
    arrivait pendant une à cinq minutes quand les deux gestes étaient séparés.
    """
    colonnes = list(types)
    definition = ", ".join([f"{cle} text"] + [f"{c} {t}" for c, t in types.items()])
    affectations = ", ".join(f"{c} = v.{c}" for c in colonnes)
    anciennes = ", ".join(f"t.{c}" for c in colonnes)
    nouvelles = ", ".join(f"v.{c}" for c in colonnes)
    # Une ligne à une seule colonne n'est pas un tuple en SQL : `ROW(...)` rend la
    # comparaison valable dans les deux cas.
    changees = f"ROW({anciennes}) IS DISTINCT FROM ROW({nouvelles})"
    valeurs = json.dumps(lignes, ensure_ascii=False, default=str)

    ecrites = 0
    with conn.transaction(), conn.cursor() as cur:
        if remise_a_zero:
            zeros = ", ".join(f"{c} = 0" for c in colonnes)
            # `<>` et non `IS DISTINCT FROM` : NULL <> 0 est NULL, donc faux, et la
            # ligne à NULL reste à NULL.
            non_nuls = " OR ".join(f"t.{c} <> 0" for c in colonnes)
            cur.execute(
                f"""
                UPDATE {table} t SET {zeros}
                WHERE ({remise_a_zero})
                  AND ({non_nuls})
                  AND NOT EXISTS (
                    SELECT 1 FROM jsonb_to_recordset(%s::jsonb) AS v({cle} text)
                    WHERE v.{cle} = t.{cle}
                  )
                """,
                (valeurs,),
            )
            ecrites += cur.rowcount
        cur.execute(
            f"""
            UPDATE {table} t SET {affectations}
            FROM jsonb_to_recordset(%s::jsonb) AS v({definition})
            WHERE t.{cle} = v.{cle} AND {changees}
            """,
            (valeurs,),
        )
        ecrites += cur.rowcount
    return ecrites


def mettre_a_jour_par_colonnes(
    conn: psycopg.Connection,
    table: str,
    cle: str,
    types: dict[str, str],
    lignes: list[dict],
) -> int:
    """`mettre_a_jour` pour des lignes qui ne portent pas toutes les mêmes colonnes.

    Une colonne absente d'une ligne veut dire « ne pas y toucher », jamais « écrire
    NULL » : c'est la sémantique des payloads construits clé par clé, comme les
    coordonnées des sénateurs (`sync_senat.py`), où un champ vide dans la source ne doit
    pas effacer la valeur déjà en base. Les lignes sont regroupées par jeu de
    colonnes, une requête par groupe (quelques-unes en pratique).
    """
    groupes: dict[tuple[str, ...], list[dict]] = {}
    for ligne in lignes:
        colonnes = tuple(sorted(c for c in ligne if c != cle))
        groupes.setdefault(colonnes, []).append(ligne)
    return sum(
        mettre_a_jour(conn, table, cle, {c: types[c] for c in colonnes}, groupe)
        for colonnes, groupe in groupes.items()
        if colonnes
    )
