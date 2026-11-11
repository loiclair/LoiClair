# Chiffres du test caché (3 juges Mammouth) pour la page /documentation/choix-modele-ia.
# Rappel robuste : on écarte un élément où la majorité liste plus de 8 oublis (texte
# qui vaut pour tout le monde, où « oublier » 70 profils n'a pas de sens).
import mesure
from commun import banc

el = banc()
cles = [c for c, e in el.items() if e["moitie"] == "test"]
for v in ("v0", "v7", "luna_v7"):
    r = mesure.mesurer(v, "test", "mammouth", None)
    ver = mesure.verdicts_mammouth(v, cles)
    ecartes = [c for c, x in ver.items() if len(x["oublis"]) > 8]
    oub = sum(1 for c, o in r["oublis_l"] if c not in ecartes)
    print(v, "éléments", r["elements"], "affichés", r["affiches"], "justes", r["justes"], f"{r['justesse']:.1%}",
          "fidèles", r["fideles"], f"{r['fidelite']:.1%}",
          "| certain", r["par"].get("certitude:certain"), "probable", r["par"].get("certitude:probable"),
          f"| rappel robuste {r['justes']}/{r['justes'] + oub} = {r['justes'] / (r['justes'] + oub):.1%} (écartés {ecartes})")
