/**
 * Vérifie que chaque texte lu par le code client part bien au navigateur, page par page.
 *
 * Le navigateur ne reçoit qu'une partie du catalogue de traductions
 * (`src/i18n/messages-client.ts`) : le socle, envoyé à toutes les pages par la mise en
 * page racine, plus les namespaces que chaque route déclare dans
 * `TRADUCTIONS_PAR_ROUTE`, ajoutés par le `layout.tsx` de cette route. Un composant
 * client qui lit une clé absente de sa route afficherait la clé brute
 * (« dossiers.pageTitle ») sans que `typecheck` ni `eslint` ne bronchent : ce script,
 * lancé par `npm run lint:strict`, le bloque en CI.
 *
 * Comment :
 *   - le code client est l'ensemble des fichiers `'use client'` et de tout ce qu'ils
 *     importent ; le code serveur traduit par `getTranslations` ou `useTranslations`
 *     côté serveur, qui lisent tout le catalogue, et n'est pas concerné ;
 *   - depuis chaque `page.tsx`, `layout.tsx`, `not-found.tsx`, `error.tsx`… de
 *     `src/app/[locale]`, il suit les imports (statiques et `import()`, alias `@/`,
 *     chemins relatifs, `index`) et contrôle chaque fichier client atteint contre ce
 *     que cette route reçoit : le socle, plus les listes de son dossier et de ses
 *     dossiers parents. Un `layout.tsx` ne reçoit pas la liste de son propre dossier,
 *     que son provider ne pose qu'autour de ses enfants ;
 *   - une clé écrite en dur, ou au moins par son début (`t(\`mesures.${m}\`)`), doit
 *     être couverte ; une clé entièrement variable, ou un traducteur passé hors d'un
 *     appel direct (argument de fonction, objet), exige son namespace entier ;
 *   - un traducteur sans namespace (`useTranslations()`) ne peut lire une clé variable
 *     que dans les fichiers dont les clés sont calculées depuis leur registre
 *     (`FICHIERS_CLES_CALCULEES`), et que le socle envoie.
 * L'argument de `useTranslations` doit être une chaîne écrite en dur, et son
 * résultat affecté à une constante (`const t = useTranslations('ns')`).
 *
 * Usage : node scripts/verifier-traductions-client.mjs (depuis la racine du dépôt).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const RACINE = process.cwd();
const SRC = join(RACINE, 'src');
const APP = join(SRC, 'app', '[locale]');

// Fichiers dont les clés lues par nom variable sont calculées depuis leur registre et
// ajoutées au socle par `messagesClient` (`clesTraductionNavigation`, `clesTraductionFacts`).
const FICHIERS_CLES_CALCULEES = new Set(['src/lib/navigation.tsx', 'src/lib/search/site-pages.ts']);

// Fichiers d'entrée d'une route : ceux que Next rend lui-même.
const ENTREES = new Set(['page.tsx', 'layout.tsx', 'not-found.tsx', 'error.tsx', 'loading.tsx', 'template.tsx', 'default.tsx']);

/** Lit un tableau de chaînes `export const NOM = [ … ]` dans messages-client.ts. */
function lireListe(source, nom) {
  const m = source.match(new RegExp(`export const ${nom} = \\[([\\s\\S]*?)\\]`));
  if (!m) throw new Error(`${nom} introuvable dans src/i18n/messages-client.ts`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Lit `TRADUCTIONS_PAR_ROUTE` : dossier de route → chemins pointés qu'il ajoute. */
function lireRoutes(source) {
  const m = source.match(/export const TRADUCTIONS_PAR_ROUTE[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (!m) throw new Error('TRADUCTIONS_PAR_ROUTE introuvable dans src/i18n/messages-client.ts');
  const routes = new Map();
  for (const e of m[1].matchAll(/'([^']*)'\s*:\s*\[([^\]]*)\]/g)) {
    routes.set(e[1], [...e[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  }
  return routes;
}

const config = readFileSync(join(SRC, 'i18n/messages-client.ts'), 'utf8');
const SOCLE = [...lireListe(config, 'NAMESPACES_SOCLE'), ...lireListe(config, 'SOUS_ARBRES_SOCLE')];
const ROUTES = lireRoutes(config);

/** Ce que reçoit une route : le socle, plus les listes de ses dossiers parents, et de
 *  son propre dossier si `avecSoi`. `route` est relative à `src/app/[locale]`. */
function disponible(route, avecSoi) {
  const parties = route ? route.split('/') : [];
  const dossiers = [];
  for (let i = 1; i <= parties.length; i++) dossiers.push(parties.slice(0, i).join('/'));
  if (!avecSoi) dossiers.pop();
  return [...SOCLE, ...dossiers.flatMap((d) => ROUTES.get(d) ?? [])];
}

/** Vrai si le chemin pointé (clé complète, ou début de clé finissant par un point)
 *  est couvert par l'un des chemins disponibles. */
function couvert(chemins, cle) {
  const net = cle.replace(/\.$/, '');
  return chemins.some((s) => net === s || net.startsWith(s + '.'));
}

function* fichiers(dossier) {
  for (const nom of readdirSync(dossier)) {
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) yield* fichiers(chemin);
    else if (/\.(ts|tsx)$/.test(nom)) yield chemin;
  }
}

/** Le début écrit en dur du premier argument d'un appel `t(…)`, ou `null` s'il est
 *  entièrement variable. Pour un gabarit, la partie avant le premier `${`. */
function debutDeCle(arg) {
  const lit = arg.match(/^\s*(['"])([^'"]*)\1/);
  if (lit) return lit[2];
  const gab = arg.match(/^\s*`([^`$]*)/);
  if (gab && gab[1]) return gab[1];
  return null;
}

/** Ce que lit un fichier : `besoins` (une clé ou un namespace entier, avec sa ligne) et
 *  `erreurs` de forme, signalées quelle que soit la route. */
function analyser(rel, source) {
  const besoins = [];
  const erreurs = [];
  // Le code sans chaînes ni commentaires, mêmes positions et mêmes lignes : la
  // recherche d'usages d'un traducteur ne doit pas trouver un « t » dans un texte.
  const code = source
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, (s) => ' '.repeat(s.length))
    .replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (s) => ' '.repeat(s.length));
  const ligneDe = (i) => source.slice(0, i).split('\n').length;
  const declarations = [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*useTranslations\(([^)]*)\)/g)];
  // Tout autre appel (traducteur rendu par un hook maison, appelé en ligne,
  // destructuré) échapperait au contrôle : il est refusé plutôt que passé sous silence.
  const reconnus = new Set(declarations.map((m) => m.index + m[0].indexOf('useTranslations')));
  for (const u of code.matchAll(/\buseTranslations\s*\(/g)) {
    if (reconnus.has(u.index)) continue;
    erreurs.push(`${rel}:${ligneDe(u.index)} useTranslations(…) doit être affecté à une constante (\`const t = useTranslations('ns')\`) pour être vérifié.`);
  }
  const calculees = FICHIERS_CLES_CALCULEES.has(rel);
  for (const m of declarations) {
    const [, variable, argBrut] = m;
    const arg = argBrut.trim();
    let ns = '';
    if (arg) {
      const lit = arg.match(/^(['"])([\w.]+)\1$/);
      if (!lit) {
        erreurs.push(`${rel}:${ligneDe(m.index)} useTranslations(${arg}) : le namespace doit être une chaîne écrite en dur.`);
        continue;
      }
      ns = lit[2];
    }
    const declaration = m.index + m[0].indexOf(variable);
    // Un traducteur qui sort de ce fichier (passé à une fonction, rangé dans un objet)
    // y est appelé avec des clés qu'on ne voit pas d'ici : son namespace doit partir
    // entier. C'est ainsi que `themesDossiers`, lu par `libelleTheme(theme, tThemes)`,
    // manquait au navigateur sans que ce script le signale (2026-10-27). Les fichiers
    // à clés calculées passent leurs traducteurs à leurs registres par construction.
    if (!calculees) {
      const usage = new RegExp(`(?<![\\w.$])(?<!typeof\\s+)${variable}(?![\\w$])(?!\\s*(?:\\(|\\.(?:rich|has|markup|raw)\\s*\\(|=(?!=)))`, 'g');
      for (const u of code.matchAll(usage)) {
        if (u.index === declaration) continue;
        if (ns) besoins.push({ ligne: ligneDe(u.index), entier: ns, pourquoi: `${variable} passé hors d'un appel direct` });
        else erreurs.push(`${rel}:${ligneDe(u.index)} ${variable} (sans namespace) est passé hors d'un appel direct : ses clés ne peuvent pas être vérifiées.`);
      }
    }
    // Les appels de ce traducteur : `t(…)`, `t.rich(…)`, `t.has(…)`, `t.markup(…)`.
    const appel = new RegExp(`\\b${variable}(?:\\.(?:rich|has|markup|raw))?\\(([^)]*)`, 'g');
    for (const a of source.matchAll(appel)) {
      if (a.index === declaration) continue;
      const debut = debutDeCle(a[1]);
      if (debut === null) {
        if (calculees) continue;
        if (ns) besoins.push({ ligne: ligneDe(a.index), entier: ns, pourquoi: 'clé variable' });
        else erreurs.push(`${rel}:${ligneDe(a.index)} ${variable}(${a[1].trim().slice(0, 50)}) : clé entièrement variable, impossible à vérifier.`);
        continue;
      }
      const cle = (ns ? ns + '.' : '') + debut;
      // Un début de clé sans point final (`t(\`ns${x}\`)`) ne nomme même pas son
      // namespace : on ne peut rien en dire.
      if (!cle.includes('.') && !ns) continue;
      // Dans un fichier à clés calculées, une clé complétée par une variable
      // (`t(\`pageHeaders.${config.titleKey}\`)`) vient de son registre, que le socle
      // envoie clé par clé.
      if (calculees && debut !== a[1].trim().slice(1, -1)) continue;
      besoins.push({ ligne: ligneDe(a.index), cle });
    }
  }
  return { besoins, erreurs };
}

/** Code sans commentaires, pour lire les imports sans ceux qu'un commentaire cite. */
function sansCommentaires(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

/** Les fichiers de `src/` qu'importe `chemin` à l'exécution : un `import type` ou un
 *  `export type … from` n'apporte aucun code et n'est pas suivi. */
function importsDe(chemin, source) {
  const code = sansCommentaires(source);
  const specs = [];
  for (const m of code.matchAll(/\b(import|export)\s+(type\s+)?[^;'"`]*?\bfrom\s+['"]([^'"]+)['"]/g)) {
    if (!m[2]) specs.push(m[3]);
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  for (const m of code.matchAll(/\bimport\s+['"]([^'"]+)['"]/g)) specs.push(m[1]);
  const sortie = [];
  for (const spec of specs) {
    const base = spec.startsWith('@/') ? join(SRC, spec.slice(2))
      : spec.startsWith('.') ? join(dirname(chemin), spec)
      : null;
    if (!base) continue;
    const trouve = [base, base + '.ts', base + '.tsx', join(base, 'index.ts'), join(base, 'index.tsx')]
      .find((c) => SOURCES.has(c));
    if (trouve) sortie.push(trouve);
  }
  return sortie;
}

const SOURCES = new Map();
for (const chemin of fichiers(SRC)) SOURCES.set(chemin, readFileSync(chemin, 'utf8'));

const IMPORTS = new Map();
for (const [chemin, source] of SOURCES) IMPORTS.set(chemin, importsDe(chemin, source));

// Le code client : les fichiers `'use client'`, puis tout ce qu'ils importent.
const CLIENT = new Set();
const aVisiter = [...SOURCES].filter(([, s]) => /^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*['"]use client['"]/.test(s)).map(([c]) => c);
while (aVisiter.length) {
  const c = aVisiter.pop();
  if (CLIENT.has(c)) continue;
  CLIENT.add(c);
  aVisiter.push(...IMPORTS.get(c));
}

const ANALYSES = new Map();
const erreurs = [];

// Une route listée sans `layout.tsx` qui la nomme n'enverrait rien de sa liste : le
// script la croirait couverte alors que le navigateur n'en reçoit rien.
for (const route of ROUTES.keys()) {
  const layout = join(APP, ...route.split('/'), 'layout.tsx');
  const source = SOURCES.get(layout);
  if (!source || !(source.includes(`'${route}'`) || source.includes(`"${route}"`))) {
    erreurs.push(`TRADUCTIONS_PAR_ROUTE['${route}'] : src/app/[locale]/${route}/layout.tsx doit appeler layoutTraductions('${route}') ou messagesRoute(…, '${route}').`);
  }
}
for (const c of CLIENT) {
  const a = analyser(relative(RACINE, c), SOURCES.get(c));
  ANALYSES.set(c, a);
  erreurs.push(...a.erreurs);
}

/** Contrôle les besoins d'un fichier client contre ce que reçoit sa route. */
function controler(c, chemins, ou, manques) {
  const rel = relative(RACINE, c);
  for (const b of ANALYSES.get(c).besoins) {
    const ok = couvert(chemins, b.entier ?? b.cle);
    if (ok) continue;
    const quoi = b.entier ? `le namespace « ${b.entier} » entier (${b.pourquoi})` : `« ${b.cle} »`;
    const cle = `${rel}:${b.ligne} ${quoi}`;
    if (!manques.has(cle)) manques.set(cle, new Set());
    manques.get(cle).add(ou);
  }
}

const manques = new Map();
const atteints = new Set();
for (const chemin of SOURCES.keys()) {
  if (!chemin.startsWith(APP + sep) || !ENTREES.has(chemin.split(sep).pop())) continue;
  const route = relative(APP, dirname(chemin)).split(sep).join('/');
  const chemins = disponible(route, !chemin.endsWith(sep + 'layout.tsx'));
  const ou = relative(APP, chemin).split(sep).join('/');
  const vus = new Set();
  const pile = [chemin];
  while (pile.length) {
    const c = pile.pop();
    if (vus.has(c)) continue;
    vus.add(c);
    if (CLIENT.has(c)) {
      atteints.add(c);
      controler(c, chemins, ou, manques);
    }
    pile.push(...IMPORTS.get(c));
  }
}

// Un fichier client qu'aucune route n'atteint (code mort, ou import que ce script ne
// sait pas suivre) est contrôlé contre tout ce qui part au navigateur, toutes routes
// confondues : c'est la règle d'avant le tri par route.
const tout = [...SOCLE, ...[...ROUTES.values()].flat()];
for (const c of CLIENT) if (!atteints.has(c)) controler(c, tout, '(aucune route)', manques);

for (const [quoi, ou] of manques) {
  // Trois routes suffisent à situer un manque ; TOUTES_LES_ROUTES=1 les liste toutes.
  const liste = [...ou];
  const n = process.env.TOUTES_LES_ROUTES ? liste.length : 3;
  erreurs.push(`${quoi} manque à ${liste.slice(0, n).join(', ')}${liste.length > n ? ` (+${liste.length - n})` : ''}`);
}

if (erreurs.length) {
  console.error('Traductions lues par le code client mais absentes du navigateur :\n');
  // Deux traducteurs du même nom dans un fichier signaleraient deux fois la même ligne.
  for (const e of new Set(erreurs)) console.error('  ' + e);
  console.error(
    "\nAjouter le namespace (ou la clé, en chemin pointé) à la route qui l'affiche dans\n" +
    'TRADUCTIONS_PAR_ROUTE, ou au socle (NAMESPACES_SOCLE, SOUS_ARBRES_SOCLE) s\'il est lu partout,\n' +
    'dans src/i18n/messages-client.ts. Pour du code serveur, traduire par getTranslations.'
  );
  process.exit(1);
}
console.log(`Traductions côté client : ${CLIENT.size} fichiers client, ${ROUTES.size} routes déclarées, tout est couvert.`);
