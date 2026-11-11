/**
 * Génère src/lib/logos-groupes.ts : l'extension du logo de chaque groupe, lue dans
 * public/images/groupes/{uid}.{ext}. `GroupLogoImage` s'en sert pour viser le bon
 * fichier sans sonder les extensions. Ajouter un logo, c'est déposer son fichier.
 *
 * Lancé par npm avant `dev`, `build` et `typecheck` (`predev`, `prebuild`,
 * `pretypecheck`) : le build de production réécrit donc toujours la table depuis le
 * dossier. Le fichier généré est quand même versionné, parce qu'un `npx next dev`
 * lancé sans passer par npm le lirait absent et planterait.
 *
 * `--verifier` n'écrit rien et échoue si le fichier versionné ne suit pas le dossier.
 * `npm run lint:strict` le lance, avant que `typecheck` ou `build` ne régénère la
 * table : sans lui, un logo commité sans sa table passerait la CI sans qu'on le voie.
 *
 * Usage : node scripts/generate-logos-groupes.mjs [--verifier]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOSSIER = 'public/images/groupes';
const CIBLE = 'src/lib/logos-groupes.ts';

const erreurs = [];
const logos = new Map();

// Les fichiers cachés (.DS_Store sur macOS) ne sont pas des logos. Un sous-dossier, un
// fichier sans extension ou au nom inattendu (« PO1 copie.png ») ne peut pas être servi
// par `{uid}.{ext}` : la commande échoue, donc le build, plutôt que de l'ignorer. Une
// extension qui n'est pas une image (« PO1.pdf », « PO1.ai ») échoue de même, sinon le
// composant la servirait dans un <img> et afficherait une image cassée.
// Deux fichiers d'un même uid (PO1.png et PO1.svg) échouent aussi : un seul serait
// affiché, sans que rien ne dise lequel.
for (const entree of fs.readdirSync(path.join(racine, DOSSIER), { withFileTypes: true })) {
  const f = entree.name;
  if (f.startsWith('.')) continue;
  const m = f.match(/^(\w+)\.(svg|png|jpe?g|webp|gif|avif)$/i);
  if (!entree.isFile() || !m) {
    erreurs.push(`${DOSSIER}/${f} n'est pas une image {uid}.{svg,png,jpg,jpeg,webp,gif,avif} : le renommer ou le déplacer hors du dossier`);
    continue;
  }
  const [, uid, ext] = m;
  if (logos.has(uid)) {
    erreurs.push(`${uid} a deux fichiers (${uid}.${logos.get(uid)} et ${f}) : n'en garder qu'un`);
    continue;
  }
  logos.set(uid, ext);
}

if (erreurs.length) {
  console.error(`Logos de groupes : ${DOSSIER}/ contient des fichiers inutilisables\n`);
  for (const e of erreurs) console.error('  ' + e);
  process.exit(1);
}

// Tri par uid : l'ordre de readdir varie selon le système, il ne doit pas produire
// d'écart dans le fichier versionné.
const lignes = [...logos].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([uid, ext]) => `  ${uid}: '${ext}',`);
const contenu = `// Généré par scripts/generate-logos-groupes.mjs, ne pas modifier à la main.
// Extension du logo de chaque groupe (clé : uid du groupe), lue dans ${DOSSIER}/.

export const LOGOS: Record<string, string> = {
${lignes.join('\n')}
};
`;

// Rien n'est écrit quand la table n'a pas changé : une écriture, même identique, est
// un événement pour un serveur de dev déjà lancé qui surveille src/ (cas d'un
// `npm run typecheck` pendant qu'il tourne).
const chemin = path.join(racine, CIBLE);
const actuel = fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf-8') : null;
if (actuel === contenu) {
  console.log(`${CIBLE} : ${logos.size} logos, inchangé`);
} else if (process.argv.includes('--verifier')) {
  console.error(`${CIBLE} ne suit pas ${DOSSIER}/ : lancer node scripts/generate-logos-groupes.mjs et commiter le fichier`);
  process.exit(1);
} else {
  fs.writeFileSync(chemin, contenu);
  console.log(`${CIBLE} : ${logos.size} logos, réécrit`);
}
