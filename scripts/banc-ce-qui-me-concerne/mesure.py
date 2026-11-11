# Mesures du banc. Un rattachement affiché (certain ou probable) est juste quand le juge
# le dit concerné (majorité pour les 3 juges Mammouth). Rappel : justes / (justes +
# oublis), un oubli étant un profil que le juge dit concerné et qui n'est pas affiché.
#   python3 mesure.py <version> <dev|test|tout> <claude|mammouth> [detail]
import json, sys
from collections import Counter, defaultdict
from commun import RES, REVUE, JUGES_MAMMOUTH, AFFICHES, THEME, banc, nom, lire


def verdicts_mammouth(version, cles):
    """cle → {"profils": {profil: (concerne, fidele, raison)}, "oublis": set} à la majorité."""
    el, out = banc(), {}
    for c in cles:
        if version == "v0" and el[c]["ancien"]:
            fichiers = [REVUE / j / f"{el[c]['ancien']}.json" for j in JUGES_MAMMOUTH]
        else:
            fichiers = [RES / "jugements" / "mammouth" / version / j / f"{nom(c)}.json" for j in JUGES_MAMMOUTH]
        jug = [lire(f)["jugement"] for f in fichiers if f.exists()]
        if len(jug) < 2:
            continue
        prof = defaultdict(list)
        for j in jug:
            for x in j["profils"]:
                prof[x["profil"]].append(x)
        oublis = Counter(o for j in jug for o in set(j["oublis"]))
        out[c] = {"profils": {p: (sum(x["concerne"] for x in xs) * 2 > len(xs),
                                  sum(x["phrase_fidele"] for x in xs) * 2 > len(xs), xs[0]["raison"])
                              for p, xs in prof.items()},
                  "oublis": {o for o, n in oublis.items() if n * 2 > len(jug)}}
    return out


def verdicts_claude(version, cles):
    from juge_claude import jugements
    out = {}
    for c, j in jugements(version).items():
        if c in cles:
            out[c] = {"profils": {x["profil"]: (x["concerne"], x["phrase_fidele"], x["raison"]) for x in j["profils"]},
                      "oublis": set(j["oublis"])}
    return out


# Panel des itérations, choisi le 2026-10-17 : GPT-6 Luna (Mammouth), Sonnet
# 5.5 et Haiku 5.5 (Anthropic), même consigne de juge ; 2 voix sur 3.
PANEL = [("claude-sonnet-5-5", "high"), ("gpt-6-luna", "medium"), ("claude-haiku-5-5", "high")]


def verdicts_panel(version, cles, juges=PANEL):
    from juge_claude import jugements
    par = [jugements(version, modele=m, effort=e) for m, e in juges]
    out = {}
    for c in cles:
        jug = [j[c] for j in par if c in j]
        if len(jug) < len(juges):
            continue
        prof = defaultdict(list)
        for j in jug:
            for x in j["profils"]:
                prof[x["profil"]].append(x)
        oublis = Counter(o for j in jug for o in set(j["oublis"]))
        out[c] = {"profils": {p: (sum(x["concerne"] for x in xs) * 2 > len(xs),
                                  sum(x["phrase_fidele"] for x in xs) * 2 > len(xs),
                                  next((x["raison"] for x in xs if x["concerne"] == (sum(y["concerne"] for y in xs) * 2 > len(xs))), ""))
                              for p, xs in prof.items()},
                  "oublis": {o for o, n in oublis.items() if n * 2 > len(jug)}}
    return out


def mesurer(version, moitie, source, detail=False, cles=None):
    el = banc()
    cles = cles or [c for c, e in el.items() if moitie == "tout" or e["moitie"] == moitie]
    ver = {"claude": verdicts_claude, "panel": verdicts_panel, "mammouth": verdicts_mammouth}[source](version, cles)
    s, par = Counter(), defaultdict(Counter)
    faux, oublis_l = [], []
    for c in cles:
        if c not in ver:
            s["non_juges"] += 1
            continue
        cl = lire(RES / "classements" / version / f"{nom(c)}.json")
        aff = [i for i in cl["impacts"] if i["certitude"] in AFFICHES]
        v = ver[c]
        s["elements"] += 1
        for i in aff:
            p = i["profil"]
            juste, fidele, raison = v["profils"].get(p, (None, None, ""))
            if juste is None:
                s["sans_verdict"] += 1
                continue
            s["affiches"] += 1
            s["justes"] += juste
            s["fideles"] += bool(fidele)
            for k in (f"certitude:{i['certitude']}", f"theme:{THEME[p]}", f"famille:{el[c]['famille']}"):
                par[k]["n"] += 1
                par[k]["justes"] += juste
            if not juste:
                faux.append((c, p, i["certitude"], raison))
        manques = v["oublis"] - {i["profil"] for i in aff}
        s["oublis"] += len(manques)
        oublis_l += [(c, o) for o in manques]
        s["vides"] += not aff
        s["vides_a_raison"] += not aff and not manques
    r = {"version": version, "moitie": moitie, "source": source, **s,
         "justesse": s["justes"] / max(1, s["affiches"]),
         "rappel": s["justes"] / max(1, s["justes"] + s["oublis"]),
         "fidelite": s["fideles"] / max(1, s["affiches"]),
         "par": {k: (v["justes"], v["n"]) for k, v in sorted(par.items())}, "faux": faux, "oublis_l": oublis_l}
    if detail is not None:
        print(f"{version} {moitie} ({source}) : {s['elements']} éléments, {s['affiches']} affichés, "
              f"justesse {r['justesse']:.1%}, rappel {r['rappel']:.1%} ({s['oublis']} oublis), "
              f"fidélité {r['fidelite']:.1%}, vides {s['vides']} dont {s['vides_a_raison']} à raison"
              + (f", {s['non_juges']} non jugés" if s["non_juges"] else ""))
        for k in sorted(par):
            if k.startswith(("certitude", "famille")):
                print(f"   {k:24} {par[k]['justes']:3}/{par[k]['n']:3}  {par[k]['justes'] / par[k]['n']:.0%}")
    if detail:
        for k in sorted(par):
            if k.startswith("theme"):
                print(f"   {k:24} {par[k]['justes']:3}/{par[k]['n']:3}  {par[k]['justes'] / par[k]['n']:.0%}")
        print("faux :")
        for f in faux:
            print(f"   {f[0]} {f[1]} ({f[2]}) : {f[3][:220]}")
        print("oublis :", oublis_l)
    return r


if __name__ == "__main__":
    a = sys.argv
    mesurer(a[1], a[2], a[3], len(a) > 4)
