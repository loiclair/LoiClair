"""
banc.py : banc d'essai du nouveau prompt « fiche courte + thèmes » :
Claude Haiku 5.5 (API Anthropic) contre gpt-6-luna (Mammouth), mêmes consignes,
même texte source. N'écrit rien en base : tout reste dans resultats/.

Étapes, chacune reprise là où elle s'est arrêtée (fichiers JSON en cache) :
  1. choix de 20 dossiers variés et lecture de leur texte source -> dossiers-reglage.json
  2. appel des deux modèles (consignes v1)                         -> fiches-reglage-v1.json
  3. page HTML côte à côte, modèles masqués en A / B               -> banc.html

Lancer depuis la racine du dépôt (SDK anthropic 1.15.0, voir le README) :
  python3 -P scripts/banc-fiches-courtes/banc.py
"""

import html
import json
import random
import sys
import time
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent
ICI = DOSSIER / "resultats"
sys.path.insert(0, str(DOSSIER.parent.parent / "pipeline"))
import generate_search_summaries as g  # noqa: E402  (charge .env.local ; base lue par `_db`)

import anthropic  # noqa: E402
import os  # noqa: E402

# Client Mammouth (Luna et le juge) : le script de prod n'appelle plus que l'API
# Anthropic, le banc garde donc le sien.
from openai import OpenAI  # noqa: E402
mammouth = OpenAI(api_key=os.environ["MAMMOUTH_API_KEY"].strip(), base_url="https://api.mammouth.ai/v1")

PROMPT = json.loads((DOSSIER / "prompts" / "v1.json").read_text(encoding="utf-8"))
SYSTEM = PROMPT["system"]
SCHEMA = PROMPT["schema"]
THEMES = set(SCHEMA["properties"]["themes"]["items"]["enum"])
MAX_IN = PROMPT["maxInputChars"]

HAIKU = "claude-haiku-5-5"
LUNA = "gpt-6-luna"
# Tarif public Haiku 5.5 pour un prompt de moins de 100 000 jetons ($ par jeton).
HAIKU_IN, HAIKU_OUT = 0.10 / 1e6, 0.50 / 1e6

# L'API Claude refuse `maxItems` (400 « property 'maxItems' is not supported ») :
# Haiku reçoit le schéma sans plafond, et `valider` refuse plus de trois thèmes.
SCHEMA_HAIKU = json.loads(json.dumps(SCHEMA))
del SCHEMA_HAIKU["properties"]["themes"]["maxItems"]

claude = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY_DOSSIER_SUMMARIES"].strip())

# ── 1. Échantillon ────────────────────────────────────────────────────────────
# (procédure, préfixe d'uid, a déjà des thèmes, nombre voulu). « sans_texte »
# teste la branche titre seul.
STRATES = [
    ("Proposition de loi ordinaire", "DLR5", True, 2),
    ("Proposition de loi ordinaire", "DLR5", False, 3),
    ("Rapport d'information sans mission", "DSNR", True, 1),
    ("Rapport d'information sans mission", "DSNR", False, 1),
    ("Résolution", "DLR5", True, 1),
    ("Résolution", "DLR5", False, 1),
    ("Rapport d'information sans mission", "DLR5", True, 1),
    ("Rapport d'information sans mission", "DLR5", False, 1),
    ("Résolution Article 34-1", "DLR5", False, 1),
    ("Projet ou proposition de loi constitutionnelle", "DLR5", True, 1),
    ("Projet de loi ordinaire", "DLR5", True, 1),
    ("Projet de loi ordinaire", "DLR5", False, 1),
    ("Projet ou proposition de loi organique", "DLR5", True, 1),
    ("Projet de ratification des traités et conventions", "DLR5", True, 1),
    ("Projet de loi de finances de l'année", "DLR5", True, 1),
    ("Projet de loi de financement de la sécurité sociale", "DLR5", True, 1),
]


def choisir(fichier=ICI / "dossiers-reglage.json", graine=20261015, exclus=()):
    if fichier.exists():
        return json.loads(fichier.read_text(encoding="utf-8"))
    dossiers = g.fetch_dossiers()
    textes = g.fetch_all_textes()
    par_dossier = {}
    for t in textes:
        if t.get("dossier_ref"):
            par_dossier.setdefault(t["dossier_ref"], []).append(t)
    rng = random.Random(graine)
    dossiers = [d for d in dossiers if d["uid"] not in set(exclus)]
    dossiers.sort(key=lambda d: d["uid"])
    rng.shuffle(dossiers)
    choix = []
    for proc, prefixe, a_themes, n in STRATES:
        pris = 0
        for d in dossiers:
            if pris == n:
                break
            if (d.get("procedure_libelle") != proc or not d["uid"].startswith(prefixe)
                    or bool(d.get("themes")) != a_themes):
                continue
            viables = [t for t in par_dossier.get(d["uid"], []) if t.get("a_contenu") or t.get("url_accessible")]
            if not viables:
                continue
            viables.sort(key=g.text_priority_key)
            contenu = g.get_text_content(viables[0])
            if not contenu:
                continue
            choix.append({**d, "contenu": contenu[:MAX_IN], "texte_uid": viables[0]["uid"]})
            pris += 1
            print(f"  {d['uid']}  {len(contenu):>6} car.  {d['titre'][:70]}")
    # Un dossier sans aucun texte lisible : la branche « titre seul ».
    for d in dossiers:
        if not d.get("themes") and not d.get("search_summary") and not any(
                t.get("a_contenu") or t.get("url_accessible") for t in par_dossier.get(d["uid"], [])):
            choix.append({**d, "contenu": None, "texte_uid": None})
            print(f"  {d['uid']}  sans texte  {d['titre'][:70]}")
            break
    fichier.write_text(json.dumps(choix, ensure_ascii=False, indent=1), encoding="utf-8")
    return choix


# ── 2. Appels ─────────────────────────────────────────────────────────────────

def message_utilisateur(d):
    return PROMPT["userTemplate"].format(
        titre=d["titre"],
        procedure_libelle=d.get("procedure_libelle") or "",
        contenu_extrait=d["contenu"] or "(Aucun contenu disponible)",
    )


def valider(brut):
    """Rend (données, erreur). Refuse ce que la production refusera."""
    try:
        data = json.loads(brut)
    except Exception as e:
        return None, f"JSON illisible : {e}"
    themes = data.get("themes") or []
    hors = [t for t in themes if t not in THEMES]
    if hors:
        return data, f"thèmes hors liste : {hors}"
    if not themes:
        return data, "liste de thèmes vide"
    if len(themes) > 3:
        return data, f"{len(themes)} thèmes"
    return data, None


def appel_haiku(d):
    t0 = time.time()
    r = claude.messages.create(
        model=HAIKU,
        max_tokens=4000,
        system=SYSTEM,
        messages=[{"role": "user", "content": message_utilisateur(d)}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA_HAIKU}},
    )
    duree = time.time() - t0
    u = r.usage
    res = {"duree": duree, "jetons_in": u.input_tokens, "jetons_out": u.output_tokens,
           "cout": u.input_tokens * HAIKU_IN + u.output_tokens * HAIKU_OUT, "fin": r.stop_reason}
    if r.stop_reason in ("max_tokens", "refusal"):
        res["erreur"] = f"stop_reason {r.stop_reason}"
        return res
    brut = next((b.text for b in r.content if b.type == "text"), "")
    res["data"], err = valider(brut)
    if err:
        res["erreur"] = err
    return res


def appel_luna(d):
    t0 = time.time()
    raw = mammouth.chat.completions.with_raw_response.create(
        model=LUNA,
        messages=[{"role": "system", "content": SYSTEM},
                  {"role": "user", "content": message_utilisateur(d)}],
        max_tokens=PROMPT["maxOutputTokens"],
        temperature=PROMPT["temperature"],
        reasoning_effort=PROMPT["reasoningEffort"],
        response_format={"type": "json_schema",
                         "json_schema": {"name": "fiche_dossier", "strict": True, "schema": SCHEMA}},
    )
    duree = time.time() - t0
    r = raw.parse()
    u = r.usage
    cout = raw.headers.get("x-litellm-response-cost")
    res = {"duree": duree, "jetons_in": u.prompt_tokens, "jetons_out": u.completion_tokens,
           "cout": float(cout) if cout else None, "fin": r.choices[0].finish_reason}
    if res["fin"] in ("length", "content_filter"):
        res["erreur"] = f"finish_reason {res['fin']}"
        return res
    res["data"], err = valider(r.choices[0].message.content or "")
    if err:
        res["erreur"] = err
    return res


def appeler(dossiers):
    fichier = ICI / "fiches-reglage-v1.json"
    res = json.loads(fichier.read_text(encoding="utf-8")) if fichier.exists() else {}
    for d in dossiers:
        for nom, f in ((HAIKU, appel_haiku), (LUNA, appel_luna)):
            cle = f"{d['uid']}|{nom}"
            if cle in res and "exception" not in res[cle]:
                continue
            try:
                res[cle] = f(d)
            except Exception as e:
                res[cle] = {"exception": f"{type(e).__name__}: {e}"}
            r = res[cle]
            etat = r.get("exception") or r.get("erreur") or "ok"
            print(f"  {d['uid']}  {nom:<17} {r.get('duree', 0):5.1f}s  {etat[:120]}")
            fichier.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


# ── 3. Page ───────────────────────────────────────────────────────────────────

def mots(s):
    return len((s or "").split())


def bloc(r):
    if "exception" in r:
        return f'<p class="err">Échec : {html.escape(r["exception"])}</p>'
    out = ""
    if r.get("erreur"):
        out += f'<p class="err">Refusé par le code : {html.escape(r["erreur"])}</p>'
    data = r.get("data") or {}
    if data:
        th = " · ".join(html.escape(t) for t in data.get("themes") or [])
        out += f'<p class="themes">{th or "(aucun thème)"}</p>'
        resume = data.get("resume") or ""
        out += f'<p>{html.escape(resume) or "<em>(résumé vide)</em>"}</p><p class="meta">{mots(resume)} mots</p>'
    return out


def page(dossiers, res):
    rng = random.Random(7)
    a_est_haiku = rng.random() < 0.5
    A, B = (HAIKU, LUNA) if a_est_haiku else (LUNA, HAIKU)
    lignes = []
    for i, d in enumerate(dossiers, 1):
        ra, rb = res.get(f"{d['uid']}|{A}", {}), res.get(f"{d['uid']}|{B}", {})
        actuels = " · ".join(html.escape(t) for t in d.get("themes") or []) or "aucun"
        longueur = f"{len(d['contenu']):,} car.".replace(",", " ") if d["contenu"] else "aucun texte"
        lignes.append(f"""
<section>
  <h2>{i}. {html.escape(d['titre'])}</h2>
  <p class="meta">{html.escape(d.get('procedure_libelle') or '')} · {d['uid']} · texte source : {longueur}</p>
  <details><summary>Fiche actuelle (thèmes par mots-clés : {actuels})</summary>
    <p>{html.escape(d.get('search_summary') or '(aucune)')}</p></details>
  <div class="cols">
    <div><h3>A</h3>{bloc(ra)}</div>
    <div><h3>B</h3>{bloc(rb)}</div>
  </div>
</section>""")

    def stats(nom):
        rs = [res.get(f"{d['uid']}|{nom}", {}) for d in dossiers]
        ok = [r for r in rs if "exception" not in r and not r.get("erreur")]
        couts = [r["cout"] for r in rs if r.get("cout") is not None]
        n = max(len(couts), 1)
        return {
            "échecs": len(rs) - len(ok),
            "jetons entrée (moy.)": round(sum(r.get("jetons_in", 0) for r in rs) / len(rs)),
            "jetons sortie (moy.)": round(sum(r.get("jetons_out", 0) for r in rs) / len(rs)),
            "durée moyenne": f"{sum(r.get('duree', 0) for r in rs) / len(rs):.1f} s",
            "coût pour 1 000 dossiers": f"{sum(couts) / n * 1000:.2f} $" if couts else "inconnu",
            "mots du résumé (moy.)": round(sum(mots((r.get("data") or {}).get("resume")) for r in ok) / max(len(ok), 1)),
            "thèmes par dossier (moy.)": f"{sum(len((r.get('data') or {}).get('themes') or []) for r in ok) / max(len(ok), 1):.1f}",
        }

    sa, sb = stats(A), stats(B)
    meme_premier = sum(
        1 for d in dossiers
        if ((res.get(f"{d['uid']}|{A}", {}).get("data") or {}).get("themes") or [None])[0]
        == ((res.get(f"{d['uid']}|{B}", {}).get("data") or {}).get("themes") or [None])[0])
    jac = []
    for d in dossiers:
        ta = set((res.get(f"{d['uid']}|{A}", {}).get("data") or {}).get("themes") or [])
        tb = set((res.get(f"{d['uid']}|{B}", {}).get("data") or {}).get("themes") or [])
        if ta | tb:
            jac.append(len(ta & tb) / len(ta | tb))
    table = "".join(f"<tr><th>{k}</th><td>{sa[k]}</td><td>{sb[k]}</td></tr>" for k in sa)
    return f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Banc fiches courtes</title>
<style>
:root {{ --bg:#fff; --fg:#1a1a1a; --muted:#6b6b6b; --line:#e5e5e5; --accent:#2f5bd3; --err:#b3261e; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#141414; --fg:#ececec; --muted:#9a9a9a; --line:#2c2c2c; --accent:#8aa8ff; --err:#ff8a80; }} }}
body {{ background:var(--bg); color:var(--fg); font:16px/1.55 -apple-system, system-ui, sans-serif; margin:0 auto; max-width:1100px; padding:24px 16px 80px; }}
h1 {{ font-size:22px; margin:0 0 4px; }} h2 {{ font-size:17px; margin:0 0 2px; }} h3 {{ font-size:13px; color:var(--accent); margin:0 0 6px; letter-spacing:.05em; }}
section {{ border-top:1px solid var(--line); padding:20px 0; }}
.cols {{ display:grid; grid-template-columns:1fr 1fr; gap:28px; margin-top:12px; }}
@media (max-width:720px) {{ .cols {{ grid-template-columns:1fr; gap:12px; }} }}
.meta {{ color:var(--muted); font-size:13px; margin:2px 0; }}
.themes {{ font-size:13px; color:var(--accent); margin:0 0 6px; }}
.err {{ color:var(--err); font-size:14px; }}
details {{ color:var(--muted); font-size:14px; margin-top:6px; }} summary {{ cursor:pointer; }}
p {{ margin:0 0 6px; }}
table {{ border-collapse:collapse; margin:12px 0; font-size:14px; }} th, td {{ text-align:left; padding:4px 14px 4px 0; border-bottom:1px solid var(--line); }}
button {{ font:inherit; padding:6px 12px; border:1px solid var(--line); background:transparent; color:var(--fg); border-radius:6px; cursor:pointer; }}
#reveal {{ display:none; }}
</style></head><body>
<h1>Fiche courte et thèmes : A contre B</h1>
<p class="meta">{len(dossiers)} dossiers · mêmes consignes, même texte source · ouvre « Fiche actuelle » pour comparer à l'existant</p>
{''.join(lignes)}
<section>
  <h2>Chiffres et identité des modèles</h2>
  <p class="meta">Masqués pour ne pas orienter la lecture. Thèmes : même premier thème sur {meme_premier}/{len(dossiers)} dossiers, recouvrement moyen {sum(jac) / max(len(jac), 1):.0%}.</p>
  <button onclick="document.getElementById('reveal').style.display='block';this.remove()">Révéler</button>
  <div id="reveal">
    <table><tr><th></th><th>A : {A}</th><th>B : {B}</th></tr>{table}</table>
    <p class="meta">Coût Haiku calculé au tarif public (0,10 $ / 0,50 $ par million de jetons) ; coût Luna lu dans la facture Mammouth de chaque appel.</p>
  </div>
</section>
</body></html>"""


def main():
    print("1. Échantillon")
    dossiers = choisir()
    print(f"   {len(dossiers)} dossiers")
    print("2. Appels")
    res = appeler(dossiers)
    print("3. Page")
    (ICI / "banc.html").write_text(page(dossiers, res), encoding="utf-8")
    print(f"   {ICI / 'banc.html'}")


if __name__ == "__main__":
    main()
