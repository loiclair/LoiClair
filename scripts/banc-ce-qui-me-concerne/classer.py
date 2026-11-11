# Classe les éléments du banc avec une consigne candidate (candidats/<version>.json, même
# forme que src/lib/prompts/ce-qui-me-concerne.json), en direct et en parallèle, avec
# Haiku 5.5 comme la production. Reprend `fusionner` et `ancrer` de classer_articles.py.
#   python3 classer.py <version> <dev|test|tout> [modele]
import json, sys, threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from commun import RES, ICI, ca, banc, nom, barre, ecrire, lire, depenser, depense, PLAFONDS


def preparer(version):
    """Consigne système et schémas d'une candidate, construits comme en production."""
    p = lire(ICI / "candidats" / f"{version}.json")
    systeme = p["system"].replace("{catalogue}", "\n\n".join(
        f"{t['intitule']} :\n" + "\n".join(
            f"- {x['id']} : {x['definition']}" for x in p["profils"] if x["theme"] == t["id"])
        for t in p["themes"]))
    ids = [x["id"] for x in p["profils"]]
    certitudes = p.get("certitudes", ["certain", "probable", "possible"])
    impact_art = {"profil": {"type": "string", "enum": ids}, "phrase_fr": {"type": "string"},
                  "phrase_en": {"type": "string"}, "passage": {"type": "string"},
                  "certitude": {"type": "string", "enum": certitudes}}
    impact_amdt = {k: v for k, v in impact_art.items() if k not in ("phrase_fr", "phrase_en")}
    # Champs ajoutés par une candidate (ex. le mot du texte qui vise le profil), placés
    # avant les autres : le modèle les écrit d'abord.
    for champ in p.get("champsAvant", []):
        impact_art = {champ: {"type": "string"}, **impact_art}
        impact_amdt = {champ: {"type": "string"}, **impact_amdt}

    def tableau(props):
        return {"type": "array", "items": {"type": "object", "properties": props, "required": list(props),
                                           "additionalProperties": False}}
    schemas = {
        "article": {"type": "object", "properties": {"impacts": tableau(impact_art)},
                    "required": ["impacts"], "additionalProperties": False},
        "amendement": {"type": "object", "properties": {"resume_fr": {"type": "string"}, "resume_en": {"type": "string"},
                                                        "impacts": tableau(impact_amdt)},
                       "required": ["resume_fr", "resume_en", "impacts"], "additionalProperties": False},
    }
    return p, systeme, schemas


def classer(version, moitie, modele=ca.MODELE):
    p, systeme, schemas = preparer(version)
    el = banc()
    dossier = RES / "classements" / version
    taches = [c for c, e in el.items() if (moitie == "tout" or e["moitie"] == moitie)
              and not (dossier / f"{nom(c)}.json").exists()]
    if depense("anthropic") + len(taches) * 0.003 > PLAFONDS["anthropic"]:
        raise SystemExit("arrêt : dépasserait le plafond Anthropic")
    ident = f"classer-{version}"
    barre("debut", ident, f"Classement {version} ({moitie})", len(taches))
    verrou, faits, total = threading.Lock(), 0, 0.0

    def un(c):
        nonlocal faits, total
        e = el[c]
        m = ca.claude.messages.create(
            model=modele, max_tokens=p["maxOutputTokens"],
            system=[{"type": "text", "text": systeme, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": e["user"]}],
            output_config={"effort": p["reasoningEffort"], "format": {"type": "json_schema", "schema": schemas[e["type"]]}})
        r = ca.ancrer(ca.fusionner([ca.lire_reponse(m)]), e["sources"])
        usd = ca.cout(m.usage)
        ecrire(dossier / f"{nom(c)}.json", {**r, "cout_usd": usd})
        with verrou:
            faits += 1
            total += usd
            barre("pas", ident, faits, len(taches))

    echecs = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        futurs = {pool.submit(un, c): c for c in taches}
        for f in as_completed(futurs):
            try:
                f.result()
            except Exception as ex:
                echecs += 1
                print("échec", futurs[f], type(ex).__name__, str(ex)[:150], flush=True)
    depenser("anthropic", ident, total)
    barre("fin", ident, *(["echec"] if echecs else []))
    print(f"{version} : {faits} classés, {echecs} échecs, {total:.4f} $ ; Anthropic au total {depense('anthropic'):.2f} $")


if __name__ == "__main__":
    a = sys.argv
    classer(a[1], a[2], a[3] if len(a) > 3 else ca.MODELE)
