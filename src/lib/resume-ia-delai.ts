// Délai avant une génération de résumé IA, partagé par le client (`useAiErrorStatus`)
// et les deux routes (`/api/resume-loi`, `/api/resume-debats`). Sans import : ce
// fichier part dans le bundle du navigateur.
//
// Du 15 au 18 novembre 2026, un robot qui ouvrait les pages de résumé lançait une
// génération à chaque visite (LOI-80, D-366). La carte demande donc d'abord le seul
// cache (`ENTETE_CACHE_SEUL`) : un résumé déjà fait arrive tout de suite, sinon la
// route répond 204 et la carte n'envoie la vraie demande qu'après
// DELAI_AVANT_GENERATION_MS passés page visible. Un visiteur qui repart avant ne
// coûte rien. Le délai ne vit que dans le navigateur : il n'arrête qu'un robot qui
// pilote la page, un appel direct à la route étant déjà contrôlé par Cloudflare.

/** En-tête de la première demande d'une carte : « rends le cache, ne génère pas ». */
export const ENTETE_CACHE_SEUL = 'x-loiclair-cache-seul';

/** Attente, page visible, avant de demander une génération. Valeur choisie par Alex
 *  le 2026-11-19 pour commencer : à relever si le plafond quotidien sature encore. */
export const DELAI_AVANT_GENERATION_MS = 500;

/**
 * Réponse des routes à une demande « cache seul » qui n'a pas de cache à rendre :
 * 204, sans corps. Appelée juste après le service du cache, avant tout verrou,
 * plafond ou limite horaire, qu'elle ne consomme donc pas. Rend null pour une
 * demande ordinaire, qui suit son chemin.
 */
export function reponseCacheAbsent(request: Request): Response | null {
  return request.headers.get(ENTETE_CACHE_SEUL) === '1' ? new Response(null, { status: 204 }) : null;
}
