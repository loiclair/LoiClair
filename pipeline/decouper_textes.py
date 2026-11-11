# decouper_textes.py
# Découpe en articles la version qui fait foi de chaque dossier, une ligne par article
# dans la table `texte_articles`. Sert à « Ce qui me concerne » : l'IA classe ensuite
# chaque article selon les profils de lecteur qu'il touche (`classer_articles.py`).
#
# Lancé chaque nuit par `nightly.py` (étape `decouper-textes`, nombre de pages
# borné), et à la main pour la première passe, qui télécharge environ 2 400 pages.
#   python3 -P decouper_textes.py                 # découpe ce qui manque et écrit en base
#   python3 -P decouper_textes.py --limite 40     # au plus 40 pages téléchargées
#   python3 -P decouper_textes.py --essai D       # découpe sans écrire, un fichier par version dans D
#   python3 -P decouper_textes.py --dossiers DLR5L17N52976 …  # seulement ces dossiers
#
# Périmètre : les procédures de loi (`PROCEDURES_LOI`, mêmes que
# `PROCEDURES_PROMULGABLES` de `src/lib/facts-shared.ts`), à trois stades.
#   - Promulguée depuis le 1er juillet 2024 : la loi publiée au Journal officiel, lue
#     dans `textes.contenu_legifrance`. Elle contient déjà l'effet des amendements.
#   - En navette (adoptée par une chambre, ou rejetée) : la dernière version, celle que
#     la chambre suivante examine, hors texte rejeté en séance (sans article). Les
#     textes de commission (`BTC` dans l'uid) n'en sont pas : on garde le texte
#     transmis, et les amendements adoptés ensuite en commission puis en séance se
#     lisent à côté (`classer_articles.py`). Ce sont souvent des dossiers des
#     législatures précédentes, redéposés depuis.
#   - Déposée depuis le 1er juillet 2024 et jamais votée : le texte déposé. Le budget
#     (PLF, PLFSS) en fait partie tant que l'Assemblée ne l'a pas adopté : le texte du
#     Gouvernement est alors celui que la séance examine (art. 42 de la Constitution).
#
# Une version déjà découpée ne se retélécharge pas : un texte publié ne change plus.
# Une nuit ordinaire ne lit donc que les dépôts du jour et les dossiers qui changent de
# stade. Quand la version qui fait foi change, les articles de l'ancienne et leur
# classement sont supprimés. Si elle est illisible (pas encore publiée, ou PDF seul),
# le dossier garde la version précédente : celle déjà en base, sinon la version HTML
# antérieure, et la nuit suivante réessaie. Une page de l'Assemblée ne se réessaie
# que `RETENTER_JOURS` après la date de la version, puis au seul passage complet (sans
# `--limite`) : 45 propositions n'y ont qu'une couverture, en HTML comme en PDF, et
# relues chaque nuit elles prenaient le quota de pages et dépassaient la moitié des
# lectures, seuil où l'étape se déclare en échec. Le Sénat n'a pas cette borne : une
# page qu'il publie en retard est marquée lisible par `sync_senat.py` (revérifiée
# chaque lundi), et le 2026-10-16 une proposition d'avril l'était devenue.
#
# Sources :
#   - Assemblée : page HTML d'open data (`/dyn/opendata/<uid>.html`), ou page `.asp`
#     pour les vieux dossiers (législatures 8 à 14) ;
#   - Sénat : page HTML du texte (`/leg/<signet>.html`), mise en page sur deux colonnes ;
#   - loi publiée : `textes.contenu_legifrance`, déjà en base (texte brut).

from __future__ import annotations

import argparse
import hashlib
import html
import json
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")
from _db import connexion  # noqa: E402
from _telechargement import recuperer  # noqa: E402
from import_amendements import _article_court  # noqa: E402

# Lots d'écriture bornés : un envoi de plusieurs dizaines de Mo d'un coup a déjà perdu
# sa connexion en route (voir `import_amendements.TAILLE_LOT_TEXTES`).
TAILLE_LOT = 200

# ===================================================================
# Périmètre
# ===================================================================

# Les procédures de loi de `PROCEDURES_PROMULGABLES` (`src/lib/facts-shared.ts`), sauf
# la loi d'approbation des comptes : elle constate l'exécution d'un budget passé et ne
# change rien pour un lecteur, comme les résolutions, rapports et engagements de
# responsabilité. Les traités en font partie : leur article unique autorise
# l'approbation, et l'IA le range presque toujours sans profil, ce qui est juste.
PROCEDURES_LOI = [
    "Proposition de loi ordinaire",
    "Projet de loi ordinaire",
    "Projet ou proposition de loi constitutionnelle",
    "Projet ou proposition de loi organique",
    "Projet de ratification des traités et conventions",
    "Projet de loi de finances rectificative",
    "Projet de loi de financement de la sécurité sociale",
    "Projet de loi de finances de l'année",
]
# Début de la 17e législature : en deçà, une proposition jamais votée est caduque, et
# une loi promulguée sort du champ de « ce qui me concerne aujourd'hui ».
DEBUT_PERIMETRE = "2024-07-01"
RETENTER_JOURS = 60

# Toutes les versions candidates de chaque dossier du périmètre, la meilleure en tête.
#   - Ordre : la plus récente d'abord. `date_depot` manque aux textes adoptés en séance
#     (`BTA`), d'où le repli sur la date de publication puis de création.
#   - À date égale, la page HTML avant le PDF : un texte adopté provisoire (`TAP`, en
#     PDF) a toujours sa jumelle `BTA` en HTML, datée du même jour.
#   - Les dossiers les plus récemment déposés d'abord : la nuit ne lit que `--limite`
#     pages, et une cinquantaine de vieux textes échouent à chaque essai (l'Assemblée
#     n'en a publié que la couverture, en HTML comme en PDF). Rangés en tête, ils
#     mangeraient tout le quota et les nouveaux dépôts n'entreraient jamais.
#   - Jamais un texte rejeté en séance (`REJETSEANCE`) : sa page ne porte que la mention
#     du rejet, sans article. Retenté chaque nuit, il comptait en échec : les 4 rejets
#     du Sénat de 2024-2025 faisaient à eux seuls dépasser la moitié des lectures, seuil
#     où l'étape se déclare en échec (2026-10-20 et 2026-10-23). Le dossier garde la
#     version précédente, celle que la chambre suivante examine.
REQUETE_CANDIDATS = """
    WITH perimetre AS (
        SELECT uid, titre, date_depot AS depot,
               CASE WHEN statut_final IN ('Promulguée', 'Appliquée') THEN 'promulguee'
                    WHEN statut_final = 'Déposé - pas encore voté' THEN 'deposee'
                    ELSE 'navette' END AS stade
        FROM dossiers_legislatifs
        -- `hors_liste` : dossiers absents des listes (migration
        -- 2026-10-29_dossiers_hors_liste.sql). Leurs articles ne mèneraient qu'au
        -- classement IA de `classer_articles.py`, qui lit son périmètre ici.
        WHERE NOT hors_liste
          AND procedure_libelle = ANY(%(procedures)s)
          AND ((statut_final IN ('Promulguée', 'Appliquée') AND date_promulgation >= %(debut)s)
               OR statut_final IN ('Adopté par le Sénat', 'Adopté par l''Assemblée nationale',
                                   'Adopté par le Parlement', 'Rejeté',
                                   'Rejeté par l''Assemblée nationale', 'Rejeté par le Sénat')
               OR (statut_final = 'Déposé - pas encore voté' AND date_depot >= %(debut)s))
    )
    SELECT p.uid, p.titre, p.stade, t.uid, t.type_code, t.lien_texte, coalesce(t.url_accessible, true),
           coalesce(t.date_depot, t.date_publication, t.date_creation)::date
    FROM perimetre p
    JOIN textes t ON t.dossier_ref = p.uid
    WHERE (p.stade = 'promulguee' AND t.type_code = 'LOI'
           AND NOT coalesce(t.is_version_consolidee, false) AND coalesce(t.contenu_legifrance, '') <> '')
       OR (p.stade <> 'promulguee' AND t.type_code IN ('PION', 'PRJL') AND t.uid NOT LIKE '%%BTC%%'
           AND coalesce(t.statut_adoption, '') <> 'REJETSEANCE')
       -- Loi promulguée dont Légifrance n'est pas encore en base (un à trois jours) :
       -- le dossier garde son dernier texte voté et son classement d'ici là, au lieu
       -- de sortir de la page (choix d'Alex, 2026-10-17). Les phrases restent au
       -- conditionnel de ce texte ; la loi les remplace à son arrivée.
       OR (p.stade = 'promulguee' AND t.type_code IN ('PION', 'PRJL') AND t.uid NOT LIKE '%%BTC%%'
           AND coalesce(t.statut_adoption, '') <> 'REJETSEANCE'
           AND NOT EXISTS (SELECT 1 FROM textes l WHERE l.dossier_ref = p.uid AND l.type_code = 'LOI'
                             AND NOT coalesce(l.is_version_consolidee, false)
                             AND coalesce(l.contenu_legifrance, '') <> ''))
    ORDER BY p.depot DESC NULLS LAST, p.uid, coalesce(t.date_depot, t.date_publication, t.date_creation) DESC NULLS LAST,
             (t.lien_texte ~* '\\.html?$') DESC, t.uid DESC
"""


def dossiers_du_perimetre(cur, seulement: list[str] | None) -> list[dict]:
    """Les dossiers du périmètre, chacun avec ses versions candidates dans l'ordre de
    préférence. Une loi promulguée dont Légifrance n'est pas encore en base garde
    pour candidates ses textes votés. Un dossier sans aucune candidate (aucun texte
    en base) n'y figure pas : il entrera une nuit suivante."""
    cur.execute(REQUETE_CANDIDATS, {"procedures": PROCEDURES_LOI, "debut": DEBUT_PERIMETRE})
    dossiers: dict[str, dict] = {}
    for d_uid, titre, stade, t_uid, type_code, lien, accessible, date_version in cur.fetchall():
        if seulement and d_uid not in seulement:
            continue
        d = dossiers.setdefault(d_uid, {"uid": d_uid, "titre": titre, "stade": stade, "candidats": []})
        d["candidats"].append({"uid": t_uid, "lien": lien, "accessible": accessible, "date": date_version,
                               "version": "loi" if type_code == "LOI" else "texte"})
    return list(dossiers.values())


# ===================================================================
# HTML → lignes
# ===================================================================

# Balises qui restent dans la ligne : retirées sans espace, pour que « 1<sup>er</sup> »
# donne « 1er » et non « 1 er ».
BALISES_EN_LIGNE = r"sup|sub|span|b|i|u|em|strong|a|font|small|abbr"


# Caractères de la zone d'usage privé d'Unicode : le Sénat numérote ses alinéas par un
# glyphe d'une police maison (« &#xf04c; » en police « Numero »), dans une colonne à
# part. Laissé, il remplit cette colonne et chaque alinéa devient « | alinéa ».
RE_USAGE_PRIVE = re.compile("[-]")


def _texte_de_cellule(fragment: str) -> str:
    """Une cellule de tableau → une ligne (ses paragraphes joints par une espace)."""
    s = re.sub(rf"(?i)</?(?:{BALISES_EN_LIGNE})\b[^>]*>", "", fragment)
    s = re.sub(r"<[^>]+>", " ", s)
    s = RE_USAGE_PRIVE.sub("", html.unescape(s))
    return " ".join(s.replace("\xa0", " ").split())


def _rangee(m: re.Match) -> str:
    """Une rangée `<tr>` : « a | b | c » si elle a au moins deux cellules remplies,
    sinon le contenu de sa seule cellule remplie, paragraphes gardés.

    Le Sénat met tout son texte dans un tableau à deux colonnes dont la première est
    vide : sans ce cas, chaque alinéa deviendrait « | alinéa ». Un vrai tableau (le
    barème de l'impôt dans le budget) garde ses colonnes.
    """
    cellules = re.findall(r"(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>", m.group(1))
    remplies = [c for c in cellules if _texte_de_cellule(c)]
    if len(remplies) >= 2:
        return "\n" + " | ".join(_texte_de_cellule(c) for c in cellules) + "\n"
    return "\n" + (remplies[0] if remplies else "") + "\n"


def lignes_de_html(source: bytes) -> list[str]:
    """Page HTML d'un texte → ses lignes de texte, une par paragraphe, sans les vides."""
    m = re.search(rb'charset=["\']?([\w-]+)', source[:5000])
    s = source.decode(m.group(1).decode() if m else "utf-8", "replace")
    s = re.sub(r"(?is)<(script|style|head|nav|header|footer)\b.*?</\1>", " ", s)
    s = re.sub(r"[\r\n]+", " ", s)
    # Les rangées les plus internes d'abord : un tableau dans une cellule du Sénat.
    for _ in range(3):
        s2 = re.sub(r"(?is)<tr\b[^>]*>((?:(?!<tr\b).)*?)</tr>", _rangee, s)
        if s2 == s:
            break
        s = s2
    s = re.sub(rf"(?i)</?(?:{BALISES_EN_LIGNE})\b[^>]*>", "", s)
    s = re.sub(r"<[^>]+>", "\n", s)
    s = RE_USAGE_PRIVE.sub("", html.unescape(s)).replace("\xa0", " ").replace(" ", " ")
    return [l for l in (" ".join(x.split()) for x in s.split("\n")) if l]


# ===================================================================
# Lignes → articles
# ===================================================================

SUFFIXES = ("bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies|undecies|"
            "duodecies|terdecies|quaterdecies|quindecies|sexdecies|septdecies|octodecies|"
            "novodecies|vicies")

# « Article 12 », « Article 1er A », « Article 6 bis AA », « ARTICLE 3 : Titre »,
# « Article 7 ter (Supprimé) », « Article liminaire », « Article unique ». La casse des
# lettres finales compte (« A » est un article, « a » ne l'est pas), d'où la
# normalisation du seul premier mot avant le test. Le budget écrit parfois son titre
# sur la ligne suivante (« ARTICLE 10 : » seul), parfois avec deux deux-points
# (« ARTICLE 37 : : Contribution… », « ARTICLE 71 :: Prorogation… »).
RE_TITRE_ARTICLE = re.compile(
    rf"^Article (?P<num>(?:premier|1er|liminaire|unique|\d+(?:er)?)(?: (?:{SUFFIXES}))*(?: [A-Z]{{1,3}})?)"
    r"(?P<reste>(?: ?\((?:nouveau|supprimé|Supprimé|non modifié|Non modifié|pour coordination|"
    r"Pour coordination)\))*(?: ?[:–-]+(?: .*)?)?)$"
)
# « Articles 11 et 12 (Supprimés) », « Articles 4 à 6 » : un groupe sans contenu propre.
RE_GROUPE_ARTICLES = re.compile(r"^Articles \S+.* (?:et|à) \S+")
# Les intertitres de structure ferment l'article en cours sans en faire partie.
RE_INTERTITRE = re.compile(
    r"^(?:-{3} )?(?:TITRE|Titre|CHAPITRE|Chapitre|SECTION|Section|Sous-section|SOUS-SECTION|"
    r"(?:PREMIÈRE|DEUXIÈME|SECONDE|TROISIÈME) PARTIE|Livre|LIVRE)\b"
)
# Fin des articles : signatures, formule exécutoire, états annexés du budget, et le
# pied des pages du Sénat, qui suit le dernier article sans autre séparation.
RE_FIN = re.compile(
    r"^(?:Délibéré en |Fait à |La présente loi sera exécutée|États législatifs annexés|"
    r"ÉTATS LÉGISLATIFS ANNEXÉS|Le présent projet de loi, délibéré|Page mise à jour le|"
    r"Partager cette page|Les thèmes associés à ce texte|RAPPORT ANNEXÉ$|"
    # Les notes de l'exposé des motifs, que l'Assemblée place après le dernier
    # article : « [(1)](1) Ce groupe est composé de… », « ([10]) Selon… », « [2] … ».
    r"\[\(\d+\)\]|\(\[\d+\]\)|\[\d+\] )"
)
# Une ligne de points marque, dans un texte de commission mixte paritaire, les
# alinéas laissés tels quels : rien à lire.
RE_POINTILLES = re.compile(r"^[.…\s]+$")
RE_ETAT = re.compile(r"^[EÉ]tat (?P<lettre>[A-H]) - ")
RE_ALINEA = re.compile(r"^\(\d+\)$")
RE_PIED_DE_PAGE = re.compile(r"^(?:(?:Projet|Proposition) de loi[^|]{0,80} \| \d+|– \d+ –)$")


def _numero(brut: str) -> str:
    """« 1er bis » → « Art. 1er bis », même forme que `amendements.article`."""
    return _article_court(f"Article {brut}") or f"Art. {brut}"


def decouper(lignes: list[str]) -> tuple[list[dict], dict]:
    """Lignes d'une version → articles, plus un compte rendu.

    Un article court de son titre au titre suivant, à un intertitre, ou à la fin des
    articles. Ce qui suit « Exposé des motifs » (dans le budget, après chaque article)
    est écarté jusqu'au titre suivant : c'est l'explication du Gouvernement, pas la loi.
    Un numéro vu deux fois garde sa dernière occurrence : la table des matières du
    budget répète chaque titre d'article avant le corps du texte. Après « États
    législatifs annexés », chaque état (« État B ») devient une unité, sous le numéro
    qu'emploient les amendements de crédits.
    """
    articles: dict[str, dict] = {}
    supprimes: list[str] = []
    suspects: list[str] = []
    courant = None
    dans_etats = False
    ecarte = True

    # Une table des matières en tête (le budget) répète les titres d'articles, et se
    # termine par « États législatifs annexés », qui ouvrirait les états avant même le
    # premier article. Le corps commence donc à la seconde apparition du premier titre.
    titres = [(i, m.group("num")) for i, l in enumerate(lignes)
              if (m := RE_TITRE_ARTICLE.match(re.sub(r"^ARTICLES?\b", lambda x: x.group(0).capitalize(), l)))]
    if titres:
        repetitions = [i for i, num in titres if num == titres[0][1]]
        if len(repetitions) > 1:
            lignes = lignes[repetitions[1]:]

    def fermer():
        nonlocal courant
        if courant is not None:
            if courant["lignes"]:
                courant["contenu"] = "\n".join(courant.pop("lignes"))
                articles.pop(courant["numero"], None)
                articles[courant["numero"]] = courant
            elif courant["numero"] not in articles:
                supprimes.append(courant["numero"])
        courant = None

    for ligne in lignes:
        if RE_ALINEA.match(ligne) or RE_PIED_DE_PAGE.match(ligne) or RE_POINTILLES.match(ligne):
            continue
        normale = re.sub(r"^ARTICLES?\b", lambda m: m.group(0).capitalize(), ligne)
        m_etat = RE_ETAT.match(ligne)
        if dans_etats and m_etat:
            fermer()
            courant = {"numero": f"État {m_etat.group('lettre')}", "lignes": [ligne]}
            ecarte = False
            continue
        if RE_FIN.match(ligne):
            fermer()
            ecarte = True
            dans_etats = dans_etats or "annexés" in ligne.lower()
            continue
        if dans_etats:
            # Légifrance range parfois des articles après les états : la loi de fin de
            # gestion pour 2024 (LOI20241167) y met sa première partie, articles 1 à 3.
            # Un titre d'article encore jamais vu reprend donc le fil des articles ; un
            # numéro déjà vu reste une cellule de tableau.
            m = RE_TITRE_ARTICLE.match(normale)
            if m and _numero(m.group("num")) not in articles and _numero(m.group("num")) not in supprimes:
                dans_etats = False
            else:
                if courant is not None and not ecarte:
                    courant["lignes"].append(ligne)
                continue
        m = RE_TITRE_ARTICLE.match(normale)
        if m:
            fermer()
            reste = m.group("reste")
            if re.search(r"(?i)supprimé", reste):
                supprimes.append(_numero(m.group("num")))
                ecarte = True
                continue
            courant = {"numero": _numero(m.group("num")), "lignes": []}
            titre = re.sub(r"^ ?(?:[:–-] ?)+", "", reste.split(")")[-1]).strip()
            if titre:
                courant["lignes"].append(titre)
            ecarte = False
            continue
        if RE_GROUPE_ARTICLES.match(normale) and len(normale) < 80:
            fermer()
            supprimes.append(normale)
            ecarte = True
            continue
        if RE_INTERTITRE.match(ligne) and len(ligne) < 300:
            fermer()
            ecarte = True
            continue
        if ligne in ("Exposé des motifs", "EXPOSÉ DES MOTIFS"):
            if courant is not None:
                fermer()
            ecarte = True
            continue
        if courant is not None and not ecarte:
            if re.match(r"^Article \d", normale) and len(normale) < 40:
                suspects.append(normale)
            if ligne in ("(Supprimé)", "(Supprimés)") and not courant["lignes"]:
                supprimes.append(courant["numero"])
                courant = None
                continue
            courant["lignes"].append(ligne)
    fermer()

    liste = list(articles.values())
    for i, a in enumerate(liste, start=1):
        a["ordre"] = i
    return liste, {"supprimes": supprimes, "suspects": suspects}


def _base(numero: str) -> int | None:
    """« Art. 12 bis A » → 12 ; « Art. 1er » → 1 ; « Art. liminaire », « État B » → None."""
    m = re.match(r"Art\. (\d+)", numero)
    return int(m.group(1)) if m else None


def controle(articles: list[dict], rapport: dict, lignes: list[str]) -> dict:
    """Contrôles d'une version découpée : numérotation sans trou, aucun article vide,
    aucun titre d'article resté dans un contenu.

    Le texte n'annonce pas son nombre d'articles ; ce qui en tient lieu est la
    numérotation elle-même. Les numéros de base (12 pour « 12 bis ») vont de 1 au plus
    grand sans trou, en comptant les articles supprimés, qui gardent leur numéro.

    Un texte de commission mixte paritaire a des trous légitimes : il ne reprend que
    les articles encore en discussion, ceux que les deux chambres ont votés dans les
    mêmes termes en sont absents. Un trou n'est donc une erreur (`trous`) que si un
    titre de cet article figure bien dans la source ; sinon il est `absents_source`.
    """
    bases = {_base(a["numero"]) for a in articles} | {_base(s) for s in rapport["supprimes"] if s.startswith("Art.")}
    bases.discard(None)
    attendus = set(range(1, max(bases) + 1)) if bases else set()
    titres_source = " ".join(l for l in lignes if len(l) < 120 and re.match(r"(?i)^article", l))

    def dans_source(n: int) -> bool:
        return re.search(rf"(?i)\barticle {n}(?:er)?(?![\d])", titres_source) is not None

    trous = sorted(attendus - bases)
    return {
        "articles": len(articles),
        "plus_grand": max(bases) if bases else None,
        "trous": [n for n in trous if dans_source(n)],
        "absents_source": [n for n in trous if not dans_source(n)],
        "vides": [a["numero"] for a in articles if not a["contenu"].strip()],
        "supprimes": rapport["supprimes"],
        "suspects": rapport["suspects"],
    }


# ===================================================================
# Écriture
# ===================================================================


def _empreinte(contenu: str) -> str:
    return hashlib.md5(contenu.encode("utf-8")).hexdigest()


def ecrire(conn, texte_uid: str, dossier_uid: str, articles: list[dict]) -> tuple[int, int]:
    """Réconcilie les articles d'une version avec la base : insère ou met à jour ceux
    dont le contenu change, supprime ceux qui ne sont plus là. Rejouable : une seconde
    passe sur la même source n'écrit rien. Renvoie (écrits, supprimés)."""
    lignes = [{"ordre": a["ordre"], "numero": a["numero"], "contenu": a["contenu"],
               "empreinte": _empreinte(a["contenu"])} for a in articles]
    ecrits = 0
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("DELETE FROM texte_articles WHERE texte_uid = %s AND ordre > %s", (texte_uid, len(lignes)))
        supprimes = cur.rowcount
        for i in range(0, len(lignes), TAILLE_LOT):
            cur.execute(
                """
                INSERT INTO texte_articles (texte_uid, dossier_uid, ordre, numero, contenu, empreinte)
                SELECT %s, %s, ordre, numero, contenu, empreinte
                FROM jsonb_to_recordset(%s::jsonb) AS v(ordre int, numero text, contenu text, empreinte text)
                ON CONFLICT (texte_uid, ordre) DO UPDATE SET
                  dossier_uid = excluded.dossier_uid, numero = excluded.numero,
                  contenu = excluded.contenu, empreinte = excluded.empreinte
                WHERE (texte_articles.dossier_uid, texte_articles.numero, texte_articles.empreinte)
                      IS DISTINCT FROM (excluded.dossier_uid, excluded.numero, excluded.empreinte)
                """,
                (texte_uid, dossier_uid, json.dumps(lignes[i : i + TAILLE_LOT], ensure_ascii=False)),
            )
            ecrits += cur.rowcount
    return ecrits, supprimes


def purger(conn, anciens: list[str]) -> int:
    """Supprime les articles des versions qui ne font plus foi, et leur classement :
    les autres versions d'un dossier qui a changé de stade (ou laissées par le
    prototype, qui en gardait trois par dossier), et tout dossier sorti du périmètre.

    `main` les calcule sans requête, depuis la liste des versions en base lue au
    départ, et appelle une seule fois en fin de passage : une requête par dossier
    coûtait trois allers-retours vers la base (Paris), soit 18 minutes pour 2 500
    dossiers même sans rien à purger (mesuré le 2026-10-16).

    `impacts` n'a pas de clé étrangère vers `texte_articles` (un élément peut aussi être
    un amendement) : son nettoyage se fait ici, dans la même transaction. Renvoie le
    nombre d'articles supprimés."""
    if not anciens:
        return 0
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("DELETE FROM impacts WHERE element_type = 'article' AND split_part(element_id, '#', 1) = ANY(%s)",
                    (anciens,))
        cur.execute("DELETE FROM texte_articles WHERE texte_uid = ANY(%s)", (anciens,))
        return cur.rowcount


# ===================================================================
# Téléchargement
# ===================================================================

# Délai minimal entre deux pages d'un même site. L'Assemblée répond 429 (trop de
# requêtes) vers la 130e page enchaînée sans pause (mesuré le 2026-10-16) ; 2,5 s la
# tiennent en dessous. Le Sénat n'a pas montré de limite, une seconde reste polie.
DELAI_PAR_SITE = {"assemblee-nationale.fr": 2.5}
DELAI_DEFAUT = 1.0
# Sur un 429, attendre ce que dit `Retry-After`, borné : une valeur aberrante ne doit
# pas consumer les 45 minutes de l'étape de nuit.
ATTENTE_429_MAX = 120
ESSAIS_429 = 3
_dernier_appel: dict[str, float] = {}


def _site(url: str) -> str:
    hote = urlparse(url).hostname or ""
    return ".".join(hote.split(".")[-2:])


def telecharger_page(url: str) -> bytes:
    """Une page de texte, à la cadence du site et en respectant ses 429.

    `recuperer` sans ses reprises (`attentes=()`) : il réessaie un 429 au bout de 5 puis
    30 s sans lire `Retry-After`, et une page en échec se rattrape la nuit suivante."""
    site = _site(url)
    for essai in range(ESSAIS_429):
        attente = _dernier_appel.get(site, 0) + DELAI_PAR_SITE.get(site, DELAI_DEFAUT) - time.monotonic()
        if attente > 0:
            time.sleep(attente)
        _dernier_appel[site] = time.monotonic()
        try:
            return recuperer(url, timeout=60, attentes=())
        except requests.HTTPError as e:
            if e.response is None or e.response.status_code != 429 or essai == ESSAIS_429 - 1:
                raise
            delai = e.response.headers.get("Retry-After", "")
            pause = min(int(delai) if delai.isdigit() else 60, ATTENTE_429_MAX)
            print(f"   ⏳ 429 de {site}, pause de {pause} s", flush=True)
            time.sleep(pause)
    raise AssertionError("inatteignable")


# ===================================================================
# Main
# ===================================================================


def lisible(v: dict) -> bool:
    """Une version qu'on sait lire : la loi en base, ou une page HTML accessible. Un
    PDF n'est jamais découpé (sa mise en page mêle notes, en-têtes et colonnes)."""
    if v["version"] == "loi":
        return True
    lien = (v["lien"] or "").lower()
    return v["accessible"] and lien.endswith((".html", ".htm", ".asp"))


def lignes_de_version(cur, v: dict) -> list[str]:
    """Les lignes d'une version, depuis Légifrance en base ou la page de la chambre."""
    if v["version"] == "loi":
        cur.execute("SELECT contenu_legifrance FROM textes WHERE uid = %s", (v["uid"],))
        # Le texte Légifrance garde des entités HTML (« &laquo; »), et colle parfois
        # le rapport annexé à la dernière phrase de la loi (« …de l'air.RAPPORT
        # ANNEXÉComm… », LOI2026791) : on le remet sur sa propre ligne pour qu'il
        # ferme le dernier article au lieu d'y entrer.
        s = html.unescape(cur.fetchone()[0]).replace("\xa0", " ")
        s = s.replace("RAPPORT ANNEXÉ", "\nRAPPORT ANNEXÉ\n")
        return [l for l in (" ".join(x.split()) for x in s.split("\n")) if l]
    if not lisible(v):
        raise ValueError(f"pas de page HTML accessible ({v['lien']})")
    return lignes_de_html(telecharger_page(v["lien"]))


def decouper_version(cur, v: dict) -> tuple[list[dict], dict]:
    """Une version → ses articles et leurs contrôles. Lève si elle est illisible ou
    ne donne aucun article (page vide, mise en page inconnue) : le dossier passe alors
    à la version suivante."""
    lignes = lignes_de_version(cur, v)
    articles, rapport = decouper(lignes)
    if not articles:
        raise ValueError("aucun article trouvé")
    if v["version"] == "loi":
        # Le texte Légifrance en base ne suit pas toujours l'ordre de la loi : celui de
        # la loi montagne (LOI2026797) donne le titre II avant le titre I. Une loi
        # publiée est numérotée 1, 2, 3… dans son ordre, le numéro fait donc foi.
        articles.sort(key=lambda a: (_base(a["numero"]) or 0, a["numero"]))
        for i, a in enumerate(articles, start=1):
            a["ordre"] = i
    return articles, controle(articles, rapport, lignes)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--essai", help="dossier où écrire les versions découpées, sans toucher la base")
    parser.add_argument("--limite", type=int, help="nombre maximal de pages téléchargées (étape de nuit)")
    parser.add_argument("--dossiers", nargs="+", help="seulement ces dossiers (et aucune purge hors périmètre)")
    parser.add_argument("--bilan", help="fichier JSON où écrire le bilan de chaque dossier")
    args = parser.parse_args()
    essai = Path(args.essai) if args.essai else None
    if essai:
        essai.mkdir(parents=True, exist_ok=True)

    bilan = []
    telechargees = echecs_telechargement = 0
    anciennete = date.today() - timedelta(days=RETENTER_JOURS)
    a_purger: list[str] = []
    liens_morts: list[str] = []
    with connexion(autocommit=True) as conn:
        with conn.cursor() as cur:
            dossiers = dossiers_du_perimetre(cur, args.dossiers)
            cur.execute("SELECT DISTINCT dossier_uid, texte_uid FROM texte_articles")
            coupees: dict[str, set[str]] = {}
            for d_uid, t_uid in cur.fetchall():
                coupees.setdefault(d_uid, set()).add(t_uid)
        par_stade = {s: sum(1 for d in dossiers if d["stade"] == s) for s in ("promulguee", "navette", "deposee")}
        print(f"📋 {len(dossiers)} dossiers dans le périmètre : " + ", ".join(f"{n} {s}" for s, n in par_stade.items()))

        for d in dossiers:
            ligne = {"dossier": d["uid"], "titre": d["titre"][:70], "stade": d["stade"],
                     "cible": d["candidats"][0]["uid"], "essais": []}
            retenue = None
            for v in d["candidats"]:
                # Une version déjà en base fait foi telle quelle : un texte publié ne
                # change plus. En essai, tout se redécoupe pour être relu.
                if not essai and v["uid"] in coupees.get(d["uid"], ()):
                    retenue = v
                    break
                if not lisible(v):
                    ligne["essais"].append(f"{v['uid']} : illisible ({(v['lien'] or '')[-40:]})")
                    continue
                if (v["version"] != "loi" and args.limite is not None and v["date"] and v["date"] < anciennete
                        and "assemblee-nationale.fr" in (v["lien"] or "")):
                    ligne["essais"].append(f"{v['uid']} : plus de {RETENTER_JOURS} jours, relu au seul passage complet")
                    ligne["ancien"] = True
                    continue
                if v["version"] != "loi" and args.limite is not None and telechargees >= args.limite:
                    ligne["reporte"] = True  # la nuit suivante le reprend
                    break
                try:
                    with conn.cursor() as cur:
                        if v["version"] != "loi":
                            telechargees += 1
                        articles, controles = decouper_version(cur, v)
                    ligne.update(controles)
                    if essai:
                        with open(essai / f"{v['uid']}.txt", "w", encoding="utf-8") as f:
                            for a in articles:
                                f.write(f"\n===== {a['numero']} (ordre {a['ordre']})\n{a['contenu']}\n")
                    else:
                        ligne["ecrits"], _ = ecrire(conn, v["uid"], d["uid"], articles)
                    retenue = v
                    break
                except Exception as e:  # une version en échec laisse sa place à la suivante
                    if v["version"] != "loi":
                        echecs_telechargement += 1
                    ligne["essais"].append(f"{v['uid']} : {type(e).__name__}: {str(e)[:150]}")
                    # Un 404 sur un lien tenu pour accessible : la page a été retirée
                    # depuis sa vérification. La vérification des liens ne reteste
                    # jamais un lien déjà vu vivant (`verifier_urls_textes`,
                    # `sync_senat.fix_textes_urls`), seulement les morts, le lundi : sans
                    # cette écriture, la page était retéléchargée chaque nuit et le site
                    # la présentait comme publiée (3 propositions du Sénat en 2026-10).
                    # Marquée morte, elle n'est plus lue ici, et le lundi la rétablit si
                    # la chambre la republie. L'écriture part en une requête après la
                    # boucle : une coupure de la base ici, hors du `try`, arrêterait
                    # toute l'étape au lieu de cette seule version.
                    if (not essai and isinstance(e, requests.HTTPError) and e.response is not None
                            and e.response.status_code == 404):
                        liens_morts.append(v["uid"])
                        ligne["essais"][-1] += " (lien marqué mort)"
            if retenue:
                ligne["retenue"] = retenue["uid"]
                ligne["repli"] = retenue["uid"] != ligne["cible"]
                if not essai:
                    ligne["purges"] = len(coupees.get(d["uid"], set()) - {retenue["uid"]})
                    a_purger.extend(coupees.get(d["uid"], set()) - {retenue["uid"]})
            bilan.append(ligne)
            # Un dossier écarté pour ancienneté, sans rien de neuf, ne se répète pas chaque nuit.
            if ("articles" in ligne or not retenue or ligne["repli"] or ligne.get("purges")) \
                    and not (ligne.get("ancien") and not retenue):
                drapeaux = [k for k in ("trous", "vides", "suspects") if ligne.get(k)]
                icone = "⏭️ " if ligne.get("reporte") else "❌" if not retenue else "⚠️ " if drapeaux or ligne["repli"] else "✅"
                print(f"   {icone} {d['uid']} {d['stade']:10} {ligne.get('retenue', ligne['cible']):24} "
                      f"{ligne.get('articles', '-'):>4} art."
                      + (" repli" if ligne.get("repli") else "")
                      + "".join(f" {k}={ligne[k]}" for k in drapeaux)
                      + (f" écrits={ligne['ecrits']}" if "ecrits" in ligne else "")
                      + (f" anciennes versions={ligne['purges']}" if ligne.get("purges") else "")
                      + ("" if retenue or ligne.get("reporte") else f" {ligne['essais'][-1] if ligne['essais'] else 'aucune version'}"),
                      flush=True)

        if not essai:
            if liens_morts:
                with conn.cursor() as cur:
                    cur.execute("UPDATE textes SET url_accessible = false WHERE uid = ANY(%s)", (liens_morts,))
                print(f"   🔗 {len(liens_morts)} liens en 404 marqués morts : {', '.join(liens_morts)}")
            # Les dossiers sortis du périmètre perdent tout ; pas avec `--dossiers`, où
            # les autres dossiers ne sont simplement pas lus.
            if not args.dossiers:
                dans = {d["uid"] for d in dossiers}
                a_purger.extend(t for d_uid, ts in coupees.items() if d_uid not in dans for t in ts)
            supprimes = purger(conn, a_purger)
            if supprimes:
                print(f"   🧹 {supprimes} articles de {len(a_purger)} versions qui ne font plus foi supprimés")

    if args.bilan or essai:
        sortie = Path(args.bilan) if args.bilan else essai / "bilan_decoupage.json"
        sortie.write_text(json.dumps(bilan, ensure_ascii=False, indent=1), encoding="utf-8")
    decoupees = [b for b in bilan if "articles" in b]
    print(f"\n📊 {len(bilan)} dossiers : {sum(1 for b in bilan if b.get('retenue'))} avec une version, "
          f"dont {sum(1 for b in bilan if b.get('repli'))} en repli ; "
          f"{sum(1 for b in bilan if not b.get('retenue') and not b.get('reporte'))} sans version lisible, "
          f"{sum(1 for b in bilan if b.get('reporte'))} reportés ; "
          f"{len(decoupees)} découpés cette fois ({sum(b['articles'] for b in decoupees)} articles, "
          f"{sum(1 for b in decoupees if b.get('trous') or b.get('vides') or b.get('suspects'))} à vérifier) ; "
          f"{telechargees} pages lues, {echecs_telechargement} en échec")
    # Une version pas encore publiée est normale et se réessaie la nuit suivante (le
    # lundi suivant pour un 404, marqué mort plus haut). Une majorité d'échecs, elle,
    # dit que la source ou le découpage est cassé.
    if telechargees >= 10 and echecs_telechargement > telechargees / 2:
        sys.exit(1)


if __name__ == "__main__":
    main()
