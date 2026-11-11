"""
import_elections.py
Importe les résultats des élections qui ont donné leur siège aux parlementaires, et
rattache chaque parlementaire à la sienne, pour le bloc élection de la fiche élu
(D-298, D-289).

Trois élections générales seulement : législatives 2024, sénatoriales 2023 et 2026.
Source : fichiers du ministère de l'Intérieur sur data.gouv.fr (Licence Ouverte 2.0).
Les dumps de l'Assemblée et du Sénat ne publient aucun résultat électoral.

Deux passes, deux rythmes :
- `--resultats` télécharge les fichiers et écrit `election_resultats`. À la main, une
  fois par élection : les résultats d'un scrutin passé ne bougent plus.
- sans argument, la passe de nuit (étape `elections` de `nightly.py`) recalcule
  `election_elus` depuis la base seule, sans rien télécharger : qui siège change (un
  suppléant entre, un suivant de liste remplace un sénateur devenu ministre), les
  résultats non.

Le ministère n'a pas les identifiants de l'Assemblée : le pont est l'état civil (nom et
prénom), départagé par la circonscription. Une faute du ministère se corrige dans
`corrections_elections.json`, à la lecture des fichiers. Un élu ambigu ou introuvable
n'a pas de ligne, et son nom va au journal : mieux vaut une fiche sans élection qu'une
élection attribuée à la mauvaise personne.

Alimente : election_resultats (--resultats), election_elus (sans argument)

Usage :
  python import_elections.py --resultats [--election SEN2026]
  python import_elections.py
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import signaler_anomalie  # noqa: E402
from _db import connexion  # noqa: E402
# Reprise après coupure et durée bornée, partagées par tous les imports qui téléchargent.
from _telechargement import telecharger  # noqa: E402

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# ── Configuration ─────────────────────────────────────────────────────────────

# URLs figées, et non résolues par l'API comme dans `import_rne.py` : ces fichiers ne
# changent plus après la proclamation, et un jeu de données qui en publierait un autre
# (rectificatif) mérite d'être relu à la main avant de remplacer des résultats affichés.
_STATIC = "https://static.data.gouv.fr/resources"
SOURCES = {
    "LEG2024": {
        "resultats": {
            1: f"{_STATIC}/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/20240710-171413/resultats-definitifs-par-circonscriptions-legislatives.csv",
            2: f"{_STATIC}/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour/20240710-170728/resultats-definitifs-par-circonscription.csv",
        },
        "dates": {1: "2024-06-30", 2: "2024-07-07"},
        "date_donnee": "2024-07-10",
    },
    "SEN2023": {
        # Un seul classeur : feuilles `MAJ - T1`, `MAJ - T2`, `PROP`, `Liste des élus`.
        # Le ministère ne publie 2023 qu'en xlsx.
        "resultats": f"{_STATIC}/elections-senatoriales-2023-resultats/20230928-104908/senatoriales-2023-resultats-publication.xlsx",
        "candidatures": f"{_STATIC}/elections-senatoriales-2023-candidatures-t1/20230918-172919/senatoriales-2023-candidatures-18-09-23-publication.xlsx",
        "date": "2023-09-24",
        "date_donnee": "2023-09-28",
    },
    "SEN2026": {
        "resultats": {
            # Le 1ᵉʳ tour mêle les départements au scrutin majoritaire et ceux au scrutin
            # de liste, dans les mêmes colonnes.
            1: f"{_STATIC}/elections-senatoriales-2026-resultats/20260927-235109/senatoriales-2026-resultats-t1-scrutin-majoritaire-et-scrutin-proportionnel.csv",
            2: f"{_STATIC}/elections-senatoriales-2026-resultats/20260927-235109/senatoriales-2026-resultats-t2-scrutin-majoritaire.csv",
        },
        "elus": f"{_STATIC}/elections-senatoriales-2026-resultats/20260927-235109/senatoriales-2026-candidats-elus.csv",
        "candidatures": f"{_STATIC}/elections-senatoriales-2026-candidatures-aux-scrutins-majoritaire-tour-1-et-proportionnel/20260918-152435/senatoriales-2026-candidatures-listes-scrutin-proportionnel.csv",
        "date": "2026-09-27",
        "date_donnee": "2026-09-27",
    },
}

# Sièges pourvus par élection. Un fichier tronqué ou un format qui a changé se voit là
# avant d'écrire quoi que ce soit : 577 circonscriptions, et les deux séries du Sénat
# (170 + 178 = 348 sièges).
SIEGES_ATTENDUS = {"LEG2024": 577, "SEN2023": 170, "SEN2026": 178}

# Codes du ministère qui diffèrent de ceux de l'Assemblée (`numDepartement` des
# mandats) : Français établis hors de France, et Saint-Barthélemy et Saint-Martin, qui
# forment une seule circonscription législative.
DEPARTEMENT_AN_VERS_MINISTERE = {"099": "ZZ", "977": "ZX", "978": "ZX"}

# Même pont pour les sénateurs (`acteurs.num_departement`) : ceux des Français établis
# hors de France portent `997` ou `998` (constaté en base le 2026-10-27), le ministère
# `ZZ`. Saint-Barthélemy et Saint-Martin ont chacun leur sénateur et gardent leur code.
DEPARTEMENT_SENAT_VERS_MINISTERE = {"997": "ZZ", "998": "ZZ"}

# Les fautes du ministère dans un nom ou un prénom (« Chistine » Bost). Dans le dépôt,
# comme `corrections_rne.json` : chaque correction y garde sa source et son historique.
CORRECTIONS = Path(__file__).resolve().parent / "corrections_elections.json"

# Garde-fous de la passe de nuit.
SEUIL_RATTACHES = 0.9
SEUIL_SUPPRESSIONS = 0.2

# Taille visée d'un lot d'écriture (CLAUDE.md : environ 1 Mo par requête).
TAILLE_LOT = 1_000_000


# ── Utilitaires ───────────────────────────────────────────────────────────────


def _normalize_name(s: str | None) -> str:
    """Normalise un nom pour le rapprochement : sans accents, sans ponctuation, en
    majuscules, comme `import_rne.py`. Le ministère écrit « MAÎTRE », l'Assemblée
    « Maître » ; les traits d'union et les espaces tombent aussi."""
    if not s:
        return ""
    n = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    return "".join(c for c in n.upper() if c.isalpha())


def _slug(s: str) -> str:
    """Identifiant stable d'une entrée (`breton-xavier`), le même aux deux tours."""
    n = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", "-", n).strip("-")


# Particules gardées en minuscules dans un nom de famille (« Charles de Courson »).
# « Le », « La », « Da » restent en capitale : ils font partie du nom (« Le Pen »).
PARTICULES = {"de", "du", "des", "von", "van", "der", "den"}


def _casse_nom(nom: str) -> str:
    """« MAÎTRE » → « Maître », « GLOANEC MAURIN » → « Gloanec Maurin ».

    Le ministère écrit les noms de famille en capitales ; la fiche les affiche après le
    prénom, comme le reste du site. Chaque morceau entre espaces, traits d'union et
    apostrophes prend une capitale, sauf une particule suivie d'un autre mot et le
    « d' » élidé (« d'Artagnan »).
    """
    mots = nom.strip().lower().split()
    sortie = []
    for i, mot in enumerate(mots):
        if mot in PARTICULES and i < len(mots) - 1:
            sortie.append(mot)
            continue
        morceaux = re.split(r"([-'’])", mot)
        rendu = []
        for j, m in enumerate(morceaux):
            if j == 0 and m == "d" and len(morceaux) > 2 and morceaux[1] in "'’":
                rendu.append(m)
            else:
                rendu.append(m[:1].upper() + m[1:])
        sortie.append("".join(rendu))
    return " ".join(sortie)


def _code_departement(brut: object) -> str:
    """Code de département sur deux chiffres au moins (`1` → `01`), lettres en capitales.

    Le 1ᵉʳ tour des législatives écrit `1`, le 2ᵈ `01` ; le classeur de 2023 rend un
    nombre (`39`).
    """
    s = str(brut or "").strip().upper()
    if s.endswith(".0"):
        s = s[:-2]
    return s.zfill(2) if s.isdigit() else s


def _entier(brut: object, ou: str) -> int:
    """Un nombre du fichier, sans séparateur de milliers. Vide ou illisible : lève."""
    s = str(brut or "").strip().replace(" ", "").replace(" ", "").replace("\xa0", "")
    if s.endswith(".0"):
        s = s[:-2]
    if not s.isdigit():
        raise ValueError(f"Nombre illisible {brut!r} ({ou})")
    return int(s)


def _sexe(brut: object) -> str | None:
    """`MASCULIN`, `M` → `M` ; `FEMININ`, `F` → `F`."""
    s = str(brut or "").strip().upper()
    return s[:1] if s[:1] in ("F", "M") else None


def _texte_jsonb(v: object) -> str:
    """Le texte que Postgres rend pour un `jsonb`, pour comparer une empreinte.

    `jsonb` trie les clés d'un objet par longueur puis par octets, et sépare par
    `", "` et `": "`. Reproduire ce rendu ici permet de lire en base une empreinte
    (`md5(…::text)`) et de n'envoyer que les lignes qui changent. Une divergence ne
    casse rien : la ligne serait renvoyée et `IS DISTINCT FROM` ne l'écrirait pas. La
    seconde passe à 0 ligne envoyée en est la preuve.
    """
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ", ".join(_texte_jsonb(x) for x in v) + "]"
    if isinstance(v, dict):
        cles = sorted(v, key=lambda k: (len(k.encode("utf-8")), k.encode("utf-8")))
        return "{" + ", ".join(f"{json.dumps(k, ensure_ascii=False)}: {_texte_jsonb(v[k])}" for k in cles) + "}"
    raise TypeError(f"Type inattendu dans un jsonb : {type(v).__name__}")


# ── Lecture des fichiers ──────────────────────────────────────────────────────


def lire_csv(contenu: bytes) -> list[list[str]]:
    """Un CSV du ministère : UTF-8, séparateur `;`."""
    return list(csv.reader(io.StringIO(contenu.decode("utf-8-sig")), delimiter=";"))


_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _index_colonne(reference: str) -> int:
    """`A1` → 0, `AB12` → 27."""
    n = 0
    for c in reference:
        if not c.isalpha():
            break
        n = n * 26 + ord(c.upper()) - 64
    return n - 1


def lire_xlsx(contenu: bytes) -> dict[str, list[list[str]]]:
    """Les feuilles d'un classeur, en lignes de texte : {nom de feuille: lignes}.

    Lecteur minimal, sans dépendance (choix d'Alex du 2026-10-28) : un .xlsx est un zip
    de XML. Il ne sait lire que ce que publient les deux classeurs de 2023 : cellules
    texte (partagées ou en ligne) et nombres. Une date sort en numéro de série Excel,
    ce qui ne gêne pas, aucune n'étant lue. Les cellules vides en fin de ligne ne sont
    pas écrites dans le XML : chaque ligne est complétée à la largeur de l'en-tête (la
    première ligne), et une ligne plus large reste plus large, pour que `lire_blocs` la
    refuse.
    """
    with zipfile.ZipFile(io.BytesIO(contenu)) as z:
        partages: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).iter(f"{_NS}si"):
                # Le texte enrichi découpe une chaîne en plusieurs `<t>` ; les `<rPh>`
                # (lecture phonétique) n'en sont pas.
                partages.append("".join(t.text or "" for r in si if r.tag != f"{_NS}rPh" for t in r.iter(f"{_NS}t")))
        cibles = {l.get("Id"): l.get("Target") for l in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
        feuilles: dict[str, list[list[str]]] = {}
        for f in ET.fromstring(z.read("xl/workbook.xml")).iter(f"{_NS}sheet"):
            cible = cibles[f.get(f"{_NS_REL}id")] or ""
            chemin = cible.lstrip("/") if cible.startswith("/") else "xl/" + cible
            lignes = []
            for row in ET.fromstring(z.read(chemin)).iter(f"{_NS}row"):
                cellules: dict[int, str] = {}
                for c in row.iter(f"{_NS}c"):
                    v = c.find(f"{_NS}v")
                    if c.get("t") == "s":
                        valeur = partages[int(v.text)] if v is not None and v.text else ""
                    elif c.get("t") == "inlineStr":
                        valeur = "".join(t.text or "" for t in c.iter(f"{_NS}t"))
                    else:
                        valeur = v.text if v is not None and v.text else ""
                    cellules[_index_colonne(c.get("r") or "")] = valeur
                ligne = [""] * (max(cellules) + 1 if cellules else 0)
                for i, valeur in cellules.items():
                    ligne[i] = valeur
                lignes.append(ligne)
            largeur = len(lignes[0]) if lignes else 0
            feuilles[f.get("name") or ""] = [l + [""] * (largeur - len(l)) for l in lignes]
    return feuilles


def decouper_blocs(entete: list[str], premier: str) -> tuple[int, list[str]]:
    """Début et champs des blocs répétés d'un en-tête (« Voix 1 », « Voix 2 »…).

    Les fichiers posent un bloc de 8, 9 ou 12 colonnes par candidat ou par liste. On
    lit les champs du bloc 1, puis on exige que chaque bloc suivant porte exactement
    les mêmes noms avec son numéro : un en-tête qui a bougé lève, au lieu de décaler
    les candidats en silence.
    """
    entete = [str(h or "").strip() for h in entete]
    debut = entete.index(premier)
    champs: list[str] = []
    for nom in entete[debut:]:
        m = re.fullmatch(r"(.*) (\d+)", nom)
        if not m or m.group(2) != "1":
            break
        champs.append(m.group(1))
    taille = len(champs)
    if not taille or (len(entete) - debut) % taille:
        raise ValueError(f"Blocs de {taille} colonnes qui ne tombent pas juste après « {premier} »")
    for i in range(debut, len(entete)):
        attendu = f"{champs[(i - debut) % taille]} {(i - debut) // taille + 1}"
        if entete[i] != attendu:
            raise ValueError(f"En-tête inattendu : « {entete[i]} » au lieu de « {attendu} »")
    return debut, champs


def lire_blocs(entete: list[str], ligne: list[str], debut: int, champs: list[str], ou: str) -> list[dict[str, str]]:
    """Les blocs d'une ligne, en dicts {champ: valeur}. Lève si la ligne n'a pas la
    largeur de l'en-tête (une colonne en trop ou en moins décalerait tout)."""
    if len(ligne) != len(entete):
        raise ValueError(f"Ligne de {len(ligne)} colonnes pour un en-tête de {len(entete)} ({ou})")
    taille = len(champs)
    return [
        dict(zip(champs, (str(x or "").strip() for x in ligne[i:i + taille])))
        for i in range(debut, len(entete), taille)
    ]


def _colonne(entete: list[str], ligne: list[str], nom: str) -> str:
    """La valeur de la colonne `nom` ; lève si l'en-tête ne la porte pas."""
    return str(ligne[[str(h or "").strip() for h in entete].index(nom)] or "").strip()


def _participation(entete: list[str], ligne: list[str], ou: str) -> dict[str, int]:
    return {
        cle: _entier(_colonne(entete, ligne, nom), f"{nom}, {ou}")
        for cle, nom in (("inscrits", "Inscrits"), ("votants", "Votants"), ("exprimes", "Exprimés"),
                         ("blancs", "Blancs"), ("nuls", "Nuls"))
    }


def _entree_candidat(b: dict[str, str], voix: str, ou: str) -> dict:
    return {
        "cle": _slug(f"{b['Nom candidat']} {b['Prénom candidat']}"),
        "nom": _casse_nom(b["Nom candidat"]),
        "prenom": b["Prénom candidat"],
        "sexe": _sexe(b["Sexe candidat"]),
        "nuance": b["Nuance candidat"] or None,
        "voix": _entier(b[voix], ou),
        "elu": bool(b["Elu"]),
        "sieges": None,
        "intitule": None,
    }


def _entree_liste(b: dict[str, str], ou: str) -> dict:
    sieges = _entier(b["Sièges"] or "0", ou)
    return {
        "cle": _slug(b["Libellé de liste"]),
        "nom": None,
        "prenom": None,
        "sexe": None,
        "nuance": b["Nuance liste"] or None,
        "voix": _entier(b["Voix"], ou),
        # La colonne « Elu » reste vide pour une liste : ce sont ses sièges qui disent
        # qu'elle a des élus.
        "elu": sieges > 0,
        "sieges": sieges,
        "intitule": b["Libellé de liste"],
    }


def _verifier_cles(entrees: list[dict], ou: str) -> None:
    """Deux entrées d'un même tour qui donnent la même `cle` rendraient l'élu ambigu."""
    doublons = [c for c, n in Counter(e["cle"] for e in entrees).items() if n > 1]
    if doublons:
        raise ValueError(f"Clé en double {doublons} ({ou})")


# ── Corrections ───────────────────────────────────────────────────────────────


def charger_corrections() -> list[dict]:
    """Les corrections de `corrections_elections.json`, vérifiées.

    Lève sur un champ manquant ou une correction qui ne corrige rien : le fichier
    s'écrit à la main, et une faute de frappe passée en silence laisserait un élu sans
    élection.
    """
    contenu = json.loads(CORRECTIONS.read_text(encoding="utf-8"))
    corrections = contenu["corrections"]
    for c in corrections:
        for champ in ("election", "circonscription", "nom", "prenom", "source_url"):
            if not c.get(champ):
                raise ValueError(f"Champ `{champ}` manquant dans {CORRECTIONS.name} : {c}")
        if not (c.get("nom_corrige") or c.get("prenom_corrige")):
            raise ValueError(f"Correction sans `nom_corrige` ni `prenom_corrige` dans {CORRECTIONS.name} : {c}")
        c["appliquee"] = 0
    return corrections


def corriger(corrections: list[dict], election: str, circonscription: str, nom: str, prenom: str) -> tuple[str, str]:
    """Le nom et le prénom à retenir pour une personne lue dans un fichier."""
    for c in corrections:
        if (c["election"], c["circonscription"]) == (election, circonscription) \
                and _normalize_name(c["nom"]) == _normalize_name(nom) and c["prenom"] == prenom:
            c["appliquee"] += 1
            return c.get("nom_corrige") or nom, c.get("prenom_corrige") or prenom
    return nom, prenom


# ── Législatives 2024 ─────────────────────────────────────────────────────────


def lire_leg2024(corrections: list[dict]) -> list[dict]:
    """Les 577 circonscriptions, un ou deux tours chacune."""
    source = SOURCES["LEG2024"]
    par_circo: dict[str, dict] = {}
    for numero in (1, 2):
        lignes = lire_csv(telecharger(source["resultats"][numero]))
        entete, corps = lignes[0], [l for l in lignes[1:] if any(x.strip() for x in l)]
        debut, champs = decouper_blocs(entete, "Numéro de panneau 1")
        for ligne in corps:
            dep = _code_departement(ligne[0])
            code = ligne[2].strip().upper()
            if code.isdigit():
                code = code.zfill(len(dep) + 2)
            num = code[len(dep):]
            if not code.startswith(dep) or len(num) != 2 or not num.isdigit():
                raise ValueError(f"Code de circonscription {ligne[2]!r} illisible pour le département {dep}")
            circo = f"{dep}-{num}"
            ou = f"LEG2024 {circo} tour {numero}"
            entrees = []
            for b in lire_blocs(entete, ligne, debut, champs, ou):
                if not b["Nom candidat"]:
                    continue
                b["Nom candidat"], b["Prénom candidat"] = corriger(corrections, "LEG2024", circo, b["Nom candidat"], b["Prénom candidat"])
                entrees.append(_entree_candidat(b, "Voix", ou))
            _verifier_cles(entrees, ou)
            if numero == 1:
                if circo in par_circo:
                    raise ValueError(f"Circonscription en double : {ou}")
                par_circo[circo] = {
                    "election": "LEG2024",
                    "circonscription": circo,
                    "libelle": f"{ligne[1].strip()}, {ligne[3].strip()}",
                    "mode": "majoritaire",
                    "sieges": 1,
                    "tours": [],
                    "colistiers": None,
                    "date_donnee": source["date_donnee"],
                }
            elif circo not in par_circo:
                raise ValueError(f"2ᵈ tour sans 1ᵉʳ tour : {ou}")
            r = par_circo[circo]
            r["tours"].append({"numero": numero, **_participation(entete, ligne, ou), "entrees": entrees})
            r["date_scrutin"] = source["dates"][numero]
            r["source_url"] = source["resultats"][numero]

    for circo, r in par_circo.items():
        elus = [e for t in r["tours"] for e in t["entrees"] if e["elu"]]
        if len(elus) != 1:
            raise ValueError(f"LEG2024 {circo} : {len(elus)} élus au lieu de 1")
        r["elus"] = [{k: elus[0][k] for k in ("cle", "nom", "prenom", "sexe")}]
    return list(par_circo.values())


# ── Sénatoriales ──────────────────────────────────────────────────────────────


def _assembler_senat(
    election: str,
    tours_maj: dict[int, tuple[list[str], list[list[str]], str]],
    feuille_prop: tuple[list[str], list[list[str]], str] | None,
    elus_fichier: list[dict],
    candidatures: list[dict],
    corrections: list[dict],
) -> list[dict]:
    """Assemble une sénatoriale à partir de ses fichiers déjà lus.

    - `tours_maj` : {numéro: (en-tête, lignes, premier champ de bloc)} ; au 1ᵉʳ tour
      de 2026, les lignes des départements au scrutin de liste y sont mêlées.
    - `feuille_prop` : la feuille séparée des listes (2023), ou None.
    - `elus_fichier` : [{dep, nom, prenom, sexe, tour}] du fichier des élus.
    - `candidatures` : [{dep, libelle, ordre, nom, prenom}] des candidatures sur liste.

    Le mode d'un département se lit dans le contenu de sa ligne (blocs de candidats ou
    de listes), contrôlé par sa présence dans le fichier des candidatures sur liste.
    L'élu se lit dans la colonne « Elu » du ministère, contrôlée par le fichier des élus.
    """
    source = SOURCES[election]
    resultats: dict[str, dict] = {}

    def ligne_resultat(dep: str, libelle: str, mode: str) -> dict:
        r = resultats.get(dep)
        if r is None:
            r = resultats[dep] = {
                "election": election,
                "circonscription": dep,
                "libelle": libelle,
                "mode": mode,
                "tours": [],
                "date_scrutin": source["date"],
                "source_url": source["resultats"] if isinstance(source["resultats"], str) else source["resultats"][1],
                "date_donnee": source["date_donnee"],
            }
        elif r["mode"] != mode:
            raise ValueError(f"{election} {dep} : scrutin majoritaire et de liste à la fois")
        return r

    feuilles = [(n, *tours_maj[n]) for n in sorted(tours_maj)]
    if feuille_prop:
        feuilles.append((1, *feuille_prop))
    for numero, entete, corps, premier in feuilles:
        debut, champs = decouper_blocs(entete, premier)
        for ligne in corps:
            dep = _code_departement(_colonne(entete, ligne, "Code département"))
            ou = f"{election} {dep} tour {numero}"
            blocs = lire_blocs(entete, ligne, debut, champs, ou)
            candidats = [b for b in blocs if b.get("Nom candidat")]
            listes = [b for b in blocs if b.get("Libellé de liste")]
            if bool(candidats) == bool(listes):
                raise ValueError(f"{ou} : ni candidats ni listes, ou les deux")
            r = ligne_resultat(dep, _colonne(entete, ligne, "Libellé département"), "liste" if listes else "majoritaire")
            if any(t["numero"] == numero for t in r["tours"]):
                raise ValueError(f"Département en double : {ou}")
            if listes:
                entrees = [_entree_liste(b, ou) for b in listes]
            else:
                entrees = []
                for b in candidats:
                    b["Nom candidat"], b["Prénom candidat"] = corriger(corrections, election, dep, b["Nom candidat"], b["Prénom candidat"])
                    # Au 1ᵉʳ tour, le bloc de 12 colonnes porte aussi les champs des listes,
                    # vides ici : seules les voix et le nom importent.
                    entrees.append(_entree_candidat(b, "Voix", ou))
            _verifier_cles(entrees, ou)
            r["tours"].append({"numero": numero, **_participation(entete, ligne, ou), "entrees": entrees})
            if numero == 2:
                r["source_url"] = source["resultats"][2] if isinstance(source["resultats"], dict) else source["resultats"]
    for r in resultats.values():
        r["tours"].sort(key=lambda t: t["numero"])

    # Le fichier des élus, corrigé, regroupé par département.
    elus_par_dep: dict[str, list[dict]] = defaultdict(list)
    for e in elus_fichier:
        nom, prenom = corriger(corrections, election, e["dep"], e["nom"], e["prenom"])
        elus_par_dep[e["dep"]].append({**e, "nom": nom, "prenom": prenom})
    inconnus = set(elus_par_dep) - set(resultats)
    if inconnus:
        raise ValueError(f"{election} : élus dans des départements sans résultats {sorted(inconnus)}")

    # Candidatures sur liste, corrigées, regroupées par département.
    cand_par_dep: dict[str, list[dict]] = defaultdict(list)
    for c in candidatures:
        nom, prenom = corriger(corrections, election, c["dep"], c["nom"], c["prenom"])
        cand_par_dep[c["dep"]].append({**c, "nom": nom, "prenom": prenom})

    for dep, r in resultats.items():
        elus = elus_par_dep.get(dep, [])
        if not elus:
            raise ValueError(f"{election} {dep} : aucun élu dans le fichier des élus")
        r["sieges"] = len(elus)
        if r["mode"] == "majoritaire":
            if dep in cand_par_dep:
                raise ValueError(f"{election} {dep} : candidatures sur liste pour un scrutin majoritaire")
            r["colistiers"] = None
            coches = [e for t in r["tours"] for e in t["entrees"] if e["elu"]]
            par_nom = {(_normalize_name(e["nom"]), _normalize_name(e["prenom"])): e for e in coches}
            attendus = {(_normalize_name(e["nom"]), _normalize_name(e["prenom"])) for e in elus}
            if set(par_nom) != attendus or len(coches) != len(elus):
                raise ValueError(f"{election} {dep} : la colonne « Elu » ne correspond pas au fichier des élus")
            r["elus"] = [{k: par_nom[c][k] for k in ("cle", "nom", "prenom", "sexe")} for c in sorted(par_nom)]
            continue

        # Scrutin de liste : un seul tour. Chaque élu rejoint sa liste par les
        # candidatures (nom, prénom, département), puis la liste son entrée par le
        # libellé, que les deux fichiers écrivent pareil (contrôlé en 2023 et 2026).
        if len(r["tours"]) != 1 or dep not in cand_par_dep:
            raise ValueError(f"{election} {dep} : scrutin de liste sans candidatures, ou à deux tours")
        entrees = r["tours"][0]["entrees"]
        par_libelle = {e["intitule"]: e["cle"] for e in entrees}
        par_libelle_norm = {_normalize_name(e["intitule"]): e["cle"] for e in entrees}
        colistiers = []
        for c in cand_par_dep[dep]:
            liste_id = par_libelle.get(c["libelle"]) or par_libelle_norm.get(_normalize_name(c["libelle"]))
            if liste_id is None:
                # Une liste déposée puis retirée n'a pas de résultat.
                print(f"   ⚠️  {election} {dep} : liste sans résultat, colistiers écartés : {c['libelle']}")
                continue
            colistiers.append({"liste_id": liste_id, "ordre": c["ordre"], "nom": _casse_nom(c["nom"]), "prenom": c["prenom"],
                               "_cle": (_normalize_name(c["nom"]), _normalize_name(c["prenom"]))})
        index = defaultdict(list)
        for c in colistiers:
            index[c["_cle"]].append(c)
        r["elus"] = []
        for e in elus:
            trouves = index.get((_normalize_name(e["nom"]), _normalize_name(e["prenom"])), [])
            if len(trouves) != 1:
                raise ValueError(f"{election} {dep} : élu {e['prenom']} {e['nom']} sur {len(trouves)} listes")
            r["elus"].append({"liste_id": trouves[0]["liste_id"], "nom": _casse_nom(e["nom"]), "prenom": e["prenom"], "sexe": e["sexe"]})
        sieges = Counter(e["liste_id"] for e in r["elus"])
        if any(sieges.get(e["cle"], 0) != e["sieges"] for e in entrees):
            raise ValueError(f"{election} {dep} : sièges des listes et fichier des élus divergent")
        r["elus"].sort(key=lambda e: (e["liste_id"], _normalize_name(e["nom"]), e["prenom"]))
        r["colistiers"] = sorted(({k: v for k, v in c.items() if k != "_cle"} for c in colistiers),
                                 key=lambda c: (c["liste_id"], c["ordre"]))
    return list(resultats.values())


def lire_sen2023(corrections: list[dict]) -> list[dict]:
    source = SOURCES["SEN2023"]
    classeur = lire_xlsx(telecharger(source["resultats"]))
    cand = lire_xlsx(telecharger(source["candidatures"]))

    def feuille(nom: str) -> tuple[list[str], list[list[str]]]:
        lignes = classeur[nom]
        return lignes[0], [l for l in lignes[1:] if any(str(x).strip() for x in l)]

    entete, corps = feuille("Liste des élus")
    elus = [{"dep": _code_departement(_colonne(entete, l, "CODE DPT")), "nom": _colonne(entete, l, "NOM"),
             "prenom": _colonne(entete, l, "PRENOM"), "sexe": _sexe(_colonne(entete, l, "SEXE"))} for l in corps]
    lignes = cand["Scrutin proportionnel"]
    entete_c = [str(h or "").strip() for h in lignes[0]]
    candidatures = [{"dep": _code_departement(_colonne(entete_c, l, "Code département")),
                     "libelle": _colonne(entete_c, l, "Libellé de la liste"),
                     "ordre": _entier(_colonne(entete_c, l, "Ordre dans la liste"), "candidatures 2023"),
                     "nom": _colonne(entete_c, l, "Nom candidat"), "prenom": _colonne(entete_c, l, "Prénom candidat")}
                    for l in lignes[1:] if any(str(x).strip() for x in l)]
    return _assembler_senat(
        "SEN2023",
        {1: (*feuille("MAJ - T1"), "Nuance candidat 1"), 2: (*feuille("MAJ - T2"), "Nuance candidat 1")},
        (*feuille("PROP"), "Nuance candidat 1"),
        elus, candidatures, corrections,
    )


def lire_sen2026(corrections: list[dict]) -> list[dict]:
    source = SOURCES["SEN2026"]
    tours = {}
    for numero in (1, 2):
        lignes = lire_csv(telecharger(source["resultats"][numero]))
        tours[numero] = (lignes[0], [l for l in lignes[1:] if any(x.strip() for x in l)], "Nuance candidat 1")
    lignes = lire_csv(telecharger(source["elus"]))
    entete = lignes[0]
    elus = [{"dep": _code_departement(_colonne(entete, l, "CODDPT")), "nom": _colonne(entete, l, "NOMPSN"),
             "prenom": _colonne(entete, l, "PREPSN"), "sexe": _sexe(_colonne(entete, l, "SEXPSN"))}
            for l in lignes[1:] if any(x.strip() for x in l)]
    lignes = lire_csv(telecharger(source["candidatures"]))
    entete = lignes[0]
    candidatures = [{"dep": _code_departement(_colonne(entete, l, "Code circonscription")),
                     "libelle": _colonne(entete, l, "Libellé de la liste"),
                     "ordre": _entier(_colonne(entete, l, "Ordre"), "candidatures 2026"),
                     "nom": _colonne(entete, l, "Nom sur le bulletin de vote"),
                     "prenom": _colonne(entete, l, "Prénom sur le bulletin de vote")}
                    for l in lignes[1:] if any(x.strip() for x in l)]
    return _assembler_senat("SEN2026", tours, None, elus, candidatures, corrections)


LECTEURS = {"LEG2024": lire_leg2024, "SEN2023": lire_sen2023, "SEN2026": lire_sen2026}


# ── Passe --resultats ─────────────────────────────────────────────────────────

COLONNES_RESULTATS = {
    "election": "text", "circonscription": "text", "libelle": "text", "mode": "text",
    "sieges": "int", "date_scrutin": "date", "tours": "jsonb", "elus": "jsonb",
    "colistiers": "jsonb", "source_url": "text", "date_donnee": "date",
}


def _empreinte(ligne: dict) -> str:
    """md5 du même tableau que celui que la base rend dans `ecrire_resultats`."""
    valeurs = [ligne[c] for c in COLONNES_RESULTATS if c not in ("election", "circonscription")]
    return hashlib.md5(_texte_jsonb(valeurs).encode("utf-8")).hexdigest()


def ecrire_resultats(election: str, lignes: list[dict]) -> tuple[int, int]:
    """Écrit les lignes qui changent, par lots d'environ 1 Mo, puis retire les
    circonscriptions que l'élection n'a plus. Rend (écrites, supprimées)."""
    autres = [c for c in COLONNES_RESULTATS if c not in ("election", "circonscription")]
    with connexion() as cx:
        en_base = dict(cx.execute(
            f"select circonscription, md5(jsonb_build_array({', '.join(autres)})::text) "
            "from public.election_resultats where election = %s",
            (election,),
        ).fetchall())
        a_envoyer = [l for l in lignes if en_base.get(l["circonscription"]) != _empreinte(l)]

        definition = ", ".join(f"{c} {t}" for c, t in COLONNES_RESULTATS.items())
        colonnes = ", ".join(COLONNES_RESULTATS)
        affectations = ", ".join(f"{c} = excluded.{c}" for c in autres)
        anciennes = ", ".join(f"election_resultats.{c}" for c in autres)
        nouvelles = ", ".join(f"excluded.{c}" for c in autres)
        ecrites = 0
        lot: list[dict] = []
        taille = 0

        def envoyer() -> None:
            nonlocal ecrites, lot, taille
            if not lot:
                return
            with cx.transaction():
                cur = cx.execute(
                    f"""
                    insert into public.election_resultats ({colonnes})
                    select {colonnes} from jsonb_to_recordset(%s::jsonb) as v({definition})
                    on conflict (election, circonscription) do update set {affectations}
                    where row({anciennes}) is distinct from row({nouvelles})
                    """,
                    (json.dumps(lot, ensure_ascii=False),),
                )
                ecrites += cur.rowcount
            lot, taille = [], 0

        for l in a_envoyer:
            lot.append(l)
            taille += len(json.dumps(l, ensure_ascii=False))
            if taille >= TAILLE_LOT:
                envoyer()
        envoyer()

        with cx.transaction():
            supprimees = cx.execute(
                "delete from public.election_resultats where election = %s and circonscription <> all(%s)",
                (election, [l["circonscription"] for l in lignes]),
            ).rowcount
    print(f"   {election} : {len(a_envoyer)} lignes envoyées, {ecrites} écrites, {supprimees} supprimées")
    return ecrites, supprimees


def passe_resultats(elections: list[str]) -> None:
    corrections = charger_corrections()
    lues = {}
    # Tout est lu et contrôlé avant la première écriture : une élection mal lue
    # n'écrit rien, même si une autre passe.
    for election in elections:
        print(f"Lecture {election}...")
        lignes = LECTEURS[election](corrections)
        sieges = sum(l["sieges"] for l in lignes)
        if sieges != SIEGES_ATTENDUS[election]:
            raise ValueError(f"{election} : {sieges} sièges au lieu de {SIEGES_ATTENDUS[election]}")
        tours = Counter(len(l["tours"]) for l in lignes)
        modes = Counter(l["mode"] for l in lignes)
        print(f"   {len(lignes)} circonscriptions, {sieges} sièges, tours {dict(sorted(tours.items()))}, modes {dict(modes)}")
        lues[election] = lignes
    inutiles = [c for c in corrections if c["election"] in elections and not c["appliquee"]]
    if inutiles:
        raise ValueError(f"Correction qui ne corrige rien dans {CORRECTIONS.name}, à retirer : {inutiles}")
    for election, lignes in lues.items():
        ecrire_resultats(election, lignes)


# ── Passe de rattachement ─────────────────────────────────────────────────────

COLONNES_ELUS = {
    "uid": "text", "election": "text", "circonscription": "text", "nature": "text",
    "cle": "text", "liste_id": "text", "remplace_nom": "text", "remplace_uid": "text",
    "date_partielle": "date",
}


def _ligne_elu(uid: str, election: str, circonscription: str, nature: str, **champs) -> dict:
    ligne = {c: None for c in COLONNES_ELUS}
    ligne.update(uid=uid, election=election, circonscription=circonscription, nature=nature, **champs)
    return ligne


def _meme_personne(nom_a: str, prenom_a: str, nom_b: str, prenom_b: str) -> bool:
    """Le nom du mandat et celui du fichier désignent-ils la même personne ?

    Le même nom suffit. À prénom égal, un nom contenu dans l'autre aussi : nom
    d'usage composé d'un côté et pas de l'autre (« Dupont » / « Dupont-Martin »).
    """
    na, nb = _normalize_name(nom_a), _normalize_name(nom_b)
    if na == nb:
        return True
    return _normalize_name(prenom_a) == _normalize_name(prenom_b) and bool(na) and bool(nb) and (na in nb or nb in na)


def charger_acteurs(cx) -> list[dict]:
    """Les acteurs utiles au rattachement, et les seuls champs des mandats de député de
    la 17ᵉ législature qui servent : la base déplie le jsonb, la passe n'en rapatrie
    que quelques Ko.

    `dep` n'est lu que pour les sénateurs, d'où le pont `DEPARTEMENT_SENAT_VERS_MINISTERE`
    (les députés passent par le lieu de leur mandat)."""
    lignes = cx.execute(
        """
        select a.uid, a.nom, a.prenom, a.num_departement,
               coalesce(a.est_depute_actuel, false), coalesce(a.est_senateur_actuel, false),
               coalesce(a.est_senateur_actuel, false) or coalesce(a.roles_text, '') like '%%Sénateur%%',
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'cause', m->'election'->>'causeMandat',
                   'debut', m->>'dateDebut',
                   'dep', m->'election'->'lieu'->>'numDepartement',
                   'circo', m->'election'->'lieu'->>'numCirco'))
                 from jsonb_array_elements(case when jsonb_typeof(a.mandats) = 'array' then a.mandats else '[]'::jsonb end) m
                 where m->>'typeOrgane' = 'ASSEMBLEE' and m->>'legislature' = '17'
               ), '[]'::jsonb)
        from public.acteurs a
        order by a.uid
        """
    ).fetchall()
    return [
        {"uid": r[0], "nom": r[1] or "", "prenom": r[2] or "",
         "dep": DEPARTEMENT_SENAT_VERS_MINISTERE.get(_code_departement(r[3]), _code_departement(r[3])),
         "depute": r[4], "senateur_actuel": r[5], "senateur": r[6], "mandats_leg17": r[7] or []}
        for r in lignes
    ]


def rattacher(acteurs: list[dict], resultats: list[dict], colistiers_de) -> tuple[dict[tuple[str, str], dict], list[str]]:
    """Calcule les lignes d'`election_elus`. Rend ({(uid, élection): ligne}, journal).

    `resultats` : [{election, circonscription, mode, elus}] ; `colistiers_de(circos)`
    rend les colistiers des départements demandés, lus à la demande parce que seuls
    les sénateurs non rattachés en ont besoin.
    """
    journal: list[str] = []
    lignes: dict[tuple[str, str], dict] = {}
    par_nom: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for a in acteurs:
        par_nom[(_normalize_name(a["nom"]), _normalize_name(a["prenom"]))].append(a)

    # ── Députés ──
    vainqueurs = {r["circonscription"]: r["elus"][0] for r in resultats if r["election"] == "LEG2024"}
    uid_vainqueur: dict[str, str] = {}
    a_lier: list[tuple[str, str]] = []  # (uid du suppléant, circonscription)
    for a in acteurs:
        mandats = [m for m in a["mandats_leg17"] if m.get("dep") and m.get("circo")]
        if not mandats:
            continue
        # Le dernier mandat dit d'où vient le siège actuel (ou le dernier occupé) : un
        # ministre revenu à l'Assemblée a « reprise… » après « élections générales ».
        m = max(mandats, key=lambda m: m.get("debut") or "")
        dep = DEPARTEMENT_AN_VERS_MINISTERE.get(m["dep"], _code_departement(m["dep"]))
        circo = f"{dep}-{int(m['circo']):02d}"
        cause = (m.get("cause") or "").strip().lower()
        vainqueur = vainqueurs.get(circo)
        if vainqueur is None:
            journal.append(f"député sans circonscription connue : {a['uid']} {a['prenom']} {a['nom']} ({circo})")
            continue
        if cause.startswith(("élections générales", "reprise")):
            if not _meme_personne(a["nom"], a["prenom"], vainqueur["nom"], vainqueur["prenom"]):
                journal.append(f"nom du mandat ≠ vainqueur de {circo} : {a['uid']} {a['prenom']} {a['nom']} / {vainqueur['prenom']} {vainqueur['nom']}")
                continue
            if circo in uid_vainqueur:
                journal.append(f"deux acteurs pour le vainqueur de {circo} : {uid_vainqueur[circo]}, {a['uid']}")
                continue
            uid_vainqueur[circo] = a["uid"]
            lignes[(a["uid"], "LEG2024")] = _ligne_elu(a["uid"], "LEG2024", circo, "elu", cle=vainqueur["cle"])
        elif cause.startswith("remplacement"):
            a_lier.append((a["uid"], circo))
        elif cause.startswith("élection partielle"):
            lignes[(a["uid"], "LEG2024")] = _ligne_elu(a["uid"], "LEG2024", circo, "partielle", date_partielle=(m.get("debut") or "")[:10] or None)
        else:
            journal.append(f"cause de mandat inconnue : {a['uid']} {a['prenom']} {a['nom']} « {m.get('cause')} »")

    # Vainqueurs dont aucun mandat ne porte la circonscription (partis depuis, mandats
    # absents du jsonb) : par nom et prénom exacts, un seul acteur.
    for circo, v in sorted(vainqueurs.items()):
        if circo in uid_vainqueur:
            continue
        trouves = par_nom.get((_normalize_name(v["nom"]), _normalize_name(v["prenom"])), [])
        if len(trouves) != 1:
            journal.append(f"vainqueur de {circo} {'ambigu' if trouves else 'introuvable'} : {v['prenom']} {v['nom']}")
            continue
        uid = trouves[0]["uid"]
        deja = lignes.get((uid, "LEG2024"))
        if deja:
            # Réélu dans sa circonscription lors d'une partielle, après l'annulation de
            # son élection (Dalloz, Jura, 2025) : le siège vient de la partielle, et
            # l'Assemblée ne garde plus le premier mandat. Rien d'anormal à signaler.
            if not (deja["nature"] == "partielle" and deja["circonscription"] == circo):
                journal.append(f"vainqueur de {circo} déjà rattaché ailleurs : {uid} {v['prenom']} {v['nom']}")
            continue
        uid_vainqueur[circo] = uid
        lignes[(uid, "LEG2024")] = _ligne_elu(uid, "LEG2024", circo, "elu", cle=v["cle"])

    for uid, circo in a_lier:
        v = vainqueurs[circo]
        lignes[(uid, "LEG2024")] = _ligne_elu(uid, "LEG2024", circo, "suppleant",
                                              remplace_nom=f"{v['prenom']} {v['nom']}", remplace_uid=uid_vainqueur.get(circo))

    # ── Sénateurs ──
    senateurs = [a for a in acteurs if a["senateur"]]
    sen_par_nom: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for a in senateurs:
        sen_par_nom[(_normalize_name(a["nom"]), _normalize_name(a["prenom"]))].append(a)
    rattaches: set[str] = set()
    for r in resultats:
        if not r["election"].startswith("SEN"):
            continue
        dep = r["circonscription"]
        for e in r["elus"]:
            trouves = sen_par_nom.get((_normalize_name(e["nom"]), _normalize_name(e["prenom"])), [])
            if len(trouves) > 1:
                trouves = [a for a in trouves if a["dep"] == dep]
            if len(trouves) != 1:
                journal.append(f"sénateur {'ambigu' if trouves else 'introuvable'} {r['election']} {dep} : {e['prenom']} {e['nom']}")
                continue
            uid = trouves[0]["uid"]
            rattaches.add(uid)
            lignes[(uid, r["election"])] = _ligne_elu(uid, r["election"], dep, "elu", cle=e.get("cle"), liste_id=e.get("liste_id"))

    # Suivants de liste : sénateur en exercice sans élection, colistier non élu d'une
    # liste de son département. Même prénom, et un nom contenu dans l'autre suffit
    # (`_meme_personne`) : le bulletin porte souvent le nom de naissance seul, le Sénat
    # le nom d'usage (Marie-Pierre « Guérin » sur la liste de 2023, « Bessin-Guérin »
    # au Sénat). Le prénom est exigé ici, parce qu'un même nom de famille revient
    # d'une liste à l'autre du département.
    restants = [a for a in senateurs if a["senateur_actuel"] and a["uid"] not in rattaches]
    listes = {(r["election"], r["circonscription"]): r for r in resultats if r["election"].startswith("SEN") and r["mode"] == "liste"}
    deps = sorted({a["dep"] for a in restants} & {c for _, c in listes})
    colistiers = colistiers_de(deps) if deps else {}
    for a in restants:
        prenom = _normalize_name(a["prenom"])
        trouves = []
        for (election, dep), r in listes.items():
            if dep != a["dep"]:
                continue
            elus = {(_normalize_name(e["nom"]), _normalize_name(e["prenom"])) for e in r["elus"]}
            for c in colistiers.get((election, dep), []):
                if (_normalize_name(c["nom"]), _normalize_name(c["prenom"])) in elus:
                    continue
                if _normalize_name(c["prenom"]) == prenom and _meme_personne(a["nom"], a["prenom"], c["nom"], c["prenom"]):
                    trouves.append((election, dep))
        if len(trouves) != 1:
            journal.append(f"sénateur en exercice {'ambigu' if trouves else 'introuvable'} : {a['uid']} {a['prenom']} {a['nom']} ({a['dep']})")
            continue
        election, dep = trouves[0]
        lignes[(a["uid"], election)] = _ligne_elu(a["uid"], election, dep, "suivant_liste")
    return lignes, journal


def passe_rattachement(acteurs_retires: set[str] | None = None) -> int:
    """La passe de nuit. Rend 0, ou 1 si une élection manque en base.

    `acteurs_retires` sert au test négatif : des uids retirés en mémoire, pour prouver
    que la passe alerte et ne supprime rien quand `acteurs` perd des lignes.
    """
    with connexion() as cx:
        resultats = [
            {"election": r[0], "circonscription": r[1], "mode": r[2], "elus": r[3]}
            for r in cx.execute(
                "select election, circonscription, mode, elus from public.election_resultats order by election, circonscription"
            ).fetchall()
        ]
        acteurs = charger_acteurs(cx)
        if acteurs_retires:
            acteurs = [a for a in acteurs if a["uid"] not in acteurs_retires]
        existantes = {
            (r["uid"], r["election"]): r
            for r in (
                dict(zip(COLONNES_ELUS, ligne))
                for ligne in cx.execute(f"select {', '.join(COLONNES_ELUS)} from public.election_elus").fetchall()
            )
        }
        for r in existantes.values():
            if r["date_partielle"] is not None:
                r["date_partielle"] = r["date_partielle"].isoformat()

        manquantes = sorted(set(SIEGES_ATTENDUS) - {r["election"] for r in resultats})
        if manquantes or not acteurs:
            signaler_anomalie("elections", f"rien n'est écrit : élection absente de election_resultats {manquantes} ou table acteurs vide")
            return 1

        def colistiers_de(deps: list[str]) -> dict[tuple[str, str], list[dict]]:
            return {
                (r[0], r[1]): r[2]
                for r in cx.execute(
                    "select election, circonscription, colistiers from public.election_resultats "
                    "where mode = 'liste' and circonscription = any(%s)",
                    (deps,),
                ).fetchall()
            }

        voulues, journal = rattacher(acteurs, resultats, colistiers_de)

        presents = {a["uid"] for a in acteurs}
        a_ecrire = [l for k, l in voulues.items() if existantes.get(k) != l]
        disparues = [k for k in existantes if k not in voulues]
        # Une ligne dont l'acteur a disparu de `acteurs` n'est pas supprimée : c'est
        # l'import des acteurs qui a perdu une ligne, pas l'élu qui a changé de siège.
        orphelines = [k for k in disparues if k[0] not in presents]
        a_supprimer = [k for k in disparues if k[0] in presents]
        if orphelines:
            signaler_anomalie("elections", f"{len(orphelines)} lignes gardées : acteur absent de la table acteurs ({', '.join(u for u, _ in orphelines[:10])})")
        if existantes and len(a_supprimer) > SEUIL_SUPPRESSIONS * len(existantes):
            signaler_anomalie("elections", f"{len(a_supprimer)} suppressions sur {len(existantes)} lignes, au-delà de {SEUIL_SUPPRESSIONS:.0%} : rien n'est supprimé")
            a_supprimer = []

        attendus = sum(len(r["elus"]) for r in resultats)
        elus = sum(1 for l in voulues.values() if l["nature"] == "elu")
        if elus < SEUIL_RATTACHES * attendus:
            signaler_anomalie("elections", f"{elus} élus rattachés sur {attendus}, sous {SEUIL_RATTACHES:.0%}")
        sans_ligne = [a for a in acteurs if a["depute"] and (a["uid"], "LEG2024") not in voulues]
        if sans_ligne:
            noms = ", ".join(f"{a['uid']} {a['prenom']} {a['nom']}" for a in sans_ligne)
            signaler_anomalie("elections", f"député(s) en exercice sans élection : {noms}")

        definition = ", ".join(f"{c} {t}" for c, t in COLONNES_ELUS.items())
        colonnes = ", ".join(COLONNES_ELUS)
        autres = [c for c in COLONNES_ELUS if c not in ("uid", "election")]
        with cx.transaction():
            ecrites = 0
            if a_ecrire:
                ecrites = cx.execute(
                    f"""
                    insert into public.election_elus ({colonnes})
                    select {colonnes} from jsonb_to_recordset(%s::jsonb) as v({definition})
                    on conflict (uid, election) do update set {', '.join(f'{c} = excluded.{c}' for c in autres)}
                    where row({', '.join(f'election_elus.{c}' for c in autres)}) is distinct from row({', '.join(f'excluded.{c}' for c in autres)})
                    """,
                    (json.dumps(a_ecrire, ensure_ascii=False),),
                ).rowcount
            supprimees = 0
            if a_supprimer:
                supprimees = cx.execute(
                    "delete from public.election_elus e using jsonb_to_recordset(%s::jsonb) as v(uid text, election text) "
                    "where e.uid = v.uid and e.election = v.election",
                    (json.dumps([{"uid": u, "election": el} for u, el in a_supprimer]),),
                ).rowcount

    for ligne in journal:
        print(f"   · {ligne}")
    natures = Counter((l["election"][:3], l["nature"]) for l in voulues.values())
    ajoutees = sum(1 for l in a_ecrire if (l["uid"], l["election"]) not in existantes)
    print(
        "Rattachés : "
        + ", ".join(f"{n} {ch} {nat}" for (ch, nat), n in sorted(natures.items()))
        + f" · non rattachés {len(journal)} · ajoutés {ajoutees}, changés {ecrites - ajoutees}, supprimés {supprimees}"
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Résultats des élections et rattachement des parlementaires.")
    parser.add_argument("--resultats", action="store_true", help="Télécharge les fichiers et écrit election_resultats.")
    parser.add_argument("--election", choices=sorted(SOURCES), help="Avec --resultats : une seule élection.")
    args = parser.parse_args()
    if args.resultats:
        passe_resultats([args.election] if args.election else list(SOURCES))
        return 0
    if args.election:
        parser.error("--election ne va qu'avec --resultats")
    return passe_rattachement()


if __name__ == "__main__":
    sys.exit(main())
