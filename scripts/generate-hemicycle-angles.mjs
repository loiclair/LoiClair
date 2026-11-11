/**
 * Génère src/lib/hemicycle-angles.ts : l'angle de chaque siège dans les plans de
 * l'hémicycle (public/hemicycle-an.svg, public/hemicycle-senat.svg). Il sert à
 * ranger les groupes de gauche à droite selon les sièges de leurs élus
 * (`src/lib/groupes-ordre.ts`), sans liste de groupes à tenir à la main.
 *
 * Angle en degrés, vu depuis le pied de l'hémicycle : 0 au bout gauche, 180 au
 * bout droit. Centre de l'arc : milieu horizontal des sièges, à la hauteur du
 * siège le plus bas. Un siège de l'Assemblée est un tracé : sa position est la
 * moyenne des points de ce tracé ; un siège du Sénat est un cercle, son centre.
 * Méthode vérifiée le 2026-10-25 : elle redonne l'ordre que publient les deux
 * chambres pour tous les groupes en exercice.
 *
 * Écrit aussi src/lib/hemicycle-sieges.ts : la position de chaque siège, pour dessiner
 * l'hémicycle de la page d'un vote (`lib/hemicycle.ts`) sur la forme du vrai plan. Pour
 * le Sénat, ces positions-là viennent de scripts/data/hemicycle-senat-points.json (voir
 * `siegesSenatPlan`), pas du plan SVG.
 *
 * À relancer seulement si un plan change : un changement de groupe, lui, se lit
 * dans `acteurs.place_hemicycle` et ne demande rien ici.
 *
 * Usage : node scripts/generate-hemicycle-angles.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = (fichier) => fs.readFileSync(path.join(racine, 'public', fichier), 'utf-8');

function siegesAN() {
  const sieges = new Map();
  for (const m of lire('hemicycle-an.svg').matchAll(/<path[^>]*?d="([^"]+)"[^>]*place="(\d+)"/g)) {
    const points = [...m[1].matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)].map((p) => [Number(p[1]), Number(p[2])]);
    const moyenne = (i) => points.reduce((s, p) => s + p[i], 0) / points.length;
    sieges.set(Number(m[2]), [moyenne(0), moyenne(1)]);
  }
  return sieges;
}

function siegesSenat() {
  const sieges = new Map();
  for (const m of lire('hemicycle-senat.svg').matchAll(/<circle place="(\d+)" cx="([\d.]+)" cy="([\d.]+)"/g)) {
    sieges.set(Number(m[1]), [Number(m[2]), Number(m[3])]);
  }
  return sieges;
}

// Un plan lu à vide (balisage changé) donnerait un fichier vide sans erreur : on s'arrête.
function angles(sieges, nom) {
  if (sieges.size < 300) throw new Error(`${nom} : ${sieges.size} sièges lus, le plan a changé de forme`);
  const xs = [...sieges.values()].map((s) => s[0]);
  const ys = [...sieges.values()].map((s) => s[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = Math.max(...ys);
  const out = {};
  for (const [place, [x, y]] of [...sieges].sort((a, b) => a[0] - b[0])) {
    out[place] = Math.round((Math.atan2(cy - y, cx - x) * 180) / Math.PI * 10) / 10;
  }
  return out;
}

const an = angles(siegesAN(), 'Assemblée');
const senat = angles(siegesSenat(), 'Sénat');

const contenu = `// Généré par scripts/generate-hemicycle-angles.mjs, ne pas modifier à la main.
// Angle de chaque siège (clé : numéro de place, comme \`acteurs.place_hemicycle\`),
// en degrés : 0 au bout gauche de l'hémicycle, 180 au bout droit.

export const ANGLES_SIEGES: Record<'AN' | 'SEN', Record<number, number>> = {
  AN: ${JSON.stringify(an)},
  SEN: ${JSON.stringify(senat)},
};
`;
fs.writeFileSync(path.join(racine, 'src', 'lib', 'hemicycle-angles.ts'), contenu);
console.log(`src/lib/hemicycle-angles.ts : ${Object.keys(an).length} sièges AN, ${Object.keys(senat).length} sièges Sénat`);

// Positions des sièges pour l'hémicycle de la page d'un vote (`lib/hemicycle.ts`) : le
// même centre que pour les angles, l'échelle ramenée à 100 pour le siège le plus éloigné,
// y vers le haut négatif comme en SVG. Rangées de gauche à droite (par angle, puis du
// centre vers le bord), sans numéro de place : la page y range les élus par groupe, pas
// à leur siège. Le rayon d'un point vient de l'écart médian entre sièges voisins.
function positions(sieges, nom) {
  if (sieges.size < 300) throw new Error(`${nom} : ${sieges.size} sièges lus, le plan a changé de forme`);
  const xs = [...sieges.values()].map((s) => s[0]);
  const ys = [...sieges.values()].map((s) => s[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = Math.max(...ys);
  const loin = Math.max(...[...sieges.values()].map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const echelle = 100 / loin;
  const pts = [...sieges.values()].map(([x, y]) => [(x - cx) * echelle, (y - cy) * echelle]);
  // `-y || 0` : un siège de la rangée la plus basse a y = 0, et -0 ferait rendre -π à
  // `atan2` au lieu de π pour celui de gauche, qui passerait alors en dernier et
  // recevrait l'élu le plus à droite.
  const angle = ([x, y]) => Math.atan2(-y || 0, x);
  pts.sort((a, b) => angle(b) - angle(a) || Math.hypot(...a) - Math.hypot(...b));
  const voisins = pts.map((p) => Math.min(...pts.filter((q) => q !== p).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])))).sort((a, b) => a - b);
  const median = voisins[Math.floor(voisins.length / 2)];
  const arrondi = (v) => Math.round(v * 10) / 10;
  return { points: pts.map(([x, y]) => [arrondi(x), arrondi(y)]), rayon: Math.round(median * 0.4 * 100) / 100 };
}

// Pour le Sénat, pas `hemicycle-senat.svg` : ce plan-là est une approximation en arcs
// réguliers (`generate-hemicycle-senat.mjs`), bonne pour situer un siège sur la fiche d'un
// élu, mais loin du vrai dessin (rangées basses en colonnes, allée centrale). Les points
// viennent du plan du Sénat qu'Alex a fourni le 2026-11-08, relevés un par un sur l'image
// (centre de chaque pastille, 348 points) dans `scripts/data/hemicycle-senat-points.json`.
// Ce plan ne porte pas de numéros de place : il ne sert qu'à la page d'un vote.
function siegesSenatPlan() {
  const points = JSON.parse(fs.readFileSync(path.join(racine, 'scripts', 'data', 'hemicycle-senat-points.json'), 'utf-8'));
  return new Map(points.map((p, i) => [i + 1, p]));
}

const posAN = positions(siegesAN(), 'Assemblée');
const posSenat = positions(siegesSenatPlan(), 'Sénat');
const contenuPositions = `// Généré par scripts/generate-hemicycle-angles.mjs, ne pas modifier à la main.
// Position de chaque siège des plans de l'hémicycle (public/hemicycle-an.svg pour
// l'Assemblée, scripts/data/hemicycle-senat-points.json pour le Sénat), de gauche à
// droite : centre du demi-cercle en (0, 0), siège le plus éloigné à 100, y négatif vers le
// haut. \`rayon\` : rayon d'un point qui laisse de l'air entre deux sièges voisins.

export const POSITIONS_SIEGES: Record<'AN' | 'SEN', { points: [number, number][]; rayon: number }> = {
  AN: ${JSON.stringify(posAN)},
  SEN: ${JSON.stringify(posSenat)},
};
`;
fs.writeFileSync(path.join(racine, 'src', 'lib', 'hemicycle-sieges.ts'), contenuPositions);
console.log(`src/lib/hemicycle-sieges.ts : ${posAN.points.length} sièges AN (rayon ${posAN.rayon}), ${posSenat.points.length} sièges Sénat (rayon ${posSenat.rayon})`);
