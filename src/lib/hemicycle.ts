// Places des points de l'hémicycle d'un vote (`Scrutins/[uid]/HemicycleVote.tsx`).
//
// La forme est celle du vrai plan : un point au centre de chaque siège de
// `public/hemicycle-an.svg` (582 places) ou du plan du Sénat relevé dans
// `scripts/data/hemicycle-senat-points.json` (348), travées, allée centrale et rangées
// latérales comprises, lus une fois par `scripts/generate-hemicycle-angles.mjs` dans
// `hemicycle-sieges.ts`.
//
// Les élus y sont rangés par groupe, de gauche à droite dans l'ordre où les groupes
// siègent (celui de `ScrutinVotesResponse.groupes`, `rangsHemicycle`), et dans chaque
// groupe par position : les sièges, pris de gauche à droite, sont remplis dans cet ordre.
// Ce ne sont pas les sièges exacts : `acteurs.place_hemicycle` est le siège d'aujourd'hui,
// et un élu parti depuis n'en a plus (mesuré le 2026-11-07 : 545 votants placés sur 570 au
// 10 décembre 2025, 270 sur 348 au Sénat avant le renouvellement de septembre 2026).
//
// Appelé par `SectionsVote`, rendu côté serveur sur la page du vote puis hydraté, et côté
// navigateur seul dans le tiroir. Aucun calcul flottant ici : les coordonnées sont lues
// telles quelles dans le plan figé, si bien que serveur et navigateur rendent le même SVG.
// Calculées par trigonométrie, elles divergeaient au dernier chiffre entre Node et Chrome
// (constaté le 2026-11-07), et l'hydratation échouait.

import type { ScrutinVotesResponse } from '@/lib/scrutin-votes';
import { POSITIONS_SIEGES } from '@/lib/hemicycle-sieges';

/** Rayon extérieur du dessin, en unités du `viewBox` : celui des plans normalisés. */
export const ECHELLE_HEMICYCLE = 100;

/** Un point : ses coordonnées, la position de l'élu (clé de `votes_nominatifs`) et de
 *  quoi le nommer dans la bulle du survol, ou `null` et rien pour un siège que personne
 *  n'occupe dans ce vote. */
export type PointHemicycle = {
  x: number;
  y: number;
  position: string | null;
  elu?: { uid: string; nom: string; groupe: string | null };
};

// Ordre des positions dans un groupe, celui de la barre : les votes exprimés d'abord.
const ORDRE_POSITION: Record<string, number> = {
  pour: 0, contre: 1, abstentions: 2, nonVotants: 3, institutionnels: 4, absents: 5,
};

/**
 * Les sièges que prennent `n` élus parmi ceux du plan, rangés de gauche à droite. Avec
 * moins d'élus que de sièges (sièges vacants, liste partielle du Sénat avant octobre
 * 2023, D-308), les sièges laissés vides sont répartis sur tout l'hémicycle plutôt
 * qu'accumulés au bout droit, où ils se liraient comme l'absence d'un groupe. Avec plus
 * d'élus que de sièges, ce que les plans ne permettent pas (577 députés pour 582 places,
 * 348 sénateurs pour 348), les derniers ne seraient pas dessinés.
 */
function repartir(n: number, total: number): Set<number> {
  const pris = new Set<number>();
  for (let i = 0; i < Math.min(n, total); i++) pris.add(Math.floor(((i + 0.5) * total) / n));
  return pris;
}

/** Le plan d'une chambre sans aucun élu : le squelette que montre le tiroir le temps de
 *  charger les votes, à la place et à la taille exactes de l'hémicycle qui suivra. */
export function planVide(chambre: 'AN' | 'SEN'): { points: PointHemicycle[]; rayon: number } {
  const plan = POSITIONS_SIEGES[chambre];
  return { points: plan.points.map(([x, y]) => ({ x, y, position: null })), rayon: plan.rayon };
}

/** Les points de l'hémicycle d'un vote, un par siège du plan de sa chambre, et leur rayon. */
export function pointsHemicycle(votes: ScrutinVotesResponse, chambre: 'AN' | 'SEN'): {
  points: PointHemicycle[];
  rayon: number;
} {
  // Les élus dans l'ordre des groupes, puis ceux sans groupe ; dans un groupe, par
  // position, l'uid départageant pour un dessin stable d'une génération à l'autre.
  const rangGroupe = new Map(votes.groupes.map((g, i) => [g.uid, i]));
  const sansGroupe = votes.groupes.length;
  const elus = [...votes.elus].sort((a, b) =>
    (rangGroupe.get(a.groupeUid ?? '') ?? sansGroupe) - (rangGroupe.get(b.groupeUid ?? '') ?? sansGroupe)
    || (ORDRE_POSITION[a.position] ?? 9) - (ORDRE_POSITION[b.position] ?? 9)
    || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));

  const sigle = new Map(votes.groupes.map((g) => [g.uid, g.libelleAbrege || g.libelle]));
  const plan = POSITIONS_SIEGES[chambre];
  const pris = repartir(elus.length, plan.points.length);
  let suivant = 0;
  const points = plan.points.map(([x, y], i): PointHemicycle => {
    if (!pris.has(i) || suivant >= elus.length) return { x, y, position: null };
    const e = elus[suivant++];
    return {
      x,
      y,
      position: e.position,
      elu: { uid: e.uid, nom: `${e.prenom ?? ''} ${e.nom ?? ''}`.trim(), groupe: (e.groupeUid && sigle.get(e.groupeUid)) || null },
    };
  });
  return { points, rayon: plan.rayon };
}
