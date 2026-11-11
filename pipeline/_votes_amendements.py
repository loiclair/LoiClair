"""Relie un vote par scrutin public aux amendements adoptés qu'il a tranchés.

Appelé par `import_scrutins_cloud.py` (Assemblée) et `sync_senat.py` (Sénat), qui
construisent chacun leurs votes puis écrivent dans `votes_amendements` le résultat de
`relier_votes`. Aucune source ne publie ce lien : il se déduit de l'intitulé du vote.

La règle est de ne relier que ce qui est sûr. Un vote affiché sur le mauvais amendement
attribue à des élus une position qu'ils n'ont pas prise, alors qu'un vote non relié ne
fait que dire « aucun scrutin public relié » sur la page.

La liaison lit `amendements` au moment de l'écriture : un amendement importé après ce
script ce soir-là se relie la nuit suivante.
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta

from _db import connexion, lire

# Apostrophes du dump du Sénat (Windows-1252) et typographique de l'Assemblée.
_APOSTROPHES = str.maketrans({"\u0092": "'", "’": "'"})

# Le vote porte sur un amendement seulement si l'intitulé commence ainsi. Le mot
# « amendement » ailleurs ne suffit pas : « l'ensemble du projet de loi autorisant la
# ratification de la résolution portant amendement de l'article 6 » (VTANR5L17V2460).
_DEBUT_VOTE = re.compile(
    r"^(?:sur\s+)?(?:l'amendement|le\s+sous-amendement|les\s+amendements|les\s+sous-amendements)\b",
    re.IGNORECASE,
)

# Ce qui suit les numéros votés. Un sous-amendement cite l'amendement qu'il modifie
# (« le sous-amendement n° 864 à l'amendement n° 859 ») : seul le premier a été voté.
_FIN_NUMEROS = re.compile(
    r"\bà\s+l'amendement\b|\bà\s+l'article\b|\baprès\s+l'article\b|\bavant\s+l'article\b"
    r"|\btendant\b|\bsur\s+les\s+crédits\b|\bsur\s+l'article\b|\bde\s+suppression\s+de\b"
    r"|\bde\s+rétablissement\s+de\b|\bdu\s+projet\s+de\s+loi\b|\bde\s+la\s+proposition\b",
    re.IGNORECASE,
)
# « n° de 2102 » : coquille relevée dans un intitulé de l'Assemblée (VTANR5L17V2414).
_NUMERO = re.compile(r"n\s*[°º]\s*(?:de\s+)?((?:[A-Z]+-)?\d+)")
_IDENTIQUES = re.compile(r"identiques?\s+suivants?", re.IGNORECASE)

_SUFFIXES = r"bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies|vicies"
_ARTICLE = re.compile(
    rf"(?:\b(après|avant)\s+)?(?:l'|le\s+)?\b(?:art\.?|article)\s+"
    rf"(premier|1er|unique|liminaire|\d+)(?:\s+({_SUFFIXES}))?(?:\s+([a-z])\b)?",
    re.IGNORECASE,
)


def est_vote_sur_amendement(titre: str | None) -> bool:
    """Vrai si l'intitulé désigne un vote sur un amendement ou un sous-amendement."""
    return bool(_DEBUT_VOTE.match((titre or "").translate(_APOSTROPHES).strip()))


def numeros_du_titre(titre: str) -> list[str]:
    """Numéros des amendements votés, tels que l'intitulé les écrit (« 71 », « II-19 »)."""
    t = titre.translate(_APOSTROPHES)
    fin = _FIN_NUMEROS.search(t)
    return _NUMERO.findall(t[: fin.start()] if fin else t)


def sans_prefixe(numero: str) -> str:
    """« I-71 » → « 71 » : le titre d'un vote de l'Assemblée omet la partie du budget."""
    return numero.rsplit("-", 1)[-1]


def cle_article(texte: str | None) -> tuple[str, str] | None:
    """Forme comparable d'un article, ou None si le texte n'en désigne pas un.

    Rapproche « après l'article 4 » (intitulé) et « Après art. 4 » (`amendements.article`),
    « l'article premier » et « Art. 1er ». Sert à départager, jamais à exclure seule : un
    « État B » ou une mission budgétaire n'ont pas de clé.
    """
    m = _ARTICLE.search((texte or "").translate(_APOSTROPHES))
    if not m:
        return None
    position, numero, suffixe, lettre = m.groups()
    numero = numero.casefold()
    numero = "1" if numero in ("premier", "1er") else numero
    reste = " ".join(p.casefold() for p in (suffixe, lettre) if p)
    return ((position or "").casefold(), f"{numero} {reste}".strip())


def _du_meme_article(candidats: list[dict], article: tuple[str, str] | None,
                     *, avec_position: bool) -> list[dict]:
    """Écarte les candidats dont l'article contredit celui de l'intitulé.

    Vaut aussi pour un candidat seul : le même numéro le même jour peut appartenir à un
    autre texte, quand le véritable amendement n'est pas dans la table. Un article qu'on
    ne sait pas lire (« État B ») ne contredit rien.

    `avec_position` : « après l'article 4 » n'est pas « l'article 4 ». Faux au Sénat, dont
    la table range un article additionnel sous « Art. 4 » : seul le numéro s'y compare.
    """
    if article is None:
        return candidats

    def concorde(c: dict) -> bool:
        cle = cle_article(c["article"])
        return cle is None or (cle == article if avec_position else cle[1] == article[1])

    return [c for c in candidats if concorde(c)]


def _lendemain(jour: str) -> str:
    """Jour suivant une date AAAA-MM-JJ, en AAAA-MM-JJ."""
    return (date.fromisoformat(jour) + timedelta(days=1)).isoformat()


def _amendements_de_seance(chambre: str) -> list[dict]:
    """Les adoptés de séance d'une chambre. Le dispositif arrive réduit à une empreinte :
    il ne sert qu'à comparer, et ses lignes pèsent des dizaines de Mo à elles toutes."""
    with connexion(autocommit=True) as conn:
        return lire(
            conn,
            """
            SELECT uid, dossier_uid, numero, article, date_amendement,
                   CASE WHEN dispositif IS NULL OR dispositif = '' THEN NULL
                        ELSE md5(lower(regexp_replace(dispositif, '\\s+', ' ', 'g'))) END AS empreinte
              FROM amendements
             WHERE chambre = %s AND lieu = 'seance'
             ORDER BY uid
            """,
            (chambre,),
        )


def relier_votes(votes: list[dict], chambre: str) -> tuple[list[dict], dict[str, int]]:
    """Ajoute `amendement_uids` à chaque vote et rend `(lignes à écrire, compteurs)`.

    `votes` : une ligne de `votes_amendements` sans `amendement_uids`, plus, au Sénat, la
    clé `dossier_uid` (retirée ici), que le signet du dump donne. Tous les votes sont
    écrits, reliés ou non : c'est la table qui dit ensuite combien sont restés sans lien.

    Assemblée : même numéro sans préfixe, le jour du vote ou, à défaut, le lendemain
    (`date_amendement` y est la date du sort, et une séance déborde parfois après minuit :
    34 votes sur 2 044 au 2026-11-08). Sénat : même dossier et même numéro, déposé au plus
    tard le lendemain du vote (`date_amendement` y est la date de dépôt, sauf pour une
    seconde délibération, déposée le jour même et datée du lendemain). Dans les deux cas
    l'article de l'intitulé doit concorder, et ce qui reste ambigu n'est pas relié.

    Les « amendements identiques suivants » de l'Assemblée ne sont pas nommés : ce sont
    les adoptés du même dossier, du même jour, sur le même article, au même dispositif.
    Le Sénat, lui, cite chaque numéro.
    """
    amendements = _amendements_de_seance(chambre)
    index: dict[tuple, list[dict]] = defaultdict(list)
    identiques: dict[tuple, list[dict]] = defaultdict(list)
    for a in amendements:
        if chambre == "AN":
            index[(sans_prefixe(a["numero"]), str(a["date_amendement"]))].append(a)
            if a["empreinte"]:
                cle = (a["dossier_uid"], str(a["date_amendement"]), a["article"], a["empreinte"])
                identiques[cle].append(a)
        else:
            index[(a["dossier_uid"], a["numero"])].append(a)

    compteurs = {"votes": len(votes), "relies": 0, "non_relies": 0, "ambigus": 0}
    lignes = []
    for vote in votes:
        ligne = dict(vote)
        dossier_uid = ligne.pop("dossier_uid", None)
        date_vote = (ligne["date_scrutin"] or "")[:10]
        # Un vote sans date ne se relie à rien, mais ne doit pas arrêter l'écriture des
        # autres : `date.fromisoformat("")` lève.
        lendemain = _lendemain(date_vote) if date_vote else ""
        titre = (ligne["titre"] or "").translate(_APOSTROPHES)
        # Le premier article cité est celui du vote : une « loi portant article » arrive
        # après lui, et les numéros d'amendement n'ont pas la forme d'un article.
        article = cle_article(titre)

        uids: set[str] = set()
        ambigu = False
        for numero in numeros_du_titre(titre):
            if chambre == "AN":
                retenus = _du_meme_article(index.get((sans_prefixe(numero), date_vote), []), article,
                                           avec_position=True)
                if not retenus:
                    retenus = _du_meme_article(index.get((sans_prefixe(numero), lendemain), []), article,
                                               avec_position=True)
            else:
                retenus = _du_meme_article([
                    a for a in index.get((dossier_uid, numero), [])
                    if a["date_amendement"] is None or str(a["date_amendement"]) <= lendemain
                ], article, avec_position=False)
            if len(retenus) > 1:
                ambigu = True
                continue
            if not retenus:
                continue
            principal = retenus[0]
            uids.add(principal["uid"])
            if chambre == "AN" and _IDENTIQUES.search(titre) and principal["empreinte"]:
                # La date du principal, pas celle du vote : ses identiques ont le même sort.
                cle = (principal["dossier_uid"], str(principal["date_amendement"]),
                       principal["article"], principal["empreinte"])
                uids.update(a["uid"] for a in identiques.get(cle, []))

        ligne["amendement_uids"] = sorted(uids)
        lignes.append(ligne)
        if uids:
            compteurs["relies"] += 1
        elif ambigu:
            compteurs["ambigus"] += 1
        else:
            compteurs["non_relies"] += 1
    return lignes, compteurs
