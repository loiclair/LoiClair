// Mise en forme d'un passage cité par la classification de « Ce qui me concerne ». Sans
// dépendance : lu par le tiroir (navigateur) et par la lecture d'un amendement (serveur).

/** Le passage est cité entre guillemets par l'affichage ; un passage qui cite lui-même
 *  un alinéa commence souvent par « et finit par », ce qui doublait les guillemets à
 *  l'écran (« « … » »). */
export function sansGuillemetsExterieurs(passage: string): string {
  return passage.replace(/^«\s*/, '').replace(/\s*»\s*[;.,]?\s*$/, '');
}
