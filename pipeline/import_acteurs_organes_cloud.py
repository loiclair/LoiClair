# import_acteurs_organes_cloud.py
# Script combiné pour importer acteurs (PA*) et organes (PO*) depuis un ZIP distant (url AN) vers la base.
# Exécute avec : python import_acteurs_organes_cloud.py

import json
import re
import sys
import requests
import io
import zipfile
import traceback
from pathlib import Path
from dotenv import load_dotenv
from tqdm import tqdm
from datetime import date, timedelta
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _sync_cache import (
    NotModified,
    confirmer_import,
    download_zip_if_modified,
    upsert_si_change,
)
from _positions_groupe import COULEURS_GROUPES_SENAT, GROUPES_SENAT_VERS_ORGANE, GROUPE_ALIAS
from _db import connexion, lire
from _colonnes_senat import COLONNES_COORDONNEES_SENAT


# ===================================================================
# Constantes module-level
# ===================================================================

# Dict statique code département -> nom (couvre métropole + outre-mer ; source : data.gouv.fr)
DEPARTEMENTS_MAP = {
    "01": "Ain",
    "02": "Aisne",
    "03": "Allier",
    "04": "Alpes-de-Haute-Provence",
    "05": "Hautes-Alpes",
    "06": "Alpes-Maritimes",
    "07": "Ardèche",
    "08": "Ardennes",
    "09": "Ariège",
    "10": "Aube",
    "11": "Aude",
    "12": "Aveyron",
    "13": "Bouches-du-Rhône",
    "14": "Calvados",
    "15": "Cantal",
    "16": "Charente",
    "17": "Charente-Maritime",
    "18": "Cher",
    "19": "Corrèze",
    "21": "Côte-d'Or",
    "22": "Côtes-d'Armor",
    "23": "Creuse",
    "24": "Dordogne",
    "25": "Doubs",
    "26": "Drôme",
    "27": "Eure",
    "28": "Eure-et-Loir",
    "29": "Finistère",
    "2A": "Corse-du-Sud",
    "2B": "Haute-Corse",
    "30": "Gard",
    "31": "Haute-Garonne",
    "32": "Gers",
    "33": "Gironde",
    "34": "Hérault",
    "35": "Ille-et-Vilaine",
    "36": "Indre",
    "37": "Indre-et-Loire",
    "38": "Isère",
    "39": "Jura",
    "40": "Landes",
    "41": "Loir-et-Cher",
    "42": "Loire",
    "43": "Haute-Loire",
    "44": "Loire-Atlantique",
    "45": "Loiret",
    "46": "Lot",
    "47": "Lot-et-Garonne",
    "48": "Lozère",
    "49": "Maine-et-Loire",
    "50": "Manche",
    "51": "Marne",
    "52": "Haute-Marne",
    "53": "Mayenne",
    "54": "Meurthe-et-Moselle",
    "55": "Meuse",
    "56": "Morbihan",
    "57": "Moselle",
    "58": "Nièvre",
    "59": "Nord",
    "60": "Oise",
    "61": "Orne",
    "62": "Pas-de-Calais",
    "63": "Puy-de-Dôme",
    "64": "Pyrénées-Atlantiques",
    "65": "Hautes-Pyrénées",
    "66": "Pyrénées-Orientales",
    "67": "Bas-Rhin",
    "68": "Haut-Rhin",
    "69": "Rhône",
    "70": "Haute-Saône",
    "71": "Saône-et-Loire",
    "72": "Sarthe",
    "73": "Savoie",
    "74": "Haute-Savoie",
    "75": "Paris",
    "76": "Seine-Maritime",
    "77": "Seine-et-Marne",
    "78": "Yvelines",
    "79": "Deux-Sèvres",
    "80": "Somme",
    "81": "Tarn",
    "82": "Tarn-et-Garonne",
    "83": "Var",
    "84": "Vaucluse",
    "85": "Vendée",
    "86": "Vienne",
    "87": "Haute-Vienne",
    "88": "Vosges",
    "89": "Yonne",
    "90": "Territoire de Belfort",
    "91": "Essonne",
    "92": "Hauts-de-Seine",
    "93": "Seine-Saint-Denis",
    "94": "Val-de-Marne",
    "95": "Val-d'Oise",
    "971": "Guadeloupe",
    "972": "Martinique",
    "973": "Guyane",
    "974": "La Réunion",
    "975": "Saint-Pierre-et-Miquelon",
    "976": "Mayotte",
    "977": "Saint-Barthélemy",
    "978": "Saint-Martin",
    "984": "Terres australes et antarctiques françaises",
    "986": "Wallis-et-Futuna",
    "987": "Polynésie française",
    "988": "Nouvelle-Calédonie",
    "989": "Clipperton",
}


# Borne du mandat sénatorial en cours, identique à celle de `sync_senat.py`,
# `import_amendements.py` et `import_questions.py`. Elle reste celle de 2023 après le
# renouvellement de septembre 2026 : un réélu est traité comme continu (voir
# `fusionner_periodes`), et la vue `activite_elus_mv` rogne chaque période à cette date.
SENAT_DERNIERE_ELECTION = "2023-10-02"


# ===================================================================
# Helpers
# ===================================================================

def resolve_xsi_nil(value):
    """Retourne None si value est un dict avec @xsi:nil=true, sinon retourne la valeur."""
    if isinstance(value, dict):
        if value.get("@xsi:nil"):
            return value.get("#text")  # Parfois il y a un #text malgré nil
        return value.get("#text", value)
    return value


def safe_text(value) -> str | None:
    """Applique resolve_xsi_nil et garantit un str ou None (jamais un dict résiduel)."""
    v = resolve_xsi_nil(value)
    return v if isinstance(v, str) else None


def clean_profession(value: str | None) -> str | None:
    """Supprime le préfixe '(XX) - ' et met en majuscule la première lettre."""
    if not isinstance(value, str):
        return value
    value = re.sub(r"^\(\d+\)\s*-\s*", "", value).strip()
    return value[0].upper() + value[1:] if value else value


def normalize_mandats(data: dict) -> list:
    """Parse les mandats une seule fois depuis le JSON brut. Retourne toujours une liste."""
    mandats_raw = (data.get("mandats") or {}).get("mandat") or []
    if isinstance(mandats_raw, dict):
        mandats_raw = [mandats_raw]
    return mandats_raw if isinstance(mandats_raw, list) else []


def parse_adresse_list(data: dict, file_name: str) -> list:
    """Parse la section adresses en une liste de dicts. Gère xsi:nil et single dict."""
    adresses_section = data.get("adresses")
    if isinstance(adresses_section, dict) and adresses_section.get("@xsi:nil"):
        return []
    adresse_raw = (data.get("adresses") or {}).get("adresse")
    if isinstance(adresse_raw, dict):
        return [adresse_raw]
    elif isinstance(adresse_raw, list):
        return adresse_raw
    return []


def build_social_url(val_elec: str | None, prefix: str, strip_at: bool = False) -> str | None:
    """Construit une URL sociale avec guard http. Si val_elec est déjà une URL complète, la retourne telle quelle."""
    if not val_elec:
        return None
    if val_elec.startswith("http"):
        return val_elec
    handle = val_elec.lstrip("@") if strip_at else val_elec
    return f"{prefix}{handle}"


# ===================================================================
# Téléchargement du ZIP
# ===================================================================
def download_zip(url: str) -> zipfile.ZipFile:
    """Télécharge le ZIP en mémoire depuis l'URL."""
    print(f"Téléchargement du ZIP depuis : {url}")
    response = requests.get(url, timeout=120)
    response.raise_for_status()
    return zipfile.ZipFile(io.BytesIO(response.content))


# Charger env vars de .env.local (chemin relatif au script, portable sur toutes les machines).
# Les variables `PG*` de la connexion Postgres (voir `_db.py`) en viennent aussi.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ===================================================================
# Sous-fonctions de parsing acteur
# ===================================================================

def extract_identity(data: dict) -> dict:
    """Extrait uid, civ, prenom, nom, alpha, trigramme."""
    uid = data["uid"].get("#text") if isinstance(data["uid"], dict) else data["uid"]
    ident = data["etatCivil"]["ident"]
    civ = ident.get("civ") if isinstance(ident, dict) else None
    prenom = ident.get("prenom") if isinstance(ident, dict) else None
    nom = ident.get("nom") if isinstance(ident, dict) else None
    alpha = ident.get("alpha") if isinstance(ident, dict) else None

    trigramme_raw = ident.get("trigramme") if isinstance(ident, dict) else None
    if isinstance(trigramme_raw, dict):
        trigramme = trigramme_raw.get("#text") if not trigramme_raw.get("@xsi:nil") else None
    else:
        trigramme = trigramme_raw if isinstance(trigramme_raw, str) else None

    return {
        "uid": uid, "civ": civ, "prenom": prenom, "nom": nom,
        "alpha": alpha, "trigramme": trigramme,
    }


def calculer_age(date_naissance: str, file_name: str) -> int | None:
    """Âge en années révolues, ou None si la date est illisible."""
    try:
        birth_date = date.fromisoformat(date_naissance)
    except ValueError:
        tqdm.write(f"⚠️  Date naissance invalide pour {file_name}: {date_naissance} - Age=None.")
        return None
    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))


def extract_birth_info(data: dict, file_name: str) -> dict:
    """Extrait date_naissance, ville, dep, pays, age, date_deces."""
    info_naissance = data["etatCivil"]["infoNaissance"]

    if isinstance(info_naissance, dict):
        date_naissance = safe_text(info_naissance.get("dateNais"))
        ville_naissance = safe_text(info_naissance.get("villeNais"))
        dep_naissance = safe_text(info_naissance.get("depNais"))
        pays_naissance = safe_text(info_naissance.get("paysNais"))
    else:
        date_naissance = info_naissance if isinstance(info_naissance, str) else None
        ville_naissance = None
        dep_naissance = None
        pays_naissance = None

    # Calcul âge
    age = None
    if date_naissance and isinstance(date_naissance, str):
        age = calculer_age(date_naissance, file_name)

    # Date décès
    date_deces_raw = data["etatCivil"].get("dateDeces")
    if isinstance(date_deces_raw, dict):
        date_deces = date_deces_raw.get("#text") if not date_deces_raw.get("@xsi:nil") else None
    else:
        date_deces = date_deces_raw if isinstance(date_deces_raw, str) else None

    return {
        "date_naissance": date_naissance, "ville_naissance": ville_naissance,
        "dep_naissance": dep_naissance, "pays_naissance": pays_naissance,
        "age": age, "date_deces": date_deces,
    }


def extract_profession(data: dict) -> dict:
    """Extrait libelle_profession, cat_soc_pro, fam_soc_pro, uri_hatvp."""
    profession = data["profession"]

    if isinstance(profession, dict):
        libelle_profession_raw = profession.get("libelleCourant")
        libelle_profession = clean_profession(
            libelle_profession_raw
            if not (isinstance(libelle_profession_raw, dict) and libelle_profession_raw.get("@xsi:nil"))
            else None
        )
        soc_proc_insee = profession.get("socProcINSEE") or {}
        cat_soc_pro_raw = soc_proc_insee.get("catSocPro")
        cat_soc_pro = (
            cat_soc_pro_raw
            if not (isinstance(cat_soc_pro_raw, dict) and cat_soc_pro_raw.get("@xsi:nil"))
            else None
        )
        fam_soc_pro_raw = soc_proc_insee.get("famSocPro")
        fam_soc_pro = (
            fam_soc_pro_raw
            if not (isinstance(fam_soc_pro_raw, dict) and fam_soc_pro_raw.get("@xsi:nil"))
            else None
        )
    else:
        libelle_profession = None
        cat_soc_pro = None
        fam_soc_pro = None

    uri_hatvp_raw = data.get("uri_hatvp")
    uri_hatvp = (
        uri_hatvp_raw
        if not (isinstance(uri_hatvp_raw, dict) and uri_hatvp_raw.get("@xsi:nil"))
        else None
    )

    return {
        "libelle_profession": libelle_profession, "cat_soc_pro": cat_soc_pro,
        "fam_soc_pro": fam_soc_pro, "uri_hatvp": uri_hatvp,
    }


def extract_social_urls(adresse_list: list) -> dict:
    """Extrait email, telephone, URLs sociales, profil_url et adresse_circonscription."""
    email = None
    telephone = None
    linkedin_url = None
    profil_url = None
    twitter_url = None
    instagram_url = None
    facebook_url = None
    adresse_circonscription = None

    for addr in adresse_list:
        if not isinstance(addr, dict):
            continue
        addr_type = addr.get("type")
        val_elec = addr.get("valElec")

        if addr_type == "15":
            email = val_elec
        elif addr_type == "11":
            telephone = val_elec
            if telephone:
                telephone = telephone.replace(".", " ")
                if " " not in telephone:
                    telephone = " ".join([telephone[i:i+2] for i in range(0, len(telephone), 2)])
        elif addr_type == "30":
            # LinkedIn : val_elec est un chemin relatif ("/in/Nom") — encoder les espaces
            if val_elec:
                if val_elec.startswith("http"):
                    linkedin_url = val_elec
                else:
                    linkedin_url = f"https://www.linkedin.com{quote(val_elec)}"
        elif addr_type == "23":
            profil_url = val_elec
        elif addr_type == "24":
            twitter_url = build_social_url(val_elec, "https://twitter.com/", strip_at=True)
        elif addr_type in ["26", "29"]:
            instagram_url = build_social_url(val_elec, "https://instagram.com/", strip_at=True)
        elif addr_type == "25":
            facebook_url = build_social_url(val_elec, "https://www.facebook.com/")
        elif addr_type == "2" and adresse_circonscription is None:
            # Adresse de circonscription, affichée sur la fiche de l'élu (« Permanence »).
            # Le dump écrit `null` sur un champ vide : `.get("k", "")` rendait alors
            # None, imprimé « None » dans 16 adresses au 2026-10-25. Le code postal
            # reste précédé d'une virgule, qui manquait (« 11 Rue Faidherbe62200 … »).
            # Certains champs finissent par une virgule (« Place de la Libération, »),
            # qui se doublerait au moment de joindre.
            def champ(cle: str) -> str:
                return (addr.get(cle) or "").strip().rstrip(",").strip()

            numero, nom_rue, complement, ville = (
                champ("numeroRue"), champ("nomRue"), champ("complementAdresse"), champ("ville")
            )
            # Un numéro sans nom de rue appartient au complément, qui porte alors la voie
            # (« 2 » + « Jardin de Beaune-Semblançay ») et parfois déjà le numéro
            # (« 5 » + « 5 place du colonel Fabien »). Le numéro se compare en mot entier :
            # un simple préfixe le perdrait devant « 52 rue … ».
            if numero and not nom_rue and complement:
                if not re.match(rf"{re.escape(numero)}\b", complement):
                    complement = f"{numero} {complement}"
                numero = ""
            rue = " ".join(filter(None, [numero, nom_rue]))
            commune = " ".join(filter(None, [champ("codePostal"), ville]))
            # Ni rue ni ville : il ne reste qu'un code postal, rien qu'un lecteur puisse
            # trouver. Deux fiches n'avaient que des `null` (« None NoneNone None »).
            if rue or ville:
                adresse_circonscription = ", ".join(filter(None, [rue, complement, commune]))

    return {
        "email": email, "telephone": telephone, "linkedin_url": linkedin_url,
        "profil_url": profil_url, "twitter_url": twitter_url,
        "instagram_url": instagram_url, "facebook_url": facebook_url,
        "adresse_circonscription": adresse_circonscription,
    }


def fusionner_periodes(periodes: list) -> list:
    """Fusionne les périodes de mandat qui se recouvrent ou se touchent, dans l'ordre chronologique.

    Entrée et sortie : liste de tuples (debut, fin), dates ISO « YYYY-MM-DD », `fin` à None
    pour un mandat en cours. Les chaînes ISO se comparent directement.

    AMO liste parfois deux mandats pour le même siège (deux entrées SENAT à deux jours
    d'écart, même début de législature). Empilées telles quelles, elles font compter les
    mêmes jours deux fois dans `jours_actifs` : neuf sénateurs avaient un dénominateur
    doublé au 2026-08-31, donc tous leurs taux journaliers divisés par deux.

    Deux périodes contiguës (la seconde commence le lendemain de la fin de la première)
    fusionnent aussi. C'est le cas d'un sénateur réélu : son mandat se clôt la veille du
    renouvellement et le suivant s'ouvre le jour même. La vue lit chaque période comme
    un intervalle à borne de fin exclue, donc deux périodes laissées côte à côte y
    perdraient un jour par réélection, et un réélu y paraîtrait interrompu.
    """
    OUVERT = "9999-12-31"  # sentinelle de comparaison pour une fin à None

    def lendemain(jour: str) -> str:
        return (date.fromisoformat(jour[:10]) + timedelta(days=1)).isoformat()

    fusion: list = []
    for debut, fin in sorted(periodes, key=lambda p: (p[0], p[1] or OUVERT)):
        fin_courante = fusion[-1][1] if fusion else None
        if fusion and (fin_courante is None or debut <= lendemain(fin_courante)):
            debut_precedent, fin_precedente = fusion[-1]
            # Une seule fin ouverte suffit à rendre la période fusionnée ouverte.
            if fin_precedente is None or fin is None:
                fusion[-1] = (debut_precedent, None)
            else:
                fusion[-1] = (debut_precedent, max(fin_precedente, fin))
        else:
            fusion.append((debut, fin))
    return fusion


def historique_des_groupes(mandats: list) -> list | None:
    """Groupes politiques d'un acteur dans le temps, pour `acteurs.historique_groupes`.

    `mandats` : la liste complète de `normalize_mandats`. Seuls les mandats `GP` et
    `GROUPESENAT` comptent, clos compris : c'est ce qui permet à
    `import_dossiers_cloud.py` (et aux résolutions de `sync_senat.py`) de ranger un
    texte dans le groupe de son auteur au jour du dépôt, quand `groupe` ne connaît que
    celui d'aujourd'hui. Rend une liste
    triée de {debut, fin, groupe}, dates au jour, `fin` à None si en cours, ou None si
    l'acteur n'a jamais eu de groupe.

    `groupe` est l'uid **actif** du groupe, `GROUPE_ALIAS` appliqué ici : un groupe
    renommé (UDR devenu UDDPLR) garde un seul uid sur toute sa vie, et aucun lecteur
    de la colonne, en Python comme dans le site, n'a d'alias à connaître.
    """
    historique = []
    for m in mandats:
        if m.get("typeOrgane") not in ("GP", "GROUPESENAT"):
            continue
        groupe = (m.get("organes") or {}).get("organeRef")
        if not isinstance(groupe, str):
            continue
        historique.append({
            "debut": (m.get("dateDebut") or "")[:10] or None,
            "fin": (m.get("dateFin") or "")[:10] or None,
            "groupe": GROUPE_ALIAS.get(groupe, groupe),
        })
    # Tri complet, pour que l'empreinte de la ligne ne dépende pas de l'ordre du dump.
    historique.sort(key=lambda h: (h["debut"] or "", h["fin"] or "9999", h["groupe"]))
    return historique or None


def extract_mandate_info(all_mandats: list, file_name: str, gouvernements_ouverts: set[str]) -> dict:
    """Extrait rôles, statut actuel, groupe, organes_refs, département, et nouvelles colonnes.

    `gouvernements_ouverts` porte les uid des organes de type GOUVERNEMENT sans date de
    fin ; il décide seul de `est_ministre_actuel`.
    """
    roles_set = set()
    est_depute_actuel = False
    est_senateur_actuel = False
    est_ministre_actuel = False
    groupe_organe_ref = None
    organes_refs_set = set()
    departement_election = None
    num_departement = None
    num_circo = None
    cause_mandat = None
    _qualite_chambre = None  # libQualite du premier mandat ASSEMBLEE/SENAT ouvert lu
    date_debut_mandat = None
    date_fin_mandat = None
    place_hemicycle = None
    premiere_election = None
    _best_inactive_assemblee = None  # (dateDebut, dateFin) du mandat ASSEMBLEE le plus récent terminé
    # (dateDebut, organe, libQualite) du mandat MINISTERE ouvert le plus récent : il donne
    # `ministere` et le titre du ministre. L'uid de l'organe départage deux mandats du même
    # jour : sans lui, le choix suivrait l'ordre du dump, et l'empreinte de la ligne
    # changerait d'une nuit à l'autre. Aucun cas au 2026-10-28.
    _ministere_ouvert: tuple[str, str, str | None] = ("", "", None)
    # Début le plus ancien, chambre par chambre : mandats ASSEMBLEE de la 17e législature,
    # mandats SENAT ouverts depuis la borne. Séparés pour qu'un élu passé d'une chambre à
    # l'autre ne reprenne pas la date de son ancien mandat, voir leur usage après la boucle.
    _earliest_an_debut = None
    _earliest_sn_debut = None
    _assemblee_17_periods = []  # périodes effectives AN 17e législature
    _senat_periods = []  # périodes SENAT encore ouvertes au 2023-10-02, voir leur usage après la boucle
    _dernier_lieu = {}  # chambre -> (dateFin, lieu) du mandat terminé le plus récent portant un lieu

    # Jamais député et sénateur à la fois : si un mandat ASSEMBLEE et un mandat SENAT sont
    # ouverts ensemble, le plus récent l'emporte, l'autre étant un mandat que la source
    # n'a pas encore clos (un élu qui change de chambre), et il est lu comme terminé.
    # Tout l'aval décide de la chambre actuelle sur les deux drapeaux, à sept endroits
    # (la vue, `recalc_nb_prises_parole()` et cinq scripts), et pas tous dans le même
    # ordre : deux drapeaux vrais auraient classé l'élu député dans la vue tout en lui
    # retirant ses compteurs de l'Assemblée ailleurs. Décidé avant la boucle pour que
    # département, circonscription et date de début viennent du mandat retenu. Aucun
    # cas le 2026-10-15.
    _debuts_ouverts: dict[str, str] = {}
    for mandat in all_mandats:
        if mandat.get("dateFin") is None and mandat.get("typeOrgane") in ("ASSEMBLEE", "SENAT"):
            chambre = mandat["typeOrgane"]
            _debuts_ouverts[chambre] = max(_debuts_ouverts.get(chambre, ""), mandat.get("dateDebut") or "")
    _chambre_ecartee = None
    if len(_debuts_ouverts) == 2:
        _chambre_ecartee = "ASSEMBLEE" if _debuts_ouverts["SENAT"] > _debuts_ouverts["ASSEMBLEE"] else "SENAT"

    for mandat in all_mandats:
        type_organe = mandat.get("typeOrgane")
        date_fin = mandat.get("dateFin")
        lib_qualite = str((mandat.get("infosQualite") or {}).get("libQualite") or "").lower()

        # 1. roles_text → tous les mandats (historiques + actifs)
        if type_organe == "ASSEMBLEE":
            roles_set.add("Député")
            d = mandat.get("dateDebut") or ""
            # Suivre toutes les périodes ASSEMBLEE de la 17e législature (>= 2024-06-01)
            # On utilise datePriseFonction (date effective de prise de fonction) si disponible,
            # car un député ne peut pas voter avant cette date (ex : suppléant en cours d'installation).
            if d >= "2024-06-01":
                mandature_inner = mandat.get("mandature") or {}
                dpf = mandature_inner.get("datePriseFonction")
                effective_debut = dpf or d
                _assemblee_17_periods.append((effective_debut, date_fin))
                if _earliest_an_debut is None or effective_debut < _earliest_an_debut:
                    _earliest_an_debut = effective_debut
            # Suivre le mandat ASSEMBLEE inactif le plus récent (fallback pour anciens députés)
            if date_fin is not None:
                if _best_inactive_assemblee is None or d > (_best_inactive_assemblee[0] or ""):
                    _best_inactive_assemblee = (mandat.get("dateDebut"), date_fin)
        elif type_organe == "SENAT":
            roles_set.add("Sénateur")
            d = mandat.get("dateDebut") or ""
            # Toute période SENAT encore ouverte à la borne compte, quelle que soit la date
            # de son début : c'est la fin qui décide, la vue rognant déjà le début à la
            # borne. Filtrer sur le début oubliait le mandat d'avant 2023 d'un sénateur
            # dont le siège a été réenregistré ensuite (retour du Gouvernement) : au
            # 2026-09-14, une sénatrice élue avant 2023 (PA703510) n'avait qu'une période
            # ouverte le 2025-01-24, soit 598 jours actifs, alors que toute son activité
            # depuis 2023 restait comptée : ses taux journaliers étaient gonflés d'autant.
            # Même logique que pour les députés : datePriseFonction si dispo, sinon dateDebut.
            if date_fin is None or date_fin >= SENAT_DERNIERE_ELECTION:
                mandature_inner = mandat.get("mandature") or {}
                dpf = mandature_inner.get("datePriseFonction")
                effective_debut = dpf or d
                _senat_periods.append((effective_debut, date_fin))
                # `date_debut_mandat` ne suit que les mandats ouverts depuis la borne, comme
                # avant l'élargissement ci-dessus : l'étendre aux mandats antérieurs
                # changerait la date de début de mandat affichée sur la fiche et lue par
                # d'autres scripts, ce que ce correctif ne vise pas.
                if d >= SENAT_DERNIERE_ELECTION and (
                    _earliest_sn_debut is None or effective_debut < _earliest_sn_debut
                ):
                    _earliest_sn_debut = effective_debut
        elif type_organe == "MINISTERE":
            # Seul le mandat MINISTERE dit la fonction. Le mandat GOUVERNEMENT vaut
            # « membre » pour tous, secrétaires d'État compris : lu ici, il ajoutait
            # « Ministre » à 63 secrétaires d'État jamais ministres au 2026-10-28.
            # Aucun membre du Gouvernement n'a de mandat GOUVERNEMENT sans MINISTERE.
            if date_fin is None and lib_qualite != "en mission":
                cle = (mandat.get("dateDebut") or "", _organe_ref(mandat) or "")
                if cle > _ministere_ouvert[:2]:
                    _ministere_ouvert = (*cle, (mandat.get("infosQualite") or {}).get("libQualite"))
            if "secrétaire d'état" in lib_qualite or "secrétaire d'etat" in lib_qualite:
                roles_set.add("Secrétaire d'État")
            elif lib_qualite == "en mission":
                # L'AMO range sous MINISTERE les députés en mission temporaire auprès
                # d'un ministère : ils n'ont jamais été membres du Gouvernement. Au
                # 2026-10-28, 242 acteurs n'avaient que ce mandat-là et s'affichaient
                # « Ministre », dont 53 députés en exercice (Florent Boudié, PA606507).
                pass
            elif "haut-commissaire" in lib_qualite:
                # Membre du Gouvernement sans être ministre (Martin Hirsch, Jean-Paul
                # Delevoye) : la fiche le compte au Gouvernement (`roleQuitte`).
                roles_set.add("Haut-commissaire")
            else:
                roles_set.add("Ministre")
        elif type_organe == "PRESREP" and date_fin is None:
            # Uniquement si le mandat est actif : un ancien président ne doit pas
            # garder ce libellé indéfiniment (contrairement aux autres rôles ci-dessus,
            # qui restent affichés même après la fin du mandat).
            roles_set.add("Président de la République")

        if type_organe in ("ASSEMBLEE", "SENAT") and date_fin is not None:
            lieu_termine = (mandat.get("election") or {}).get("lieu") or {}
            if lieu_termine.get("numDepartement") and date_fin > _dernier_lieu.get(type_organe, ("", None))[0]:
                _dernier_lieu[type_organe] = (date_fin, lieu_termine)

        # 2. Mandats actifs uniquement (dateFin == None), hors chambre écartée ci-dessus
        if date_fin is None and type_organe != _chambre_ecartee:
            if type_organe == "ASSEMBLEE":
                est_depute_actuel = True
            elif type_organe == "SENAT":
                est_senateur_actuel = True
            elif type_organe == "GOUVERNEMENT":
                # C'est le rattachement à un gouvernement en fonction qui fait le
                # ministre, jamais le libellé de qualité : il vaut « membre » pour les
                # 36 membres de Lecornu II, y compris le Premier ministre. Le mandat
                # MINISTERE ne décide plus rien ici, il porte aussi les députés « en
                # mission » ; il continue d'alimenter `roles_text` plus haut.
                #
                # La vérification que le gouvernement est ouvert est indispensable :
                # l'AN ne clôt pas les mandats individuels quand un gouvernement tombe.
                # Six mandats du gouvernement Bayrou, clos le 2025-09-09, étaient
                # encore actifs au 2026-09-09.
                organe_ref = (mandat.get("organes") or {}).get("organeRef")
                if organe_ref in gouvernements_ouverts:
                    est_ministre_actuel = True

            # Groupe politique actif (GP ou GROUPESENAT uniquement — jamais GOUVERNEMENT)
            if type_organe in ["GP", "GROUPESENAT"] and groupe_organe_ref is None:
                groupe_organe_ref = (mandat.get("organes") or {}).get("organeRef")

            # Organes refs (tous mandats actifs)
            organes = mandat.get("organes") or {}
            if isinstance(organes, dict):
                organe_ref = organes.get("organeRef")
                if isinstance(organe_ref, str):
                    organes_refs_set.add(organe_ref)
                elif isinstance(organe_ref, list):
                    for ref in organe_ref:
                        if isinstance(ref, str):
                            organes_refs_set.add(ref)
            elif isinstance(organes, list):
                for org in organes:
                    if isinstance(org, str):
                        organes_refs_set.add(org)
                    elif isinstance(org, dict) and org.get("organeRef"):
                        organes_refs_set.add(org["organeRef"])

            # Département/circo d'élection (mandat ASSEMBLEE ou SENAT actif)
            if type_organe in ["ASSEMBLEE", "SENAT"] and departement_election is None:
                lieu = (mandat.get("election") or {}).get("lieu") or {}
                departement_nom = lieu.get("departement")
                num_dep = lieu.get("numDepartement")
                if departement_nom:
                    departement_election = departement_nom
                elif num_dep and num_dep in DEPARTEMENTS_MAP:
                    departement_election = DEPARTEMENTS_MAP[num_dep]
                num_departement = num_dep
                num_circo = lieu.get("numCirco")
                cause_mandat = (mandat.get("election") or {}).get("causeMandat")
                # Nouvelles colonnes depuis mandature
                mandature = mandat.get("mandature") or {}
                date_debut_mandat = mandature.get("datePriseFonction") or mandat.get("dateDebut")
                place_hemicycle = mandature.get("placeHemicycle")
                prem_elec = mandature.get("premiereElection")
                premiere_election = (prem_elec == "1") if prem_elec in ["0", "1"] else None

            # Qualité actuelle (titre exact du poste) : celle du siège est gardée ici, celle
            # du ministre vient de `_ministere_ouvert`, et le choix se fait après la boucle,
            # quand `est_ministre_actuel` est connu.
            if type_organe in ["ASSEMBLEE", "SENAT"] and _qualite_chambre is None:
                raw_qualite = (mandat.get("infosQualite") or {}).get("libQualite")
                if raw_qualite:
                    _qualite_chambre = raw_qualite

    # Siège repris au retour du Gouvernement : l'AMO rouvre alors un mandat sans lieu
    # d'élection. Au 2026-09-15, trois sénateurs en exercice (Mayotte, Paris, Yvelines)
    # n'avaient aucun mandat actif portant un lieu, et leur code de département restait
    # vide : la carte de représentativité et la recherche par circonscription, qui ne
    # lisent que le code, les rangeaient parmi les Français de l'étranger, et Mayotte
    # comptait 3 parlementaires sur 4. Le siège est le même que celui du dernier mandat
    # terminé dans la chambre, dont le lieu est repris ici, pour les députés comme pour
    # les sénateurs.
    if departement_election is None and num_departement is None:
        chambre = "SENAT" if est_senateur_actuel else "ASSEMBLEE" if est_depute_actuel else None
        if chambre in _dernier_lieu:
            lieu = _dernier_lieu[chambre][1]
            num_departement = lieu.get("numDepartement")
            departement_election = lieu.get("departement") or DEPARTEMENTS_MAP.get(num_departement)
            num_circo = num_circo or lieu.get("numCirco")

    # Début le plus ancien de la chambre, lu par le seul repli ci-dessous. Un élu en
    # exercice ne garde que celui de sa chambre actuelle : le 2026-10-15, neuf sénateurs
    # élus le 1er octobre 2026 étaient députés jusqu'à la veille, et la date commune les
    # faisait « en fonction depuis » juillet 2024. Un élu qui ne siège plus garde le début
    # le plus ancien des deux chambres.
    if est_depute_actuel:
        _earliest_chambre_debut = _earliest_an_debut
    elif est_senateur_actuel:
        _earliest_chambre_debut = _earliest_sn_debut
    else:
        debuts_connus = [d for d in (_earliest_an_debut, _earliest_sn_debut) if d]
        _earliest_chambre_debut = min(debuts_connus) if debuts_connus else None

    # Si aucun mandat ASSEMBLEE actif n'a fourni date_debut_mandat,
    # utiliser le plus récent mandat ASSEMBLEE terminé comme fallback
    # (ex: député inactif, ancien ministre sans retour)
    if date_debut_mandat is None and _best_inactive_assemblee is not None:
        date_debut_mandat = _earliest_chambre_debut or _best_inactive_assemblee[0]
        date_fin_mandat = _best_inactive_assemblee[1]

    # Périodes effectives de mandat dans la chambre actuelle (multi-périodes pour ex-ministres)
    # — AN 17e législature (>= 2024-06-01) ou SN (fin nulle ou >= 2023-10-02).
    # Le nom de colonne « periodes_mandat_assemblee » est conservé (assemblée au sens large) pour limiter le diff.
    #
    # Un élu en exercice ne reçoit que les périodes de sa chambre actuelle.
    # Un député ne reçoit pas ses périodes SENAT : la vue les rognerait au
    # 2024-07-18, début de sa fenêtre à lui, et un mandat de sénateur clos avant cette date
    # donnerait un intervalle dont le début dépasse la fin, que Postgres refuse de
    # construire, ce qui fait échouer le rafraîchissement de la vue pour tous les élus.
    # Clos après, il compterait des jours de sénateur comme jours de député. Le cas
    # existe : un député en exercice au 2026-09-14 a aussi été sénateur.
    # Un sénateur ne reçoit pas ses périodes ASSEMBLEE : celle d'un député élu sénateur
    # le 1er octobre 2026 finit la veille, et `fusionner_periodes` soudait les deux en une
    # seule période ouverte depuis juillet 2024, soit 830 jours actifs au lieu de 15 le 2026-10-15.
    # Un élu qui ne siège plus garde les deux, aucun score ne le lisant.
    if est_depute_actuel:
        periodes_chambre = _assemblee_17_periods
    elif est_senateur_actuel:
        periodes_chambre = _senat_periods
    else:
        periodes_chambre = _assemblee_17_periods + _senat_periods
    periodes_mandat_assemblee = None
    if periodes_chambre:
        periodes_mandat_assemblee = [
            {"debut": d, "fin": f} for d, f in fusionner_periodes(periodes_chambre)
        ]

    # Toutes ses périodes de député de la 17e, quelle que soit sa chambre actuelle :
    # `import_scrutins_cloud.py` y lit qui siégeait le jour d'un vote, ce que la colonne
    # ci-dessus ne dit plus pour un député élu sénateur. Son mandat de député que la source
    # n'a pas encore clos (`_chambre_ecartee`) s'arrête la veille de l'entrée au Sénat :
    # laissé ouvert, il le ferait compter absent de chaque scrutin de l'Assemblée suivant.
    periodes_an = _assemblee_17_periods
    if _chambre_ecartee == "ASSEMBLEE":
        veille_senat = (date.fromisoformat(_debuts_ouverts["SENAT"][:10]) - timedelta(days=1)).isoformat()
        periodes_an = [(d, f or veille_senat) for d, f in _assemblee_17_periods]
    periodes_depute_17 = [
        {"debut": d, "fin": f} for d, f in fusionner_periodes(periodes_an)
    ] or None

    # « En fonction depuis » : début de la présence continue en cours dans la chambre,
    # pour tous les élus en exercice. Un sénateur réélu a son mandat clos la veille du
    # renouvellement et le suivant rouvert le jour même, deux périodes que la fusion
    # soude en une : sans cette remontée, un sénateur élu en 2020 aurait lu « en fonction
    # depuis le 1er octobre 2026 », et une fiche dossier aurait dit qu'il n'était « pas
    # encore en fonction » lors de ses votes de 2025. Une vraie coupure (passage au
    # Gouvernement, siège perdu puis retrouvé) sépare les périodes, et la date reste celle
    # du retour. Remonter plutôt au tout premier début, comme le faisait une règle écrite
    # pour les ex-ministres, datait du 24 janvier 2025 un sénateur sorti en avril 2026 et
    # réélu en septembre (PA859244). Les scores n'en dépendent pas : ils lisent les
    # périodes, et la date seulement quand il n'y en a pas.
    if (est_depute_actuel or est_senateur_actuel) and date_debut_mandat and periodes_chambre:
        for debut, fin in fusionner_periodes(periodes_chambre):
            if debut < date_debut_mandat and (fin is None or date_debut_mandat <= fin):
                date_debut_mandat = debut
                break

    # « En exercice » veut dire député, sénateur ou membre d'un gouvernement en
    # fonction, rien d'autre. Vrai pour tout mandat ouvert, il retenait au 2026-10-28
    # 43 personnes qui n'étaient rien de cela : un parti politique (PARPOL) jamais clos
    # dans 27 cas, une délégation du Sénat, le Conseil constitutionnel, la Présidence,
    # et trois élus décédés. L'outil MCP `chercher_elu` et le bloc « plus consultés »
    # de /les-elus, qui ne filtrent que sur cette colonne, les donnaient pour élus.
    en_exercice = est_depute_actuel or est_senateur_actuel or est_ministre_actuel

    # Le portefeuille, lu par l'index de recherche des élus (la fiche, elle, le retrouve
    # dans `organes_refs`). Jusqu'au 2026-10-28, aucun script n'écrivait cette colonne :
    # remplie une fois, elle gardait l'état d'avant le remaniement de février 2026, avec
    # quatre ministres sans portefeuille, trois sur leur ancien ministère et onze
    # non-ministres qui en gardaient un. Un député « en mission » auprès d'un ministère
    # n'est pas membre du Gouvernement et n'en reçoit pas.
    ministere = (_ministere_ouvert[1] or None) if est_ministre_actuel else None

    # Le titre ministériel ne passe devant celui du siège que pour un membre d'un
    # gouvernement en fonction. Pris sur tout mandat ouvert, il donnait au 2026-10-29
    # « en mission » à douze députés, qui n'ont jamais été membres du Gouvernement (voir
    # la branche MINISTERE plus haut), au lieu de « membre », le titre d'un député. Il
    # aurait donné de même un titre de ministre à un ancien ministre dont l'AN n'a pas
    # clos le mandat d'un gouvernement tombé : aucun cas ce jour-là. Le titre vient du
    # mandat MINISTERE retenu pour `ministere`, jamais du mandat GOUVERNEMENT, qui vaut
    # « membre » pour tous : lu dans l'ordre du dump, l'un ou l'autre gagnait selon
    # l'ordre des mandats.
    if est_ministre_actuel and _ministere_ouvert[2]:
        qualite_actuelle = _ministere_ouvert[2]
    else:
        qualite_actuelle = _qualite_chambre

    # Construire roles_text avec priorité
    roles_text = None
    if roles_set:
        if "Président de la République" in roles_set:
            roles_text = "Président de la République"
        elif "Ministre" in roles_set:
            roles_text = "Ministre" + (
                ", " + ", ".join(sorted(roles_set - {"Ministre"}))
                if len(roles_set) > 1 else ""
            )
        elif "Sénateur" in roles_set:
            roles_text = "Sénateur" + (
                ", " + ", ".join(sorted(roles_set - {"Sénateur"}))
                if len(roles_set) > 1 else ""
            )
        elif "Député" in roles_set:
            roles_text = "Député" + (
                ", " + ", ".join(sorted(roles_set - {"Député"}))
                if len(roles_set) > 1 else ""
            )
        else:
            roles_text = ", ".join(sorted(roles_set))

    return {
        "roles_text": roles_text,
        "en_exercice": en_exercice,
        "est_depute_actuel": est_depute_actuel,
        "est_senateur_actuel": est_senateur_actuel,
        "est_ministre_actuel": est_ministre_actuel,
        "ministere": ministere,
        "groupe": groupe_organe_ref,
        # Trié : l'ordre d'un ensemble de chaînes change d'un processus Python à l'autre,
        # donc l'empreinte de la ligne changeait chaque nuit et ~1 000 acteurs étaient
        # réécrits sans raison.
        "organes_refs": sorted(organes_refs_set) if organes_refs_set else None,
        "departement_election": departement_election,
        "num_departement": num_departement,
        "num_circo": num_circo,
        "cause_mandat": cause_mandat,
        "qualite_actuelle": qualite_actuelle,
        "date_debut_mandat": date_debut_mandat,
        "date_fin_mandat": date_fin_mandat,
        "periodes_mandat_assemblee": periodes_mandat_assemblee,
        "periodes_depute_17": periodes_depute_17,
        "place_hemicycle": place_hemicycle,
        "premiere_election": premiere_election,
    }


# ===================================================================
# Fonctions de parsing principales
# ===================================================================

def _organe_ref(mandat: dict) -> str | None:
    """Premier `organeRef` d'un mandat : la source l'écrit en chaîne ou en liste."""
    ref = (mandat.get("organes") or {}).get("organeRef")
    return ref[0] if isinstance(ref, list) and ref else ref if isinstance(ref, str) else None


def organes_clos_du_zip(zip_ref: zipfile.ZipFile, json_files: list[str]) -> set[str]:
    """uid des organes que l'AMO30 dit clos (`viMoDe.dateFin`), lus avant les acteurs,
    que `importer_acteur` doit connaître tous : un organe ne se lit qu'une fois le ZIP
    parcouru. Lus dans le dump et non dans `organes`, qui n'aurait la fermeture d'un
    organe que la nuit suivante."""
    clos = set()
    for file_name in json_files:
        if not file_name.split("/")[-1].startswith("PO"):
            continue
        with zip_ref.open(file_name) as f:
            organe = (json.load(f) or {}).get("organe") or {}
        if (organe.get("viMoDe") or {}).get("dateFin") and organe.get("uid"):
            clos.add(organe["uid"])
    return clos


def importer_acteur(acteur_data, file_name, gouvernements_ouverts: set[str], dates_naissance_connues: dict[str, str], organes_clos: set[str]):
    """Parse un JSON acteur et retourne dict pour upsert.

    `organes_clos` (`organes_clos_du_zip`) écarte les mandats restés ouverts sur un
    organe fermé. `dates_naissance_connues` sert de repli quand le dump n'a pas la date : voir le
    commentaire au point d'usage. Pour un sénateur en exercice, les coordonnées que
    tient le Sénat ne sont pas dans le payload (`_colonnes_senat.py`) : il n'a donc pas
    les mêmes clés pour tous les acteurs, ce que `upsert_isole` respecte.
    """
    try:
        data = acteur_data["acteur"]

        # Mandats : actifs (dateFin=None) et porteurs de rôle toujours inclus, plus les
        # 25 autres historiques les plus récents
        # ⚠️ Ne PAS tronquer les actifs : un député peut avoir 30+ mandats plus récents
        # que son mandat ASSEMBLEE → [:25] global exclurait le mandat principal
        all_mandats_full = normalize_mandats(data)

        # Un mandat resté ouvert sur un organe que l'AMO30 dit clos est un mandat que
        # l'AN n'a jamais fermé : il ne compte nulle part. Au 2026-10-28, 9 cas : 7 du
        # gouvernement Bayrou (clos le 2025-09-09), qui laissaient François Bayrou et
        # Amélie de Montchalin « en exercice » dans la recherche et le MCP, celui de
        # François Hollande à la présidence depuis 2012, qui le faisait passer pour
        # Président en exercice, et une mission de Jean Besson. L'organe, et non un
        # doublon de date, est le bon critère : 76 mandats ouverts reprennent la date de
        # début d'un mandat clos sur le même organe et sont bien en cours (un député
        # revenu du Gouvernement garde la date de son élection, une présidente de groupe
        # redevient membre) ; les écarter retirait leur siège à 21 députés en exercice.
        active = [m for m in all_mandats_full if m.get("dateFin") is None
                  and _organe_ref(m) not in organes_clos]
        inactive = [m for m in all_mandats_full if m.get("dateFin") is not None]
        try:
            inactive.sort(key=lambda m: m.get("dateDebut") or "1900-01-01", reverse=True)
        except Exception:
            pass
        # Les mandats qui portent un rôle échappent au [:25] : ils sont souvent
        # anciens, donc relégués en fin du tri antichronologique, alors que ce sont
        # eux qui construisent `roles_text`. Sans cette exception, un ancien ministre
        # à 70 mandats voit ses deux lignes ministérielles tomber au-delà du 25e rang
        # et s'affiche « Député » tout court — c'était le cas de 10 députés au
        # 2026-09-06, dont un ancien Premier ministre. ASSEMBLEE en est aussi, toutes
        # législatures : les mandats de la 17e portent en plus les périodes de mandat
        # (un ex-ministre revenu perdait sinon son mandat d'origine, taux > 100 %), et
        # ceux d'avant 2024 tombaient à la troncature, ce qui retirait « Député » à 948
        # anciens députés au 2026-10-28. Le surcoût est nul, ces mandats se comptent
        # par unités là où les commissions et groupes d'amitié se comptent par
        # dizaines.
        types_porteurs = ("ASSEMBLEE", "MINISTERE", "GOUVERNEMENT", "SENAT", "PRESREP")
        porteurs_role = [m for m in inactive if m.get("typeOrgane") in types_porteurs]
        rest = [m for m in inactive if m.get("typeOrgane") not in types_porteurs]
        all_mandats = active + porteurs_role + rest[:25]

        adresse_list = parse_adresse_list(data, file_name)

        identity = extract_identity(data)
        birth = extract_birth_info(data, file_name)
        profession = extract_profession(data)
        urls = extract_social_urls(adresse_list)
        mandates = extract_mandate_info(all_mandats, file_name, gouvernements_ouverts)

        # L'AN ne publie pas la date de naissance des ministres venus de la société
        # civile : treize des trente-six membres du gouvernement en étaient dépourvus
        # au 2026-09-09, et leur date venait de Wikidata. Cet import l'écrasait chaque
        # nuit, l'enrichissement la reposait juste après. Ce dernier supprimé, la seule
        # chose à faire est de ne plus effacer : une valeur donnée par l'AN gagne
        # toujours, une absence ne détruit plus ce que la base sait déjà.
        if not birth["date_naissance"]:
            connue = dates_naissance_connues.get(identity.get("uid", ""))
            if connue:
                birth["date_naissance"] = connue
                birth["age"] = calculer_age(connue, file_name)

        # Présidences du Sénat, lues dans la liste complète plutôt que dans `all_mandats` :
        # elles ne dépendent ainsi pas des règles de troncature ci-dessus.
        mandates["periodes_president_senat"] = [
            {"debut": m.get("dateDebut"), "fin": m.get("dateFin")}
            for m in all_mandats_full
            if (m.get("typeOrgane") == "SENAT"
                and (m.get("infosQualite") or {}).get("codeQualite") == "Président"
                and (m.get("organes") or {}).get("organeRef") == "PO78718")
        ] or None

        # Assembler le payload (`upsert_si_change` l'envoie en JSON : dicts et listes deviennent du jsonb selon la colonne)
        # mandats en DB = actifs seulement (réduit la taille du payload, les champs clés sont extraits)
        uid = identity.get("uid", "")
        is_depute = mandates.get("est_depute_actuel", False)
        senat_url = next(
            (a.get("valElec") for a in (adresse_list or [])
             if a.get("typeLibelle") == "Url sénateur" and a.get("valElec")),
            None
        )
        url_profil_officiel = (
            f"https://www.assemblee-nationale.fr/dyn/deputes/{uid}" if is_depute
            else senat_url
        )

        data_insert = {
            **identity,
            **birth,
            **profession,
            **urls,
            **mandates,
            "adresses": adresse_list or None,
            "mandats": active or None,
            "url_profil_officiel": url_profil_officiel,
            # Lu dans la liste complète des mandats, et non dans `all_mandats`, tronquée à
            # 25 inactifs : les groupes clos en sont.
            "historique_groupes": historique_des_groupes(all_mandats_full),
        }

        # Le Sénat seul écrit ces colonnes pour ses élus en exercice. L'Assemblée garde
        # celles d'un ancien mandat de député (33 adresses `@assemblee-nationale.fr` et
        # 27 professions en désaccord au 2026-10-25), et sa réécriture les imposait
        # jusqu'au passage de `sync_senat.py`, plusieurs étapes plus tard, ou jusqu'à la
        # nuit suivante quand celui-ci échouait. Un ancien sénateur n'est plus suivi par
        # le Sénat : l'Assemblée continue de les lui écrire.
        if mandates.get("est_senateur_actuel"):
            for colonne in COLONNES_COORDONNEES_SENAT:
                data_insert.pop(colonne, None)

        return data_insert

    except Exception as e:
        tqdm.write(f"❌ Erreur générale pour {file_name}: {e}")
        traceback.print_exc()
        return None


# Couleur des groupes du Sénat par uid d'organe, l'Assemblée n'en publiant aucune pour eux.
COULEUR_PAR_ORGANE_SENAT = {
    GROUPES_SENAT_VERS_ORGANE[code]: couleur for code, couleur in COULEURS_GROUPES_SENAT.items()
}


def importer_organe(organe_data, file_name):
    """Parse un JSON organe et retourne dict pour upsert."""
    try:
        data = organe_data["organe"]

        uid = data.get("uid")
        code_type = data.get("codeType")
        libelle = data.get("libelle")
        libelle_edition = data.get("libelleEdition")
        libelle_abrege = data.get("libelleAbrege")
        # Si libelle_abrege est absent ou identique au libelle complet, générer un acronyme
        if libelle and (not libelle_abrege or libelle_abrege == libelle):
            libelle_abrege = "".join(w[0].upper() for w in libelle.split() if w)
        libelle_abrev = data.get("libelleAbrev")

        # Null safety : `or {}` gère le cas où la valeur est explicitement null
        vi_mode = data.get("viMoDe") or {}
        date_debut = vi_mode.get("dateDebut")
        date_agrement = vi_mode.get("dateAgrement")
        date_fin = vi_mode.get("dateFin")

        organe_parent = data.get("organeParent")
        chambre = data.get("chambre")
        regime = data.get("regime")
        legislature = data.get("legislature")

        secretariat = data.get("secretariat") or {}
        secretaire_01 = secretariat.get("secretaire01")
        secretaire_02 = secretariat.get("secretaire02")

        regime_juridique = data.get("regimeJuridique")
        site_internet = data.get("siteInternet")

        nombre_reunions_annuelles_raw = data.get("nombreReunionsAnnuelles")
        try:
            nombre_reunions_annuelles = int(nombre_reunions_annuelles_raw) if nombre_reunions_annuelles_raw else None
        except (ValueError, TypeError):
            nombre_reunions_annuelles = None

        preseance_raw = data.get("preseance")
        try:
            preseance = int(preseance_raw) if preseance_raw else None
        except (ValueError, TypeError):
            preseance = None

        organe_precedent_ref = data.get("organePrecedentRef")
        liste_pays = data.get("listePays")

        # GP (groupe politique) : couleur et position politique. L'Assemblée publie les
        # groupes du Sénat sans couleur : celle de senat.fr (`COULEURS_GROUPES_SENAT`)
        # comble le vide, sans quoi chaque réécriture de l'organe l'effacerait.
        couleur_associee = data.get("couleurAssociee") or COULEUR_PAR_ORGANE_SENAT.get(uid)
        position_politique = data.get("positionPolitique")

        # CIRCONSCRIPTION : numéro et lieu géographique
        numero = data.get("numero")
        lieu = data.get("lieu")

        data_insert = {
            "uid": uid,
            "code_type": code_type,
            "libelle": libelle,
            "libelle_edition": libelle_edition,
            "libelle_abrege": libelle_abrege,
            "libelle_abrev": libelle_abrev,
            "date_debut": date_debut,
            "date_agrement": date_agrement,
            "date_fin": date_fin,
            "organe_parent": organe_parent,
            "chambre": chambre,
            "regime": regime,
            "legislature": legislature,
            "secretaire_01": secretaire_01,
            "secretaire_02": secretaire_02,
            "regime_juridique": regime_juridique,
            "site_internet": site_internet,
            "nombre_reunions_annuelles": nombre_reunions_annuelles,
            "preseance": preseance,
            "organe_precedent_ref": organe_precedent_ref,
            "liste_pays": liste_pays,
            "couleur_associee": couleur_associee,
            "position_politique": position_politique,
            "numero": numero,
            "lieu": lieu,
        }
        return data_insert

    except Exception as e:
        tqdm.write(f"❌ Erreur générale pour {file_name}: {e}")
        traceback.print_exc()
        return None


# ===================================================================
# Import principal depuis ZIP
# ===================================================================
def ecrire_table(table_name: str, lignes: list[dict]) -> tuple[int, set[str]]:
    """Écrit `lignes` et rend `(lignes écrites, uid perdus)`.

    Passe par `upsert_si_change` : la base ne réécrit que les lignes nouvelles ou
    changées, le découpage en lots d'environ 1 Mo est le sien (les mandats JSONB des
    acteurs sont volumineux), et il coupe un lot rejeté pour isoler la ligne fautive.
    L'ancien envoi maison ne retentait que les dépassements de délai, et perdait des lots
    entiers de 300 acteurs sur une coupure TLS ou un « Broken pipe » (constaté le
    2026-10-08 sur des envois depuis un poste local). Une ligne perdue est retentée la
    nuit suivante.
    """
    ecrites, perdues = upsert_si_change(table_name, lignes, "uid", journal=tqdm.write)
    return ecrites, {p["uid"] for p in perdues}


def importer_acteurs_organes_from_zip(zip_ref: zipfile.ZipFile):
    """Importe acteurs et organes de l'AMO30 (voir `URL_AMO30`) : parsing instantané
    (RAM) puis upload par batch."""
    json_files = [
        f for f in zip_ref.namelist()
        if f.endswith(".json")
        and (f.split("/")[-1].startswith("PA") or f.split("/")[-1].startswith("PO"))
    ]

    print(f"\n{len(json_files)} fichiers trouvés dans le ZIP\n")
    acteurs_count = sum(1 for f in json_files if f.split("/")[-1].startswith("PA"))
    organes_count = sum(1 for f in json_files if f.split("/")[-1].startswith("PO"))
    print(f"   - Acteurs (PA*) : {acteurs_count}")
    print(f"   - Organes (PO*) : {organes_count}")

    # Un groupe ajouté à `GROUPES_SENAT_VERS_ORGANE` sans sa couleur resterait gris sans
    # que rien ne le dise. Les non-inscrits n'en ont volontairement pas.
    sans_couleur = sorted(set(GROUPES_SENAT_VERS_ORGANE) - set(COULEURS_GROUPES_SENAT) - {"NI"})
    if sans_couleur:
        print(f"   ⚠️ Groupes du Sénat sans couleur (à ajouter dans `COULEURS_GROUPES_SENAT`) : {', '.join(sans_couleur)}")

    # --- Contexte lu en base avant tout parsing ---
    # Les gouvernements encore en fonction décident seuls de `est_ministre_actuel`.
    # Une lecture vide (panne réseau, table pas encore importée) démettrait tous les
    # ministres en une nuit, alors qu'il y a toujours un gouvernement en fonction :
    # mieux vaut interrompre et laisser le bilan nocturne le signaler.
    with connexion() as conn:
        gouvernements_ouverts = {
            row["uid"] for row in lire(
                conn, "select uid from organes where code_type = 'GOUVERNEMENT' and date_fin is null"
            )
        }
        if not gouvernements_ouverts:
            raise RuntimeError("Aucun gouvernement ouvert dans `organes` : import interrompu.")

        # Dates de naissance déjà connues, pour ne jamais les effacer (voir `importer_acteur`).
        dates_naissance_connues: dict[str, str] = {
            r["uid"]: r["date_naissance"] for r in lire(
                conn, "select uid, date_naissance from acteurs where date_naissance is not null"
            )
        }

    organes_clos = organes_clos_du_zip(zip_ref, json_files)

    print(
        f"   - {len(gouvernements_ouverts)} gouvernement(s) en fonction, "
        f"{len(dates_naissance_connues)} dates de naissance connues, "
        f"{len(organes_clos)} organes clos"
    )

    # --- 1. Parsing (quasi-instantané : tout est en RAM) ---
    acteurs_payloads: list = []
    organes_payloads: list = []
    failed_parse_acteurs = 0
    failed_parse_organes = 0

    for file_name in tqdm(json_files, desc="Parsing fichiers", unit="fichier"):
        try:
            with zip_ref.open(file_name) as f:
                data = json.load(f)
            base_name = file_name.split("/")[-1]
            if base_name.startswith("PA"):
                payload = importer_acteur(
                    data, base_name, gouvernements_ouverts, dates_naissance_connues, organes_clos
                )
                if payload:
                    acteurs_payloads.append(payload)
                else:
                    failed_parse_acteurs += 1
            elif base_name.startswith("PO"):
                payload = importer_organe(data, base_name)
                if payload:
                    organes_payloads.append(payload)
                else:
                    failed_parse_organes += 1
        except Exception as e:
            base_name = file_name.split("/")[-1]
            if base_name.startswith("PA"):
                failed_parse_acteurs += 1
            else:
                failed_parse_organes += 1
            tqdm.write(f"❌ Erreur fichier {file_name}: {e}")

    # --- 2. Upload : toutes les lignes partent, la base écarte les inchangées ---
    ecrites_acteurs, acteurs_perdus = ecrire_table("acteurs", acteurs_payloads)
    ecrites_organes, organes_perdus = ecrire_table("organes", organes_payloads)
    skipped_acteurs = len(acteurs_payloads) - ecrites_acteurs - len(acteurs_perdus)
    skipped_organes = len(organes_payloads) - ecrites_organes - len(organes_perdus)
    failed_acteurs = failed_parse_acteurs + len(acteurs_perdus)
    failed_organes = failed_parse_organes + len(organes_perdus)

    print(f"\n{'='*60}")
    print(f"IMPORT ACTEURS/ORGANES TERMINÉ")
    print(f"   Acteurs succès     : {ecrites_acteurs}")
    print(f"   Acteurs inchangés  : {skipped_acteurs}")
    print(f"   Acteurs échecs     : {failed_acteurs}")
    print(f"   Organes succès     : {ecrites_organes}")
    print(f"   Organes inchangés  : {skipped_organes}")
    print(f"   Organes échecs     : {failed_organes}")
    print(f"{'='*60}")


def completer_matricules_senat() -> int:
    """Remplit `acteurs.matricule_senat` depuis l'adresse « Url sénateur », et rend le
    nombre de fiches écrites.

    `sync_senat.py` n'écrit cette colonne que pour les sénateurs en exercice, qu'il
    rapproche par leur nom. Les sénateurs partis avant sa création (2026-04-15) n'en
    avaient jamais reçu : 629 fiches le 2026-10-15, dont environ 8 800 prises de parole
    au Sénat ne menaient à aucune fiche. L'adresse vient de l'open data de l'Assemblée,
    qui liste tous les sénateurs, anciens compris, et le matricule en est la fin
    (`…/ramia_salama21422j.html`). Sur les 421 fiches qui en avaient déjà un, aucun
    écart avec l'adresse.

    Ne touche que les valeurs vides : ce que `sync_senat.py` a écrit reste. Écarte un
    matricule déjà porté par une autre fiche, qui rendrait ambigus tous les
    rapprochements par matricule (débats, amendements, présences). Appelée après les
    ZIP, même inchangés, et première étape du cron : toutes les suivantes voient la
    colonne remplie.

    Les doublons se cherchent aussi parmi les candidats eux-mêmes, dans `uniques` :
    le `not exists` final ne voit la table que telle qu'avant la requête, et laisserait
    deux fiches vides recevoir le même matricule dans la même passe. Une fiche dont les
    adresses donnent deux matricules différents est écartée de même, `update … from`
    retenant alors une ligne au hasard.
    """
    with connexion() as conn:
        cur = conn.execute(
            r"""
            with candidats as (
                select distinct uid,
                       upper((regexp_match(e->>'valElec', '(\d{5}[0-9a-z])\.html$', 'i'))[1]) as matricule
                  from acteurs, jsonb_array_elements(adresses) e
                 where matricule_senat is null
                   and jsonb_typeof(adresses) = 'array'
                   and e->>'typeLibelle' = 'Url sénateur'
            ),
            uniques as (
                select c.uid, c.matricule
                  from candidats c
                 where c.matricule is not null
                   and not exists (
                       select 1 from candidats d
                        where d.matricule is not null
                          and ((d.uid = c.uid and d.matricule <> c.matricule)
                               or (d.uid <> c.uid and d.matricule = c.matricule))
                   )
            )
            update acteurs a
               set matricule_senat = s.matricule
              from uniques s
             where a.uid = s.uid
               and not exists (select 1 from acteurs b where b.matricule_senat = s.matricule)
            """
        )
        return cur.rowcount


# Seul l'AMO30 est importé : il porte tous les acteurs, anciens élus compris (D-234),
# avec tous leurs mandats et tous leurs groupes. Deux autres fichiers de l'Assemblée
# passaient avant et après lui, sans raison écrite, et n'apportaient rien. Mesuré le
# 2026-10-25 :
# - l'AMO20 (législature en cours) n'avait aucun acteur ni organe absent de l'AMO30.
#   Ne connaissant que les mandats de la législature, importé en dernier, il tronquait
#   chaque nuit 78 fiches : 76 `roles_text` (« Ministre » pour un ancien député et
#   secrétaire d'État), donc D-239 inopérant pour 10 élus passés d'une chambre à
#   l'autre, des dates de mandat effacées, des présidences du Sénat perdues. Plus tôt, il
#   effaçait aussi les groupes anciens de `historique_groupes`.
# - l'AMO50 (format « divisé ») n'est plus mis à jour depuis le 2024-07-11. Ses mandats
#   sont dans des fichiers à part que cet import ne lit pas : relu, il écrivait les
#   577 députés sans mandat, donc hors exercice et sans groupe.
URL_AMO30 = "https://data.assemblee-nationale.fr/static/openData/repository/17/amo/tous_acteurs_mandats_organes_xi_legislature/AMO30_tous_acteurs_tous_mandats_tous_organes_historique.json.zip"


# Exécution
if __name__ == "__main__":
    zip_en_echec = False
    try:
        zip_ref = download_zip_if_modified(URL_AMO30)
        importer_acteurs_organes_from_zip(zip_ref)
        confirmer_import(URL_AMO30)
    except NotModified:
        print(f"ZIP inchangé pour {URL_AMO30} — on passe.\n")
    except Exception as e:
        print(f"❌ Erreur pour URL {URL_AMO30}: {e}")
        traceback.print_exc()
        zip_en_echec = True

    # Même après un ZIP inchangé ou en échec : les adresses sont déjà en base, et les
    # fiches qui n'ont pas encore de matricule restent à compléter.
    matricules_en_echec = False
    try:
        print(f"Matricules du Sénat complétés : {completer_matricules_senat()}")
    except Exception as e:
        print(f"❌ Erreur en complétant les matricules du Sénat : {e}")
        matricules_en_echec = True
    print("\nTout est terminé !")

    # Ces `except` avalaient tout et le script sortait toujours en 0. C'est le
    # premier et le plus gros import du cron : si le ZIP échouait, l'étape
    # passait pour verte, la date de fraîcheur s'inscrivait, et tout l'aval (stats de
    # vote, score d'activité, fiches élu) restait sur les acteurs de la veille.
    #
    # Ce sont des exceptions sur un ZIP entier, donc du passager : on bloque, pour
    # retenter la nuit suivante. Pas d'anomalie ici, qui est réservée au durable.
    if zip_en_echec or matricules_en_echec:
        sys.exit(1)
