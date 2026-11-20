"""Relie un vote par scrutin public aux amendements adoptés qu'il a tranchés, et un vote
sur amendement de l'Assemblée au dossier législatif qu'il amende.

`relier_votes` est appelé par `import_scrutins_cloud.py` (Assemblée) et `sync_senat.py`
(Sénat), qui construisent chacun leurs votes puis écrivent dans `votes_amendements` son
résultat. `RattachementVotes` est appelé par `import_amendements.py`, qui a le dump des
amendements de l'Assemblée en main, et écrit `scrutins.dossier_uid`. Aucune source ne
publie ces liens : ils se déduisent de l'intitulé du vote.

La règle est de ne relier que ce qui est sûr. Un vote affiché sur le mauvais amendement
attribue à des élus une position qu'ils n'ont pas prise, alors qu'un vote non relié ne
fait que dire « aucun scrutin public relié » sur la page.

La liaison lit `amendements` au moment de l'écriture : un amendement importé après ce
script ce soir-là se relie la nuit suivante.
"""

from __future__ import annotations

import re
import unicodedata
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


def _dossiers_des_votes(uids: list[str]) -> dict[str, str]:
    """`scrutins.dossier_uid` des votes donnés qui en ont un, posé par `import_amendements.py`
    (`RattachementVotes`). Un vote importé ce soir n'en a pas encore : il l'aura après
    l'étape `amendements`, qui retire alors un lien contradictoire
    (`retirer_liens_contradictoires`)."""
    with connexion(autocommit=True) as conn:
        lignes = lire(
            conn,
            "SELECT uid, dossier_uid FROM scrutins WHERE uid = ANY(%s) AND dossier_uid IS NOT NULL ORDER BY uid",
            (uids,),
        )
    return {l["uid"]: l["dossier_uid"] for l in lignes}


def retirer_liens_contradictoires(conn) -> int:
    """Vide `amendement_uids` des votes de l'Assemblée reliés à un amendement d'un autre
    texte que leur `scrutins.dossier_uid`, et rend le nombre de votes vidés.

    Appelé par `import_amendements.py` juste après avoir posé `dossier_uid` : `relier_votes`
    a tourné plus tôt dans la nuit, avant que le texte d'un vote du jour soit connu. Mieux
    vaut pas de vote qu'un faux vote ; la nuit suivante, `relier_votes` refait le lien avec
    le texte en main. 2 votes ainsi au 2026-11-20, sur 1 800 reliés dont le texte est
    connu (VTANR5L17V945, relié à l'amendement n° 3 du texte sur l'Ukraine)."""
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            UPDATE votes_amendements v SET amendement_uids = '{}'
              FROM scrutins s
             WHERE s.uid = v.uid AND v.chambre = 'AN' AND s.dossier_uid IS NOT NULL
               AND cardinality(v.amendement_uids) > 0
               AND EXISTS (SELECT 1 FROM amendements a
                            WHERE a.uid = ANY(v.amendement_uids) AND a.dossier_uid <> s.dossier_uid)
            """
        )
        return cur.rowcount


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
    À l'Assemblée, quand `scrutins.dossier_uid` donne le texte du vote, seul un amendement
    de ce texte peut être retenu : sans ce filtre, le même numéro adopté le même jour sur
    un autre texte prenait le vote (VTANR5L17V945, LOI-84).

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

    dossier_du_vote = _dossiers_des_votes([v["uid"] for v in votes]) if chambre == "AN" else {}

    compteurs = {"votes": len(votes), "relies": 0, "non_relies": 0, "ambigus": 0}
    lignes = []
    for vote in votes:
        ligne = dict(vote)
        dossier_uid = ligne.pop("dossier_uid", None)
        texte_du_vote = dossier_du_vote.get(ligne["uid"])
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
                def du_texte(cands: list[dict]) -> list[dict]:
                    return [a for a in cands if not texte_du_vote or a["dossier_uid"] == texte_du_vote]

                retenus = du_texte(_du_meme_article(index.get((sans_prefixe(numero), date_vote), []), article,
                                                    avec_position=True))
                if not retenus:
                    retenus = du_texte(_du_meme_article(index.get((sans_prefixe(numero), lendemain), []), article,
                                                        avec_position=True))
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


# Le texte cité par l'intitulé d'un vote : « …après l'article 3 du projet de loi relatif
# à … (première lecture). » La parenthèse de la lecture termine le titre.
_TITRE_DU_TEXTE = re.compile(r"(?:du |de la |de l')((?:projet|proposition) de loi[^()]*?)\s*\(", re.IGNORECASE)

# Plus court, un titre contenu dans un autre ne départage plus rien (« projet de loi de
# finances » est dans chaque budget).
_LONGUEUR_MIN_TITRE_CONTENU = 40


def _titre_comparable(s: str | None) -> str:
    """Minuscules, sans accents, mots séparés d'une espace : « L'État » → « l etat »."""
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _seul(ensemble: set):
    """L'unique élément d'un ensemble, ou None s'il en a zéro ou plusieurs."""
    return next(iter(ensemble)) if len(ensemble) == 1 else None


class RattachementVotes:
    """Rattache un scrutin sur amendement de l'Assemblée à son dossier législatif.

    Construit une fois par `import_amendements.py`, puis interrogé vote par vote avec
    `dossier_du_vote`. Entrées :
      - `amendements` : les amendements de séance du dump de l'Assemblée, adoptés ou non,
        de tout dossier, chacun `{dossier_uid, numero, article, sort}` (numéro sans
        rectification, article de `_article_court`, `sort` la date du sort en AAAA-MM-JJ
        ou None) ;
      - `dossiers` : `dossiers_legislatifs`, chacun `{uid, titre, date_depot}`.

    Banc du 2026-11-20 sur les 8 730 votes sur amendement de la base : 8 658 rattachés
    (99,2 %). Sur les 1 800 dont `votes_amendements` donne le dossier, 2 désaccords, où
    c'est `votes_amendements` qui se trompe : l'intitulé de VTANR5L17V945 cite la loi
    sur les communes rurales, la table l'a relié à l'amendement n° 3 du même jour sur
    l'Ukraine.
    """

    def __init__(self, amendements: list[dict], dossiers: list[dict]):
        self.par_numero: dict[str, list[dict]] = defaultdict(list)
        for a in amendements:
            self.par_numero[sans_prefixe(a["numero"])].append(a)
        self.dossiers_du_dump = {a["dossier_uid"] for a in amendements}
        self.depot = {d["uid"]: (str(d["date_depot"]) if d["date_depot"] else None) for d in dossiers}
        self.titres = {d["uid"]: _titre_comparable(d["titre"]) for d in dossiers}
        self.par_titre: dict[str, set[str]] = defaultdict(set)
        for uid, t in self.titres.items():
            if t:
                self.par_titre[t].add(uid)

    def _plausibles(self, candidats: set[str], jour: str, porteurs: set[str]) -> set[str]:
        """Candidats par le titre qui peuvent être le bon : déposés au plus tard le jour du
        vote et, quand le dump connaît encore leurs amendements, portant le numéro voté.
        Parmi plusieurs homonymes restants, le plus récemment déposé."""
        c = {u for u in candidats if not self.depot.get(u) or self.depot[u] <= jour}
        c = {u for u in c if u not in self.dossiers_du_dump or not porteurs or u in porteurs}
        if len(c) > 1:
            dates = {u: self.depot.get(u) or "" for u in c}
            recent = max(dates.values())
            c = {u for u in c if dates[u] == recent}
        return c

    def dossier_du_vote(self, titre: str | None, date_scrutin) -> str | None:
        """Dossier du vote, ou None quand aucune règle ne tranche sans ambiguïté.

        Cascade, la première qui tranche l'emporte :
          1. le numéro voté, sur le même article, a son sort le jour du vote ou le
             lendemain (séance après minuit) dans un seul dossier ;
          2. plusieurs dossiers ainsi, mais un seul dont le titre est dans l'intitulé ;
          3. le titre cité est celui d'un seul dossier en base ;
          4. sinon, le plus long titre de dossier contenu dans le titre cité, ou qui le
             contient, s'il est seul de sa longueur.
        """
        titre = (titre or "").translate(_APOSTROPHES)
        jour = str(date_scrutin or "")[:10]
        if not jour:
            return None
        article = cle_article(titre)
        intitule = _titre_comparable(titre)
        numeros = numeros_du_titre(titre)
        porteurs = {a["dossier_uid"] for x in numeros for a in self.par_numero.get(sans_prefixe(x), [])}
        m = _TITRE_DU_TEXTE.search(titre)
        cite = _titre_comparable(m.group(1)) if m else ""
        # Un titre ne tranche que s'il désigne un seul dossier en base : les budgets ont
        # plusieurs dossiers au même titre (« projet de loi de finances pour 2026 »), et
        # choisir parmi eux se trompait 182 fois sur 182 au banc.
        homonymes = self.par_titre.get(cite, set()) if cite else set()
        exact = _seul(self._plausibles(homonymes, jour, porteurs)) if len(homonymes) == 1 else None

        par_date = set()
        for x in numeros:
            candidats = _du_meme_article(self.par_numero.get(sans_prefixe(x), []), article, avec_position=True)
            par_date |= {
                a["dossier_uid"] for a in candidats
                if a["sort"] and 0 <= (date.fromisoformat(a["sort"]) - date.fromisoformat(jour)).days <= 1
            }
        # Le titre ne contredit jamais une date qui tranche : laisser le titre cité
        # l'emporter sur le seul dossier trouvé par la date se trompait 9 fois sur 9 au
        # banc, un même texte ayant parfois deux dossiers aux titres voisins.
        if _seul(par_date):
            return _seul(par_date)
        if par_date:
            par_titre = {d for d in par_date if self.titres.get(d) and self.titres[d] in intitule}
            if _seul(par_titre):
                return _seul(par_titre)
        if exact:
            return exact
        if cite and not homonymes:
            contenus = {u for u, t in self.titres.items()
                        if t and len(t) >= _LONGUEUR_MIN_TITRE_CONTENU and (t in cite or cite in t)}
            if contenus:
                longueur = max(len(self.titres[u]) for u in contenus)
                meilleurs = {u for u in contenus if len(self.titres[u]) == longueur}
                if len(meilleurs) == 1 and _seul(self._plausibles(meilleurs, jour, porteurs)):
                    return _seul(meilleurs)
        return None
