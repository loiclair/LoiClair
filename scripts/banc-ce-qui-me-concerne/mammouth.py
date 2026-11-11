# Juges Mammouth (deepseek, gemini, mistral) avec la consigne de juge du 2026-10-17
# figée (`SYSTEM`, qui embarque la consigne de classement de production
# 941d2b2a2425) : c'est elle qui a donné les 73 %, le chiffre final s'y compare.
#   python3 mammouth.py <version> <budget_usd> [moitie]
# Lit classements/<version>/<cle>.json, écrit jugements/mammouth/<version>/<juge>/<cle>.json.
import json, sys, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from commun import RES, JUGES_MAMMOUTH, ca, AFFICHES, banc, nom, barre, mammouth, lire, ecrire


# Consigne de juge de la revue du 2026-10-17, figée : elle embarque la consigne de
# classement de l'époque (941d2b2a2425), et c'est elle qui a donné les 73 %.
SYSTEM = (RES / "jugements" / "mammouth" / "consigne_2026-10-17.txt").read_text(encoding="utf-8")
SCHEMA = {
    "type": "object",
    "properties": {
        "profils": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "profil": {"type": "string", "enum": ca.PROFILS},
                "concerne": {"type": "boolean"},
                "phrase_fidele": {"type": "boolean"},
                "raison": {"type": "string"},
            },
            "required": ["profil", "concerne", "phrase_fidele", "raison"],
            "additionalProperties": False}},
        "oublis": {"type": "array", "items": {"type": "string", "enum": ca.PROFILS}},
    },
    "required": ["profils", "oublis"],
    "additionalProperties": False,
}


def message(e):
    if e["props"]:
        bloc = "Propositions de l'assistant :\n" + "".join(
            f"- {p['profil']} ({p['certitude']}) : {p['phrase']}\n  Passage cité : « {p['passage']} »\n" for p in e["props"])
    else:
        bloc = "L'assistant n'a proposé aucun profil.\n"
    profils = ", ".join(p["profil"] for p in e["props"]) or "aucun (dis seulement les oublis)"
    return e["user"] + "\n\n=== Propositions ===\n" + bloc + f"\nProfils à juger : {profils}"


def juger_un(client, juge, e):
    r = client.chat.completions.create(
        model=juge, max_tokens=8000,
        messages=[{"role": "system", "content": SYSTEM}, {"role": "user", "content": message(e)}],
        response_format={"type": "json_schema", "json_schema": {"name": "jugement", "strict": True, "schema": SCHEMA}},
    )
    ch = r.choices[0]
    if ch.finish_reason not in ("stop", None):
        raise RuntimeError(f"finish_reason={ch.finish_reason}")
    texte = ch.message.content.strip()
    if texte.startswith("```"):
        texte = texte.strip("`").split("\n", 1)[1].rsplit("```", 1)[0]
    return {"jugement": json.loads(texte), "cout_usd": (r.usage.model_extra or {}).get("cost")}


def propositions(e, classement):
    """Les profils affichés d'un classement, au format de la revue du 2026-10-17."""
    return [{"profil": i["profil"], "certitude": i["certitude"], "passage": i["passage"],
             "phrase": i.get("phrase_fr") or classement.get("resume_fr") or ""}
            for i in classement["impacts"] if i["certitude"] in AFFICHES]


def main(version, budget, moitie=None):
    el = banc()
    cles = [c for c, e in el.items() if moitie is None or e["moitie"] == moitie]
    client = mammouth()
    sortie = RES / "jugements" / "mammouth" / version
    depense = sum((lire(f).get("cout_usd") or 0) for f in sortie.glob("*/*.json"))
    taches = [(j, c) for c in cles for j in JUGES_MAMMOUTH if not (sortie / j / f"{nom(c)}.json").exists()]
    total, faits = len(cles) * len(JUGES_MAMMOUTH), len(cles) * len(JUGES_MAMMOUTH) - len(taches)
    barre("debut", f"mammouth-{version}", f"Juges Mammouth, {version}", total)
    barre("pas", f"mammouth-{version}", faits, total)
    verrou, arret = threading.Lock(), threading.Event()
    cout_max = 0.0

    def un(j, c):
        nonlocal depense, cout_max, faits
        with verrou:
            if arret.is_set() or depense + max(cout_max, 0.01) * 6 > budget:  # 6 appels en vol
                arret.set()
                return
        classement = lire(RES / "classements" / version / f"{nom(c)}.json")
        e = {"user": el[c]["user"], "props": propositions(el[c], classement)}
        r = juger_un(client, j, e)
        ecrire(sortie / j / f"{nom(c)}.json", r)
        with verrou:
            depense += r["cout_usd"] or 0
            cout_max = max(cout_max, r["cout_usd"] or 0)
            faits += 1
            barre("pas", f"mammouth-{version}", faits, total)

    echecs = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        futurs = {pool.submit(un, j, c): (j, c) for j, c in taches}
        for f in as_completed(futurs):
            try:
                f.result()
            except Exception as ex:
                echecs += 1
                print("échec", futurs[f], str(ex)[:150], flush=True)
    barre("fin", f"mammouth-{version}", *(["echec"] if echecs or arret.is_set() else []))
    print(f"fini : {faits}/{total}, dépensé {depense:.4f} $, {echecs} échec(s), arrêt budget : {arret.is_set()}")


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]), sys.argv[3] if len(sys.argv) > 3 else None)
