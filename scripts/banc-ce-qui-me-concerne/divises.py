# Étape 2 : cas où les 3 juges Mammouth se sont divisés sur les 71 de la revue.
import json
from commun import RES, REVUE, JUGES_MAMMOUTH, banc, ecrire, AFFICHES
el = banc()
cas = []
for cle, e in el.items():
    if not e["ancien"]:
        continue
    jug = {j: json.loads((REVUE / j / f"{e['ancien']}.json").read_text())["jugement"] for j in JUGES_MAMMOUTH}
    props = json.loads((REVUE / "props.json").read_text())[e["ancien"]]["props"]
    for p in props:
        avis = {j: next((x for x in jug[j]["profils"] if x["profil"] == p["profil"]), None) for j in JUGES_MAMMOUTH}
        v = [a["concerne"] for a in avis.values() if a]
        if len(set(v)) > 1:
            cas.append({"cle": cle, "profil": p["profil"], "certitude": p["certitude"], "phrase": p["phrase"],
                        "passage": p["passage"], "user": e["user"],
                        "avis": {j: {"concerne": a["concerne"], "raison": a["raison"]} for j, a in avis.items() if a}})
print(len(cas), "cas divisés")
ecrire(RES / "calibrage" / "cas.json", cas)
