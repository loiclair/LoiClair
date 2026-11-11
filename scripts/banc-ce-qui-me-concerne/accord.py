# Étape 3 : accord du juge Claude avec la majorité Mammouth (rattachements affichés de
# v0) et avec les verdicts du calibrage humain. Sur le test, seuls les chiffres sont imprimés.
#   python3 accord.py [detail]
import json, sys
from pathlib import Path
from commun import RES, banc
import os
from mesure import verdicts_claude, verdicts_mammouth, verdicts_panel
verdicts_claude = verdicts_panel if os.environ.get('JUGE_PANEL') else verdicts_claude

el = banc()
for moitie in ("dev", "test"):
    cles = [c for c, e in el.items() if e["moitie"] == moitie]
    cl, ma = verdicts_claude("v0", cles), verdicts_mammouth("v0", cles)
    n = ok = 0
    ecarts = []
    for c in cles:
        if c not in cl or c not in ma:
            continue
        for p, (v, _, r) in ma[c]["profils"].items():
            if p in cl[c]["profils"]:
                n += 1
                ok += cl[c]["profils"][p][0] == v
                if cl[c]["profils"][p][0] != v:
                    ecarts.append((c, p, v, cl[c]["profils"][p][2]))
    print(f"{moitie} : accord {ok}/{n} ({ok / max(1, n):.0%})")
    if moitie == "dev" and len(sys.argv) > 1:
        for e in ecarts:
            print(f"   {e[0]} {e[1]} Mammouth={'oui' if e[2] else 'non'} ; Claude : {e[3][:200]}")

cas = {f"c{i:02d}": c for i, c in enumerate(json.loads((RES / "calibrage" / "cas.json").read_text()))}
cl = verdicts_claude("v0", list(el))
n = ok = 0
for f in (RES / "calibrage" / "reponses" / "verdicts").glob("*.json"):
    d = json.loads(f.read_text())
    d = d.get("data", d)
    c = cas[f.stem]
    v = cl.get(c["cle"], {}).get("profils", {}).get(c["profil"])
    if v:
        n += 1
        ok += v[0] == (d["verdict"] == "oui")
print(f"calibrage humain : accord {ok}/{n}")
