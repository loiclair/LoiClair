# Outils partagés du banc « Ce qui me concerne » : chemins, module de classement de
# production (`pipeline/classer_articles.py`, lu, jamais écrit), clients API,
# barre de progression (si le mod task-progress est installé, sinon rien).
import json, subprocess, sys
from pathlib import Path

ICI = Path(__file__).parent
RES = ICI / "resultats"
BANC = RES / "banc"
RACINE = ICI.parents[1]
# Revue à l'aveugle du 2026-10-17 (les 73 % d'origine) : échantillon, propositions et
# jugements des trois juges Mammouth, repris tels quels pour la moitié de développement.
REVUE = RES / "revue-2026-10-17"
JUGES_MAMMOUTH = ["deepseek-v4-pro", "gemini-3.8-flash", "mistral-medium-3-5"]
PROGRESSION = Path.home() / ".claude/mods/task-progress/bin/progression"
AFFICHES = ("certain", "probable")

sys.path.insert(0, str(RACINE / "pipeline"))
import classer_articles as ca  # noqa: E402

THEME = {p["id"]: p["theme"] for p in ca._PROMPT["profils"]}


def lire(p):
    return json.loads(Path(p).read_text(encoding="utf-8"))


def ecrire(p, d):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def banc():
    """cle → élément (type, id, moitie, user, sources, ancien, actuel)."""
    return lire(BANC / "elements.json")


def nom(cle):
    """Nom de fichier sûr pour une clé « type|id »."""
    return cle.replace("|", "__").replace("/", "_").replace("#", "~")


def barre(*args):
    if PROGRESSION.exists():
        subprocess.run([PROGRESSION, *map(str, args)], check=False)


REGISTRE = RES / "depenses.jsonl"
PLAFONDS = {"anthropic": 20.0, "mammouth": 4.5}


def depenser(fournisseur, poste, usd):
    """Inscrit une dépense au registre (une ligne par appel ou par lot)."""
    import time
    with open(REGISTRE, "a", encoding="utf-8") as f:
        f.write(json.dumps({"t": time.time(), "fournisseur": fournisseur, "poste": poste, "usd": usd}) + "\n")


def depense(fournisseur):
    """Total dépensé chez un fournisseur depuis le début du banc."""
    if not REGISTRE.exists():
        return 0.0
    return sum(json.loads(l)["usd"] for l in REGISTRE.read_text().splitlines()
               if l and json.loads(l)["fournisseur"] == fournisseur)


def mammouth():
    import os
    from openai import OpenAI
    return OpenAI(api_key=os.environ["MAMMOUTH_API_KEY"].strip(), base_url="https://api.mammouth.ai/v1",
                  max_retries=3, timeout=600)
