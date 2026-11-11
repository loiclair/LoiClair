"""
juge.py : notation à l'aveugle de deux jeux de fiches par des juges d'une
troisième famille (ni OpenAI comme Luna, ni Anthropic comme Haiku), via Mammouth.

  python3 -P scripts/banc-fiches-courtes/juge.py resultats/dossiers-frais.json \
      resultats/fiches-frais-luna-v10.json luna-v10 resultats/fiches-frais-haiku-v10.json haiku-v10 \
      resultats/juge-final.json [--opus]

Chemins relatifs au dossier du banc.

Les fiches sont indexées par uid, ou par « uid|modèle » (fiches-reglage-v1.json :
le nom sert alors de suffixe). L'ordre des deux fiches est tiré au hasard pour
chaque dossier et chaque juge, pour neutraliser la préférence de position.
Dépense lue dans l'en-tête de facture de Mammouth, arrêt au-delà de PLAFOND.
"""

import json
import random
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent
ICI = DOSSIER / "resultats"
sys.path.insert(0, str(DOSSIER.parent.parent / "pipeline"))
import generate_search_summaries as g  # noqa: E402,F401  (charge .env.local)
import os  # noqa: E402

# Client Mammouth (Luna et le juge) : le script de prod n'appelle plus que l'API
# Anthropic, le banc garde donc le sien.
from openai import OpenAI  # noqa: E402
mammouth = OpenAI(api_key=os.environ["MAMMOUTH_API_KEY"].strip(), base_url="https://api.mammouth.ai/v1")

# Grok retiré le 2026-10-15 : 5 centimes par jugement, budget Mammouth du banc limité à 1 $.
JUGES = ["mistral-large-4"]
# --opus : juge Claude Opus 5.5 sur la clé Anthropic (crédits, pas Mammouth). Réservé
# aux duels Haiku contre Haiku : un juge ne note pas une autre famille contre la sienne.
OPUS = "--opus" in sys.argv
if OPUS:
    import anthropic
    claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY_DOSSIER_SUMMARIES"].strip())
    JUGES = ["claude-opus-5-5"]
# Plafond de TOUTE la dépense Mammouth du banc (juges + appels à Luna), relue
# dans les fichiers de résultats à chaque lancement : on s'arrête avant 1 $.
PLAFOND = 0.95


def deja_depense():
    total = 0.0
    for f in ICI.glob("juge-*.json"):
        total += sum(v.get("cout") or 0 for v in json.loads(f.read_text(encoding="utf-8")).values())
    for f in [ICI / "fiches-reglage-v1.json", *ICI.glob("fiches-*-luna*.json")]:
        total += sum(v.get("cout") or 0 for k, v in json.loads(f.read_text(encoding="utf-8")).items()
                     if f.name != "fiches-reglage-v1.json" or k.endswith("gpt-6-luna"))
    return total


THEMES = json.loads((DOSSIER / "prompts" / "v1.json").read_text(encoding="utf-8"))["schema"]["properties"]["themes"]["items"]["enum"]

GRILLE = """Tu es correcteur pour LoiClair, un site citoyen gratuit qui explique les textes législatifs français à des lecteurs sans formation juridique. Tu compares à l'aveugle deux fiches courtes, X et Y, écrites pour le même dossier à partir du même texte source.

Une fiche a deux parties : un résumé de 80 à 120 mots, lu tel quel dans une newsletter et indexé par la recherche du site, et 1 à 3 thèmes pris dans une liste fermée, du plus central au plus secondaire.

Règles maison (respectées, elles ne se pénalisent jamais) :
- Les mesures d'un texte non promulgué s'écrivent au conditionnel ; les constats et objectifs sont attribués à ses auteurs.
- Une résolution, un rapport ou un avis précise qu'il ne change aucune règle.
- Aucun nom d'auteur.
- La longueur est vérifiée par un programme à part : ne la note pas.

Note chaque fiche de 1 à 10 sur chaque critère, en utilisant toute l'échelle :
- exactitude : tout ce qui est affirmé est vrai selon le texte source (10 : aucune erreur ; 5 : une erreur réelle ; 2 : contresens).
- completude : les mesures qui comptent le plus pour un citoyen sont là, bien hiérarchisées.
- neutralite : aucun jugement, aucun effet espéré présenté comme certain, avis des auteurs attribués.
- clarte : un citoyen sans formation juridique comprend du premier coup.
- themes : les thèmes choisis sont les plus justes de la liste, sans thème de trop ni oubli important.

Relève chaque erreur factuelle (citation exacte, gravité "grave" ou "mineure"). Puis dis quelle fiche tu publierais : "X", "Y" ou "egal".

Liste des thèmes : """ + " ; ".join(THEMES)

NOTE = {"type": "object", "additionalProperties": False,
        "required": ["exactitude", "completude", "neutralite", "clarte", "themes"],
        "properties": {k: {"type": "integer"} for k in ["exactitude", "completude", "neutralite", "clarte", "themes"]}}
SCHEMA = {
    "type": "object", "additionalProperties": False,
    "required": ["X", "Y", "erreurs", "preference", "raison"],
    "properties": {
        "X": NOTE, "Y": NOTE,
        "erreurs": {"type": "array", "items": {
            "type": "object", "additionalProperties": False, "required": ["fiche", "citation", "gravite"],
            "properties": {"fiche": {"type": "string", "enum": ["X", "Y"]}, "citation": {"type": "string"},
                           "gravite": {"type": "string", "enum": ["grave", "mineure"]}}}},
        "preference": {"type": "string", "enum": ["X", "Y", "egal"]},
        "raison": {"type": "string"},
    },
}


def fiche(res, uid, nom):
    r = res.get(uid) or res.get(f"{uid}|{nom}") or {}
    return r.get("data") or {}


def texte_fiche(f):
    return f"Thèmes : {', '.join(f.get('themes') or []) or '(aucun)'}\nRésumé : {f.get('resume') or '(vide)'}"


def demander(juge, user):
    """Un jugement : rend (données JSON, coût Mammouth en dollars)."""
    if OPUS:
        r = claude.messages.create(
            model="claude-opus-5-5", max_tokens=8000, system=GRILLE,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
        )
        if r.stop_reason in ("max_tokens", "refusal"):
            raise RuntimeError(f"stop_reason {r.stop_reason}")
        return json.loads(next(b.text for b in r.content if b.type == "text")), 0.0  # crédits Anthropic
    raw = mammouth.with_options(timeout=300, max_retries=1).chat.completions.with_raw_response.create(
        model=juge, temperature=0,
        messages=[{"role": "system", "content": GRILLE}, {"role": "user", "content": user}],
        response_format={"type": "json_schema", "json_schema": {"name": "jugement", "strict": True, "schema": SCHEMA}},
    )
    return json.loads(raw.parse().choices[0].message.content), float(raw.headers.get("x-litellm-response-cost") or 0)


def main():
    ds_f, r1_f, n1, r2_f, n2, sortie = sys.argv[1:7]
    ds_f, r1_f, r2_f, sortie = (DOSSIER / x for x in (ds_f, r1_f, r2_f, sortie))
    dossiers = json.loads(Path(ds_f).read_text(encoding="utf-8"))
    r1 = json.loads(Path(r1_f).read_text(encoding="utf-8"))
    r2 = json.loads(Path(r2_f).read_text(encoding="utf-8"))
    out = json.loads(Path(sortie).read_text(encoding="utf-8")) if Path(sortie).exists() else {}
    verrou = threading.Lock()
    depense = [deja_depense()]
    print(f"Déjà dépensé chez Mammouth pour ce banc : {depense[0]:.3f} $")
    rng = random.Random(42)
    taches = []
    for d in dossiers:
        f1, f2 = fiche(r1, d["uid"], n1), fiche(r2, d["uid"], n2)
        if not d["contenu"] or not (f1.get("resume") or f2.get("resume")):
            continue
        for juge in JUGES:
            inverse = rng.random() < 0.5  # tiré même si déjà jugé : ordre stable d'un run à l'autre
            cle = f"{d['uid']}|{juge}"
            if cle not in out or "exception" in out[cle]:
                taches.append((d, juge, inverse, f1, f2))

    def juger(t):
        d, juge, inverse, f1, f2 = t
        cle = f"{d['uid']}|{juge}"
        if depense[0] > PLAFOND:
            return
        fx, fy = (f2, f1) if inverse else (f1, f2)
        user = (f"Dossier : {d['titre']}\nType de procédure : {d.get('procedure_libelle')}\n\n"
                f"Texte source (extrait) :\n{d['contenu']}\n\n--- Fiche X ---\n{texte_fiche(fx)}\n\n--- Fiche Y ---\n{texte_fiche(fy)}")
        try:
            data, cout = demander(juge, user)
            # Remet X / Y dans les noms des candidats.
            nx, ny = (n2, n1) if inverse else (n1, n2)
            carte = {"X": nx, "Y": ny, "egal": "egal"}
            r = {
                "notes": {nx: data["X"], ny: data["Y"]},
                "erreurs": [{**e, "fiche": carte[e["fiche"]]} for e in data["erreurs"]],
                "preference": carte[data["preference"]], "raison": data["raison"], "cout": cout,
            }
        except Exception as e:
            r, cout = {"exception": f"{type(e).__name__}: {e}"}, 0.0
        with verrou:
            out[cle] = r
            depense[0] += cout
            print(f"  {d['uid']:<16} {juge:<16} {r.get('preference') or r.get('exception', '')[:150]}", flush=True)
            Path(sortie).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    with ThreadPoolExecutor(max_workers=3 if OPUS else 8) as pool:
        list(pool.map(juger, taches))
    if depense[0] > PLAFOND:
        print(f"Plafond de {PLAFOND} $ atteint : jugements incomplets")
    resume(out, n1, n2)
    print(f"Dépense Mammouth totale du banc : {depense[0]:.3f} $")


def resume(out, n1, n2):
    ok = [v for v in out.values() if "exception" not in v]
    for juge in JUGES:
        vs = [out[k] for k in out if k.endswith(juge) and "exception" not in out[k]]
        if not vs:
            continue
        pref = {n: sum(v["preference"] == n for v in vs) for n in (n1, n2, "egal")}
        print(f"\n{juge} ({len(vs)} dossiers) préférences : {pref}")
        for n in (n1, n2):
            moy = {c: sum(v["notes"][n][c] for v in vs) / len(vs) for c in NOTE["required"]}
            graves = sum(1 for v in vs for e in v["erreurs"] if e["fiche"] == n and e["gravite"] == "grave")
            mineures = sum(1 for v in vs for e in v["erreurs"] if e["fiche"] == n and e["gravite"] == "mineure")
            print(f"   {n:<12} " + " ".join(f"{c} {m:.1f}" for c, m in moy.items()) + f" | erreurs graves {graves}, mineures {mineures}")
    print(f"\nTotal : {len(ok)} jugements")


if __name__ == "__main__":
    main()
