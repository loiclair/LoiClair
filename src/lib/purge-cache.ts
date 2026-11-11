// Garde-fou du disque du VPS. Next garde chaque page générée à la visite sur le disque, à
// l'intérieur du conteneur. Les pages d'amendements à elles seules peuvent peser plus que la
// place libre (mesuré : environ 35 Go au pire, pour 22 Go libres sur 38), et Postgres, sur
// le même disque, s'arrêterait avec lui.
//
// Au-delà du seuil, on efface les pages en cache les plus anciennes, toutes sortes
// confondues, jusqu'à redescendre dix points plus bas : les pages récentes, les plus
// visitées, restent. Une page effacée se refait à sa prochaine visite. Démarré par
// `instrumentation.ts`. `PURGE_CACHE_SEUIL` (pourcentage) règle le seuil sans nouvelle image.

import { readdir, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';

// Next 16.4 range une page générée à la visite sous
// `route-cache/APP_PAGE/<empreinte de la route>/$/<langue>/<chemin>`, en plusieurs fichiers
// (`.html`, `.rsc`, `.meta`, dossier `.segments`) : constaté, ce n'est pas documenté. Le
// code des routes vit ailleurs (`server/app/[locale]/…`) et n'est jamais touché.
const CACHE = path.join(process.cwd(), '.next', 'server', 'route-cache', 'APP_PAGE');
const SEUIL_POURCENT = 70;
const MARGE_POURCENT = 10;
const INTERVALLE_MS = 5 * 60 * 1000;

/** Les fichiers d'une même page partagent ce qui précède `.segments/` ou leur extension. */
const PAGE = /^(.+?)(?:\.segments\/.*|\.[a-z]+)$/;

type Page = { fichiers: string[]; date: number; octets: number };

/** Taille du disque et place à libérer pour redescendre à `cible` %. Comme `df` : la
 *  réserve système ne compte pas comme libre. */
async function disque(cible: number): Promise<{ occupe: number; aLiberer: number }> {
  const s = await statfs(process.cwd());
  const pris = s.blocks - s.bfree;
  const total = pris + s.bavail;
  return { occupe: (pris / total) * 100, aLiberer: Math.max(0, (pris - (cible / 100) * total) * s.bsize) };
}

/** Les pages en cache, de la plus ancienne à la plus récente (date de leur dernière
 *  génération, renouvelée à chaque revalidation d'une page visitée). */
async function pagesParAnciennete(): Promise<Page[]> {
  // Absent tant qu'aucune page n'a été générée depuis le démarrage de l'image.
  const entrees = await readdir(CACHE, { recursive: true, withFileTypes: true }).catch(() => []);
  const pages = new Map<string, Page>();
  for (const e of entrees) {
    if (!e.isFile()) continue;
    const chemin = path.join(e.parentPath, e.name);
    const cle = PAGE.exec(chemin)?.[1] ?? chemin;
    const infos = await stat(chemin).catch(() => null);
    if (!infos) continue;
    const page = pages.get(cle) ?? { fichiers: [], date: 0, octets: 0 };
    page.fichiers.push(chemin);
    page.date = Math.max(page.date, infos.mtimeMs);
    page.octets += infos.size;
    pages.set(cle, page);
  }
  return [...pages.values()].sort((a, b) => a.date - b.date);
}

async function purgerSiNecessaire(): Promise<void> {
  const seuil = Number(process.env.PURGE_CACHE_SEUIL) || SEUIL_POURCENT;
  const { occupe, aLiberer } = await disque(seuil - MARGE_POURCENT);
  if (occupe < seuil) return;
  let libere = 0;
  let effacees = 0;
  for (const page of await pagesParAnciennete()) {
    if (libere >= aLiberer) break;
    await Promise.all(page.fichiers.map((f) => rm(f, { force: true })));
    libere += page.octets;
    effacees += 1;
  }
  // Si le cache ne suffit pas (le disque se remplit d'autre chose), tout est effacé et le
  // message le dit : c'est alors ailleurs qu'il faut chercher.
  console.warn(`Disque à ${Math.round(occupe)} % : ${effacees} pages en cache effacées, ${Math.round(libere / 1e6)} Mo libérés sur ${Math.round(aLiberer / 1e6)} Mo visés.`);
}

/** Lance la surveillance. Une erreur est journalisée sans jamais arrêter le serveur.
 *  `unref` : ce minuteur ne doit pas empêcher le processus de s'arrêter. */
export function demarrerPurgeCache(): void {
  const tour = () => purgerSiNecessaire().catch((e) => console.error('Purge du cache des pages :', e));
  void tour();
  setInterval(tour, INTERVALLE_MS).unref();
}
