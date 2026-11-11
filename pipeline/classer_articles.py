# classer_articles.py
# Classe chaque article (ou amendement adopté) de « Ce qui me concerne » selon les
# profils de lecteur qu'il concerne, et écrit le résultat dans la table `impacts`.
#
# Claude Haiku 5.5, par lots (API Message Batches d'Anthropic : moitié prix, réponse
# en moins de 24 h). Lancé chaque nuit par `nightly.py` (étape `classer-impacts`), et
# à la main pour la première passe.
#   python3 -P classer_articles.py --lots            # récupère les lots finis, soumet ce qui manque
#   python3 -P classer_articles.py --lots --plafond 500   # au plus 500 éléments soumis
#   python3 -P classer_articles.py --direct --limite 5    # 5 éléments sans lot, réponse immédiate (essai)
#   python3 -P classer_articles.py --verifier        # passages cités introuvables, coût réel
#
# Éléments classés : les articles de la version qui fait foi pour chaque dossier (la
# seule de `texte_articles`, voir `decouper_textes.py`), et pour un texte pas encore
# promulgué, les amendements adoptés sur cette version (`amendements_retenus`). Une
# loi publiée contient déjà l'effet de ses amendements : ils ne sont pas classés, et
# leur numérotation (« Art. 6 bis ») ne serait de toute façon plus celle de la loi.
#
# Chaque amendement est classé à part, avec l'article qu'il modifie pour contexte.
# Joints à leur article (choix du 2026-10-15, défait le 2026-10-16), les amendements
# étaient ignorés : l'IA décrivait le texte du Gouvernement, et l'article 7 du budget
# plafonnait encore les meublés que la commission venait d'en exclure.

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path

import anthropic
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")
from _alertes import envoyer_alerte_best_effort  # noqa: E402
# Client, tarif de Haiku 5.5 et lecture d'une réponse, partagés avec `traduire_titres.py`.
# Le banc `scripts/banc-ce-qui-me-concerne/` les lit encore sous `classer_articles.*`.
from _claude import REMISE_LOT, claude, cout, lire_reponse  # noqa: E402,F401
from _claude import ReponseInutilisable as EchecClassement  # noqa: E402
from _db import connexion  # noqa: E402

# ===================================================================
# Prompt, schéma, modèle
# ===================================================================

# Chemin dérivé de __file__ et non du répertoire courant, comme les autres scripts
# qui lisent un prompt partagé avec le site.
_PROMPT_PATH = Path(__file__).resolve().parent.parent / "src" / "lib" / "prompts" / "ce-qui-me-concerne.json"
_PROMPT = json.loads(_PROMPT_PATH.read_text(encoding="utf-8"))
PROFILS = [p["id"] for p in _PROMPT["profils"]]
# Le catalogue est envoyé groupe par groupe, sous l'intitulé de chaque groupe : le
# modèle doit savoir que lieu, couple et secteur sont des questions à une seule
# réponse, dont chaque réponse se classe à part (consigne dans `system`).
SYSTEM = _PROMPT["system"].replace("{catalogue}", "\n\n".join(
    f"{t['intitule']} :\n" + "\n".join(
        f"- {p['id']} : {p['definition']}" for p in _PROMPT["profils"] if p["theme"] == t["id"])
    for t in _PROMPT["themes"]))
# La page montre au lecteur la définition de chaque profil, tirée des messages
# (`ceQuiMeConcerne.definitions`, traduite en anglais). La version française doit
# rester celle que lit le modèle : une définition retouchée d'un seul côté ferait
# afficher au lecteur autre chose que ce qui a servi au classement.
_DEFINITIONS_PAGE = json.loads((_PROMPT_PATH.parents[2] / "messages" / "fr.json").read_text(encoding="utf-8")
                               )["ceQuiMeConcerne"]["definitions"]
# Seul écart admis, d'un mot et de même sens : la page ne parle plus de « profils » au
# lecteur, qui coche des cases, alors que le prompt garde « profil ».
# Aligner le prompt aurait changé sa version et fait reclasser les 14 019 éléments
# (environ 4,40 $ et une semaine de nuits) : choix d'Alex du 2026-10-20.
_ECART_ADMIS = ("qui ont leur propre profil.", "qui ont leur propre case.")


def _espaces_ordinaires(texte: str | None) -> str | None:
    """Les espaces insécables (U+00A0, U+202F) comptent pour des espaces ordinaires.

    Les messages en portent devant la ponctuation haute (règle typographique du
    2026-10-22), pas le prompt : sans ça, `etranger_hors_ue` passait pour une définition
    retouchée et l'étape `classer-impacts` s'arrêtait chaque nuit. Ajouter l'insécable au
    prompt changerait sa version et ferait reclasser tous les éléments."""
    return texte.replace("\u00a0", " ").replace("\u202f", " ") if texte else texte


_ECARTS = [p["id"] for p in _PROMPT["profils"]
           if _espaces_ordinaires(_DEFINITIONS_PAGE.get(p["id"]))
           != _espaces_ordinaires(p["definition"].replace(*_ECART_ADMIS))]
if _ECARTS or len(_DEFINITIONS_PAGE) != len(PROFILS):
    raise SystemExit(f"Définitions de la page différentes du prompt pour : {_ECARTS or 'le nombre de profils'}. "
                     "Mettre à jour `ceQuiMeConcerne.definitions` dans fr.json (et en.json).")
MAX_TOKENS = _PROMPT["maxOutputTokens"]
EFFORT = _PROMPT["reasoningEffort"]

SCHEMA = {
    "type": "object",
    "properties": {
        "impacts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "profil": {"type": "string", "enum": PROFILS},
                    "phrase_fr": {"type": "string"},
                    "phrase_en": {"type": "string"},
                    "passage": {"type": "string"},
                    "certitude": {"type": "string", "enum": ["certain", "probable", "possible"]},
                },
                "required": ["profil", "phrase_fr", "phrase_en", "passage", "certitude"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["impacts"],
    "additionalProperties": False,
}

# Un amendement fait en général une seule chose : un seul résumé, lu par tous, et les
# profils concernés sans phrase propre. Le résumé existe même sans profil (55 % des
# amendements du budget au 2026-10-16) : c'est lui que le tiroir d'un article montre
# pour ses « autres amendements ». Un article, lui, regroupe souvent plusieurs
# mesures pour des publics différents (l'article 7 du budget : prêt à taux zéro pour
# les parents, plafond des meublés pour les bailleurs), d'où une phrase par profil.
SCHEMA_AMENDEMENT = {
    "type": "object",
    "properties": {
        "resume_fr": {"type": "string"},
        "resume_en": {"type": "string"},
        "impacts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "profil": {"type": "string", "enum": PROFILS},
                    "passage": {"type": "string"},
                    "certitude": {"type": "string", "enum": ["certain", "probable", "possible"]},
                },
                "required": ["profil", "passage", "certitude"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["resume_fr", "resume_en", "impacts"],
    "additionalProperties": False,
}
SCHEMAS = {"article": SCHEMA, "amendement": SCHEMA_AMENDEMENT}

# La version change dès que ce que le modèle reçoit change (consignes, catalogue,
# gabarit, schémas, plafond de sortie, effort) : un résultat n'est jamais comparé à un
# autre obtenu avec d'autres consignes. Ce qui ne sert qu'à la page n'en fait pas
# partie (`choixUnique`, libellés traduits) : retoucher l'affichage ne doit
# pas coûter une nouvelle passe de classement.
PROMPT_VERSION = hashlib.sha256(json.dumps(
    [SYSTEM, _PROMPT["userTemplate"], SCHEMAS, MAX_TOKENS, EFFORT], sort_keys=True, ensure_ascii=False,
).encode()).hexdigest()[:12]

# Claude Haiku 5.5 seul, « possible » masqué à l'affichage. Banc du 2026-10-17 (chiffres
# dans `src/lib/evaluation-ce-qui-me-concerne.ts`) : avec la même consigne, 84 % de
# rattachements justes sur le test contre 79 % pour GPT-6 Luna, qui trouve aussi moins
# de profils. Même en lots (moitié prix), Haiku coûte un peu plus que Luna (0,31 $
# contre 0,30 $ les 1 000 textes), mais il puise dans des crédits Anthropic déjà payés.
# Lu dans le prompt partagé, que la page /documentation/prompts-ia affiche aussi. Hors
# de `PROMPT_VERSION` : la colonne `modele` des classements le compare à part.
MODELE = _PROMPT["modele"]

# Le prompt système (le catalogue entier) est identique pour toutes les requêtes : mis
# en cache, il n'est payé plein tarif qu'à la première.
SYSTEM_EN_CACHE = [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}]


def parametres(user: str, schema: dict) -> dict:
    """Les paramètres d'une requête, communs à l'appel direct et au lot."""
    return {
        "model": MODELE,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_EN_CACHE,
        "messages": [{"role": "user", "content": user}],
        "output_config": {"effort": EFFORT, "format": {"type": "json_schema", "schema": schema}},
    }


# ===================================================================
# Éléments à classer
# ===================================================================

# Un article plus long que ce seuil part en plusieurs morceaux, classés chacun à part
# puis fusionnés par profil. Les plus longs sont des réécritures de codes (64 000
# caractères pour l'article 5 de `PRJLANR5L17BTA0338`, 21 articles de code insérés
# dans l'article 2 de `PRJLANR5L17BTC2732`) : d'un seul tenant, chaque mesure n'y pèse
# plus que quelques lignes.
SEUIL_MORCEAU = 20_000
TAILLE_MORCEAU = 15_000

CHAMBRE_LONGUE = {"AN": "Assemblée nationale", "SN": "Sénat"}
PROCEDURES_BUDGET = ("Projet de loi de finances de l'année", "Projet de loi de financement de la sécurité sociale",
                     "Projet de loi de finances rectificative")


def morceaux(contenu: str) -> list[str]:
    """Un article long → des morceaux d'au plus `TAILLE_MORCEAU` caractères, coupés
    entre deux alinéas."""
    if len(contenu) <= SEUIL_MORCEAU:
        return [contenu]
    parts, courant = [], ""
    for alinea in contenu.split("\n"):
        if courant and len(courant) + len(alinea) + 1 > TAILLE_MORCEAU:
            parts.append(courant)
            courant = ""
        courant = f"{courant}\n{alinea}" if courant else alinea
    return parts + [courant] if courant else parts


def etape_de(v: dict) -> str:
    """Où en est la version classée, dit au modèle : il écrit au conditionnel tant
    qu'elle n'est pas une loi publiée. Le prototype disait toujours « texte initial
    déposé par le Gouvernement », faux pour une proposition de loi ou un texte transmis."""
    if v["type_code"] == "LOI":
        return "Loi publiée au Journal officiel"
    if v["statut"] == "Rejeté":
        return "Texte rejeté par le Parlement : il ne s'appliquera pas"
    ici = "l'Assemblée nationale" if v["chambre"] == "Assemblée Nationale" else "le Sénat"
    la_bas = "le Sénat" if v["chambre"] == "Assemblée Nationale" else "l'Assemblée nationale"
    if v["provenance"] == "Séance":
        return f"Texte adopté par {ici}, transmis à {la_bas}, pas encore adopté définitivement"
    if v["transmis"]:
        return f"Texte adopté par {la_bas}, transmis à {ici}, pas encore adopté définitivement"
    if v["type_code"] == "PRJL":
        return "Projet de loi déposé par le Gouvernement, pas encore adopté"
    return "Proposition de loi déposée par des parlementaires, pas encore adoptée"


def chambre_qui_examine(v: dict) -> str:
    """'AN' ou 'SN' : la chambre où la version est déposée, ou l'autre si c'est un
    texte qu'une chambre vient d'adopter (il part chez l'autre)."""
    a_l_an = v["chambre"] == "Assemblée Nationale"
    return "AN" if a_l_an != (v["provenance"] == "Séance") else "SN"


def amendements_retenus(lignes: list[tuple], v: dict) -> list[tuple]:
    """Les amendements adoptés à montrer avec la version classée d'un dossier, parmi
    ceux du dossier (`lignes`, la séance d'abord, puis par uid).

    - Ceux de la chambre qui examine cette version, adoptés depuis son dépôt : les
      précédents sont déjà dedans (texte transmis) ou visaient une autre numérotation.
      Une date absente (19 amendements sur 26 539 au 2026-10-16) ne l'exclut pas.
    - Un seul par contenu et par article visé. Le contenu se compare sans espaces,
      ponctuation ni casse (empreinte calculée par Postgres). Les doublons sont de deux
      sortes : un amendement de commission repris en séance (I-CF1498 et I-3648 sur
      le budget, art. 42 de la Constitution oblige), ou le même amendement adopté pour
      plusieurs groupes (I-CF693 et I-CF1860). La séance passe avant la commission,
      puis le plus petit uid : le plus avancé dans la procédure fait foi.
    """
    chambre, depuis = chambre_qui_examine(v), v["date"]
    vus, retenus = set(), []
    for l in lignes:
        uid, numero, article, ch, lieu, date, md5_disp, md5_exp, cle_contenu = l
        if ch != chambre or (date is not None and date < depuis):
            continue
        cle = (article, cle_contenu) if cle_contenu else None
        if cle and cle in vus:
            continue
        if cle:
            vus.add(cle)
        retenus.append(l)
    return retenus


def charger_versions(cur) -> list[dict]:
    """La version classée de chaque dossier, avec ce qu'il faut pour dire son étape."""
    cur.execute(
        """
        SELECT DISTINCT ON (ta.dossier_uid) ta.dossier_uid, ta.texte_uid, t.type_code, t.provenance, t.chambre,
               coalesce(t.date_depot, t.date_publication, t.date_creation)::date, d.titre, d.statut_final,
               d.procedure_libelle,
               EXISTS (SELECT 1 FROM textes s
                       WHERE s.dossier_ref = ta.dossier_uid AND s.provenance = 'Séance' AND s.uid <> t.uid
                         AND s.type_code IN ('PION', 'PRJL')
                         AND coalesce(s.date_depot, s.date_publication, s.date_creation)
                             <= coalesce(t.date_depot, t.date_publication, t.date_creation))
        FROM texte_articles ta
        JOIN textes t ON t.uid = ta.texte_uid
        JOIN dossiers_legislatifs d ON d.uid = ta.dossier_uid
        ORDER BY ta.dossier_uid, ta.texte_uid
        """
    )
    cles = ("dossier", "texte", "type_code", "provenance", "chambre", "date", "titre", "statut", "procedure", "transmis")
    return [dict(zip(cles, r)) for r in cur.fetchall()]


def _signer(e: dict, signature: list) -> dict:
    """Pose l'empreinte et la clé de lot d'un élément.

    L'empreinte se calcule sur ce qui compose la requête (titre, étape, numéro, et
    l'empreinte des textes plutôt que les textes eux-mêmes) : la nuit n'a ainsi pas à
    rapatrier 50 Mo de texte pour savoir ce qui a changé. Le gabarit du message, lui,
    est dans `PROMPT_VERSION`."""
    e["empreinte"] = hashlib.md5(json.dumps(signature, ensure_ascii=False, default=str).encode()).hexdigest()
    # Identifiant dans un lot : 64 caractères au plus, lettres, chiffres, - et _.
    # L'empreinte en fait partie : un résultat qui revient pour un élément modifié
    # depuis ne correspond plus à rien et n'est pas écrit.
    e["cle_lot"] = hashlib.md5(f"{e['type']}|{e['id']}|{e['empreinte']}".encode()).hexdigest()
    return e


def charger_elements(cur) -> list[dict]:
    """Les éléments à classer, sans leur texte : de quoi savoir lesquels ont changé
    (`empreinte`) et combien de requêtes chacun demande. `completer` ajoute ensuite
    le texte des seuls éléments à envoyer. Trois requêtes en tout, quelle que soit la
    taille du périmètre."""
    versions = charger_versions(cur)
    cur.execute("SELECT texte_uid, ordre, numero, empreinte, length(contenu) FROM texte_articles "
                "ORDER BY texte_uid, ordre")
    articles: dict[str, list[tuple]] = {}
    for t_uid, *reste in cur.fetchall():
        articles.setdefault(t_uid, []).append(tuple(reste))
    en_cours = [v["dossier"] for v in versions if v["type_code"] != "LOI"]
    cur.execute(
        """
        SELECT dossier_uid, uid, numero, article, chambre, lieu, date_amendement,
               md5(coalesce(dispositif, '')), md5(coalesce(expose, '')),
               CASE WHEN btrim(coalesce(dispositif, '')) <> ''
                    THEN md5(regexp_replace(lower(dispositif), '[^[:alnum:]]', '', 'g')) END
        FROM amendements WHERE dossier_uid = ANY(%s)
        ORDER BY dossier_uid, (lieu = 'seance') DESC, uid
        """,
        (en_cours,),
    )
    amendements: dict[str, list[tuple]] = {}
    for d_uid, *reste in cur.fetchall():
        amendements.setdefault(d_uid, []).append(tuple(reste))

    elements = []
    for v in versions:
        etape = etape_de(v)
        empreinte_de = {}
        for ordre, numero, empreinte, longueur in articles.get(v["texte"], []):
            empreinte_de[numero] = empreinte
            elements.append(_signer({
                "type": "article", "id": f"{v['texte']}#{ordre}", "dossier": v["dossier"], "texte": v["texte"],
                "ordre": ordre, "numero": numero, "titre": v["titre"], "etape": etape, "long": longueur > SEUIL_MORCEAU,
            }, [v["titre"], etape, numero, empreinte]))
        if v["type_code"] == "LOI":
            continue
        budget = v["procedure"] in PROCEDURES_BUDGET
        for uid, num, article, ch, lieu, _, md5_disp, md5_exp, _ in amendements_retenus(amendements.get(v["dossier"], []), v):
            chambre = CHAMBRE_LONGUE.get(ch, ch)
            if lieu == "seance":
                stade = f"adopté en séance publique ({chambre})"
            elif budget:
                stade = f"adopté en commission ({chambre}), à voter de nouveau en séance"
            else:
                stade = f"adopté en commission ({chambre}), intégré au texte que la séance examinera"
            etape_amdt = f"Amendement {stade}, sur un texte pas encore adopté définitivement ; cite le passage dans son dispositif"
            element = f"Amendement n° {num} ({article or 'article non précisé'})"
            elements.append(_signer({
                "type": "amendement", "id": uid, "dossier": v["dossier"], "texte": v["texte"], "article": article,
                "titre": v["titre"], "etape": etape_amdt, "element": element, "long": False,
            }, [v["titre"], etape_amdt, element, md5_disp, md5_exp, empreinte_de.get(article)]))
    # Le nombre de morceaux d'un article long ne se connaît qu'en le découpant : ces
    # quelques articles (16 sur 2 781 au 2026-10-16) sont complétés tout de suite.
    completer(cur, [e for e in elements if e["long"]])
    for e in elements:
        e["nb_requetes"] = len(e["requetes"]) if "requetes" in e else 1
    return elements


# Éléments complétés par requête : environ 1 Mo de texte par aller-retour (voir
# CLAUDE.md, écritures et lectures par lots bornés).
COMPLETER_PAR_LOT = 400


def completer(cur, elements: list[dict], avec_expose: bool = True) -> None:
    """Ajoute à chaque élément son texte (`sources`, pour vérifier les passages cités)
    et ses requêtes, une par morceau.

    `avec_expose=False` pour les appelants qui ne lisent que `sources` (récupération
    des lots, `--verifier`) : l'exposé n'entre que dans la requête envoyée au modèle,
    et le lire ferait transiter du texte pour rien. Leurs requêtes portent alors
    « (non lu) » à la place de l'exposé, et ne doivent pas être envoyées."""
    for i in range(0, len(elements), COMPLETER_PAR_LOT):
        paquet = [e for e in elements[i:i + COMPLETER_PAR_LOT] if "requetes" not in e]
        arts = [e for e in paquet if e["type"] == "article"]
        amdts = [e for e in paquet if e["type"] == "amendement"]
        contenu: dict[tuple, str] = {}
        if arts:
            cur.execute("SELECT ta.texte_uid, ta.ordre, ta.contenu FROM texte_articles ta "
                        "JOIN unnest(%s::text[], %s::int[]) AS u(t, o) ON ta.texte_uid = u.t AND ta.ordre = u.o",
                        ([e["texte"] for e in arts], [e["ordre"] for e in arts]))
            contenu = {(t, o): c for t, o, c in cur.fetchall()}
        for e in arts:
            texte = contenu[(e["texte"], e["ordre"])]
            parts = morceaux(texte)
            e["sources"] = [texte]
            e["requetes"] = [_PROMPT["userTemplate"].format(
                titre_dossier=e["titre"], etape=e["etape"], texte=part, amendements="",
                element=e["numero"] if len(parts) == 1 else f"{e['numero']} (partie {k} sur {len(parts)})")
                for k, part in enumerate(parts, start=1)]
        if not amdts:
            continue
        cur.execute("SELECT uid, dispositif, " + ("expose" if avec_expose else "NULL") +
                    " FROM amendements WHERE uid = ANY(%s)", ([e["id"] for e in amdts],))
        textes = {u: (d, x if avec_expose else "(non lu)") for u, d, x in cur.fetchall()}
        vises = [e for e in amdts if e["article"]]
        cur.execute("SELECT ta.texte_uid, ta.numero, ta.contenu FROM texte_articles ta "
                    "JOIN unnest(%s::text[], %s::text[]) AS u(t, n) ON ta.texte_uid = u.t AND ta.numero = u.n",
                    ([e["texte"] for e in vises], [e["article"] for e in vises]))
        contexte_de = {(t, n): c for t, n, c in cur.fetchall()}
        for e in amdts:
            disp, exp = textes.get(e["id"], (None, None))
            vise = contexte_de.get((e["texte"], e["article"]))
            contexte = (f"\n--- Article {e['article']} visé, dans la version examinée (contexte seulement) ---\n{vise}\n"
                        if vise else "")
            e["sources"] = [disp or ""]
            e["requetes"] = [_PROMPT["userTemplate"].format(
                titre_dossier=e["titre"], etape=e["etape"], element=e["element"],
                texte=f"Dispositif :\n{disp or '(non publié)'}\nExposé de ses auteurs :\n{exp or '(non publié)'}",
                amendements=contexte)]


# ===================================================================
# Classement
# ===================================================================

RANG_CERTITUDE = {"certain": 0, "probable": 1, "possible": 2}


def fusionner(reponses: list[dict]) -> dict:
    """Les réponses des morceaux d'un article → une seule, un impact par profil : celui
    du morceau le plus sûr de lui, le premier à égalité."""
    par_profil: dict[str, dict] = {}
    for r in reponses:
        for imp in r["impacts"]:
            deja = par_profil.get(imp["profil"])
            if deja is None or RANG_CERTITUDE[imp["certitude"]] < RANG_CERTITUDE[deja["certitude"]]:
                par_profil[imp["profil"]] = imp
    return {**reponses[0], "impacts": list(par_profil.values())}


# Ressemblance minimale (ratio de `difflib`) entre un passage cité et le texte
# source pour le remplacer par ce texte. En dessous, la citation est vidée.
SEUIL_ANCRAGE = 0.9


def passage_ancre(passage: str, sources: list[str]) -> str:
    """Le passage tel qu'il figure dans la source, ou une chaîne vide.

    Le modèle doit recopier mot pour mot, et 5 à 6 % des passages du prototype
    restaient introuvables : un mot changé, une coupure, une reformulation. La page
    présente le passage comme une citation : une citation fausse y serait pire
    qu'aucune. On garde donc le passage s'il est dans la source (espaces et
    apostrophes unifiés), sinon le morceau de source le plus proche s'il ressemble à
    au moins 90 %, sinon rien (la phrase reste, sans citation)."""
    if any(passage in s for s in sources):
        return passage
    p = _normaliser(passage)
    meilleur, retenu = 0.0, ""
    for s in sources:
        s = _normaliser(s)
        if p in s:
            return p
        # Le plus long morceau commun cale le passage dans la source ; on compare
        # ensuite le passage à la fenêtre de même longueur qui commence au même endroit.
        sm = SequenceMatcher(None, p, s, autojunk=False)
        i, j, k = sm.find_longest_match(0, len(p), 0, len(s))
        if k < 20:
            continue
        debut = max(0, j - i)
        fin = min(len(s), debut + len(p))
        # Élargie aux mots entiers : une citation ne commence pas au milieu d'un mot.
        while debut > 0 and s[debut - 1] != " ":
            debut -= 1
        while fin < len(s) and s[fin] != " ":
            fin += 1
        fenetre = s[debut:fin].strip()
        ratio = SequenceMatcher(None, p, fenetre, autojunk=False).ratio()
        if ratio > meilleur:
            meilleur, retenu = ratio, fenetre
    return retenu if meilleur >= SEUIL_ANCRAGE else ""


def ancrer(r: dict, sources: list[str]) -> dict:
    """Une réponse dont chaque passage cité est recalé sur la source (`passage_ancre`)."""
    return {**r, "impacts": [{**imp, "passage": passage_ancre(imp["passage"], sources)} for imp in r["impacts"]]}


def deja_classes(cur) -> set[tuple]:
    cur.execute("SELECT element_type, element_id, empreinte_entree FROM impacts "
                "WHERE prompt_version = %s AND modele = %s", (PROMPT_VERSION, MODELE))
    return set(cur.fetchall())


# Classements écrits par requête : une seule instruction INSERT de plusieurs lignes.
# Une transaction par élément coûtait trois allers-retours vers la base (Paris) :
# 14 000 éléments demandaient 95 minutes, et une nuit à 2 000 éléments 13 minutes.
# `executemany` de psycopg, qui enchaîne les requêtes sans attendre (pipeline), est
# coupé par la base en « SSL error: ssl/tls alert unexpected message » (constaté le
# 2026-10-17). 500 lignes font 6 500 paramètres, loin de la limite de 65 535.
ECRITURE_PAR_PAQUET = 500
_LIGNE = "(%s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s)"
SQL_ECRIRE = """
    INSERT INTO impacts (element_type, element_id, dossier_uid, modele, prompt_version,
                         empreinte_entree, impacts, resume_fr, resume_en,
                         jetons_entree, jetons_sortie, cout_usd, duree_ms)
    VALUES {lignes}
    ON CONFLICT (element_type, element_id, modele, prompt_version) DO UPDATE SET
      dossier_uid = excluded.dossier_uid,
      empreinte_entree = excluded.empreinte_entree, impacts = excluded.impacts,
      resume_fr = excluded.resume_fr, resume_en = excluded.resume_en,
      jetons_entree = excluded.jetons_entree, jetons_sortie = excluded.jetons_sortie,
      cout_usd = excluded.cout_usd, duree_ms = excluded.duree_ms, created_at = now()
"""


def ecrire(conn, lignes: list[tuple[dict, str, dict, dict]]) -> None:
    """Écrit le classement d'éléments complétés (`completer`), passages recalés.
    Chaque ligne : (élément, version du prompt, réponse fusionnée, consommation). Un
    élément n'apparaît qu'une fois par appel : deux lignes de même clé dans un INSERT
    seraient refusées par ON CONFLICT."""
    for debut in range(0, len(lignes), ECRITURE_PAR_PAQUET):
        paquet = lignes[debut:debut + ECRITURE_PAR_PAQUET]
        valeurs = [v for e, pv, r, conso in paquet for v in _valeurs(e, pv, ancrer(r, e["sources"]), conso)]
        with conn.transaction(), conn.cursor() as cur:
            cur.execute(SQL_ECRIRE.format(lignes=", ".join([_LIGNE] * len(paquet))), valeurs)


def _valeurs(element: dict, prompt_version: str, r: dict, conso: dict) -> tuple:
    return (element["type"], element["id"], element["dossier"], MODELE, prompt_version, element["empreinte"],
            json.dumps(r["impacts"], ensure_ascii=False), r.get("resume_fr"), r.get("resume_en"),
            conso["jetons_entree"], conso["jetons_sortie"], conso["cout_usd"], conso.get("duree_ms"))


def purger_amendements(conn, elements: list[dict]) -> int:
    """Supprime le classement des amendements qui ne sont plus montrés : le dossier a
    changé de version (ceux de l'autre chambre ne visent plus le texte en cours), ou
    le texte est promulgué. Les articles, eux, sont purgés par `decouper_textes.py`.

    Aucun élément du tout (table `texte_articles` vidée par erreur) ne prouve rien, comme
    dans `purger_versions` : sans cette garde, tous les classements d'amendements, déjà
    payés, partaient d'un coup."""
    if not elements:
        return 0
    retenus = [e["id"] for e in elements if e["type"] == "amendement"]
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("DELETE FROM impacts WHERE element_type = 'amendement' AND NOT (element_id = ANY(%s))",
                    (retenus,))
        return cur.rowcount


def purger_versions(conn, elements: list[dict]) -> int:
    """Supprime les classements d'une autre version du prompt ou d'un autre modèle,
    mais seulement quand la version en cours couvre tous les éléments : pendant un
    reclassement, `impacts_courants` montre l'ancien classement des éléments pas
    encore refaits, et la page ne se vide pas. Un reclassement double la place prise
    par `impacts` le temps qu'il dure (environ 25 Mo)."""
    with conn.cursor() as cur:
        cur.execute("SELECT element_type, element_id FROM impacts WHERE prompt_version = %s AND modele = %s",
                    (PROMPT_VERSION, MODELE))
        couverts = set(cur.fetchall())
    # Une liste vide (table `texte_articles` vidée par erreur) ne prouve rien.
    if not elements or any((e["type"], e["id"]) not in couverts for e in elements):
        return 0
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("DELETE FROM impacts WHERE prompt_version <> %s OR modele <> %s", (PROMPT_VERSION, MODELE))
        return cur.rowcount


def classer_direct(limite: int) -> None:
    """Essai sans lot : les `limite` premiers éléments à classer, réponse immédiate,
    au plein tarif. Sert à relire un changement de prompt avant de payer une passe."""
    with connexion(autocommit=True) as conn:
        with conn.cursor() as cur:
            elements = charger_elements(cur)
            faits = deja_classes(cur)
        a_faire = [e for e in elements if (e["type"], e["id"], e["empreinte"]) not in faits][:limite]
        with conn.cursor() as cur:
            completer(cur, a_faire)
        print(f"📋 {len(elements)} éléments, prompt {PROMPT_VERSION}, {len(a_faire)} classés en direct")
        for e in a_faire:
            debut = time.monotonic()
            try:
                reponses, entree, sortie, total = [], 0, 0, 0.0
                for user in e["requetes"]:
                    m = claude.messages.create(**parametres(user, SCHEMAS[e["type"]]))
                    reponses.append(lire_reponse(m))
                    entree += m.usage.input_tokens
                    sortie += m.usage.output_tokens
                    total += cout(m.usage)
                ecrire(conn, [(e, PROMPT_VERSION, fusionner(reponses), {
                    "jetons_entree": entree, "jetons_sortie": sortie, "cout_usd": total,
                    "duree_ms": int((time.monotonic() - debut) * 1000)})])
                print(f"   ✅ {e['id']} : {len(fusionner(reponses)['impacts'])} profil(s), {total:.5f} $")
            except Exception as ex:  # un échec n'arrête pas les autres
                print(f"   ❌ {e['id']} : {type(ex).__name__}: {str(ex)[:200]}")


# ===================================================================
# Lots
# ===================================================================

# Un lot accepte 100 000 requêtes et 256 Mo. Chaque requête porte le catalogue entier
# (environ 12 Ko) : 5 000 requêtes font environ 80 Mo, loin des deux limites.
REQUETES_PAR_LOT = 5_000


def recuperer_lots(conn, elements: list[dict]) -> None:
    """Écrit les résultats des lots terminés.

    Un résultat se retrouve par sa clé (`cle_lot` et numéro de morceau). Un élément
    n'est écrit que si tous ses morceaux ont réussi ; sinon, ou si l'élément a changé
    depuis l'envoi, il repart dans un lot suivant."""
    par_cle = {e["cle_lot"]: e for e in elements}
    with conn.cursor() as cur:
        cur.execute("SELECT id, prompt_version FROM classement_lots WHERE statut = 'en_cours' ORDER BY cree_le")
        lots = cur.fetchall()
    for lot_id, prompt_version in lots:
        lot = claude.messages.batches.retrieve(lot_id)
        if lot.processing_status != "ended":
            print(f"   ⏳ lot {lot_id} : {lot.request_counts.processing} requêtes en cours")
            continue
        reponses: dict[str, dict[int, tuple]] = {}
        echecs = 0
        for res in claude.messages.batches.results(lot_id):
            cle, _, rang = res.custom_id.rpartition("-")
            if res.result.type != "succeeded":
                echecs += 1
                continue
            try:
                reponses.setdefault(cle, {})[int(rang)] = (lire_reponse(res.result.message), res.result.message.usage)
            except (EchecClassement, json.JSONDecodeError, StopIteration):
                echecs += 1
        perimes = 0
        # Le texte des éléments revenus, pour recaler les passages cités.
        with conn.cursor() as cur:
            completer(cur, [par_cle[c] for c in reponses if c in par_cle], avec_expose=False)
        a_ecrire = []
        for cle, parts in reponses.items():
            e = par_cle.get(cle)
            if e is None:
                perimes += 1
                continue
            if len(parts) != e["nb_requetes"]:
                continue
            ordonnees = [parts[i] for i in sorted(parts)]
            a_ecrire.append((e, prompt_version, fusionner([r for r, _ in ordonnees]), {
                "jetons_entree": sum(u.input_tokens + (u.cache_read_input_tokens or 0)
                                     + (u.cache_creation_input_tokens or 0) for _, u in ordonnees),
                "jetons_sortie": sum(u.output_tokens for _, u in ordonnees),
                "cout_usd": sum(cout(u, REMISE_LOT) for _, u in ordonnees)}))
        ecrire(conn, a_ecrire)
        ecrits = len(a_ecrire)
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("UPDATE classement_lots SET statut = 'recupere', recupere_le = now(), ecrits = %s, "
                        "echecs = %s WHERE id = %s", (ecrits, echecs, lot_id))
        print(f"   📥 lot {lot_id} : {ecrits} éléments écrits, {echecs} requêtes en échec, "
              f"{perimes} éléments modifiés depuis l'envoi")


def soumettre_lots(conn, elements: list[dict], plafond: int | None) -> int:
    """Envoie en lots les éléments nouveaux ou modifiés qui ne sont pas déjà en
    attente dans un lot. Renvoie le nombre d'éléments envoyés."""
    with conn.cursor() as cur:
        faits = deja_classes(cur)
        cur.execute("SELECT cles FROM classement_lots WHERE statut = 'en_cours' AND prompt_version = %s",
                    (PROMPT_VERSION,))
        en_attente = {c for (cles,) in cur.fetchall() for c in cles}
    a_faire = [e for e in elements
               if (e["type"], e["id"], e["empreinte"]) not in faits and e["cle_lot"] not in en_attente]
    if plafond is not None:
        a_faire = a_faire[:plafond]
    envoyes = 0
    while a_faire:
        lot, n = [], 0
        while a_faire and n + a_faire[0]["nb_requetes"] <= REQUETES_PAR_LOT:
            e = a_faire.pop(0)
            lot.append(e)
            n += e["nb_requetes"]
        if not lot:  # un élément seul dépasse la taille d'un lot : impossible en pratique
            a_faire.pop(0)
            continue
        with conn.cursor() as cur:
            completer(cur, lot)
        requetes = [Request(custom_id=f"{e['cle_lot']}-{i}",
                            params=MessageCreateParamsNonStreaming(**parametres(user, SCHEMAS[e["type"]])))
                    for e in lot for i, user in enumerate(e["requetes"])]
        try:
            envoi = claude.messages.batches.create(requests=requetes)
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError, anthropic.BadRequestError) as e:
            # Crédits épuisés ou clé révoquée : le lot est refusé d'emblée (400 « credit
            # balance is too low », 401, 403). Rien ne s'affiche de neuf sur le site
            # tant que ce n'est pas corrigé, d'où l'alerte, comme pour les fiches courtes.
            envoyer_alerte_best_effort(
                "⚠️ LoiClair — Classement « Ce qui me concerne » refusé par Anthropic",
                f"<p>L'envoi d'un lot de {len(requetes)} requêtes a été refusé "
                f"({type(e).__name__} : {str(e)[:300]}). Cause fréquente : crédits Anthropic "
                f"épuisés ou clé révoquée. Les textes déposés depuis n'apparaîtront pas sur "
                f"« Ce qui me concerne » tant que ce n'est pas corrigé.</p>"
                f'<p>→ Vérifier le solde et la clé : <a href="https://console.anthropic.com/settings/billing">'
                f"console Anthropic, facturation</a></p>",
            )
            sys.exit(1)
        with conn.transaction(), conn.cursor() as cur:
            cur.execute("INSERT INTO classement_lots (id, modele, prompt_version, cles, nb_requetes) "
                        "VALUES (%s, %s, %s, %s::jsonb, %s)",
                        (envoi.id, MODELE, PROMPT_VERSION, json.dumps([e["cle_lot"] for e in lot]), len(requetes)))
        print(f"   📤 lot {envoi.id} : {len(lot)} éléments, {len(requetes)} requêtes")
        envoyes += len(lot)
    return envoyes


def classer_par_lots(plafond: int | None) -> None:
    # Autocommit : chaque `conn.transaction()` valide aussitôt ce qu'elle écrit. Sans
    # lui, la première lecture ouvre une transaction implicite, et une panne en cours
    # de récupération perdrait des résultats déjà payés.
    with connexion(autocommit=True) as conn:
        with conn.cursor() as cur:
            elements = charger_elements(cur)
        print(f"📋 {len(elements)} éléments ({sum(1 for e in elements if e['type'] == 'amendement')} amendements), "
              f"prompt {PROMPT_VERSION}")
        recuperer_lots(conn, elements)
        purges = purger_amendements(conn, elements)
        if purges:
            print(f"   🧹 {purges} classements d'amendements qui ne sont plus montrés supprimés")
        purges = purger_versions(conn, elements)
        if purges:
            print(f"   🧹 {purges} classements d'une ancienne version du prompt supprimés")
        envoyes = soumettre_lots(conn, elements, plafond)
        if not envoyes:
            print("   rien de nouveau à classer")


# ===================================================================
# Vérification
# ===================================================================


def _normaliser(s: str) -> str:
    """Espaces et apostrophes unifiés : un passage recopié « mot pour mot » peut
    différer de la source par une espace insécable ou une apostrophe typographique,
    ce qui n'est pas une invention."""
    s = s.replace("\xa0", " ").replace(" ", " ").replace("’", "'").replace("‑", "-")
    return " ".join(s.split())


def verifier() -> None:
    """Passages retrouvés mot pour mot dans la source, profils retenus, coût total et
    par élément, pour la version de prompt en cours."""
    with connexion() as conn, conn.cursor() as cur:
        tous = charger_elements(cur)
        completer(cur, tous, avec_expose=False)
        elements = {(e["type"], e["id"]): e for e in tous}
        cur.execute("SELECT element_type, element_id, impacts, cout_usd FROM impacts "
                    "WHERE prompt_version = %s AND modele = %s", (PROMPT_VERSION, MODELE))
        lignes = cur.fetchall()
    n_imp = exact = normalise = vides = 0
    manquants = []
    for typ, ident, impacts, _ in lignes:
        sources = elements.get((typ, ident), {}).get("sources", [])
        for imp in impacts:
            n_imp += 1
            p = imp["passage"]
            if not p:  # vidé à l'écriture, faute de le retrouver (`passage_ancre`)
                vides += 1
            elif any(p in s for s in sources):
                exact += 1
            elif any(_normaliser(p) in _normaliser(s) for s in sources):
                normalise += 1
            else:
                manquants.append((ident, imp["profil"], p[:100]))
    total = sum(float(l[3] or 0) for l in lignes)
    print(f"\n## {MODELE}, prompt {PROMPT_VERSION} : {len(lignes)} éléments classés sur {len(elements)}, "
          f"{n_imp} rattachements à un profil, {sum(1 for l in lignes if not l[2])} éléments sans profil")
    print(f"   passages : {exact} exacts, {normalise} exacts aux espaces près, {vides} vidés faute de "
          f"source, {len(manquants)} introuvables"
          + (f" ({len(manquants) / n_imp:.1%})" if n_imp else ""))
    for m in manquants[:8]:
        print(f"     ✗ {m}")
    if lignes:
        print(f"   coût {total:.4f} $ ; {total / len(lignes) * 1000:.3f} $ pour 1 000 éléments")


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--lots", action="store_true", help="récupérer les lots finis et soumettre ce qui manque")
    mode.add_argument("--direct", action="store_true", help="classer sans lot (essai), avec --limite")
    mode.add_argument("--verifier", action="store_true", help="contrôler les résultats déjà écrits")
    parser.add_argument("--limite", type=int, default=5, help="--direct : nombre d'éléments")
    parser.add_argument("--plafond", type=int, help="--lots : nombre maximal d'éléments soumis")
    args = parser.parse_args()
    if args.verifier:
        verifier()
    elif args.direct:
        classer_direct(args.limite)
    else:
        classer_par_lots(args.plafond)


if __name__ == "__main__":
    main()
