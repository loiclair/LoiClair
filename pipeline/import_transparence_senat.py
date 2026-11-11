"""
import_transparence_senat.py
Importe les deux registres de déontologie du Sénat : les cadeaux et déplacements
financés par des tiers de plus de 150 €, et le registre des déports.

Pourquoi ces sources : ce sont les pendants sénatoriaux des registres de
l'Assemblée, et la seule façon de ne pas laisser 348 fiches sans rien là où 577
en ont. Le Sénat les publie en PDF, sans open data ni page structurée.

Différence avec `import_transparence_an.py` : le PDF ne porte aucun identifiant
d'élu, seulement ce que la colonne « Membre du Sénat » accole. Et elle l'écrit
de deux façons selon les lignes, « GOULET Nathalie (Orne) » ou « Mme Nathalie
Goulet (Orne) », en abrégeant au passage les prénoms composés. Le rapprochement
se fait donc sur l'ensemble des mots du nom, par inclusion, le département ne
servant qu'à départager des homonymes parfaits (voir `resoudre_uid`). Une ligne
qu'on n'arrive pas à rattacher est comptée puis écartée, jamais rattachée au
hasard : un cadeau attribué au mauvais élu sur une fiche nominative est bien
pire qu'un cadeau manquant.

Alimente : transparence_elements (sources `senat_cadeaux`, `senat_deports`)

Usage : python import_transparence_senat.py
"""

import io
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import pdfplumber
import psycopg
from dotenv import load_dotenv
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import signaler_anomalie
from _db import connexion, ecrire_lot, lire
from _telechargement import recuperer
from _sync_cache import compute_row_hash

# ── Configuration ─────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# La connexion Postgres (variables PG*) est ouverte par `main()` et passée aux fonctions.
BATCH_SIZE = 500

BASE = "https://www.senat.fr/fileadmin/cru-1788783827/Connaitre_le_Senat/Fiches_techniques/Deontologie"
PDF_CADEAUX = f"{BASE}/Liste_cadeaux_avantages_invitations.pdf"
PDF_DEPORTS = f"{BASE}/Registre_des_deports.pdf"
UA = "LoiClair/1.0 (+https://loiclair.fr)"

# Part minimale de lignes rapprochées sous laquelle on n'écrit rien : en dessous,
# c'est la façon dont le PDF nomme les sénateurs qui a changé, pas le registre
# qui s'est vidé, et écrire reviendrait à amputer des centaines de fiches.
SEUIL_RAPPROCHEMENT = 0.9

# Même garde-fou que pour l'Assemblée : un registre qui rend beaucoup moins que
# la dernière fois n'est pas un registre qui se vide, c'est un PDF dont la mise
# en page a bougé. On écrit alors ce qu'on a lu, mais on ne supprime rien.
SEUIL_RECONCILIATION = 0.8

# Le type que le Sénat écrit en deuxième colonne, et la catégorie d'affichage.
# Les deux rejoignent les registres de l'Assemblée dans les mêmes blocs de la
# fiche : le lecteur n'a pas à savoir quelle chambre publie quoi.
TYPES = {"cadeau": "cadeau", "deplacement": "voyage"}


# ── Utilitaires ───────────────────────────────────────────────────────────────


def _ecrire_lot(conn: psycopg.Connection, lot: list) -> None:
    """Upsert d'un lot dans `transparence_elements`, clé `(source, identifiant)` : voir
    `_db.ecrire_lot`."""
    ecrire_lot(conn, "transparence_elements", lot, "source,identifiant")


def _upsert_batch(conn: psycopg.Connection, rows: list) -> None:
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


def _propre(cellule: str | None) -> str | None:
    """Le texte d'une cellule, retours à la ligne du PDF recollés."""
    if not cellule:
        return None
    valeur = " ".join(cellule.split())
    return valeur or None


def _normalise(s: str | None) -> str:
    """Sans accents, sans ponctuation, en majuscules. Même normalisation que
    `import_rne.py` : le Sénat et l'Assemblée n'écrivent pas les particules et
    les traits d'union de la même façon."""
    if not s:
        return ""
    n = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return "".join(c for c in n.upper() if c.isalpha())


def _date_fr(valeur: str | None) -> str | None:
    """Le PDF écrit jj/mm/aaaa, Postgres attend aaaa-mm-jj."""
    if not valeur:
        return None
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", valeur)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def telecharger_pdf(url: str) -> bytes | None:
    try:
        return recuperer(url, timeout=120, entetes={"User-Agent": UA})
    except Exception as e:
        print(f"⚠️  {url} : {type(e).__name__}: {e}")
        return None


def lignes_du_pdf(contenu: bytes, source: str) -> list[list[str | None]]:
    """Les lignes de tableau d'un PDF, page par page.

    `extract_table` plutôt qu'`extract_text` suivi d'un découpage en colonnes :
    la mise en page en colonnes est justement ce qui est fragile ici, et
    `extract_table` rend des cellules ou rien. Un échec franc vaut mieux qu'un
    décalage silencieux qui attribuerait la valeur d'un cadeau à son donateur.
    """
    lignes = []
    with pdfplumber.open(io.BytesIO(contenu)) as pdf:
        precedente_remplie = False
        for numero, page in enumerate(pdf.pages, start=1):
            table = page.extract_table()
            if not table:
                if precedente_remplie:
                    signaler_anomalie(
                        source,
                        f"Page {numero} du PDF sans tableau lisible alors que la précédente "
                        "en avait un : la mise en page a changé.",
                    )
                precedente_remplie = False
                continue
            precedente_remplie = True
            lignes.extend([_propre(c) for c in ligne] for ligne in table)
    return lignes


# ── Rapprochement ─────────────────────────────────────────────────────────────


def charger_senateurs(conn: psycopg.Connection) -> tuple[dict[frozenset, list[str]], dict[str, str], set[str]]:
    """Les sénateurs indexés par l'ensemble des mots de leur nom complet, leur
    département pour départager les homonymes, et ceux qui siègent encore.

    L'ensemble de mots plutôt qu'un couple (nom, prénom) parce que le PDF du
    Sénat écrit les deux dans un ordre qui change d'une ligne à l'autre, et avec
    deux conventions de casse : « GOULET Nathalie (Orne) » et « Mme Nathalie
    Goulet (Orne) » sont la même personne. Un ensemble ignore l'ordre, et la
    normalisation ignore la casse, les accents et les traits d'union, ce qui
    règle aussi « Marie-Do AESCHLIMANN » et les particules.

    L'index couvre **tous** les acteurs connus du site, pas seulement les
    sénateurs en exercice : le registre remonte à février 2024 et nomme donc des
    élus partis depuis, ministres compris. Les reconnaître permet de les écarter
    en connaissance de cause plutôt que de les compter comme des échecs de
    lecture, ce qui ferait chuter le taux sous son seuil d'alerte pour une raison
    qui n'a rien à voir. Filtrer sur `matricule_senat` ne suffirait pas : la
    colonne ne couvre que les sénateurs, anciens compris, et laisse de côté les
    ministres qui n'ont jamais siégé au Sénat.
    """
    par_mots: dict[frozenset, list[str]] = {}
    departements: dict[str, str] = {}
    en_exercice: set[str] = set()
    lignes = lire(
        conn,
        "select uid, nom, prenom, departement_election, est_senateur_actuel from acteurs order by uid",
    )
    for a in lignes:
        mots = _mots(f"{a.get('nom') or ''} {a.get('prenom') or ''}")
        if mots:
            par_mots.setdefault(mots, []).append(a["uid"])
        departements[a["uid"]] = _normalise(a.get("departement_election"))
        if a.get("est_senateur_actuel"):
            en_exercice.add(a["uid"])
    print(f"  → {len(en_exercice)} sénateurs en exercice, {len(departements)} acteurs connus")
    return par_mots, departements, en_exercice


def _mots(texte: str) -> frozenset:
    """Les mots d'un nom, normalisés un par un. Les fragments d'une seule lettre
    tombent : ce sont des initiales de prénom, que le PDF met et la base non."""
    return frozenset(
        m for m in (_normalise(mot) for mot in re.split(r"[\s'\-]+", texte)) if len(m) > 1
    )


def resoudre_uid(membre: str | None, par_mots: dict, departements: dict) -> str | None:
    """L'uid derrière « GOULET Nathalie (Orne) » ou « Mme Nathalie Goulet (Orne) ».

    Le département entre parenthèses ne sert qu'à départager des homonymes
    parfaits, cas qui n'existe pas aujourd'hui au Sénat. Il manque d'ailleurs sur
    certaines lignes, d'où le fait de ne pas en faire une partie de la clé.
    """
    if not membre:
        return None
    parenthese = re.search(r"\(([^)]*)\)", membre)
    departement = _normalise(parenthese.group(1)) if parenthese else ""
    sans_dept = re.sub(r"\([^)]*\)", " ", membre)
    sans_civilite = re.sub(r"^\s*(M\.|Mme|MM\.|Mmes)\s+", "", sans_dept)

    mots = _mots(sans_civilite)
    if len(mots) < 2:
        return None  # Un seul mot ne suffit jamais à désigner quelqu'un.

    # Inclusion et non égalité : le PDF abrège les prénoms composés (« Marc
    # DAUBRESSE » pour Marc-Philippe, « Christophe FRASSA » pour
    # Christophe-André). Exiger au moins deux mots communs évite qu'un patronyme
    # répandu attrape n'importe qui.
    candidats = [uid for cle, uids in par_mots.items() if mots <= cle for uid in uids]
    if len(candidats) == 1:
        return candidats[0]
    if departement:
        exacts = [uid for uid in candidats if departements.get(uid) == departement]
        if len(exacts) == 1:
            return exacts[0]
    return None


# ── Lecture des registres ─────────────────────────────────────────────────────


def lire_cadeaux(par_mots: dict, departements: dict, en_exercice: set) -> tuple[list[dict], int, int]:
    """Date | Type | Membre | Description | Pays (Ville) | Dates et durée | Organisme | Valeur."""
    contenu = telecharger_pdf(PDF_CADEAUX)
    if not contenu:
        return [], 0, 0

    millesime = date.today().isoformat()
    elements, non_rapprochees, sortis = [], 0, 0

    for ligne in lignes_du_pdf(contenu, "senat_cadeaux"):
        if len(ligne) != 8:
            continue
        date_reception = _date_fr(ligne[0])
        if not date_reception:
            continue  # En-tête, ou ligne de continuation sans date.

        categorie = TYPES.get(_normalise(ligne[1]).lower())
        if not categorie:
            continue

        uid = resoudre_uid(ligne[2], par_mots, departements)
        if not uid:
            non_rapprochees += 1
            tqdm.write(f"   ? {ligne[2]}")
            continue
        if uid not in en_exercice:
            sortis += 1
            continue

        detail = " · ".join(x for x in (ligne[4], ligne[5]) if x)
        element = {
            "source": "senat_cadeaux",
            "uid": uid,
            "categorie": categorie,
            "date_element": date_reception,
            "intitule": ligne[3] or ("Cadeau" if categorie == "cadeau" else "Déplacement"),
            "tiers": ligne[6],
            "valeur_texte": ligne[7],
            "detail": detail or None,
            "url_source": PDF_CADEAUX,
            "date_donnee": millesime,
        }
        element["identifiant"] = _identifiant(element)
        elements.append(element)

    return elements, non_rapprochees, sortis


def lire_deports(par_mots: dict, departements: dict, en_exercice: set) -> tuple[list[dict], int, int]:
    """Membre | Travaux concernés | Durée | Observations | Date de la déclaration."""
    contenu = telecharger_pdf(PDF_DEPORTS)
    if not contenu:
        return [], 0, 0

    millesime = date.today().isoformat()
    elements, non_rapprochees, sortis = [], 0, 0

    for ligne in lignes_du_pdf(contenu, "senat_deports"):
        if len(ligne) != 5:
            continue
        membre = ligne[0]
        # Les deux lignes d'en-tête du PDF n'ont pas de civilité en tête.
        if not membre or not re.match(r"^(M\.|Mme)\s", membre):
            continue
        if not ligne[1]:
            continue

        uid = resoudre_uid(membre, par_mots, departements)
        if not uid:
            non_rapprochees += 1
            tqdm.write(f"   ? {membre}")
            continue
        if uid not in en_exercice:
            sortis += 1
            continue

        # `valeur_texte` porte déjà la durée : le détail ne garde que les
        # observations, qui disent le motif du retrait.
        element = {
            "source": "senat_deports",
            "uid": uid,
            "categorie": "deport",
            "date_element": _date_fr(ligne[4]),
            "intitule": ligne[1],
            "tiers": None,
            "valeur_texte": ligne[2],
            "detail": ligne[3],
            "url_source": PDF_DEPORTS,
            "date_donnee": millesime,
        }
        element["identifiant"] = _identifiant(element)
        elements.append(element)

    return elements, non_rapprochees, sortis


def _identifiant(element: dict) -> str:
    """Une empreinte du contenu, le Sénat ne publiant aucun identifiant.

    `date_donnee` en est exclue, sinon chaque passage quotidien produirait des
    clés neuves et effacerait les précédentes. Conséquence assumée : une ligne
    corrigée dans le PDF apparaît comme une ligne neuve, l'ancienne partant à la
    réconciliation. C'est le comportement voulu.
    """
    empreinte = compute_row_hash(element, exclude=("date_donnee", "identifiant"))
    return f"{element['uid']}|{empreinte[:16]}"


# ── Écriture ──────────────────────────────────────────────────────────────────


def identifiants_existants(conn: psycopg.Connection, source: str) -> set[str]:
    lignes = lire(
        conn, "select identifiant from transparence_elements where source = %s order by identifiant", (source,)
    )
    return {l["identifiant"] for l in lignes}


def ecrire(conn: psycopg.Connection, source: str, elements: list[dict]) -> None:
    # Deux lignes rigoureusement identiques dans le PDF (même sénateur, même date,
    # même cadeau, même valeur) produisent la même empreinte, donc la même clé. Un
    # batch qui porte deux fois la même clé fait échouer l'upsert entier, pas
    # seulement le doublon : Postgres refuse d'affecter deux fois la même ligne. Le
    # premier exemplaire garde sa clé nue, pour que les lignes déjà en base gardent
    # leur identité.
    occurrences: dict[str, int] = {}
    for element in elements:
        cle = element["identifiant"]
        rang = occurrences.get(cle, 0)
        occurrences[cle] = rang + 1
        if rang:
            element["identifiant"] = f"{cle}#{rang}"

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
        return

    if obsoletes:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM transparence_elements WHERE source = %s AND identifiant = ANY(%s)",
                    (source, sorted(obsoletes)),
                )
        except psycopg.Error as e:
            tqdm.write(f"❌ Suppression {source} ({len(obsoletes)} lignes): {type(e).__name__}: {e}")


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
    print("   Import transparence — registres du Sénat")
    print("=" * 60)

    print("\nRésolution des sénateurs...")
    par_mots, departements, en_exercice = charger_senateurs(conn)

    print("\nCadeaux et déplacements...")
    cadeaux, manques_cadeaux, sortis_cadeaux = lire_cadeaux(par_mots, departements, en_exercice)
    print("\nDéports...")
    deports, manques_deports, sortis_deports = lire_deports(par_mots, departements, en_exercice)

    manques = manques_cadeaux + manques_deports
    sortis = sortis_cadeaux + sortis_deports
    gardes = len(cadeaux) + len(deports)
    lus = gardes + sortis + manques
    if not lus:
        print("❌ Les deux PDF n'ont rien rendu d'exploitable.")
        sys.exit(1)

    # Le taux mesure la lecture du PDF, pas le périmètre du site : une ligne qui
    # nomme un sénateur parti est une ligne correctement lue, même si elle
    # n'atteint aucune fiche.
    taux = (gardes + sortis) / lus
    print(f"\n{gardes + sortis}/{lus} lignes rattachées à un sénateur ({taux:.0%})")
    print(f"   {gardes} en exercice · {sortis} partis du Sénat · {manques} non rattachées")
    if taux < SEUIL_RAPPROCHEMENT:
        signaler_anomalie(
            "senat_cadeaux",
            f"Rattachement à {taux:.0%} seulement ({gardes + sortis}/{lus}) : la façon dont "
            "le PDF nomme les sénateurs a changé. Rien n'a été écrit.",
        )
        print("❌ Sous le seuil de rattachement — écriture annulée.")
        sys.exit(1)

    ecrire(conn, "senat_cadeaux", cadeaux)
    ecrire(conn, "senat_deports", deports)

    print(f"\n{'='*60}")
    print(f"   Cadeaux et déplacements : {len(cadeaux)}")
    print(f"   Déports                 : {len(deports)}")
    print(f"   Sénateurs partis        : {sortis}")
    print(f"   Non rattachées          : {manques}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
