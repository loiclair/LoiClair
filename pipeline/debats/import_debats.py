"""Import des débats parlementaires (Syseron AN + CRI Sénat) vers Postgres.

Entrée : ZIPs officiels téléchargés via `download_zip_if_modified` (cache HTTP).
Sortie : tables `debat_seances` et `debat_interventions`, texte des interventions
compris (`debat_interventions.texte`, migration 2026-11-05_textes_en_base.sql).

Usage :
    python debats/import_debats.py             # import complet (AN + Sénat)
    python debats/import_debats.py --an        # AN seul
    python debats/import_debats.py --senat     # Sénat seul

Le script est idempotent :
- les zips inchangés (ETag / Last-Modified / SHA256) lèvent `NotModified`
  et on ne télécharge même pas le corps ;
- les séances sont upsertées par `uid` (pas de doublon) ;
- les interventions d'une séance existante sont purgées puis réinsérées, dans la
  même transaction que la séance (AN et Sénat traitent les deux de la même façon) ;
- une séance dont la ligne et les interventions sont déjà identiques en base n'est pas
  réécrite : la base la compare elle-même (`_uids_a_ecrire`), sans cache d'empreintes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import re
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, TypeVar

import psycopg
from dotenv import load_dotenv
from psycopg.types.json import Json
from tqdm import tqdm

# Import relatif quand exécuté en package, sinon ajoute le parent au path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from _db import connexion, lire  # noqa: E402
from _signets import charger_signets, dossier_du_signet  # noqa: E402
from _sync_cache import (  # noqa: E402
    NotModified,
    confirmer_import,
    download_zip_if_modified,
)

from debats.parse_an import map_nums_to_dossiers, parse_an_xml  # noqa: E402
from debats.parse_senat import (  # noqa: E402
    map_matricules_to_acteurs,
    map_signets_to_dossiers,
    parse_senat_xml,
)


load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env.local")


AN_ZIP_URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/vp/syceronbrut/syseron.xml.zip"
SEN_ZIP_URL = "https://data.senat.fr/data/debats/cri.zip"


# ═════════════════════════════════════════════════════════════════════════════
# Écriture en base
# ═════════════════════════════════════════════════════════════════════════════

# Colonnes comparées à la base par `_uids_a_ecrire` (hors clés et `created_at`, posé par la
# base). Constantes du code : elles entrent telles quelles dans le SQL. `texte` n'en fait
# pas partie : `debat_seances.texte_hash` le résume (voir `calculer_empreinte_seance`), ce
# qui évite de renvoyer ~100 Mo de texte à la base chaque nuit pour le comparer. Il
# s'écrit en plus de ces colonnes (`_ecrire_groupe`).
COLONNES_SEANCE = ("chambre", "date_seance", "legislature", "session_lib", "titre",
                   "url_source", "texte_hash")
COLONNES_INTERVENTION = ("seance_uid", "ordre", "point_titre", "article", "amendement",
                         "dossier_uid", "texte_num", "acteur_uid", "orateur_nom",
                         "orateur_qualite", "role_debat", "stime", "nb_mots")

# Taille visée d'une requête d'écriture ou de comparaison, en octets de JSON (CLAUDE.md,
# écritures par lots). Un lot de séances s'arrête à la première qui dépasse ce seuil : une
# séance n'est jamais coupée, sa purge et sa réinsertion tiennent dans une seule transaction.
OCTETS_PAR_LOT = 1_000_000


_conn: psycopg.Connection | None = None


def _connexion() -> psycopg.Connection:
    """Connexion du script, rouverte si elle est tombée. Autocommit : une lecture ne laisse
    pas de transaction ouverte pendant le parsing des séances qui suit, et chaque écriture
    ouvre la sienne avec `conn.transaction()`."""
    global _conn
    if _conn is None or _conn.closed or _conn.broken:
        _conn = connexion(autocommit=True)
    return _conn


T = TypeVar("T")


def _retry(fn: Callable[[], T], *, what: str, attempts: int = 5, base_delay: float = 4.0) -> T:
    """Exécute `fn()` avec retry exponentiel sur les coupures de connexion (réseau
    instable : tethering, réseau domestique saturé, tunnel SSH coupé). `fn` appelle
    `_connexion()` elle-même, qui rouvre la connexion tombée. Un dépassement de
    `statement_timeout` (`QueryCanceled`) n'est pas rejoué : le même lot échouerait
    pareil, l'appelant le coupe en deux."""
    for attempt in range(1, attempts + 1):
        try:
            return fn()
        except psycopg.errors.QueryCanceled:
            raise
        except psycopg.OperationalError as e:
            if attempt == attempts:
                raise
            delay = base_delay * (2 ** (attempt - 1))
            print(f"  ⏱️  {what} — {type(e).__name__} (tentative {attempt}/{attempts}), retry dans {delay:.0f}s…")
            time.sleep(delay)
    raise RuntimeError("unreachable")


def _lignes_intervention(interventions: list[dict[str, Any]], avec_texte: bool = False) -> list[dict[str, Any]]:
    """Les colonnes de `debat_interventions` de chaque intervention, sans les clés
    privées préfixées par `_` (ex : `_matricule_senat` si `map_…` n'a pas tourné).
    `texte` n'y figure que pour l'écriture (`avec_texte`), pas pour la comparaison."""
    colonnes = (*COLONNES_INTERVENTION, "texte") if avec_texte else COLONNES_INTERVENTION
    return [{c: iv.get(c) for c in colonnes} for iv in interventions]


def _ligne_seance(seance: dict[str, Any]) -> dict[str, Any]:
    return {c: seance.get(c) for c in ("uid", *COLONNES_SEANCE)}


def _json(valeur: Any) -> Json:
    return Json(valeur, dumps=lambda v: json.dumps(v, ensure_ascii=False, separators=(",", ":")))


def _uids_a_ecrire(entrees: list[tuple[dict[str, Any], list[dict[str, Any]]]],
                   existants: set[str]) -> set[str]:
    """Les uid de séance à écrire parmi `entrees` (séance, lignes d'interventions).

    Remplace le cache d'empreintes : la base compare elle-même. Une séance est à écrire si
    elle n'est pas en base, si sa ligne diffère (`texte_hash` compris, qui couvre tout le
    texte), ou si ses interventions ne sont pas exactement celles de la base, dans un sens
    comme dans l'autre (`EXCEPT` traite deux NULL comme égaux). Les interventions sont
    comparées sans leur `id` ni `created_at`, que la réinsertion renouvelle, et sans
    `texte`, que `texte_hash` résume.
    """
    a_ecrire = {s["uid"] for s, _ in entrees if s["uid"] not in existants}
    en_base = [(s, lignes) for s, lignes in entrees if s["uid"] in existants]
    if not en_base:
        return a_ecrire
    cols_s = ", ".join(COLONNES_SEANCE)
    cols_s_d = ", ".join(f"d.{c}" for c in COLONNES_SEANCE)
    cols_s_s = ", ".join(f"s.{c}" for c in COLONNES_SEANCE)
    cols_i = ", ".join(COLONNES_INTERVENTION)
    requete = f"""
        WITH s AS (
            SELECT uid, {cols_s} FROM json_populate_recordset(NULL::debat_seances, %(seances)s)
        ), i AS (
            SELECT {cols_i} FROM json_populate_recordset(NULL::debat_interventions, %(interventions)s)
        ), t AS (
            SELECT {cols_i} FROM debat_interventions WHERE seance_uid IN (SELECT uid FROM s)
        )
        SELECT s.uid FROM s LEFT JOIN debat_seances d ON d.uid = s.uid
        WHERE d.uid IS NULL OR ROW({cols_s_d}) IS DISTINCT FROM ROW({cols_s_s})
        UNION
        SELECT seance_uid FROM (SELECT * FROM i EXCEPT SELECT * FROM t) en_plus
        UNION
        SELECT seance_uid FROM (SELECT * FROM t EXCEPT SELECT * FROM i) en_moins
    """
    params = {
        "seances": _json([_ligne_seance(s) for s, _ in en_base]),
        "interventions": _json([ligne for _, lignes in en_base for ligne in lignes]),
    }

    def comparer() -> list[tuple]:
        with _connexion().cursor() as cur:
            cur.execute(requete, params)
            return cur.fetchall()

    a_ecrire.update(r[0] for r in _retry(comparer, what="comparaison des séances"))
    return a_ecrire


def _ecrire_groupe(entrees: list[tuple[dict[str, Any], list[dict[str, Any]]]]) -> tuple[int, int]:
    """Purge, upsert et réinsertion d'un groupe de séances, en UNE transaction.

    Avant, trois requêtes séparées laissaient, en cas d'échec au milieu, une séance sans
    ses interventions ou avec celles de deux versions. Ici tout passe ou rien ne bouge.
    `entrees` : (séance, interventions parsées, `texte` compris).
    Rend (séances écrites, interventions insérées).
    """
    uids = [s["uid"] for s, _ in entrees]
    seances = [_ligne_seance(s) for s, _ in entrees]
    lignes = [ligne for _, liees in entrees for ligne in _lignes_intervention(liees, avec_texte=True)]
    maj = ", ".join(f"{c} = excluded.{c}" for c in COLONNES_SEANCE)
    cols_s = ", ".join(("uid", *COLONNES_SEANCE))
    cols_i = ", ".join((*COLONNES_INTERVENTION, "texte"))
    conn = _connexion()
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("DELETE FROM debat_interventions WHERE seance_uid = ANY(%s)", (uids,))
        cur.execute(
            f"INSERT INTO debat_seances ({cols_s}) SELECT {cols_s} "
            f"FROM json_populate_recordset(NULL::debat_seances, %s) "
            f"ON CONFLICT (uid) DO UPDATE SET {maj}",
            (_json(seances),),
        )
        cur.execute(
            f"INSERT INTO debat_interventions ({cols_i}) SELECT {cols_i} "
            f"FROM json_populate_recordset(NULL::debat_interventions, %s)",
            (_json(lignes),),
        )
        return len(seances), cur.rowcount


def _ecrire_seances(entrees: list[tuple[dict[str, Any], list[dict[str, Any]]]]) -> tuple[int, int]:
    """`_ecrire_groupe` qui isole la séance fautive : un groupe refusé (contrainte,
    timeout) est coupé en deux jusqu'à ne perdre que la ou les séances en cause, laissées
    intactes en base par l'annulation de la transaction. Une coupure de connexion qui
    survit aux reprises de `_retry` remonte : la base est injoignable, inutile de la
    marteler séance par séance. Rend (séances écrites, interventions insérées)."""
    if not entrees:
        return 0, 0
    try:
        return _retry(lambda: _ecrire_groupe(entrees), what=f"écriture de {len(entrees)} séance(s)")
    except psycopg.errors.QueryCanceled as e:
        erreur: psycopg.Error = e
    except psycopg.OperationalError:
        raise
    except psycopg.Error as e:
        erreur = e
    if len(entrees) > 1:
        milieu = len(entrees) // 2
        a = _ecrire_seances(entrees[:milieu])
        b = _ecrire_seances(entrees[milieu:])
        return a[0] + b[0], a[1] + b[1]
    print(f"❌ écriture de {entrees[0][0]['uid']} : {erreur}")
    return 0, 0


def _purger_interventions(seance_uids: list[str]) -> tuple[int, int]:
    """Supprime les interventions de ces séances. Rend (séances touchées, lignes supprimées)."""
    def purger() -> tuple[int, int]:
        with _connexion().cursor() as cur:
            cur.execute(
                "WITH d AS (DELETE FROM debat_interventions WHERE seance_uid = ANY(%s) "
                "RETURNING seance_uid) SELECT count(DISTINCT seance_uid), count(*) FROM d",
                (seance_uids,),
            )
            return tuple(cur.fetchone())  # type: ignore[return-value]
    return _retry(purger, what="purge des interventions")


@dataclass
class Ecriture:
    """Accumule les séances parsées d'une chambre et les écrit par lots d'environ 1 Mo.

    Rôle : lisser la mémoire (le Sénat traite ses ~100 Mo de CRI séance par séance) tout
    en gardant une comparaison et une écriture par lot, jamais par séance. Appelée par
    `import_an` et `import_senat`, qui lisent ensuite les compteurs.
    `existants` : uid des séances déjà en base pour la chambre.
    """
    existants: set[str]
    entrees: list[tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]] = field(default_factory=list)
    octets: int = 0
    seances: int = 0           # séances écrites (nouvelles ou changées)
    interventions: int = 0     # interventions insérées
    inchangees: int = 0        # séances identiques à la base, non réécrites
    rafraichies: int = 0       # séances déjà en base et réécrites
    echecs: int = 0            # séances laissées de côté, reprises au prochain import

    def ajouter(self, seance: dict[str, Any], liees: list[dict[str, Any]]) -> None:
        """Pose `texte_hash` et `nb_mots` (calculés ici, rien n'est envoyé), puis met la
        séance en attente. Appelée après le filtrage des `acteur_uid` : la base garde les
        valeurs filtrées, on les compare donc filtrées. Le lot est mesuré texte compris :
        c'est ce qui part à l'écriture, et le texte en fait l'essentiel."""
        calculer_empreinte_seance(seance, liees)
        lignes = _lignes_intervention(liees)
        self.entrees.append((seance, liees, lignes))
        self.octets += len(json.dumps(lignes, ensure_ascii=False)) + sum(len(iv["texte"]) for iv in liees)
        if self.octets >= OCTETS_PAR_LOT:
            self.vider()

    def vider(self) -> None:
        """Compare le lot à la base, puis écrit les séances qui diffèrent."""
        if not self.entrees:
            return
        entrees, self.entrees, self.octets = self.entrees, [], 0
        a_ecrire = _uids_a_ecrire([(s, lignes) for s, _, lignes in entrees], self.existants)
        self.inchangees += len(entrees) - len(a_ecrire)
        pretes = [(seance, liees) for seance, liees, _ in entrees if seance["uid"] in a_ecrire]
        ecrites, inserees = _ecrire_seances(pretes)
        self.seances += ecrites
        self.interventions += inserees
        self.rafraichies += sum(1 for s, _ in pretes if s["uid"] in self.existants)
        # Une séance non écrite (refusée par la base) est reprise au prochain import.
        self.echecs += len(pretes) - ecrites


# ═════════════════════════════════════════════════════════════════════════════
# Empreinte et nombre de mots du texte
# ═════════════════════════════════════════════════════════════════════════════
#
# Le texte est écrit dans `debat_interventions.texte`. `debat_seances.texte_hash` en est
# l'empreinte : sha256 du JSON canonique `{ordre: texte}` de la séance (`fichier_texte_seance`).
# Elle date du temps où ce JSON était un fichier hors de la base ; elle
# est gardée telle quelle parce qu'elle sert encore, à la place du texte, à savoir si une
# séance a changé (`_uids_a_ecrire`) et à `empreinte_debats` / `dossier_debats_calculer`,
# qui détectent ainsi un débat corrigé sans hacher 100 Mo de texte. Changer la formule
# réécrirait toutes les séances et ferait recalculer tous les résumés de débats.


def nb_mots(texte: str) -> int | None:
    """Nombre de mots lu par `recalc_nb_prises_parole()`, seule source des `nb_mots` écrits.

    Reproduit `array_length(string_to_array(trim(texte), ' '), 1)` de Postgres, la
    formule que la fonction appliquait à la colonne `texte` avant son retrait, et qui
    a rempli les lignes antérieures à l'import (migration du 2026-10-14) :
    `trim` ne retire que les espaces, le découpage se fait sur un seul espace (deux
    espaces de suite comptent un mot vide), et une chaîne vide donne NULL.
    """
    t = texte.strip(" ")
    return len(t.split(" ")) if t else None


def fichier_texte_seance(interventions: list[dict[str, Any]]) -> tuple[bytes, str]:
    """JSON canonique du texte d'une séance et son empreinte (sha256 hexadécimal).

    Seule l'empreinte sert encore (`calculer_empreinte_seance`). Sérialisation figée
    (clés triées, séparateurs fixes) : toute variation changerait `texte_hash` de toutes
    les séances. Le texte est pris tel que parsé, sans normalisation.
    """
    contenu = json.dumps(
        {str(iv["ordre"]): iv["texte"] for iv in interventions},
        ensure_ascii=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")
    return contenu, hashlib.sha256(contenu).hexdigest()


def calculer_empreinte_seance(seance: dict[str, Any], interventions: list[dict[str, Any]]) -> None:
    """Pose `texte_hash` sur la séance et `nb_mots` sur les lignes, sans rien envoyer.

    Calculé pour toutes les séances à chaque import : c'est la comparaison avec la base
    (`_uids_a_ecrire`) qui décide ensuite lesquelles méritent une écriture. `texte_hash`
    couvre l'ensemble du texte, la comparaison n'a donc pas à relire le texte lui-même.
    """
    _, seance["texte_hash"] = fichier_texte_seance(interventions)
    for iv in interventions:
        iv["nb_mots"] = nb_mots(iv["texte"])


# ═════════════════════════════════════════════════════════════════════════════
# Mappings num_notice / signet → dossier_uid
# ═════════════════════════════════════════════════════════════════════════════

# Forme « texte adopté » dans l'uid d'un texte AN : `PRJLANR5L17BTA0325`, `PIONANR5L17TAP0265`.
_RE_UID_TEXTE_ADOPTE = re.compile(r"L\d+(?:BTA|TAP)\d")


def _load_num_notice_to_dossier() -> dict[str, str]:
    """Charge un dict {num_notice: dossier_ref} pour l'AN legislature 17.

    Appelé par `import_an`, dont `map_nums_to_dossiers` rattache chaque intervention au
    numéro cité dans le titre du point de séance. Un numéro absent du dict laisse
    l'intervention sans dossier, donc hors import.

    Filtre `chambre = 'Assemblée Nationale'` (col. dérivée dans `textes` par
    `deduire_chambre` — le champ `provenance` désigne le type de texte, pas
    la chambre).

    Les textes adoptés sont écartés : ils ont leur propre numérotation, qui recoupe celle
    des dépôts (le projet de loi n° 325 et le texte adopté n° 325 sont deux textes de deux
    dossiers). Au 2026-09-14, les 337 numéros partagés par deux dossiers venaient tous de
    ce recouvrement, et le premier trouvé était gardé : 3 304 interventions étaient
    rangées sous le dossier du texte adopté, dont les débats du 28 octobre 2024 sur le
    budget de la Sécurité sociale sous la programmation militaire (DLR5L17N54083). Sur
    les 17 séances concernées, le titre du point désignait chaque fois le texte déposé
    sous ce numéro, jamais le texte adopté : une fois ces derniers écartés, toutes
    retombent sur le bon dossier.

    Un numéro qui désignerait encore plusieurs dossiers n'est pas rattaché : une
    intervention sans dossier vaut mieux qu'une intervention sous le mauvais.
    """
    dossiers_par_num: dict[str, set[str]] = {}
    # Une seule requête, triée par uid (clé primaire) : plus de pagination à rendre stable.
    rows = _retry(
        lambda: lire(
            _connexion(),
            "select uid, num_notice, dossier_ref from textes"
            " where legislature = 17 and chambre = 'Assemblée Nationale'"
            " and num_notice is not null and dossier_ref is not null order by uid",
        ),
        what="num_notice",
    )
    for r in rows:
        if _RE_UID_TEXTE_ADOPTE.search(r.get("uid") or ""):
            continue
        num = (r.get("num_notice") or "").lstrip("0") or "0"
        dref = r.get("dossier_ref")
        if num and dref:
            # Un même numéro revient sur plusieurs formes d'un texte (dépôt, texte de
            # la commission), toutes dans le même dossier : l'ensemble les confond.
            dossiers_par_num.setdefault(num, set()).add(dref)

    mapping = {num: next(iter(d)) for num, d in dossiers_par_num.items() if len(d) == 1}
    collisions = len(dossiers_par_num) - len(mapping)
    if collisions:
        print(f"   ⚠️  {collisions} numéro(s) partagé(s) par plusieurs dossiers : interventions laissées sans dossier.")
    return mapping


def _load_valid_acteur_uids() -> set[str]:
    """Charge l'ensemble des `acteurs.uid` existants pour filtrer les FK
    invalides avant insertion (ex: PA0, PA-125879 présents dans Syseron)."""
    rows = _retry(lambda: lire(_connexion(), "select uid from acteurs"), what="acteurs uids")
    return {r["uid"] for r in rows}


def _filter_acteur_fks(
    interventions: list[dict[str, Any]],
    valid_uids: set[str],
) -> int:
    """Remplace les `acteur_uid` inconnus par None. Retourne le nombre nullifié."""
    nullified = 0
    for iv in interventions:
        uid = iv.get("acteur_uid")
        if uid and uid not in valid_uids:
            iv["acteur_uid"] = None
            nullified += 1
    return nullified


def _load_matricule_senat_to_acteur() -> dict[str, str]:
    """Charge un dict {matricule_senat: acteurs.uid}. Vide tant que
    `sync_senat.py` n'a pas peuplé la colonne (fallback gracieux).

    Trié par `uid` : depuis que `import_acteurs_organes_cloud.py` remplit la colonne
    pour les anciens sénateurs, elle dépasse une page de 1 000, et des pages sans
    ordre peuvent se chevaucher ou sauter des lignes."""
    mapping: dict[str, str] = {}
    rows = _retry(
        lambda: lire(
            _connexion(),
            "select uid, matricule_senat from acteurs where matricule_senat is not null order by uid",
        ),
        what="matricule_senat",
    )
    for r in rows:
        mat = (r.get("matricule_senat") or "").strip()
        if mat:
            mapping[mat] = r["uid"]
    return mapping


# ═════════════════════════════════════════════════════════════════════════════
# Pipeline par chambre
# ═════════════════════════════════════════════════════════════════════════════

def _xml_file_hash(zip_ref: zipfile.ZipFile, name: str) -> str:
    """Hash rapide du contenu XML (utilisé pour détecter les modifs par fichier)."""
    with zip_ref.open(name) as f:
        return hashlib.sha256(f.read()).hexdigest()


def _load_existing_seance_uids(chambre: str) -> set[str]:
    """Liste les séances déjà importées pour une chambre."""
    rows = _retry(
        lambda: lire(_connexion(), "select uid from debat_seances where chambre = %s", (chambre,)),
        what=f"debat_seances existing ({chambre})",
    )
    return {r["uid"] for r in rows}


def import_an() -> dict[str, int]:
    """Télécharge et importe le verbatim AN (Syseron).

    Seules les interventions liées à un dossier présent en base sont importées.
    Les séances sans aucune intervention liée sont ignorées, sauf si elles sont déjà en
    base : leurs anciennes interventions sont alors purgées.
    """
    print("\n═══ Import AN (Syseron) ═══")
    stats = {"seances": 0, "interventions": 0, "skipped_unchanged": 0, "filtered": 0}
    echecs = 0
    purge_ratee = False
    try:
        zip_ref = download_zip_if_modified(AN_ZIP_URL)
    except NotModified:
        print("  ↪ ZIP AN inchangé → rien à importer.")
        return stats

    with zip_ref:
        xml_files = [n for n in zip_ref.namelist() if n.lower().endswith(".xml")]
        print(f"  {len(xml_files)} fichiers XML trouvés dans le ZIP.")

        print("  Chargement du mapping num_notice → dossier…")
        num_to_dossier = _load_num_notice_to_dossier()
        print(f"   → {len(num_to_dossier)} correspondances.")

        print("  Chargement des acteur_uid valides…")
        valid_acteur_uids = _load_valid_acteur_uids()
        print(f"   → {len(valid_acteur_uids)} acteurs en base.")

        existing_uids = _load_existing_seance_uids("AN")
        print(f"  {len(existing_uids)} séances AN déjà présentes.")

        ecriture = Ecriture(existing_uids)
        sans_intervention: list[str] = []
        total_parsed = 0
        total_liees = 0
        nullified_total = 0

        for name in tqdm(xml_files, desc="Parse AN", unit="xml"):
            try:
                with zip_ref.open(name) as f:
                    xml_bytes = f.read()
            except Exception as e:
                tqdm.write(f"⚠️  Lecture {name} : {e}")
                continue
            parsed = parse_an_xml(xml_bytes, source_name=name)
            if not parsed:
                continue
            seance, interventions = parsed
            interventions = map_nums_to_dossiers(num_to_dossier, interventions)
            total_parsed += len(interventions)
            # Ne garder que les interventions liées à un dossier en base
            linked = [iv for iv in interventions if iv["dossier_uid"] is not None]
            # Séance en base dont plus aucune intervention n'est rattachée (un numéro
            # devenu ambigu, un dossier retiré) : on purge ses anciennes interventions,
            # rien à réinsérer. Les ignorer, comme autrefois, les laissait sous le
            # dossier d'hier sans que rien ne le signale. Une séance absente de la base
            # et sans intervention liée n'a rien à purger ni à écrire.
            if not linked:
                if seance["uid"] in existing_uids:
                    sans_intervention.append(seance["uid"])
                continue
            nullified_total += _filter_acteur_fks(linked, valid_acteur_uids)
            total_liees += len(linked)
            ecriture.ajouter(seance, linked)
        ecriture.vider()

        if nullified_total:
            print(f"  ⚠️  {nullified_total} acteur_uid inconnus dans Syseron → remis à NULL.")

        if sans_intervention:
            try:
                purgees, lignes = _purger_interventions(sans_intervention)
                if purgees:
                    print(f"  Purge des interventions pour {purgees} séances existantes ({lignes} lignes)…")
            except psycopg.Error as e:
                # Séance non purgée : le ZIP ne sera pas confirmé, la purge est retentée demain.
                print(f"❌ delete debat_interventions : {e}")
                purge_ratee = True

        stats["seances"] = ecriture.seances
        stats["interventions"] = ecriture.interventions
        stats["skipped_unchanged"] = ecriture.inchangees
        stats["filtered"] = total_parsed - total_liees
        echecs = ecriture.echecs
        print(f"\n  → {ecriture.seances} séances écrites, {ecriture.interventions} interventions insérées "
              f"({total_liees} liées à un dossier sur {total_parsed} parsées, {stats['filtered']} filtrées, "
              f"{ecriture.inchangees} séances inchangées ignorées).")
        if echecs:
            print(f"  ❌ {echecs} séance(s) non écrites, reprises au prochain import.")

    # Une séance laissée de côté (écriture refusée par la base) n'est reprise
    # la nuit suivante que si le ZIP n'est pas marqué « vu » : sinon `NotModified` la
    # sauterait jusqu'à ce que l'Assemblée republie son fichier.
    if not echecs and not purge_ratee:
        confirmer_import(AN_ZIP_URL)
    return stats


def import_senat(local_zip_path: str | None = None, since: str | None = None) -> dict[str, int]:
    """Télécharge et importe le verbatim Sénat (CRI).

    Seules les interventions liées à un dossier présent en base sont importées.
    Les séances sans aucune intervention liée sont ignorées.

    Traitement séance par séance (RAM ~100 Mo). Les fichiers sont triés par
    date décroissante pour traiter les séances récentes en priorité.

    `since` (YYYY-MM-DD) : limite au nom de fichier `d{YYYYMMDD}.xml` ≥ cette date.
    """
    print("\n═══ Import Sénat (CRI) ═══")
    stats = {"seances": 0, "interventions": 0, "filtered": 0}
    seances_en_echec = 0
    if local_zip_path:
        print(f"  Utilisation du ZIP local : {local_zip_path}")
        zip_ref = zipfile.ZipFile(local_zip_path)
    else:
        try:
            zip_ref = download_zip_if_modified(SEN_ZIP_URL)
        except NotModified:
            print("  ↪ ZIP Sénat inchangé → rien à importer.")
            return stats

    with zip_ref:
        xml_files = [n for n in zip_ref.namelist() if n.lower().endswith((".xml", ".xhtml"))]
        if since:
            since_compact = since.replace("-", "")
            filtered = [n for n in xml_files if re.search(r"d(\d{8})", n) and re.search(r"d(\d{8})", n).group(1) >= since_compact]
            print(f"  {len(filtered)}/{len(xml_files)} fichiers ≥ {since} (filtre --senat-since).")
            xml_files = filtered
        else:
            print(f"  {len(xml_files)} fichiers trouvés dans le ZIP.")

        # Tri par date décroissante : les séances récentes (qui matchent les
        # dossiers en base) sont traitées en premier.
        xml_files.sort(key=lambda n: re.search(r"d(\d{8})", n).group(1) if re.search(r"d(\d{8})", n) else "0", reverse=True)

        print("  Chargement du mapping signet → dossier…")
        signet_to_dossier = _retry(lambda: charger_signets(_connexion()), what="signet")
        print(f"   → {len(signet_to_dossier)} correspondances.")

        print("  Chargement du mapping matricule_senat → acteur…")
        matricule_to_acteur = _load_matricule_senat_to_acteur()
        print(f"   → {len(matricule_to_acteur)} correspondances.")

        print("  Chargement des acteur_uid valides…")
        valid_acteur_uids = _load_valid_acteur_uids()

        existing_uids = _load_existing_seance_uids("SEN")
        print(f"  {len(existing_uids)} séances Sénat déjà présentes (seront rafraîchies).")

        ecriture = Ecriture(existing_uids)
        total_parsed = 0
        total_liees = 0
        nullified_total = 0

        for name in tqdm(xml_files, desc="Sénat", unit="xml"):
            try:
                with zip_ref.open(name) as f:
                    xml_bytes = f.read()
            except Exception as e:
                tqdm.write(f"⚠️  Lecture {name} : {e}")
                continue
            parsed = parse_senat_xml(xml_bytes, source_name=name)
            if not parsed:
                continue
            seance, interventions = parsed
            signets = {iv["texte_num"] for iv in interventions if iv.get("texte_num")}
            choix = {s: d for s in signets
                     if (d := dossier_du_signet(signet_to_dossier, s, seance["date_seance"]))}
            interventions = map_signets_to_dossiers(choix, interventions)
            interventions = map_matricules_to_acteurs(matricule_to_acteur, interventions)
            total_parsed += len(interventions)
            # Ne garder que les interventions liées à un dossier en base
            linked = [iv for iv in interventions if iv["dossier_uid"] is not None]
            if not linked:
                continue
            nullified_total += _filter_acteur_fks(linked, valid_acteur_uids)
            total_liees += len(linked)
            ecriture.ajouter(seance, linked)
        ecriture.vider()

        stats["seances"] = ecriture.seances
        stats["interventions"] = ecriture.interventions
        stats["skipped_unchanged"] = ecriture.inchangees
        stats["filtered"] = total_parsed - total_liees
        seances_en_echec = ecriture.echecs
        if nullified_total:
            print(f"  ⚠️  {nullified_total} acteur_uid inconnus dans CRI → remis à NULL.")
        if ecriture.rafraichies:
            print(f"  🔄 {ecriture.rafraichies} séances existantes rafraîchies.")
        if seances_en_echec:
            print(f"  ❌ {seances_en_echec} séance(s) non écrites, reprises au prochain import.")
        print(f"\n  → {stats['seances']} séances, {stats['interventions']} interventions liées à un dossier "
              f"({stats['filtered']} filtrées, {ecriture.inchangees} séances inchangées ignorées).")

    # Le ZIP ne se confirme (`confirmer_import`) que sur un import COMPLET.
    #
    # `--senat-zip` : le ZIP vient d'un chemin local, aucun ETag n'a été mis en
    # attente, l'appel serait sans effet mais trompeur.
    #
    # `--senat-since` : on n'a volontairement traité qu'une partie des séances.
    # Confirmer marquerait la source comme entièrement vue, et les séances plus
    # anciennes ne seraient jamais reprises : la nuit suivante répondrait « ZIP Sénat
    # inchangé, rien à importer » jusqu'à ce que le Sénat republie `cri.zip`.
    #
    # Une séance en échec (écriture refusée par la base) : même raison, elle
    # ne serait reprise qu'à la prochaine publication du ZIP.
    if not local_zip_path and not since and not seances_en_echec:
        confirmer_import(SEN_ZIP_URL)
    return stats


# ═════════════════════════════════════════════════════════════════════════════
# Entrée CLI
# ═════════════════════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--an", action="store_true", help="Importer uniquement AN")
    parser.add_argument("--senat", action="store_true", help="Importer uniquement Sénat")
    parser.add_argument("--senat-zip", help="Chemin local du cri.zip (bypass download)")
    parser.add_argument("--senat-since", help="Ignorer les séances Sénat avant cette date (YYYY-MM-DD)")
    args = parser.parse_args()

    do_an = args.an or not (args.an or args.senat)
    do_sen = args.senat or not (args.an or args.senat)

    totals = {"seances": 0, "interventions": 0, "filtered": 0}
    if do_an:
        s = import_an()
        for k in totals:
            totals[k] += s.get(k, 0)
    if do_sen:
        s = import_senat(local_zip_path=args.senat_zip, since=args.senat_since)
        for k in totals:
            totals[k] += s.get(k, 0)

    print("\n═══ Résumé ═══")
    print(f"  séances upsertées                : {totals['seances']}")
    print(f"  interventions insérées (liées)   : {totals['interventions']}")
    print(f"  interventions filtrées (sans dossier) : {totals['filtered']}")

    # Recalcul du compteur `acteurs.nb_prises_parole` (filtre Sénat ≥ 2023-10-02).
    # Définition courante : migration 2026-10-14_debats_retrait_texte.sql, qui lit `nb_mots`.
    print("\n  recalcul nb_prises_parole…", end=" ", flush=True)
    with _connexion().cursor() as cur:
        cur.execute("SELECT recalc_nb_prises_parole()")
    print("ok")
    _connexion().close()


if __name__ == "__main__":
    main()
