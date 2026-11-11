"""Parser du verbatim Assemblée nationale (Syceron XML).

Structure réelle du XML (namespace `http://schemas.assemblee-nationale.fr/referentiel`) :

    <compteRendu xmlns="…">
      <uid>CRSANR5L17S2026O1N168</uid>
      <sessionRef>SCR5A2026O1</sessionRef>
      <metadonnees>
        <dateSeance>20260225140000000</dateSeance>        <!-- YYYYMMDDHHMMSSmmm -->
        <numSeance>168</numSeance>
        <typeAssemblee>AN</typeAssemblee>
        <legislature>17</legislature>
        <session>Session ordinaire 2025 -2026</session>
        <sommaire>…</sommaire>                            <!-- ignoré -->
      </metadonnees>
      <contenu>
        <ouvertureSeance ...>
          <paragraphe id_acteur="PA721908" code_grammaire="…" roledebat="president"
                      bibard=" (n[[o]] 525)" art=" 1er" adt=" 603">
            <orateurs>
              <orateur><nom>Mme la présidente</nom><id>721908</id><qualite/></orateur>
            </orateurs>
            <texte stime="951.90">…verbatim…</texte>
          </paragraphe>
        </ouvertureSeance>
        <point code_grammaire="TITRE_TEXTE_DISCUSSION" valeur=" (n[[o]] 525)">
          <texte>Titre du point</texte>
          <paragraphe ...>…</paragraphe>
        </point>
      </contenu>
    </compteRendu>

Les attributs dont nous avons besoin (`id_acteur`, `bibard`, `art`, `adt`,
`roledebat`, `stime`) sont **directement sur le <paragraphe>**. Le numéro de
texte (`texte_num`) se lit, dans cet ordre (voir `parse_an_xml`) :
1. le `valeur` du dernier `<point code_grammaire="TITRE_TEXTE_DISCUSSION">`, tant
   qu'aucune section hors texte (questions, suspension, rappel au règlement, fin de
   séance) ne l'a remis à zéro, et que le paragraphe n'appartient pas à un autre point
   de l'ordre du jour qui nomme son propre texte ;
2. sinon le numéro du point de l'ordre du jour du paragraphe (`valeur_ptsodj`, porté
   par chaque élément), lu dans le TITRE ou l'`APPEL_*` de ce point ;
3. sinon le `bibard` du paragraphe.
"""

from __future__ import annotations

import re
from typing import Any
from xml.etree import ElementTree as ET

from ._common import (
    clean_text,
    collapse_whitespace,
    extract_num_notice_an,
    norm_ws,
    strip_xmlns,
)


_TITLE_TEXTE_DISCUSSION = "TITRE_TEXTE_DISCUSSION"
# Sections qui ne portent pas sur un texte (D-143) : elles remettent le contexte à zéro,
# et leurs paragraphes n'héritent pas du numéro de leur point d'ordre du jour.
_PREFIXES_HORS_TEXTE = ("QG_", "SUSP_", "FIN_", "RAP_REG")
# Styles d'un paragraphe de parole. Sans orateur, tout autre style (« Info Italiques »,
# « Titre », « Signature droite »…) marque une didascalie : voir parse_an_xml.
_STYLES_PAROLE = {"", "NORMAL"}


def _local(tag: str) -> str:
    return strip_xmlns(tag)


def _parse_date_an(raw: str | None) -> str | None:
    """Convertit '20260225140000000' ou '2026-02-25' → '2026-02-25'."""
    if not raw:
        return None
    raw = raw.strip()
    if re.fullmatch(r"\d{14,17}", raw):
        return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}.*", raw):
        return raw[:10]
    return None


def _parse_meta(root: ET.Element) -> dict[str, Any]:
    """Lit <uid>, <metadonnees/*>."""
    meta: dict[str, Any] = {}
    for child in root:
        tag = _local(child.tag)
        if tag == "uid" and child.text:
            meta["uid"] = child.text.strip()
        elif tag == "metadonnees":
            for m in child:
                mtag = _local(m.tag)
                if mtag == "dateSeance" and m.text:
                    d = _parse_date_an(m.text)
                    if d:
                        meta["date_seance"] = d
                elif mtag == "legislature" and m.text:
                    try:
                        meta["legislature"] = int(m.text.strip())
                    except ValueError:
                        pass
                elif mtag == "session" and m.text:
                    meta["session_lib"] = m.text.strip()
                elif mtag == "numSeance" and m.text:
                    meta["num_seance"] = m.text.strip()
    return meta


def _texte_inline(elem: ET.Element) -> str:
    """Concat du texte d'un élément en gardant les <italique>(didascalies)</italique>."""
    return norm_ws("".join(elem.itertext()))


# Caractère d'usage privé, absent des comptes rendus. Voir `_texte_paragraphe`.
_MARQUE_BR = "\ue000"


def _texte_paragraphe(elem: ET.Element) -> str:
    """Le texte d'une prise de parole, ses `<br/>` rendus en retours à la ligne.

    `itertext()` ne les voit pas : deux paragraphes d'un même orateur se collaient
    (« exceptionnelles.Je m'interroge »), dans 554 séances sur 556 au 2026-11-05. Une
    espace voisine du retour reste devant lui : `nb_mots` découpe sur les espaces, et
    garde ainsi le compte d'avant, donc le seuil des 20 mots du score. Plusieurs retours
    n'en font qu'un : `splitIntoChunks` (`/api/resume-debats`) coupe le verbatim sur
    `\\n\\n`, réservé à la séparation entre deux interventions. Une marque tient la place
    des `<br/>` le temps de normaliser les espaces, pour ne pas toucher aux sauts de ligne
    bruts du XML, qui restent tels quels. Les titres de point passent par `_texte_inline`.
    """
    def parcourir(e: ET.Element) -> str:
        morceaux = [e.text or ""]
        for enfant in e:
            morceaux.append(_MARQUE_BR if _local(enfant.tag) == "br" else parcourir(enfant))
            morceaux.append(enfant.tail or "")
        return "".join(morceaux)

    return re.sub(
        f"[ {_MARQUE_BR}]*{_MARQUE_BR}[ {_MARQUE_BR}]*",
        lambda m: " \n" if " " in m.group() else "\n",
        norm_ws(parcourir(elem)),
    )


def _extract_orateur_from_para(par: ET.Element) -> tuple[str | None, str | None, str | None]:
    """(acteur_uid, nom, qualite) depuis un <paragraphe>.

    Priorité à l'attribut `id_acteur` du paragraphe (format "PA…"). Le bloc
    <orateurs>/<orateur>/<id> contient seulement les 7 chiffres (sans "PA").
    """
    acteur_uid: str | None = None
    raw_id = (par.get("id_acteur") or "").strip()
    # Exclut les placeholders "PA0" et les UIDs négatifs (système/inconnu).
    if raw_id.startswith("PA") and re.fullmatch(r"PA\d+", raw_id) and raw_id != "PA0":
        acteur_uid = raw_id

    nom: str | None = None
    qualite: str | None = None
    for elem in par.iter():
        tag = _local(elem.tag)
        if tag == "orateur":
            # Enfants attendus : <nom>, <id>, <qualite>
            for child in elem:
                ctag = _local(child.tag)
                if ctag == "nom" and child.text:
                    nom = child.text.strip()
                elif ctag == "qualite" and child.text:
                    qualite = child.text.strip() or qualite
                elif ctag == "id" and not acteur_uid and child.text:
                    raw = child.text.strip()
                    if raw.isdigit():
                        acteur_uid = f"PA{raw}"
    return acteur_uid, nom, qualite


def _paragraphe_texte(par: ET.Element) -> str:
    """Texte du <texte> enfant d'un <paragraphe> (didascalies <italique> incluses)."""
    for child in par:
        if _local(child.tag) == "texte":
            return clean_text(_texte_paragraphe(child))
    return ""


def _tout_en_italique(par: ET.Element) -> bool:
    """Vrai si le <texte> du paragraphe n'a de texte que dans ses <italique>.

    Certaines indications de séance (« (La demande de prolongation de la séance est
    adoptée.) ») portent le style « NORMAL » au lieu d'« Info Italiques » : seule leur
    mise en italique intégrale les distingue d'une phrase du président restée sans orateur.
    """
    for child in par:
        if _local(child.tag) != "texte":
            continue
        if (child.text or "").strip():
            return False
        enfants = list(child)
        if not enfants:
            return False
        for e in enfants:
            if _local(e.tag) != "italique" or (e.tail or "").strip():
                return False
        return True
    return False


def _float_or_none(par: ET.Element) -> float | None:
    """Récupère `stime` du <texte> enfant (attribut de <texte>, pas du <paragraphe>)."""
    for child in par:
        if _local(child.tag) == "texte":
            v = child.get("stime")
            if v:
                try:
                    return float(v)
                except ValueError:
                    return None
    return None


def _textes_par_point_odj(root: ET.Element) -> dict[str, tuple[list[str], str | None]]:
    """{valeur_ptsodj: (numéros, titre)} des points de l'ordre du jour qui nomment un texte.

    Le numéro se lit dans le `valeur` d'un point TITRE_TEXTE_DISCUSSION ou APPEL_*
    (`APPEL_PLF_1_20` : « (n° 3210) », « Projet de loi de finances pour 2027 »). Une
    séance qui reprend une discussion commencée la veille n'a souvent pas de TITRE,
    seulement l'appel du texte : c'est le cas des séances budgétaires. Le premier point
    trouvé l'emporte ; relevé le 2026-10-28 sur les 643 séances de la 17ᵉ législature,
    aucun point d'ordre du jour n'en nomme deux différents.
    """
    carte: dict[str, tuple[list[str], str | None]] = {}
    for elem in root.iter():
        if _local(elem.tag) != "point":
            continue
        code_gr = elem.get("code_grammaire") or ""
        if code_gr != _TITLE_TEXTE_DISCUSSION and not code_gr.startswith("APPEL_"):
            continue
        nums = extract_num_notice_an(elem.get("valeur"))
        if not nums:
            continue
        titre: str | None = None
        for child in elem:
            if _local(child.tag) == "texte":
                titre = clean_text(_texte_inline(child)) or None
                break
        # Sans `valeur_ptsodj`, le point ne désigne aucun point d'ordre du jour : une clé
        # vide ferait hériter son texte à tout paragraphe lui aussi privé de l'attribut.
        odj = elem.get("valeur_ptsodj") or ""
        if odj:
            carte.setdefault(odj, (nums, titre))
    return carte


def parse_an_xml(xml_bytes: bytes, *, source_name: str = "") -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
    """Parse un fichier Syseron. Retourne (séance, interventions) ou None.

    Appelé par `import_an` (`import_debats.py`) pour chaque fichier du ZIP. Une
    intervention sans `texte_num` reste dans la liste rendue : c'est l'import qui l'écarte.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError as e:
        print(f"  ⚠️  XML invalide ({source_name}) : {e}")
        return None

    meta = _parse_meta(root)
    ref = meta.get("uid")
    date_seance = meta.get("date_seance")
    if not ref or not date_seance:
        return None

    legislature = meta.get("legislature")
    seance_uid = f"AN:{ref}"
    num_seance = meta.get("num_seance")
    titre = f"Séance {num_seance}" if num_seance else None

    seance = {
        "uid": seance_uid,
        "chambre": "AN",
        "date_seance": date_seance,
        "legislature": legislature,
        "session_lib": meta.get("session_lib"),
        "titre": titre,
        "url_source": (
            f"https://www.assemblee-nationale.fr/dyn/{legislature}/comptes-rendus/seance/{ref}"
            if legislature else None
        ),
    }

    # Contexte courant mis à jour par les <point code_grammaire="TITRE_TEXTE_DISCUSSION">
    current_point_titre: str | None = None
    current_point_nums: list[str] = []  # nums extraits du <point> valeur (fallback)
    current_point_odj = ""  # valeur_ptsodj du TITRE qui a posé current_point_nums
    # Vrai quand le dernier <point> rencontré est une section hors texte. Le dernier, pas
    # l'englobant : Syseron range parfois la suite d'une discussion sous le point
    # « Suspension et reprise de la séance » (relevé le 2026-10-28 : 23 559 paragraphes,
    # tous des discussions d'amendements, imbriqués sous un SUSP_*).
    hors_texte = False
    textes_odj = _textes_par_point_odj(root)
    interventions: list[dict[str, Any]] = []
    ordre = 0
    paragraphe = 0

    # On veut un parcours document-order ; iter() donne un parcours pre-order
    # parfait pour repérer les `<point>` titres puis les `<paragraphe>` qui suivent.
    for elem in root.iter():
        tag = _local(elem.tag)

        if tag == "point":
            code_gr = elem.get("code_grammaire") or ""
            hors_texte = code_gr.startswith(_PREFIXES_HORS_TEXTE)
            if code_gr == _TITLE_TEXTE_DISCUSSION:
                # Le titre lisible est dans le <texte> enfant
                label_parts: list[str] = []
                for child in elem:
                    if _local(child.tag) == "texte":
                        label_parts.append(_texte_inline(child))
                        break
                current_point_titre = clean_text(" ".join(label_parts)) or None
                # Extraire les numéros de texte depuis le `valeur` du point —
                # sert de fallback quand les <paragraphe> enfants n'ont pas de bibard.
                current_point_nums = extract_num_notice_an(elem.get("valeur"))
                current_point_odj = elem.get("valeur_ptsodj") or ""
            elif hors_texte:
                # Section hors texte : reset le contexte
                current_point_nums = []

        elif tag == "paragraphe":
            texte = _paragraphe_texte(elem)
            if not texte:
                continue

            # Attributs identifiant le texte et la localisation dans le texte
            # Priorité au <point> parent quand il existe, car le bibard
            # peut référencer plusieurs textes et provoquer des doublons
            # attribués au mauvais dossier.
            # Le contexte remis à zéro par une suspension ou un rappel au règlement ne
            # revient jamais tout seul : sans le point d'ordre du jour, toute la discussion
            # des articles qui suit était perdue (le 2026-10-28, 128 784 interventions
            # rattachées à un dossier au lieu de 283 653). Le texte du point d'ordre du
            # jour du paragraphe passe avant le TITRE d'un autre point, qui n'a pas été
            # remis à zéro quand le texte suivant n'est annoncé que par un APPEL_* (253
            # paragraphes), et avant le `bibard`, qui reste parfois celui du texte
            # précédent (353 paragraphes du PLF 2025 sous la loi Nouvelle-Calédonie n° 525).
            point_titre = current_point_titre
            odj = elem.get("valeur_ptsodj") or ""
            du_point = None if hors_texte else textes_odj.get(odj)
            if current_point_nums and (du_point is None or odj == current_point_odj):
                nums = current_point_nums
            elif du_point:
                nums, point_titre = du_point
            else:
                bibard = elem.get("bibard") or ""
                nums = extract_num_notice_an(bibard) if bibard else []
            article = (elem.get("art") or "").strip() or None
            amendement = (elem.get("adt") or "").strip() or None
            role = elem.get("roledebat") or None
            code_style = elem.get("code_style") or ""

            # Un paragraphe sans orateur n'est une prise de parole que s'il est écrit en
            # style normal et pas entièrement en italique. Les autres styles sans orateur
            # (« Titre », « Sous-tit_info », « Sous-tit_p_cap », « Signature droite »…) sont
            # des titres de section, des résumés ou la signature du compte rendu : relevé le
            # 2026-10-15 sur l'archive de la 17ᵉ législature, aucun n'est une parole. Restent
            # sans orateur, et donc affichés « Intervenant », quelques phrases du président
            # que la source n'attribue à personne.
            acteur_uid, orateur_nom, orateur_qualite = _extract_orateur_from_para(elem)
            if not orateur_nom and not acteur_uid and (
                code_style not in _STYLES_PAROLE or _tout_en_italique(elem)
            ):
                orateur_qualite = "didascalie"

            stime = _float_or_none(elem)

            # Une ligne par numéro de texte, chacune rattachée à son dossier. `_paragraphe`
            # permet à `map_nums_to_dossiers` de reconnaître celles d'un même paragraphe.
            nums_to_emit: list[str | None] = nums if nums else [None]
            paragraphe += 1
            for num in nums_to_emit:
                ordre += 1
                interventions.append({
                    "_paragraphe": paragraphe,
                    "seance_uid": seance_uid,
                    "ordre": ordre,
                    "point_titre": point_titre,
                    "article": article,
                    "amendement": amendement,
                    "texte_num": num,
                    "acteur_uid": acteur_uid,
                    "orateur_nom": orateur_nom,
                    "orateur_qualite": orateur_qualite,
                    "role_debat": role,
                    "texte": texte,
                    "stime": stime,
                })

    return seance, interventions


def map_nums_to_dossiers(
    num_to_dossier: dict[str, str],
    interventions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Attribue `dossier_uid` à chaque intervention depuis son `texte_num`, et rend la
    liste sans doublon : un paragraphe rattaché à deux textes d'un même dossier (les deux
    parties d'un projet de loi de finances, n° 3210 et 3291) ne garde que sa première
    ligne, sinon il s'afficherait et se compterait deux fois. Les `ordre` gardent leur
    valeur, d'où des trous dans une séance. Un paragraphe rattaché à deux dossiers garde
    une ligne par dossier : `recalc_nb_prises_parole` ne le compte qu'une fois.
    """
    gardees: list[dict[str, Any]] = []
    vus: set[tuple[int, str]] = set()
    for iv in interventions:
        num = iv.get("texte_num")
        dossier = num_to_dossier.get(num) if num else None
        iv["dossier_uid"] = dossier
        if dossier is not None:
            cle = (iv["_paragraphe"], dossier)
            if cle in vus:
                continue
            vus.add(cle)
        gardees.append(iv)
    return gardees
