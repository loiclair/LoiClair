# importer_exposes.py
# Garde l'exposé des motifs de chaque dossier de loi, celui de son premier texte
# déposé, dans `dossiers_legislatifs` (`expose`, `expose_texte_uid`, `expose_lu_le`,
# migration 2026-11-11_dossiers_expose.sql). Rien ne l'affiche encore : il servira à un
# résumé à la demande et à une section de la fiche du dossier.
#
# Lancé chaque nuit par `nightly.py` (étape `exposes`, nombre de pages borné), et à la
# main pour la première passe, qui lit environ 2 600 pages.
#   python3 -P importer_exposes.py                  # lit ce qui manque et écrit en base
#   python3 -P importer_exposes.py --limite 40      # au plus 40 pages lues
#   python3 -P importer_exposes.py --essai D        # un fichier par texte dans D, sans écrire
#   python3 -P importer_exposes.py --dossiers DLR5L17N52976 …   # seulement ces dossiers
#   python3 -P importer_exposes.py --relire --limite 50   # relit des textes déjà lus
#
# Périmètre : les procédures de loi de `decouper_textes.PROCEDURES_LOI`, à tout stade et
# toute date, hors `hors_liste`. Le texte lu est le premier texte déposé du dossier :
# le plus ancien de type proposition ou projet (`PION`, `PRJL`) qui n'est ni un texte
# de commission (`BTC`) ni un texte adopté (`BTA`, `TAP`), et dont la page HTML est
# accessible. Seul le texte déposé porte un exposé : le texte transmis à l'autre
# chambre n'en a pas. Un dossier qui a fusionné plusieurs propositions garde celui de
# la première.
#
# Sources :
#   - Assemblée : page du texte (`/dyn/opendata/<uid>.html`, ou `.asp` pour les vieux
#     dossiers). L'exposé va de « EXPOSÉ DES MOTIFS » au titre du dispositif ou au
#     premier article, et les notes de fin de page qu'il appelle lui sont rattachées.
#     Le budget (loi de finances, de fin de gestion, des comptes, de financement de la
#     sécurité sociale) écrit en plus un exposé sous chaque article : ils sont tous
#     gardés, à la suite de l'« Exposé général des motifs » quand il y en a un (le
#     budget de la Sécurité sociale n'en a pas), chacun sous l'en-tête de son article
#     (« Article 3 : Titre »), séparés par une ligne vide. Choix d'Alex du 2026-11-11.
#     Chaque exposé, général ou d'article, est suivi des notes qu'il appelle.
#   - Sénat : la page du texte n'a pas l'exposé. Il est sur une page à part,
#     `/leg/exposes-des-motifs/<signet>-expose.html`, de « EXPOSÉ DES MOTIFS » à
#     « Partager cette page ». Sur un 404, la page du texte est lue à la place : les
#     textes anciens (vus en 2000 et 2018) y portent encore l'exposé, avant le
#     dispositif ; un texte transmis par l'Assemblée n'en a nulle part.
#   - PDF : jamais lu, comme dans `decouper_textes.py`.
#
# Un dossier déjà lu ne se relit pas tant que son premier texte déposé reste le même :
# un texte publié ne change plus. Une page en échec n'écrit rien. Une coupure se réessaie
# plus tard, selon la règle du paragraphe suivant ; un 404 sur la page du texte marque
# son lien mort (`textes.url_accessible`), comme `decouper_textes.py`, et la vérification
# du lundi le rétablit si la page revient.
#
# Une page lue sans exposé n'écrit rien non plus : tout texte déposé en a un, et son
# absence veut dire que la chambre ne l'a pas encore publié. L'Assemblée met parfois en
# ligne la seule couverture (n° 2825, sans exposé ni article), le Sénat publie la page
# d'exposé après celle du texte (`ppl26-076`). Pour ne pas relire chaque nuit les mêmes
# pages restées incomplètes, comme `decouper_textes.py`, la nuit (`--limite`) ne lit un
# texte jamais écrit que s'il a moins de `RETENTER_JOURS` ; au-delà, il attend le passage
# complet sans `--limite`. Choix d'Alex du 2026-11-11.

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")
from _db import connexion  # noqa: E402
from decouper_textes import (  # noqa: E402
    PROCEDURES_LOI,
    RE_TITRE_ARTICLE,
    RETENTER_JOURS,
    lignes_de_html,
    telecharger_page,
)

# Environ 1 Mo par lot d'écriture : un envoi de plusieurs dizaines de Mo d'un coup a
# déjà perdu sa connexion en route (CLAUDE.md, écritures en base depuis Python). Un lot
# part aussi tous les `LOT_DOSSIERS` dossiers, pour qu'une passe de plusieurs heures
# coupée en route garde ce qu'elle a déjà lu.
TAILLE_LOT_OCTETS = 1_000_000
LOT_DOSSIERS = 25

# ===================================================================
# Sélection
# ===================================================================

# Le premier texte déposé lisible de chaque dossier du périmètre, et ce qui est déjà en
# base. Ordre : la date du texte (`date_depot` manque parfois, d'où le repli sur la
# publication puis la création), puis l'uid pour départager. Les dossiers aux dépôts les
# plus récents d'abord : une nuit bornée par `--limite` prend d'abord les nouveaux
# dépôts, et quelques vieux textes illisibles ne lui prennent pas tout son quota.
REQUETE_TEXTES = """
    SELECT DISTINCT ON (d.uid)
           d.uid, d.titre, t.uid, t.lien_texte,
           coalesce(t.date_depot, t.date_publication, t.date_creation)::date,
           d.expose_texte_uid, d.expose_lu_le IS NOT NULL
    FROM dossiers_legislatifs d
    JOIN textes t ON t.dossier_ref = d.uid
    WHERE NOT d.hors_liste
      AND d.procedure_libelle = ANY(%(procedures)s)
      AND t.type_code IN ('PION', 'PRJL')
      AND t.uid !~ 'BTC|BTA|TAP'
      AND coalesce(t.url_accessible, true)
      AND t.lien_texte ~* '\\.(html?|asp)$'
    ORDER BY d.uid, coalesce(t.date_depot, t.date_publication, t.date_creation) NULLS LAST, t.uid
"""


def textes_a_lire(cur, seulement: list[str] | None, relire: bool) -> tuple[list[dict], int]:
    """Les dossiers dont le premier texte déposé est à lire, les plus récents d'abord,
    et le nombre de dossiers du périmètre qui ont un texte lisible.

    Un dossier est à lire s'il n'a jamais été lu, ou si son premier texte déposé n'est
    plus celui d'où vient son exposé (un dépôt plus ancien arrivé en base). `relire`
    reprend aussi les dossiers déjà lus : c'est la preuve par double passe."""
    cur.execute(REQUETE_TEXTES, {"procedures": PROCEDURES_LOI})
    lignes = cur.fetchall()
    a_lire = []
    for d_uid, titre, t_uid, lien, date_texte, deja_uid, deja_lu in lignes:
        if seulement and d_uid not in seulement:
            continue
        if deja_lu and deja_uid == t_uid and not relire:
            continue
        a_lire.append({"dossier": d_uid, "titre": titre or "", "texte": t_uid, "lien": lien,
                       "date": date_texte, "deja_lu": deja_lu, "deja_uid": deja_uid})
    a_lire.sort(key=lambda x: (x["date"] is not None, x["date"], x["dossier"]), reverse=True)
    return a_lire, len(lignes)


# ===================================================================
# Extraction
# ===================================================================

# Titre de l'exposé. « Exposé général des motifs » est celui du budget (et de la loi
# spéciale), qui place sous chaque article un « Exposé des motifs » propre.
RE_DEBUT = re.compile(r"(?i)^EXPOS[ÉE] DES MOTIFS\.?$")
RE_DEBUT_GENERAL = re.compile(r"(?i)^EXPOS[ÉE] G[ÉE]N[ÉE]RAL DES MOTIFS$")
# Titre du dispositif, qui suit l'exposé : « PROPOSITION DE LOI », « proposition de loi
# organique », « PROJET DE LOI CONSTITUTIONNELLE ». Puis, pour un projet, le décret de
# présentation (« Le Premier ministre, »), avant le premier article.
RE_DISPOSITIF = re.compile(
    r"(?i)^(?:PROPOSITION|PROJET) DE LOI(?: ORGANIQUE| CONSTITUTIONNELLE)?\.?$|^Le Premier ministre,?$"
)
# Fin de l'exposé général du budget : le tableau d'évaluation des recettes, qui le
# suit sous le même titre du sommaire mais ne donne que des chiffres, ou à défaut le
# titre de la partie qui donne les articles (« Articles du projet de loi avec exposé
# des motifs » dans la loi de finances, « ARTICLES DU PROJET DE LOI ET EXPOSÉ DES
# MOTIFS PAR ARTICLE » dans celle des comptes, parfois sur deux lignes ou suivi d'un
# numéro de page dans le sommaire).
RE_FIN_GENERAL = re.compile(
    r"(?i)^(?:Articles du projet de loi(?: (?:avec|et) exposé des motifs(?: par article)?)?(?: \d+)?"
    r"|Évaluation des recettes du budget général)$"
)
# Pied de page des longs textes : « – 1 – », « Projet de loi de finances | 1 ».
RE_PIED = re.compile(r"^(?:– \d+ –|(?:Projet|Proposition) de loi.* \| \d+)$")
# Une note de l'Assemblée, sur sa ligne : « [(1)] … », « ([1]) … », « [1] … ». Et son
# appel dans le texte, sous l'une des mêmes formes, pas forcément celle de la note
# (budget de la Sécurité sociale 2027 : appel « ([1]) », note « [1] »).
RE_NOTE = re.compile(r"^(?:\[\((\d+)\)\]|\(\[(\d+)\]\)|\[(\d+)\])\s")
RE_APPEL = re.compile(r"\[\((\d+)\)\]|\(\[(\d+)\]\)|\[(\d+)\]")


def _numero(m: re.Match) -> str:
    """Le numéro d'une note ou d'un appel, quelle que soit sa forme."""
    return next(g for g in m.groups() if g)


def _notes_appelees(lignes: list[str], debut: int, fin: int) -> list[str]:
    """Les notes qu'appellent les lignes `debut` à `fin` (exclue), dans l'ordre des
    appels. Une note se trouve en fin de page, ou dans un budget en fin de chacune des
    parties qui le composent, numérotées chacune depuis 1 (loi de finances 2025 : deux
    notes « [1] », l'une après l'exposé d'un article, l'autre après un autre). L'appel
    renvoie donc à la première note de son numéro qui le suit."""
    notes = [(j, _numero(m)) for j, l in enumerate(lignes) if (m := RE_NOTE.match(l))]
    gardees: list[int] = []
    for k in range(debut, fin):
        if RE_NOTE.match(lignes[k]):
            continue
        for appel in RE_APPEL.finditer(lignes[k]):
            n = _numero(appel)
            j = next((j for j, num in notes if j > k and num == n), None)
            if j is not None and j not in gardees:
                gardees.append(j)
    return [lignes[j] for j in gardees]


def _avec_notes(corps: str, notes: list[str]) -> str:
    """Un exposé suivi de ses notes, après une ligne vide."""
    return corps + ("\n\n" + "\n".join(notes) if notes else "")
# Fin de l'exposé sur la page du Sénat : les boutons de partage, ou sur les pages plus
# anciennes, qui n'en ont pas, les thèmes et la date de mise à jour.
RE_FIN_SENAT = re.compile(r"^(?:Partager cette page|Les thèmes associés à ce (?:dossier|texte)|Page mise à jour le)$")


def _match_article(ligne: str) -> re.Match | None:
    """Le titre d'article de la ligne (« Article 1er », « ARTICLE liminaire : … »), au
    sens du découpage des textes, ou None. Appelé par `_titre_article` et `_entete_article`."""
    return RE_TITRE_ARTICLE.match(re.sub(r"^ARTICLES?\b", lambda m: m.group(0).capitalize(), ligne))


def _titre_article(ligne: str) -> bool:
    """La ligne est-elle un titre d'article (voir `_match_article`)."""
    return _match_article(ligne) is not None


def _plus_long(lignes: list[str], debuts: list[int], est_fin) -> tuple[int, int] | None:
    """Parmi les débuts possibles, le segment le plus long jusqu'à sa fin. Un sommaire en
    tête (le budget) répète les titres : son segment ne fait qu'une ligne ou deux."""
    meilleur = None
    for i in debuts:
        fin = next((j for j in range(i + 1, len(lignes)) if est_fin(lignes[j])), None)
        if fin is None:
            continue
        if meilleur is None or fin - i > meilleur[1] - meilleur[0]:
            meilleur = (i, fin)
    return meilleur


def _propre(lignes: list[str]) -> str:
    """Les lignes d'un exposé sans les pieds de page, jointes par des sauts de ligne."""
    return "\n".join(l for l in lignes if not RE_PIED.match(l)).strip()


# Titre de l'exposé propre à un article, sous cet article : « Exposé des motifs »,
# « Exposé des motifs : » dans le projet de loi des comptes.
RE_DEBUT_ARTICLE = re.compile(r"(?i)^EXPOS[ÉE] DES MOTIFS\s*:?$")
# Ce qui ferme l'exposé d'un article sans être l'article suivant : un intertitre en
# capitales (« PREMIÈRE PARTIE : … », « TITRE PREMIER : … »), l'annexe qui suit le
# dernier article du budget de la Sécurité sociale (« ANNEXE », « RAPPORT ANNEXÉ »), les
# états annexés de la loi de finances, les signatures.
RE_FIN_EXPOSE_ARTICLE = re.compile(
    r"^(?:(?:PREMIÈRE|DEUXIÈME|SECONDE|TROISIÈME) PARTIE|TITRE|CHAPITRE|SECTION|SOUS-SECTION|ANNEXES?|RAPPORT ANNEXÉ)\b"
    r"|(?i:^(?:États législatifs annexés|Délibéré en |Fait à ))"
)
# Lignes de structure laissées en fin d'exposé d'article, juste avant l'article
# suivant : « B – Mesures fiscales », « I – Impôts et ressources autorisées », un numéro
# de page seul. Retirées seulement en fin de bloc : le même motif en cours d'exposé est
# un intertitre de l'exposé.
RE_STRUCTURE_FINALE = re.compile(r"^(?:(?:[IVX]+|[A-Z]{1,2}|\d+) ?[–-] .{0,150}|\d+)$")
# Titre courant en capitales laissé en fin d'exposé général par la mise en page (loi des
# comptes 2023 : « PROJET DE LOI RELATIF AUX RÉSULTATS DE LA GESTION… »).
RE_TITRE_COURANT = re.compile(r"^(?:PROJET|PROPOSITION) DE LOI\b[^a-z]*$")


def _rogner(corps: list[str]) -> list[str]:
    """Retire de la fin d'un exposé les lignes de structure et de mise en page qui
    précèdent la partie suivante."""
    corps = list(corps)
    while corps and (RE_STRUCTURE_FINALE.match(corps[-1]) or RE_TITRE_COURANT.match(corps[-1])):
        corps.pop()
    return corps


def _entete_article(lignes: list[str], i: int) -> str:
    """En-tête d'un exposé d'article : « Article 1er : Autorisation de percevoir les
    impôts existants ». Le titre de l'article est sur sa ligne (« ARTICLE 3 : Titre »)
    ou, dans le budget de la Sécurité sociale et la loi de finances, sur la ligne
    suivante, courte et sans ponctuation finale (le dispositif, lui, finit par « . » ou
    « : »)."""
    m = _match_article(lignes[i])
    titre = re.sub(r"^ ?(?:[:–-] ?)+", "", m.group("reste")).strip(" :")
    if not titre and i + 1 < len(lignes):
        suivante = lignes[i + 1]
        if len(suivante) < 400 and not re.search(r"[.:;]$", suivante) and not RE_DEBUT_ARTICLE.match(suivante):
            titre = suivante
    return f"Article {m.group('num')}" + (f" : {titre}" if titre else "")


def exposes_par_article(lignes: list[str], debut: int) -> list[str]:
    """Les exposés écrits sous chaque article (budget de l'État, de la Sécurité sociale,
    loi des comptes), à partir de la ligne `debut`, chacun précédé de l'en-tête de son
    article. Un exposé court de « Exposé des motifs » à l'article suivant, au prochain
    intertitre en capitales ou aux états annexés."""
    blocs: list[str] = []
    article = None
    i = debut
    while i < len(lignes):
        if _titre_article(lignes[i]):
            article = _entete_article(lignes, i)
        elif article and RE_DEBUT_ARTICLE.match(lignes[i]):
            j = i + 1
            while j < len(lignes) and not (_titre_article(lignes[j]) or RE_DEBUT_ARTICLE.match(lignes[j])
                                           or RE_FIN_EXPOSE_ARTICLE.match(lignes[j])):
                j += 1
            # Les notes posées dans le bloc peuvent être celles d'un autre exposé (loi des
            # comptes 2023 : les notes de l'exposé général après le dernier article) :
            # retirées, puis chaque exposé reprend celles qu'il appelle.
            corps = _rogner(l for l in lignes[i + 1 : j] if not (RE_PIED.match(l) or RE_NOTE.match(l)))
            if corps:
                blocs.append(_avec_notes(article + "\n" + "\n".join(corps), _notes_appelees(lignes, i + 1, j)))
            article = None  # un seul exposé par article
            i = j
            continue
        i += 1
    return blocs


def expose_assemblee(lignes: list[str]) -> tuple[str | None, dict]:
    """Page d'un texte de l'Assemblée → son exposé (None s'il n'y en a pas), et un
    compte rendu pour le bilan.

    L'exposé d'ensemble d'abord : l'exposé général du budget s'il y en a un, sinon
    « EXPOSÉ DES MOTIFS » à condition qu'il précède le premier article. Puis les exposés
    écrits sous chaque article, que porte le budget (le projet de loi de financement de
    la sécurité sociale n'a même que ceux-là), chacun sous l'en-tête de son article,
    séparés par une ligne vide. Chaque exposé est suivi des notes qu'il appelle, après
    une ligne vide : une note qu'il n'appelle pas annote le dispositif ou un autre
    exposé."""
    general, fin_general, rapport = None, None, {}
    generaux = [i for i, l in enumerate(lignes) if RE_DEBUT_GENERAL.match(l)]
    seg = _plus_long(lignes, generaux, lambda l: RE_FIN_GENERAL.match(l) or RE_DISPOSITIF.match(l))
    if seg:
        corps = [l for l in lignes[seg[0] + 1 : seg[1]] if not RE_NOTE.match(l)]
        general, fin_general = _propre(_rogner(corps)), seg[1]
        rapport = {"forme": "général"}
    premier_article = next((i for i, l in enumerate(lignes) if _titre_article(l)), len(lignes))
    if general is None:
        debuts = [i for i, l in enumerate(lignes[:premier_article]) if RE_DEBUT.match(l)]
        seg = _plus_long(lignes, debuts, lambda l: RE_DISPOSITIF.match(l) or _titre_article(l))
        if seg:
            general = _propre([l for l in lignes[seg[0] + 1 : seg[1]] if not RE_NOTE.match(l)])
            fin_general = seg[1]
            rapport = {"forme": "exposé"}
    if general:
        notes = _notes_appelees(lignes, seg[0] + 1, seg[1])
        general = _avec_notes(general, notes)
        if notes:
            rapport["notes"] = len(notes)
    par_article = exposes_par_article(lignes, max(fin_general or 0, premier_article))
    if par_article:
        rapport = {**rapport, "forme": rapport.get("forme", "") + " + articles" if rapport else "articles",
                   "articles": len(par_article)}
    texte = "\n\n".join(b for b in [general, *par_article] if b)
    if not texte:
        return None, {"forme": "aucun", "article": premier_article < len(lignes)}
    return texte, rapport


def expose_senat(lignes: list[str]) -> tuple[str | None, dict]:
    """Page d'exposé du Sénat → son exposé. La page porte deux fois le titre : le champ
    « Nature : Exposé des motifs » de l'en-tête, puis celui de l'exposé lui-même. Le bon
    est donc le dernier avant la fin."""
    fin = next((j for j, l in enumerate(lignes) if RE_FIN_SENAT.match(l)), None)
    debuts = [i for i, l in enumerate(lignes[:fin]) if RE_DEBUT.match(l)]
    if fin is None or not debuts:
        return None, {"forme": "aucun"}
    return _propre(lignes[debuts[-1] + 1 : fin]) or None, {"forme": "sénat"}


# Titre du dispositif sur une page de texte du Sénat d'avant les pages d'exposé : le
# titre complet, sur une ligne sans point (« Proposition de loi organique tendant à
# actualiser… »). Premier article écrit « Article 1 er », que `RE_TITRE_ARTICLE` ne
# reconnaît pas.
RE_DISPOSITIF_SENAT = re.compile(r"(?i)^(?:Proposition|Projet) de loi\b[^.]*$|^Article (?:1 ?er|premier|unique)\b")


def expose_texte_senat(lignes: list[str]) -> tuple[str | None, dict]:
    """Page d'un texte du Sénat → l'exposé qu'elle porte encore, sur les textes
    antérieurs aux pages d'exposé (vu sur des propositions de 2000 et de 2018) : de
    « EXPOSÉ DES MOTIFS » au titre du dispositif ou au premier article."""
    debuts = [i for i, l in enumerate(lignes) if RE_DEBUT.match(l)]
    seg = _plus_long(lignes, debuts, lambda l: RE_DISPOSITIF_SENAT.match(l) or _titre_article(l)
                     or RE_FIN_SENAT.match(l))
    if not seg:
        return None, {"forme": "sénat 404, texte sans exposé"}
    return _propre(lignes[seg[0] + 1 : seg[1]]) or None, {"forme": "sénat, page du texte"}


RE_SIGNET_SENAT = re.compile(r"^(https?://www\.senat\.fr/leg/)(p[pj]l[\d-]+)\.html?$")


def url_expose_senat(lien: str) -> str:
    """`/leg/ppl24-518.html` → `/leg/exposes-des-motifs/ppl24-518-expose.html`."""
    m = RE_SIGNET_SENAT.match(lien)
    if not m:
        raise ValueError(f"adresse du Sénat inattendue ({lien})")
    return f"{m.group(1)}exposes-des-motifs/{m.group(2)}-expose.html"


def lire_expose(t: dict) -> tuple[str | None, dict, str]:
    """Un texte → (exposé ou None, compte rendu, adresse lue). Lève sur une page en
    échec. Au Sénat, une page d'exposé absente (404) renvoie à la page du texte, qui
    porte l'exposé sur les textes anciens et n'en a pas sur les textes transmis."""
    lien = t["lien"] or ""
    if "senat.fr" in lien:
        url = url_expose_senat(lien)
        try:
            page = telecharger_page(url)
        except requests.HTTPError as e:
            if e.response is None or e.response.status_code != 404:
                raise
            texte, rapport = expose_texte_senat(lignes_de_html(telecharger_page(lien)))
            return texte, rapport, lien
        texte, rapport = expose_senat(lignes_de_html(page))
        return texte, rapport, url
    texte, rapport = expose_assemblee(lignes_de_html(telecharger_page(lien)))
    return texte, rapport, lien


# ===================================================================
# Écriture
# ===================================================================


def ecrire(lignes: list[dict]) -> int:
    """Écrit les exposés lus, par lots d'environ 1 Mo, une transaction par lot, et
    renvoie le nombre de dossiers changés.

    Seules les lignes dont l'exposé ou le texte source changent sont réécrites
    (`IS DISTINCT FROM`) : une relecture identique ne touche ni `expose_lu_le` ni la
    ligne. Une ligne sans exposé (`expose` et `texte_uid` à None) remet le dossier à
    « jamais lu » : sur un dossier jamais lu, elle ne change rien ; sur un dossier lu,
    elle efface ce qui ne tient plus. Une connexion par appel : une passe de plusieurs
    heures garderait sinon une connexion inactive entre deux lots, que le tunnel ou la
    base peuvent couper."""
    if not lignes:
        return 0
    lots, lot, taille = [], [], 0
    for l in lignes:
        poids = len((l["expose"] or "").encode("utf-8")) + 100
        if lot and taille + poids > TAILLE_LOT_OCTETS:
            lots.append(lot)
            lot, taille = [], 0
        lot.append(l)
        taille += poids
    lots.append(lot)
    ecrites = 0
    with connexion() as conn:
        for lot in lots:
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE dossiers_legislatifs d
                    SET expose = v.expose, expose_texte_uid = v.texte_uid,
                        expose_lu_le = CASE WHEN v.expose IS NULL THEN NULL ELSE now() END
                    FROM jsonb_to_recordset(%s::jsonb) AS v(dossier text, texte_uid text, expose text)
                    WHERE d.uid = v.dossier
                      AND (d.expose, d.expose_texte_uid) IS DISTINCT FROM (v.expose, v.texte_uid)
                    """,
                    (json.dumps(lot, ensure_ascii=False),),
                )
                ecrites += cur.rowcount
    return ecrites


# ===================================================================
# Main
# ===================================================================


def main():
    """Lit l'exposé des dossiers à lire (`textes_a_lire`), l'écrit en base par lots ou,
    avec `--essai`, dans un fichier par texte, puis sort en erreur sur une majorité
    d'échecs. Appelé par `nightly.py` (étape `exposes`) et à la main (en-tête du fichier)."""
    parser = argparse.ArgumentParser(description="Exposé des motifs du premier texte déposé de chaque dossier de loi")
    parser.add_argument("--limite", type=int, help="nombre maximal de pages lues (étape de nuit)")
    parser.add_argument("--dossiers", nargs="+", help="seulement ces dossiers")
    parser.add_argument("--essai", help="dossier où écrire un fichier par texte et le bilan, sans toucher la base")
    parser.add_argument("--relire", action="store_true", help="relit aussi les dossiers déjà lus (double passe)")
    args = parser.parse_args()
    essai = Path(args.essai) if args.essai else None
    if essai:
        essai.mkdir(parents=True, exist_ok=True)

    with connexion(autocommit=True) as conn, conn.cursor() as cur:
        a_lire, perimetre = textes_a_lire(cur, args.dossiers, args.relire)
    anciens = 0
    if args.limite is not None:
        # La nuit, un texte jamais écrit et vieux de plus de `RETENTER_JOURS` est une page
        # restée incomplète : elle attend le passage complet (en-tête du fichier).
        borne = date.today() - timedelta(days=RETENTER_JOURS)
        recents = [t for t in a_lire if t["deja_lu"] or not t["date"] or t["date"] >= borne]
        anciens = len(a_lire) - len(recents)
        a_lire = recents[: args.limite]
    print(f"📋 {perimetre} dossiers avec un texte déposé lisible ; {len(a_lire)} pages à lire"
          + (f", {anciens} anciennes laissées au passage complet" if anciens else ""))

    bilan, en_attente, liens_morts = [], [], []
    ecrites = trouves = sans = echecs = octets = 0
    for t in a_lire:
        ligne = {"dossier": t["dossier"], "texte": t["texte"], "titre": t["titre"][:70],
                 "source": "senat" if "senat.fr" in (t["lien"] or "") else "asp" if (t["lien"] or "").endswith(".asp") else "an"}
        try:
            texte, rapport, url = lire_expose(t)
        except Exception as e:  # une page en échec se réessaie plus tard (en-tête du fichier)
            echecs += 1
            ligne["echec"] = f"{type(e).__name__}: {str(e)[:150]}"
            # Un 404 qui sort de `lire_expose` est celui de la page du texte (la page
            # d'exposé absente du Sénat est rattrapée dedans) : la page a été retirée
            # depuis sa vérification, qui ne reteste jamais un lien vu vivant. Comme
            # dans `decouper_textes.py`, le lien est marqué mort, en une requête après
            # la boucle : il n'est plus relu, et la vérification du lundi le rétablit si
            # la chambre republie la page.
            if (not essai and isinstance(e, requests.HTTPError) and e.response is not None
                    and e.response.status_code == 404):
                liens_morts.append(t["texte"])
                ligne["echec"] += " (lien marqué mort)"
            print(f"   ❌ {t['dossier']} {t['texte']:24} {ligne['echec']}", flush=True)
            bilan.append(ligne)
            continue
        ligne.update(rapport, url=url, caracteres=len(texte or ""))
        if texte:
            trouves += 1
            octets += len(texte.encode("utf-8"))
        else:
            sans += 1
        bilan.append(ligne)
        print(f"   {'✅' if texte else '∅ '} {t['dossier']} {t['texte']:24} {ligne['caracteres']:>7} car. {rapport.get('forme')}",
              flush=True)
        if essai:
            (essai / f"{t['texte']}.txt").write_text(
                f"{t['dossier']} | {t['titre']}\n{url}\n{'=' * 60}\n{texte or '(aucun exposé)'}\n", encoding="utf-8")
        else:
            # Sans exposé : rien d'écrit, la page se relira. Un dossier dont le premier
            # texte déposé a changé repasse à « jamais lu » (voir `ecrire`) ; une relecture
            # (`--relire`) du même texte, elle, ne doit pas effacer l'exposé déjà en base
            # sur une page restée incomplète.
            if not texte and t["deja_lu"] and t["deja_uid"] == t["texte"]:
                continue
            en_attente.append({"dossier": t["dossier"], "texte_uid": t["texte"] if texte else None, "expose": texte})
            if len(en_attente) >= LOT_DOSSIERS:
                ecrites += ecrire(en_attente)
                en_attente = []
    if en_attente:
        ecrites += ecrire(en_attente)
    if liens_morts:
        with connexion(autocommit=True) as conn, conn.cursor() as cur:
            cur.execute("UPDATE textes SET url_accessible = false WHERE uid = ANY(%s)", (liens_morts,))
        print(f"   🔗 {len(liens_morts)} liens en 404 marqués morts : {', '.join(liens_morts)}")

    if essai:
        (essai / "bilan_exposes.json").write_text(json.dumps(bilan, ensure_ascii=False, indent=1, default=str),
                                                 encoding="utf-8")
    lues = len(a_lire)
    print(f"\n📊 {lues} pages : {trouves} exposés trouvés ({octets / 1e6:.1f} Mo), {sans} sans exposé (non écrits, relus plus tard), "
          f"{echecs} en échec" + ("" if essai else f" ; {ecrites} dossiers écrits"))
    # Une page pas encore publiée est normale et se réessaie plus tard. Une
    # majorité d'échecs, elle, dit que la source ou la lecture est cassée.
    if lues >= 10 and echecs > lues / 2:
        sys.exit(1)


if __name__ == "__main__":
    main()
