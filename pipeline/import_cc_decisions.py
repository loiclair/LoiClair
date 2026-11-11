"""
import_cc_decisions.py
Pour chaque acte CC-CONCLUSION avec url_conclusion, récupère la décision depuis
le site du Conseil constitutionnel, parse les articles censurés, et génère via le modèle IA :
  - resume_cc   : résumé citoyen, construit à partir du dispositif (prompt : règle RÉSUMÉ)
  - articles_censures : liste structurée [{texte, objet, raison}] par disposition censurée
  - resume_cc_en, articles_censures_en : les mêmes en anglais, rendus par le même appel
    pour que les deux langues racontent la même lecture (lus par le site sur /en)
  - resume_cc_prompt_version : empreinte du prompt qui a produit les quatre ci-dessus

Reprend une décision dès qu'elle n'a pas de résumé, ou que son résumé a été
produit par une autre version du prompt.

Attention : les 44 décisions d'avant le 2026-11-06 ont été corrigées à la main contre leur
texte officiel, puis marquées de l'empreinte du prompt alors en place. Changer le prompt,
ses réglages ou le modèle change l'empreinte et les fait toutes réécrire la nuit suivante.

Prérequis :
- Variables PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (connexion Postgres, voir `_db.py`)
  et MAMMOUTH_API_KEY dans .env.local
- pip install openai beautifulsoup4 requests psycopg
"""

import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from pathlib import Path

import requests as http_requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from openai import OpenAI
import psycopg
from psycopg.types.json import Json
from tqdm import tqdm

# `python3 -P` n'ajoute pas le dossier du script au chemin de recherche des modules.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire  # noqa: E402

# ── Configuration ─────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

MAMMOUTH_API_KEY  = os.getenv("MAMMOUTH_API_KEY")

if not MAMMOUTH_API_KEY:
    raise ValueError("MAMMOUTH_API_KEY manquant dans .env.local")

# Mammouth (société française) sert le modèle par une API compatible OpenAI.
# Même adresse côté site, dans IA_BASE_URL de src/lib/ai-provider.ts.
# `.strip()` : un retour à la ligne collé avec la clé casse l'en-tête HTTP.
client_ia = OpenAI(api_key=MAMMOUTH_API_KEY.strip(), base_url="https://api.mammouth.ai/v1")

FETCH_PAUSE    = 0.5   # entre fetches HTML
IA_PAUSE      = 0.3   # entre appels au modèle
IA_MAX_RETRIES = 3
IA_RETRY_BACKOFF = (2, 8, 30)

STATUTS_AVEC_CENSURES = {"Partiellement conforme", "Non conforme"}

# ── Prompt et paramètres IA ─────────────────────────────────────────────────
# Source unique, partagée avec src/lib/prompts.ts : la page /documentation/prompts-ia
# publie le prompt, ce script l'envoie. Tant que les deux lisent ce fichier, la page
# ne peut plus afficher autre chose que ce qui tourne réellement.
# Chemin dérivé de __file__ et non du répertoire courant : le workflow nightly fait
# un `cd pipeline` avant de lancer le script.
_PROMPT_PATH = Path(__file__).resolve().parent.parent / "src" / "lib" / "prompts" / "cc-decision.json"
_PROMPT = json.loads(_PROMPT_PATH.read_text(encoding="utf-8"))

MODEL = _PROMPT["model"]
MAX_TOKENS = _PROMPT["maxOutputTokens"]
TEMPERATURE = _PROMPT["temperature"]
REASONING_EFFORT = _PROMPT["reasoningEffort"]
MAX_INPUT_CHARS = _PROMPT["maxInputChars"]
SYSTEM_PROMPT = _PROMPT["system"]
SCHEMA = _PROMPT["schema"]

# Empreinte du prompt, calculée aussi côté TypeScript par `PROMPT_VERSION_CC`
# (src/lib/prompts.ts) pour l'afficher sur /documentation/prompts-ia. Les deux
# recettes doivent tomber sur les mêmes huit caractères, sinon la page annonce une
# version qui ne déclenche aucune régénération. Trois règles, vérifiées par proto
# sur le fichier réel, accents et « ≤ » compris :
#   • mêmes champs, dans le même ordre, `model` compris et en dernier (changer
#     de modèle régénère donc tout), mais pas `_notes`, qui est de la documentation ;
#   • sérialisation sans espaces, comme `JSON.stringify` ;
#   • pas de ré-encodage des non-ASCII, d'où `ensure_ascii=False`.
# Pas de tri des clés : les deux langages préservent l'ordre du fichier.
PROMPT_VERSION = hashlib.md5(
    json.dumps(
        {
            "system": SYSTEM_PROMPT,
            "schema": SCHEMA,
            "maxOutputTokens": MAX_TOKENS,
            "temperature": TEMPERATURE,
            "reasoningEffort": REASONING_EFFORT,
            "maxInputChars": MAX_INPUT_CHARS,
            "model": MODEL,
        },
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")
).hexdigest()[:8]

def extract_decision_text(html: str, max_chars: int = MAX_INPUT_CHARS) -> str:
    """Extrait le texte complet de la décision CC, envoyé tel quel au modèle."""
    soup = BeautifulSoup(html, "html.parser")
    paragraphs = []
    for p in soup.find_all("p"):
        text = p.get_text(separator=" ", strip=True).replace("\xa0", " ")
        text = re.sub(r"\s+", " ", text).strip()
        if len(text) > 20:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)[:max_chars]


def build_user_prompt(decision_text: str, articles_bruts: list[str], statut: str, dispositif: str) -> str:
    """Construit le message envoyé au modèle : la décision, la liste des censures, puis le
    statut officiel et le dispositif recopiés à la fin. Le prompt les désigne comme la source
    de la portée de chaque décision : sans eux, le banc du 2026-11-05 montrait des réserves
    oubliées et des censures partielles présentées comme totales."""
    articles_str = (
        "\n".join(f"- {a}" for a in articles_bruts)
        if articles_bruts
        else "(aucune disposition déclarée contraire à la Constitution)"
    )
    return (
        f"Décision du Conseil constitutionnel :\n\n{decision_text}\n\n"
        f"Dispositions déclarées contraires à la Constitution (liste du dispositif) :\n{articles_str}\n\n"
        f"Statut officiel de la décision : {statut}\n\nDispositif complet :\n{dispositif}"
    )


# ── HTML parsing ───────────────────────────────────────────────────────────────

def fetch_cc_html(url: str) -> str | None:
    """Télécharge le HTML de la page CC. Retourne None si erreur."""
    try:
        r = http_requests.get(
            url, timeout=30,
            headers={"User-Agent": "Mozilla/5.0 (compatible; LoiClair/1.0)"},
        )
        r.raise_for_status()
        return r.text
    except Exception as e:
        tqdm.write(f"  Erreur fetch {url}: {e}")
        return None


def lire_dispositif(html: str) -> str:
    """Texte du dispositif (« LE CONSEIL CONSTITUTIONNEL DÉCIDE » et la suite, jusqu'à la
    signature), ou "" s'il est absent. Le dernier titre de la page, car le mot « décide »
    peut figurer plus haut dans la décision. La signature, « Jugé par » ou la forme
    « Délibéré par », arrête la lecture : sans elle, tout le pied de page suivrait, et
    partirait au modèle comme du texte officiel."""
    texte = re.sub(r"\s+", " ", BeautifulSoup(html, "html.parser").get_text(" "))
    debut = texte.rfind("LE CONSEIL CONSTITUTIONNEL DÉCIDE")
    return re.split(r"Jugé par|Délibéré par", texte[debut:])[0] if debut >= 0 else ""


def parse_cc_html(dispositif: str) -> list[str]:
    """
    Rend les dispositions que le dispositif de la décision (`lire_dispositif`) déclare
    contraires à la Constitution, une entrée par élément de liste. Appelée par `_traiter`
    sur les seuls statuts à censure.

    Lit le texte et non les balises : le site du Conseil varie d'une décision à l'autre
    (un <p> par article, tout le dispositif dans un seul <p>, listes en <ul> ou en
    phrase). Suivre le <ul> placé après l'article 1er rendait, sur 2025-874 DC et
    2025-875 DC, la liste de l'article suivant : celle des dispositions conformes,
    transmise au modèle comme censurée.

    Le découpage suit les titres « Article N. - », avec une capitale : une référence
    interne au dispositif (« l'article 2 ») n'en est pas un. Plusieurs sections peuvent
    censurer (2025-885 DC, articles 1er et 4).

    Une section censure si elle dit « contraire(s) à la Constitution » hors négation : le
    mot seul peut figurer dans une disposition citée, validée par une phrase qui ne
    commence pas par « Sont conformes » (forme de 2025-886 DC, article 3). Le deux-points
    n'ouvre une liste que s'il suit cette formule avant tout guillemet : avant, ou entre
    « », il appartient au texte cité.
    """
    articles: list[str] = []
    for section in re.split(r"Article \d+ ?(?:er)? ?[.–—-]+ ?[–—-]?", dispositif)[1:]:
        section = section.strip()
        censure = re.search(r"(?<!pas )contraires? à la Constitution", section)
        if not censure or section.startswith(("Sont conformes", "Sous les réserves")):
            continue
        suite = section[censure.end():]
        liste = suite.split(":", 1)[1] if ":" in suite.split("«")[0] else section
        articles.extend(e for e in (x.strip(" .;-–") for x in liste.split(";")) if e)
    return articles


# ── Contrôle de la liste ───────────────────────────────────────────────────────────

# Au-delà de ce nombre de dispositions, la règle ARTICLES du prompt demande des groupes.
SEUIL_GROUPES = 12

# « 12 », « 123-4 » ou « 12 bis », qui n'est pas l'article 12. Jamais le « 3 » de « 3° », une
# subdivision. Sans le suffixe, la lecture de « 3, 5 bis et 7 » s'arrêterait à « bis » et
# perdrait le 7.
_NUMERO = (
    r"(?<![\d\-])\d[\d\-]*(?![\d\-]|\s*°)"
    r"(?:\s+(?:bis|ter|quater|quinquies|sexies|septies|octies|nonies|decies))?"
)
# Préfixe d'un article de code : L., R., D., ou L.O. dans les décisions sur une loi organique.
_PREFIXE_CODE = r"(?:L\.?\s*O\.?|[LRD]\.?)\s*"
_REFS_ARTICLES = re.compile(
    rf"articles?\s+((?:{_PREFIXE_CODE})?{_NUMERO}"
    rf"(?:\s*(?:,|\bet\b|\bou\b|à)\s*(?:{_PREFIXE_CODE})?{_NUMERO})*)",
    re.I,
)
_REF_CODE = re.compile(rf"articles?\s+{_PREFIXE_CODE}{_NUMERO}", re.I)


def _normaliser(texte: str) -> str:
    """Ramène à une forme unique ce que le dispositif et le modèle écrivent différemment :
    espaces insécables, « 1er » et « article premier »."""
    texte = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", texte))
    texte = re.sub(r"\barticle premier\b", "article 1", texte, flags=re.I)
    return re.sub(r"\b(\d+) ?er\b", r"\1", texte)


def numeros_articles(texte: str) -> set[str]:
    """Numéros d'articles nommés dans un texte. « 74 à 77 » compte pour les quatre, sinon un
    article d'une plage du dispositif passerait pour absent de la liste du modèle."""
    numeros: set[str] = set()
    for groupe in _REFS_ARTICLES.findall(_normaliser(texte)):
        for morceau in re.split(r"\s*(?:,|\bet\b|\bou\b)\s*", re.sub(_PREFIXE_CODE, "", groupe)):
            bornes = [b.strip() for b in re.split(r"\s*à\s*", morceau.strip()) if b.strip()]
            if len(bornes) == 2 and all(b.isdigit() for b in bornes):
                numeros |= {str(n) for n in range(int(bornes[0]), int(bornes[1]) + 1)}
            else:
                numeros |= set(bornes)
    return numeros


def ecart_liste(articles_bruts: list[str], articles: list[dict]) -> dict:
    """Compare les numéros d'articles de la liste du modèle à ceux du dispositif, et rend
    {"manquent", "en_trop"}, ou {} si elles concordent. Appelée par `appeler_modele` : le
    site présente cette liste comme ce qui a été retiré de la loi, une ligne en moins ou en
    plus y serait une erreur de fait. Ne voit que les numéros, pas les subdivisions : un
    paragraphe oublié dans un article cité passe (constaté sur 2026-901 le 2026-11-05).

    Un refus coûte trois appels payants chaque nuit et laisse la décision sans résumé : le
    contrôle ne réclame donc que ce qu'une liste juste contient forcément.
    - Un numéro voulu compte s'il figure n'importe où dans `texte`, pas seulement après le
      mot « article » : « Articles 35, paragraphe IV ; 37 ; 48 » cite bien le 37 et le 48.
    - Un article de code cité par le modèle n'est pas « en trop » : c'est souvent le texte
      que modifiait l'article censuré (« article L. 214-3 » sur 2026-914).
    - Au-delà de `SEUIL_GROUPES`, un groupe peut se réduire à un thème, sans numéro : les
      manquants ne se lisent plus, et seuls les numéros en trop restent contrôlés.
    - Un dispositif sans numéro (« La loi … est contraire à la Constitution ») ne donne
      rien à comparer."""
    voulus = numeros_articles(" ; ".join(articles_bruts))
    if not voulus:
        return {}
    texte = _normaliser(" ; ".join(a["texte"] for a in articles))
    theme_seul = any(not numeros_articles(a["texte"]) for a in articles)
    manquent = (
        set() if len(voulus) > SEUIL_GROUPES and theme_seul
        else voulus - set(re.findall(_NUMERO, texte, re.I)) - numeros_articles(texte)
    )
    en_trop = numeros_articles(_REF_CODE.sub(" ", texte)) - voulus
    return {"manquent": sorted(manquent), "en_trop": sorted(en_trop)} if manquent or en_trop else {}


# ── Modèle IA ───────────────────────────────────────────────────────────────────────

def appeler_modele(decision_text: str, articles_bruts: list[str], statut: str, dispositif: str) -> dict | None:
    """Appelle le modèle avec retries, retourne {resume, articles, resume_en, articles_en} ou None."""
    user_prompt = build_user_prompt(decision_text, articles_bruts, statut, dispositif)
    last_err = None
    for attempt, backoff in enumerate(IA_RETRY_BACKOFF):
        try:
            response = client_ia.chat.completions.create(
                model=MODEL,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user",   "content": user_prompt},
                ],
                max_tokens=MAX_TOKENS,
                temperature=TEMPERATURE,
                reasoning_effort=REASONING_EFFORT,
                # Le schéma part dans le corps de la requête : le modèle ne peut
                # plus rendre autre chose qu'un objet conforme, et la réponse se
                # lit par un `json.loads` direct. L'extraction par expression
                # régulière de la première accolade qui vivait ici acceptait
                # n'importe quoi tant que ça commençait par « { ».
                response_format={
                    "type": "json_schema",
                    "json_schema": {"name": "decision_cc", "strict": True, "schema": SCHEMA},
                },
            )
            data = json.loads(response.choices[0].message.content or "")
            # Le schéma ne lie pas les deux listes : une censure oubliée en anglais
            # disparaîtrait de /en, où le lecteur croirait le Conseil moins sévère.
            # Lever ici fait reprendre l'appel par la boucle de tentatives.
            if len(data["articles_en"]) != len(data["articles"]):
                raise ValueError(f"articles_en : {len(data['articles_en'])} entrée(s) "
                                 f"pour {len(data['articles'])} en français")
            # Même reprise pour une liste fausse. Si elle le reste, `None` empêche toute
            # écriture : la décision se retente la nuit suivante.
            ecart = ecart_liste(articles_bruts, data["articles"]) if articles_bruts else {}
            if ecart:
                raise ValueError(f"liste différente du dispositif : {ecart}")
            return {"resume": str(data["resume"]).strip(), "articles": data["articles"],
                    "resume_en": str(data["resume_en"]).strip(), "articles_en": data["articles_en"]}
        except Exception as e:
            last_err = e
            tqdm.write(f"  Erreur IA (tentative {attempt + 1}): {e}")
        if attempt < IA_MAX_RETRIES - 1:
            time.sleep(backoff)
    tqdm.write(f"  Abandon après {IA_MAX_RETRIES} tentatives: {last_err}")
    return None


# ── Pipeline principal ─────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print("IMPORT CC DECISIONS — Résumé IA + articles censurés")
    print("=" * 60)

    # Une connexion pour tout le passage, validée écriture par écriture (autocommit) :
    # une décision résumée, payée au modèle, ne doit pas dépendre de la suivante.
    conn = connexion(autocommit=True)
    try:
        _traiter(conn)
    finally:
        conn.close()


def _traiter(conn: psycopg.Connection) -> None:
    """Corps de `main` : lecture des actes à traiter, puis une décision après l'autre."""
    # Charge les actes CC-CONCLUSION à (re)traiter. Trois branches, pas deux :
    # `<>` ne matche jamais un NULL en SQL, donc sans `IS NULL` explicite sur la
    # colonne de version, les lignes résumées avant son introduction ne seraient
    # jamais reprises et le filtre serait un no-op silencieux.
    actes = lire(
        conn,
        """
        SELECT uid, dossier_uid, url_conclusion, statut_conclusion
        FROM actes_legislatifs
        WHERE code_acte = 'CC-CONCLUSION'
          AND url_conclusion IS NOT NULL
          AND (resume_cc IS NULL
               OR resume_cc_prompt_version IS NULL
               OR resume_cc_prompt_version <> %s)
        ORDER BY uid, dossier_uid
        """,
        (PROMPT_VERSION,),
    )

    print(f"\nVersion du prompt : {PROMPT_VERSION}")
    print(f"{len(actes)} acte(s) CC-CONCLUSION à traiter\n")
    if not actes:
        print("Rien à faire.")
        return

    success = 0
    skipped = 0

    for acte in tqdm(actes, desc="CC decisions", unit="décision"):
        uid          = acte["uid"]
        dossier_uid  = acte["dossier_uid"]
        url          = acte["url_conclusion"]
        statut       = acte.get("statut_conclusion") or ""

        # 1. Fetch HTML
        html = fetch_cc_html(url)
        time.sleep(FETCH_PAUSE)
        if not html:
            skipped += 1
            continue

        # 2. Extraire le texte complet de la décision
        decision_text = extract_decision_text(html)

        # 3. Parse articles censurés depuis le dispositif (seulement si applicable).
        # Un statut ou un dispositif absent, ou une censure annoncée sans rien trouver
        # dans le dispositif, s'arrêtent ici, avant l'appel payant : le prompt désigne les
        # deux premiers comme source de la portée de la décision et dirait « aucune
        # disposition » pour le troisième, puis la version écrite empêcherait toute
        # reprise. Sans écriture, la décision compte en « ignoré » et se retente chaque nuit.
        dispositif = lire_dispositif(html)
        if not statut or not dispositif:
            tqdm.write(f"  Statut ou dispositif absent pour {uid} (statut {statut!r}) : {url}")
            skipped += 1
            continue
        peut_censurer = statut in STATUTS_AVEC_CENSURES
        articles_bruts = parse_cc_html(dispositif) if peut_censurer else []
        if peut_censurer and not articles_bruts:
            tqdm.write(f"  Aucune censure lue pour {uid} (statut {statut}) : {url}")
            skipped += 1
            continue

        # 4. Appel au modèle avec le texte complet
        result = appeler_modele(decision_text, articles_bruts, statut, dispositif)
        time.sleep(IA_PAUSE)
        if not result:
            skipped += 1
            continue

        # 5. Préparer articles_censures JSONB (null si liste vide). Le statut officiel
        # décide, jamais le modèle : le schéma ne lui interdit pas de remplir `articles`,
        # et sur une décision sans censure il y a rangé des dispositions validées ou
        # des réserves. La fiche les affichait alors comme retirées du texte (quatre
        # décisions dont 2026-910 DC et 2026-912 DC, constaté le 2026-11-05).
        articles_json = result["articles"] if peut_censurer and result["articles"] else None
        articles_en_json = result["articles_en"] if peut_censurer and result["articles_en"] else None

        # 6. Mise à jour DB, une décision à la fois et non en lot : chaque écriture suit
        # un appel payant au modèle, et un lot gardé en mémoire perdrait des résumés
        # déjà payés si le passage s'interrompait. Les jsonb partent via `Json`, et une
        # liste vide reste un NULL SQL (`None`), pas un `null` JSON.
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE actes_legislatifs SET
                      resume_cc = %s, articles_censures = %s,
                      resume_cc_en = %s, articles_censures_en = %s,
                      resume_cc_prompt_version = %s
                    WHERE uid = %s AND dossier_uid = %s
                    """,
                    (
                        result["resume"],
                        Json(articles_json) if articles_json is not None else None,
                        result["resume_en"],
                        Json(articles_en_json) if articles_en_json is not None else None,
                        PROMPT_VERSION, uid, dossier_uid,
                    ),
                )
            success += 1
        except psycopg.Error as e:
            tqdm.write(f"  Erreur DB pour {uid}: {e}")
            skipped += 1

    print(f"\n{'=' * 60}")
    print(f"RÉSULTAT : {success} traité(s), {skipped} ignoré(s)")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()
