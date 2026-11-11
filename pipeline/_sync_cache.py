"""Cache partagé pour rendre les imports nocturnes idempotents.

Deux outils complémentaires :

1. `download_zip_if_modified(url)` : vérifie via HEAD les en-têtes
   `Last-Modified` / `ETag` et compare au cache stocké dans la table
   `sync_http_cache`. Si rien n'a changé (en-tête identique OU SHA256 du corps
   identique au précédent), lève `NotModified` et on sort proprement. Une URL déjà
   téléchargée par une étape précédente du même job est relue depuis le disque du
   runner, pour que toutes les étapes voient le même instantané.

2. `upsert_si_change(table, lignes, on_conflict)` : envoie toutes les lignes, et la base
   n'écrit que celles qui sont nouvelles ou différentes (`IS DISTINCT FROM`). Il a
   remplacé en novembre 2026 (D-325) le cache d'empreintes `RowHashCache`, qui gardait
   le hash de chaque ligne hors de la base et sautait l'upsert
   d'une ligne inchangée : la base compare elle-même, plus de cache à tenir d'accord
   avec elle.

`sync_http_cache` est créée par `migrations/2026-04-14_sync_cache.sql`.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import tempfile
import time
import zipfile
from pathlib import Path
from typing import Iterable

import psycopg
import requests
from dotenv import load_dotenv
from psycopg import sql as psql
from psycopg.rows import dict_row
from psycopg.types.json import Json

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion  # noqa: E402
from _telechargement import telecharger  # noqa: E402


load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# Une connexion par processus, ouverte au premier usage et rouverte si elle tombe.
# Autocommit : chaque écriture est validée seule, et une qui échoue n'en annule pas une autre.
_conn: psycopg.Connection | None = None


def _connexion() -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed or _conn.broken:
        _conn = connexion(autocommit=True)
    return _conn


class NotModified(Exception):
    """Levée quand la ressource distante est identique au dernier import."""


# Entrées de cache téléchargées mais dont l'import n'est pas encore confirmé, par clé
# de cache. Vidées par `confirmer_import`. Un script qui plante entre les deux les laisse
# ici et elles disparaissent avec le processus : la ressource sera revue la nuit
# suivante, ce qui est exactement le comportement voulu.
_caches_en_attente: dict[str, tuple[str | None, str | None, str]] = {}


# ---------------------------------------------------------------------------
# Cache HTTP (Last-Modified / ETag / SHA256 du corps)
# ---------------------------------------------------------------------------

def _get_http_cache(url: str) -> dict | None:
    try:
        with _connexion().cursor(row_factory=dict_row) as cur:
            cur.execute(
                "SELECT last_modified, etag, content_sha FROM sync_http_cache WHERE cache_key = %s LIMIT 1",
                (url,),
            )
            return cur.fetchone()
    except Exception as e:
        print(f"⚠️  sync_http_cache lookup ignoré : {e}")
        return None


def _set_http_cache(url: str, last_modified: str | None, etag: str | None, sha: str) -> None:
    try:
        with _connexion().cursor() as cur:
            cur.execute(
                """
                INSERT INTO sync_http_cache (cache_key, last_modified, etag, content_sha)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (cache_key) DO UPDATE SET
                  last_modified = excluded.last_modified, etag = excluded.etag,
                  content_sha = excluded.content_sha
                """,
                (url, last_modified, etag, sha),
            )
    except Exception as e:
        print(f"⚠️  sync_http_cache update ignoré : {e}")


# ---------------------------------------------------------------------------
# Partage d'un dump entre les étapes d'un même job
# ---------------------------------------------------------------------------

# Trois étapes du cron lisent le même `Dossiers_Legislatifs.json.zip` : les dossiers,
# puis les textes, puis les actes. Chacune le retéléchargeait, à trente secondes et
# quatre minutes d'intervalle, et l'Assemblée republie ce fichier plusieurs fois par
# heure. Le 2026-09-15, l'étape dossiers a écrit une version à 3 079 dossiers
# pendant que l'étape textes lisait la suivante, qui en comptait 3 127 : 62 textes
# pointaient vers des dossiers absents de la base, la clé étrangère
# `textes_dossier_ref_fkey` les a rejetés, et les deux étapes sont tombées. La panne
# s'est reproduite au run suivant, avec d'autres dossiers.
#
# Le premier qui télécharge une URL dépose donc le corps sur le disque du runner, et
# les suivants le relisent : toutes les étapes d'un job voient le même instantané.


def _repertoire_partage() -> Path | None:
    """Dossier où les étapes d'un même job GitHub s'échangent leurs dumps, ou None.

    Hors GitHub Actions, le partage est désactivé : un script lancé à la main est seul,
    il n'a rien à partager, et un fichier laissé dans le répertoire temporaire serait
    relu tel quel par un lancement du lendemain. L'identifiant du run entre dans le nom
    pour que deux jobs se partageant un runner auto-hébergé ne se mélangent pas.
    """
    run_id = os.getenv("GITHUB_RUN_ID")
    if not run_id:
        return None
    tentative = os.getenv("GITHUB_RUN_ATTEMPT", "1")
    base = Path(os.getenv("RUNNER_TEMP") or tempfile.gettempdir())
    repertoire = base / f"loiclair-dumps-{run_id}-{tentative}"
    try:
        repertoire.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        print(f"⚠️  Partage des dumps indisponible ({e}).")
        return None
    return repertoire


def _chemins_partage(url: str) -> tuple[Path, Path] | None:
    """Fichiers du corps et des validateurs d'une URL dans le dossier de partage."""
    repertoire = _repertoire_partage()
    if repertoire is None:
        return None
    cle = hashlib.sha256(url.encode("utf-8")).hexdigest()[:32]
    return repertoire / f"{cle}.zip", repertoire / f"{cle}.json"


def _lire_partage(url: str) -> tuple[bytes, str | None, str | None] | None:
    """Rend le corps déjà téléchargé dans ce job et ses validateurs, ou None.

    Les validateurs rendus sont ceux relevés au moment du téléchargement, pas ceux
    qu'un HEAD donnerait maintenant. C'est le point délicat du mécanisme : marquer la
    source « vue » avec l'ETag d'une version qu'on n'a pas lue la ferait sauter la nuit
    suivante, et le trou dans les données ne se refermerait jamais.
    """
    chemins = _chemins_partage(url)
    if chemins is None:
        return None
    fichier, meta = chemins
    if not fichier.exists() or not meta.exists():
        return None
    try:
        infos = json.loads(meta.read_text(encoding="utf-8"))
        return fichier.read_bytes(), infos.get("last_modified"), infos.get("etag")
    except (OSError, ValueError) as e:
        print(f"⚠️  Dump partagé illisible ({e}) — on retélécharge.")
        return None


def _ecrire_partage(
    url: str, corps: bytes, last_modified: str | None, etag: str | None
) -> None:
    """Dépose un dump pour les étapes suivantes du job. Un échec ne bloque rien.

    Le corps passe par un fichier provisoire renommé ensuite, et les validateurs ne
    s'écrivent qu'après lui : une étape qui tomberait sur un corps à moitié écrit
    ouvrirait un ZIP tronqué, alors qu'un corps sans validateurs est simplement ignoré
    par `_lire_partage`, qui retélécharge.
    """
    chemins = _chemins_partage(url)
    if chemins is None:
        return
    fichier, meta = chemins
    try:
        provisoire = fichier.with_suffix(".part")
        provisoire.write_bytes(corps)
        provisoire.replace(fichier)
        meta.write_text(
            json.dumps({"last_modified": last_modified, "etag": etag}),
            encoding="utf-8",
        )
    except OSError as e:
        print(f"⚠️  Dump non partagé ({e}) — les étapes suivantes le retéléchargeront.")


# Le téléchargement vit dans `_telechargement` : il reprend là où la connexion a lâché
# au lieu de rejouer le fichier entier, ce que faisait la version locale d'ici. Le plus
# gros dump du cron passe par cette fonction et pèse 519 Mo (`cri.zip` du Sénat) :
# recommencer de zéro à chaque coupure ne pouvait pas tenir.


def download_zip_if_modified(url: str, *, label: str = "", timeout: int = 180) -> zipfile.ZipFile:
    """Télécharge `url` (ZIP) en mémoire ou lève `NotModified` si inchangé.

    `label` permet à plusieurs scripts qui partagent le même URL d'avoir des
    entrées de cache indépendantes (ex. label="dossiers", "textes", "actes").
    Sans label, la clé de cache est l'URL elle-même (comportement historique).

    Stratégie :
      1. Si une étape précédente du job a déjà téléchargé cette URL, on relit son
         instantané (voir `_lire_partage`) et les points 2 et 3 sont sautés.
      2. HEAD pour récupérer `Last-Modified` / `ETag`.
      3. Si un de ces en-têtes correspond au cache → `NotModified` (pas de GET).
      4. Sinon GET, calcul SHA256 du corps. Si SHA inchangé → `NotModified`
         (certains serveurs mettent à jour ETag sans changer le contenu).
      5. Sinon on renvoie le `ZipFile`, sans écrire le cache.

    **L'appelant doit appeler `confirmer_import(url, label=…)` une fois son import
    réussi.** Le cache s'écrivait ici, avant que l'import ait eu lieu : un plantage
    ensuite laissait la source marquée « vue », et la nuit suivante répondait
    « inchangé, rien à faire » en sortant en 0. Oublier la confirmation est le sens de
    panne souhaitable, la ressource étant simplement réimportée la fois suivante.
    """
    cache_key = f"{label}:{url}" if label else url
    print(f"Vérification du ZIP : {url}")
    cached = _get_http_cache(cache_key)

    partage = _lire_partage(url)
    if partage is not None:
        body, last_modified, etag = partage
    else:
        last_modified = None
        etag = None
        try:
            head = requests.head(url, timeout=30, allow_redirects=True)
            if head.status_code < 400:
                last_modified = head.headers.get("Last-Modified")
                etag = head.headers.get("ETag")
        except Exception as e:
            print(f"  HEAD indisponible ({e}) — on télécharge directement.")

        # Ce court-circuit n'a de sens que sur un fichier qu'on s'apprête à aller
        # chercher : l'en-tête décrit alors ce qu'on va lire. Sur un dump relu du
        # partage il décrirait une autre version, et seul le SHA256 ci-dessous tranche.
        if cached:
            if etag and cached.get("etag") and etag == cached["etag"]:
                print("  ↪ ETag inchangé → rien à faire.")
                raise NotModified(url)
            if (
                last_modified
                and cached.get("last_modified")
                and last_modified == cached["last_modified"]
            ):
                print("  ↪ Last-Modified inchangé → rien à faire.")
                raise NotModified(url)

        print("  Téléchargement…")
        body = telecharger(url, timeout=timeout)
        _ecrire_partage(url, body, last_modified, etag)

    sha = hashlib.sha256(body).hexdigest()

    if cached and cached.get("content_sha") == sha:
        _set_http_cache(
            cache_key,
            last_modified or cached.get("last_modified"),
            etag or cached.get("etag"),
            sha,
        )
        print("  ↪ SHA256 du contenu inchangé → rien à faire.")
        raise NotModified(url)

    # Le cache n'est PAS écrit ici : il attend que l'appelant confirme son import.
    # Il l'était juste avant ce `return`, donc un plantage pendant l'import laissait la
    # source marquée « vue ». La nuit suivante répondait « inchangé, rien à faire » et
    # sortait en 0 : une alerte le premier soir, puis plus rien, alors que le trou dans
    # les données restait jusqu'à ce que la source republie son fichier.
    _caches_en_attente[cache_key] = (last_modified, etag, sha)
    size_mb = len(body) / 1024 / 1024
    origine = "relus du partage" if partage is not None else "téléchargés"
    print(f"  OK — {size_mb:.1f} Mo {origine}, SHA={sha[:12]}…")
    return zipfile.ZipFile(io.BytesIO(body))


def confirmer_import(url: str, *, label: str = "") -> None:
    """Enregistre le cache HTTP d'une ressource dont l'import a réussi.

    À appeler avec les mêmes `url` et `label` que `download_zip_if_modified`, une fois
    les écritures terminées. Sans cet appel, la ressource sera retéléchargée et
    réimportée la prochaine fois : c'est le sens de panne souhaitable, les upserts
    étant idempotents et `upsert_si_change` n'écrivant que ce qui change.
    """
    cache_key = f"{label}:{url}" if label else url
    entree = _caches_en_attente.pop(cache_key, None)
    if entree is None:
        return
    _set_http_cache(cache_key, *entree)


# ---------------------------------------------------------------------------
# Empreinte stable d'une ligne
# ---------------------------------------------------------------------------

def compute_row_hash(payload: dict, *, exclude: Iterable[str] = ()) -> str:
    """Retourne un SHA256 stable d'un payload. Sert d'identifiant dérivé du contenu
    (`import_transparence_senat.py`), plus de cache d'écriture."""
    excluded = set(exclude)
    filtered = {k: v for k, v in payload.items() if k not in excluded}
    data = json.dumps(filtered, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Écriture par lots qui ne perd que les lignes fautives
# ---------------------------------------------------------------------------

# Lignes seules tombées d'affilée sur une panne passagère (reprises comprises) au-delà
# desquelles `upsert_isole` conclut à une panne de la base ou du réseau.
PANNES_AVANT_ABANDON = 3

def erreur_passagere(e: Exception) -> bool:
    """Vrai pour une panne qui mérite d'être rejouée : timeout ou coupure réseau.

    Les coupures TLS (`SSLV3_ALERT_BAD_RECORD_MAC`) et les connexions fermées par le
    serveur ont été constatées le 2026-09-30 sur de gros lots envoyés depuis un poste
    local : le même lot passait au deuxième essai. `[Errno 32] Broken pipe` l'a été le
    2026-10-08, dans les mêmes conditions.
    """
    msg = str(e).lower()
    return any(m in msg for m in (
        "timeout", "time-out", "57014", "'code': 504", '"code": 504',
        "ssl", "connection", "remoteprotocol", "server disconnected", "broken pipe",
    ))


def _upsert(table: str, lot: list[dict], on_conflict: str, *,
            si_change: bool = False, sans_comparer: tuple[str, ...] = ()) -> int:
    """Un upsert en une requête, qui rend le nombre de lignes insérées ou modifiées.

    `json_populate_recordset(NULL::table, …)` convertit chaque valeur JSON au type de sa
    colonne : un texte ISO devient une date, une liste un
    tableau ou un jsonb selon la colonne. Toutes les lignes du lot portent les mêmes
    colonnes (l'appelant les groupe) ; seules ces colonnes sont insérées, puis, sur
    conflit, réécrites. `table`, `on_conflict` et les noms de colonnes viennent du code,
    jamais d'une donnée, et passent quand même par `psql.Identifier`.

    `si_change` : une ligne déjà en base n'est réécrite que si l'une de ses colonnes
    diffère (`IS DISTINCT FROM`), hors `sans_comparer`. C'est ce qui remplace le cache
    d'empreintes (`RowHashCache`) : la base compare elle-même, une ligne inchangée ne
    déclenche ni trigger ni ligne morte, et n'est pas comptée. Une colonne de
    `sans_comparer` (un horodatage que le script pose à chaque passe) est écrite avec
    le reste quand la ligne change, et laissée telle quelle sinon : c'est ce que faisait
    le cache, qui n'envoyait pas du tout une ligne inchangée.
    """
    colonnes = list(lot[0])
    cles_conflit = [c.strip() for c in on_conflict.split(",")]
    a_ecrire = [c for c in colonnes if c not in cles_conflit]
    requete = psql.SQL(
        "INSERT INTO {t} AS t ({cols}) SELECT {cols} FROM json_populate_recordset(NULL::{t}, %s) "
        "ON CONFLICT ({conflit}) "
    ).format(
        t=psql.Identifier(table),
        cols=psql.SQL(", ").join(map(psql.Identifier, colonnes)),
        conflit=psql.SQL(", ").join(map(psql.Identifier, cles_conflit)),
    )
    if a_ecrire:
        requete += psql.SQL("DO UPDATE SET {}").format(psql.SQL(", ").join(
            psql.SQL("{c} = excluded.{c}").format(c=psql.Identifier(c)) for c in a_ecrire
        ))
        comparees = [c for c in a_ecrire if c not in sans_comparer]
        if si_change and comparees:
            requete += psql.SQL(" WHERE ROW({a}) IS DISTINCT FROM ROW({n})").format(
                a=psql.SQL(", ").join(psql.SQL("t.{}").format(psql.Identifier(c)) for c in comparees),
                n=psql.SQL(", ").join(psql.SQL("excluded.{}").format(psql.Identifier(c)) for c in comparees),
            )
    else:
        requete += psql.SQL("DO NOTHING")
    # Sa propre transaction (un point de reprise si l'appelant en a ouvert une) : un
    # lot rejeté n'empêche pas la moitié suivante de la bissection de passer.
    conn = _connexion()
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(requete, (Json(lot, dumps=_json_compact),))
        return max(cur.rowcount, 0)


def _json_compact(valeur) -> str:
    """JSON sans espaces ni échappement des accents, la forme des valeurs déjà en base.

    Une liste écrite dans une colonne `text` (`textes.organe_referent_ref`) y garde le
    texte JSON reçu : avec les séparateurs par défaut de `json.dumps`, `["PO1", "PO2"]`
    différait de `["PO1","PO2"]` déjà en base, et 82 textes étaient réécrits pour rien
    (constaté le 2026-11-05).
    """
    return json.dumps(valeur, ensure_ascii=False, separators=(",", ":"))


# Taille visée d'une requête d'écriture, en octets de JSON : au-delà, une connexion
# perd parfois son paquet en route sans erreur claire (CLAUDE.md, écritures par lots).
OCTETS_PAR_LOT = 1_000_000


def _par_taille(lignes: list[dict]) -> list[list[dict]]:
    """Découpe `lignes` en lots d'environ `OCTETS_PAR_LOT` de JSON, dans l'ordre."""
    lots: list[list[dict]] = [[]]
    taille = 0
    for ligne in lignes:
        n = len(json.dumps(ligne, ensure_ascii=False, default=str))
        if lots[-1] and taille + n > OCTETS_PAR_LOT:
            lots.append([])
            taille = 0
        lots[-1].append(ligne)
        taille += n
    return [lot for lot in lots if lot]


def upsert_si_change(table: str, lignes: list[dict], on_conflict: str, *,
                     sans_comparer: Iterable[str] = (), cle: str = "uid",
                     journal=print) -> tuple[int, list[dict]]:
    """`upsert_isole` qui n'écrit que les lignes nouvelles ou changées, et rend
    `(lignes écrites, lignes perdues)`. Voir `_upsert` pour `sans_comparer`."""
    compte = [0]
    perdues = upsert_isole(table, lignes, on_conflict, cle=cle, journal=journal,
                           _si_change=True, _sans_comparer=tuple(sans_comparer), _compte=compte)
    return compte[0], perdues


def upsert_isole(table: str, lignes: list[dict], on_conflict: str, *,
                 cle: str = "uid", journal=print, _si_change: bool = False,
                 _sans_comparer: tuple[str, ...] = (), _compte: list[int] | None = None) -> list[dict]:
    """Upsert `lignes` en base et renvoie celles qui n'ont pas pu être écrites.

    Un lot rejeté est coupé en deux et chaque moitié renvoyée, jusqu'à isoler la ou les
    lignes fautives. Avant, une seule ligne invalide faisait perdre son lot entier : le
    2026-09-30, un dossier citant un organe inconnu emportait avec lui 499 dossiers
    valides, puis leurs textes et leurs actes, faute de dossier en base. Une ligne seule
    qui échoue sur une panne passagère est rejouée deux fois avant d'être abandonnée.

    Quand la base ou le réseau tombe, ce n'est plus une ligne qui échoue mais toutes :
    sans garde, la bissection finirait par envoyer chaque ligne seule, avec ses deux
    reprises et six secondes de pause, soit une cinquantaine de minutes pour un lot de
    500, de quoi dépasser le `timeout-minutes` du cron et priver toutes les étapes
    suivantes de leur tour. Après `PANNES_AVANT_ABANDON` lignes seules tombées d'affilée
    sur une panne passagère, le reste du lot est donc rendu tel quel, sans autre requête.

    L'appelant décide de la suite : les lignes rendues comptent comme perdues en
    écriture (panne passagère, le script sort en 1 et la nuit suivante retente).

    Une colonne absente d'une ligne veut dire « ne pas y toucher ». Une requête porte
    les colonnes de sa première ligne (`_upsert`), et une ligne qui n'en a pas une y
    écrirait NULL : les lignes partent donc par jeu de colonnes,
    une requête par groupe. Sans ce tri, un sénateur sans ses
    coordonnées (`_colonnes_senat.py`) les perdait, et une loi promulguée, envoyée sans
    `lien_texte` pour garder l'URL de Légifrance, voyait ce lien effacé chaque fois
    qu'elle partait avec des documents (`import_textes_cloud.py`).
    """
    pannes_d_affilee = 0

    def envoyer(lot: list[dict], essai: int = 0) -> list[dict]:
        nonlocal pannes_d_affilee
        if not lot or pannes_d_affilee >= PANNES_AVANT_ABANDON:
            return lot
        try:
            ecrites = _upsert(table, lot, on_conflict, si_change=_si_change, sans_comparer=_sans_comparer)
            if _compte is not None:
                _compte[0] += ecrites
            pannes_d_affilee = 0
            return []
        except Exception as e:
            if len(lot) > 1:
                milieu = len(lot) // 2
                return envoyer(lot[:milieu]) + envoyer(lot[milieu:])
            if erreur_passagere(e):
                if essai < 2:
                    time.sleep(2 * (essai + 1))
                    return envoyer(lot, essai + 1)
                pannes_d_affilee += 1
            journal(f"❌ {table} {lot[0].get(cle)} non écrit : {type(e).__name__}: {e}")
            if pannes_d_affilee == PANNES_AVANT_ABANDON:
                journal(f"❌ {table} : panne persistante, reste du lot abandonné sans nouvel essai")
            return lot

    groupes: dict[tuple[str, ...], list[dict]] = {}
    for ligne in lignes:
        groupes.setdefault(tuple(sorted(ligne)), []).append(ligne)
    return [perdue for groupe in groupes.values() for lot in _par_taille(groupe) for perdue in envoyer(lot)]


def creer_organes_manquants(uids: Iterable[str | None]) -> None:
    """Crée une ligne `organes` réduite à son uid pour chaque organe cité mais absent.

    L'Assemblée cite dans ses dossiers et ses textes des organes qu'elle ne publie dans
    aucun de ses fichiers d'organes (constaté le 2026-09-30 : PO847238, la mission
    d'évaluation et de contrôle des lois de financement de la sécurité sociale). Les
    clés étrangères de `dossiers_legislatifs`, `textes` et `actes_legislatifs` rejettent
    alors la ligne. Une fiche minimale la laisse entrer ; `import_acteurs_organes_cloud`
    la complétera si l'organe apparaît un jour dans les fichiers de l'Assemblée.
    `ON CONFLICT DO NOTHING` : un organe déjà en base n'est pas touché.

    Ne lève pas. Les appelants l'invoquent juste avant d'écrire un lot, hors de toute
    reprise : une coupure réseau ici faisait tomber tout l'import des dossiers, ou se
    comptait comme un fichier
    illisible dans celui des textes. Si la création échoue, les lignes qui citaient ces
    organes sont rejetées par la clé étrangère et comptées comme perdues en écriture.
    """
    donnees = [{"uid": uid} for uid in sorted({u for u in uids if u})]
    if not donnees:
        return
    try:
        with _connexion().cursor() as cur:
            cur.execute(
                "INSERT INTO organes (uid) SELECT unnest(%s::text[]) ON CONFLICT (uid) DO NOTHING",
                ([d["uid"] for d in donnees],),
            )
    except Exception as e:
        print(f"⚠️  Création de {len(donnees)} organe(s) manquant(s) impossible : {type(e).__name__}: {e}")
