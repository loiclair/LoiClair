"""
generer.py : fiches d'une version du prompt sur un des deux jeux de dossiers.

  python3 -P scripts/banc-fiches-courtes/generer.py prompts/v10.json haiku-v10 [--frais] [--luna] [--sans-reflexion] [--effort medium]

Écrit resultats/fiches-<jeu>-<nom>.json (repris s'il existe) et affiche des mesures
automatiques, comparées aux fiches v1 du jeu de réglage :
longueur, phrase finale sur l'adoption, auteurs nommés, « vise à » / présent,
nombre de thèmes. La qualité de fond, elle, se lit.
"""

import json
import re
import statistics as st
import sys
import time
from pathlib import Path

DOSSIER = Path(__file__).resolve().parent
ICI = DOSSIER / "resultats"
sys.path.insert(0, str(DOSSIER))
import banc  # noqa: E402

prompt = json.loads((DOSSIER / sys.argv[1]).read_text(encoding="utf-8"))
variante = sys.argv[2]
sans_reflexion = "--sans-reflexion" in sys.argv
frais = "--frais" in sys.argv  # jeu de validation, jamais vu pendant le réglage
avec_luna = "--luna" in sys.argv  # appelle Luna au lieu de Haiku
effort = sys.argv[sys.argv.index("--effort") + 1] if "--effort" in sys.argv else "low"

schema = json.loads(json.dumps(prompt["schema"]))
schema["properties"]["themes"].pop("maxItems", None)
banc.PROMPT = prompt  # message_utilisateur lit le gabarit ici
banc.SYSTEM, banc.SCHEMA = prompt["system"], prompt["schema"]  # lus par banc.appel_luna


def appel(d):
    t0 = time.time()
    kw = {"thinking": {"type": "disabled"}} if sans_reflexion else {}
    r = banc.claude.messages.create(
        model=banc.HAIKU,
        max_tokens=4000,
        system=prompt["system"],
        messages=[{"role": "user", "content": banc.message_utilisateur(d)}],
        output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        **kw,
    )
    u = r.usage
    res = {"duree": time.time() - t0, "jetons_in": u.input_tokens, "jetons_out": u.output_tokens,
           "cout": u.input_tokens * banc.HAIKU_IN + u.output_tokens * banc.HAIKU_OUT, "fin": r.stop_reason}
    if r.stop_reason in ("max_tokens", "refusal"):
        res["erreur"] = f"stop_reason {r.stop_reason}"
        return res
    res["data"], err = banc.valider(next((b.text for b in r.content if b.type == "text"), ""))
    if err:
        res["erreur"] = err
    return res


FIN_ADOPTION = re.compile(r"(pas (encore )?(été )?adopt|à ce (stade|jour)|en cours d.examen)", re.I)
AUTEUR_NOMME = re.compile(r"\b(Mme|M\.|député[e]?|sénat(eur|rice)) [A-ZÉ][a-zé]+")
PRESENT = re.compile(r"\b(vise à|prévoit|propose de|veut)\b", re.I)
STATUT_LOI = re.compile(r"(pas (encore )?une loi|pas encore (adopt|en vigueur)|ne change (donc )?aucune règle pour l)", re.I)
NOMBRE = re.compile(r"\d[\d\s\u00a0\u202f.,/-]*\d|\d")


def chiffres_absents(resume, contenu):
    """Nombres du résumé introuvables dans le texte source (espaces normalisés)."""
    src = re.sub(r"[\s\u00a0\u202f]", "", contenu)
    return [n for n in (re.sub(r"[\s\u00a0\u202f]", "", m.group()).strip(".,-/") for m in NOMBRE.finditer(resume))
            if n and n not in src] + [
        w for w in MOTS_NOMBRES.findall(resume.lower()) if w not in contenu.lower()]


MOTS_NOMBRES = re.compile(r"\b(deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|quinze|vingt|trente|quarante|"
                          r"cinquante|soixante|cent|mille|tiers|quart|moitié|millions?|milliards?)\b")


def mesures(res, dossiers, nom):
    rs = [res.get(d["uid"]) or {} for d in dossiers]
    absents = []
    avec_texte = [(d, r) for d, r in zip(dossiers, rs) if d["contenu"] and (r.get("data") or {}).get("resume")]
    mots = [len(r["data"]["resume"].split()) for _, r in avec_texte]
    resumes = [r["data"]["resume"] for _, r in avec_texte]
    for d, r in avec_texte:
        absents += chiffres_absents(r["data"]["resume"], d["contenu"])
    lois = [r["data"]["resume"] for d, r in avec_texte if "loi" in (d.get("procedure_libelle") or "").lower()]
    themes = [len((r.get("data") or {}).get("themes") or []) for r in rs]
    couts = [r["cout"] for r in rs if r.get("cout") is not None]
    print(f"{nom:<14} échecs {sum(1 for r in rs if 'exception' in r or r.get('erreur'))}"
          f" | mots moy {st.mean(mots):.0f} max {max(mots)} >120: {sum(m > 120 for m in mots)}"
          f" | fin adoption {sum(bool(FIN_ADOPTION.search(s)) for s in resumes)}"
          f" | auteur nommé {sum(bool(AUTEUR_NOMME.search(s)) for s in resumes)}"
          f" | vise/prévoit {sum(len(PRESENT.findall(s)) for s in resumes)}"
          f" | statut loi {sum(bool(STATUT_LOI.search(s)) for s in lois)}"
          f" | chiffres absents {absents}"
          f" | thèmes moy {st.mean(themes):.1f}"
          f" | $/1000 {st.mean(couts) * 1000:.2f} | jetons sortie {st.mean(r.get('jetons_out', 0) for r in rs):.0f}"
          f" | durée {st.mean(r.get('duree', 0) for r in rs):.1f}s")


def main():
    dossiers = banc.choisir(ICI / "dossiers-frais.json") if frais else banc.choisir()
    fichier = ICI / f"fiches-{'frais' if frais else 'reglage'}-{variante}.json"
    res = json.loads(fichier.read_text(encoding="utf-8")) if fichier.exists() else {}
    for d in dossiers:
        if d["uid"] in res and "exception" not in res[d["uid"]]:
            continue
        try:
            res[d["uid"]] = banc.appel_luna(d) if avec_luna else appel(d)
        except Exception as e:
            res[d["uid"]] = {"exception": f"{type(e).__name__}: {e}"}
            print("  ", d["uid"], res[d["uid"]]["exception"][:200])
        fichier.write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")

    if frais:
        for nom in ("luna-v1", "luna-v10", "haiku-v10", variante):
            f = ICI / f"fiches-frais-{nom}.json"
            if f.exists():
                mesures(json.loads(f.read_text(encoding="utf-8")), dossiers, nom)
        return
    base = json.loads((ICI / "fiches-reglage-v1.json").read_text(encoding="utf-8"))
    luna = {d["uid"]: base[f"{d['uid']}|{banc.LUNA}"] for d in dossiers}
    haiku1 = {d["uid"]: base[f"{d['uid']}|{banc.HAIKU}"] for d in dossiers}
    mesures(luna, dossiers, "luna v1")
    mesures(haiku1, dossiers, "haiku v1")
    mesures(res, dossiers, variante)


if __name__ == "__main__":
    main()
