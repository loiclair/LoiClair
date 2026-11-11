# Biais d'un juge pour son propre modèle : justesse du test selon chaque juge du panel
# pris seul, pour les classements de Haiku (v7) et de Luna (luna_v7). D'où `biaisJuge`.
#   python3 par_juge.py
import mesure

cles = [c for c, e in mesure.banc().items() if e["moitie"] == "test"]
for v in ("v7", "luna_v7"):
    for j in mesure.PANEL:
        ver = mesure.verdicts_panel(v, cles, juges=[j])
        aff = just = 0
        for c, x in ver.items():
            cl = mesure.lire(mesure.RES / "classements" / v / f"{mesure.nom(c)}.json")
            for i in cl["impacts"]:
                if i["certitude"] in mesure.AFFICHES and i["profil"] in x["profils"]:
                    aff += 1
                    just += x["profils"][i["profil"]][0]
        print(v, j[0], f"{just}/{aff} = {just / max(1, aff):.1%}")
