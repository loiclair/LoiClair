# import_amendements.py
# Importe les comptages d'amendements (AN + Sénat) dans Postgres.
# Enrichit les tables acteurs (nb_amendements_auteur, nb_amendements_cosignataire, et
# le sort des amendements dont l'élu est l'auteur amendements_par_sort, lu par la
# section « Amendements » de la fiche élu) et dossiers_legislatifs (nb_amendements_deposes,
# nb_amendements_adoptes, et leur répartition par groupe amendements_par_groupe), et
# remplit la table amendements (un amendement adopté par ligne, avec son auteur et le
# lien vers sa page officielle). Répartition et table sont lues par la section
# « Modifications du texte » de la fiche dossier. Chaque ligne porte aussi le dispositif
# de l'amendement et son exposé des motifs en texte brut : tous deux servent au
# classement par profil de lecteur. Remplit enfin `dossier_amendements_elus` (amendements déposés
# par chaque élu sur chaque dossier, auteur principal seul), lue par la section « Les
# plus actifs dans ce dossier » de la fiche dossier.
#
# Sources :
#   - AN : Amendements.json.zip (~312 Mo, ~135K fichiers JSON, législature 17)
#   - Sénat : ameli.zip (~150 Mo, dump SQL PostgreSQL, toutes législatures)
#
# Filtrage : un amendement n'est comptabilisé que si le dossier auquel il se
# rattache existe dans notre table dossiers_legislatifs.
#
# Exécuter avec : python import_amendements.py

import hashlib
import html
import io
import json
import sys
import re
import sqlite3
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire, mettre_a_jour  # noqa: E402
from _positions_groupe import (  # noqa: E402
    CODES_AMELI_SANS_ORGANE,
    GROUPE_ALIAS,
    GROUPES_AMELI_VERS_ORGANE,
)
from _telechargement import telecharger  # noqa: E402

# ===================================================================
# Configuration
# ===================================================================

URL_AMENDEMENTS_AN = "https://data.assemblee-nationale.fr/static/openData/repository/17/loi/amendements_div_legis/Amendements.json.zip"
URL_AMELI_SENAT = "https://data.senat.fr/data/ameli/ameli.zip"

# Borne du mandat sénatorial en cours, identique à celle de `sync_senat.py` : le dump
# ameli couvre toutes les législatures, l'archive AN est déjà bornée à la 17e.
SENAT_DERNIERE_ELECTION = "2023-10-02"

# `ent`, `com_ameli`, `ses` et `sub` servent à la table `amendements` : type
# d'auteur, nom de la commission, session (pour l'URL) et article visé. `ent` et
# `grppol_ameli` (codes des groupes) servent aussi à la répartition par groupe.
TABLES_AMELI = {"amd", "amdsen", "sen_ameli", "sor", "txt_ameli", "ent", "com_ameli", "ses", "sub",
                "grppol_ameli"}

# Codes de sort "adopté" dans la table sor du dump ameli
SENAT_SORT_ADOPTE_CODES = {"A", "B", "1", "2"}

# Les huit cases de `acteurs.amendements_par_sort`, communes aux deux chambres. Tout
# amendement compté pour son auteur tombe dans une case et une seule : la somme égale
# `nb_amendements_auteur`. « autre » recueille ce qu'aucune chambre ne range ailleurs
# (4 amendements « effacé » à l'Assemblée au 2026-10-25).
SORTS_AMENDEMENT = ("adopte", "rejete", "tombe", "non_soutenu", "retire", "irrecevable", "en_attente", "autre")

# Sort voté (`cycleDeVie.sort`) d'un amendement de l'Assemblée. Sans sort, la case se
# lit dans l'état du traitement : voir `_sort_an`.
SORTS_AN = {"Adopté": "adopte", "Rejeté": "rejete", "Tombé": "tombe", "Non soutenu": "non_soutenu",
            "Retiré": "retire"}

# Codes de la table `sor` du dump ameli, hors adoptés (lus dans `sor` par
# `process_senat`). En séance : J rejeté, K rejeté par vote unique, S tombé, N non
# soutenu, R retiré ; en commission : 3 rejeté, 4 retiré, 5 « satisfait ou sans objet »,
# rangé avec les tombés comme l'Assemblée range ses amendements devenus sans objet.
SORTS_SENAT = {"J": "rejete", "K": "rejete", "3": "rejete", "S": "tombe", "5": "tombe",
               "N": "non_soutenu", "R": "retire", "4": "retire"}

# ===================================================================
# Connexion
# ===================================================================

# Les variables `PG*` (voir `_db.py`) viennent de l'environnement ou de `.env.local`.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ===================================================================
# Utilitaires
# ===================================================================


def _normalize_name(s: str) -> str:
    """Normalise un nom : supprime les accents, met en majuscules."""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").upper().strip()


def _article_court(libelle: str | None) -> str | None:
    """Article visé par un amendement, sous une forme commune aux deux chambres.

    L'Assemblée écrit « APRÈS ART. PREMIER », le Sénat « Article 2\\xa0bis\\xa0(nouveau) » :
    rendus « Après art. 1er » et « Art. 2 bis ». Seules les capitales intégrales sont
    remises en casse de phrase, un libellé déjà en casse normale (« État B ») est gardé.
    Une lettre isolée et un chiffre romain restent en capitale : « ART. 1ER A » donne
    « Art. 1er A », et non « Art. 1er a » (298 lignes ainsi au 2026-10-14). « ART.S »,
    l'abréviation d'« articles » à l'Assemblée, devient « Art. » : sinon la règle des
    lettres isolées en tirait « Art.S 12 ».
    """
    if not libelle or not isinstance(libelle, str):
        return None
    s = " ".join(libelle.replace("\xa0", " ").split())
    s = re.sub(r"\s*\(nouveau\)$", "", s)
    s = re.sub(r"^ART\.S\b", "ART.", s)
    if s.isupper():
        s = s.capitalize()
        s = re.sub(r"\b(?:[a-z]|x{0,3}(?:ix|iv|v?i{1,3}|v))\b", lambda m: m.group(0).upper(), s)
    s = re.sub(r"^Article\b", "Art.", s)
    s = re.sub(r"(?i)\b(art\.) premier\b", r"\1 1er", s)
    return s or None


def _sans_rectification(numero: str) -> str:
    """« CE291 (Rect) », « 2088 (2ème Rect) » → « CE291 », « 2088 ».

    Le numéro affiché sur la fiche est celui sous lequel l'amendement se cite, comme au
    Sénat, où le dump ne porte pas la mention ; la page officielle, elle, montre la
    version rectifiée.
    """
    return re.sub(r"\s*\(.*\)\s*$", "", numero).strip()


def _texte_en_ligne(fragment: str) -> str:
    """HTML d'un fragment sans structure (une cellule de tableau) → une ligne de texte."""
    s = re.sub(r"<[^>]+>", " ", fragment)
    return " ".join(html.unescape(s).replace("\xa0", " ").split())


def _ligne_de_tableau(tr: re.Match) -> str:
    """Une rangée `<tr>` → ses cellules séparées par « | », cellules vides gardées.

    Garder les vides garde l'alignement des colonnes : dans un tableau de crédits du
    Sénat, « Patrimoines | 2 000 000 |  | 2 000 000 | » dit que les 2 millions sont
    en plus et non en moins, ce que perdrait une ligne « Patrimoines | 2 000 000 ».
    """
    cellules = re.findall(r"(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>", tr.group(1))
    return "\n" + " | ".join(_texte_en_ligne(c) for c in cellules) + "\n"


def _texte_brut(fragment: str | None) -> str | None:
    """Dispositif ou exposé en HTML → texte brut, un paragraphe par ligne.

    Les fins de ligne du HTML ne sont que de la mise en page (le Sénat coupe ses
    balises par des `\\r\\n`) : elles deviennent des espaces, et seuls `</p>`, `<br>`,
    `</li>` et les titres font une ligne. Les tableaux sont rendus avant le reste, une
    rangée par ligne : sinon chaque `<p>` d'une cellule casserait la rangée.
    """
    if not fragment or not isinstance(fragment, str):
        return None
    s = re.sub(r"[\r\n]+", " ", fragment)
    s = re.sub(r"(?is)<tr\b[^>]*>(.*?)</tr>", _ligne_de_tableau, s)
    s = re.sub(r"(?i)</p>|<br\s*/?>|</li>|</h\d>|</div>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    # Certains textes de l'Assemblée sont échappés deux fois, voire trois
    # (`&amp;nbsp;`, `&lt; sup&gt;er&lt; /sup&gt;` dans 8 gages, `R&amp;amp;D` dans un
    # exposé, au 2026-10-15) : on décode jusqu'à ce que le texte ne bouge plus, et
    # les balises que ça fait apparaître, parfois écrites avec une espace
    # (« < sup> »), sont retirées à leur tour. Sans nom de balise collé au chevron
    # fermant, un « < » de texte (« x < 5 ») n'est pas touché.
    for _ in range(3):
        decode = html.unescape(s)
        if decode == s:
            break
        s = decode
    s = re.sub(r"<\s*/?\s*[a-zA-Z]+\s*/?>", "", s).replace("\xa0", " ")
    lignes = (" ".join(l.split()) for l in s.split("\n"))
    return "\n".join(l for l in lignes if l) or None


# Champs de montant d'un programme ou d'une ligne de crédit, avec leur libellé. Les
# deux premiers sont ceux d'une loi de finances initiale ; une loi de finances
# rectificative publie à la place des ouvertures et des annulations, et un programme
# qui ne porte que celles-ci serait sinon lu comme vide (18 adoptés au 2026-10-15).
CHAMPS_CREDITS = (
    ("autorisationEngagement", "en autorisations d'engagement"),
    ("creditPaiement", "en crédits de paiement"),
    ("autorisationEngagementSupplementaire", "sur les autorisations d'engagement ouvertes"),
    ("creditPaiementSupplementaire", "sur les crédits de paiement ouverts"),
    ("autorisationEngagementAnnule", "sur les autorisations d'engagement annulées"),
    ("creditPaiementAnnule", "sur les crédits de paiement annulés"),
)


def _mouvements(element: dict) -> list[str]:
    """Montants non nuls d'un programme ou d'une ligne : « -3 000 000 € en crédits de paiement »."""
    morceaux = []
    for champ, libelle in CHAMPS_CREDITS:
        try:
            n = int(float(element.get(champ) or 0))
        except (TypeError, ValueError):
            continue
        if n:
            morceaux.append(f"{'+' if n > 0 else '-'}{abs(n):,} € {libelle}".replace(",", " "))
    return morceaux


def _credits_plf(credits: dict | None) -> str | None:
    """Mouvement de crédits d'un amendement de loi de finances de l'Assemblée → texte.

    Ces amendements (2 049 adoptés au 2026-10-15) n'ont pas de `dispositif` HTML :
    l'Assemblée publie le tableau en données, sous `dispositifAmdtCreditPLF` (ou
    `…PLFR` pour une loi de finances rectificative). Une ligne par programme qui bouge,
    puis ses lignes de crédit indentées. Les programmes à zéro, listés pour équilibrer
    le tableau officiel, ne disent rien du sens de l'amendement et sont omis, sauf
    s'ils sont créés ou supprimés.
    """
    if not isinstance(credits, dict):
        return None
    programmes = (credits.get("listeProgrammes") or {}).get("programme") or []
    if isinstance(programmes, dict):
        programmes = [programmes]
    lignes = []
    for p in programmes:
        if not isinstance(p, dict):
            continue
        action = p.get("action")
        mouvements = _mouvements(p)
        if not mouvements and action == "modification":
            continue
        suffixe = {"création": " (programme créé)", "suppression": " (programme supprimé)"}.get(action, "")
        lignes.append(f"{p.get('libelle') or '?'}{suffixe} : {', '.join(mouvements) or 'aucun montant'}")
        sous = (p.get("lignesCredits") or {}).get("ligneCredit") or []
        if isinstance(sous, dict):
            sous = [sous]
        for l in sous:
            if isinstance(l, dict) and _mouvements(l):
                lignes.append(f"  {l.get('libelle') or '?'} : {', '.join(_mouvements(l))}")
    if not lignes:
        return None
    return "Modifier ainsi les crédits des programmes :\n" + "\n".join(lignes)


def _copy_dechappe(valeur: str | None) -> str | None:
    """Valeur d'un `COPY … FROM stdin` PostgreSQL → texte réel.

    Le dump ameli écrit les fins de ligne et tabulations d'un champ en `\\r`, `\\n`,
    `\\t`, et la barre oblique en `\\\\`. `parse_ameli_to_sqlite` charge les valeurs
    telles quelles, ce qui suffit aux colonnes courtes ; le dispositif et l'objet
    d'un amendement, eux, en sont pleins (284 720 `\\n` sur les adoptés depuis 2023).
    """
    if valeur is None:
        return None
    return re.sub(r"\\(.)", lambda m: {"r": "\r", "n": "\n", "t": "\t", "\\": "\\"}.get(m.group(1), m.group(0)), valeur)


# ===================================================================
# Pré-chargement des dossiers connus
# ===================================================================


def load_known_dossier_uids() -> set:
    """Charge l'ensemble des uid de dossiers_legislatifs."""
    with connexion() as conn:
        rows = lire(conn, "select uid from dossiers_legislatifs")
    uids = {r["uid"] for r in rows}
    print(f"📋 {len(uids)} dossiers connus en base")
    return uids


def build_signet_to_dossier_map() -> dict:
    """Construit un mapping signet Sénat → dossier_uid."""
    # Triée par `uid` : le choix du dossier d'un signet partagé en dépend (voir plus bas).
    with connexion() as conn:
        rows = lire(
            conn,
            """
            select uid, lien_senat from dossiers_legislatifs
            where lien_senat is not null and lien_senat <> ''
            order by uid
            """,
        )

    # Un même signet peut porter plusieurs dossiers (3 signets pour 6 dossiers au
    # 2026-10-14) : l'Assemblée ouvre un nouveau dossier quand un texte est redéposé,
    # et l'ancien garde le lien Sénat. Le tri par `uid` donne le signet au dossier le
    # plus récent, qui est celui qui porte le texte du Sénat : vérifié sur `pjl25-801`,
    # dont les textes 801 et 835 sont dans `DLR5L17N54608` et non dans l'ancien
    # `DLR5L17N54566`, qui affichait jusque-là leurs 521 amendements. Sans tri, le
    # choix suivait l'ordre de lecture et pouvait changer d'une nuit à l'autre.
    mapping = {}
    for r in rows:
        lien = r.get("lien_senat") or ""
        m = re.search(r"/dossier-legislatif/([^/.]+)", lien)
        if m:
            signet = m.group(1).strip()
            if signet in mapping:
                print(f"   ⚠️  Signet {signet} partagé par {mapping[signet]} et {r['uid']} : "
                      f"ses amendements Sénat vont à {r['uid']}")
            mapping[signet] = r["uid"]
    print(f"📋 {len(mapping)} signets Sénat → dossier_uid")
    return mapping


# ===================================================================
# Compteurs
# ===================================================================


class EluCounts:
    """Compteurs d'un élu. `sorts` détaille `auteur` par case de `SORTS_AMENDEMENT` ;
    tout passe par `compter_auteur`, ce qui garde la somme égale au total."""
    __slots__ = ("auteur", "cosign", "sorts")
    def __init__(self):
        self.auteur = 0
        self.cosign = 0
        self.sorts = dict.fromkeys(SORTS_AMENDEMENT, 0)

    def compter_auteur(self, sort: str) -> None:
        self.auteur += 1
        self.sorts[sort] += 1


class DossierCounts:
    """Compteurs d'un dossier, et leur détail par auteur.

    `par_groupe` : (chambre, type, groupe) → [déposés, adoptés], où `type` vaut
    « groupe » (avec l'uid d'organe du groupe de l'auteur au jour du dépôt),
    « gouvernement », « commission », « non_publie » ou « sans_groupe » (groupe à
    None). Tout passe par `compter`, ce qui garde la somme du détail égale aux deux
    totaux par construction.
    """
    __slots__ = ("deposes", "adoptes", "par_groupe")
    def __init__(self):
        self.deposes = 0
        self.adoptes = 0
        self.par_groupe: dict[tuple[str, str, str | None], list[int]] = {}

    def compter(self, cle: tuple[str, str, str | None], adopte: bool) -> None:
        self.deposes += 1
        detail = self.par_groupe.setdefault(cle, [0, 0])
        detail[0] += 1
        if adopte:
            self.adoptes += 1
            detail[1] += 1

    def repartition(self) -> list[dict] | None:
        """Valeur de `dossiers_legislatifs.amendements_par_groupe`.

        Triée par clé : l'ordre d'un tableau jsonb compte dans la comparaison de
        `mettre_a_jour`, et l'ordre de rencontre varie avec celui du dump.
        """
        if not self.par_groupe:
            return None
        return [
            {"chambre": chambre, "type": type_, "groupe": groupe, "deposes": d, "adoptes": a}
            for (chambre, type_, groupe), (d, a) in sorted(
                self.par_groupe.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2] or ""))
        ]


# ===================================================================
# Traitement AN
# ===================================================================


def _ligne_amendement_an(amd: dict, dossier_uid: str) -> dict:
    """Ligne de la table `amendements` pour un amendement adopté de l'Assemblée.

    L'URL est celle que l'Assemblée sert pour l'uid seul, `/dyn/17/amendements/{uid}`.
    Le motif lisible `/{n° du texte}/{organe}/{numéro}` ne distingue pas une seconde
    délibération (`…D2N…`) de la première : les deux menaient à la même page, celle
    d'un autre amendement et d'un autre auteur (40 liens au 2026-10-14). Il demandait
    en plus un suffixe par partie de loi de finances et le numéro de
    `texteLegislatifRef` plutôt que celui de l'uid. L'adresse par uid couvre tous ces
    cas, vérifiée en 200 sur chacun le 2026-10-14.
    """
    ident = amd.get("identification") or {}
    auteur = ((amd.get("signataires") or {}).get("auteur") or {})
    cycle = amd.get("cycleDeVie") or {}
    division = ((amd.get("pointeurFragmentTexte") or {}).get("division") or {})

    organe = ident.get("prefixeOrganeExamen") or "AN"
    numero = _sans_rectification(ident.get("numeroLong") or "")
    url = f"https://www.assemblee-nationale.fr/dyn/17/amendements/{amd['uid']}"

    type_auteur = auteur.get("typeAuteur", "")
    acteur_ref = auteur.get("acteurRef", "")
    if isinstance(acteur_ref, dict):
        acteur_ref = acteur_ref.get("#text", "")
    if type_auteur == "Gouvernement":
        auteur_type, auteur_uid = "gouvernement", None
    else:
        auteur_type = "rapporteur" if type_auteur == "Rapporteur" else "parlementaire"
        auteur_uid = acteur_ref or None

    # `dateSort` est un objet `xsi:nil` quand la date manque, jamais une chaîne vide.
    date_sort = cycle.get("dateSort")
    # Un champ absent est, là aussi, un objet `xsi:nil` : `_texte_brut` l'écarte.
    contenu = ((amd.get("corps") or {}).get("contenuAuteur") or {})
    dispositif = _texte_brut(contenu.get("dispositif")) or _credits_plf(
        contenu.get("dispositifAmdtCreditPLF") or contenu.get("dispositifAmdtCreditPLFR"))
    return {
        "uid": amd["uid"],
        "dossier_uid": dossier_uid,
        "chambre": "AN",
        "lieu": "seance" if organe == "AN" else "commission",
        "numero": numero,
        "article": _article_court(division.get("articleDesignationCourte")),
        "auteur_type": auteur_type,
        "auteur_uid": auteur_uid,
        "auteur_libelle": None,
        "date_amendement": date_sort[:10] if isinstance(date_sort, str) and date_sort else None,
        "url": url,
        "dispositif": dispositif,
        "expose": _texte_brut(contenu.get("exposeSommaire")),
    }


def _cle_groupe_an(auteur: dict) -> tuple[str, str, str | None]:
    """Clé de `DossierCounts.par_groupe` pour un amendement de l'Assemblée.

    `groupePolitiqueRef` est le groupe de l'auteur au jour du dépôt, publié avec
    l'amendement, rapporteur compris. Il manque pour le Gouvernement, et pour 5
    amendements de député sans auteur publié au 2026-10-25 (objet `xsi:nil`, jamais une
    chaîne vide). Un groupe renommé depuis porte son ancien uid : `GROUPE_ALIAS` le
    ramène à l'uid actif, celui que `organes` décrit.
    """
    if auteur.get("typeAuteur") == "Gouvernement":
        return ("AN", "gouvernement", None)
    groupe = auteur.get("groupePolitiqueRef")
    if isinstance(groupe, str) and groupe:
        return ("AN", "groupe", GROUPE_ALIAS.get(groupe, groupe))
    return ("AN", "sans_groupe", None)


def _sort_an(cycle: dict) -> str:
    """Case de `SORTS_AMENDEMENT` d'un amendement de l'Assemblée.

    Un amendement voté porte son sort. Les autres n'en ont pas (objet `xsi:nil`) et se
    lisent dans `etatDesTraitements.etat` : « Irrecevable » et « Irrecevable 40 »
    (article 40, dépense publique) n'ont jamais été discutés, « Retiré » l'a été avant
    la discussion, « En traitement » et « A discuter » attendent leur examen. Au
    2026-10-25, aucun amendement « Discuté » n'est sans sort.
    """
    sort = cycle.get("sort")
    if isinstance(sort, str) and sort:
        return SORTS_AN.get(sort, "autre")
    etat = (((cycle.get("etatDesTraitements") or {}).get("etat") or {}).get("libelle")) or ""
    if not isinstance(etat, str):
        return "autre"
    if etat.startswith("Irrecevable"):
        return "irrecevable"
    if etat == "Retiré":
        return "retire"
    if etat in ("En traitement", "A discuter"):
        return "en_attente"
    return "autre"


def process_an(known_dossier_uids: set, elu_counts: dict, dossier_counts: dict, adoptes: list,
               senateurs_actuels: set, par_elu: dict):
    """Traite les amendements de l'Assemblée nationale.

    En plus des compteurs, ajoute à `adoptes` une ligne de la table `amendements` par
    amendement adopté d'un dossier connu : exactement ceux que compte
    `dossier_counts[…].adoptes`. Compte dans `par_elu` les amendements de chaque
    auteur principal par dossier, Gouvernement exclu.

    `senateurs_actuels` : uid des sénateurs en exercice, que cette passe ne crédite pas.
    Un député élu sénateur garde son uid, et ses amendements de député s'ajoutaient à
    ceux du Sénat dans la même entrée : le 2026-10-15, un sénateur élu le 1er octobre
    en affichait 17 886 cosignés, tous déposés à l'Assemblée. Le dossier, lui, garde ses
    amendements quel que soit l'auteur.
    """
    print("\n" + "=" * 60)
    print("🏛️  ASSEMBLÉE NATIONALE — Amendements")
    print("=" * 60)

    print(f"📥 Téléchargement de {URL_AMENDEMENTS_AN}...")
    contenu = telecharger(URL_AMENDEMENTS_AN)
    print(f"   Taille : {len(contenu) / 1024 / 1024:.1f} Mo")

    zf = zipfile.ZipFile(io.BytesIO(contenu))
    json_files = [n for n in zf.namelist() if n.endswith(".json")]
    print(f"   {len(json_files)} fichiers JSON trouvés")

    total = 0
    skipped_dossier = 0
    skipped_gouv = 0
    counted = 0

    for name in tqdm(json_files, desc="Amendements AN"):
        try:
            with zf.open(name) as f:
                data = json.load(f)
        except (json.JSONDecodeError, KeyError):
            continue

        # Naviguer dans la structure JSON
        amd = data.get("amendement", data)
        signataires = (amd.get("signataires") or {})
        auteur = (signataires.get("auteur") or {})
        cycle = (amd.get("cycleDeVie") or {})

        # Extraire le dossier_uid depuis le path du fichier : json/DLR5L17Nxxxxx/.../...
        parts = name.split("/")
        dossier_uid = None
        for part in parts:
            if part.startswith("DLR5L17"):
                dossier_uid = part
                break

        if not dossier_uid or dossier_uid not in known_dossier_uids:
            skipped_dossier += 1
            continue

        total += 1

        # Sort de l'amendement (sous cycleDeVie.sort dans la législature 17)
        sort = cycle.get("sort", "")
        is_adopte = sort == "Adopté"

        # Comptage dossier (TOUS les amendements, y compris Gouvernement)
        dc = dossier_counts.get(dossier_uid)
        if dc is None:
            dc = DossierCounts()
            dossier_counts[dossier_uid] = dc
        dc.compter(_cle_groupe_an(auteur), is_adopte)
        if is_adopte:
            adoptes.append(_ligne_amendement_an(amd, dossier_uid))

        # Comptage élu (hors Gouvernement)
        type_auteur = auteur.get("typeAuteur", "")
        if type_auteur == "Gouvernement":
            skipped_gouv += 1
            continue

        counted += 1

        # Auteur principal
        acteur_ref = auteur.get("acteurRef", "")
        if isinstance(acteur_ref, dict):
            acteur_ref = acteur_ref.get("#text", "")
        if acteur_ref and acteur_ref not in senateurs_actuels:
            ec = elu_counts.get(acteur_ref)
            if ec is None:
                ec = EluCounts()
                elu_counts[acteur_ref] = ec
            ec.compter_auteur(_sort_an(cycle))
        # Sénateurs en exercice compris : sur un texte, un amendement déposé comme
        # député reste le sien (voir `ecrire_amendements_elus`).
        if acteur_ref:
            par_elu[(dossier_uid, "AN", acteur_ref)] += 1

        # Cosignataires
        cosign_data = signataires.get("cosignataires", None)
        if cosign_data:
            cosign_refs = (cosign_data.get("acteurRef") or []) if isinstance(cosign_data, dict) else []
            if isinstance(cosign_refs, str):
                cosign_refs = [cosign_refs]
            for ref in cosign_refs:
                if isinstance(ref, dict):
                    ref = ref.get("#text", "")
                if ref and ref not in senateurs_actuels:
                    ec = elu_counts.get(ref)
                    if ec is None:
                        ec = EluCounts()
                        elu_counts[ref] = ec
                    ec.cosign += 1

    print(f"\n   ✅ AN terminé : {total} amendements dans des dossiers connus")
    print(f"   ⏭️  {skipped_dossier} amendements hors dossiers connus (ignorés)")
    print(f"   🏛️  {skipped_gouv} amendements gouvernementaux (comptés pour le dossier, pas pour les élus)")
    print(f"   👤 {counted} amendements parlementaires comptabilisés pour les élus")
    print(f"   ✅ {len(adoptes)} amendements adoptés retenus pour la table amendements")


# ===================================================================
# Traitement Sénat
# ===================================================================


def parse_ameli_to_sqlite(zip_bytes: io.BytesIO) -> sqlite3.Connection:
    """Parse le dump ameli.zip (SQL PostgreSQL) et charge les tables utiles en SQLite."""
    print("🔄 Parsing du dump ameli vers SQLite...")

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    zf = zipfile.ZipFile(zip_bytes)
    sql_files = [n for n in zf.namelist() if n.endswith(".sql")]
    if not sql_files:
        raise FileNotFoundError("Aucun fichier .sql trouvé dans ameli.zip")
    sql_name = sql_files[0]
    print(f"   Fichier : {sql_name}")

    tables_loaded = {}

    # Le dump ameli.sql est encodé en LATIN1 (cf. `SET client_encoding = 'LATIN1'` en tête)
    with zf.open(sql_name) as f:
        lines = io.TextIOWrapper(f, encoding="latin-1")
        current_table = None
        columns = []
        rows_buffer = []

        for line in lines:
            if line.startswith("COPY "):
                match = re.match(r"COPY (\w+) \((.+?)\) FROM stdin;", line)
                if match:
                    table_name = match.group(1)
                    if table_name in TABLES_AMELI:
                        current_table = table_name
                        columns = [c.strip() for c in match.group(2).split(",")]
                        rows_buffer = []
                        cols_def = ", ".join(f'"{c}" TEXT' for c in columns)
                        cur.execute(f'DROP TABLE IF EXISTS "{current_table}"')
                        cur.execute(f'CREATE TABLE "{current_table}" ({cols_def})')
                continue

            if current_table and line.startswith("\\."):
                if rows_buffer:
                    placeholders = ", ".join("?" for _ in columns)
                    cur.executemany(
                        f'INSERT INTO "{current_table}" VALUES ({placeholders})',
                        rows_buffer,
                    )
                tables_loaded[current_table] = len(rows_buffer)
                current_table = None
                columns = []
                rows_buffer = []
                continue

            if current_table:
                values = line.rstrip("\n").split("\t")
                values = [None if v == "\\N" else v for v in values]
                if len(values) == len(columns):
                    rows_buffer.append(values)

    conn.commit()

    # Index pour les requêtes
    indexes = [
        ("amd", "id"),
        ("amd", "txtid"),
        ("amd", "sorid"),
        ("amdsen", "amdid"),
        ("amdsen", "senid"),
        ("sor", "id"),
        ("txt_ameli", "id"),
        ("txt_ameli", "doslegsignet"),
        ("ent", "id"),
        ("com_ameli", "entid"),
        ("ses", "id"),
        ("sub", "id"),
        ("sen_ameli", "entid"),
        ("grppol_ameli", "entid"),
    ]
    for table, col in indexes:
        if table in tables_loaded:
            try:
                cur.execute(f'CREATE INDEX IF NOT EXISTS "idx_{table}_{col}" ON "{table}" ("{col}")')
            except Exception:
                pass
    conn.commit()

    for table, count in tables_loaded.items():
        print(f"   {table} : {count} lignes")

    return conn


def _lignes_amendements_senat(cur, txtid_to_dossier: dict, adopte_sort_codes: set,
                              matricules: dict) -> list[dict]:
    """Lignes de la table `amendements` pour les amendements adoptés du Sénat.

    Même ensemble que le compteur `dossier_counts[…].adoptes` du Sénat : texte rattaché
    à un dossier connu, sort adopté, toutes dates. Le compteur des élus est borné au
    mandat en cours, celui du dossier non, et c'est le dossier qu'on décrit ici.

    L'auteur se lit dans `amd.nomentid`, dont `ent.typ` dit la nature :
    - B : le Gouvernement (une seule entité dans le dump) ;
    - E : un sénateur, l'entité elle-même ;
    - C : une commission. Le premier signataire d'`amdsen` est alors son rapporteur ;
      sans signataire, la commission est l'auteur (aucun cas au 2026-10-14 : tous
      les amendements de commission adoptés nomment un sénateur) ;
    - G et le reste : un groupe, représenté par son premier signataire.
    Le sénateur est résolu par son matricule (`sen_ameli.mat`, égal à
    `acteurs.matricule_senat`), pas par le nom comme les compteurs : sûr face aux
    homonymes, et valable pour un sénateur sorti. Un sénateur inconnu d'`acteurs`
    garde son nom brut dans `auteur_libelle`.

    URL vérifiées en 200 le 2026-10-14 : `/amendements/{session}/{n° du texte}/Amdt_{n°}.html`
    en séance, avec `commissions/` devant en commission. La session est celle du dépôt
    du texte (`sesdepid`), pas celle de son inscription (`sesinsid`) : les deux
    diffèrent sur 384 textes sur 8 982, et seule la première sert l'amendement
    (`ppl24-605`, inscrit en 2025-2026, est servi sous 2024-2025). Elle s'écrit
    l'année de `ses.ann` suivie de la suivante, y compris pour une session
    extraordinaire. Le numéro de texte perd sa mention « rect. », absente de l'URL.
    """
    known = list(txtid_to_dossier)
    marques = ",".join("?" for _ in known)
    codes = list(adopte_sort_codes)
    marques_codes = ",".join("?" for _ in codes)

    # Premier signataire de chaque amendement adopté (plus petit `rng`).
    premiers: dict[str, tuple] = {}
    cur.execute(f"""
        SELECT amdsen.amdid, amdsen.rng, amdsen.prenomuse, amdsen.nomuse, sen_ameli.mat
        FROM amdsen
        JOIN amd ON amd."id" = amdsen.amdid
        LEFT JOIN sen_ameli ON sen_ameli.entid = amdsen.senid
        WHERE amd.txtid IN ({marques}) AND trim(amd.sorid) IN ({marques_codes})
    """, known + codes)
    for r in cur.fetchall():
        rng = int(r["rng"] or "0")
        if r["amdid"] not in premiers or rng < premiers[r["amdid"]][0]:
            premiers[r["amdid"]] = (rng, r["prenomuse"], r["nomuse"], r["mat"])

    def senateur(prenom, nom, mat):
        uid = matricules.get((mat or "").strip())
        if uid:
            return uid, None
        return None, " ".join(x.strip() for x in (prenom, nom) if x and x.strip()) or None

    cur.execute(f"""
        SELECT amd."id", amd.num, amd.txtid, amd.datdep, amd.dis, amd.obj,
               txt_ameli.num AS txtnum, txt_ameli.txttyp, ses.ann,
               ent.typ AS enttyp, sub.lib AS sublib, com_ameli.lil AS comlil,
               sen_ameli.prenomuse, sen_ameli.nomuse, sen_ameli.mat
        FROM amd
        JOIN txt_ameli ON txt_ameli."id" = amd.txtid
        LEFT JOIN ses ON ses."id" = txt_ameli.sesdepid
        LEFT JOIN ent ON ent."id" = amd.nomentid
        LEFT JOIN sub ON sub."id" = amd.subid
        LEFT JOIN com_ameli ON com_ameli.entid = amd.nomentid
        LEFT JOIN sen_ameli ON sen_ameli.entid = amd.nomentid
        WHERE amd.txtid IN ({marques}) AND trim(amd.sorid) IN ({marques_codes})
    """, known + codes)

    lignes: dict[str, dict] = {}
    sans_lien = 0
    for r in cur.fetchall():
        dossier_uid = txtid_to_dossier.get(r["txtid"])
        m_txt = re.match(r"\d+", (r["txtnum"] or "").strip())
        numero = (r["num"] or "").strip()
        if not dossier_uid or not m_txt or not (r["ann"] or "").strip().isdigit() or not numero:
            sans_lien += 1
            continue
        annee = int(r["ann"].strip())
        commission = (r["txttyp"] or "").strip() == "C"
        url = (
            "https://www.senat.fr/amendements/"
            f"{'commissions/' if commission else ''}{annee}-{annee + 1}/{m_txt.group(0)}/Amdt_{numero}.html"
        )

        typ = (r["enttyp"] or "").strip()
        premier = premiers.get(r["id"])
        auteur_uid = auteur_libelle = None
        if typ == "B":
            auteur_type = "gouvernement"
        elif typ == "E":
            auteur_type = "parlementaire"
            auteur_uid, auteur_libelle = senateur(r["prenomuse"], r["nomuse"], r["mat"])
        elif typ == "C" and not premier:
            auteur_type = "commission"
            lil = (r["comlil"] or "").strip()
            auteur_libelle = (lil[:1].upper() + lil[1:]) or None
        else:
            auteur_type = "rapporteur" if typ == "C" else "parlementaire"
            if premier:
                auteur_uid, auteur_libelle = senateur(premier[1], premier[2], premier[3])

        lignes[r["id"]] = {
            "uid": f"SN{r['id']}",
            "dossier_uid": dossier_uid,
            "chambre": "SN",
            "lieu": "commission" if commission else "seance",
            "numero": numero,
            "article": _article_court(r["sublib"]),
            "auteur_type": auteur_type,
            "auteur_uid": auteur_uid,
            "auteur_libelle": auteur_libelle,
            "date_amendement": (r["datdep"] or "")[:10] or None,
            "url": url,
            # `dis` est le dispositif, `obj` l'exposé des motifs (« objet » au Sénat).
            "dispositif": _texte_brut(_copy_dechappe(r["dis"])),
            "expose": _texte_brut(_copy_dechappe(r["obj"])),
        }

    print(f"   ✅ {len(lignes)} amendements adoptés retenus pour la table amendements"
          + (f" ({sans_lien} écartés, sans URL constructible)" if sans_lien else ""))
    return list(lignes.values())


def _cles_groupe_senat(cur, txtids: list[str]) -> dict[str, tuple[str, str, str | None]]:
    """Clé de `DossierCounts.par_groupe` de chaque amendement du Sénat de ces textes.

    L'auteur se lit comme dans `_lignes_amendements_senat`, par `ent.typ` de
    `amd.nomentid` :
    - B : le Gouvernement ;
    - G : un groupe, l'entité elle-même (`grppol_ameli.entid`) ;
    - C sans signataire : la commission ;
    - sinon (E, ou C qui nomme son rapporteur) : le groupe du premier signataire
      d'`amdsen`, dont `grpid` est le groupe au jour de la signature. Le rapporteur
      compte donc dans son groupe, comme à l'Assemblée.
    Un amendement retiré avant la séance perd son auteur : `nomentid` vaut 0, sans
    signataire, sans texte ni sort (2 093 sur 32 357 déposés depuis juillet 2024,
    vérifiés « retiré avant séance » sur senat.fr le 2026-10-25). Il reste compté
    dans les déposés du dossier, sous « non_publie ».
    Un code de groupe absent de `GROUPES_AMELI_VERS_ORGANE` est compté sans groupe ;
    s'il n'est pas non plus dans `CODES_AMELI_SANS_ORGANE`, il est signalé : c'est un
    groupe nouveau, à ajouter à la table.
    """
    marques = ",".join("?" for _ in txtids)
    cur.execute("SELECT entid, cod FROM grppol_ameli")
    # Clés nettoyées comme les identifiants qu'on y cherche (`grpid`, `nomentid`).
    codes = {(r["entid"] or "").strip(): (r["cod"] or "").strip() for r in cur.fetchall()}

    # Groupe du premier signataire (plus petit `rng`) de chaque amendement.
    premiers: dict[str, tuple[int, str]] = {}
    cur.execute(f"""
        SELECT amdsen.amdid, amdsen.rng, amdsen.grpid
        FROM amdsen JOIN amd ON amd."id" = amdsen.amdid
        WHERE amd.txtid IN ({marques})
    """, txtids)
    for r in cur.fetchall():
        rng = int(r["rng"] or "0")
        if r["amdid"] not in premiers or rng < premiers[r["amdid"]][0]:
            premiers[r["amdid"]] = (rng, (r["grpid"] or "").strip())

    inconnus: dict[str, int] = defaultdict(int)

    def du_groupe(entid: str | None) -> tuple[str, str, str | None]:
        code = codes.get(entid or "")
        organe = GROUPES_AMELI_VERS_ORGANE.get(code or "")
        if organe:
            return ("SN", "groupe", organe)
        if code not in CODES_AMELI_SANS_ORGANE:
            inconnus[code or f"entité {entid or 'vide'}"] += 1
        return ("SN", "sans_groupe", None)

    cles: dict[str, tuple[str, str, str | None]] = {}
    cur.execute(f"""
        SELECT amd."id", trim(amd.nomentid) AS nomentid, trim(ent.typ) AS typ
        FROM amd LEFT JOIN ent ON ent."id" = amd.nomentid
        WHERE amd.txtid IN ({marques})
    """, txtids)
    for r in cur.fetchall():
        typ, premier = r["typ"], premiers.get(r["id"])
        if typ == "B":
            cles[r["id"]] = ("SN", "gouvernement", None)
        elif typ == "G":
            cles[r["id"]] = du_groupe(r["nomentid"])
        elif premier:
            cles[r["id"]] = du_groupe(premier[1])
        elif typ == "C":
            cles[r["id"]] = ("SN", "commission", None)
        elif r["nomentid"] == "0":
            cles[r["id"]] = ("SN", "non_publie", None)
        else:
            cles[r["id"]] = du_groupe(None)

    for code, n in sorted(inconnus.items(), key=lambda kv: -kv[1]):
        print(f"   ⚠️  Code de groupe ameli inconnu « {code} » : {n} amendement(s) comptés sans groupe. "
              "L'ajouter à GROUPES_AMELI_VERS_ORGANE (_positions_groupe.py).")
    return cles


def _amendements_par_elu_senat(cur, txtid_to_dossier: dict, matricules: dict, par_elu: dict) -> None:
    """Compte dans `par_elu` les amendements du Sénat de chaque auteur par dossier.

    L'auteur est le signataire de rang 0, comme pour `nb_amendements_auteur`, mais
    reconnu par son matricule (`sen_ameli.mat`) et non par son nom : le compteur ne
    connaît que les sénateurs en exercice, et un sénateur sorti en septembre 2026
    disparaîtrait sinon de ses propres textes. Sans borne de date, pour la même
    raison : sur un texte, tout ce qui a été déposé compte. Un signataire dont le
    matricule n'est pas dans `acteurs` est laissé de côté, la page ne sachant pas
    l'afficher.
    """
    known = list(txtid_to_dossier)
    marques = ",".join("?" for _ in known)
    cur.execute(f"""
        SELECT amd.txtid, amdsen.rng, sen_ameli.mat
        FROM amdsen
        JOIN amd ON amd."id" = amdsen.amdid
        LEFT JOIN sen_ameli ON sen_ameli.entid = amdsen.senid
        WHERE amd.txtid IN ({marques})
    """, known)
    comptes = inconnus = 0
    for r in cur.fetchall():
        if int(r["rng"] or "0") != 0:
            continue
        uid = matricules.get((r["mat"] or "").strip())
        if not uid:
            inconnus += 1
            continue
        par_elu[(txtid_to_dossier[r["txtid"]], "SN", uid)] += 1
        comptes += 1
    print(f"   👤 {comptes} amendements d'auteur rattachés à un sénateur par dossier"
          + (f" ({inconnus} sans matricule connu)" if inconnus else ""))


def process_senat(signet_map: dict, elu_counts: dict, dossier_counts: dict,
                  adoptes: list, matricules: dict, par_elu: dict):
    """Traite les amendements du Sénat.

    En plus des compteurs, ajoute à `adoptes` les lignes de la table `amendements`
    (voir `_lignes_amendements_senat`), et à `par_elu` les amendements de chaque
    auteur par dossier (voir `_amendements_par_elu_senat`). `matricules` : matricule
    Sénat → `acteurs.uid`.
    """
    print("\n" + "=" * 60)
    print("🏛️  SÉNAT — Amendements (ameli)")
    print("=" * 60)

    print(f"📥 Téléchargement de {URL_AMELI_SENAT}...")
    contenu = telecharger(URL_AMELI_SENAT)
    print(f"   Taille : {len(contenu) / 1024 / 1024:.1f} Mo")

    conn = parse_ameli_to_sqlite(io.BytesIO(contenu))
    cur = conn.cursor()

    # Vérifier les tables chargées
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    loaded_tables = {row[0] for row in cur.fetchall()}
    required = {"amd", "amdsen", "sen_ameli", "sor", "txt_ameli"}
    missing = required - loaded_tables
    if missing:
        print(f"⚠️  Tables manquantes : {missing} — on continue avec ce qui est disponible")

    # 1. Construire le mapping txtid → dossier_uid via txt_ameli.doslegsignet
    # (dans ameli, la colonne clé de txt_ameli est "id", pas "txtid")
    cur.execute('SELECT "id", doslegsignet FROM txt_ameli WHERE doslegsignet IS NOT NULL')
    txtid_to_dossier = {}
    for row in cur.fetchall():
        signet = (row["doslegsignet"] or "").strip()
        if signet in signet_map:
            txtid_to_dossier[row["id"]] = signet_map[signet]

    print(f"   {len(txtid_to_dossier)} textes ameli → dossiers connus")

    if not txtid_to_dossier:
        print("   ⚠️  Aucun amendement Sénat ne correspond à un dossier connu — skip")
        conn.close()
        return

    # 2. Construire le mapping des sorts adoptés
    # Dans ameli : table sor avec colonnes (id, lib, cod, typ)
    # Codes adoptés : A (Adopté séance), B (Adopté - vote unique), 1 (Adopté commission), 2 (Adopté avec modification)
    cur.execute('SELECT "id", lib FROM sor')
    adopte_sort_codes = set()
    for row in cur.fetchall():
        sid = (row["id"] or "").strip()
        libelle = (row["lib"] or "").strip().lower()
        if sid in SENAT_SORT_ADOPTE_CODES or "adopt" in libelle:
            adopte_sort_codes.add(sid)
    print(f"   Codes de sort 'adopté' : {adopte_sort_codes}")

    # 3. Construire le mapping (nom_normalisé, prenom_normalisé) → acteur_uid
    # On matche directement depuis amdsen qui contient nomuse/prenomuse
    # (pas besoin de jointure avec sen_ameli)
    with connexion() as conn:
        senateurs = lire(conn, "select uid, nom, prenom from acteurs where est_senateur_actuel")

    # Le dump ameli ne porte pas d'identifiant de sénateur exploitable dans `amdsen` :
    # on rattache par nom normalisé. Deux homonymes fusionneraient silencieusement, l'un
    # récupérant les amendements de l'autre. Aucun cas au 2026-08-31, mais rien ne
    # l'empêche : on le signale plutôt que de le découvrir dans un chiffre faux.
    acteurs_par_nom = {}
    for s in senateurs:
        key = (_normalize_name(s["nom"] or ""), _normalize_name(s["prenom"] or ""))
        if key in acteurs_par_nom:
            print(f"   ⚠️  Homonymes : {s['prenom']} {s['nom']} — {acteurs_par_nom[key]} et {s['uid']} "
                  f"partagent le même nom normalisé, leurs amendements seront confondus.")
        acteurs_par_nom[key] = s["uid"]

    print(f"   {len(acteurs_par_nom)} sénateurs en base indexés pour matching par nom")

    # 4. Parcourir les amendements filtrés par dossier connu
    # Récupérer les IDs de texte connus
    known_txtids = set(txtid_to_dossier.keys())
    placeholders = ",".join("?" for _ in known_txtids)

    # Comptage dossiers : tous les amendements (y compris Gouvernement)
    # Dans ameli, le sort est dans amd.sorid (pas sorcod)
    # La répartition lit `ent` et `grppol_ameli`, dont les compteurs se passent : comme
    # pour les lignes de la table plus bas, une table absente du dump ne doit pas
    # empêcher les compteurs de la nuit de s'écrire. Ses amendements sont alors comptés
    # sans groupe connu, et l'erreur reste dans le journal.
    try:
        cles_groupe = _cles_groupe_senat(cur, list(known_txtids))
    except sqlite3.Error as e:
        print(f"❌ Répartition par groupe du Sénat non construite : {e}")
        cles_groupe = {}
    cur.execute(f"""
        SELECT amd."id", amd.txtid, amd.sorid
        FROM amd
        WHERE amd.txtid IN ({placeholders})
    """, list(known_txtids))

    total_senat = 0
    for row in cur.fetchall():
        txtid = row["txtid"]
        dossier_uid = txtid_to_dossier.get(txtid)
        if not dossier_uid:
            continue

        total_senat += 1
        dc = dossier_counts.get(dossier_uid)
        if dc is None:
            dc = DossierCounts()
            dossier_counts[dossier_uid] = dc
        sorid = (row["sorid"] or "").strip()
        dc.compter(cles_groupe.get(row["id"], ("SN", "sans_groupe", None)), sorid in adopte_sort_codes)

    print(f"   📊 {total_senat} amendements Sénat dans des dossiers connus (comptage dossiers)")

    # Les lignes de la table lisent quatre tables du dump (`ent`, `ses`, `sub`,
    # `com_ameli`) dont les compteurs se passent : si l'une manque, les compteurs de
    # la nuit s'écrivent quand même, et le garde-fou par chambre d'`ecrire_amendements`
    # refuse ensuite de vider les lignes du Sénat (sortie en erreur, donc alerte).
    try:
        adoptes.extend(_lignes_amendements_senat(cur, txtid_to_dossier, adopte_sort_codes, matricules))
    except sqlite3.Error as e:
        print(f"❌ Lignes Sénat de la table amendements non construites : {e}")

    # Même posture : sans ses lignes du Sénat, le garde-fou d'`ecrire_amendements_elus`
    # refuse de vider celles de la base.
    try:
        _amendements_par_elu_senat(cur, txtid_to_dossier, matricules, par_elu)
    except sqlite3.Error as e:
        print(f"❌ Amendements par élu du Sénat non comptés : {e}")

    # Comptage élus : auteurs (rng=0) et cosignataires (rng>0)
    # Le dump ameli ne contient que des sénateurs dans amdsen (pas le Gouvernement)
    # amdsen contient directement nomuse/prenomuse — match par nom normalisé
    #
    # `amd.datdep >= SENAT_DERNIERE_ELECTION` borne le compteur au mandat en cours, comme
    # toutes les autres métriques du score d'activité. `ameli.zip` couvre **toutes** les
    # législatures : sans ce filtre, un sénateur réélu portait au numérateur des
    # amendements déposés avant son mandat, divisés par un dénominateur qui, lui, démarre
    # à l'élection. Le filtre ne vaut que pour les compteurs d'élus : le compteur du
    # dossier, lui, décrit le dossier et garde tous ses amendements.
    #
    # Sans sort, un amendement est irrecevable s'il porte un motif (`amd.irrid`, article
    # 40, LOLF, cavalier…), sinon il attend son examen. Un amendement retiré avant la
    # séance n'a ni signataire ni sort (voir `_cles_groupe_senat`) : absent d'`amdsen`,
    # il n'est compté pour aucun élu, ce qui était déjà le cas du total.
    cur.execute(f"""
        SELECT amdsen.nomuse, amdsen.prenomuse, amdsen.rng, amd.sorid, amd.irrid
        FROM amdsen
        JOIN amd ON amdsen.amdid = amd."id"
        WHERE amd.txtid IN ({placeholders})
          AND amd.datdep IS NOT NULL
          AND substr(amd.datdep, 1, 10) >= ?
    """, list(known_txtids) + [SENAT_DERNIERE_ELECTION])

    counted_auteur = 0
    counted_cosign = 0
    unmatched = 0
    for row in cur.fetchall():
        key = (_normalize_name(row["nomuse"] or ""), _normalize_name(row["prenomuse"] or ""))
        acteur_uid = acteurs_par_nom.get(key)
        if not acteur_uid:
            unmatched += 1
            continue

        rng = int(row["rng"] or "0")

        ec = elu_counts.get(acteur_uid)
        if ec is None:
            ec = EluCounts()
            elu_counts[acteur_uid] = ec

        if rng == 0:
            sorid = (row["sorid"] or "").strip()
            if sorid in adopte_sort_codes:
                sort = "adopte"
            elif sorid:
                sort = SORTS_SENAT.get(sorid, "autre")
            else:
                sort = "irrecevable" if (row["irrid"] or "").strip() else "en_attente"
            ec.compter_auteur(sort)
            counted_auteur += 1
        else:
            ec.cosign += 1
            counted_cosign += 1

    print(f"   👤 {counted_auteur} enregistrements auteur, {counted_cosign} cosignataire ({unmatched} sans match en base)")

    conn.close()


# ===================================================================
# Merge et upsert
# ===================================================================


def upsert_results(elu_counts: dict, dossier_counts: dict):
    """Écrit les comptages en base, une requête par table.

    Les compteurs des parlementaires en exercice absents du comptage sont remis à zéro
    dans la même transaction que la mise à jour des acteurs : sans ça, un élu qui disparaît de la source garderait
    indéfiniment sa vieille valeur. Même patron que `recalc_nb_prises_parole()`
    (D-036). Les dossiers absents du comptage sont remis à zéro de la même façon :
    un dossier en sort quand l'Assemblée lui retire son lien Sénat ou déplace ses
    textes vers un nouveau dossier, et il gardait alors les chiffres de l'autre. Le
    2026-10-14, deux fiches affichaient ainsi 163 et 9 amendements qui n'étaient pas
    les leurs (`DLR5L17N52596`, doublon de `DLR5L17N54344`, et `DLR5L17N54290`,
    rattaché un temps à `ppl24-605`).

    Seules les lignes dont une valeur change sont écrites (`_db.mettre_a_jour`). Une
    erreur lève et annule tout, au lieu d'être comptée puis oubliée comme le faisait
    l'ancienne boucle ligne à ligne.

    La répartition par groupe s'écrit dans la même transaction que les compteurs des
    dossiers, dont elle est le détail, mais à part : la remise à zéro de
    `mettre_a_jour` n'écrit que des nombres. Un dossier absent du comptage repasse à
    NULL, pour la même raison que ses compteurs repassent à 0. Le sort des amendements
    d'un élu suit le même patron, dans la transaction de ses compteurs.
    """
    print("\n" + "=" * 60)
    print("📤 MISE À JOUR EN BASE")
    print("=" * 60)

    acteur_rows = [
        {
            "uid": uid,
            "nb_amendements_auteur": ec.auteur,
            "nb_amendements_cosignataire": ec.cosign,
        }
        for uid, ec in elu_counts.items()
    ]
    # Un élu qui n'a que cosigné n'a pas de sort à détailler : NULL, comme un élu absent.
    sorts_rows = [
        {"uid": uid, "amendements_par_sort": ec.sorts if ec.auteur else None}
        for uid, ec in elu_counts.items()
    ]
    dossier_rows = [
        {
            "uid": uid,
            "nb_amendements_deposes": dc.deposes,
            "nb_amendements_adoptes": dc.adoptes,
        }
        for uid, dc in dossier_counts.items()
    ]
    repartition_rows = [
        {"uid": uid, "amendements_par_groupe": dc.repartition()}
        for uid, dc in dossier_counts.items()
    ]

    with connexion() as conn:
        with conn.transaction():
            n = mettre_a_jour(
                conn, "acteurs", "uid",
                {"nb_amendements_auteur": "int", "nb_amendements_cosignataire": "int"},
                acteur_rows,
                remise_a_zero="t.est_depute_actuel OR t.est_senateur_actuel",
            )
            print(f"   👤 {len(acteur_rows)} acteurs comptés, {n} ligne(s) modifiée(s)")
            n = mettre_a_jour(conn, "acteurs", "uid", {"amendements_par_sort": "jsonb"}, sorts_rows)
            with conn.cursor() as cur:
                # Même périmètre que la remise à zéro des compteurs juste au-dessus.
                cur.execute(
                    "UPDATE acteurs SET amendements_par_sort = NULL "
                    "WHERE amendements_par_sort IS NOT NULL "
                    "AND (est_depute_actuel OR est_senateur_actuel) AND NOT (uid = ANY(%s))",
                    ([r["uid"] for r in sorts_rows],),
                )
                n += cur.rowcount
            print(f"   📊 Sort des amendements par élu : {n} ligne(s) modifiée(s)")
        with conn.transaction():
            n = mettre_a_jour(
                conn, "dossiers_legislatifs", "uid",
                {"nb_amendements_deposes": "int", "nb_amendements_adoptes": "int"},
                dossier_rows,
                remise_a_zero="true",
            )
            print(f"   📁 {len(dossier_rows)} dossiers comptés, {n} ligne(s) modifiée(s)")
            n = mettre_a_jour(
                conn, "dossiers_legislatifs", "uid",
                {"amendements_par_groupe": "jsonb"},
                repartition_rows,
            )
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE dossiers_legislatifs SET amendements_par_groupe = NULL "
                    "WHERE amendements_par_groupe IS NOT NULL AND NOT (uid = ANY(%s))",
                    ([r["uid"] for r in repartition_rows],),
                )
                n += cur.rowcount
            print(f"   📊 Répartition par groupe : {n} ligne(s) modifiée(s)")

    print("   ✅ Mise à jour terminée")


ESSAIS_ECRITURE_AMENDEMENTS = 3

# Colonnes réconciliées en une transaction par `_reconcilier_amendements`. Le texte
# (`dispositif` et `expose`) n'en fait pas partie : il pèse environ 50 Mo pour les
# adoptés. Envoyé dans la même requête depuis un poste local le 2026-10-15, la
# connexion a lâché pendant l'envoi (« Connection reset by peer » côté Postgres) et la
# passe est restée bloquée plus de vingt minutes, alors que la base exécute la même
# requête en 11 s quand elle lui parvient. Il s'écrit donc à part, par lots et
# seulement là où il change (`_ecrire_textes`).
COLONNES_AMENDEMENTS = {
    "dossier_uid": "text", "chambre": "text", "lieu": "text", "numero": "text",
    "article": "text", "auteur_type": "text", "auteur_uid": "text",
    "auteur_libelle": "text", "date_amendement": "date", "url": "text",
}

# 500 lignes font environ 1 Mo de texte (50 Mo pour environ 26 000 adoptés ; dispositif de
# 565 octets en moyenne, le plus long 69 Ko, mesuré le 2026-10-29) : un envoi court, et un
# échec ne coûte qu'un lot.
TAILLE_LOT_TEXTES = 500


def charger_matricules() -> dict:
    """Matricule Sénat → `acteurs.uid`, pour tous les acteurs qui en ont un (sortis compris)."""
    with connexion() as conn, conn.cursor() as cur:
        cur.execute("SELECT matricule_senat, uid FROM acteurs WHERE matricule_senat IS NOT NULL")
        return {mat.strip(): uid for mat, uid in cur.fetchall() if mat and mat.strip()}


def ecrire_amendements(lignes: list[dict]) -> None:
    """Réconcilie la table `amendements` avec le lot de la nuit : les métadonnées en une
    transaction, puis le dispositif et l'exposé par lots (`_ecrire_textes`).

    Insère les nouveaux, met à jour ceux dont une colonne change (`IS DISTINCT FROM` :
    une ligne inchangée n'est pas réécrite), supprime ceux qui ne sont plus dans le lot.
    La suppression est ce qui retire un amendement dont le sort a été corrigé, ou un
    dossier qui sort du périmètre.

    Garde-fou : si, pour une chambre, le lot compte moins de la moitié de ses lignes
    en base, rien n'est écrit et la fonction lève. Le Sénat a déjà publié un dump
    vide ou tronqué, et la réconciliation viderait alors ses lignes. Le seuil se
    compte par chambre et non sur le total : au 2026-10-14, le Sénat ne pèse que
    10 507 lignes sur 26 242, et un lot sans aucune ligne du Sénat passait un seuil
    global. Appelée après `upsert_results` : un refus ici laisse les compteurs de la
    nuit écrits.
    """
    print("\n" + "=" * 60)
    print("📤 TABLE AMENDEMENTS")
    print("=" * 60)

    # Un uid en double ferait échouer tout l'INSERT (`ON CONFLICT` ne touche pas deux
    # fois la même ligne) : on le signale plutôt que de perdre la nuit.
    par_uid = {l["uid"]: l for l in lignes}
    if len(par_uid) != len(lignes):
        print(f"   ⚠️  {len(lignes) - len(par_uid)} uid en double dans le lot, gardés une fois")
    lignes = list(par_uid.values())

    # La connexion est tombée sur « SSL error » 3 lancements sur 11 le 2026-10-14,
    # depuis un poste local, pendant cette écriture et jamais pendant celle des
    # compteurs ; envoyer le lot par paquets n'y changeait rien, et la cause n'est pas
    # établie. La transaction étant annulée en entier, la rejouer ne risque rien.
    for essai in range(1, ESSAIS_ECRITURE_AMENDEMENTS + 1):
        try:
            inseres, modifies, supprimes = _reconcilier_amendements(lignes)
            break
        except psycopg.OperationalError as e:
            if essai == ESSAIS_ECRITURE_AMENDEMENTS:
                raise
            print(f"   ⚠️  Connexion perdue (essai {essai}) : {e}. Transaction annulée, nouvel essai.")

    print(f"   {len(lignes)} amendements adoptés : {inseres} insérés, {modifies} modifiés, "
          f"{supprimes} supprimés")

    a_ecrire, ecrits = _ecrire_textes(lignes)
    print(f"   Texte : {a_ecrire} ligne(s) à écrire, {ecrits} écrite(s)")


def _empreinte_texte(ligne: dict) -> tuple[str, bool, bool]:
    """Empreinte du texte d'une ligne, calculée comme la requête de `_ecrire_textes`.

    Le md5 de Postgres hache le texte en UTF-8, l'encodage de la base : les deux
    calculs donnent la même valeur. Les deux booléens distinguent un NULL d'un texte
    vide, que `coalesce` confondrait.
    """
    d, e = ligne.get("dispositif"), ligne.get("expose")
    h = hashlib.md5(f"{d or ''}\x01{e or ''}".encode("utf-8")).hexdigest()
    return h, d is None, e is None


def _ecrire_textes(lignes: list[dict]) -> tuple[int, int]:
    """Écrit `dispositif` et `expose` des lignes dont la valeur diffère de la base.

    Appelée après la réconciliation, qui a déjà inséré les nouvelles lignes (texte
    NULL, donc à écrire ici) et supprimé les disparues. Seules les empreintes, calculées
    par la base, sont lues (environ 2 Mo), et seules les lignes qui changent sont
    envoyées : une nuit ordinaire n'écrit que les amendements nouveaux ou rectifiés, pas
    les 50 Mo de texte.

    Un lot par transaction : un lot écrit le reste si un suivant échoue, et la passe
    suivante reprend là où celle-ci s'est arrêtée, puisqu'elle recompare tout. Un lot
    qui échoue trois fois lève, et l'étape sort en erreur.
    Renvoie (lignes à écrire, lignes écrites).
    """
    with connexion() as conn, conn.cursor() as cur:
        cur.execute("SELECT uid, md5(coalesce(dispositif, '') || chr(1) || coalesce(expose, '')), "
                    "dispositif IS NULL, expose IS NULL FROM amendements")
        en_base = {uid: (h, dn, en) for uid, h, dn, en in cur.fetchall()}

    a_ecrire = [{"uid": l["uid"], "dispositif": l.get("dispositif"), "expose": l.get("expose")}
                for l in lignes if l["uid"] in en_base and en_base[l["uid"]] != _empreinte_texte(l)]

    ecrits = 0
    for i in range(0, len(a_ecrire), TAILLE_LOT_TEXTES):
        lot = json.dumps(a_ecrire[i : i + TAILLE_LOT_TEXTES], ensure_ascii=False)
        for essai in range(1, ESSAIS_ECRITURE_AMENDEMENTS + 1):
            try:
                with connexion() as conn, conn.transaction(), conn.cursor() as cur:
                    cur.execute(
                        """
                        UPDATE amendements a SET dispositif = v.dispositif, expose = v.expose
                        FROM jsonb_to_recordset(%s::jsonb) AS v(uid text, dispositif text, expose text)
                        WHERE a.uid = v.uid
                          AND (a.dispositif, a.expose) IS DISTINCT FROM (v.dispositif, v.expose)
                        """,
                        (lot,),
                    )
                    ecrits += cur.rowcount
                break
            except psycopg.OperationalError as e:
                if essai == ESSAIS_ECRITURE_AMENDEMENTS:
                    raise
                print(f"   ⚠️  Lot de texte {i // TAILLE_LOT_TEXTES + 1} en échec (essai {essai}) : {e}")
    return len(a_ecrire), ecrits


def _reconcilier_amendements(lignes: list[dict]) -> tuple[int, int, int]:
    """Une transaction de `ecrire_amendements` : garde-fou, suppression, upsert.

    Renvoie (insérés, modifiés, supprimés). Lève `RuntimeError` si le garde-fou
    refuse le lot, sans rien écrire.
    """
    colonnes = list(COLONNES_AMENDEMENTS)
    definition = ", ".join(["uid text"] + [f"{c} {t}" for c, t in COLONNES_AMENDEMENTS.items()])

    with connexion() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT chambre, count(*) FROM amendements GROUP BY chambre")
        for chambre, en_base in cur.fetchall():
            dans_lot = sum(1 for l in lignes if l["chambre"] == chambre)
            if dans_lot < en_base / 2:
                raise RuntimeError(
                    f"Lot de {dans_lot} amendements {chambre} pour {en_base} en base : moins de "
                    "la moitié, dump probablement vide ou tronqué. Table amendements laissée en l'état."
                )

        cur.execute("DELETE FROM amendements WHERE NOT (uid = ANY(%s))", ([l["uid"] for l in lignes],))
        supprimes = cur.rowcount

        cur.execute(
            f"""
            INSERT INTO amendements (uid, {", ".join(colonnes)})
            SELECT uid, {", ".join(colonnes)}
            FROM jsonb_to_recordset(%s::jsonb) AS v({definition})
            ON CONFLICT (uid) DO UPDATE SET
              {", ".join(f"{c} = excluded.{c}" for c in colonnes)}
            WHERE ROW({", ".join(f"amendements.{c}" for c in colonnes)})
                  IS DISTINCT FROM ROW({", ".join(f"excluded.{c}" for c in colonnes)})
            RETURNING (xmax = 0) AS insere
            """,
            # Les seules colonnes réconciliées : le texte gonflerait le paquet de 50 Mo
            # pour rien, `jsonb_to_recordset` ne lisant que celles de `definition`.
            (json.dumps([{c: l[c] for c in ["uid", *colonnes]} for l in lignes], ensure_ascii=False),),
        )
        retours = [r[0] for r in cur.fetchall()]
        inseres = sum(1 for r in retours if r)
    return inseres, len(retours) - inseres, supprimes


# Environ 500 lignes de quatre petites colonnes : quelques dizaines de Ko par lot.
TAILLE_LOT_ELUS = 500


def ecrire_amendements_elus(par_elu: dict) -> None:
    """Réconcilie `dossier_amendements_elus` avec le comptage de la nuit.

    `par_elu` : (dossier_uid, chambre, acteur_uid) → amendements déposés comme auteur
    principal. Lue par la section « Les plus actifs dans ce dossier » de la fiche dossier.

    La table est lue en base (environ 1 Mo) et comparée en local : seules les lignes
    nouvelles, changées ou disparues partent, par lots de `TAILLE_LOT_ELUS`, une
    transaction par lot. Chaque lot se rejoue sans risque (upsert, suppression par
    clé), et une passe interrompue est reprise par la suivante, qui recompare tout.

    Garde-fou, comme `ecrire_amendements` : si une chambre compte dans le lot moins de
    la moitié de ses lignes en base, rien n'est écrit et la fonction lève.
    """
    print("\n" + "=" * 60)
    print("📤 TABLE DOSSIER_AMENDEMENTS_ELUS")
    print("=" * 60)

    with connexion() as conn, conn.cursor() as cur:
        cur.execute("SELECT dossier_uid, chambre, acteur_uid, nb_deposes FROM dossier_amendements_elus")
        en_base = {(d, c, a): n for d, c, a, n in cur.fetchall()}

    for chambre in ("AN", "SN"):
        n_base = sum(1 for k in en_base if k[1] == chambre)
        n_lot = sum(1 for k in par_elu if k[1] == chambre)
        if n_lot < n_base / 2:
            raise RuntimeError(
                f"Lot de {n_lot} lignes {chambre} pour {n_base} en base : moins de la moitié, "
                "dump probablement vide ou tronqué. Table dossier_amendements_elus laissée en l'état."
            )

    a_ecrire = [
        {"dossier_uid": d, "chambre": c, "acteur_uid": a, "nb_deposes": n}
        for (d, c, a), n in sorted(par_elu.items()) if en_base.get((d, c, a)) != n
    ]
    a_supprimer = [
        {"dossier_uid": d, "chambre": c, "acteur_uid": a}
        for (d, c, a) in sorted(en_base) if (d, c, a) not in par_elu
    ]
    inseres = sum(1 for l in a_ecrire if (l["dossier_uid"], l["chambre"], l["acteur_uid"]) not in en_base)

    def par_lots(lignes: list[dict], sql: str) -> None:
        for i in range(0, len(lignes), TAILLE_LOT_ELUS):
            lot = json.dumps(lignes[i : i + TAILLE_LOT_ELUS], ensure_ascii=False)
            for essai in range(1, ESSAIS_ECRITURE_AMENDEMENTS + 1):
                try:
                    with connexion() as conn, conn.transaction(), conn.cursor() as cur:
                        cur.execute(sql, (lot,))
                    break
                except psycopg.OperationalError as e:
                    if essai == ESSAIS_ECRITURE_AMENDEMENTS:
                        raise
                    print(f"   ⚠️  Lot {i // TAILLE_LOT_ELUS + 1} en échec (essai {essai}) : {e}")

    par_lots(a_ecrire, """
        INSERT INTO dossier_amendements_elus (dossier_uid, chambre, acteur_uid, nb_deposes)
        SELECT dossier_uid, chambre, acteur_uid, nb_deposes
        FROM jsonb_to_recordset(%s::jsonb)
          AS v(dossier_uid text, chambre text, acteur_uid text, nb_deposes int)
        ON CONFLICT (dossier_uid, chambre, acteur_uid) DO UPDATE SET nb_deposes = excluded.nb_deposes
    """)
    par_lots(a_supprimer, """
        DELETE FROM dossier_amendements_elus t
        USING jsonb_to_recordset(%s::jsonb) AS v(dossier_uid text, chambre text, acteur_uid text)
        WHERE (t.dossier_uid, t.chambre, t.acteur_uid) = (v.dossier_uid, v.chambre, v.acteur_uid)
    """)
    print(f"   {len(par_elu)} lignes : {inseres} insérées, {len(a_ecrire) - inseres} modifiées, "
          f"{len(a_supprimer)} supprimées")


# ===================================================================
# Main
# ===================================================================


def main():
    print("=" * 60)
    print("IMPORT DES AMENDEMENTS (AN + SÉNAT)")
    print("=" * 60)

    # Pré-chargement
    known_dossier_uids = load_known_dossier_uids()
    signet_map = build_signet_to_dossier_map()
    matricules = charger_matricules()
    # Filtré côté Postgres, comme la liste de `process_senat` : environ 350 lignes au lieu
    # de toute la table `acteurs`.
    with connexion() as conn:
        senateurs_actuels = {
            r["uid"] for r in lire(conn, "select uid from acteurs where est_senateur_actuel")
        }

    # Compteurs partagés
    elu_counts: dict[str, EluCounts] = {}
    dossier_counts: dict[str, DossierCounts] = {}
    adoptes: list[dict] = []
    par_elu: dict[tuple[str, str, str], int] = defaultdict(int)

    # Les deux passes doivent réussir avant d'écrire quoi que ce soit. Une panne au
    # milieu du parcours AN laissait `elu_counts` partiel, et `upsert_results` l'écrivait
    # par-dessus les bonnes valeurs : le script sortait en code 0, le cron enchaînait, et
    # le score d'activité se recalculait sur des compteurs dégonflés sans que rien
    # n'alerte. Les compteurs de dossiers, eux, agrègent les deux chambres : les écrire
    # après une seule passe les sous-compterait de toute façon.
    echecs: list[str] = []

    try:
        process_an(known_dossier_uids, elu_counts, dossier_counts, adoptes, senateurs_actuels, par_elu)
    except Exception as e:
        print(f"❌ Erreur AN : {e}")
        import traceback
        traceback.print_exc()
        echecs.append("AN")

    try:
        process_senat(signet_map, elu_counts, dossier_counts, adoptes, matricules, par_elu)
    except Exception as e:
        print(f"❌ Erreur Sénat : {e}")
        import traceback
        traceback.print_exc()
        echecs.append("Sénat")

    if echecs:
        print(f"\n❌ Passe(s) en échec : {', '.join(echecs)} — aucune écriture.")
        print("   Les compteurs de la veille restent en place, le score ne sera pas rafraîchi.")
        sys.exit(1)

    upsert_results(elu_counts, dossier_counts)
    ecrire_amendements(adoptes)
    ecrire_amendements_elus(par_elu)

    # Résumé
    total_auteur = sum(ec.auteur for ec in elu_counts.values())
    total_cosign = sum(ec.cosign for ec in elu_counts.values())
    total_sorts = {s: sum(ec.sorts[s] for ec in elu_counts.values()) for s in SORTS_AMENDEMENT}
    total_dossiers = len(dossier_counts)
    total_deposes = sum(dc.deposes for dc in dossier_counts.values())
    total_adoptes_dossiers = sum(dc.adoptes for dc in dossier_counts.values())

    print("\n" + "=" * 60)
    print("📊 RÉSUMÉ FINAL")
    print("=" * 60)
    print(f"   Élus : {len(elu_counts)} acteurs enrichis")
    print(f"     - {total_auteur} amendements en tant qu'auteur")
    print(f"     - {total_cosign} amendements en tant que cosignataire")
    print(f"     - sort des amendements d'auteur : {', '.join(f'{s} {n}' for s, n in total_sorts.items())}")
    print(f"   Dossiers : {total_dossiers} dossiers enrichis")
    print(f"     - {total_deposes} amendements déposés au total")
    print(f"     - {total_adoptes_dossiers} amendements adoptés au total")


if __name__ == "__main__":
    main()
