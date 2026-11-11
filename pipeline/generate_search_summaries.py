"""
generate_search_summaries.py
Écrit la fiche courte de chaque dossier législatif : un résumé citoyen
(search_summary), lu tel quel par la newsletter et indexé par la recherche du
site, et 1 à 3 thèmes pris dans une liste fermée (themes). Un seul appel au
modèle rend les deux. C'est la seule source des thèmes : les imports n'en
écrivent plus.

Le résumé part du texte de dépôt (priority waterfall) :
  1. Texte déposé viable (projet/proposition de loi ou de résolution, pas encore
     adopté), le plus ancien
  2. À défaut, tout autre texte viable — rapport d'information surtout : ces
     dossiers de mission n'ont pas de texte déposé mais ont un vrai contenu

Un dossier passe ici :
  - s'il n'a pas de résumé et qu'un texte viable existe, que le modèle n'a pas
    encore lu (search_source_texte_uid garde le dernier texte lu : un texte
    réduit à sa page de titre rend un résumé vide et ne sera pas relu chaque nuit ;
    un résumé vide sur un texte de plus de SEUIL_TEXTE_REEL caractères veut dire
    que le début lu n'avait rien à résumer, souvent le sommaire d'un gros
    rapport : chaque nouvel essai relit le texte depuis le début, plus loin
    (MAX_INPUT_CHARS caractères de plus), jusqu'à NB_ESSAIS essais, puis le dossier
    est signalé en anomalie dans le bilan de nuit pour être regardé à la main) ;
  - ou s'il n'a pas de thème. Sans texte, le modèle ne voit que le titre : il
    rend des thèmes et un résumé vide, et le dossier repassera le jour où un
    texte arrive.
Un dossier résumé n'est jamais retraité, même quand il progresse (adoption,
promulgation) : le résumé reste celui du texte de dépôt. Chaque appel est payant.
Seule exception : un dossier résumé mais sans thème repasse en entier, et son
résumé est réécrit avec ses thèmes.

Chaque dossier est écrit en base dès sa réponse : un passage interrompu garde
tout ce qui est fait, et le suivant reprend les dossiers restés sans thème.
`--limit` borne un passage (l'étape de nuit, sous sa coupure de 45 minutes).

Prérequis :
- Variables PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (connexion Postgres, voir `_db.py`)
  et ANTHROPIC_API_KEY_DOSSIER_SUMMARIES dans .env.local
- pip install anthropic beautifulsoup4 pdfplumber psycopg
"""

import json
import os
import re
import sys
import time
import argparse
import requests
from io import BytesIO
from pathlib import Path
from dotenv import load_dotenv
import anthropic
import psycopg
from tqdm import tqdm
from bs4 import BeautifulSoup

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import envoyer_alerte_best_effort, signaler_anomalie  # noqa: E402
from _db import connexion, lire  # noqa: E402

try:
    import pdfplumber
    HAS_PDF = True
except ImportError:
    HAS_PDF = False
    print("⚠ pdfplumber non installé — les PDFs du Sénat seront ignorés.")

# ── Configuration ─────────────────────────────────────────────────────────────

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY_DOSSIER_SUMMARIES")

if not ANTHROPIC_API_KEY:
    raise ValueError("ANTHROPIC_API_KEY_DOSSIER_SUMMARIES manquant dans .env.local")

# Une connexion par processus, ouverte au premier usage et rouverte si elle tombe : le
# passage dure jusqu'à 45 minutes (coupure de l'étape de nuit), avec de longues pauses
# entre deux écritures (fetch du texte, appel au modèle). Autocommit : chaque fiche est
# validée seule, pour qu'une interruption garde tout ce qui est déjà fait.
_conn: psycopg.Connection | None = None


def _connexion() -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed or _conn.broken:
        _conn = connexion(autocommit=True)
    return _conn

# Un des deux usages du site qui ne passent pas par Mammouth, avec
# « Ce qui me concerne » (classer_articles.py) : le banc de
# scripts/banc-fiches-courtes/ a retenu Claude Haiku 5.5 pour cette fiche.
# Le SDK relance seul les 429, 5xx et coupures réseau (max_retries).
# `.strip()` : un retour à la ligne collé avec la clé casse l'en-tête HTTP.
client_ia = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY.strip(), max_retries=4)

# ── Constantes du script ─────────────────────────────────────────────────────

RATE_LIMIT_PAUSE = 0.3  # Pause entre appels au modèle (secondes)
FETCH_TIMEOUT = 15  # Timeout pour les fetches HTTP (secondes)
MAX_THEMES = 3  # Le schéma ne peut pas le dire : l'API Claude refuse `maxItems`
# Au-delà, un texte n'est pas une simple page de couverture : un résumé vide y est
# une erreur du modèle. Constaté le 2026-10-16 sur les 113 résumés vides du
# rattrapage : des textes complets de 15 000 caractères, mais aussi des couvertures
# de plus de 3 000 caractères, quand la liste des signataires est longue (« pêche
# durable », 3 274). Sous ce seuil, le « rien à résumer » est cru.
SEUIL_TEXTE_REEL = 5000
# Essais par fiche. Ils servent aussi à lire plus loin : après un résumé vide sur un
# vrai texte, l'essai suivant envoie MAX_INPUT_CHARS caractères de plus, toujours
# depuis le début (voir `generate_fiche`). Le même extrait donne presque toujours la
# même réponse : le 2026-10-16, « Qualité des études d'impact » (DLR5L15N36391) a
# rendu quatre résumés vides de suite, et le 2026-10-17, quatre gros rapports ont
# rendu trois fois le même vide, leurs 15 000 premiers caractères n'étant que
# sommaire et liste des membres (le corps commence vers 20 000 à l'Assemblée,
# 27 000 au Sénat).
# Au-delà, on ne réessaie plus la nuit suivante, on signale.
NB_ESSAIS = 3


# ── Prompt et paramètres IA ─────────────────────────────────────────────────
# Source unique, partagée avec src/lib/prompts.ts : la page /documentation/prompts-ia
# publie le prompt, ce script l'envoie. Tant que les deux lisent ce fichier, la page
# ne peut plus afficher autre chose que ce qui tourne réellement.
# Chemin dérivé de __file__ et non du répertoire courant : le workflow nightly fait
# un `cd pipeline` avant de lancer le script.
_PROMPT_PATH = Path(__file__).resolve().parent.parent / "src" / "lib" / "prompts" / "search-summary.json"
_PROMPT = json.loads(_PROMPT_PATH.read_text(encoding="utf-8"))

MODEL = _PROMPT["model"]
MAX_TOKENS = _PROMPT["maxOutputTokens"]
REASONING_EFFORT = _PROMPT["reasoningEffort"]
MAX_INPUT_CHARS = _PROMPT["maxInputChars"]  # Envoyé au 1er essai, ajouté à chaque suivant
# Ce qu'on garde du texte lu : ce qu'envoie le dernier essai. La page entière et la
# colonne `contenu_legifrance` arrivent de toute façon en entier, la coupe se fait ici.
MAX_TEXTE_LU = NB_ESSAIS * MAX_INPUT_CHARS
SYSTEM_PROMPT = _PROMPT["system"]
USER_PROMPT_TEMPLATE = _PROMPT["userTemplate"]
SCHEMA = _PROMPT["schema"]
THEMES = set(SCHEMA["properties"]["themes"]["items"]["enum"])

# ── Priority waterfall : score pour sélectionner le meilleur texte ────────────

# Types qui constituent le dépôt d'un dossier. Un texte de l'un de ces types
# encore dépourvu de statut_adoption est le texte tel qu'il a été déposé.
DEPOT_TYPES = {
    "Projet de loi",
    "Proposition de loi",
    "Proposition de résolution",
    "Accord international",
}

# Plus le score est bas, plus le texte est prioritaire
TYPE_PRIORITY = {
    "Projet de loi": 0,
    "Proposition de loi": 1,
    "Proposition de résolution": 2,
    "Accord international": 3,
    "Rapport d'information": 4,
    "Rapport": 5,
}


def text_priority_key(texte: dict) -> tuple:
    """Clé de tri pour sélectionner le texte source d'un dossier.
    Priorité : texte de dépôt > tout autre texte viable ; à égalité, le plus
    ancien, qui est le dépôt initial et non une réécriture de navette.
    Retourne un tuple comparable (plus petit = meilleur)."""
    est_depot = (
        texte.get("type_libelle") in DEPOT_TYPES
        and not texte.get("statut_adoption")
    )
    type_texte = TYPE_PRIORITY.get(texte.get("type_libelle"), 8)
    # date_depot en string ISO — tri croissant, le plus ancien d'abord.
    # Les dates absentes passent en dernier plutôt qu'en premier.
    date = texte.get("date_depot") or "9999"

    return (
        0 if est_depot else 1,
        type_texte,
        date,
    )


# ── Extraction de contenu ────────────────────────────────────────────────────

def fetch_html_content(url: str) -> str | None:
    """Fetche et extrait le texte d'une page HTML (Assemblée Nationale)."""
    try:
        resp = requests.get(url, timeout=FETCH_TIMEOUT, headers={
            "User-Agent": "LoiClair-Bot/1.0 (loiclair.fr; data indexing)",
        })
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")
        # Retirer scripts et styles
        for tag in soup(["script", "style", "nav", "header", "footer"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        # Normaliser les espaces
        text = re.sub(r"\s+", " ", text).strip()
        return text[:MAX_TEXTE_LU] if text else None
    except Exception as e:
        tqdm.write(f"  Erreur fetch HTML {url}: {e}")
        return None


def fetch_pdf_content(url: str) -> str | None:
    """Fetche et extrait le texte d'un PDF."""
    if not HAS_PDF:
        return None
    try:
        resp = requests.get(url, timeout=FETCH_TIMEOUT, headers={
            "User-Agent": "LoiClair-Bot/1.0 (loiclair.fr; data indexing)",
        })
        if resp.status_code != 200:
            return None
        with pdfplumber.open(BytesIO(resp.content)) as pdf:
            parts = []
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    parts.append(text)
            text = "\n".join(parts).strip()
            return text[:MAX_TEXTE_LU] if text else None
    except Exception as e:
        tqdm.write(f"  Erreur fetch PDF {url}: {e}")
        return None


def fetch_senat_html_content(url: str) -> str | None:
    """Fetche et extrait le texte d'une page HTML Sénat avec les bons sélecteurs."""
    try:
        fetch_url = url
        # Vieux rapport paginé → essayer la version mono-page
        if re.search(r'/rap/[^/]+/[^/]+\.html$', url) and "_mono" not in url:
            mono_url = url.replace(".html", "_mono.html")
            try:
                r = requests.head(mono_url, timeout=5, headers={"User-Agent": "LoiClair-Bot/1.0"})
                if r.status_code == 200:
                    fetch_url = mono_url
            except Exception:
                pass

        resp = requests.get(fetch_url, timeout=FETCH_TIMEOUT, headers={
            "User-Agent": "LoiClair-Bot/1.0 (loiclair.fr; data indexing)",
        })
        if resp.status_code != 200:
            return None

        # Passer les bytes pour que BeautifulSoup détecte l'encodage (Latin-1 sur anciens docs)
        soup = BeautifulSoup(resp.content, "html.parser")

        # Sélecteur 1 : formCorrection:contenu (docs modernes post-2007)
        contenu = soup.find(id="formCorrection:contenu")
        if contenu:
            text = contenu.get_text(separator="\n", strip=True)
        else:
            # Sélecteur 2 : col-md-8[1] (docs anciens)
            cols = soup.find_all("div", class_="col-md-8")
            if len(cols) >= 2:
                text = cols[1].get_text(separator="\n", strip=True)
            else:
                return None

        text = re.sub(r"\n{3,}", "\n\n", text).strip()
        return text[:MAX_TEXTE_LU] if text else None
    except Exception as e:
        tqdm.write(f"  Erreur fetch HTML Sénat {url}: {e}")
        return None


def get_text_content(texte: dict) -> str | None:
    """Récupère le contenu textuel d'un texte, depuis la DB ou par fetch."""
    # Priorité 1 : contenu déjà en DB, lu ici pour ce seul texte (voir `fetch_all_textes`)
    if texte.get("a_contenu"):
        lignes = lire(_connexion(), "SELECT contenu_legifrance FROM textes WHERE uid = %s", (texte["uid"],))
        contenu = lignes[0].get("contenu_legifrance") if lignes else None
        if contenu:
            return contenu[:MAX_TEXTE_LU]

    # Priorité 2 : fetch depuis l'URL
    lien = texte.get("lien_texte")
    if not lien or not texte.get("url_accessible"):
        return None

    if "senat.fr" in lien:
        if lien.endswith(".pdf"):
            return fetch_pdf_content(lien)  # PDF résiduel non encore migré
        return fetch_senat_html_content(lien)
    elif lien.endswith(".pdf"):
        return fetch_pdf_content(lien)
    else:
        return fetch_html_content(lien)


# ── Génération de la fiche via le modèle ──────────────────────────────────────

def generate_fiche(titre: str, procedure: str, contenu: str | None) -> dict | None:
    """Appelle le modèle et rend {"resume", "themes", "resume_refuse"}, ou None si
    la réponse n'est pas enregistrable. `themes` peut revenir vide : le résumé s'écrit
    quand même, le dossier garde ses thèmes d'avant, et s'il n'en avait pas, il
    repasse au passage suivant. `resume_refuse` vaut True quand aucun essai n'a
    donné de résumé d'un vrai texte : l'appelant le signale, avec `lus` et `essais`
    (caractères envoyés et essais faits jusqu'au dernier abouti). De `contenu` (jusqu'à
    MAX_TEXTE_LU caractères), le 1er essai envoie les MAX_INPUT_CHARS premiers
    caractères ; à None, le modèle ne voit que le titre et rend un résumé vide
    (consigne « Sans contenu » du prompt). Appelée par `traiter`, dans `main`."""
    # Plusieurs essais pour une réponse mal formée : au banc, un thème vide ou en
    # trop est arrivé une fois sur quarante, et un second tirage s'en sort.
    # Au rattrapage d'octobre 2026, 5 fiches sur 3 839 avaient un bon résumé et
    # une liste de thèmes vide : ce résumé-là est gardé.
    # Un résumé vide sur un vrai texte, lui, fait lire plus loin : le début d'un
    # gros rapport n'est souvent que sommaire et liste des membres, que le modèle
    # traite comme la « page de titre et liste des signataires » que le prompt dit de
    # ne pas résumer, et relire le même extrait rend le même vide. C'est le modèle
    # qui juge où commence le fond : les titres changent d'un rapport à l'autre,
    # aucune liste ne les couvrirait tous. L'extrait grandit mais part toujours du
    # début : envoyé seul, un morceau pris au milieu (essayé le 2026-10-17) a fait
    # écrire au modèle que « le texte fourni » ne contenait pas les mesures, et
    # choisir ses thèmes sur ce seul morceau (« Outre-mer » perdu sur un rapport
    # consacré aux outre-mer).
    dernier = None
    fin = MAX_INPUT_CHARS
    for essai in range(NB_ESSAIS):
        extrait = contenu[:fin] if contenu else None
        user_prompt = USER_PROMPT_TEMPLATE.format(
            titre=titre,
            procedure_libelle=procedure,
            contenu_extrait=extrait or "(Aucun contenu disponible)",
        )
        try:
            r = client_ia.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                # Consignes et schéma, identiques d'un dossier à l'autre (3 313 jetons
                # mesurés le 2026-10-16), gardés 5 minutes en cache : les fiches de la
                # nuit s'enchaînent toutes les quelques secondes et les relisent au
                # dixième du prix.
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user_prompt}],
                output_config={"effort": REASONING_EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
            )
        except anthropic.APIError as e:
            # Le SDK a déjà relancé ce qui pouvait l'être (429, 5xx, réseau). Après
            # le premier essai, la fiche partielle des précédents reste bonne à garder.
            tqdm.write(f"  Erreur IA : {e}")
            return dernier
        # La réflexion compte dans MAX_TOKENS : une fiche coupée en route n'est pas
        # du JSON complet, et écrite elle le resterait, un dossier résumé n'étant
        # jamais retraité. Un refus des filtres de sécurité ne rend pas non plus
        # une fiche conforme au schéma. Pas d'essai de plus : même entrée, même issue.
        if r.stop_reason in ("max_tokens", "refusal"):
            tqdm.write(f"  Fiche non enregistrée (stop_reason {r.stop_reason})")
            return dernier
        try:
            data = json.loads(next(b.text for b in r.content if b.type == "text"))
        except (StopIteration, json.JSONDecodeError) as e:
            tqdm.write(f"  Réponse illisible (essai {essai + 1}/{NB_ESSAIS}) : {e}")
            continue
        # Le schéma garantit la liste fermée ; on revérifie quand même, puisqu'un
        # thème hors liste casserait les filtres et le quiz. Dédoublonnés, puis les
        # trois premiers : le modèle les range du plus central au plus secondaire.
        themes = list(dict.fromkeys(t for t in data.get("themes") or [] if t in THEMES))[:MAX_THEMES]
        resume = (data.get("resume") or "").strip()
        if dernier:
            # Un tirage complète les précédents au lieu de les écraser : un bon
            # résumé de l'un et des thèmes de l'autre font une fiche entière.
            themes = themes or dernier["themes"]
            resume = resume or dernier["resume"]
        resume_manque = not resume and len(contenu or "") > SEUIL_TEXTE_REEL
        if themes and not resume_manque:
            return {"resume": resume, "themes": themes, "resume_refuse": False}
        manques = [m for m, absent in (("aucun thème valide", not themes), ("résumé vide sur un vrai texte", resume_manque)) if absent]
        lu = f", {len(extrait)} premiers caractères lus" if extrait else ""
        tqdm.write(f"  Fiche incomplète : {', '.join(manques)} (essai {essai + 1}/{NB_ESSAIS}{lu})")
        # `lus` : ce que cet essai a réellement envoyé, pour le bilan de nuit. Un essai
        # suivant peut s'arrêter avant d'avoir lu plus loin (erreur IA, réponse coupée).
        dernier = {"resume": resume, "themes": themes, "resume_refuse": resume_manque,
                   "lus": len(extrait or ""), "essais": essai + 1}
        # Un essai qui n'a manqué que les thèmes relit le même extrait, comme un
        # texte déjà envoyé en entier, faute de suite.
        if resume_manque and fin < len(contenu):
            fin += MAX_INPUT_CHARS
    return dernier


# ── Base : chargement des données ────────────────────────────────────────────

def fetch_dossiers() -> list:
    """Récupère tous les dossiers, triés par uid : l'ordre de traitement est stable.
    search_summary et search_source_texte_uid servent de mémoire : voir l'en-tête."""
    # `hors_liste` : dossiers comptés dans le score mais absents de la liste et de la
    # recherche (migration 2026-10-29_dossiers_hors_liste.sql). Une fiche courte
    # n'y servirait qu'à la recherche, qui ne les montre pas : un appel IA pour rien.
    return lire(
        _connexion(),
        "SELECT uid, titre, themes, procedure_libelle, search_summary, search_source_texte_uid "
        "FROM dossiers_legislatifs WHERE hors_liste = false ORDER BY uid",
    )


def fetch_all_textes() -> list:
    """Récupère tous les textes avec les champs nécessaires pour la sélection.

    Le texte intégral (`contenu_legifrance`) n'est pas chargé : la sélection n'a besoin
    que de savoir s'il existe. `a_contenu` porte cette information, calculée par
    Postgres ; `get_text_content` lit ensuite le contenu du seul texte retenu.
    """
    # `<> ''` est NULL sur un contenu NULL : le `COALESCE` en fait un faux, comme le
    # faisait le test de vérité sur la chaîne.
    return lire(
        _connexion(),
        "SELECT uid, dossier_ref, type_libelle, statut_adoption, date_depot, "
        "lien_texte, url_accessible, titre_principal_court, "
        "COALESCE(contenu_legifrance <> '', false) AS a_contenu "
        "FROM textes ORDER BY uid",
    )


# ── Script principal ──────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Écrit la fiche courte (résumé et thèmes) des dossiers législatifs")
    parser.add_argument("--limit", type=int, default=0,
                        help="Plafond de dossiers traités par passage (0 = tous) ; les suivants attendent le prochain")
    parser.add_argument("--dry-run", action="store_true",
                        help="Afficher ce qui serait traité, sans rien modifier")
    args = parser.parse_args()

    print("=" * 60)
    print("FICHES COURTES DES DOSSIERS (résumé et thèmes)")
    if args.limit:
        print(f"   Plafond : {args.limit} dossier(s) par passage")
    if args.dry_run:
        print("   MODE DRY-RUN : aucune modification")
    print("=" * 60)

    # 1. Charger toutes les données
    print("\n1. Chargement des dossiers et textes...")
    dossiers = fetch_dossiers()
    textes = fetch_all_textes()
    print(f"   {len(dossiers)} dossiers, {len(textes)} textes chargés.")

    textes_par_dossier: dict[str, list] = {}
    for t in textes:
        ref = t.get("dossier_ref")
        if ref:
            textes_par_dossier.setdefault(ref, []).append(t)

    # 2. Sélection (règles dans l'en-tête du fichier)
    print("\n2. Sélection des dossiers...")
    a_traiter = []
    for dossier in dossiers:
        uid = dossier["uid"]
        if not dossier.get("titre"):
            continue
        viable = sorted(
            (t for t in (textes_par_dossier.get(uid) or []) if t.get("a_contenu") or t.get("url_accessible")),
            key=text_priority_key,
        )
        best = viable[0] if viable else None
        sans_theme = not dossier.get("themes")
        texte_nouveau = bool(best) and not dossier.get("search_summary") \
            and best["uid"] != dossier.get("search_source_texte_uid")
        if sans_theme or texte_nouveau:
            a_traiter.append({"dossier": dossier, "best_texte": best})

    avec_texte = sum(1 for i in a_traiter if i["best_texte"])
    print(f"   {len(a_traiter)} dossier(s) à traiter : {avec_texte} avec texte, "
          f"{len(a_traiter) - avec_texte} sur le titre seul (thèmes sans résumé).")

    if not a_traiter:
        print("\n   Rien à faire. Fin.")
        return

    if args.limit and len(a_traiter) > args.limit:
        # Les dossiers sans résumé d'abord (tri stable, l'ordre par uid tient dans
        # chaque groupe) : un rattrapage de thèmes sur des dossiers déjà résumés ne
        # doit pas faire attendre plusieurs nuits ceux que la newsletter attend.
        a_traiter.sort(key=lambda i: bool(i["dossier"].get("search_summary")))
        a_traiter = a_traiter[:args.limit]
        print(f"   ({args.limit} traités ce passage, les autres au suivant)")

    if args.dry_run:
        print("\n   DRY-RUN — Dossiers qui seraient traités :")
        for item in a_traiter:
            d, best = item["dossier"], item["best_texte"]
            src = f"{best['type_libelle']} ({best['statut_adoption'] or 'initial'})" if best else "titre seul"
            print(f"   • {d['uid']}: {d['titre'][:80]}  [{src}]")
        return

    # 3. Génération et écriture, dossier par dossier
    print(f"\n3. Génération des fiches ({len(a_traiter)} dossiers)...\n")
    compte = {"ecrits": 0, "resumes": 0, "errors": 0, "appels_ia": 0}

    def traiter(item) -> str:
        """Une fiche, de la lecture du texte à l'écriture en base. Rend le compteur
        à incrémenter."""
        dossier, best = item["dossier"], item["best_texte"]
        uid = dossier["uid"]

        # Le contenu peut rester vide malgré url_accessible : URL morte depuis le
        # dernier check, PDF illisible. Le texte n'est alors pas marqué comme lu,
        # et le dossier repassera ; s'il lui manque des thèmes, il les reçoit
        # tout de suite d'après son titre.
        contenu = get_text_content(best) if best else None
        if best and not contenu and dossier.get("themes"):
            return "errors"

        compte["appels_ia"] += 1
        fiche = generate_fiche(
            titre=dossier["titre"],
            procedure=dossier.get("procedure_libelle") or "",
            contenu=contenu,
        )
        if not fiche:
            return "errors"

        # Une liste vide n'efface jamais des thèmes existants : un dossier qui en
        # avait déjà (passé ici pour un nouveau texte) les garde, et un dossier sans
        # thème le reste, que la sélection reprend au passage suivant.
        maj = {}
        if fiche["themes"]:
            maj["themes"] = fiche["themes"]
        if contenu:
            # Texte lu, même si le résumé revient vide (texte réduit à sa page de
            # titre, ou vrai texte dont aucun essai n'a donné de résumé) : le
            # dossier ne repassera qu'avec un autre texte, ou à la main.
            maj["search_source_texte_uid"] = best["uid"]
            if fiche["resume_refuse"]:
                # Ce que le dernier essai abouti a lu, pas `len(contenu)` : une erreur
                # IA ou une réponse coupée arrête les essais avant le dernier extrait.
                signaler_anomalie(
                    "fiches",
                    f"{uid} « {dossier['titre'][:80]} » : aucun résumé sur les {fiche['lus']} "
                    f"premiers caractères envoyés, sur {len(contenu)} lus ({fiche['essais']} "
                    f"essai(s) sur {NB_ESSAIS}). À relire à la main ; vider "
                    f"search_source_texte_uid pour le relancer.",
                )
            # Un résumé vide n'efface jamais un résumé existant : au premier essai
            # (2026-10-15), un texte réduit à sa page de titre a rendu un résumé
            # vide, qui a effacé celui que DLR5L15N36391 avait déjà.
            if fiche["resume"]:
                maj["search_summary"] = fiche["resume"]
        if not maj:
            # Ni thème, ni résumé, ni texte à marquer comme lu : rien à écrire.
            return "errors"
        try:
            # Une écriture par fiche, juste après son appel payant : la garder en mémoire
            # pour un lot perdrait des fiches déjà payées si le passage s'interrompait.
            # Les noms de colonnes viennent des clés posées plus haut, jamais d'une donnée.
            affectations = ", ".join(f"{c} = %s" for c in maj)
            with _connexion().cursor() as cur:
                cur.execute(
                    f"UPDATE dossiers_legislatifs SET {affectations} WHERE uid = %s",
                    [*maj.values(), uid],
                )
        except psycopg.Error as e:
            tqdm.write(f"  Erreur sauvegarde {uid}: {e}")
            return "errors"
        time.sleep(RATE_LIMIT_PAUSE)
        return "resumes" if maj.get("search_summary") else "ecrits"

    for item in tqdm(a_traiter, desc="Fiches"):
        issue = traiter(item)
        compte[issue] += 1
        if issue == "resumes":
            compte["ecrits"] += 1

    ecrits, resumes, errors, appels_ia = compte["ecrits"], compte["resumes"], compte["errors"], compte["appels_ia"]
    print("\n" + "=" * 60)
    print(f"RÉSULTAT : {ecrits} fiche(s) écrite(s) dont {resumes} avec résumé, {errors} erreur(s)")
    print("=" * 60)

    if not ecrits and appels_ia:
        # N'alerter que si le modèle a réellement été sollicité : des textes tous
        # illisibles sont un problème de sources, pas de crédits, et ne doivent
        # pas déclencher une alerte qui enverrait recharger le compte pour rien.
        print("❌ Toutes les fiches ont échoué — abandon.")
        envoyer_alerte_best_effort(
            "⚠️ LoiClair — Génération des fiches courtes IA en échec total",
            f"<p>Les {appels_ia} fiches courtes du run quotidien (résumé et thèmes des "
            f"dossiers) ont toutes échoué (cause fréquente : crédits Anthropic épuisés ou "
            f"clé révoquée). La recherche, les thèmes et la newsletter ne seront pas à "
            f"jour tant que ce n'est pas corrigé.</p>"
            f'<p>→ Vérifier le solde et la clé : <a href="https://console.anthropic.com/settings/billing">'
            f"console Anthropic, facturation</a></p>",
        )
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    finally:
        if _conn is not None:
            _conn.close()
