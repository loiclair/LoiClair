// Appelé une fois par Next au démarrage du serveur. Sert à lancer ce qui doit tourner en
// continu sur le VPS (purge du cache des pages) et ce qui doit suivre chaque démarrage
// (rafraîchissement des pages figées). Import dynamique et garde sur le moteur : ce
// fichier est aussi compilé pour l'environnement Edge, qui n'a pas `node:fs`.

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NODE_ENV !== 'production') return;
  const { demarrerPurgeCache } = await import('@/lib/purge-cache');
  demarrerPurgeCache();
  const { revaliderAuDemarrage } = await import('@/lib/revalider-au-demarrage');
  revaliderAuDemarrage();
}
