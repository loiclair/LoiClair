// src/lib/mcp/cache.ts
//
// Cache des réponses du serveur MCP, sur le Redis Upstash déjà en place pour les
// limiteurs de débit.
//
// Pourquoi pas le cache du CDN : MCP dialogue en POST, et un CDN ne met en cache
// que les GET. Les en-têtes `s-maxage` qui protègent `/api/search-index/*` ne
// s'appliqueraient donc jamais ici.
//
// Pourquoi pas `use cache` de Next : la directive exige d'activer
// `cacheComponents`, ce qui changerait le rendu des trente-cinq pages
// `force-static` du site pour le bénéfice d'une seule route.
//
// Appelé par les trois modules d'outils.

import { createHash } from 'node:crypto';
import { PREFIXE_REDIS, redis } from '@/lib/rate-limit';

/**
 * Six heures. Les données ne bougent qu'une fois par nuit : une durée plus
 * courte ferait payer des recalculs pour une valeur identique, une durée de
 * 24 h servirait les chiffres de la veille toute la journée du lendemain.
 */
export const TTL_COURT = 6 * 60 * 60;

/** Douze heures, pour les agrégats de législature qui bougent de quelques dixièmes par nuit. */
export const TTL_LONG = 12 * 60 * 60;

/**
 * Version de toutes les clés. La changer invalide le cache entier d'un coup :
 * c'est la seule purge globale du serveur, et elle doit rester à un endroit.
 * À incrémenter dès que la forme d'une enveloppe change, sinon des réponses
 * d'une ancienne forme survivent jusqu'à douze heures (`TTL_LONG`).
 *
 * La purge n'est globale que si toutes les clés passent par `cleCache`. Deux
 * lectures qui ne dépendent d'aucun argument (la liste des cumulards, la date
 * de synchronisation) l'appellent donc sans arguments plutôt que d'écrire leur
 * clé à la main, sans quoi elles survivraient à l'incrément.
 */
const VERSION = 'v8';

/**
 * Clé de cache d'un appel d'outil.
 *
 * Les arguments sont triés avant d'être empreintés : `{nom, chambre}` et
 * `{chambre, nom}` décrivent le même appel et doivent tomber sur la même clé.
 * Empreinte tronquée à 12 caractères, comme l'index de recherche des dossiers
 * le fait déjà pour sa version de payload.
 */
export function cleCache(outil: string, args: Record<string, unknown> = {}): string {
  const entrees = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entrees.length === 0) return `${PREFIXE_REDIS}mcp:${VERSION}:${outil}`;
  const empreinte = createHash('sha1')
    .update(JSON.stringify(entrees))
    .digest('base64url')
    .slice(0, 12);
  return `${PREFIXE_REDIS}mcp:${VERSION}:${outil}:${empreinte}`;
}

/**
 * Enveloppe de stockage.
 *
 * Redis rend `null` aussi bien pour une clé absente que pour un `null` rangé :
 * sans ce niveau, un identifiant inconnu (qui vaut `null`) n'est jamais lu
 * depuis le cache, et chaque appel relance les cinq requêtes de la fiche. Le
 * champ existe pour que la présence de l'objet, et non la valeur, dise que la
 * clé était là.
 */
type Range<T> = { v: T };

/**
 * Rend la valeur en cache, ou la calcule et la range.
 *
 * Une panne de Redis ne fait jamais échouer une réponse : le cache n'est qu'un
 * accélérateur, la base reste la source de vérité. C'est l'inverse du contrat de
 * `lignesOuLeve`, qui lève sur une panne base précisément parce qu'une liste
 * vide y serait indiscernable d'un vrai résultat vide.
 *
 * Aucune sérialisation à la main : `@upstash/redis` encode et décode tout seul.
 * Un `JSON.stringify` ajouté ici produirait un double encodage, et la lecture
 * rendrait une chaîne là où l'appelant attend un objet.
 */
export async function lireOuCalculer<T>(
  cle: string,
  ttl: number,
  calculer: () => Promise<T>,
): Promise<T> {
  try {
    const cache = await redis.get<Range<T>>(cle);
    if (cache !== null && cache !== undefined) return cache.v;
  } catch (e) {
    console.warn('[mcp cache] lecture impossible', cle, e);
  }

  const valeur = await calculer();

  try {
    await redis.set(cle, { v: valeur } satisfies Range<T>, { ex: ttl });
  } catch (e) {
    console.warn('[mcp cache] écriture impossible', cle, e);
  }

  return valeur;
}
