"""
import_hatvp.py
Importe les déclarations d'intérêts des parlementaires depuis l'open data de la
Haute Autorité pour la transparence de la vie publique (Licence Ouverte 2.0).

Pourquoi cette source : ni l'Assemblée ni le Sénat ne publient les intérêts de
leurs membres. La HATVP les reçoit, les contrôle et les publie, avec les champs
qu'elle juge non publiables déjà occultés.

Pourquoi l'index plutôt que le fichier fusionné : la HATVP publie un
`merge/declarations.xml` de 87 Mo qui contient tout, mais son serveur débite
environ 100 Ko par seconde et un téléchargement s'est déjà terminé tronqué à
65 Mo avec un code de succès, ce qui avait fait disparaître un quart des
déclarations sans rien signaler. L'index `liste.csv` pèse 3,4 Mo et donne, pour
chaque déclaration, le nom de son XML individuel de 12 Ko. On ne télécharge donc
que les déclarations qui ont bougé depuis la veille.

Rapprochement : par clé des deux côtés, jamais par nom. `url_dossier` contre
`acteurs.uri_hatvp` pour les députés (575 sur 577), `id_origine`, qui est le
matricule du Sénat, contre `acteurs.matricule_senat` pour les sénateurs (348 sur
348). Mesuré le 2026-09-11 : 923 parlementaires sur 925.

⚠️ Les déclarations de situation patrimoniale (dsp, dspm, dspfm) ne sont jamais
importées. Publier le patrimoine d'un parlementaire est pénalement sanctionné, et
seules les déclarations d'intérêts (dia, diam) relèvent de ce script. Le filtre
est doublé d'une assertion avant écriture.

⚠️ L'activité professionnelle du conjoint n'est pas lue non plus : la personne
visée n'a aucun mandat (D-188). Voir `RUBRIQUES`, qui dit pourquoi l'occultation
de la source ne suffit pas à s'en remettre à elle.

Alimente : hatvp_declarations, transparence_elements (source `hatvp`)

Usage : python import_hatvp.py
        HATVP_FORCE=1 python import_hatvp.py   (retélécharge tous les XML)
"""

import csv
import io
import os
import sys
import time
import unicodedata
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

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

LISTE_CSV = "https://www.hatvp.fr/livraison/opendata/liste.csv"
DOSSIERS = "https://www.hatvp.fr/livraison/dossiers/"

# Le serveur de la HATVP est lent et sans CDN : une pause courte entre deux
# fichiers, comme pour le Conseil constitutionnel.
PAUSE = 0.3
UA = "LoiClair/1.0 (+https://loiclair.fr)"

# Seuls les types d'intérêts. `dia` est la déclaration d'intérêts et d'activités
# du parlementaire, `diam` sa version modificative.
TYPES_INTERETS = {"dia", "diam"}

# Le seul statut dont la déclaration est consultable. Les autres (« Déclaration
# déposée - publication à venir », « En cours ») sont des états d'attente : la
# ligne est conservée, parce qu'une attente est une information à afficher, mais
# aucun XML n'existe encore.
STATUT_PUBLIEE = "Livrée"

# Les parlementaires seulement. La HATVP couvre 18 000 responsables publics.
MANDATS = {"depute", "senateur"}

# Planchers de rapprochement. En dessous, la jointure est cassée et non la
# source : on alerte au lieu d'écrire un périmètre amputé.
PLANCHER_DEPUTES = 560
PLANCHER_SENATEURS = 340

# Chaque rubrique d'une déclaration, et la catégorie d'affichage qu'elle alimente.
# Les clés sont des identifiants stables, jamais des libellés traduits.
#
# Trois rubriques du fichier de la HATVP sont volontairement absentes. `activCollaborateursDto`
# (les activités des collaborateurs parlementaires, qui sont des personnes
# privées) et `mandatElectifDto` (déjà affiché par la section « Ses mandats »,
# depuis le Répertoire national des élus, avec une autre date de fraîcheur : le
# même mandat deux fois à deux dates serait un défaut d'affichage).
#
# `activProfConjointDto` ensuite, écartée par choix (D-188), la personne visée
# n'ayant aucun mandat. La loi ne l'impose pas : le Conseil constitutionnel a
# admis cette rubrique (décision n° 2013-675 DC du 9 octobre 2013, considérant
# 29) et ne retire de la publication que les noms et adresses (considérant 32).
# La HATVP l'occulte pourtant avant publication. Son occultation est
# imparfaite : elle encadre la valeur de deux mentions `[Données non publiées]`
# au lieu de la remplacer, si bien que `_texte()`, qui retire ces mentions pour
# lire les champs partiellement occultés des autres rubriques, en ressortait
# l'activité en clair. La rubrique ne se lit donc plus du tout : un filtre sur
# la valeur se serait rouvert au premier changement du format de la source.
RUBRIQUES = {
    "activProfCinqDerniereDto": "interet_activite",
    "activConsultantDto": "interet_conseil",
    "participationFinanciereDto": "interet_participation",
    "participationDirigeantDto": "interet_direction",
    "fonctionBenevoleDto": "interet_benevolat",
    "observationInteretDto": "interet_observation",
}

# La HATVP remplace par cette mention les champs qu'elle ne publie pas.
NON_PUBLIE = "[Données non publiées]"

# Chaque déclarant remplit son formulaire à sa main : plutôt que de cocher la
# case « néant » d'une rubrique, certains créent un item et y écrivent « NEANT ».
# Relevé sur un échantillon de 60 déclarations : 10 items sur 604, soit environ
# 130 lignes qui afficheraient « NEANT » comme s'il s'agissait d'un intérêt.
# Un champ qui ne vaut que l'une de ces mentions est traité comme vide.
MENTIONS_NEANT = {
    "neant", "rien", "aucun", "aucune", "ras", "sans objet", "sans",
    "non concerne", "non", "na", "nc", "-", "/",
}


# ── Utilitaires ───────────────────────────────────────────────────────────────


def _upsert_batch(conn: psycopg.Connection, table: str, rows: list, conflict: str) -> bool:
    """Upsert une liste de dicts par batch, avec split automatique sur timeout.

    Rend False dès qu'un batch n'a pas pu être écrit. L'échec n'est que signalé en
    console, donc un appelant qui marque ensuite le travail comme fait a besoin de
    cette réponse pour ne pas le faire à tort.
    """
    ok = True
    for i in range(0, len(rows), BATCH_SIZE):
        ok = _upsert_single(conn, table, rows[i : i + BATCH_SIZE], conflict) and ok
    return ok


def _upsert_single(conn: psycopg.Connection, table: str, batch: list, conflict: str) -> bool:
    try:
        ecrire_lot(conn, table, batch, conflict)
        return True
    except Exception as e:
        msg = str(e).lower()
        if ("timeout" in msg or "57014" in msg or "504" in msg) and len(batch) > 50:
            mid = len(batch) // 2
            tqdm.write(f"⏱️  Timeout {table} ({len(batch)} rows) — split en 2x{mid}")
            gauche = _upsert_single(conn, table, batch[:mid], conflict)
            droite = _upsert_single(conn, table, batch[mid:], conflict)
            return gauche and droite
        tqdm.write(f"❌ Erreur upsert {table} ({len(batch)} rows): {type(e).__name__}: {e}")
        return False


def _texte(element, balise: str) -> str | None:
    """Le contenu d'une balise fille, ou None si elle est absente, vide, occultée
    ou remplie d'une mention de néant.

    La HATVP écrit la mention d'occultation dans le champ lui-même, parfois mêlée
    à du texte lisible : un champ qui n'est qu'une occultation ne dit rien et vaut
    une absence. Même raisonnement pour « NEANT » écrit à la main.
    """
    if element is None:
        return None
    fils = element.find(balise)
    if fils is None or not fils.text:
        return None
    valeur = " ".join(fils.text.split())
    if not valeur or valeur == NON_PUBLIE:
        return None
    valeur = valeur.replace(NON_PUBLIE, "").strip()
    normalisee = _normalise(valeur)
    # `normalisee` vide attrape les champs qui ne portent que de la ponctuation
    # (« - », « / »), que le déclarant emploie aussi pour dire « rien ».
    if not valeur or not normalisee or normalisee in MENTIONS_NEANT:
        return None
    return valeur


def _normalise(s: str) -> str:
    """Minuscules, sans accents ni ponctuation, pour comparer aux mentions de
    néant : « Néant », « NEANT. » et « neant » sont le même mot."""
    n = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return " ".join("".join(c if c.isalnum() else " " for c in n.lower()).split())


def _periode(item) -> str | None:
    """« 01/2015 → 07/2021 », ou « depuis 01/2020 » quand la fin est ouverte."""
    debut, fin = _texte(item, "dateDebut"), _texte(item, "dateFin")
    if debut and fin:
        return f"{debut} → {fin}"
    if debut:
        return f"depuis {debut}"
    return fin


def _remuneration(item) -> str | None:
    """La rémunération de l'année la plus récente où elle n'est pas nulle.

    La HATVP publie un montant par année. On en lit un, le dernier non nul : les
    additionner serait une agrégation, et la table interdit d'agréger (voir
    l'en-tête de la migration). Un déclarant qui a tout mis à zéro ne produit
    donc rien, ce qui est le sens de sa déclaration.
    """
    bloc = item.find("remuneration")
    if bloc is None:
        return None
    montants = []
    for m in bloc.iter("montant"):
        annee, valeur = _texte(m, "annee"), _texte(m, "montant")
        if not annee or not valeur:
            continue
        chiffres = valeur.replace(" ", "").replace(" ", "").replace(",", ".")
        try:
            if float(chiffres) <= 0:
                continue
        except ValueError:
            pass  # Un montant écrit en toutes lettres se lit quand même.
        montants.append((annee, valeur))
    if not montants:
        return None
    annee, valeur = max(montants)
    return f"{valeur} € en {annee}"


# ── Source ────────────────────────────────────────────────────────────────────


def telecharger_index() -> list[dict]:
    """L'index des déclarations publiées, filtré sur les parlementaires et sur
    les déclarations d'intérêts."""
    print(f"📥 {LISTE_CSV}")
    texte = recuperer(LISTE_CSV, timeout=300, entetes={"User-Agent": UA}).decode("utf-8-sig")
    lignes = list(csv.DictReader(io.StringIO(texte), delimiter=";"))
    print(f"   {len(lignes)} déclarations dans l'index")

    retenues = [
        l for l in lignes
        if (l.get("type_mandat") or "").strip() in MANDATS
        and (l.get("type_document") or "").strip() in TYPES_INTERETS
    ]
    print(f"   → {len(retenues)} déclarations d'intérêts de parlementaires")
    return retenues


def telecharger_declaration(nom_xml: str) -> bytes | None:
    """Le XML d'une déclaration, environ 12 Ko. Rend None sur échec : une
    déclaration manquante est un trou dans une fiche, pas une raison d'arrêter
    les 900 autres."""
    try:
        # Sans reprise : une déclaration en échec reste non lue et se relit la nuit
        # suivante, alors que 35 secondes de reprises sur chacune des 777 du premier
        # passage feraient dépasser la borne de l'étape si la source tombe.
        return recuperer(
            DOSSIERS + nom_xml, timeout=60, entetes={"User-Agent": UA}, attentes=()
        )
    except Exception as e:
        tqdm.write(f"⚠️  {nom_xml} : {type(e).__name__}: {e}")
        return None


# ── Rapprochement ─────────────────────────────────────────────────────────────


def charger_parlementaires(conn: psycopg.Connection) -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """Deux index de rapprochement, plus la chambre de chacun : par page
    nominative HATVP pour les députés, par matricule du Sénat pour les sénateurs.

    Aucun rapprochement par nom ici, contrairement à `import_rne.py` : les deux
    côtés publient une clé, et une clé ne se trompe pas de personne. C'est la
    règle déjà posée pour `mandats_senat`.
    """
    par_dossier: dict[str, str] = {}
    par_matricule: dict[str, str] = {}
    chambres: dict[str, str] = {}
    lignes = lire(
        conn,
        """
        select uid, uri_hatvp, matricule_senat, est_depute_actuel, est_senateur_actuel
        from acteurs
        where est_depute_actuel = true or est_senateur_actuel = true
        order by uid
        """,
    )
    for a in lignes:
        chemin = _chemin_dossier(a.get("uri_hatvp"))
        if chemin:
            par_dossier[chemin] = a["uid"]
        matricule = (a.get("matricule_senat") or "").strip()
        if matricule:
            par_matricule[matricule] = a["uid"]
        chambres[a["uid"]] = "AN" if a.get("est_depute_actuel") else "SN"
    print(f"  → {len(par_dossier)} pages nominatives, {len(par_matricule)} matricules Sénat")
    return par_dossier, par_matricule, chambres


def _chemin_dossier(url: str | None) -> str | None:
    """Le chemin de la page nominative, sans le domaine ni le slash final.

    `acteurs.uri_hatvp` porte l'URL complète, l'index de la HATVP le chemin seul.
    Les deux portent le même identifiant final (`abadie-amiel-audrey-29921`), d'où
    le rapprochement sur ce fragment.
    """
    if not url:
        return None
    marqueur = "/pages_nominatives/"
    i = url.find(marqueur)
    return url[i:].rstrip("/") if i >= 0 else None


def resoudre_uid(ligne: dict, par_dossier: dict, par_matricule: dict) -> str | None:
    """L'uid du parlementaire derrière une ligne de l'index, ou None."""
    chemin = _chemin_dossier((ligne.get("url_dossier") or "").strip())
    if chemin and chemin in par_dossier:
        return par_dossier[chemin]
    matricule = (ligne.get("id_origine") or "").strip()
    return par_matricule.get(matricule)


def declaration_retenue(lignes: list[dict], par_dossier: dict, par_matricule: dict) -> dict[str, dict]:
    """Une déclaration par parlementaire : la plus récemment déposée.

    Une modificative ne reprend pas toujours l'intégralité de la précédente, donc
    empiler les déclarations afficherait comme actuelle une activité que son
    auteur a corrigée. N'en montrer qu'une peut en revanche taire un élément
    qu'une modificative partielle n'a pas répété : c'est un sous-affichage, pas
    un faux, et c'est l'arbitrage que le projet a déjà retenu pour les mandats
    locaux. La fiche renvoie vers le dossier HATVP, qui les liste toutes.
    """
    par_uid: dict[str, dict] = {}
    non_rapprochees = 0
    for ligne in lignes:
        uid = resoudre_uid(ligne, par_dossier, par_matricule)
        if not uid:
            non_rapprochees += 1
            continue
        precedente = par_uid.get(uid)
        if not precedente or _anciennete(ligne) > _anciennete(precedente):
            par_uid[uid] = ligne
    if non_rapprochees:
        print(f"  ⚠️  {non_rapprochees} déclarations sans parlementaire en exercice (anciens élus)")
    return par_uid


def _anciennete(ligne: dict) -> tuple[str, str]:
    """Le rang chronologique d'une déclaration : date de dépôt, puis de publication.

    La HATVP écrit ses dates en ISO, elles se comparent donc comme du texte. La date
    de publication départage : plusieurs déclarations d'un même élu portent souvent
    la même date de dépôt (une initiale et sa modificative déposées le même jour, ou
    une date de dépôt vide sur les deux), et le départage par l'ordre d'arrivée dans
    le CSV retenait alors la première lue, pas la plus récente.
    """
    return (
        (ligne.get("date_depot") or "").strip(),
        (ligne.get("date_publication") or "").strip(),
    )


# ── Parsing d'une déclaration ─────────────────────────────────────────────────


def elements_declaration(xml: bytes, uid: str, url_dossier: str, millesime: str) -> list[dict]:
    """Les lignes de `transparence_elements` d'une déclaration.

    Un item dont l'intitulé est absent ou entièrement occulté est écarté : une
    ligne vide dans une section de transparence dit le contraire de ce qu'elle
    montre.
    """
    try:
        racine = ET.fromstring(xml)
    except ET.ParseError as e:
        signaler_anomalie("hatvp", f"XML illisible pour {uid} : {e}")
        return []

    elements = []
    for rubrique, categorie in RUBRIQUES.items():
        bloc = racine.find(rubrique)
        if bloc is None:
            continue
        for item in bloc.findall("./items/items"):
            element = _element(item, categorie)
            if not element:
                continue
            element.update({
                "source": "hatvp",
                "uid": uid,
                "categorie": categorie,
                "url_source": url_dossier,
                "date_donnee": millesime,
            })
            # Deux items d'une même rubrique peuvent être identiques (même société,
            # deux années) : le rang dans la déclaration les sépare.
            element["identifiant"] = f"{uid}|{categorie}|{len(elements)}"
            elements.append(element)
    return elements


def _element(item, categorie: str) -> dict | None:
    """Projette un item d'une rubrique sur les colonnes de la ligne affichée.
    Chaque rubrique nomme ses champs autrement, d'où le branchement."""
    if categorie == "interet_activite":
        intitule = _texte(item, "description")
        return intitule and {
            "intitule": intitule,
            "tiers": _texte(item, "employeur"),
            "valeur_texte": _remuneration(item),
            "detail": _periode(item),
        }
    if categorie == "interet_conseil":
        intitule = _texte(item, "description")
        return intitule and {
            "intitule": intitule,
            "tiers": _texte(item, "nomEmployeur") or _texte(item, "nomOrganisationConseil"),
            "valeur_texte": _remuneration(item),
            "detail": _periode(item),
        }
    if categorie == "interet_participation":
        intitule = _texte(item, "nomSociete")
        parts = _texte(item, "nombreParts")
        return intitule and {
            "intitule": intitule,
            "tiers": None,
            "valeur_texte": f"{parts} parts" if parts else _texte(item, "evaluation"),
            "detail": None,
        }
    if categorie == "interet_direction":
        intitule = _texte(item, "activite")
        return intitule and {
            "intitule": intitule,
            "tiers": _texte(item, "nomSociete"),
            "valeur_texte": _remuneration(item),
            "detail": _periode(item),
        }
    if categorie == "interet_benevolat":
        intitule = _texte(item, "descriptionActivite")
        return intitule and {
            "intitule": intitule,
            "tiers": _texte(item, "nomStructure"),
            "valeur_texte": None,
            "detail": None,
        }
    if categorie == "interet_observation":
        intitule = _texte(item, "contenu")
        return intitule and {
            "intitule": intitule,
            "tiers": None,
            "valeur_texte": None,
            "detail": None,
        }
    return None


# ── Écriture ──────────────────────────────────────────────────────────────────


def etat_actuel(conn: psycopg.Connection) -> dict[str, tuple[str | None, str | None, str | None]]:
    """Pour chaque parlementaire déjà en table : le XML de sa déclaration, sa
    date de publication, et le jour où son contenu a été lu.

    Les deux premiers disent si la déclaration a changé, le troisième si elle a
    jamais été lue. Sans lui, un import interrompu au milieu des téléchargements
    laisse un trou définitif : la ligne n'a pas bougé, donc aucun passage suivant
    ne la relit, et la fiche reste vide sans que rien ne le signale.
    """
    lignes = lire(
        conn, "select uid, open_data, date_publication, date_lecture from hatvp_declarations order by uid"
    )
    return {
        l["uid"]: (l.get("open_data"), l.get("date_publication"), l.get("date_lecture"))
        for l in lignes
    }


def supprimer_obsoletes(conn: psycopg.Connection, table: str, colonne: str, valeurs: set) -> None:
    """Supprime les seules lignes sorties du périmètre, en une requête. Elles se
    comptent en dizaines par passage, et une purge complète laisserait la table vide
    le temps de la réinsertion, sous les yeux des pages qui se régénèrent.
    `table` et `colonne` sont écrits en dur par l'appelant."""
    try:
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {table} WHERE {colonne} = ANY(%s)", (sorted(valeurs),))
    except psycopg.Error as e:
        tqdm.write(f"❌ Suppression {table} ({len(valeurs)} lignes): {type(e).__name__}: {e}")


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
    print("   Import HATVP — déclarations d'intérêts des parlementaires")
    print("=" * 60)

    lignes = telecharger_index()
    if not lignes:
        print("❌ Index vide — la source n'a rien rendu d'exploitable.")
        sys.exit(1)

    # Ceinture et bretelles : le filtre d'entrée ne retient que les types
    # d'intérêts, cette assertion garantit qu'aucune déclaration de patrimoine
    # n'atteint l'écriture même si le filtre venait à être modifié.
    patrimoine = [l for l in lignes if (l.get("type_document") or "").startswith("dsp")]
    assert not patrimoine, (
        f"{len(patrimoine)} déclarations de patrimoine dans le périmètre — "
        "leur publication est pénalement sanctionnée, l'import s'arrête."
    )

    print("\nRésolution des parlementaires...")
    par_dossier, par_matricule, chambres = charger_parlementaires(conn)
    par_uid = declaration_retenue(lignes, par_dossier, par_matricule)

    deputes = sum(1 for uid in par_uid if chambres.get(uid) == "AN")
    senateurs = sum(1 for uid in par_uid if chambres.get(uid) == "SN")
    print(f"\n{len(par_uid)} parlementaires avec une déclaration")
    print(f"   députés : {deputes} · sénateurs : {senateurs}")

    if deputes < PLANCHER_DEPUTES or senateurs < PLANCHER_SENATEURS:
        signaler_anomalie(
            "hatvp",
            f"Rapprochement anormalement bas : {deputes} députés, {senateurs} sénateurs "
            f"(planchers {PLANCHER_DEPUTES}/{PLANCHER_SENATEURS}). Rien n'a été écrit.",
        )
        print("❌ Rapprochement sous les planchers — écriture annulée.")
        sys.exit(1)

    millesime = max((l.get("date_publication") or "") for l in par_uid.values())[:10]

    # ── Les déclarations ──
    declarations = [
        {
            "uid": uid,
            "type_document": (l.get("type_document") or "").strip(),
            "statut_publication": (l.get("statut_publication") or "").strip(),
            "date_depot": (l.get("date_depot") or "").strip()[:10] or None,
            "date_publication": (l.get("date_publication") or "").strip()[:10] or None,
            "url_dossier": _url_absolue(l.get("url_dossier")),
            "nom_fichier": (l.get("nom_fichier") or "").strip() or None,
            "open_data": (l.get("open_data") or "").strip() or None,
            "date_donnee": millesime,
        }
        for uid, l in par_uid.items()
    ]

    avant = etat_actuel(conn)
    print(f"\nÉcriture de {len(declarations)} déclarations...")
    _upsert_batch(conn, "hatvp_declarations", declarations, "uid")

    obsoletes = set(avant) - set(par_uid)
    if obsoletes:
        print(f"{len(obsoletes)} parlementaires sortis du périmètre")
        supprimer_obsoletes(conn, "hatvp_declarations", "uid", obsoletes)
        # Les intérêts déclarés vivent dans une seconde table, et rien ne les y relie
        # par clé étrangère : sans cette passe, un élu qui quitte le périmètre perd
        # sa déclaration mais garde ses lignes d'intérêts, orphelines et indétectables.
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM transparence_elements WHERE source = 'hatvp' AND uid = ANY(%s)",
                    (sorted(obsoletes),),
                )
        except psycopg.Error as e:
            print(f"❌ Suppression transparence_elements ({len(obsoletes)} parlementaires): {type(e).__name__}: {e}")

    # ── Le contenu des déclarations ──
    force = os.getenv("HATVP_FORCE") == "1"

    def a_relire(d: dict) -> bool:
        if d["statut_publication"] != STATUT_PUBLIEE or not d["open_data"]:
            return False
        if force:
            return True
        precedent = avant.get(d["uid"])
        if not precedent:
            return True
        xml, publication, lecture = precedent
        # Jamais lue, ou déclaration remplacée depuis la dernière lecture.
        return not lecture or (xml, publication) != (d["open_data"], d["date_publication"])

    a_lire = [d for d in declarations if a_relire(d)]
    print(f"\n{len(a_lire)} déclarations à lire ({len(declarations) - len(a_lire)} inchangées)")

    # Écriture par paquets et non en une fois à la fin : au premier passage il y
    # a 777 fichiers à lire, et tout garder en mémoire jusqu'au bout ferait
    # perdre l'intégralité du travail sur la moindre coupure.
    aujourdhui = date.today().isoformat()
    ecrits, relus, echecs = 0, 0, 0
    lot: list[dict] = []
    lot_uids: set[str] = set()

    def vider_lot() -> int:
        """Remplace les éléments des élus du lot, puis écrit les nouveaux.

        La suppression porte sur tous les élus relus et pas seulement sur ceux
        qui produisent des éléments : une déclaration modificative qui vide une
        rubrique doit vider la fiche, pas y laisser l'ancienne version. Elle est
        nécessaire parce que l'identifiant d'un élément porte son rang dans la
        rubrique, qui bouge d'une version à l'autre.
        """
        if not lot_uids:
            return 0
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM transparence_elements WHERE source = 'hatvp' AND uid = ANY(%s)",
                (sorted(lot_uids),),
            )
        ecrit = _upsert_batch(conn, "transparence_elements", lot, "source,identifiant") if lot else True
        # La date de lecture s'écrit après l'écriture des éléments, jamais avant, et
        # seulement si celle-ci a réussi : c'est elle qui dit qu'ils sont en base.
        # Une interruption entre les deux, comme un upsert en échec (qui ne fait que
        # s'afficher en console), doit faire relire au passage suivant, pas sauter.
        # Un `UPDATE` et non un upsert : la charge utile n'a pas les colonnes
        # `not null` de la table, et l'insert que tenterait un upsert échouerait.
        if ecrit:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE hatvp_declarations SET date_lecture = %s WHERE uid = ANY(%s)",
                    (aujourdhui, sorted(lot_uids)),
                )
        else:
            signaler_anomalie(
                "hatvp",
                f"Écriture des éléments en échec pour {len(lot_uids)} parlementaires : "
                "leurs déclarations seront relues au prochain passage.",
            )
        n = len(lot) if ecrit else 0
        lot.clear()
        lot_uids.clear()
        return n

    for d in tqdm(a_lire, desc="Déclarations", unit="xml"):
        xml = telecharger_declaration(d["open_data"])
        time.sleep(PAUSE)
        if not xml:
            echecs += 1
            continue
        relus += 1
        lot_uids.add(d["uid"])
        lot.extend(elements_declaration(xml, d["uid"], d["url_dossier"], millesime))
        if len(lot_uids) >= 100:
            ecrits += vider_lot()
    ecrits += vider_lot()

    if echecs:
        signaler_anomalie("hatvp", f"{echecs} déclarations n'ont pas pu être téléchargées.")

    print(f"\n{'='*60}")
    print(f"   Millésime HATVP    : {millesime}")
    print(f"   Déclarations       : {len(declarations)} ({deputes} députés, {senateurs} sénateurs)")
    print(f"   XML lus            : {relus}" + (f" · {echecs} échecs" if echecs else ""))
    print(f"   Éléments écrits    : {ecrits}")
    print(f"{'='*60}")


def _url_absolue(chemin: str | None) -> str | None:
    """L'index publie un chemin ; la fiche affiche un lien."""
    chemin = (chemin or "").strip()
    if not chemin:
        return None
    return chemin if chemin.startswith("http") else f"https://www.hatvp.fr{chemin}"


if __name__ == "__main__":
    main()
