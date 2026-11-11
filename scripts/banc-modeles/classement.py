"""Banc d'essai, étape 3 sur 3 : calculer le classement et l'écrire pour le site.

Lit resultats/resumes.json (banc.mjs) et resultats/notes.json (jury.mjs), et
écrit src/lib/evaluation-modeles.ts, que /documentation/choix-modele-ia affiche tel
quel : aucun chiffre de la page n'est recopié à la main. Le niveau de
raisonnement publié est celui de la mesure. Le script refuse de tourner si
grille.md n'est plus celle du jury : celle du banc du 2026-09-29 est gardée
dans grille-2026-09-29.md, vers laquelle la page renvoie, grille.md ayant
changé depuis.

Le calcul, dans l'ordre :
1. Recalage. Chaque correcteur est ramené sur l'échelle d'Opus, critère par
   critère, à partir des résumés que les deux ont notés : on aligne la moyenne et
   la dispersion de ses notes sur celles d'Opus. Sans ça, un correcteur généreux
   (Gemini donne 9 à 10 à presque tout) gonflerait les modèles qu'il note seul.
2. Note d'un résumé : moyenne de ses correcteurs recalés, puis score pondéré
   (exactitude 35 %, neutralité 20 %, complétude, clarté et exemples 15 %).
   Une génération ratée compte 0 : la fiabilité fait partie de la qualité.
3. Note d'un modèle : moyenne de ses résumés, tous tirages confondus.
4. Frontière qualité-prix : du moins cher au plus cher, un modèle y entre s'il
   bat tous les modèles moins chers que lui.

Lancer depuis la racine du dépôt :   python3 scripts/banc-modeles/classement.py
"""
import hashlib, json, os, re, statistics as st

# ── Configuration ────────────────────────────────────────────────────────────
POIDS = {'exactitude': .35, 'neutralite': .20, 'completude': .15, 'clarte': .15, 'exemples': .15}
REFERENCE = 'claude-opus-5-5'  # le correcteur dont l'échelle sert d'étalon
# Correcteur → familles de modèles pour lesquelles sa note COMPTE. Un correcteur
# ne compte jamais pour sa propre famille ; gpt-6-sol et grok-4.7 notent aussi
# d'autres modèles, mais seulement pour se recaler sur Opus. Doit rester cohérent avec jury.mjs.
COMPTE_POUR = {
    'claude-opus-5-5': {'openai', 'xai', 'google'},
    'gemini-3.1-pro-preview': {'openai', 'xai'},
    'gpt-6-sol': {'anthropic'},
    'grok-4.7': {'anthropic'},
}
FUSION = ['claude-opus-5-5', 'claude-sonnet-5']  # une ligne par modèle, meilleur réglage gardé
DATE_MESURE ='2026-09-29'  # dernier lancement (Claude avec réflexion forcée)
# ─────────────────────────────────────────────────────────────────────────────

ICI = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(ICI))
charger = lambda f: json.load(open(os.path.join(ICI, 'resultats', f), encoding='utf-8'))
d = charger('resumes.json')
jury = charger('notes.json')
# Réglages écrits par banc.mjs : la page les présente comme ceux du jour de la
# mesure, ils ne se relisent donc pas dans la prod actuelle.
if 'reglages' not in d:
    raise SystemExit("resumes.json n'a pas de « reglages » : il vient d'une version de banc.mjs antérieure au 2026-10-09.")
REGLAGES = d['reglages']
# Même empreinte que jury.mjs (md5 des octets UTF-8, 8 caractères).
grille = open(os.path.join(ICI, 'grille.md'), encoding='utf-8').read()
EMPREINTE_GRILLE = hashlib.md5(grille.encode('utf-8')).hexdigest()[:8]
empreintes = {j.get('grille', 'absente') for j in jury}
if empreintes != {EMPREINTE_GRILLE}:
    raise SystemExit(f"notes.json a été noté avec la grille {', '.join(sorted(empreintes))}, grille.md est en {EMPREINTE_GRILLE} : "
                     "remettre la grille qui a servi (grille-2026-09-29.md pour ce banc) ou relancer le jury.")
famille = lambda m: next((f for p, f in [('claude', 'anthropic'), ('gemini', 'google'), ('gpt', 'openai'), ('grok', 'xai')] if m.startswith(p)), m)
base = lambda c: c.split('#')[0]
mots = lambda s: len(re.findall(r"\w+(?:['’]\w+)*", s))
ponderer = lambda n: sum(n[k] * w for k, w in POIDS.items())


def consignes(o, locale):
    """Règles mesurables du prompt de prod. Rend (règles non respectées, nombre de règles)."""
    rec = [x.get('recit', '') for x in o['exemples']]
    tout = [o['objectif'], o['aRetenir'], *o['mesures'], *rec]
    pronoms = r"\b(you|your|yours)\b" if locale == 'en' else r"\b(tu|vous|te|t['’]|ton|ta|tes|votre|vos)\b"
    regles = {
        'objectif ≤ 90 mots': mots(o['objectif']) <= 90, '3 à 5 mesures': 3 <= len(o['mesures']) <= 5,
        'mesures ≤ 150 mots': sum(map(mots, o['mesures'])) <= 150, '2 à 3 exemples': 2 <= len(o['exemples']) <= 3,
        'récits ≤ 100 mots': all(mots(r) <= 100 for r in rec),
        'récits à la 3e personne': not any(re.search(pronoms, r, re.I) for r in rec),
        'à retenir ≤ 75 mots': mots(o['aRetenir']) <= 75,
        'pas de markdown': not any(re.search(r"\*\*|^#|^\s*[-•] ", s, re.M) for s in tout),
    }
    return [k for k, v in regles.items() if not v], len(regles)


# Notes brutes, par (correcteur, texte, candidat).
brutes = {}
for j in jury:
    for n in j.get('notes', []):
        c = j['lettres'].get(n['lettre'])
        if c in d['modeles']:
            brutes[(j['juge'], j['uid'], c)] = n


def calage(juge):
    """Fonction qui ramène les notes de `juge` sur l'échelle de REFERENCE."""
    communs = [(u, c) for (jg, u, c) in brutes if jg == juge and (REFERENCE, u, c) in brutes]
    cal = {}
    for k in POIDS:
        g = [brutes[(juge, u, c)][k] for u, c in communs]
        o = [brutes[(REFERENCE, u, c)][k] for u, c in communs]
        cal[k] = (st.mean(g), st.pstdev(g) or 1, st.mean(o), st.pstdev(o) or 1)
    f = lambda k, v: min(10, max(1, (v - cal[k][0]) / cal[k][1] * cal[k][3] + cal[k][2]))
    avant = st.mean(abs(ponderer(brutes[(juge, u, c)]) - ponderer(brutes[(REFERENCE, u, c)])) for u, c in communs)
    apres = st.mean(abs(sum(f(k, brutes[(juge, u, c)][k]) * w for k, w in POIDS.items()) - ponderer(brutes[(REFERENCE, u, c)])) for u, c in communs)
    print(f'recalage {juge} : {len(communs)} résumés communs avec {REFERENCE}, écart moyen {avant:.2f} avant, {apres:.2f} après')
    return f


recal = {j: (lambda k, v: v) if j == REFERENCE else calage(j) for j in COMPTE_POUR}

res = {}
for c in d['modeles']:
    for i, t in enumerate(d['textes']):
        r = d['resultats'][c][i]
        ns = [(j, brutes[(j, t['uid'], c)]) for j in COMPTE_POUR
              if famille(c) in COMPTE_POUR[j] and (j, t['uid'], c) in brutes]
        if not r or not r.get('objet'):
            res[(c, i)] = None  # génération ratée : compte 0
            continue
        if not ns:
            # Résumé réussi que le jury n'a pas encore noté (plafond atteint,
            # correcteur coupé en route) : il sort du calcul au lieu de compter 0
            # comme un échec, et le prochain lancement de jury.mjs le rattrape.
            print(f'non noté : {c} sur {t["uid"]}')
            continue
        crit = {k: st.mean(recal[j](k, n[k]) for j, n in ns) for k in POIDS}
        rates, tot = consignes(r['objet'], t['locale'])
        res[(c, i)] = {
            'crit': crit, 'score': sum(crit[k] * w for k, w in POIDS.items()), 'rates': rates, 'tot': tot,
            'graves': st.mean(sum(x['gravite'] == 'grave' for x in n['erreurs']) for _, n in ns),
            'cout': r.get('cout') or 0, 'juges': {j for j, _ in ns},
        }

stats = {}
for m in dict.fromkeys(base(c) for c in d['modeles']):
    runs = [c for c in d['modeles'] if base(c) == m]
    rs = [res[(c, i)] for c in runs for i in range(len(d['textes'])) if (c, i) in res]
    ok = [x for x in rs if x]
    par_langue = lambda loc: [res[(c, i)]['score'] for c in runs for i, t in enumerate(d['textes']) if t['locale'] == loc and res.get((c, i))]
    ecart = None
    if len(runs) == 2:
        paires = [abs(res[(runs[0], i)]['score'] - res[(runs[1], i)]['score']) for i in range(len(d['textes'])) if res.get((runs[0], i)) and res.get((runs[1], i))]
        ecart = round(st.mean(paires), 1) if paires else None
    stats[m] = {
        'id': m.split('@')[0], 'raisonnement': m.split('@')[1] if '@' in m else REGLAGES['raisonnement'], 'famille': famille(m),
        'score': round(st.mean([x['score'] if x else 0 for x in rs]), 1),
        'fr': round(st.mean(par_langue('fr')), 1), 'en': round(st.mean(par_langue('en')), 1),
        'criteres': {k: round(st.mean(x['crit'][k] for x in ok), 1) for k in POIDS},
        'gravesPour10': round(sum(x['graves'] for x in ok) / len(ok) * 10, 1),
        'consignes': round(1 - sum(len(x['rates']) for x in ok) / sum(x['tot'] for x in ok), 2),
        'echecs': len(rs) - len(ok), 'resumes': len(rs), 'tirages': len(runs), 'ecartTirages': ecart,
        'coutPour1000': round(st.mean(x['cout'] for x in ok) * 1000, 2),
        'correcteurs': sorted({j for x in ok for j in x['juges']}),
    }

# Une seule ligne par modèle de FUSION : on ne publie que son meilleur réglage.
# Les Claude ont été testés en deux réglages parce qu'ils ne réfléchissent pas
# d'eux-mêmes sur cette tâche ; garder le meilleur leur laisse toutes leurs chances.
for mid in FUSION:
    variantes = [m for m in stats if stats[m]['id'] == mid]
    for m in sorted(variantes, key=lambda m: -stats[m]['score'])[1:]:
        del stats[m]

# Frontière : les scores sont arrondis au dixième, comme affichés.
meilleur = -1
for m in sorted(stats, key=lambda m: stats[m]['coutPour1000']):
    stats[m]['frontiere'] = stats[m]['score'] > meilleur
    meilleur = max(meilleur, stats[m]['score'])

ordre = sorted(stats, key=lambda m: (-stats[m]['score'], stats[m]['coutPour1000']))
for m in ordre:
    s = stats[m]
    print(f"{'F' if s['frontiere'] else ' '} {m:24} {s['score']:.1f}  FR {s['fr']:.1f}  EN {s['en']:.1f}  graves/10 {s['gravesPour10']:.1f}  {s['coutPour1000']:.2f} $/1000")

donnees = {
    'dateMesure': DATE_MESURE, 'raisonnement': REGLAGES['raisonnement'],
    'textes': [{'uid': t['uid'], 'langue': t['locale'], 'caracteres': t['n']} for t in d['textes']],
    'resumesNotes': sum(1 for v in res.values() if v), 'correcteurs': list(COMPTE_POUR), 'poids': POIDS,
    'modeles': [stats[m] for m in ordre],
}
ts = f'''/**
 * Résultats du banc d'essai des modèles pour le résumé de loi, affichés sur
 * /documentation/choix-modele-ia.
 *
 * FICHIER GÉNÉRÉ par scripts/banc-modeles/classement.py : ne pas le modifier à
 * la main, relancer le banc (voir scripts/banc-modeles/README.md).
 */

export type ModeleEvalue = {{
  id: string;
  raisonnement: string;
  famille: 'openai' | 'xai' | 'anthropic' | 'google';
  score: number;
  fr: number;
  en: number;
  criteres: Record<'exactitude' | 'neutralite' | 'completude' | 'clarte' | 'exemples', number>;
  gravesPour10: number;
  consignes: number;
  echecs: number;
  resumes: number;
  tirages: number;
  ecartTirages: number | null;
  coutPour1000: number;
  correcteurs: string[];
  frontiere: boolean;
}};

export const EVALUATION_MODELES: {{
  dateMesure: string;
  raisonnement: string;
  textes: {{ uid: string; langue: 'fr' | 'en'; caracteres: number }}[];
  resumesNotes: number;
  correcteurs: string[];
  poids: Record<keyof ModeleEvalue['criteres'], number>;
  modeles: ModeleEvalue[];
}} = {json.dumps(donnees, ensure_ascii=False, indent=2)};
'''
open(os.path.join(REPO, 'src', 'lib', 'evaluation-modeles.ts'), 'w', encoding='utf-8').write(ts)
print('écrit : src/lib/evaluation-modeles.ts')
