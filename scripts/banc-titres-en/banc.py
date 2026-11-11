"""
banc.py : banc d'essai de la traduction des titres de dossiers (`src/lib/prompts/titres-en.json`).

Tire 30 titres, les traduit avec le code de production (`traduire_groupe` de
`pipeline/traduire_titres.py`, même prompt, même schéma, même modèle) et produit une
page de relecture côte à côte FR / EN. N'écrit rien en base : tout reste dans resultats/.

Étapes, chacune reprise là où elle s'est arrêtée (fichiers JSON en cache) :
  1. tirage de l'échantillon                    -> resultats/echantillon.json
  2. traduction, une requête comme en prod      -> resultats/traductions-<version du prompt>.json
  3. page de relecture                          -> resultats/relecture-<version du prompt>.html

Un prompt retouché change sa version : l'étape 2 repart, l'échantillon reste le même,
ce qui permet de comparer deux versions sur les mêmes titres.

Lancer depuis la racine du dépôt :
  python3 -P scripts/banc-titres-en/banc.py
"""

import html
import json
import random
import re
import sys
import time
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent
RES = DOSSIER / "resultats"
sys.path.insert(0, str(DOSSIER.parent.parent / "pipeline"))
import traduire_titres as tt  # noqa: E402  (charge .env.local, le client et le prompt)
from _db import connexion  # noqa: E402

# ── 1. Échantillon ────────────────────────────────────────────────────────────
# Tirage par procédure, sur le modèle de `scripts/banc-fiches-courtes/banc.py:choisir()` :
# graine fixe, uids triés puis mélangés, pour que le même échantillon ressorte.
STRATES = [
    ("Proposition de loi ordinaire", 5),
    ("Rapport d'information sans mission", 2),
    ("Résolution", 2),
    ("Résolution Article 34-1", 2),
    ("Projet ou proposition de loi constitutionnelle", 1),
    ("Projet de loi ordinaire", 2),
    ("Projet ou proposition de loi organique", 1),
    ("Projet de ratification des traités et conventions", 1),
    ("Commission d'enquête", 1),
    ("Mission d'information", 1),
    ("Engagement de la responsabilité gouvernementale", 1),
    ("Projet de loi de finances de l'année", 1),
    ("Projet de loi de financement de la sécurité sociale", 1),
    ("Projet de loi de finances rectificative", 1),
]
# Cas durs, tirés en plus des strates : (étiquette, motif sur le titre, nombre).
CAS_DURS = [
    ("minuscule initiale", r"^[a-zà-ÿ]", 2),
    ("sigle", r"\b[A-Z]{3,}\b", 2),
    ("outre-mer", r"outre-mer|Calédonie|Polynésie|Mayotte|Guyane|Réunion|Wallis", 2),
    ("référence de loi", r"loi n°", 1),
]


def choisir(graine=20261020):
    fichier = RES / "echantillon.json"
    if fichier.exists():
        return json.loads(fichier.read_text(encoding="utf-8"))
    with connexion() as conn, conn.cursor() as cur:
        cur.execute("SELECT uid, titre, procedure_libelle FROM dossiers_legislatifs "
                    "WHERE titre IS NOT NULL AND titre <> '' ORDER BY uid")
        dossiers = [{"uid": u, "titre": t, "procedure": p or ""} for u, t, p in cur.fetchall()]
    rng = random.Random(graine)
    rng.shuffle(dossiers)
    choix, pris = [], set()

    def prendre(d, cas):
        choix.append({**d, "cas": cas})
        pris.add(d["uid"])

    # Le titre le plus long, une convention fiscale de 543 caractères.
    prendre(max(dossiers, key=lambda d: (len(d["titre"]), d["uid"])), "titre très long")
    for etiquette, motif, n in CAS_DURS:
        for d in [d for d in dossiers if d["uid"] not in pris and re.search(motif, d["titre"])][:n]:
            prendre(d, etiquette)
    for proc, n in STRATES:
        for d in [d for d in dossiers if d["uid"] not in pris and d["procedure"] == proc][:n]:
            prendre(d, "")
    RES.mkdir(parents=True, exist_ok=True)
    fichier.write_text(json.dumps(choix, ensure_ascii=False, indent=1), encoding="utf-8")
    return choix


# ── 2. Traduction ─────────────────────────────────────────────────────────────

REGISTRE = RES / "depenses.jsonl"


def depenser(poste, usd):
    """Inscrit une dépense au registre, comme `scripts/banc-ce-qui-me-concerne/commun.py`."""
    with open(REGISTRE, "a", encoding="utf-8") as f:
        f.write(json.dumps({"t": time.time(), "poste": poste, "usd": usd}) + "\n")


def traduire(choix):
    fichier = RES / f"traductions-{tt.PROMPT_VERSION}.json"
    if fichier.exists():
        return json.loads(fichier.read_text(encoding="utf-8"))
    # Les 30 titres tiennent en une requête de 40, comme une nuit ordinaire.
    t0 = time.time()
    rendus, prix = tt.traduire_groupe(choix)
    res = {"prompt": tt.PROMPT_VERSION, "modele": tt.MODELE, "duree": round(time.time() - t0, 1),
           "cout": prix, "traductions": rendus}
    depenser(f"traduction {tt.PROMPT_VERSION}", prix)
    fichier.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    return res


# ── 3. Page de relecture ──────────────────────────────────────────────────────

def page(choix, res):
    e = html.escape
    lignes = []
    for i, d in enumerate(choix, 1):
        en = res["traductions"].get(d["uid"])
        cas = f'<span class="cas">{e(d["cas"])}</span>' if d["cas"] else ""
        lignes.append(
            f'<tr><td class="n">{i}</td>'
            f'<td><div class="meta">{e(d["procedure"])} · <code>{e(d["uid"])}</code> {cas}</div>{e(d["titre"])}</td>'
            f'<td>{e(en) if en else "<em class=manque>absent de la réponse</em>"}</td></tr>')
    fichier = RES / f"relecture-{res['prompt']}.html"
    fichier.write_text(f"""<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Titres anglais : relecture</title>
<style>
:root {{ --fond:#fff; --texte:#1a1a1a; --doux:#666; --ligne:#e5e5e5; --accent:#1d4ed8; }}
@media (prefers-color-scheme: dark) {{ :root {{ --fond:#141414; --texte:#eee; --doux:#999; --ligne:#2a2a2a; --accent:#93b4ff; }} }}
body {{ font: 15px/1.5 system-ui, sans-serif; background:var(--fond); color:var(--texte); margin:0; padding:24px 16px; }}
main {{ max-width: 1200px; margin: 0 auto; }}
h1 {{ font-size: 20px; margin: 0 0 4px; }} p.sous {{ color:var(--doux); margin:0 0 20px; font-size:13px; }}
table {{ border-collapse: collapse; width: 100%; }}
th, td {{ text-align:left; vertical-align:top; padding:10px 8px; border-bottom:1px solid var(--ligne); }}
th {{ font-size:12px; color:var(--doux); font-weight:600; }}
td.n {{ color:var(--doux); width:24px; }} .meta {{ font-size:12px; color:var(--doux); margin-bottom:2px; }}
.cas {{ color:var(--accent); }} .manque {{ color:#c00; }} code {{ font-size:11px; }}
@media (max-width: 700px) {{ td, th {{ display:block; border:0; padding:4px 0; }} tr {{ display:block; border-bottom:1px solid var(--ligne); padding:8px 0; }} th {{ display:none; }} td.n {{ display:none; }} }}
</style></head><body><main>
<h1>Titres de dossiers en anglais</h1>
<p class="sous">{len(choix)} titres · {e(res['modele'])} · prompt {e(res['prompt'])} · {res['cout']:.4f} $ · {res['duree']} s</p>
<table><thead><tr><th></th><th>Titre officiel</th><th>Traduction</th></tr></thead><tbody>
{''.join(lignes)}
</tbody></table></main></body></html>""", encoding="utf-8")
    return fichier


if __name__ == "__main__":
    choix = choisir()
    print(f"{len(choix)} titres tirés")
    res = traduire(choix)
    manquants = [d["uid"] for d in choix if d["uid"] not in res["traductions"]]
    print(f"{len(res['traductions'])} traduits, {len(manquants)} absents, coût {res['cout']:.4f} $, {res['duree']} s")
    print(page(choix, res))
