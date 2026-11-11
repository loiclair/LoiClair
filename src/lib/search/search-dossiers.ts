// src/lib/search/search-dossiers.ts
// Recherche par mots-clés dans l'index des dossiers, côté navigateur. Rend les
// métadonnées dans l'ordre de pertinence de MiniSearch. Appelée par la liste de
// /dossiers-legislatifs (`DossiersResultsClient`).
import type { DossierIndex, DossierMeta } from './dossier-index';

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
  const q = query.trim();
  if (!q) return [];

  // MiniSearch fusionne ces options avec les `searchOptions` de l'index.
  const keywordHits = index.minisearch.search(q, exact ? { fuzzy: false } : undefined) as Array<{ id: string }>;

  const results: DossierMeta[] = [];
  for (const hit of keywordHits) {
    const meta = index.metadata.get(hit.id);
    if (meta) results.push(meta);
    if (results.length >= limit) break;
  }
  return results;
}
