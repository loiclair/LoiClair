#!/usr/bin/env node
// Détecte et applique les mises à jour de dépendances, à la place de Dependabot.
//
// Dependabot ne sait travailler que par pull request, et chaque PR laisse sur GitHub
// une référence `refs/pull/*` impossible à supprimer soi-même. Ce script sert donc
// deux chemins qui poussent directement sur `main` :
//
//   node .github/scripts/deps.mjs minor [--dry-run]
//     Appelé chaque lundi par `deps-weekly.yml`. Réécrit `package.json` et
//     `pipeline/requirements.txt` vers la plus haute version stable du même
//     majeur, puis imprime la liste des changements (corps du commit). N'installe
//     rien : le workflow lance `npm install` et `pip install` ensuite.
//
//   node .github/scripts/deps.mjs majors
//     Appelé par `/done` (section du CLAUDE.md du projet). Liste les majeures
//     disponibles pour npm, pip et GitHub Actions, sans rien écrire. `GH_TOKEN` est
//     utilisé s'il est présent (sinon 60 appels par heure à l'API GitHub).
//
// Sans dépendance : `fetch` natif de Node 24. Le script ne lit que les dépendances
// directes ; les transitives passent par `npm audit fix` dans le workflow.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// Majeures qu'on sait bloquées en amont. Elles s'affichent comme « bloquée » et ne
// sont jamais proposées. Retirer l'entrée quand la condition de reprise est remplie.
const IGNORES = {
  'npm:eslint': {
    raison: 'eslint-plugin-react@7.37 exige eslint <=9 (peerDependencies)',
    reprise: 'quand eslint-plugin-react v8 sortira',
  },
  'npm:typescript': {
    raison: 'typescript-eslint@8 exige typescript <6.1.0 et lève « does not support TS 7.0 » au chargement de eslint-config-next',
    reprise: 'quand typescript-eslint publiera le support de TS 7',
  },
};

// Une majeure refusée dans `/done` n'est pas reproposée pendant ce délai. Le fichier
// vit dans le répertoire git commun, donc partagé entre worktrees et jamais commité.
const DELAI_REFUS_JOURS = 7;
const FICHIER_REFUS = 'deps-refus.tsv';

const REQUIREMENTS = 'pipeline/requirements.txt';

// --- Versions ---------------------------------------------------------------

// Une version stable ne porte que des chiffres et des points : on écarte ainsi les
// préversions npm (`13.0.0-beta.1`) comme PyPI (`3.0.0rc1`, `2.1.dev0`, `1.0.post1`).
const estStable = (v) => /^\d+(\.\d+)*$/.test(v);

const parties = (v) => v.split('.').map(Number);

function comparer(a, b) {
  const pa = parties(a), pb = parties(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// Deux versions de même « lignée » sont compatibles au sens semver. Sous 1.0, c'est
// la mineure qui casse (`0.4` → `0.5`), comme le fait déjà `^0.4.6` côté npm.
function lignee(v) {
  const [maj, min] = parties(v);
  return maj === 0 ? `0.${min ?? 0}` : String(maj);
}

const plusHaute = (versions) => versions.reduce((a, b) => (a && comparer(a, b) >= 0 ? a : b), null);

// --- Registres --------------------------------------------------------------

async function lireJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} : HTTP ${res.status}`);
  return res.json();
}

// Format abrégé du registre : il porte `versions`, `deprecated` et `dist-tags`, sans
// le reste du document. Même ainsi, celui de `next` pèse 25 Mo à cause des canaries.
async function versionsNpm(nom) {
  const doc = await lireJson(`https://registry.npmjs.org/${nom.replace('/', '%2F')}`, {
    Accept: 'application/vnd.npm.install-v1+json',
  });
  const latest = doc['dist-tags']?.latest;
  // Plafonné à `latest` : un mainteneur peut publier une version plus haute sans la
  // désigner comme courante (branche de maintenance, publication par erreur).
  const stables = Object.entries(doc.versions)
    .filter(([v, meta]) => estStable(v) && !meta.deprecated && (!latest || comparer(v, latest) <= 0))
    .map(([v]) => v);
  return { stables, latest };
}

// Une release PyPI entièrement retirée (`yanked`) ou sans fichier ne s'installe pas.
async function versionsPip(nom) {
  const doc = await lireJson(`https://pypi.org/pypi/${nom}/json`);
  const stables = Object.entries(doc.releases)
    .filter(([v, fichiers]) => estStable(v) && fichiers.length > 0 && fichiers.some((f) => !f.yanked))
    .map(([v]) => v);
  return { stables, latest: plusHaute(stables) };
}

// `releases/latest` ne convient pas : chez `github/codeql-action` elle rend un tag
// `codeql-bundle-v2.x`. On lit donc tous les tags `v*` et on garde le plus haut.
async function dernierMajeurAction(depot) {
  const headers = { Accept: 'application/vnd.github+json' };
  const jeton = (process.env.GH_TOKEN || '').trim();
  if (jeton) headers.Authorization = `Bearer ${jeton}`;
  const refs = await lireJson(`https://api.github.com/repos/${depot}/git/matching-refs/tags/v`, headers);
  const majeurs = refs
    .map((r) => r.ref.replace('refs/tags/v', ''))
    .filter(estStable)
    .map((v) => parties(v)[0]);
  return Math.max(...majeurs);
}

// --- Lecture du dépôt -------------------------------------------------------

function lirePackageJson() {
  const texte = readFileSync('package.json', 'utf8');
  const pkg = JSON.parse(texte);
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const deps = [];
  for (const section of ['dependencies', 'devDependencies']) {
    for (const [nom, spec] of Object.entries(pkg[section] ?? {})) {
      // La version réellement installée vient du lockfile : `^4` ne dit pas laquelle.
      const actuelle = lock.packages?.[`node_modules/${nom}`]?.version;
      if (actuelle && estStable(actuelle)) deps.push({ nom, spec, actuelle, section });
    }
  }
  return { pkg, deps };
}

// Ne lit que les lignes épinglées `nom==version` (extras compris, `psycopg[binary]`) :
// c'est la seule forme présente, et une borne `>=` n'aurait pas de version courante.
function lireRequirements() {
  const lignes = readFileSync(REQUIREMENTS, 'utf8').split('\n');
  const deps = [];
  lignes.forEach((ligne, i) => {
    const m = ligne.match(/^([A-Za-z0-9_.-]+)(\[[^\]]*\])?==([^\s#]+)/);
    if (m) deps.push({ nom: m[1], actuelle: m[3], index: i });
  });
  return { lignes, deps };
}

// Actions référencées par un majeur flottant (`@v7`). Une action épinglée sur un SHA
// ou une version complète ne serait pas comparable ainsi, et le dépôt n'en a pas.
function lireActions() {
  const dossier = '.github/workflows';
  const actions = new Map();
  for (const fichier of readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f))) {
    const texte = readFileSync(`${dossier}/${fichier}`, 'utf8');
    for (const m of texte.matchAll(/uses:\s*([\w.-]+\/[\w.-]+)(?:\/[\w./-]+)?@v(\d+)\s*$/gm)) {
      const [, depot, majeur] = m;
      const courant = actions.get(depot);
      if (!courant || Number(majeur) < courant) actions.set(depot, Number(majeur));
    }
  }
  return [...actions].map(([depot, majeur]) => ({ depot, majeur }));
}

// --- Mode minor -------------------------------------------------------------

async function modeMinor(dryRun) {
  const changements = [];

  const { pkg, deps: depsNpm } = lirePackageJson();
  await Promise.all(depsNpm.map(async (d) => {
    const { stables } = await versionsNpm(d.nom);
    const cible = plusHaute(stables.filter((v) => lignee(v) === lignee(d.actuelle)));
    if (!cible || comparer(cible, d.actuelle) <= 0) return;
    // Le préfixe est gardé (`^`, `~` ou rien) : `next` et `eslint-config-next` restent
    // figés sur une version exacte. Une borne courte (`^4`) devient complète, sinon
    // `npm install` garderait la version du lockfile qui la satisfait déjà.
    const prefixe = d.spec.match(/^[\^~]?/)[0];
    pkg[d.section][d.nom] = `${prefixe}${cible}`;
    changements.push(`npm  ${d.nom} ${d.actuelle} → ${cible}`);
  }));

  const { lignes, deps: depsPip } = lireRequirements();
  await Promise.all(depsPip.map(async (d) => {
    const { stables } = await versionsPip(d.nom);
    const cible = plusHaute(stables.filter((v) => lignee(v) === lignee(d.actuelle)));
    if (!cible || comparer(cible, d.actuelle) <= 0) return;
    lignes[d.index] = lignes[d.index].replace(`==${d.actuelle}`, `==${cible}`);
    changements.push(`pip  ${d.nom} ${d.actuelle} → ${cible}`);
  }));

  changements.sort();
  if (!dryRun && changements.length > 0) {
    writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
    writeFileSync(REQUIREMENTS, lignes.join('\n'));
  }
  for (const c of changements) console.log(`- ${c}`);
}

// --- Mode majors ------------------------------------------------------------

// Lit les refus récents consignés par `/done` : une ligne `écosystème<TAB>nom<TAB>date ISO`.
// Hors d'un dépôt git, ou sans fichier, aucun refus.
function refusRecents() {
  try {
    const dir = execFileSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    const limite = Date.now() - DELAI_REFUS_JOURS * 86_400_000;
    return new Set(
      readFileSync(`${dir}/${FICHIER_REFUS}`, 'utf8')
        .split('\n')
        .map((l) => l.split('\t'))
        .filter(([eco, nom, date]) => eco && nom && Date.parse(date) >= limite)
        .map(([eco, nom]) => `${eco}:${nom}`),
    );
  } catch {
    return new Set();
  }
}

async function modeMajors() {
  const trouvees = [];

  const { deps: depsNpm } = lirePackageJson();
  const { deps: depsPip } = lireRequirements();
  await Promise.all([
    ...depsNpm.map(async (d) => {
      const { latest } = await versionsNpm(d.nom);
      if (latest && estStable(latest) && lignee(latest) !== lignee(d.actuelle) && comparer(latest, d.actuelle) > 0) {
        trouvees.push({ eco: 'npm', nom: d.nom, de: d.actuelle, vers: latest });
      }
    }),
    ...depsPip.map(async (d) => {
      const { latest } = await versionsPip(d.nom);
      if (latest && lignee(latest) !== lignee(d.actuelle) && comparer(latest, d.actuelle) > 0) {
        trouvees.push({ eco: 'pip', nom: d.nom, de: d.actuelle, vers: latest });
      }
    }),
    ...lireActions().map(async (a) => {
      const dernier = await dernierMajeurAction(a.depot);
      if (dernier > a.majeur) trouvees.push({ eco: 'actions', nom: a.depot, de: `v${a.majeur}`, vers: `v${dernier}` });
    }),
  ]);

  const refus = refusRecents();
  trouvees.sort((a, b) => `${a.eco}:${a.nom}`.localeCompare(`${b.eco}:${b.nom}`));
  for (const t of trouvees) {
    const cle = `${t.eco}:${t.nom}`;
    const ligne = `${t.eco}  ${t.nom} ${t.de} → ${t.vers}`;
    if (IGNORES[cle]) console.log(`bloquée  ${ligne} : ${IGNORES[cle].raison}. Reprise : ${IGNORES[cle].reprise}.`);
    else if (refus.has(cle)) console.log(`refusée  ${ligne} (refus de moins de ${DELAI_REFUS_JOURS} jours)`);
    else console.log(`majeure  ${ligne}`);
  }
}

// --- Entrée -----------------------------------------------------------------

const [mode, ...options] = process.argv.slice(2);
if (mode === 'minor') await modeMinor(options.includes('--dry-run'));
else if (mode === 'majors') await modeMajors();
else {
  console.error('Usage : node .github/scripts/deps.mjs minor [--dry-run] | majors');
  process.exit(2);
}
