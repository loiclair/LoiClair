"""
controle.py : contrôle du prompt des titres anglais sur 50 titres jamais vus pendant le
réglage, au réglage de réflexion du prompt puis à un autre, pour les comparer.

Les 50 titres sont tirés au hasard parmi ceux qui ne sont ni dans `echantillon.json`
(les 30 du banc) ni parmi les 40 du premier contrôle (même liste, graine 7). Traduits
par le code de production (`traduire_groupe`), en groupes de 40 comme une nuit
ordinaire. N'écrit rien en base : tout reste dans resultats/.

Lancer depuis la racine du dépôt :
  python3 -P scripts/banc-titres-en/controle.py            # réflexion du prompt, puis « low »
  python3 -P scripts/banc-titres-en/controle.py medium     # réflexion du prompt, puis « medium »
"""

import json
import random
import sys
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent
RES = DOSSIER / "resultats"
sys.path.insert(0, str(DOSSIER.parent.parent / "pipeline"))
import traduire_titres as tt  # noqa: E402  (charge .env.local, le client et le prompt)
from _db import connexion  # noqa: E402


def tirer():
    banc = {d["uid"] for d in json.loads((RES / "echantillon.json").read_text(encoding="utf-8"))}
    with connexion() as c, c.cursor() as cur:
        cur.execute("SELECT uid, titre, procedure_libelle FROM dossiers_legislatifs WHERE titre <> '' ORDER BY uid")
        tous = [{"uid": u, "titre": t, "procedure": p or ""} for u, t, p in cur.fetchall()]
    premier = [d for d in tous if d["uid"] not in banc]
    random.Random(7).shuffle(premier)
    vus = banc | {d["uid"] for d in premier[:40]}
    candidats = [d for d in tous if d["uid"] not in vus]
    random.Random(50).shuffle(candidats)
    return candidats[:50]


def traduire(titres, effort):
    tt.EFFORT = effort
    rendus, total = {}, 0.0
    for i in range(0, len(titres), tt.PAR_REQUETE):
        r, prix = tt.traduire_groupe(titres[i:i + tt.PAR_REQUETE])
        rendus.update(r)
        total += prix
    return rendus, total


if __name__ == "__main__":
    autre = sys.argv[1] if len(sys.argv) > 1 else "low"
    titres = tirer()
    effort_prompt = tt.EFFORT
    a, cout_a = traduire(titres, effort_prompt)
    b, cout_b = traduire(titres, autre)
    (RES / f"controle-{tt.PROMPT_VERSION}.json").write_text(json.dumps({
        "prompt": tt.PROMPT_VERSION, "titres": titres,
        effort_prompt: {"cout": cout_a, "traductions": a}, autre: {"cout": cout_b, "traductions": b},
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    for i, d in enumerate(titres, 1):
        print(f"{i} FR {' '.join(d['titre'].split())}")
        print(f"  {effort_prompt:<6} {a.get(d['uid'])}")
        if b.get(d["uid"]) != a.get(d["uid"]):
            print(f"  {autre:<6} {b.get(d['uid'])}")
    print(f"{effort_prompt} : {len(a)}/50, {cout_a:.4f} $ ; {autre} : {len(b)}/50, {cout_b:.4f} $")
