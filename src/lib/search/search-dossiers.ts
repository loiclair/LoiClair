// src/lib/search/search-dossiers.ts
// Recherche par mots-clés dans l'index des dossiers, côté navigateur. Rend les
// métadonnées dans l'ordre de pertinence de MiniSearch. Appelée par la liste de
// /dossiers-legislatifs (`DossiersResultsClient`, avec les amendements) et par la
// recherche globale du menu (`RechercheGlobale`, sans).
import type { DossierIndex, DossierMeta } from './dossier-index';
import { chercherAmendements, type AmendementIndex, type AmendementsDuDossier } from './amendement-index';

/** Poids des amendements dans le score d'un texte : son meilleur amendement trouvé, fois
 *  ce poids, s'ajoute au score du texte. Petit, comme les impacts (D-271) : un texte
 *  trouvé par son titre reste devant celui qui ne l'est que par un amendement. Le meilleur
 *  et non la somme : un budget, qui compte des milliers d'amendements, en a sur presque
 *  tous les mots, et remonterait sinon sur chaque recherche. */
const POIDS_AMENDEMENTS = 0.1;

/**
 * `exact` retire la tolérance aux fautes, en gardant la recherche par début de
 * mot et les boosts de l'index. La liste le demande quand elle trie par date :
 * sans le classement par pertinence pour les reléguer en bas, les correspondances
 * approchées (« chasse » qui trouve « classe ») remonteraient en tête.
 */
export async function searchDossiers(
  index: DossierIndex,
  query: string,
  limit = 50,
  { exact = false }: { exact?: boolean } = {}
): Promise<DossierMeta[]> {
  return (await rechercherTextes(index, null, query, limit, { exact })).dossiers;
}

export type ResultatRecherche = {
  dossiers: DossierMeta[];
  /** Par uid de dossier rendu, ses amendements et votes trouvés, du plus pertinent au
   *  moins. Absent pour un texte trouvé par lui seul. */
  amendements: Map<string, AmendementsDuDossier>;
};

/**
 * Les textes trouvés par `query`, eux-mêmes ou par leurs amendements quand `amendements`
 * est chargé. Un texte trouvé par les deux gagne `POIDS_AMENDEMENTS` fois le score de son
 * meilleur amendement ; un texte trouvé par ses seuls amendements entre avec ce score.
 * L'ordre suit le score, à égalité celui de MiniSearch puis celui des amendements.
 * `limit` coupe après la fusion.
 */
export async function rechercherTextes(
  index: DossierIndex,
  amendements: AmendementIndex | null,
  query: string,
  limit = 50,
  { exact = false }: { exact?: boolean } = {}
): Promise<ResultatRecherche> {
  const q = query.trim();
  const vide: ResultatRecherche = { dossiers: [], amendements: new Map() };
  if (!q) return vide;

  // MiniSearch fusionne ces options avec les `searchOptions` de l'index.
  const keywordHits = index.minisearch.search(q, exact ? { fuzzy: false } : undefined) as Array<{ id: string; score: number }>;
  const parDossier = amendements ? chercherAmendements(amendements, q, { exact }) : new Map<string, AmendementsDuDossier>();

  const scores = new Map<string, number>();
  for (const hit of keywordHits) scores.set(hit.id, hit.score);
  for (const [uid, a] of parDossier) scores.set(uid, (scores.get(uid) ?? 0) + POIDS_AMENDEMENTS * a.meilleur);

  // Un dossier absent de la liste (hors liste, ou index des dossiers plus ancien que
  // celui des amendements) est écarté : il n'a pas de ligne où se ranger.
  // `sort` est stable : à score égal, l'ordre d'insertion (texte puis amendements) reste.
  const uids = [...scores.keys()].filter((uid) => index.metadata.has(uid));
  uids.sort((a, b) => scores.get(b)! - scores.get(a)!);

  const dossiers: DossierMeta[] = [];
  const trouves = new Map<string, AmendementsDuDossier>();
  for (const uid of uids) {
    dossiers.push(index.metadata.get(uid)!);
    const a = parDossier.get(uid);
    if (a) trouves.set(uid, a);
    if (dossiers.length >= limit) break;
  }
  return { dossiers, amendements: trouves };
}
