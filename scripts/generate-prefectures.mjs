/**
 * Génère src/lib/prefectures.ts : la préfecture de chaque département, placée
 * dans les coordonnées de public/departements.svg. Le zoom départemental de la
 * fiche élu (CarteDepartementZoom) y pose son point sans aucun calcul.
 *
 * Sources (licence ouverte Etalab) :
 * - chef-lieu de chaque département : COG 2025 de l'INSEE, colonne CHEFLIEU ;
 * - position du chef-lieu : `centre` de la commune sur geo.api.gouv.fr ;
 * - emprise géographique d'un département : union des `bbox` de ses communes,
 *   sur geo.api.gouv.fr.
 *
 * Correspondance géographie → SVG, constatée sur le fichier (2026-10-24) :
 * - la métropole est dessinée en Lambert-93 : un ajustement affine unique sur
 *   les emprises des départements tombe à moins d'une unité de carte en moyenne ;
 * - Paris et la petite couronne forment un encart agrandi, la Corse est
 *   déplacée, chaque outre-mer a son encart : chacun de ces groupes est calé à
 *   part, emprise géographique sur emprise du tracé ;
 * - le Finistère, le Morbihan et la Vendée perdent des îles dans le tracé
 *   (Ouessant, Belle-Île, Yeu) : ils sont exclus de l'ajustement, qui reste
 *   valable pour eux puisqu'il est global.
 * 977 et les collectivités du Pacifique ne sont que des pastilles rondes dans
 * le SVG, sans tracé : pas de zoom pour eux.
 *
 * Contrôle : chaque préfecture doit tomber à l'intérieur de son tracé, sinon le
 * script s'arrête.
 *
 * Usage : node scripts/generate-prefectures.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SVG = path.join(__dirname, '../public/departements.svg');
const OUT = path.join(__dirname, '../src/lib/prefectures.ts');

const COG = 'https://www.insee.fr/fr/statistiques/fichier/8377162/v_departement_2025.csv';
const GEO = 'https://geo.api.gouv.fr';

// Saint-Pierre-et-Miquelon est une collectivité, absente du fichier des
// départements du COG, mais son tracé existe dans le SVG.
const HORS_COG = [{ dep: '975', chefLieu: '97502' }];

// Encarts du SVG, calés chacun sur leur propre emprise.
const ENCARTS = [['75', '92', '93', '94'], ['2A', '2B']];
const ILES_ABSENTES = ['29', '56', '85'];

// ─── Tracés du SVG ────────────────────────────────────────────────────────────

/** Lit un attribut `d` (commandes m, l, h, v, c, z) en anneaux de points absolus ; les courbes sont échantillonnées. */
function lireTrace(d) {
  const jetons = d.match(/-?(?:\d+\.\d*|\.\d+|\d+)(?:e[-+]?\d+)?|[a-zA-Z]/g);
  const anneaux = [];
  let i = 0, cmd = '', x = 0, y = 0, x0 = 0, y0 = 0, anneau = null;
  const n = () => parseFloat(jetons[i++]);
  while (i < jetons.length) {
    if (/^[a-zA-Z]$/.test(jetons[i])) cmd = jetons[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toLowerCase()) {
      case 'm': {
        const a = n(), b = n();
        x = rel ? x + a : a; y = rel ? y + b : b; x0 = x; y0 = y;
        anneau = [[x, y]]; anneaux.push(anneau);
        // Les paires qui suivent un moveto sont des lineto implicites.
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'l': { const a = n(), b = n(); x = rel ? x + a : a; y = rel ? y + b : b; anneau.push([x, y]); break; }
      case 'h': { const a = n(); x = rel ? x + a : a; anneau.push([x, y]); break; }
      case 'v': { const b = n(); y = rel ? y + b : b; anneau.push([x, y]); break; }
      case 'c': {
        const p = [n(), n(), n(), n(), n(), n()];
        const [x1, y1, x2, y2, x3, y3] = rel ? p.map((v, k) => v + (k % 2 ? y : x)) : p;
        for (let k = 1; k <= 8; k++) {
          const t = k / 8, u = 1 - t;
          anneau.push([
            u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
          ]);
        }
        x = x3; y = y3;
        break;
      }
      case 'z': x = x0; y = y0; break;
      default: throw new Error(`Commande de tracé non gérée : ${cmd}`);
    }
  }
  return anneaux;
}

// Coordonnées brutes du tracé, sans le `transform` éventuel (Mayotte en porte
// un) : le zoom dessine le `d` seul, c'est donc dans ce repère qu'il faut placer le point.
const traces = {};
for (const m of fs.readFileSync(SVG, 'utf8').matchAll(/<path\s([^>]*?)>/gs)) {
  const d = m[1].match(/\sd="([^"]*)"/);
  const id = m[1].match(/id="d([^"]*)"/);
  // Un arc (`a`) signale une pastille ronde, pas un tracé.
  if (d && id && !/[aA]/.test(d[1])) traces[id[1]] = lireTrace(d[1]);
}

const emprise = (pts) => pts.reduce(
  ([x0, y0, x1, y1], [x, y]) => [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)],
  [Infinity, Infinity, -Infinity, -Infinity],
);

/** Pair-impair sur tous les anneaux : vrai si le point est dans le tracé. */
function dansTrace(anneaux, [px, py]) {
  let dedans = false;
  for (const a of anneaux) {
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const [xi, yi] = a[i], [xj, yj] = a[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) dedans = !dedans;
    }
  }
  return dedans;
}

// ─── Projections ──────────────────────────────────────────────────────────────

const RAD = Math.PI / 180;

/** Lambert-93 sur la sphère (parallèles 44° et 49°, origine 3° E, 46,5° N), y vers le bas comme le SVG. */
function lambert93([lon, lat]) {
  const p1 = 44 * RAD, p2 = 49 * RAD;
  const t = (p) => Math.tan(Math.PI / 4 + p / 2);
  const n = Math.log(Math.cos(p1) / Math.cos(p2)) / Math.log(t(p2) / t(p1));
  const F = (Math.cos(p1) * Math.pow(t(p1), n)) / n;
  const rho = (p) => F / Math.pow(t(p), n);
  const r = rho(lat * RAD), th = n * (lon * RAD - 3 * RAD);
  return [r * Math.sin(th), -(rho(46.5 * RAD) - r * Math.cos(th))];
}

// Loin de la métropole, Lambert-93 fait tourner les méridiens : chaque
// outre-mer est calé en longitude et latitude brutes, l'échelle propre à
// chaque axe absorbant la déformation sur une si petite emprise.
const brut = ([lon, lat]) => [lon, -lat];

/** Moindres carrés à trois inconnues (x = a·X + b·Y + c), par la règle de Cramer. */
function moindresCarres(lignes, cibles) {
  const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], v = [0, 0, 0];
  lignes.forEach((r, k) => {
    for (let i = 0; i < 3; i++) {
      v[i] += r[i] * cibles[k];
      for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j];
    }
  });
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(M);
  return [0, 1, 2].map((c) => det(M.map((row, i) => row.map((x, j) => (j === c ? v[i] : x)))) / D);
}

// ─── Données géographiques ────────────────────────────────────────────────────

async function lire(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} : HTTP ${r.status}`);
  return r;
}
const json = async (url) => (await lire(url)).json();

const csv = await (await lire(COG)).text();
const deps = csv.trim().split('\n').slice(1)
  .map((l) => l.split(',').map((c) => c.replace(/"/g, '')))
  .map((c) => ({ dep: c[0], chefLieu: c[2] }))
  .concat(HORS_COG)
  .filter(({ dep }) => traces[dep]);

// Un COG déplacé ou au format changé ne lève rien : les lignes illisibles sont
// filtrées, et le fichier serait réécrit avec quelques entrées seulement, ce
// qui retirerait le zoom de presque toutes les fiches sans le moindre message.
const sansChefLieu = Object.keys(traces).filter((t) => !deps.some((d) => d.dep === t));
if (sansChefLieu.length) throw new Error(`Tracé sans chef-lieu dans le COG : ${sansChefLieu.join(', ')}`);

const geo = {};
for (const { dep, chefLieu } of deps) {
  const communes = await json(`${GEO}/departements/${dep}/communes?fields=bbox`);
  const cl = await json(`${GEO}/communes/${chefLieu}?fields=nom,centre`);
  geo[dep] = { bbox: communes.flatMap((c) => c.bbox.coordinates[0]), nom: cl.nom, centre: cl.centre.coordinates };
}

// ─── Calage ───────────────────────────────────────────────────────────────────

const calages = {}; // dep → (X, Y) projetés → [x, y] dans le SVG

/** Emprise géographique du groupe sur emprise de ses tracés, échelle propre à chaque axe. */
function calerEncart(groupe, proj) {
  const [gx0, gy0, gx1, gy1] = emprise(groupe.flatMap((d) => geo[d].bbox.map(proj)));
  const [sx0, sy0, sx1, sy1] = emprise(groupe.flatMap((d) => traces[d].flat()));
  const f = ([X, Y]) => [sx0 + ((X - gx0) * (sx1 - sx0)) / (gx1 - gx0), sy0 + ((Y - gy0) * (sy1 - sy0)) / (gy1 - gy0)];
  for (const d of groupe) calages[d] = (lonlat) => f(proj(lonlat));
}

const outreMer = deps.map((d) => d.dep).filter((d) => d.startsWith('97'));
for (const d of outreMer) calerEncart([d], brut);
for (const g of ENCARTS) calerEncart(g, lambert93);

// Métropole : un ajustement affine unique, coins des emprises projetées sur
// coins des emprises des tracés.
const metropole = deps.map((d) => d.dep).filter((d) => !calages[d]);
const lignes = [], cx = [], cy = [];
for (const d of metropole.filter((d) => !ILES_ABSENTES.includes(d))) {
  const g = emprise(geo[d].bbox.map(lambert93));
  const s = emprise(traces[d].flat());
  for (const [i, j] of [[0, 1], [2, 1], [0, 3], [2, 3]]) {
    lignes.push([g[i], g[j], 1]); cx.push(s[i]); cy.push(s[j]);
  }
}
const ax = moindresCarres(lignes, cx), ay = moindresCarres(lignes, cy);
for (const d of metropole) {
  calages[d] = (lonlat) => {
    const [X, Y] = lambert93(lonlat);
    return [ax[0] * X + ax[1] * Y + ax[2], ay[0] * X + ay[1] * Y + ay[2]];
  };
}

// ─── Sortie ───────────────────────────────────────────────────────────────────

const lignesTs = [];
const horsTrace = [];
for (const { dep } of deps.sort((a, b) => a.dep.localeCompare(b.dep))) {
  const [x, y] = calages[dep](geo[dep].centre);
  if (!dansTrace(traces[dep], [x, y])) horsTrace.push(`${dep} (${geo[dep].nom})`);
  lignesTs.push(`  '${dep}': { nom: ${JSON.stringify(geo[dep].nom)}, x: ${x.toFixed(2)}, y: ${y.toFixed(2)} },`);
}
if (horsTrace.length) throw new Error(`Préfecture hors de son tracé : ${horsTrace.join(', ')}`);

fs.writeFileSync(OUT, `/**
 * Préfecture de chaque département, placée dans les coordonnées des tracés de
 * public/departements.svg (sans leur \`transform\`). Lue par le zoom
 * départemental de la fiche élu (CarteDepartementZoom).
 *
 * Fichier généré par scripts/generate-prefectures.mjs (sources et méthode dans
 * son en-tête) : ne pas l'éditer à la main, relancer
 * \`node scripts/generate-prefectures.mjs\`. Clés : l'identifiant du tracé
 * sans son « d », soit le num_departement de l'élu.
 */

export interface Prefecture {
  nom: string;
  x: number;
  y: number;
}

export const PREFECTURES: Record<string, Prefecture> = {
${lignesTs.join('\n')}
};
`);
console.log(`✅ ${lignesTs.length} préfectures écrites dans ${path.relative(process.cwd(), OUT)}`);
