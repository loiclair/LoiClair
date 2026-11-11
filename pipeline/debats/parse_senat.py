"""Parser des comptes-rendus intégraux (CRI) du Sénat.

Structure réelle (XHTML + namespace `cri:`) :

    <?xml version="1.0" encoding="ISO-8859-1"?>
    <cri:cri xmlns:cri="http://senat.fr/schemas/thb/cri"
             xmlns="http://www.w3.org/1999/xhtml">
      <html><head>…</head><body>
        <cri:sommaire>…</cri:sommaire>                     <!-- TOC, ignoré -->
        <cri:corps parid="par_1">
          <cri:titreS1 type="sect_autredivers" libelle="Présidence de M. X"/>
          <cri:pdl lecassidt="105562">
            <cri:titreS1 type="sect_pdl" signet="ppl25-321" libelle="Titre du texte"/>
            …
          </cri:pdl>
          <div class="intervenant">
            <cri:intervenant id="int_5" mat="19175S" nom="Aurore BERGÉ" civ="Mme"
                             qua="ministre…" type="2">
              <p>Monsieur le président, mesdames et messieurs…</p>
              <p>(paragraphe suivant de la même intervention)</p>
            </cri:intervenant>
          </div>
          …
        </cri:corps>
      </body></html>
    </cri:cri>

Les métadonnées (date, référence) sont déduites du nom de fichier
`cri/d20260409.xml` → `2026-04-09`, `SEN:d20260409`.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any
from xml.etree import ElementTree as ET

try:
    from lxml import etree as LET  # type: ignore
    _HAS_LXML = True
except ImportError:  # pragma: no cover
    _HAS_LXML = False

from ._common import clean_text, norm_ws, slugify_signet, strip_xmlns


# ElementTree "Clark notation" pour chaque namespace utilisé
_NS_CRI = "http://senat.fr/schemas/thb/cri"
_NS_XHTML = "http://www.w3.org/1999/xhtml"

_TYPE_SECT_PDL = "sect_pdl"

_DATE_FROM_FILENAME = re.compile(r"d(\d{8})")

# XHTML void-elements écrits sans auto-fermeture cassent ElementTree. On les
# corrige avant parsing : <link rel="…"> → <link rel="…"/>
_VOID_TAGS = ("link", "br", "hr", "img", "meta", "input", "area", "base", "col", "param")
_VOID_REGEX = re.compile(
    r"<(" + "|".join(_VOID_TAGS) + r")\b([^>/]*)(?<!/)>",
    re.IGNORECASE,
)


def _sanitize_xhtml(raw: str) -> str:
    return _VOID_REGEX.sub(r"<\1\2/>", raw)


def _local(tag: Any) -> str:
    """Retourne le local-name ; tolère les objets lxml non-éléments (Comment, PI)."""
    if not isinstance(tag, str):
        return ""
    return strip_xmlns(tag)


def _extract_date_and_ref(source_name: str) -> tuple[str | None, str | None]:
    """Du nom de fichier CRI, extrait (date ISO, ref séance)."""
    base = source_name.rsplit("/", 1)[-1].rsplit(".", 1)[0]  # ex: d20260409
    m = _DATE_FROM_FILENAME.search(base)
    if not m:
        return None, base or None
    ymd = m.group(1)
    try:
        date_iso = f"{ymd[0:4]}-{ymd[4:6]}-{ymd[6:8]}"
    except IndexError:
        date_iso = None
    return date_iso, base


def _intervenant_nom(elem: ET.Element) -> str | None:
    raw = elem.get("nom")
    if not raw:
        return None
    # "IACOVELLI" → "Iacovelli" ; on garde l'apparence originale mais strip()
    return raw.strip() or None


def _intervenant_civ(elem: ET.Element) -> str | None:
    c = (elem.get("civ") or "").strip()
    return c or None


def _intervenant_qua(elem: ET.Element) -> str | None:
    q = (elem.get("qua") or "").strip()
    return q or None


def _intervenant_mat(elem: ET.Element) -> str | None:
    m = (elem.get("mat") or "").strip()
    return m or None


def _paragraph_text(p_elem: ET.Element) -> str:
    """Texte d'un <p>, en supprimant les balises cri:orateurnom et cri:orateurqualite
    (leur contenu est une étiquette "M. le président." qui duplique l'attribut `nom` ;
    quand `nom` est vide, parse_senat_xml la récupère par _etiquette_orateur)."""
    parts: list[str] = []

    def walk(e: ET.Element) -> None:
        tag = _local(e.tag)
        if tag in ("orateurnom", "orateurqualite"):
            # Les tail de ces éléments appartiennent au parent — on continue via caller
            return
        if e.text:
            parts.append(e.text)
        for child in e:
            walk(child)
            if child.tail:
                parts.append(child.tail)

    walk(p_elem)
    return norm_ws("".join(parts))


# Au-delà, l'étiquette <cri:orateurnom> n'est pas un nom : le Sénat y a balisé du discours.
# Relevé le 2026-10-15 sur tout `cri.zip` : le plus long nom ainsi retenu fait 85
# caractères, les 25 étiquettes qui dépassent 90 sont des phrases (Congrès de 2007 à
# 2009, et une phrase de conclusion le 2026-10-13).
_ETIQUETTE_MAX = 90


def _etiquette_orateur(inter: ET.Element) -> str | None:
    """Texte du premier <cri:orateurnom> d'une intervention (« MM. X et Y. »), ou None.

    Sert de nom quand l'attribut `nom` est vide : le Sénat le laisse vide pour les
    interjections collectives (« Plusieurs sénateurs du groupe Les Républicains. ») ou à
    plusieurs voix, et l'étiquette en tête de paragraphe est alors le seul nom donné.
    """
    for e in inter.iter():
        if _local(e.tag) == "orateurnom":
            return norm_ws("".join(e.itertext())) or None
    return None


def _intervenant_verbatim(inter: ET.Element) -> str:
    """Concat des <p> enfants d'un <cri:intervenant>, separés par un saut de ligne."""
    paragraphs: list[str] = []
    for child in inter:
        if _local(child.tag) == "p":
            t = _paragraph_text(child)
            if t:
                paragraphs.append(t)
    return "\n".join(paragraphs).strip()


def parse_senat_xml(xml_bytes: bytes, *, source_name: str = "") -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """Parse un fichier CRI Sénat. Retourne None si invalide.

    Les CRI antérieurs à 2026 contiennent du XHTML mal formé (void-tags non
    fermés, tags custom non clos…). On passe toujours par lxml ``recover=True``
    pour éviter de perdre silencieusement des fichiers.
    """
    root: Any
    if _HAS_LXML:
        try:
            parser = LET.XMLParser(recover=True, encoding="iso-8859-1")
            root = LET.fromstring(xml_bytes, parser=parser)
            if root is None:
                raise ValueError("root is None after lxml recover")
        except Exception as e:
            print(f"  ⚠️  XML invalide même en recover ({source_name}) : {e}")
            return None
    else:
        # Fallback sans lxml : pré-nettoie les void-tags XHTML courants
        sanitized = _sanitize_xhtml(xml_bytes.decode("iso-8859-1", errors="replace")).encode("utf-8")
        try:
            root = ET.fromstring(sanitized)
        except ET.ParseError:
            print(f"  ⚠️  XML invalide et lxml indisponible ({source_name}) — skip.")
            return None

    date_seance, ref = _extract_date_and_ref(source_name)
    if not ref or not date_seance:
        print(f"  ⚠️  Impossible d'extraire date/ref ({source_name}) — skip.")
        return None

    # La date vient du seul nom de fichier, que rien ne valide en amont. Le ZIP
    # officiel contient `cri/d20261204.xml`, un doublon du compte-rendu du
    # 2025-12-04 mal nommé par le Sénat : il créait une séance datée d'un an dans
    # le futur, avec 1 168 interventions déjà présentes sous la bonne date.
    # Une séance ne peut pas s'être tenue après aujourd'hui : on la refuse.
    if date_seance > date.today().isoformat():
        print(f"  ⚠️  Date de séance dans le futur ({source_name} → {date_seance}) — skip.")
        return None

    seance_uid = f"SEN:{ref}"
    seance = {
        "uid": seance_uid,
        "chambre": "SEN",
        "date_seance": date_seance,
        "legislature": None,
        "session_lib": None,
        "titre": None,
        "url_source": f"https://www.senat.fr/seances/s{date_seance.replace('-', '')[:6]}/s{date_seance.replace('-', '')}/st{date_seance.replace('-', '')}000.html",
    }

    # Parcours document order pour tenir un état "signet courant"
    current_signet: str | None = None
    current_point_titre: str | None = None
    interventions: list[dict[str, Any]] = []
    ordre = 0

    for elem in root.iter():
        tag = _local(elem.tag)

        if tag == "titreS1":
            typ = (elem.get("type") or "").strip()
            libelle = (elem.get("libelle") or "").strip() or None
            signet = elem.get("signet") or ""
            if typ == _TYPE_SECT_PDL and signet:
                current_signet = slugify_signet(signet) or None
                current_point_titre = clean_text(libelle) or None
            elif typ and typ.startswith("sect_") and typ != _TYPE_SECT_PDL:
                # Autre section (QG, commémoration, etc.) — reset le signet
                current_signet = None
                current_point_titre = clean_text(libelle) or None

        elif tag == "intervenant":
            texte = _intervenant_verbatim(elem)
            if not texte:
                continue
            mat = _intervenant_mat(elem)
            nom = _intervenant_nom(elem)
            civ = _intervenant_civ(elem)
            qua = _intervenant_qua(elem)
            # Compose "Mme Aurore Bergé" depuis (civ, nom capitalizé)
            orateur_nom = None
            if nom:
                # "Aurore BERGÉ" ou "AURORE BERGÉ" → "Aurore Bergé" approximatif
                words = nom.split()
                def _cap(w: str) -> str:
                    return w.title() if w.isupper() else w
                pretty = " ".join(_cap(w) for w in words)
                orateur_nom = f"{civ} {pretty}" if civ else pretty
            else:
                # Sans attribut `nom`, l'étiquette que _paragraph_text a retirée du texte
                # est le seul nom disponible. Trop longue pour un nom, c'est du discours :
                # elle reprend sa place en tête du texte au lieu d'être perdue.
                etiquette = _etiquette_orateur(elem)
                if etiquette and len(etiquette) <= _ETIQUETTE_MAX:
                    orateur_nom = etiquette.rstrip(" .,") or None
                elif etiquette:
                    texte = f"{etiquette} {texte}"
            ordre += 1
            interventions.append({
                "seance_uid": seance_uid,
                "ordre": ordre,
                "point_titre": current_point_titre,
                "article": None,
                "amendement": None,
                "texte_num": current_signet,
                "acteur_uid": None,  # sera rempli via matricule_senat → acteur_uid
                "orateur_nom": orateur_nom,
                "orateur_qualite": qua,
                "role_debat": None,
                "texte": texte,
                "stime": None,
                "_matricule_senat": mat,
            })

    return seance, interventions


def map_signets_to_dossiers(
    signet_to_dossier: dict[str, str],
    interventions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attribue `dossier_uid` à chaque intervention depuis son `texte_num` (signet)."""
    for iv in interventions:
        sig = iv.get("texte_num")
        if sig:
            iv["dossier_uid"] = signet_to_dossier.get(sig)
        else:
            iv["dossier_uid"] = None
    return interventions


def map_matricules_to_acteurs(
    matricule_to_uid: dict[str, str],
    interventions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Convertit `_matricule_senat` en `acteur_uid` via le mapping préchargé.

    Les matricules inconnus (anciens sénateurs non actifs) restent sans acteur_uid :
    l'intervention est conservée avec `orateur_nom` comme fallback.
    """
    for iv in interventions:
        mat = iv.pop("_matricule_senat", None)
        if mat and not iv.get("acteur_uid"):
            uid = matricule_to_uid.get(mat)
            if uid:
                iv["acteur_uid"] = uid
    return interventions
