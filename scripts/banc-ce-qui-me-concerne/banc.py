# Étape 1 : banc de 150 éléments. Les 71 de la revue du 2026-10-17 (déjà jugés par les
# 3 juges Mammouth) vont en développement ; 79 nouveaux sont tirés, 29 complètent le
# développement (profils manquants, profils faibles, projets, amendements) et 50 forment
# le test caché. Classements de la version en production lus en base, lecture seule.
#   python3 -P banc.py
import random
from collections import Counter
from commun import ca, BANC, REVUE, AFFICHES, THEME, ecrire, lire
from _db import connexion

FAIBLES_THEMES = {"couple", "commune", "nationalite", "argent"}
FAIBLES_PROFILS = {"mineur", "jeune", "senior"}


def faible(p):
    return THEME[p] in FAIBLES_THEMES or p in FAIBLES_PROFILS


random.seed(20261018)
with connexion() as c, c.cursor() as cur:
    tous = {(e["type"], e["id"]): e for e in ca.charger_elements(cur)}
    cur.execute("SELECT element_type, element_id, impacts, resume_fr FROM impacts WHERE prompt_version = %s AND modele = %s",
                (ca.PROMPT_VERSION, ca.MODELE))
    classes = {(t, i): {"impacts": imp, "resume_fr": res} for t, i, imp, res in cur.fetchall()}
    cur.execute("SELECT uid, procedure_libelle FROM dossiers_legislatifs")
    procedure = dict(cur.fetchall())

    def famille(k):
        if k[0] == "amendement":
            return "amendement"
        return "proposition" if "proposition" in (procedure.get(tous[k]["dossier"]) or "").lower() else "projet"

    def affiches(k):
        return [i["profil"] for i in classes[k]["impacts"] if i["certitude"] in AFFICHES]

    anciens = [tuple(k) for k in lire(REVUE / "echantillon.json")]
    candidats = sorted(k for k in classes if k in tous and tous[k]["nb_requetes"] == 1 and k not in anciens)
    avec = [k for k in candidats if affiches(k)]
    sans = [k for k in candidats if not affiches(k)]
    pris = set()

    def piocher(liste, n):
        dispo = [k for k in liste if k not in pris]
        tir = random.sample(dispo, min(n, len(dispo)))
        pris.update(tir)
        return tir

    # Développement : d'abord les profils jamais proposés dans les 71, puis profils
    # faibles et familles sous-représentées (la revue était surtout des propositions).
    dev = []
    couverts = {p for k in anciens for p in affiches(k)}
    for p in ca.PROFILS:
        if p in couverts:
            continue
        cands = [k for k in avec if k not in pris and p in affiches(k)]
        # Profil jamais affiché nulle part (travailleur_frontalier au 2026-10-17 : 4
        # rattachements, tous « possible ») : un élément où il est au moins envisagé.
        cands = cands or [k for k in candidats if k not in pris and any(i["profil"] == p for i in classes[k]["impacts"])]
        if cands:
            k = random.choice(cands)
            pris.add(k)
            dev.append(k)
            couverts |= set(affiches(k))
    restant = 29 - len(dev)
    for fam, part in (("projet", 0.5), ("amendement", 0.5)):
        n = round(restant * part)
        cands = [k for k in avec if famille(k) == fam and any(faible(p) for p in affiches(k))]
        dev += piocher(cands, n // 2)
        dev += piocher([k for k in avec if famille(k) == fam], n - n // 2)
    dev += piocher([k for k in avec if famille(k) != "proposition"], 29 - len(dev))

    # Test : 12 sans profil, 38 avec, un tiers par famille, la moitié porteurs d'un
    # profil faible.
    test = piocher(sans, 12)
    for fam in ("proposition", "projet", "amendement"):
        n = 13 if fam != "amendement" else 12
        faibles = [k for k in avec if famille(k) == fam and any(faible(p) for p in affiches(k))]
        test += piocher(faibles, n // 2)
        test += piocher([k for k in avec if famille(k) == fam], n - n // 2)

    choisis = [(k, "dev") for k in anciens + dev] + [(k, "test") for k in test]
    ca.completer(cur, [tous[k] for k, _ in choisis])

sortie = {}
for k, moitie in choisis:
    e = tous[k]
    ancien = f"{k[0][0]}-{k[1]}".replace("/", "_") if k in anciens else None
    sortie[f"{k[0]}|{k[1]}"] = {
        "type": k[0], "id": k[1], "dossier": e["dossier"], "famille": famille(k), "moitie": moitie,
        "user": e["requetes"][0], "sources": e["sources"], "ancien": ancien, "actuel": classes[k]}
ecrire(BANC / "elements.json", sortie)

# Contrôles de l'étape 1.
dev_c = [c for c, e in sortie.items() if e["moitie"] == "dev"]
test_c = [c for c, e in sortie.items() if e["moitie"] == "test"]
aff = {c: [i["profil"] for i in e["actuel"]["impacts"] if i["certitude"] in AFFICHES] for c, e in sortie.items()}
print(f"{len(sortie)} clés uniques : dev {len(dev_c)}, test {len(test_c)}")
cov = {p for c in dev_c for p in aff[c]}
print(f"profils couverts en dev : {len(cov)}/{len(ca.PROFILS)} ; manquants : {sorted(set(ca.PROFILS) - cov)}")
print(f"sans profil : dev {sum(not aff[c] for c in dev_c)}, test {sum(not aff[c] for c in test_c)}")
for nomm, cles in (("dev", dev_c), ("test", test_c)):
    print(nomm, Counter(sortie[c]["famille"] for c in cles), "propositions affichées :", sum(len(aff[c]) for c in cles),
          "dont profils faibles :", sum(faible(p) for c in cles for p in aff[c]))
