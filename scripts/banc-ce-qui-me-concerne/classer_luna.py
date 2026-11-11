# Étape 6b : la même consigne candidate, telle quelle, envoyée à GPT-6 Luna par
# Mammouth (raisonnement bas, JSON contraint, comme src/lib/ai-provider.ts). Écrit
# classements/luna_<version>/, passages recalés comme pour Haiku.
#   python3 classer_luna.py <version> <dev|test|tout> <budget_usd>
import json, sys, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from commun import RES, ca, banc, nom, barre, ecrire, depenser, mammouth
from classer import preparer


def main(version, moitie, budget):
    p, systeme, schemas = preparer(version)
    el, client = banc(), mammouth()
    dossier = RES / "classements" / f"luna_{version}"
    taches = [c for c, e in el.items() if (moitie == "tout" or e["moitie"] == moitie)
              and not (dossier / f"{nom(c)}.json").exists()]
    ident = f"luna-classe-{version}"
    barre("debut", ident, f"Classement Luna {version}", len(taches))
    verrou, etat = threading.Lock(), {"usd": 0.0, "max": 0.0, "faits": 0, "arret": False}

    def un(c):
        with verrou:
            if etat["arret"] or etat["usd"] + max(etat["max"], 0.01) * 4 > budget:
                etat["arret"] = True
                return
        e = el[c]
        r = client.chat.completions.create(
            model="gpt-6-luna", max_tokens=p["maxOutputTokens"], reasoning_effort="low",
            messages=[{"role": "system", "content": systeme}, {"role": "user", "content": e["user"]}],
            response_format={"type": "json_schema", "json_schema": {"name": "classement", "strict": True,
                                                                    "schema": schemas[e["type"]]}})
        ch = r.choices[0]
        if ch.finish_reason not in ("stop", None):
            raise RuntimeError(f"finish_reason={ch.finish_reason}")
        usd = (r.usage.model_extra or {}).get("cost") or 0
        rep = ca.ancrer(ca.fusionner([json.loads(ch.message.content)]), e["sources"])
        ecrire(dossier / f"{nom(c)}.json", {**rep, "cout_usd": usd})
        with verrou:
            etat["usd"] += usd; etat["max"] = max(etat["max"], usd); etat["faits"] += 1
            barre("pas", ident, etat["faits"], len(taches))

    echecs = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futurs = {pool.submit(un, c): c for c in taches}
        for f in as_completed(futurs):
            try:
                f.result()
            except Exception as ex:
                echecs += 1
                print("échec", futurs[f], type(ex).__name__, str(ex)[:150], flush=True)
    depenser("mammouth", ident, etat["usd"])
    barre("fin", ident, *(["echec"] if echecs or etat["arret"] else []))
    print(f"{ident} : {etat['faits']}/{len(taches)}, {echecs} échecs, {etat['usd']:.4f} $, arrêt budget {etat['arret']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]))
