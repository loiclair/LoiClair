"""
import_transparence_an.py
Importe les trois registres de déontologie de l'Assemblée nationale : les dons et
invitations de plus de 150 €, les voyages financés par des tiers, et les déports
pour conflit d'intérêts.

Pourquoi ces sources : elles nomment les députés, disent qui a offert quoi et
pourquoi un élu se retire d'un texte. Aucune n'existe en open data, ni sur
data.gouv.fr ni sur data.assemblee-nationale.fr : l'Assemblée les publie en pages
web, sous le régime des informations publiques (CRPA L321-1 et suivants). Son
`robots.txt` n'interdit pas ces chemins, et le projet scrape déjà le baromètre
d'application des lois sur le même domaine.

Chaque ligne des registres porte l'identifiant du député (« PA719372 » dans le
lien et dans le `data-document-id`), donc aucun rapprochement par nom : c'est le
registre qui nomme l'acteur, pas nous.

Alimente : transparence_elements (sources `an_dons`, `an_voyages`, `an_deports`)

Usage : python import_transparence_an.py
"""

import html
import re
import sys
import time
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup
import psycopg
from dotenv import load_dotenv
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import signaler_anomalie
from _db import connexion, ecrire_lot, lire
from _telechargement import recuperer

# ── Configuration ─────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# La connexion Postgres (variables PG*) est ouverte par `main()` et passée aux fonctions.
BATCH_SIZE = 500

LEGISLATURE_AN = "17"
BASE = "https://www.assemblee-nationale.fr"
UA = "LoiClair/1.0 (+https://loiclair.fr)"
PAUSE = 0.4

# Le paramètre `limit` de l'URL est ignoré par le serveur, qui sert sept lignes
# par page quoi qu'on demande (les liens de pagination annoncent pourtant
# `limit=5`). On boucle donc jusqu'à une page vide, sans jamais coder le nombre
# de pages en dur, il bouge à chaque déclaration.
#
# Une page au-delà de la dernière rend bien zéro ligne et non une répétition de
# la dernière : vérifié le 2026-09-11 sur les pages 27, 28, 99 et 500 des dons
# et 19, 20, 99 et 500 des voyages. C'est ce qui rend l'arrêt fiable, et le
# plafond ci-dessous n'est qu'un garde-fou si ce comportement changeait.
PLAFOND_PAGES = 200

# Un registre qui rend moins de cette part de ce qu'il contenait au passage
# précédent n'est pas un registre qui s'est vidé, c'est une page qui a changé de
# forme. On écrit alors ce qu'on a lu, mais on ne supprime rien.
SEUIL_RECONCILIATION = 0.8

# `data-document-id` des dons et des voyages, et identifiant d'un déport. Les
# trois portent l'uid de l'acteur, qui est ce qu'on vient chercher.
MOTIF_DOCUMENT = re.compile(r"^(?:DDON|DVOY)ANR5L\d+(PA\d+)\w*$")
MOTIF_DEPORT = re.compile(r"^DPTR5L\d+(PA\d+)\w*$")


# ── Utilitaires ───────────────────────────────────────────────────────────────


def _ecrire_lot(conn: psycopg.Connection, lot: list) -> None:
    """Upsert d'un lot dans `transparence_elements`, clé `(source, identifiant)` : voir
    `_db.ecrire_lot`."""
    ecrire_lot(conn, "transparence_elements", lot, "source,identifiant")


def _upsert_batch(conn: psycopg.Connection, rows: list) -> None:
    """Upsert par batch, avec split automatique sur timeout."""
    for i in range(0, len(rows), BATCH_SIZE):
        _upsert_single(conn, rows[i : i + BATCH_SIZE])


def _upsert_single(conn: psycopg.Connection, batch: list) -> None:
    try:
        _ecrire_lot(conn, batch)
    except Exception as e:
        msg = str(e).lower()
        if ("timeout" in msg or "57014" in msg or "504" in msg) and len(batch) > 50:
            mid = len(batch) // 2
            tqdm.write(f"⏱️  Timeout ({len(batch)} rows) — split en 2x{mid}")
            _upsert_single(conn, batch[:mid])
            _upsert_single(conn, batch[mid:])
            return
        tqdm.write(f"❌ Erreur upsert ({len(batch)} rows): {type(e).__name__}: {e}")


def _propre(texte: str | None) -> str | None:
    """Le texte d'une cellule, espaces recollés, ou None si elle est vide.

    Le `unescape` est nécessaire même après BeautifulSoup : les registres
    publient des entités doublement encodées (`&amp;#13;` dans la source), dont le
    parseur ne défait qu'une couche. Sans lui, « &#13; » s'affiche tel quel au
    milieu du descriptif d'un cadeau.
    """
    if not texte:
        return None
    valeur = " ".join(html.unescape(texte).split())
    return valeur or None


def _date_fr(texte: str | None) -> str | None:
    """Les registres écrivent jj/mm/aaaa, Postgres attend aaaa-mm-jj."""
    valeur = _propre(texte)
    if not valeur:
        return None
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", valeur)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def telecharger(url: str) -> BeautifulSoup | None:
    try:
        contenu = recuperer(url, timeout=60, entetes={"User-Agent": UA})
        return BeautifulSoup(contenu, "html.parser")
    except Exception as e:
        tqdm.write(f"⚠️  {url} : {type(e).__name__}: {e}")
        return None


# ── Lecture des registres ─────────────────────────────────────────────────────


def lire_tableau(chemin: str, source: str, colonnes: int, projection) -> list[dict] | None:
    """Parcourt un registre paginé et rend ses lignes.

    Rend None dès qu'une page n'a pas pu être lue : c'est une panne passagère (le
    site répond mal), pas un registre vide, et le cron retentera demain. Une page
    ratée en cours de route compte autant que la première : un registre lu en partie
    passerait le garde-fou de volume d'`ecrire` dès qu'il garde 80 % des lignes, et
    la réconciliation supprimerait les dons des pages manquantes.
    """
    elements: list[dict] = []
    vus: set[str] = set()
    millesime = date.today().isoformat()
    # Les lignes rejetées se comptent au lieu de se signaler une par une : une refonte
    # du registre les rend toutes invalides d'un coup, et signaler chacune noierait le
    # bilan nocturne sous des centaines de lignes qui disent la même chose. On garde le
    # premier exemple de chaque famille, qui suffit à diagnostiquer.
    mal_formees, exemple_forme = 0, ""
    mal_identifiees, exemple_identifiant = 0, ""

    for page in range(1, PLAFOND_PAGES + 1):
        soup = telecharger(f"{BASE}{chemin}?page={page}")
        if soup is None:
            return None
        lignes = soup.select("table tr")
        trouvees = 0

        for ligne in lignes:
            cellules = ligne.find_all("td")
            if not cellules:
                continue  # En-tête.
            if len(cellules) != colonnes:
                mal_formees += 1
                exemple_forme = exemple_forme or f"page {page}, {len(cellules)} colonnes"
                continue

            balise = ligne.find(attrs={"data-document-id": True})
            identifiant = balise["data-document-id"] if balise else None
            m = MOTIF_DOCUMENT.match(identifiant or "")
            if not m:
                mal_identifiees += 1
                exemple_identifiant = exemple_identifiant or f"page {page}, {identifiant!r}"
                continue

            trouvees += 1
            if identifiant in vus:
                continue  # Une page rejouée ne doit pas doubler les lignes.
            vus.add(identifiant)

            element = projection([_propre(c.get_text()) for c in cellules])
            element.update({
                "source": source,
                "identifiant": identifiant,
                "uid": m.group(1),
                "url_source": f"{BASE}{chemin}",
                "date_donnee": millesime,
            })
            elements.append(element)

        if trouvees == 0:
            break
        time.sleep(PAUSE)
    else:
        signaler_anomalie(source, f"Plafond de {PLAFOND_PAGES} pages atteint sur {chemin}.")

    if mal_formees:
        signaler_anomalie(
            source,
            f"{mal_formees} lignes au mauvais nombre de colonnes sur {chemin} "
            f"(attendu {colonnes} ; première : {exemple_forme}) : la forme du registre a changé.",
        )
    if mal_identifiees:
        signaler_anomalie(
            source,
            f"{mal_identifiees} lignes à l'identifiant inattendu sur {chemin} "
            f"(première : {exemple_identifiant}).",
        )

    return elements


def projection_don(c: list[str | None]) -> dict:
    """Député | date | descriptif | valeur | tiers donateur | consignation | don à l'AN.

    Les deux dernières colonnes disent ce que le député a fait du cadeau. Elles ne
    valent d'être affichées que lorsqu'il s'en est séparé : « non / non » est le
    cas ordinaire et n'apprend rien.
    """
    remises = []
    if (c[5] or "").lower() == "oui":
        remises.append("remis au déontologue")
    if (c[6] or "").lower() == "oui":
        remises.append("donné à l'Assemblée nationale")
    return {
        "categorie": "cadeau",
        "date_element": _date_fr(c[1]),
        "intitule": c[2] or "Don ou invitation",
        "tiers": c[4],
        "valeur_texte": c[3],
        "detail": ", ".join(remises) or None,
    }


def projection_voyage(c: list[str | None]) -> dict:
    """Député | date d'envoi | destination | dates | durée | financeur | descriptif.

    `date_element` porte la date d'envoi de la déclaration, la seule des deux qui
    soit une date : la colonne du déplacement est une phrase (« du 17 juin 2026
    au 19 juin 2026 ») que le déclarant écrit à sa main.
    """
    detail = " · ".join(x for x in (c[3], c[6]) if x)
    return {
        "categorie": "voyage",
        "date_element": _date_fr(c[1]),
        "intitule": c[2] or "Déplacement",
        "tiers": c[5],
        "valeur_texte": c[4],
        "detail": detail or None,
    }


def lire_deports() -> list[dict] | None:
    """Le registre des déports, qui n'est pas un tableau mais une suite de blocs.

    Un déport est le geste le plus parlant des trois : un député qui se retire
    lui-même d'un texte précis, en disant pourquoi. Son identifiant porte l'uid
    (« DPTR5L17PA795722D0002 ») et sa cible nomme le texte visé.
    """
    elements: list[dict] = []
    vus: set[str] = set()
    millesime = date.today().isoformat()
    chemin = f"/dyn/{LEGISLATURE_AN}/deports"
    # Mêmes compteurs que `lire_tableau`, pour la même raison : une refonte de la page
    # rend toutes les lignes invalides d'un coup, et il ne doit en sortir qu'un signal.
    mal_identifies, exemple_identifiant = 0, ""
    sans_cible, exemple_cible = 0, ""

    for page in range(1, PLAFOND_PAGES + 1):
        soup = telecharger(f"{BASE}{chemin}?page={page}")
        if soup is None:
            return None  # Même raison que dans `lire_tableau`.

        blocs = [a for a in soup.select("a[href^='/dyn/deports/']")]
        if not blocs:
            break
        nouveaux = 0

        for lien in blocs:
            identifiant = lien["href"].rsplit("/", 1)[-1]
            m = MOTIF_DEPORT.match(identifiant)
            if not m:
                mal_identifies += 1
                exemple_identifiant = exemple_identifiant or f"page {page}, {identifiant!r}"
                continue

            # Ce registre tient sur une page et ignore le paramètre `page` : sans ce
            # filtre, la boucle rejoue les mêmes déports jusqu'au plafond, et l'upsert
            # échoue en bloc dès qu'un identifiant apparaît deux fois dans un batch.
            if identifiant in vus:
                continue
            vus.add(identifiant)
            nouveaux += 1

            bloc = lien.parent
            champs = _champs_deport(bloc)
            cible = champs.get("Cible")
            if not cible:
                sans_cible += 1
                exemple_cible = exemple_cible or identifiant
                continue

            # L'explication est le seul champ sans étiquette du bloc : c'est le
            # motif du conflit, cité tel que le député l'a écrit.
            explication = bloc.select_one(".deport-embed--explication")
            detail = " · ".join(x for x in (
                champs.get("Instance"),
                champs.get("Lecture"),
                _propre(explication.get_text()) if explication else None,
            ) if x)

            elements.append({
                "source": "an_deports",
                "identifiant": identifiant,
                "uid": m.group(1),
                "categorie": "deport",
                "date_element": _date_texte(champs.get("Date")),
                "intitule": cible,
                "tiers": None,
                "valeur_texte": champs.get("Portée"),
                "detail": detail or None,
                "url_source": f"{BASE}/dyn/deports/{identifiant}",
                "date_donnee": millesime,
            })

        if nouveaux == 0:
            break
        time.sleep(PAUSE)
    else:
        signaler_anomalie("an_deports", f"Plafond de {PLAFOND_PAGES} pages atteint.")

    if mal_identifies:
        signaler_anomalie(
            "an_deports",
            f"{mal_identifies} déports à l'identifiant inattendu (premier : {exemple_identifiant}).",
        )
    if sans_cible:
        signaler_anomalie(
            "an_deports",
            f"{sans_cible} déports sans texte visé (premier : {exemple_cible}).",
        )

    return elements


def _champs_deport(bloc) -> dict[str, str | None]:
    """Les champs étiquetés d'un bloc de déport : « Date : », « Cible : »…"""
    champs = {}
    for etiquette in bloc.select(".deport-embed--tag"):
        cle = (etiquette.get_text() or "").strip().rstrip(":").strip()
        valeur = etiquette.find_next_sibling("span")
        champs[cle] = _propre(valeur.get_text()) if valeur else None
    return champs


MOIS = {
    "janvier": "01", "février": "02", "mars": "03", "avril": "04",
    "mai": "05", "juin": "06", "juillet": "07", "août": "08",
    "septembre": "09", "octobre": "10", "novembre": "11", "décembre": "12",
}


def _date_texte(valeur: str | None) -> str | None:
    """Le registre des déports écrit ses dates en toutes lettres (« 17 juin 2026 »),
    là où les deux autres emploient jj/mm/aaaa.

    Le premier du mois s'y écrit « 1er juin 2026 » : sans le suffixe ordinal optionnel,
    le motif ne reconnaît rien et la ligne perd sa date, un jour sur trente.
    """
    if not valeur:
        return None
    m = re.search(r"(\d{1,2})(?:er)?\s+([a-zéûôA-Z]+)\s+(\d{4})", valeur, re.I)
    if not m:
        return _date_fr(valeur)
    mois = MOIS.get(m.group(2).lower())
    return f"{m.group(3)}-{mois}-{int(m.group(1)):02d}" if mois else None


# ── Écriture ──────────────────────────────────────────────────────────────────


def identifiants_existants(conn: psycopg.Connection, source: str) -> set[str]:
    """Les identifiants déjà en table pour cette source, pour retirer ensuite
    ceux que le registre ne publie plus."""
    lignes = lire(
        conn, "select identifiant from transparence_elements where source = %s order by identifiant", (source,)
    )
    return {l["identifiant"] for l in lignes}


def ecrire(conn: psycopg.Connection, source: str, elements: list[dict]) -> int:
    """Écrit un registre, puis réconcilie, sauf si le volume s'est effondré.

    Le garde-fou de volume est ce qui sépare « le registre a changé » de « la
    page a changé de forme ». Sans lui, une refonte du site de l'Assemblée
    viderait la section de centaines de fiches en une nuit, sans rien signaler.
    """
    avant = identifiants_existants(conn, source)
    if elements:
        _upsert_batch(conn, elements)

    apres = {e["identifiant"] for e in elements}
    obsoletes = avant - apres

    if avant and len(apres) < len(avant) * SEUIL_RECONCILIATION:
        signaler_anomalie(
            source,
            f"{len(apres)} lignes lues contre {len(avant)} en base : chute inexpliquée, "
            f"{len(obsoletes)} suppressions annulées par précaution.",
        )
        print(f"   ⚠️  volume en chute ({len(apres)} vs {len(avant)}) — aucune suppression")
        return len(elements)

    if obsoletes:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM transparence_elements WHERE source = %s AND identifiant = ANY(%s)",
                    (source, sorted(obsoletes)),
                )
        except psycopg.Error as e:
            tqdm.write(f"❌ Suppression {source} ({len(obsoletes)} lignes): {type(e).__name__}: {e}")
    return len(elements)


# ── Programme principal ───────────────────────────────────────────────────────


def main() -> None:
    # Autocommit : chaque écriture est validée seule, et une qui échoue n'en annule pas une autre.
    conn = connexion(autocommit=True)
    try:
        _importer(conn)
    finally:
        conn.close()


def _importer(conn: psycopg.Connection) -> None:
    print("=" * 60)
    print("   Import transparence — registres de l'Assemblée nationale")
    print("=" * 60)

    passes = [
        ("an_dons", "Dons et invitations", lambda: lire_tableau(
            "/dyn/donsetvoyages/dons", "an_dons", 7, projection_don)),
        ("an_voyages", "Voyages financés par des tiers", lambda: lire_tableau(
            "/dyn/donsetvoyages/voyages", "an_voyages", 7, projection_voyage)),
        ("an_deports", "Déports", lire_deports),
    ]

    resultats = {}
    for source, titre, lecture in passes:
        print(f"\n{titre}...")
        elements = lecture()
        if elements is None:
            print(f"❌ {titre} : une page n'a pas pu être lue, registre laissé tel quel.")
            sys.exit(1)
        resultats[source] = ecrire(conn, source, elements)
        print(f"   {resultats[source]} éléments")

    print(f"\n{'='*60}")
    for source, nombre in resultats.items():
        print(f"   {source:<14} : {nombre}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
