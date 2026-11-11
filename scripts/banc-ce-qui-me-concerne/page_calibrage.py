# Étape 2 : construit la page de calibrage (calibrage/page.html) à partir des cas
# divisés. Les cas sont regroupés par élément (un texte lu une fois) et ordonnés pour
# couvrir le plus de familles de profils dès les premiers.
import json
from commun import RES, RACINE, THEME, lire

cas = lire(RES / "calibrage" / "cas.json")
msgs = json.loads((RACINE / "src/messages/fr.json").read_text(encoding="utf-8"))["ceQuiMeConcerne"]
LIB = msgs["profils"]
DEF = msgs["definitions"]

par_el = {}
for i, c in enumerate(cas):
    c["id"] = f"c{i:02d}"
    par_el.setdefault(c["cle"], []).append(c)
# Ordre glouton : d'abord l'élément qui apporte le plus de familles nouvelles.
restants, ordre, vus = dict(par_el), [], set()
while restants:
    cle = max(restants, key=lambda k: (len({THEME[c["profil"]] for c in restants[k]} - vus), -len(restants[k][0]["user"])))
    vus |= {THEME[c["profil"]] for c in restants[cle]}
    ordre.append(restants.pop(cle))

AVIS = ["deepseek-v4-pro", "gemini-3.8-flash", "mistral-medium-3-5"]
donnees = []
for groupe in ordre:
    u = groupe[0]["user"]
    entete, _, texte = u.partition("\n\n--- Texte ---\n")
    lignes = dict(l.split(" : ", 1) for l in entete.split("\n") if " : " in l)
    donnees.append({
        "dossier": lignes.get("Dossier", ""), "etape": lignes.get("Étape du texte", ""), "element": lignes.get("Élément", ""),
        "texte": texte.strip(),
        "cas": [{"id": c["id"], "profil": c["profil"], "libelle": LIB.get(c["profil"], c["profil"]),
                 "definition": DEF.get(c["profil"], ""), "certitude": c["certitude"], "phrase": c["phrase"],
                 "passage": c["passage"],
                 "avis": [{"oui": c["avis"][j]["concerne"], "raison": c["avis"][j]["raison"]} for j in AVIS if j in c["avis"]]}
                for c in groupe]})

gabarit = (RES / "calibrage" / "gabarit.html").read_text(encoding="utf-8")
(RES / "calibrage" / "page.html").write_text(
    gabarit.replace("/*DONNEES*/", json.dumps(donnees, ensure_ascii=False).replace("</", "<\\/")), encoding="utf-8")
print(len(donnees), "éléments,", sum(len(d["cas"]) for d in donnees), "cas ;",
      "cas dans les 18 premiers éléments :", sum(len(d["cas"]) for d in donnees[:18]))
