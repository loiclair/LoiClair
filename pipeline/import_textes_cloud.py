# import_textes_cloud.py
# Script pour importer tous les JSON textes d'un dossier dans la table 'textes' depuis url AN
# Exécute avec : python import_textes.py

# Notes:
## Texte du senat avant 1990 environ ont une architecture de lien completement differente
## A FAIRE - ALCNANR -> non publie dans les texte mais present dans compte rendu de seance


import json
import os
import re
import sys
import requests
import io
import zipfile
import traceback
import time
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from datetime import datetime
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import signaler_anomalie
from _db import connexion, lire
from _sync_cache import (
    NotModified,
    confirmer_import,
    creer_organes_manquants,
    download_zip_if_modified,
    upsert_si_change,
)


# ===================================================================
# Téléchargement du ZIP (comme pour les dossiers)
# ===================================================================
# Les cinq qualités que l'open data de l'Assemblée pose sur le bloc `auteurs` d'un
# document. Quatre désignent une charge de rapporteur : rapporter un texte, rapporter
# pour avis au nom d'une commission saisie pour avis, rapporter une mission budgétaire
# comme rapporteur spécial, ou porter le rapport général du budget. Seule la première
# était lue, ce qui perdait 289 charges sur la 17ᵉ législature, la plupart portées par
# les tomes d'un rapport budgétaire.
#
# `cosignataire` reste volontairement hors du compte : cette qualité n'apparaît que sur
# les motions (2 157 refs, 334 députés), et cosigner une motion de censure est un acte
# politique, pas un travail de texte. Le Sénat n'en a d'ailleurs pas, le Gouvernement
# n'étant pas responsable devant lui.
QUALITES_RAPPORTEUR = {"rapporteur", "rapporteur pour avis", "rapporteur spécial", "rapporteur général"}


def extraire_auteurs(bloc_auteurs) -> tuple[list, list, str | None]:
    """Extrait (auteurs, rapporteurs, organe) du bloc `auteurs` d'un document ou d'un tome.

    Appelée deux fois : sur le document racine et sur chacune de ses divisions. Les deux
    boucles étaient écrites en double, et c'est ce qui a fait passer les rapporteurs des
    tomes à la trappe : un rapport budgétaire porte jusqu'à 120 tomes ayant chacun son
    rapporteur spécial ou son rapporteur pour avis, jamais repris à la racine.

    Les listes sont dédoublonnées en conservant l'ordre : 33 documents nomment deux fois
    le même auteur, 8 le même rapporteur.
    """
    liste = []
    if isinstance(bloc_auteurs, dict):
        entrees = bloc_auteurs.get("auteur")
        if isinstance(entrees, list):
            liste = entrees
        elif isinstance(entrees, dict):
            liste = [entrees]
    elif isinstance(bloc_auteurs, list):
        liste = bloc_auteurs

    auteurs_refs, rapporteurs_refs = [], []
    organe_auteur_ref = None
    for entree in liste:
        if not isinstance(entree, dict):
            continue
        acteur = entree.get("acteur")
        if not isinstance(acteur, dict):
            # Entrée organe-only : la commission qui a produit le document.
            organe = entree.get("organe")
            if isinstance(organe, dict):
                organe_auteur_ref = organe.get("organeRef") or organe_auteur_ref
            continue
        qualite = (acteur.get("qualite") or "").strip()
        acteur_ref = acteur.get("acteurRef")
        if not qualite or not acteur_ref:
            continue
        if qualite == "auteur":
            if acteur_ref not in auteurs_refs:
                auteurs_refs.append(acteur_ref)
        elif qualite in QUALITES_RAPPORTEUR:
            if acteur_ref not in rapporteurs_refs:
                rapporteurs_refs.append(acteur_ref)

    return auteurs_refs, rapporteurs_refs, organe_auteur_ref


def extraire_cosignataires(texte: dict) -> list:
    """Extrait les acteurRef du bloc `coSignataires` d'un document, retraits exclus.

    L'Assemblée range le premier signataire dans `auteurs` et **tous les autres** dans un
    bloc `coSignataires` distinct, que ce script ne lisait pas : 75 574 cosignatures de la
    17ᵉ législature manquaient, pour 366 comptées. Le champ est présent dans 2 883 des
    2 884 propositions du ZIP, avec en moyenne 20 cosignataires par texte.

    Une cosignature retirée porte une `dateRetraitCosignature` non vide : le député a
    officiellement retiré son soutien, la compter serait faux (694 cas sur la législature).

    Le Sénat n'utilise presque pas ce bloc : ses signataires arrivent dans `auteurs_refs`.
    """
    bloc = texte.get("coSignataires")
    if not isinstance(bloc, dict):
        return []
    entrees = bloc.get("coSignataire")
    if isinstance(entrees, dict):
        entrees = [entrees]
    if not isinstance(entrees, list):
        return []

    refs = []
    for entree in entrees:
        if not isinstance(entree, dict):
            continue
        # Un retrait est un dict daté ; un non-retrait est un dict vide, jamais absent.
        if entree.get("dateRetraitCosignature"):
            continue
        acteur = entree.get("acteur")
        if not isinstance(acteur, dict):
            continue
        ref = acteur.get("acteurRef")
        if ref and ref not in refs:
            refs.append(ref)
    return refs


def download_zip(url: str) -> zipfile.ZipFile:
    """Télécharge le ZIP en mémoire depuis l'URL."""
    print(f"Téléchargement du ZIP depuis : {url}")
    response = requests.get(url, timeout=120)
    response.raise_for_status()  # erreur si lien mort
    return zipfile.ZipFile(io.BytesIO(response.content))


# Charger env vars de .env.local (chemin relatif au script, portable sur toutes les machines) :
# les variables PG* de `connexion()` et de `_sync_cache` y vivent en local.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ===================================================================
# Base de données
# ===================================================================
# Une connexion par script, ouverte au premier usage et rouverte si elle tombe : la
# vérification des URL dure des minutes entre deux écritures. Autocommit : chaque
# écriture est validée seule, et une qui échoue n'en annule pas une autre.
_conn = None


def _pg():
    global _conn
    if _conn is None or _conn.closed or _conn.broken:
        _conn = connexion(autocommit=True)
    return _conn


def fermer_connexion() -> None:
    """Ferme la connexion du script, appelée à la fin de l'exécution."""
    if _conn is not None and not _conn.closed:
        _conn.close()


def preparer_liens(batch: list) -> set[str]:
    """Retire du lot les liens que le dump n'a pas changés, et rend les uid dont
    l'upsert va remplacer un lien déjà en base par un autre. Modifie `batch` sur place.

    Le lien d'un texte est parfois réparé après l'import : PDF de secours de
    `verifier_urls_textes`, adresse corrigée par `fix_textes_urls` de sync_senat.
    `lien_texte_source` garde la dernière adresse donnée par le dump, et `lien_texte`
    n'est envoyé que si elle a changé : sinon la base, qui compare elle-même (D-331),
    remettait chaque nuit l'adresse du dump par-dessus la réparation, refaite la même
    nuit par le vérificateur. Une clé absente du payload laisse la colonne en place
    (`upsert_isole`).

    `url_accessible` n'est pas dans le payload : sans rien faire, une ligne dont le
    lien change garderait le verdict du HEAD fait sur l'ancienne adresse, et
    `verifier_urls_textes` ne relit pas une ligne déjà à `true` (ni `fix_textes_urls`).
    Le 2026-10-19, le lien du texte adopté sur les Balkans passait ainsi de `tas23-050`
    à `tas24-050` en restant « accessible » sans vérification. Les lignes dont
    `contenu_legifrance` est rempli sont écartées : le vérificateur les saute, une
    remise à zéro les laisserait à nul.

    Une lecture qui échoue laisse le lot tel quel (liens écrits) et rend un ensemble
    vide plutôt que de lever : elle ferait perdre le lot entier pour la nuit, quand
    l'enjeu n'est qu'une réparation à refaire ou une vérification de plus.
    """
    avec_lien = {t["uid"]: t for t in batch if "lien_texte" in t}
    if not avec_lien:
        return set()
    for t in avec_lien.values():
        t["lien_texte_source"] = t["lien_texte"]
    try:
        lignes = lire(
            _pg(),
            "SELECT uid, lien_texte, lien_texte_source, contenu_legifrance IS NULL AS sans_contenu"
            " FROM textes WHERE uid = ANY(%s)",
            (list(avec_lien),),
        )
    except psycopg.Error as e:
        tqdm.write(f"   ⚠ Liens en base illisibles, lot écrit tel quel, sans remise à vérifier : {e}")
        return set()
    a_reverifier = set()
    for l in lignes:
        t = avec_lien[l["uid"]]
        if l["lien_texte_source"] == t["lien_texte"]:
            del t["lien_texte"]
        elif l["sans_contenu"] and l["lien_texte"] and l["lien_texte"] != t["lien_texte"]:
            a_reverifier.add(l["uid"])
    return a_reverifier


def remettre_a_verifier(uids: set[str]) -> None:
    """Remet `url_accessible` à nul : la vérification nocturne relira la nouvelle adresse.

    `date_accessible` reste : elle dit quand le texte a été vu en ligne la première
    fois, et ne s'écrase jamais (voir `verifier_urls_textes`). Un échec se dit avec les
    uid concernés, sans lever : le lien est déjà écrit, la nuit suivante ne verrait plus
    d'écart à rattraper, et seule la ligne du journal permet de les remettre à la main.
    """
    liste = sorted(uids)
    try:
        with _pg().cursor() as cur:
            cur.execute("UPDATE textes SET url_accessible = NULL WHERE uid = ANY(%s)", (liste,))
    except psycopg.Error as e:
        tqdm.write(f"   ❌ Remise à vérifier impossible ({e}) pour : {', '.join(liste)}")
        return
    tqdm.write(f"   🔁 {len(liste)} lien(s) remplacé(s), remis à vérifier : {', '.join(liste[:5])}"
               + (" …" if len(liste) > 5 else ""))


def upsert_batch(batch: list) -> tuple[int, int]:
    """Upsert un lot de textes et rend (écrits, perdus).

    Un lot rejeté ne perd que ses lignes fautives (`upsert_si_change`), et les organes
    auteurs absents de `organes` y sont créés avant l'envoi, sans quoi la clé étrangère
    rejetterait le texte (voir `creer_organes_manquants`). La base n'écrit que les textes
    nouveaux ou changés : `écrits` n'est donc pas la taille du lot.

    Pour un texte du Sénat, `auteurs_refs` et `cosignataires_refs` ne sont pas comparés :
    `sync_senat.py` les corrige après cet import, d'après la source du Sénat, et le dump
    de l'Assemblée n'en porte qu'une version partielle (le 2026-11-05, 191 et 396 textes
    du Sénat différaient ainsi de la base). Comparés, ils seraient remis chaque nuit à la
    version du dump, puis recorrigés par `sync_senat.py` : des centaines d'écritures
    pour rien, et des textes du Sénat sans cosignataires le temps entre les deux
    étapes. Écrits quand même quand une autre colonne du texte change, comme tout le
    reste de la ligne.
    """
    creer_organes_manquants(t.get("organe_auteur_ref") for t in batch)
    a_reverifier = preparer_liens(batch)
    senat = [t for t in batch if t.get("chambre") == "Sénat"]
    autres = [t for t in batch if t.get("chambre") != "Sénat"]
    ecrites, perdues = 0, []
    for lignes, sans_comparer in ((senat, ("auteurs_refs", "cosignataires_refs")), (autres, ())):
        if lignes:
            e, p = upsert_si_change("textes", lignes, "uid", sans_comparer=sans_comparer, journal=tqdm.write)
            ecrites += e
            perdues += p
    if a_reverifier:
        remettre_a_verifier(a_reverifier - {t["uid"] for t in perdues})
    return ecrites, len(perdues)


def deduire_chambre(uid: str) -> str | None:
    """Déduit la chambre d'origine depuis le préfixe de l'UID."""
    if not uid:
        return None
    if uid.startswith("LOI"):
        return "Parlement"
    if "ANR" in uid:
        return "Assemblée Nationale"
    if "SNR" in uid:
        return "Sénat"
    return None


# Mapping type_code → slug PDF pour les textes AN dont l'opendata HTML est absent.
# Format URL : /dyn/{leg}/textes/l{leg}{num}_{slug}.pdf
PDF_SLUG_MAP = {
    "PION": "proposition-loi",       # Proposition de loi (confirmé)
    "PRJL": "projet-loi",            # Projet de loi (confirmé le 2026-09-29 sur l17b2694)
    "PNRE": "proposition-resolution", # Proposition de résolution
    "RINF": "rapport-information",    # Rapport d'information
    "RAPP": "rapport",                # Rapport
    "AVIS": "avis",                   # Avis
}


def construire_url_pdf_fallback(uid: str, type_code: str):
    """Construit l'URL PDF alternative pour les textes AN dont l'opendata HTML échoue.
    Ex: PIONANR5L17B0371 → https://www.assemblee-nationale.fr/dyn/17/textes/l17b0371_proposition-loi.pdf
    Retourne None si le type n'est pas dans PDF_SLUG_MAP ou si l'UID ne correspond pas au format attendu.
    """
    slug = PDF_SLUG_MAP.get(type_code)
    if not slug:
        return None
    match = re.search(r'ANR\d+L(\d+)(.+)$', uid)
    if not match:
        return None
    leg = match.group(1)
    num_part = match.group(2).lower()
    return f"https://www.assemblee-nationale.fr/dyn/{leg}/textes/l{leg}{num_part}_{slug}.pdf"


def date_texte_adopte_senat(date_depot, date_creation, date_publication):
    """Date dont on tire la session d'un texte adopté par le Sénat (uid en `BTA`).

    Un texte adopté n'a pas de date de dépôt, et la date de publication de l'open data
    de l'Assemblée peut précéder le texte lui-même : le projet de loi sur le centre cyber
    des Balkans occidentaux, adopté au Sénat en février 2025, la porte au 12 février 2024.
    Lue avant la date de création, elle donnait la session 2023-2024, donc le lien
    `tas23-050`, qui est le texte adopté n° 50 de l'année précédente, sur l'Arménie.
    La date de création, elle, a donné la bonne session aux 475 autres textes adoptés
    en base au 2026-10-19.
    """
    return date_depot or date_creation or date_publication


def reconstruire_liens_texte(
    uid,
    date_depot=None,
    num_notice=None,
    date_publication=None,
    date_creation=None,
    legislature=None,
):
    """Reconstruit l'URL officielle d'un texte depuis son uid, son numéro et ses dates.

    Appelée par `importer_texte` pour chaque texte du dump de l'Assemblée. Pour un texte
    du Sénat, la session (`25` pour 2025-2026) se déduit d'une date : une session fausse
    donne le texte de même numéro d'une autre année, qui répond 200 et passe donc toute
    vérification d'accessibilité.
    """
    # Section : Gestion des cas spécifiques pour liens PDF/HTML basés sur UID et dates.

    # Cas TAP (Texte Adopté Provisoire) — AN uniquement
    # Exemple uid: PIONANR5L17TAP0140 → https://www.assemblee-nationale.fr/dyn/17/textes/l17t0140_texte-adopte-provisoire.pdf
    if "ANR" in uid and "TAP" in uid:
        parts = uid.split("L")[-1].split("TAP")
        if len(parts) == 2:
            legislature = parts[0]
            num = parts[1]
            return f"https://www.assemblee-nationale.fr/dyn/{legislature}/textes/l{legislature}t{num}_texte-adopte-provisoire.pdf"
        else:
            tqdm.write(f"Format TAP invalide pour {uid}, lien=None.")
            return None

    # Cas ETDIANR : PDF avec extraction legislature et num
    if uid.startswith("ETDIANR"):
        # Exemple uid: ETDIANR5L16B2628
        # Extraire legislature (après L) et num (après B)
        parts = uid.split("L")[-1].split("B")  # Split pour isoler LXXBYYYY
        if len(parts) == 2:
            legislature = parts[0]  # '16'
            num = parts[1]  # '2628'
            return f"https://www.assemblee-nationale.fr/dyn/{legislature}/textes/l{legislature}b{num}_etude-impact.pdf"
        else:
            tqdm.write(f"Format ETDIANR invalide pour {uid}, lien=None.")
            return None

    # Nouveau : Cas LETTANR : PDF avec extraction legislature et num, suffixe _lettre-rectificative.pdf
    if uid.startswith("LETTANR"):
        # Exemple uid: LETTANR5L17B1999
        # Extraire legislature (après L) et num (après B)
        parts = uid.split("L")[-1].split("B")  # Split pour isoler LXXBYYYY
        if len(parts) == 2:
            legislature = parts[0]  # '17'
            num = parts[1]  # '1999'
            return f"https://www.assemblee-nationale.fr/dyn/{legislature}/textes/l{legislature}b{num}_lettre-rectificative.pdf"
        else:
            tqdm.write(f"Format LETTANR invalide pour {uid}, lien=None.")
            return None

    # Cas ACINANR : PDF avec extraction legislature et num, suffixe _accord-international.pdf
    if uid.startswith("ACINANR"):
        # Exemple uid: ACINANR5L16B2347
        # Extraire legislature (après L) et num (après B)
        parts = uid.split("L")[-1].split("B")  # Split pour isoler LXXBYYYY
        if len(parts) == 2:
            legislature = parts[0]  # '16'
            num = parts[1]  # '2347'
            return f"https://www.assemblee-nationale.fr/dyn/{legislature}/textes/l{legislature}b{num}_accord-international.pdf"
        else:
            tqdm.write(f"Format ACINANR invalide pour {uid}, lien=None.")
            return None

    # Cas AVCEANR : PDF avec extraction legislature et num, suffixe _avis-conseil-etat.pdf
    if uid.startswith("AVCEANR"):
        # Exemple uid: AVCEANR5L16B0639
        # Extraire legislature (après L) et num (après B)
        parts = uid.split("L")[-1].split("B")  # Split pour isoler LXXBYYYY
        if len(parts) == 2:
            legislature = parts[0]  # '16'
            num = parts[1]  # '0639'
            return f"https://www.assemblee-nationale.fr/dyn/{legislature}/textes/l{legislature}b{num}_avis-conseil-etat.pdf"
        else:
            tqdm.write(f"Format AVCEANR invalide pour {uid}, lien=None.")
            return None

    # Cas AVISSNR : PDF/html avec calcul session, padding num_notice à 3 digits, suffixe 1.pdf/html si <2006
    if uid.startswith("AVISSNR"):
        if not date_depot or not num_notice:
            tqdm.write(f"Manque date_depot ou num_notice pour AVISSNR {uid}, lien=None.")
            return None
        date = date_depot or date_publication or date_creation
        if not date:
            tqdm.write(f"Manque toute date pour AVISSNR {uid}, lien=None.")
            return None
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            year = dt.year
            month = dt.month
            session_start_year = year if month >= 10 else year - 1
            session_code = f"a{session_start_year % 100:02d}"
            padded_num = f"{int(num_notice):03d}"  # Padding à 3 digits
            suffix = ".html"
            return f"https://www.senat.fr/rap/{session_code}-{padded_num}/{session_code}-{padded_num}{suffix}"
        except Exception as e:
            tqdm.write(f"Erreur parsing date pour AVISSNR {uid}: {e}, lien=None.")
            return None

    # Cas RAPPSNR sans BTA : PDF/html avec calcul session, padding num_notice à 3 digits, suffixe 1.pdf/html si <2006
    if uid.startswith("RAPPSNR") and "BTA" not in uid:
        # Fallback pour num_notice : extraire de l'UID si absent (dernier segment après 'B')
        if not num_notice:
            try:
                parts = uid.split("B")[-1]  # Ex. : 'RAPPSNR5S459B0173' → '0173'
                num_notice = "".join(
                    [c for c in parts if c.isdigit()]
                )  # Nettoie aux digits
                if not num_notice:
                    raise ValueError("Aucun num_notice extractible")
            except Exception as e:
                tqdm.write(f"Erreur fallback num_notice pour {uid}: {e}, lien=None.")
                return None
        # Fallback pour date : tester toutes les options ; si aucune, lien=None
        date = date_depot or date_publication or date_creation
        if not date:
            tqdm.write(f"Aucune date disponible pour RAPPSNR {uid}, lien=None.")
            return None
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            year = dt.year
            month = dt.month
            session_start_year = year if month >= 10 else year - 1
            session_code = (
                f"l{session_start_year % 100:02d}"  # Ex. : 'a25' pour session 2025-2026
            )
            padded_num = f"{int(num_notice):03d}"  # Padding à 3 digits
            suffix = ".html"
            return f"https://www.senat.fr/rap/{session_code}-{padded_num}/{session_code}-{padded_num}{suffix}"
        except Exception as e:
            tqdm.write(f"Erreur parsing pour RAPPSNR {uid}: {e}, lien=None.")
            return None

    # Cas RAPPSNR avec BTA : PDF/html avec calcul session, padding num_notice à 3 digits, suffixe .pdf/html si <2006
    # Adaptation pour textes adoptés : utilise 'tas' au lieu de 'rap' (pattern standard Sénat pour TA).
    if uid.startswith("RAPPSNR") and "BTA" in uid:
        # Fallback pour num_notice : extraire de l'UID si absent (dernier segment après 'BTA')
        if not num_notice:
            try:
                parts = uid.split("BTA")[-1]  # Ex. : 'RAPPSNR5S459BTA0173' → '0173'
                num_notice = "".join(
                    [c for c in parts if c.isdigit()]
                )  # Nettoie aux digits
                if not num_notice:
                    raise ValueError("Aucun num_notice extractible")
            except Exception as e:
                tqdm.write(f"Erreur fallback num_notice pour {uid}: {e}, lien=None.")
                return None
        # Fallback pour date : tester toutes les options ; si aucune, lien=None
        date = date_texte_adopte_senat(date_depot, date_creation, date_publication)
        if not date:
            tqdm.write(f"Aucune date disponible pour RAPPSNR BTA {uid}, lien=None.")
            return None
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            year = dt.year
            month = dt.month
            session_start_year = year if month >= 10 else year - 1
            session_code = (
                f"{session_start_year % 100:02d}"  # Sans 'a' pour tas (pattern Sénat)
            )
            padded_num = f"{int(num_notice):03d}"  # Padding à 3 digits
            suffix = ".html"
            return f"https://www.senat.fr/leg/tas{session_code}-{padded_num}{suffix}"
        except Exception as e:
            tqdm.write(f"Erreur parsing pour RAPPSNR BTA {uid}: {e}, lien=None.")
            return None

    # Cas PIONSNR : PDF/html avec calcul session, padding num_notice à 3 digits, suffixe .pdf/html si <2006
    if uid.startswith("PIONSNR") and "BTA" not in uid:
        if not num_notice:
            tqdm.write(f"Manque num_notice pour PIONSNR {uid}, lien=None.")
            return None
        date = date_depot or date_publication or date_creation
        if not date:
            tqdm.write(f"Manque toute date pour PIONSNR {uid}, lien=None.")
            return None
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            year = dt.year
            month = dt.month
            session_start_year = year if month >= 10 else year - 1
            session_code = f"{session_start_year % 100:02d}"
            padded_num = f"{int(num_notice):03d}"  # Padding à 3 digits
            suffix = ".html"
            return f"https://www.senat.fr/leg/ppl{session_code}-{padded_num}{suffix}"
        except Exception as e:
            tqdm.write(f"Erreur parsing date pour PIONSNR {uid}: {e}, lien=None.")
            return None

    # Cas PIONSNR avec BTA : PDF/html avec calcul session, padding num_notice à 3 digits, suffixe .pdf/html si <2006
    if uid.startswith("PIONSNR") and "BTA" in uid:
        if not num_notice:
            tqdm.write(f"Manque num_notice pour PIONSNR BTA {uid}, lien=None.")
            return None
        date = date_texte_adopte_senat(date_depot, date_creation, date_publication)
        if not date:
            tqdm.write(f"Manque toute date pour PIONSNR BTA {uid}, lien=None.")
            return None
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            year = dt.year
            month = dt.month
            session_start_year = year if month >= 10 else year - 1
            session_code = f"{session_start_year % 100:02d}"
            padded_num = f"{int(num_notice):03d}"  # Padding à 3 digits
            suffix = ".html"
            return f"https://www.senat.fr/leg/tas{session_code}-{padded_num}{suffix}"
        except Exception as e:
            tqdm.write(f"Erreur parsing date pour PIONSNR BTA {uid}: {e}, lien=None.")
            return None

    # Cas pour AN avant L15 : Liens ASP basés sur legislature < 15
    if uid.startswith("PIONANR"):
        # Priorité : utiliser legislature passée en paramètre si disponible
        leg_str = legislature if legislature else None
        if not leg_str:
            # Fallback : extraire de l'UID (après L et avant B ou suffixe)
            try:
                parts = uid.split("L")[-1].split("B")  # Split standard
                leg_str = parts[0]  # Prend les premiers chars après 'L'
                # Extraire seulement les digits initiaux (ex. '16TAP' → '16')
                leg_str = "".join([c for c in leg_str if c.isdigit()])
            except Exception as e:
                tqdm.write(
                    f"Erreur extraction legislature de UID pour {uid}: {e}, passe au cas standard."
                )
                leg_str = None
        if leg_str:
            try:
                leg_int = int(leg_str)
                if leg_int < 15:
                    padded_num = f"{int(num_notice):04d}"  # Padding à 4 digits
                    if "BTA" in uid:
                        return f"https://www.assemblee-nationale.fr/{leg_str}/ta/ta{padded_num}.asp"
                    elif "BTC" in uid:
                        return f"https://www.assemblee-nationale.fr/{leg_str}/ta-commission/r{padded_num}-a0.asp"
                    else:
                        return f"https://www.assemblee-nationale.fr/{leg_str}/propositions/pion{padded_num}.asp"
            except ValueError:
                tqdm.write(f"Legislature invalide pour {uid}, passe au cas standard.")
        else:
            tqdm.write(f"Pas de legislature disponible pour {uid}, passe au cas standard.")

    # Cas PRJLSNR sans BTA/BTC : PDF/html avec calcul session, padding num_notice à 3 digits, suffixe .pdf/html si <2007
    if uid.startswith("PRJLSNR") and "BTA" not in uid and "BTC" not in uid:
        # Fallback pour num_notice : extraire de l'UID si absent (dernier segment après 'B')
        if not num_notice:
            try:
                parts = uid.split("B")[-1]  # Ex. : 'PRJLSNR5S459B0546' → '0546'
                num_notice = "".join(
                    [c for c in parts if c.isdigit()]
                )  # Nettoie aux digits
                if not num_notice:
                    raise ValueError("Aucun num_notice extractible")
            except Exception as e:
                tqdm.write(f"Erreur fallback num_notice pour {uid}: {e}, lien=None.")
                return None
        # Fallback pour date : tester toutes les options ; si aucune, lien=None
        date = date_depot or date_publication or date_creation
        if not date:
            tqdm.write(f"Aucune date disponible pour PRJLSNR {uid}, lien=None.")
            return None
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            year = dt.year
            month = dt.month
            session_start_year = year if month >= 10 else year - 1
            session_code = f"{session_start_year % 100:02d}"  # Ex. : '24' pour session 2024-2025 (sans 'a' pour pjl)
            padded_num = (
                f"{int(num_notice):03d}"  # Padding à 3 digits (ex. '546' → '546')
            )
            suffix = ".html"  # Adaptation historique Sénat
            return f"https://www.senat.fr/leg/pjl{session_code}-{padded_num}{suffix}"
        except Exception as e:
            tqdm.write(f"Erreur parsing pour PRJLSNR {uid}: {e}, lien=None.")
            return None

    # Cas PRJLSNR avec BTC : Similaire à standard, utilise 'pjl' (pattern observé)
    if uid.startswith("PRJLSNR") and "BTC" in uid:
        # Fallback pour num_notice : extraire de l'UID si absent (dernier segment après 'BTC')
        if not num_notice:
            try:
                parts = uid.split("BTC")[-1]  # Ex. : 'PRJLSNR5S459BTC0668' → '0668'
                num_notice = "".join(
                    [c for c in parts if c.isdigit()]
                )  # Nettoie aux digits
                if not num_notice:
                    raise ValueError("Aucun num_notice extractible")
            except Exception as e:
                tqdm.write(f"Erreur fallback num_notice pour {uid}: {e}, lien=None.")
                return None
        # Fallback pour date : tester toutes les options ; si aucune, lien=None
        date = date_depot or date_publication or date_creation
        if not date:
            tqdm.write(f"Aucune date disponible pour PRJLSNR BTC {uid}, lien=None.")
            return None
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            year = dt.year
            month = dt.month
            session_start_year = year if month >= 10 else year - 1
            session_code = f"{session_start_year % 100:02d}"  # Ex. : '24'
            padded_num = f"{int(num_notice):03d}"  # Padding à 3 digits (ex. '668' → '668', mais exemple lien '618' → possible variante, ajuste si besoin)
            suffix = ".html"
            return f"https://www.senat.fr/leg/pjl{session_code}-{padded_num}{suffix}"
        except Exception as e:
            tqdm.write(f"Erreur parsing pour PRJLSNR BTC {uid}: {e}, lien=None.")
            return None

    # Cas PRJLSNR avec BTA : PDF/html avec calcul session, padding num_notice à 3 digits, suffixe .pdf/html si <2007
    if uid.startswith("PRJLSNR") and "BTA" in uid:
        # Fallback pour num_notice : extraire de l'UID si absent (dernier segment après 'BTA')
        if not num_notice:
            try:
                parts = uid.split("BTA")[-1]  # Ex. : 'PRJLSNR5S479BTA0009' → '0009'
                num_notice = "".join(
                    [c for c in parts if c.isdigit()]
                )  # Nettoie aux digits
                if not num_notice:
                    raise ValueError("Aucun num_notice extractible")
            except Exception as e:
                tqdm.write(f"Erreur fallback num_notice pour {uid}: {e}, lien=None.")
                return None
        # Fallback pour date : tester toutes les options ; si aucune, lien=None
        date = date_texte_adopte_senat(date_depot, date_creation, date_publication)
        if not date:
            tqdm.write(f"Aucune date disponible pour PRJLSNR BTA {uid}, lien=None.")
            return None
        try:
            dt = datetime.fromisoformat(date.replace("Z", "+00:00"))
            year = dt.year
            month = dt.month
            session_start_year = year if month >= 10 else year - 1
            session_code = f"{session_start_year % 100:02d}"  # Ex. : '24'
            padded_num = f"{int(num_notice):03d}"  # Padding à 3 digits (ex. '009' → '009', mais exemple lien '123' → variante possible)
            suffix = ".html"
            return f"https://www.senat.fr/leg/tas{session_code}-{padded_num}{suffix}"
        except Exception as e:
            tqdm.write(f"Erreur parsing pour PRJLSNR BTA {uid}: {e}, lien=None.")
            return None

    # Cas HTML standards (AN) - étendu comme avant
    if uid.startswith(
        (
            "PIONANR",
            "RIONANR",
            "DECLANR",
            "AVISANR",
            "PNREANR",
            "RINFANR",
            "RAPPANR",
            "PRJLANR",
            "MIONANR",
        )
    ):
        lien = f"https://www.assemblee-nationale.fr/dyn/opendata/{uid}.html"
        # Modification : Si '-COMPA' dans UID, forcer PDF au lieu de HTML (pour comparatifs)
        if "-COMPA" in uid:
            lien = lien.replace(".html", ".pdf")
        return lien


def importer_texte(texte_data: dict, file_name: str = "unknown.json") -> list:
    """Traite UN texte (dict) et retourne une liste de payloads pour batch."""
    try:
        data = texte_data

        # Check préliminaire : s'assurer que data est un dict valide
        if not isinstance(data, dict):
            tqdm.write(f"Data non valide (pas un dict) pour {file_name}, skip.")
            return []

        # Nouvelle branche pour gérer les dossiers législatifs et extraire les textes promulgués
        if "dossierParlementaire" in data:
            try:
                dossier = data["dossierParlementaire"]
                uid_dossier = dossier.get("uid")
                legislature = (
                    int(dossier.get("legislature"))
                    if dossier.get("legislature")
                    else None
                )
                payloads = []

                # Extraction robuste des actes : gère si actesLegislatifs est None ou non-dict (ex. : list inattendue ou autre type)
                acts_leg = dossier.get("actesLegislatifs")
                if acts_leg is None or not isinstance(acts_leg, dict):
                    actes = []  # Fallback safe si absent ou invalide
                else:
                    actes = (acts_leg.get("acteLegislatif") or [])

                # Normaliser en liste si ce n'est pas déjà le cas (robustesse)
                if not isinstance(actes, list):
                    actes = [actes] if actes is not None else []

                # Filtre final pour enlever tout None restant
                actes = [a for a in actes if a is not None]

                for acte in actes:

                    if acte.get("codeActe") == "PROM":
                        # Extraction robuste de sub_acts : gère si actesLegislatifs est None ou non-dict
                        sub_acts = acte.get("actesLegislatifs")
                        if sub_acts is None or not isinstance(sub_acts, dict):
                            continue  # Skip ce PROM invalide
                        prom_acte = sub_acts.get("acteLegislatif")

                        if prom_acte is None:
                            prom_acte = {}
                        elif isinstance(prom_acte, list):
                            prom_acte = [p for p in prom_acte if p is not None]
                            prom_acte = prom_acte[0] if prom_acte else {}
                        elif not isinstance(prom_acte, dict):
                            prom_acte = {}  # Fallback safe

                        if prom_acte.get("codeActe") == "PROM-PUB":
                            code_loi = prom_acte.get("codeLoi")
                            titre_loi = prom_acte.get("titreLoi")
                            info_jo = (prom_acte.get("infoJO") or {})
                            url_legifrance = info_jo.get("urlLegifrance")
                            date_jo_str = info_jo.get("dateJO")
                            reference_nor = info_jo.get("referenceNOR")

                            # Parsing de la date JO (ex. : "2025-12-27+01:00" -> ignorer timezone et parser YYYY-MM-DD)
                            date_publication = None
                            if date_jo_str:
                                date_jo_str = date_jo_str.split("+")[
                                    0
                                ]  # Retirer +01:00 si présent
                                try:
                                    date_publication = datetime.strptime(
                                        date_jo_str, "%Y-%m-%d"
                                    ).isoformat()
                                except ValueError:
                                    tqdm.write(
                                        f"Erreur parsing date JO pour dossier {uid_dossier}: {date_jo_str}"
                                    )

                            # Générer UID unique pour le texte promulgué (ex. : LOI2025-1316)
                            uid_texte = (
                                f"LOI{code_loi.replace('-', '')}" if code_loi else None
                            )

                            if not uid_texte or not url_legifrance:
                                tqdm.write(
                                    f"Manque codeLoi ou urlLegifrance pour PROM dans {uid_dossier}, skip."
                                )
                                continue

                            # Data pour upsert du texte promulgué
                            # Note : lien_texte est volontairement absent — c'est
                            # import_legifrance_cloud.py qui pose l'URL canonique JORF
                            # pour éviter qu'un upsert quotidien ne l'écrase.
                            data_texte = {
                                "uid": uid_texte,
                                "titre_principal": titre_loi,
                                "legislature": legislature,
                                "date_publication": date_publication,
                                "provenance": "Légifrance",
                                "dossier_ref": uid_dossier,
                                "classification": json.dumps(
                                    {"code": "LOI", "libelle": "Loi promulguée"}
                                ),  # JSONB
                                "statut_adoption": "PROMULGUE",
                                "libelle_statut_adoption": "Promulguée",
                                "type_code": "LOI",
                                "type_libelle": "Loi",
                                # Champs optionnels à None (pas applicables pour lois promulguées)
                                "date_creation": None,
                                "date_depot": None,
                                "denomination": (
                                    f"Loi n° {code_loi}" if code_loi else None
                                ),
                                "num_notice": reference_nor,  # Utiliser NOR si présent
                                "organe_auteur_ref": None,
                                "organe_referent_ref": None,
                                "depot_amendements": None,
                                "refs_brutes": json.dumps(
                                    info_jo
                                ),  # Stocker brut pour référence
                                "depot_code": None,
                                "depot_libelle": None,
                                "auteurs_refs": None,
                                "cosignataires_refs": None,
                                "rapporteurs_refs": None,
                                "parent_uid": None,
                                "titre_principal_court": (
                                    titre_loi[:100] if titre_loi else None
                                ),  # Court-circuit si long
                                "chambre": deduire_chambre(uid_texte),
                            }

                            payloads.append(data_texte)

                            # Sortir après traitement du PROM (assume un seul par dossier)
                            break

                # Si c'est un dossier, on ne continue pas vers le traitement texte standard
                return payloads

            except Exception as e:
                tqdm.write(f"Erreur traitement dossier {file_name}: {e}")
                traceback.print_exc()
                return []  # Skip le fichier en cas d'erreur

        texte = (data.get("document") or {})
        if not texte or not isinstance(texte, dict):
            tqdm.write(f"Fichier {file_name} invalide (pas de 'document' dict), skip.")
            return []

        uid = texte.get("uid")
        if not uid:
            tqdm.write(f"Fichier {file_name} sans uid, skip.")
            return []

        # Section : Extraction des données communes (pour parent et tomes)
        lien_html = reconstruire_liens_texte(
            uid,
            date_depot=((texte.get("cycleDeVie") or {}).get("chrono") or {}).get("dateDepot"),
            num_notice=(texte.get("notice") or {}).get("numNotice"),
            date_publication=((texte.get("cycleDeVie") or {}).get("chrono") or {}).get("datePublication"),
            date_creation=((texte.get("cycleDeVie") or {}).get("chrono") or {}).get("dateCreation"),
        )
        # Extraction et normalisation majuscule pour titre_principal (première lettre majuscule)
        titre_principal = (texte.get("titres") or {}).get("titrePrincipal")
        if titre_principal:
            titre_principal = titre_principal.capitalize()
            # Extraction du titre court (titrePrincipalCourt), avec fallback à None si absent
        titre_principal_court = (texte.get("titres") or {}).get("titrePrincipalCourt")
        # Capitalisation : met la première lettre en majuscule si le titre existe et n'est pas vide
        if titre_principal_court:
            titre_principal_court = titre_principal_court.capitalize()
        # Déduction libelle_statut_adoption (mapping simple ; ajuste si besoin)
        classification = (texte.get("classification") or {})
        statut_adoption = classification.get("statutAdoption")
        libelle_statut = {
            "ADOPTSEANCE": "Adopté en séance",
            "ADOPTCOM": "Adopté en comission",
            "REJETSEANCE": "Rejeté en séance",
        }.get(statut_adoption)
        # Extraction depot code/libelle (de classification.famille.depot)
        famille = (classification.get("famille") or {})
        depot = (famille.get("depot") or {})
        depot_code = depot.get("code") if depot else None
        depot_libelle = depot.get("libelle") if depot else None
        # Extraction type code/libelle (de classification.type)
        type_data = (classification.get("type") or {})
        type_code = type_data.get("code") if type_data else None
        type_libelle = type_data.get("libelle") if type_data else None
        auteurs = (texte.get("auteurs") or {})
        auteurs_refs, rapporteurs_refs, organe_auteur_ref = extraire_auteurs(auteurs)

        cosignataires_refs = extraire_cosignataires(texte)

        payloads = []

        # Préparation des data pour le parent (toujours importé)
        data = {
            "uid": uid,  # Déjà safe, uid est vérifié avant
            "lien_texte": lien_html,  # Déjà safe de reconstruire_liens_texte
            "titre_principal": titre_principal,
            "legislature": (
                int(texte.get("legislature")) if texte.get("legislature") else None
            ),  # Déjà géré
            "date_creation": ((texte.get("cycleDeVie") or {}).get("chrono") or {}).get("dateCreation"),
            "date_depot": ((texte.get("cycleDeVie") or {}).get("chrono") or {}).get("dateDepot"),
            "date_publication": ((texte.get("cycleDeVie") or {}).get("chrono") or {}).get("datePublication"),
            "denomination": (
                texte.get("denominationStructurelle")
                if texte.get("denominationStructurelle")
                else None
            ),  # Ajouté else None pour safe
            "provenance": (
                "Assemblée Nationale" if texte.get("provenance") == "AN" else texte.get("provenance")
            ),
            "dossier_ref": (
                texte.get("dossierRef") if texte.get("dossierRef") else None
            ),  # Nullable, déjà safe
            "classification": (
                classification if classification else None
            ),  # Ajouté check (déjà variable)
            "statut_adoption": (
                statut_adoption if statut_adoption else None
            ),  # Ajouté check (déjà variable)
            "libelle_statut_adoption": (
                libelle_statut if libelle_statut else None
            ),  # Ajouté check (déjà variable)
            "num_notice": (texte.get("notice") or {}).get("numNotice"),
            "organe_auteur_ref": (
                organe_auteur_ref if organe_auteur_ref else None
            ),  # Ajouté check (déjà variable)
            "organe_referent_ref": (texte.get("organesReferents") or {}).get("organeRef"),
            "depot_amendements": (
                texte.get("depotAmendements") if texte.get("depotAmendements") else None
            ),  # Ajouté else None
            "refs_brutes": (
                texte.get("cycleDeVie") if texte.get("cycleDeVie") else None
            ),  # Ajouté else None
            "depot_code": depot_code,
            "depot_libelle": depot_libelle,
            "auteurs_refs": auteurs_refs if auteurs_refs else None,
            "cosignataires_refs": cosignataires_refs if cosignataires_refs else None,
            "type_code": type_code,
            "type_libelle": type_libelle,
            "rapporteurs_refs": rapporteurs_refs if rapporteurs_refs else None,
            "titre_principal_court": (
                titre_principal_court if titre_principal_court else None
            ),
            "has_tomes": False,  # Mis à jour après traitement des divisions
            "chambre": deduire_chambre(uid),
        }
        payloads.append(data)

        # Gestion des divisions (tomes) : importer chaque tome comme texte autonome, avec parent_uid
        divisions = (texte.get("divisions") or {}).get("division") or []
        # Modification : Normaliser si 'division' est un dict unique (au lieu de list)
        if isinstance(divisions, dict):
            divisions = [divisions] if divisions else []
        divisions = [d for d in divisions if d is not None]
        if divisions is None:
            divisions = []
        # print(f"Debug: divisions type={type(divisions)}, len={len(divisions)}")  # Optionnel pour tracer
        if divisions:
            # Boucle sur chaque tome (division), avec tome 1 comme principal via héritage max
            for idx, division in enumerate(divisions):
                if not isinstance(division, dict):
                    continue  # Skip si invalide
                # Créer un texte_tome en copiant le parent et overridant avec les champs du tome
                texte_tome = texte.copy()  # Héritage des champs parents
                texte_tome.update(division)  # Override avec champs spécifiques du tome
                # Extraction uid du tome (obligatoire)
                uid_tome = texte_tome.get("uid")
                if not uid_tome:
                    tqdm.write(f"Tome sans uid dans {file_name}, skip.")
                    continue
                # Lien pour le tome (utilise la même fonction)
                lien_html_tome = reconstruire_liens_texte(
                    uid_tome,
                    date_depot=((texte_tome.get("cycleDeVie") or {}).get("chrono") or {}).get("dateDepot"),
                    num_notice=(texte_tome.get("notice") or {}).get("numNotice"),
                    date_publication=((texte_tome.get("cycleDeVie") or {}).get("chrono") or {}).get("datePublication"),
                    date_creation=((texte_tome.get("cycleDeVie") or {}).get("chrono") or {}).get("dateCreation"),
                )
                # Extraction des autres champs (réutilise la logique existante, adaptée au texte_tome)
                titre_principal_tome = (texte_tome.get("titres") or {}).get("titrePrincipal")
                if titre_principal_tome:
                    titre_principal_tome = titre_principal_tome.capitalize()
                    # Extraction du titre court pour le tome enfant, avec fallback à None si absent
                titre_principal_court_tome = (texte_tome.get("titres") or {}).get("titrePrincipalCourt")
                # Capitalisation : met la première lettre en majuscule si le titre existe et n'est pas vide
                if titre_principal_court_tome:
                    titre_principal_court_tome = titre_principal_court_tome.capitalize()
                classification_tome = (texte_tome.get("classification") or {})
                statut_adoption_tome = classification_tome.get("statutAdoption")
                libelle_statut_tome = {
                    "ADOPTSEANCE": "Adopté en séance",
                    "ADOPTCOM": "Adopté en comission",
                    "REJETSEANCE": "Rejeté en séance",
                }.get(statut_adoption_tome)
                famille_tome = (classification_tome.get("famille") or {})
                depot_tome = (famille_tome.get("depot") or {})
                depot_code_tome = depot_tome.get("code") if depot_tome else None
                depot_libelle_tome = depot_tome.get("libelle") if depot_tome else None
                type_data_tome = (classification_tome.get("type") or {})
                type_code_tome = type_data_tome.get("code") if type_data_tome else None
                type_libelle_tome = (
                    type_data_tome.get("libelle") if type_data_tome else None
                )
                # Le tome porte ses propres auteurs : sur un rapport budgétaire, c'est
                # ici et nulle part ailleurs que se trouve le rapporteur spécial ou le
                # rapporteur pour avis de chaque mission.
                auteurs_tome = (texte_tome.get("auteurs") or {})
                auteurs_refs_tome, rapporteurs_refs_tome, organe_auteur_ref_tome = extraire_auteurs(auteurs_tome)
                # Data pour upsert du tome (similaire au principal)
                data_tome = {
                    "uid": uid_tome,
                    "lien_texte": lien_html_tome,
                    "titre_principal": titre_principal_tome,
                    "legislature": (
                        int(texte_tome.get("legislature"))
                        if texte_tome.get("legislature")
                        else None
                    ),
                    "date_creation": ((texte_tome.get("cycleDeVie") or {}).get("chrono") or {}).get("dateCreation"),
                    "date_depot": ((texte_tome.get("cycleDeVie") or {}).get("chrono") or {}).get("dateDepot"),
                    "date_publication": ((texte_tome.get("cycleDeVie") or {}).get("chrono") or {}).get("datePublication"),
                    "denomination": (
                        texte_tome.get("denominationStructurelle")
                        if texte_tome.get("denominationStructurelle")
                        else None
                    ),
                    "provenance": (
                        "Assemblée Nationale" if texte_tome.get("provenance") == "AN" else texte_tome.get("provenance")
                    ),
                    "dossier_ref": (
                        texte_tome.get("dossierRef")
                        if texte_tome.get("dossierRef")
                        else texte.get("dossierRef")
                    ),  # Héritage si absent
                    "classification": (
                        classification_tome if classification_tome else None
                    ),
                    "statut_adoption": (
                        statut_adoption_tome if statut_adoption_tome else None
                    ),
                    "libelle_statut_adoption": (
                        libelle_statut_tome if libelle_statut_tome else None
                    ),
                    "num_notice": (texte_tome.get("notice") or {}).get("numNotice"),
                    "organe_auteur_ref": (
                        organe_auteur_ref_tome if organe_auteur_ref_tome else None
                    ),
                    "organe_referent_ref": (texte_tome.get("organesReferents") or {}).get("organeRef"),
                    "depot_amendements": (
                        texte_tome.get("depotAmendements")
                        if texte_tome.get("depotAmendements")
                        else None
                    ),
                    "refs_brutes": (
                        texte_tome.get("cycleDeVie")
                        if texte_tome.get("cycleDeVie")
                        else None
                    ),
                    "depot_code": depot_code_tome,
                    "depot_libelle": depot_libelle_tome,
                    "auteurs_refs": auteurs_refs_tome if auteurs_refs_tome else None,
                    # Un tome est un volume de rapport, il n'a en général pas de
                    # cosignataires. La clé figure quand même : absente, elle laisserait
                    # la colonne telle qu'une nuit précédente l'a écrite (`upsert_isole`).
                    "cosignataires_refs": extraire_cosignataires(texte_tome) or None,
                    "type_code": type_code_tome,
                    "type_libelle": type_libelle_tome,
                    "rapporteurs_refs": rapporteurs_refs_tome if rapporteurs_refs_tome else None,
                    # Modification : Ajout du lien de parenté pour les tomes enfants
                    "parent_uid": uid,  # Référence au parent
                    "has_tomes": False,
                    "chambre": deduire_chambre(uid_tome),
                    "titre_principal_court": (
                        titre_principal_court_tome
                        if titre_principal_court_tome
                        else None
                    ),
                }

                payloads.append(data_tome)

        # Mise à jour du parent après traitement des tomes
        has_tomes = len(divisions) > 0
        payloads[0]["has_tomes"] = has_tomes

        if has_tomes:
            # Si vrais tomes numérotés (pas juste -COMPA qui est une annexe),
            # remplacer le lien du parent par celui du premier vrai tome
            # car le lien du parent peut ne pas fonctionner dans ces cas
            vrais_tomes = [
                p for p in payloads[1:]
                if p.get("lien_texte") and "-COMPA" not in p["lien_texte"]
            ]
            if vrais_tomes:
                payloads[0]["lien_texte"] = vrais_tomes[0]["lien_texte"]

        return payloads

    except Exception as e:
        tqdm.write(f"Erreur générale pour {file_name}: {e}")
        traceback.print_exc()
        return []


def importer_textes_from_zip(zip_ref: zipfile.ZipFile) -> int:
    """Importe TOUS les textes du ZIP en batch + barre de progression.

    Retourne `(echecs_parsing, echecs_ecriture)`. Les deux se traitent
    différemment : un parsing qui échoue est durable et s'alerte, une écriture
    perdue est passagère et bloque. Voir `_alertes.signaler_anomalie`.
    """
    # On ne prend que les JSON dans le dossier "document/"
    # Filtre pour textes ET dossiers (pour PROM)
    json_files = [
        f
        for f in zip_ref.namelist()
        if (
            f.startswith("json/document/") or f.startswith("json/dossierParlementaire/")
        )
        and f.endswith(".json")
    ]

    print(f"\n{len(json_files)} fichiers textes trouvés dans le ZIP\n")
    # Debug : compter séparément
    textes_count = sum(1 for f in json_files if "document/" in f)
    dossiers_count = sum(1 for f in json_files if "dossierParlementaire/" in f)
    print(f"   - Textes (document/) : {textes_count}")
    print(f"   - Dossiers (pour PROM) : {dossiers_count}")

    batch_size = 500
    batch: list = []
    parsed = 0
    success = 0
    # Deux compteurs, deux gravités : un parsing qui échoue est durable et s'alerte,
    # une écriture perdue est passagère et bloque. Voir `_alertes.signaler_anomalie`.
    echecs_parsing = 0
    echecs_ecriture = 0
    skipped_unchanged = 0

    # Barre de progression
    for file_name in tqdm(json_files, desc="Import textes", unit="fichier"):
        try:
            with zip_ref.open(file_name) as f:
                texte_data = json.load(f)

            payloads = importer_texte(texte_data, file_name)

            if payloads:
                parsed += len(payloads)
                for p in payloads:
                    uid = p.get("uid")
                    if not uid:
                        continue
                    batch.append(p)

            # Envoi par batch
            if len(batch) >= batch_size:
                s, f = upsert_batch(batch)
                success += s
                echecs_ecriture += f
                skipped_unchanged += len(batch) - s - f
                batch = []

        except Exception as e:
            echecs_parsing += 1
            tqdm.write(f"❌ Erreur fichier {file_name}: {e}")
            traceback.print_exc()

    # Dernier batch restant
    if batch:
        s, f = upsert_batch(batch)
        success += s
        echecs_ecriture += f
        skipped_unchanged += len(batch) - s - f

    print(f"\n{'='*60}")
    print(f"           IMPORT TEXTES TERMINÉ")
    print(f"{'='*60}")
    print(f"   Parsés          : {parsed}")
    print(f"   Inchangés       : {skipped_unchanged}")
    print(f"   Upserts         : {success}")
    print(f"   Échecs parsing  : {echecs_parsing}")
    print(f"   Échecs écriture : {echecs_ecriture}")
    print(f"   Total           : {parsed + echecs_parsing} / {len(json_files)}")
    print(f"{'='*60}")

    return echecs_parsing, echecs_ecriture


def verifier_urls_textes():
    """Vérifie si les URLs des textes sont accessibles (HEAD request) et met à jour url_accessible.

    Chaque nuit : les textes jamais vérifiés, et ceux accessibles sans date. Le lundi
    (`VERIF_COMPLETE`, posé par `nightly.py`), aussi les liens déjà connus pour morts.
    Ces derniers, environ 80 en septembre 2026, ne revenaient jamais à la vie d'une nuit
    à l'autre et coûtaient plus d'une minute de HEAD par run.
    """
    print(f"\n{'='*60}")
    print(f"       VÉRIFICATION URLS TEXTES")
    print(f"{'='*60}")

    filtre = "url_accessible IS NULL OR (url_accessible AND date_accessible IS NULL)"
    if os.getenv("VERIF_COMPLETE"):
        filtre += " OR url_accessible = false"

    # Légifrance répond 403 au HEAD de ce vérificateur (anti-bot) alors que le contenu du
    # texte est déjà en base : 158 textes étaient ainsi marqués « lien mort » chaque nuit,
    # et la fiche dossier les écartait de la sélection par défaut. Un texte dont le
    # contenu est importé n'a plus rien à prouver.
    textes_a_verifier = lire(
        _pg(),
        f"""
        SELECT uid, lien_texte, type_code FROM textes
        WHERE ({filtre}) AND lien_texte IS NOT NULL AND contenu_legifrance IS NULL
        ORDER BY uid
        """,
    )
    print(f"   Textes à vérifier : {len(textes_a_verifier)}")

    if not textes_a_verifier:
        print("   Aucun texte à vérifier.")
        return

    accessibles = []
    inaccessibles = []
    fallbacks = []  # {"uid": ..., "lien_texte": ...} — URL corrigée vers PDF
    flush_size = 100  # Sauvegarde en DB toutes les 100 vérifications
    total = {"accessibles": 0, "fallbacks": 0, "inaccessibles": 0, "echecs_ecriture": 0}  # compteurs cumulatifs

    def ecrire(requete: str, params: tuple, label: str, essais: int = 3) -> None:
        """Rejoue une écriture quand la connexion rend une erreur passagère.

        Le 504 du 2026-09-12 a tué toute l'étape alors que la requête s'exécute
        en ~20 ms mesurées : c'est la connexion qui lâche, pas la requête.

        On absorbe donc l'échec au lieu de lever, parce que la requête de
        sélection rattrape d'elle-même les quatre formes de lot perdu : un
        `url_accessible` non écrit reste NULL ou False, et une `date_accessible`
        non écrite laisse une ligne `url_accessible=true` sans date. NULL et
        « true sans date » reviennent la nuit suivante ; False, le lundi suivant,
        la seule nuit où les liens déjà connus pour morts sont revérifiés.
        """
        for essai in range(1, essais + 1):
            try:
                with _pg().cursor() as cur:
                    cur.execute(requete, params)
                return
            except psycopg.Error as e:
                if essai == essais:
                    total["echecs_ecriture"] += 1
                    tqdm.write(f"❌ {label} : abandon après {essais} essais ({e})")
                    return
                attente = 2 ** essai
                tqdm.write(f"⏱️  {label} : échec ({e}) — nouvel essai dans {attente}s")
                time.sleep(attente)

    def flush(acc, inacc, fallbs):
        today = datetime.now().date().isoformat()
        total["accessibles"] += len(acc)
        total["fallbacks"] += len(fallbs)
        total["inaccessibles"] += len(inacc)
        # `IS DISTINCT FROM` : une ligne déjà au bon état n'est pas réécrite (pas de
        # ligne morte ni de déclencheur pour rien), la valeur finale est la même.
        if acc:
            ecrire("UPDATE textes SET url_accessible = true WHERE uid = ANY(%s) AND url_accessible IS DISTINCT FROM true",
                   (acc,), f"url_accessible=true ({len(acc)} uid)")
            ecrire("UPDATE textes SET date_accessible = %s WHERE uid = ANY(%s) AND date_accessible IS NULL",
                   (today, acc), f"date_accessible ({len(acc)} uid)")
        if inacc:
            ecrire("UPDATE textes SET url_accessible = false WHERE uid = ANY(%s) AND url_accessible IS DISTINCT FROM false",
                   (inacc,), f"url_accessible=false ({len(inacc)} uid)")
        if fallbs:
            ecrire("""
                   UPDATE textes t SET lien_texte = v.lien_texte, url_accessible = true
                   FROM jsonb_to_recordset(%s::jsonb) AS v(uid text, lien_texte text)
                   WHERE t.uid = v.uid
                     AND (t.lien_texte IS DISTINCT FROM v.lien_texte OR t.url_accessible IS DISTINCT FROM true)
                   """, (json.dumps(fallbs),), f"fallback PDF ({len(fallbs)} uid)")
            ecrire("UPDATE textes SET date_accessible = %s WHERE uid = ANY(%s) AND date_accessible IS NULL",
                   (today, [f["uid"] for f in fallbs]), f"date_accessible fallback ({len(fallbs)} uid)")

    for texte in tqdm(textes_a_verifier, desc="Vérif URLs", unit="url"):
        accessible = False
        try:
            resp = requests.head(texte["lien_texte"], timeout=5, allow_redirects=True)
            accessible = resp.status_code < 400
        except Exception:
            pass
        time.sleep(0.2)

        if accessible:
            accessibles.append(texte["uid"])
        else:
            # Tenter le fallback PDF si lien opendata AN échoue
            fallback_url = None
            if "/dyn/opendata/" in (texte["lien_texte"] or ""):
                fallback_url = construire_url_pdf_fallback(texte["uid"], texte.get("type_code") or "")
            if fallback_url:
                try:
                    resp2 = requests.head(fallback_url, timeout=5, allow_redirects=True)
                    # Vérifier le Content-Type : l'AN renvoie parfois du HTML à une URL .pdf
                    # (HTTP 200 avec text/html) — seul application/pdf confirme un vrai PDF
                    content_type = resp2.headers.get("Content-Type", "")
                    if resp2.status_code < 400 and "pdf" in content_type:
                        fallbacks.append({"uid": texte["uid"], "lien_texte": fallback_url})
                        tqdm.write(f"Fallback PDF : {texte['uid']} → {fallback_url}")
                    else:
                        inaccessibles.append(texte["uid"])
                except Exception:
                    inaccessibles.append(texte["uid"])
                time.sleep(0.2)
            else:
                inaccessibles.append(texte["uid"])

        # Flush progressif toutes les flush_size itérations
        if (len(accessibles) + len(inaccessibles) + len(fallbacks)) % flush_size == 0:
            flush(accessibles, inaccessibles, fallbacks)
            accessibles, inaccessibles, fallbacks = [], [], []

    # Flush final pour le reste
    flush(accessibles, inaccessibles, fallbacks)

    print(f"   Accessibles  : {total['accessibles']}")
    print(f"   Fallbacks PDF: {total['fallbacks']}")
    print(f"   Inaccessibles: {total['inaccessibles']}")
    if total["echecs_ecriture"]:
        print(f"   ⚠️  Écritures abandonnées : {total['echecs_ecriture']} (reprises la nuit prochaine)")
    print(f"{'='*60}")


# Exécution
if __name__ == "__main__":
    # URL exacte du ZIP (même que pour les dossiers)
    URL = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/dossiers_legislatifs/Dossiers_Legislatifs.json.zip"

    # Initialisés avant le `try` : un ZIP inchangé laisserait sinon les variables
    # indéfinies au moment des tests plus bas.
    echecs_parsing = 0
    echecs_ecriture = 0
    zip_traite = False
    try:
        zip_ref = download_zip_if_modified(URL, label="textes")
        echecs_parsing, echecs_ecriture = importer_textes_from_zip(zip_ref)
        zip_traite = True
    except NotModified:
        print("ZIP textes inchangé depuis le dernier import — parsing ignoré.")

    # La vérification des URLs tourne toujours : elle cible les textes
    # dont `url_accessible` est NULL, False, ou True sans `date_accessible` (jamais confirmés), indépendamment du ZIP.
    verifier_urls_textes()

    print("\nTout est terminé !")
    fermer_connexion()

    # Décision différée jusqu'ici pour ne pas priver la vérification des URLs de son
    # passage : elle ne dépend pas du ZIP et a sa valeur même quand le parsing a échoué.
    if echecs_ecriture:
        print(f"❌ {echecs_ecriture} texte(s) perdus en écriture.")
        sys.exit(1)

    if echecs_parsing:
        signaler_anomalie(
            "textes",
            f"{echecs_parsing} fichier(s) de texte illisibles dans le dump AN — à corriger dans le parseur",
        )

    if zip_traite:
        confirmer_import(URL, label="textes")
