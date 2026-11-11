# Juge Claude du banc : une consigne fixe (juge/consigne.md + règles du calibrage),
# indépendante de la consigne candidate, et un catalogue figé au 2026-10-17. Un jugement
# est rangé sous l'empreinte de ce qu'il juge (consigne, modèle, élément, propositions) :
# un élément dont le classement n'a pas changé n'est jamais rejugé.
#   python3 juge_claude.py essai <version> <n> [modele] [effort]   # n jugements en direct, coût mesuré
#   python3 juge_claude.py lot <version> <dev|test|tout> <budget_usd> [modele] [effort]
import hashlib, json, os, sys, time
from anthropic.types.message_create_params import MessageCreateParamsNonStreaming
from anthropic.types.messages.batch_create_params import Request
from commun import RES, ICI, AFFICHES, ca, banc, nom, barre, lire, ecrire, depenser, depense, PLAFONDS

JUGE = ICI / "juge"
MODELE = os.environ.get("JUGE_MODELE", "claude-sonnet-5-5")
EFFORT = "high"
TARIFS = {"claude-sonnet-5-5": (2.0, 10.0), "claude-opus-5-5": (4.0, 20.0), "claude-haiku-5-5": (0.10, 0.50)}

CATALOGUE = JUGE / "catalogue.txt"
if not CATALOGUE.exists():
    CATALOGUE.write_text("\n\n".join(
        f"{t['intitule']} :\n" + "\n".join(f"- {p['id']} : {p['definition']}"
                                          for p in ca._PROMPT["profils"] if p["theme"] == t["id"])
        for t in ca._PROMPT["themes"]), encoding="utf-8")
# Jeu de règles du calibrage : r12 (les 6 premières) ou r16 (resserré une fois).
REGLES = JUGE / f"regles_{os.environ.get('JUGE_REGLES', 'r12')}.md"


def consigne():
    regles = REGLES.read_text(encoding="utf-8") if REGLES.exists() else ""
    return (JUGE / "consigne.md").read_text(encoding="utf-8").replace(
        "{catalogue}", CATALOGUE.read_text(encoding="utf-8")).replace("{regles_calibrage}", regles)


SCHEMA = {
    "type": "object",
    "properties": {
        "profils": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "profil": {"type": "string", "enum": ca.PROFILS},
                "raison": {"type": "string"},
                "concerne": {"type": "boolean"},
                "phrase_fidele": {"type": "boolean"},
            },
            "required": ["profil", "raison", "concerne", "phrase_fidele"],
            "additionalProperties": False}},
        "oublis": {"type": "array", "items": {"type": "string", "enum": ca.PROFILS}},
    },
    "required": ["profils", "oublis"],
    "additionalProperties": False,
}


def propositions(classement):
    return [{"profil": i["profil"], "certitude": i["certitude"], "passage": i["passage"],
             "phrase": i.get("phrase_fr") or classement.get("resume_fr") or ""}
            for i in classement["impacts"] if i["certitude"] in AFFICHES]


def message(user, props):
    if props:
        bloc = "Propositions de l'assistant :\n" + "".join(
            f"- {p['profil']} : {p['phrase']}\n  Passage cité : « {p['passage']} »\n" for p in props)
    else:
        bloc = "L'assistant n'a proposé aucun profil.\n"
    profils = ", ".join(p["profil"] for p in props) or "aucun (dis seulement les oublis)"
    return user + "\n\n=== Propositions ===\n" + bloc + f"\nProfils à juger : {profils}"


def empreinte(systeme, modele, effort, msg):
    return hashlib.md5(json.dumps([systeme, modele, effort, msg], ensure_ascii=False).encode()).hexdigest()


def parametres(systeme, modele, effort, msg):
    return {"model": modele, "max_tokens": 16000,
            "system": [{"type": "text", "text": systeme, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": msg}],
            "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": SCHEMA}}}


def cout(modele, usage, remise=1.0):
    e, s = TARIFS[modele]
    lu = getattr(usage, "cache_read_input_tokens", 0) or 0
    ecrit = getattr(usage, "cache_creation_input_tokens", 0) or 0
    return (usage.input_tokens * e + ecrit * e * 1.25 + lu * e * 0.1 + usage.output_tokens * s) / 1e6 * remise


def a_juger(version, moitie, modele, effort):
    """(cle, empreinte, message) des éléments de la moitié, d'après classements/<version>."""
    systeme, el, sortie = consigne(), banc(), []
    for c, e in el.items():
        if moitie != "tout" and e["moitie"] != moitie:
            continue
        f = RES / "classements" / version / f"{nom(c)}.json"
        if not f.exists():  # moitié pas encore classée pour cette version
            continue
        msg = message(e["user"], propositions(lire(f)))
        sortie.append((c, empreinte(systeme, modele, effort, msg), msg))
    return systeme, sortie


def ranger(h, jugement, usd, modele, effort):
    ecrire(RES / "jugements" / "claude" / f"{h}.json",
           {"jugement": jugement, "cout_usd": usd, "modele": modele, "effort": effort})


def essai(version, n, modele, effort):
    systeme, taches = a_juger(version, "dev", modele, effort)
    taches = [t for t in taches if not (RES / "jugements" / "claude" / f"{t[1]}.json").exists()][:n]
    total = 0.0
    for c, h, msg in taches:
        m = ca.claude.messages.create(**parametres(systeme, modele, effort, msg))
        if m.stop_reason != "end_turn":
            print("échec", c, m.stop_reason)
            continue
        usd = cout(modele, m.usage)
        total += usd
        depenser("anthropic", f"juge-essai-{version}", usd)
        ranger(h, json.loads(next(b.text for b in m.content if b.type == "text")), usd, modele, effort)
        print(f"{c} : {usd:.4f} $ ({m.usage.input_tokens} + cache {m.usage.cache_read_input_tokens or 0}/"
              f"{m.usage.cache_creation_input_tokens or 0} entrée, {m.usage.output_tokens} sortie)")
    print(f"{len(taches)} jugements, {total:.4f} $ ; Anthropic dépensé au total {depense('anthropic'):.2f} $")


def lot(version, moitie, budget, modele, effort):
    systeme, taches = a_juger(version, moitie, modele, effort)
    taches = [t for t in taches if not (RES / "jugements" / "claude" / f"{t[1]}.json").exists()]
    vus, uniques = set(), []
    for t in taches:
        if t[1] not in vus:
            vus.add(t[1]); uniques.append(t)
    # Garde : estimation au coût moyen des jugements déjà faits avec ce modèle (×1,5).
    faits = [lire(f) for f in (RES / "jugements" / "claude").glob("*.json")]
    # Sans historique pour ce modèle, celui de Sonnet au prorata des tarifs.
    couts = [f["cout_usd"] / (0.5 if f.get("lot") else 1) * TARIFS[modele][1] / TARIFS[f["modele"]][1]
             for f in faits if f["modele"] in (modele, "claude-sonnet-5-5")]
    moyen = sum(couts) / len(couts) if couts else 0.06
    prevu = len(uniques) * moyen * 0.5 * 1.5
    deja = depense("anthropic")
    print(f"{len(uniques)} jugements à faire, prévu ≤ {prevu:.2f} $ (budget {budget} $, Anthropic déjà {deja:.2f} $)")
    if not uniques:
        return
    if prevu > budget or deja + prevu > PLAFONDS["anthropic"]:
        raise SystemExit("arrêt : dépasserait le budget")
    envoi = ca.claude.messages.batches.create(requests=[
        Request(custom_id=h, params=MessageCreateParamsNonStreaming(**parametres(systeme, modele, effort, msg)))
        for _, h, msg in uniques])
    ident = f"juge-{version}-{moitie}"
    barre("debut", ident, f"Juge Claude, {version} ({moitie})", len(uniques))
    print("lot", envoi.id, flush=True)
    while True:
        b = ca.claude.messages.batches.retrieve(envoi.id)
        rc = b.request_counts
        barre("pas", ident, rc.succeeded + rc.errored + rc.canceled + rc.expired, len(uniques))
        if b.processing_status == "ended":
            break
        time.sleep(20)
    total, echecs = 0.0, 0
    for r in ca.claude.messages.batches.results(envoi.id):
        if r.result.type != "succeeded" or r.result.message.stop_reason != "end_turn":
            echecs += 1
            continue
        m = r.result.message
        usd = cout(modele, m.usage, 0.5)
        total += usd
        ecrire(RES / "jugements" / "claude" / f"{r.custom_id}.json",
               {"jugement": json.loads(next(x.text for x in m.content if x.type == "text")), "cout_usd": usd,
                "modele": modele, "effort": effort, "lot": True})
    depenser("anthropic", ident, total)
    barre("fin", ident, *(["echec"] if echecs else []))
    print(f"fini : {len(uniques) - echecs} jugements, {echecs} échecs, {total:.4f} $ ; "
          f"Anthropic dépensé au total {depense('anthropic'):.2f} $")


def mammouth_direct(version, moitie, budget, modele="gpt-6-luna", effort="medium"):
    """Juge par Mammouth (GPT-6 Luna) en direct et en parallèle, même consigne et même
    schéma que le juge Claude. Coût lu dans la réponse ; garde sur le budget donné."""
    import threading
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from commun import mammouth
    systeme, taches = a_juger(version, moitie, modele, effort)
    vus, uniques = set(), []
    for t in taches:
        if t[1] not in vus and not (RES / "jugements" / "claude" / f"{t[1]}.json").exists():
            vus.add(t[1]); uniques.append(t)
    client, verrou = mammouth(), threading.Lock()
    etat = {"usd": 0.0, "max": 0.0, "faits": 0, "arret": False}
    ident = f"luna-{version}-{moitie}"
    barre("debut", ident, f"Juge Luna, {version} ({moitie})", len(uniques))

    def un(c, h, msg):
        with verrou:
            if etat["arret"] or etat["usd"] + max(etat["max"], 0.01) * 8 > budget:
                etat["arret"] = True
                return
        r = client.chat.completions.create(
            model=modele, max_tokens=16000, reasoning_effort=effort,
            messages=[{"role": "system", "content": systeme}, {"role": "user", "content": msg}],
            response_format={"type": "json_schema", "json_schema": {"name": "jugement", "strict": True, "schema": SCHEMA}})
        ch = r.choices[0]
        if ch.finish_reason not in ("stop", None):
            raise RuntimeError(f"finish_reason={ch.finish_reason}")
        usd = (r.usage.model_extra or {}).get("cost") or 0
        ranger(h, json.loads(ch.message.content), usd, modele, effort)
        with verrou:
            etat["usd"] += usd; etat["max"] = max(etat["max"], usd); etat["faits"] += 1
            barre("pas", ident, etat["faits"], len(uniques))

    echecs = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        futurs = [pool.submit(un, *t) for t in uniques]
        for f in as_completed(futurs):
            try:
                f.result()
            except Exception as ex:
                echecs += 1
                print("échec", type(ex).__name__, str(ex)[:150], flush=True)
    depenser("mammouth", ident, etat["usd"])
    barre("fin", ident, *(["echec"] if echecs or etat["arret"] else []))
    print(f"{ident} : {etat['faits']}/{len(uniques)} jugements, {echecs} échecs, {etat['usd']:.4f} $, arrêt budget {etat['arret']}")


def jugements(version, moitie="tout", modele=MODELE, effort=EFFORT):
    """cle → jugement (ou absent) pour une version, avec la consigne de juge actuelle."""
    _, taches = a_juger(version, moitie, modele, effort)
    out = {}
    for c, h, _ in taches:
        f = RES / "jugements" / "claude" / f"{h}.json"
        if f.exists():
            out[c] = lire(f)["jugement"]
    return out


if __name__ == "__main__":
    a = sys.argv
    if a[1] == "essai":
        essai(a[2], int(a[3]), a[4] if len(a) > 4 else MODELE, a[5] if len(a) > 5 else EFFORT)
    elif a[1] == "luna":
        mammouth_direct(a[2], a[3], float(a[4]))
    elif a[1] == "lot":
        lot(a[2], a[3], float(a[4]), a[5] if len(a) > 5 else MODELE, a[6] if len(a) > 6 else EFFORT)
