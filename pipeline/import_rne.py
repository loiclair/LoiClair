"""
import_rne.py
Importe les mandats locaux des parlementaires depuis le Répertoire national des
élus (ministère de l'Intérieur, data.gouv.fr, Licence Ouverte 2.0).

Pourquoi cette source : l'open data de l'Assemblée ne publie aucun mandat local
(ses 29 types de mandats sont tous internes au monde parlementaire), et le dump
du Sénat, qui en a, ne couvre que les sénateurs et ne clôture pas les mandats
non renouvelés. Le RNE couvre les deux chambres et suit les scrutins locaux.

Le registre ne paraît qu'environ tous les trois mois et retarde sur la réalité :
`corrections_rne.json`, tenu à la main après chaque vérification au cas par cas,
dit ce que LoiClair a constaté depuis (fonction quittée, siège quitté, erreur du
registre) et d'où il le tient. L'import le pose à côté de la ligne du registre,
dans les colonnes `verif_*`, sans toucher à la ligne elle-même. Le même fichier
dit, par élu, si un recours contre l'élection est en cours (il suspend le délai de
choix) ou quelle date limite retenir quand le calcul ne sait pas la dater.

Alimente : mandats_locaux, situations_cumul, sync_etat (clé `verification_cumul`)

Usage : python import_rne.py
"""

import csv
import io
import json
import sys
import unicodedata
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import psycopg
import requests
from dotenv import load_dotenv
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, ecrire_lot, lire

# ── Configuration ─────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# La connexion Postgres (variables PG*) est ouverte par `main()` et passée aux fonctions.
BATCH_SIZE = 500

# Identifiant du jeu de données « Répertoire national des élus ». On passe par
# l'API plutôt que par les URLs statiques : celles-ci portent un horodatage
# (.../20260811-154802/...) qui change à chaque millésime, les figer casserait
# au prochain.
DATASET_API = "https://www.data.gouv.fr/api/1/datasets/5c34c4d1634f4173183a64f1/"

# Population municipale, par code INSEE. LO 141 ne compte le siège municipal
# qu'à partir de 1 000 habitants : sans ce chiffre, un parlementaire conseiller
# de son village serait compté comme cumulant, ce que la loi ne dit pas. Le
# registre des élus ne publie pas la population, l'API Géo si.
API_GEO_COMMUNES = "https://geo.api.gouv.fr/communes?fields=code,population&format=json"

# Chaque type de mandat, le fragment qui identifie sa ressource dans le jeu de
# données, et la colonne qui porte le nom de la collectivité. Le RNE publie un
# fichier par type de mandat, avec des en-têtes qui ne se recouvrent qu'en
# partie : d'où la colonne à nommer ici plutôt qu'à deviner.
# Le troisième champ nomme la colonne du code INSEE, quand le fichier en publie
# une : elle sert à retrouver la population de la commune.
SOURCES = {
    "municipal":      ("conseiller-municipal",         "Libellé de la commune", "Code de la commune"),
    "communautaire":  ("conseiller-communautaire",     "Libellé de l'EPCI", None),
    "departemental":  ("conseiller-departemental",     "Libellé du canton", None),
    "regional":       ("conseiller-regional",          "Libellé de la région", None),
    "arrondissement": ("conseiller-darrondissement",   "Libellé de la commune", "Code de la commune"),
    "assemblee":      ("membre-dune-assemblee",        "Libellé de la collectivité à statut particulier", None),
}

# Les corrections constatées à la main. Dans le dépôt plutôt qu'en base : chaque
# correction y garde sa source et son historique git, et une correction retirée du
# fichier disparaît de la base à l'import suivant.
CORRECTIONS = Path(__file__).resolve().parent / "corrections_rne.json"

# Clé de `sync_etat` qui porte la date de la dernière vérification au cas par cas.
# Les autres lecteurs de la table filtrent sur `nightly` et ne la voient pas.
CLE_VERIFICATION = "verification_cumul"

EFFETS = {"fonction_quittee", "mandat_quitte", "fonction_jamais_exercee"}

# Le site d'une assemblée ne prouve pas qu'un mandat local a pris fin : ses fiches
# ne suivent pas les mandats locaux (le 24 octobre 2026, celle du Sénat donnait
# encore Dimitri Doussot président d'une intercommunalité dont le successeur était
# élu depuis douze jours). Une correction cite donc une source municipale,
# départementale, régionale ou de presse, jamais l'une d'elles.
DOMAINES_REFUSES = ("senat.fr", "assemblee-nationale.fr")


# ── Utilitaires ───────────────────────────────────────────────────────────────


def _normalize_name(s: str) -> str:
    """Normalise un nom pour le rapprochement : sans accents, sans ponctuation,
    en majuscules. Les particules et traits d'union tombent aussi, le RNE et
    l'Assemblée ne les écrivant pas pareil (« de Lépinau » / « DE LEPINAU »)."""
    if not s:
        return ""
    n = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return "".join(c for c in n.upper() if c.isalpha())


def _date_or_none(s: str | None) -> str | None:
    """Le RNE écrit ses dates en YYYY-MM-DD, mais laisse des cellules vides."""
    s = (s or "").strip()
    return s[:10] if s else None


def _upsert_batch(conn: psycopg.Connection, table: str, rows: list, conflict: str) -> None:
    """Upsert une liste de dicts par batch, avec split automatique sur timeout."""
    for i in range(0, len(rows), BATCH_SIZE):
        _upsert_single(conn, table, rows[i : i + BATCH_SIZE], conflict)


def _upsert_single(conn: psycopg.Connection, table: str, batch: list, conflict: str) -> None:
    try:
        ecrire_lot(conn, table, batch, conflict)
    except Exception as e:
        msg = str(e).lower()
        if ("timeout" in msg or "57014" in msg or "504" in msg) and len(batch) > 50:
            mid = len(batch) // 2
            tqdm.write(f"⏱️  Timeout {table} ({len(batch)} rows) — split en 2x{mid}")
            _upsert_single(conn, table, batch[:mid], conflict)
            _upsert_single(conn, table, batch[mid:], conflict)
            return
        tqdm.write(f"❌ Erreur upsert {table} ({len(batch)} rows): {type(e).__name__}: {e}")


# ── Source ────────────────────────────────────────────────────────────────────


def resoudre_ressources() -> tuple[dict[str, str], str]:
    """Retourne {type de mandat: URL du CSV} et le millésime du jeu de données.

    La date de mise à jour sert de `date_donnee` : elle dit de quand parle le
    mandat local, alors que la qualité de parlementaire, elle, vient du sync
    nocturne. Sans elle, on juxtaposerait deux instantanés d'époques
    différentes sans le dire.
    """
    print("Résolution des ressources sur data.gouv.fr...")
    meta = requests.get(DATASET_API, timeout=60)
    meta.raise_for_status()
    meta = meta.json()

    millesime = (meta.get("last_update") or "")[:10]
    urls: dict[str, str] = {}
    for ressource in (meta.get("resources") or []):
        url = ressource.get("url") or ""
        for cle, (fragment, _, _code) in SOURCES.items():
            # Le titre de la ressource et le nom du fichier divergent
            # (« elus-conseillers-municipaux-cm.csv » pointe sur
            # « elus-conseiller-municipal-cm.csv ») : on cherche dans l'URL.
            if fragment in url:
                urls[cle] = url

    manquants = set(SOURCES) - set(urls)
    if manquants:
        raise RuntimeError(f"Ressources RNE introuvables : {', '.join(sorted(manquants))}")

    print(f"  → {len(urls)} fichiers, millésime {millesime}")
    return urls, millesime


def charger_populations() -> dict[str, int]:
    """La population municipale par code INSEE, pour appliquer le seuil de
    LO 141. Une douzaine de communes sur 35 000 n'en publient pas ; elles
    ressortiront sans population et ne seront pas comptées comme franchissant
    le seuil, ce qui est le sens de la prudence."""
    print("Chargement des populations communales...")
    reponse = requests.get(API_GEO_COMMUNES, timeout=120)
    reponse.raise_for_status()
    populations = {
        c["code"]: c["population"]
        for c in reponse.json()
        if c.get("population")
    }
    print(f"  → {len(populations)} communes")
    return populations


def telecharger_csv(url: str) -> list[dict]:
    """Télécharge un CSV du RNE et retourne ses lignes."""
    response = requests.get(url, timeout=300)
    response.raise_for_status()
    text = response.content.decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text), delimiter=";"))


# ── Rapprochement ─────────────────────────────────────────────────────────────


def charger_parlementaires(conn: psycopg.Connection) -> dict[tuple[str, str, str], str]:
    """L'index des parlementaires en exercice, pour le rapprochement.

    Le RNE n'a évidemment pas les identifiants de l'Assemblée : le seul pont
    est l'état civil, et la clé porte ses trois éléments ensemble, nom, prénom
    et date de naissance.
    """
    strict: dict[tuple[str, str, str], str] = {}

    lignes = lire(
        conn,
        """
        select uid, nom, prenom, date_naissance
        from acteurs
        where en_exercice = true and (est_depute_actuel = true or est_senateur_actuel = true)
        order by uid
        """,
    )
    for a in lignes:
        naissance = (a.get("date_naissance") or "")[:10]
        nom, prenom = _normalize_name(a.get("nom")), _normalize_name(a.get("prenom"))
        strict[(nom, prenom, naissance)] = a["uid"]

    print(f"  → {len(strict)} parlementaires en exercice")
    return strict


def resoudre_uid(ligne: dict, strict: dict) -> str | None:
    """L'uid du parlementaire derrière une ligne du RNE, ou None.

    Les trois éléments de la clé doivent correspondre, et aucun ne se relâche.

    Relâcher le prénom rattache un homonyme : constaté au 2026-09-09, un repli
    sur le seul couple (nom, date de naissance) produisait sept rapprochements
    dont cinq faux, « Frédéric BONNET » et « Richard BONNET » atterrissant tous
    deux chez le député Arnaud Bonnet, et « Muriel MULLER » chez le député Serge
    Muller. Rien dans le registre ne distingue un homonyme né le même jour d'un
    élu dont il orthographie le prénom autrement : les deux cas ont exactement
    la même forme. On ne devine donc pas, et le prix est un mandat manquant
    quand le registre diverge (Jean-Pierre Vigier, qu'il inscrit « Peter »).
    C'est le sens de la limite annoncée dans la méthodologie de
    /Facts/cumul-des-mandats : mieux vaut manquer un cumul que d'en attribuer
    un à tort sur une fiche nominative.

    La date de naissance est tout aussi obligatoire. Sans elle, testé au
    2026-09-06, un repli sur le seul couple (nom, prénom) rattrapait 282 lignes
    et sortait un homonyme « conseiller municipal » de treize communes à la
    fois.
    """
    nom = _normalize_name(ligne.get("Nom de l'élu"))
    prenom = _normalize_name(ligne.get("Prénom de l'élu"))
    naissance = (ligne.get("Date de naissance") or "").strip()[:10]

    return strict.get((nom, prenom, naissance))


# ── Corrections ───────────────────────────────────────────────────────────────


def _verifier_source(url: str | None, ou: object) -> None:
    """Lève sur une source absente ou tirée du site d'une assemblée (`DOMAINES_REFUSES`)."""
    hote = (urlparse(url or "").hostname or "").lower()
    if not hote:
        raise ValueError(f"Source manquante dans {CORRECTIONS.name} : {ou}")
    if any(hote == d or hote.endswith("." + d) for d in DOMAINES_REFUSES):
        raise ValueError(f"Source refusée (site d'une assemblée) dans {CORRECTIONS.name} : {url} ({ou})")


def _verifier_date(valeur: str | None, ou: object, obligatoire: bool = False) -> None:
    """Lève sur une date qui n'est pas `AAAA-MM-JJ`.

    Vérifiée ici et non laissée à la base : une date mal formée ferait refuser tout
    un lot de `mandats_locaux`, et `_upsert_single` ne fait qu'écrire l'erreur au
    journal. Le workflow resterait vert, et la date de vérification avancerait
    quand même sur des corrections jamais posées.
    """
    if valeur is None and not obligatoire:
        return
    try:
        date.fromisoformat(valeur)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise ValueError(f"Date invalide dans {CORRECTIONS.name} : {valeur!r} ({ou})") from None


def charger_corrections() -> tuple[str, dict[tuple[str, str, str], dict], dict[str, dict]]:
    """La date de la dernière vérification, les corrections par clé de ligne, et les
    situations par uid (recours en cours, ou date limite imposée).

    Lève sur un effet inconnu, une clé en double, une source refusée ou une date
    mal formée : le fichier
    s'écrit à la main, et une faute de frappe qui passerait en silence afficherait
    une correction fausse sur une fiche nominative, ou n'en afficherait aucune.
    """
    contenu = json.loads(CORRECTIONS.read_text(encoding="utf-8"))
    verification = contenu["derniere_verification"]
    _verifier_date(verification, "derniere_verification", obligatoire=True)
    corrections: dict[tuple[str, str, str], dict] = {}
    for c in contenu["corrections"]:
        cle = (c["uid"], c["type"], c["collectivite"])
        if c["effet"] not in EFFETS:
            raise ValueError(f"Effet inconnu dans {CORRECTIONS.name} : {c['effet']} ({cle})")
        if cle in corrections:
            raise ValueError(f"Correction en double dans {CORRECTIONS.name} : {cle}")
        _verifier_source(c.get("source_url"), cle)
        _verifier_date(c.get("date") or None, cle)
        corrections[cle] = c
    situations: dict[str, dict] = {}
    for s in contenu.get("situations") or []:
        if s["uid"] in situations:
            raise ValueError(f"Situation en double dans {CORRECTIONS.name} : {s['uid']}")
        # L'un ou l'autre : un recours en cours n'a pas encore de date limite, et
        # une date imposée suppose qu'aucun recours ne la suspend.
        if bool(s.get("recours")) == bool(s.get("date_limite")):
            raise ValueError(f"Situation sans recours ni date limite, ou avec les deux : {s['uid']}")
        _verifier_source(s.get("source_url"), s["uid"])
        _verifier_date(s.get("date_limite") or None, s["uid"])
        situations[s["uid"]] = s
    return verification, corrections, situations


def appliquer_corrections(lignes: dict[tuple[str, str, str], dict], corrections: dict) -> None:
    """Pose les colonnes `verif_*` sur chaque ligne, à NULL quand rien n'est constaté.

    Toutes les lignes reçoivent les quatre colonnes, pas seulement les corrigées :
    l'upsert n'écrit que les colonnes qu'on lui donne, et une correction retirée du
    fichier resterait sinon en base.
    """
    for cle, ligne in lignes.items():
        c = corrections.get(cle) or {}
        ligne["verif_effet"] = c.get("effet")
        ligne["verif_date"] = c.get("date") or None
        ligne["verif_source_url"] = c.get("source_url")
        ligne["verif_source_nom"] = c.get("source_nom")

    # Deux cas à lire dans le journal, qui disent tous deux qu'une correction est
    # devenue inutile : à retirer du fichier.
    for cle, c in sorted(corrections.items()):
        ligne = lignes.get(cle)
        if ligne is None:
            # Le registre a rattrapé son retard (le siège a disparu), ou la clé est mal
            # recopiée : le libellé de collectivité s'écrit comme dans `mandats_locaux`.
            print(f"⚠️  Correction sans ligne dans le registre, à retirer : {cle}")
        elif c["effet"] != "mandat_quitte" and not ligne["fonction"]:
            print(f"⚠️  Correction de fonction sur une ligne qui n'en a plus, à retirer : {cle}")


def ecrire_situations(conn: psycopg.Connection, situations: dict[str, dict]) -> None:
    """Recopie les situations du fichier dans `situations_cumul`, en entier.

    Quelques dizaines de lignes : upsert de toutes, puis suppression de celles que
    le fichier ne porte plus (un recours jugé, une date limite devenue inutile).
    """
    lignes = [
        {
            "uid": uid,
            "recours": bool(s.get("recours")),
            "date_limite": s.get("date_limite") or None,
            "source_url": s["source_url"],
            "source_nom": s.get("source_nom"),
        }
        for uid, s in situations.items()
    ]
    # `ecrire_lot` et non `_upsert_batch` : une erreur doit lever ici, elle n'est pas
    # seulement journalisée.
    if lignes:
        ecrire_lot(conn, "situations_cumul", lignes, "uid")
    en_base = {l["uid"] for l in lire(conn, "select uid from situations_cumul")}
    retirees = sorted(en_base - set(situations))
    if retirees:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM situations_cumul WHERE uid = ANY(%s)", (retirees,))
    print(f"   Situations         : {len(lignes)} écrites, {len(retirees)} retirées")


def ecrire_date_verification(conn: psycopg.Connection, verification: str) -> None:
    """La date affichée par la page et la fiche (« dernière vérification : … »).

    `derniere_reussite` est un horodatage : la date y entre à minuit UTC, et les
    écrans la formatent en UTC pour retomber sur le même jour.
    """
    maintenant = datetime.now(timezone.utc).isoformat()
    ecrire_lot(
        conn,
        "sync_etat",
        [{
            "cle": CLE_VERIFICATION,
            "derniere_reussite": f"{verification}T00:00:00+00:00",
            "updated_at": maintenant,
        }],
        "cle",
    )


# ── Écriture ──────────────────────────────────────────────────────────────────


def cles_existantes(conn: psycopg.Connection) -> set[tuple[str, str, str]]:
    """Les clés déjà en table, pour retirer ensuite celles que le nouveau
    millésime ne contient plus (un élu qui n'a pas été réélu)."""
    lignes = lire(conn, "select uid, type, collectivite from mandats_locaux")
    return {(l["uid"], l["type"], l["collectivite"]) for l in lignes}


def supprimer_obsoletes(conn: psycopg.Connection, obsoletes: set[tuple[str, str, str]]) -> None:
    """Supprime les seules clés disparues du millésime, en une requête : elles se
    comptent en dizaines, et une purge complète laisserait la table vide le temps
    de la réinsertion, sous les yeux des pages qui se régénèrent."""
    triees = sorted(obsoletes)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM mandats_locaux t
                USING unnest(%s::text[], %s::text[], %s::text[]) AS v(uid, type, collectivite)
                WHERE t.uid = v.uid AND t.type = v.type AND t.collectivite = v.collectivite
                """,
                ([c[0] for c in triees], [c[1] for c in triees], [c[2] for c in triees]),
            )
    except psycopg.Error as e:
        tqdm.write(f"❌ Suppression de {len(triees)} mandats: {type(e).__name__}: {e}")


# ── Programme principal ───────────────────────────────────────────────────────


def main() -> None:
    # Autocommit : chaque écriture est validée seule, et une qui échoue n'en annule pas une autre.
    conn = connexion(autocommit=True)
    try:
        _importer(conn)
    finally:
        conn.close()


def _importer(conn: psycopg.Connection) -> None:
    # Lu avant tout téléchargement : un fichier mal formé arrête l'import avant
    # qu'il ait écrit quoi que ce soit.
    verification, corrections, situations = charger_corrections()

    urls, millesime = resoudre_ressources()

    populations = charger_populations()

    print("\nChargement des parlementaires en exercice...")
    strict = charger_parlementaires(conn)

    lignes_a_ecrire: dict[tuple[str, str, str], dict] = {}

    for type_mandat, url in urls.items():
        _, colonne_collectivite, colonne_code = SOURCES[type_mandat]
        print(f"\n{type_mandat} : {url.split('/')[-1]}")
        brut = telecharger_csv(url)
        print(f"  {len(brut)} élus dans le fichier")

        retenues = 0
        for ligne in brut:
            uid = resoudre_uid(ligne, strict)
            if not uid:
                continue

            collectivite = (ligne.get(colonne_collectivite) or "").strip()
            if not collectivite:
                continue

            code = (ligne.get(colonne_code) or "").strip() if colonne_code else None
            lignes_a_ecrire[(uid, type_mandat, collectivite)] = {
                "uid": uid,
                "type": type_mandat,
                "collectivite": collectivite,
                "fonction": (ligne.get("Libellé de la fonction") or "").strip() or None,
                "date_debut": _date_or_none(ligne.get("Date de début du mandat")),
                "date_debut_fonction": _date_or_none(ligne.get("Date de début de la fonction")),
                "date_donnee": millesime,
                "code_collectivite": code or None,
                "population": populations.get(code) if code else None,
            }
            retenues += 1
        print(f"  → {retenues} mandats de parlementaires")

    print(f"\n{len(lignes_a_ecrire)} mandats retenus")

    appliquer_corrections(lignes_a_ecrire, corrections)

    anciennes = cles_existantes(conn)
    obsoletes = anciennes - set(lignes_a_ecrire)
    if obsoletes:
        print(f"{len(obsoletes)} mandats disparus du millésime")
        supprimer_obsoletes(conn, obsoletes)

    print("Écriture...")
    _upsert_batch(conn, "mandats_locaux", list(lignes_a_ecrire.values()), "uid,type,collectivite")
    ecrire_situations(conn, situations)
    ecrire_date_verification(conn, verification)

    # Résumé par chambre : c'est le chiffre que l'article et les fiches
    # afficheront, autant le voir tout de suite si l'import a dérapé.
    par_uid = defaultdict(set)
    for (uid, type_mandat, _) in lignes_a_ecrire:
        par_uid[uid].add(type_mandat)
    # Ce que LO 141 compte vraiment : ni le siège communautaire, qui découle du
    # mandat municipal par fléchage, ni un conseil municipal de moins de
    # 1 000 habitants.
    lo141 = {"municipal", "departemental", "regional", "arrondissement", "assemblee"}
    compte_lo141 = set()
    for ligne in lignes_a_ecrire.values():
        if ligne["type"] not in lo141:
            continue
        if ligne["type"] in ("municipal", "arrondissement") and (ligne["population"] or 0) < 1000:
            continue
        compte_lo141.add(ligne["uid"])
    cumulards = len(compte_lo141)

    print(f"\n{'='*60}")
    print(f"   Millésime RNE      : {millesime}")
    print(f"   Mandats écrits     : {len(lignes_a_ecrire)}")
    print(f"   Parlementaires     : {len(par_uid)} touchés, dont {cumulards} avec un mandat LO 141")
    print(f"   Corrections        : {sum(1 for l in lignes_a_ecrire.values() if l['verif_effet'])} posées, vérification du {verification}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
