# Moyenne d'une version et de sa jumelle (_b) ; une ligne de plus dans versions.md.
import sys
from commun import RES
from mesure import mesurer
v, moitie = sys.argv[1], sys.argv[2]
paire = {"v0": "v0bis"}.get(v, f"{v}_b")
r = [mesurer(x, moitie, "panel", detail=None) for x in (v, paire)]
moy = {k: sum(x[k] for x in r) / 2 for k in ("justesse", "rappel", "fidelite")}
cert = [sum(x["par"].get(f"certitude:{c}", (0, 0))[i] for x in r) for c in ("certain", "probable") for i in (0, 1)]
ligne = (f"| {v} | {moitie} | {r[0]['justesse']:.1%} / {r[1]['justesse']:.1%} | **{moy['justesse']:.1%}** | "
         f"{cert[0] / max(1, cert[1]):.0%} | {cert[2] / max(1, cert[3]):.0%} | {moy['rappel']:.1%} | {moy['fidelite']:.1%} | "
         f"{(r[0]['affiches'] + r[1]['affiches']) / 2:.0f} |")
print(ligne)
f = RES / "versions.md"
if not f.exists():
    f.write_text("| version | moitié | justesse (2 passes) | moyenne | certain | probable | rappel | fidélité | affichés |\n"
                 "|---|---|---|---|---|---|---|---|---|\n", encoding="utf-8")
with open(f, "a", encoding="utf-8") as fh:
    fh.write(ligne + "\n")
