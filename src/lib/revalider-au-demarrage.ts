// Rejoue `/api/revalidate` une fois au démarrage du serveur de production, puis vide le
// cache Cloudflare, comme le fait la fin du run de nuit. Démarré par `instrumentation.ts`,
// sans entrée.
//
// Pourquoi. Next ne garde les marques de `revalidatePath` qu'en mémoire : après un
// redémarrage, elles ont disparu, et chaque page figée retombe sur sa copie la plus
// récente sur le disque, souvent celle du build, datée de lui. Elle passe alors pour
// fraîche jusqu'à 48 h après le build. Constaté le 2026-11-13 : le VPS a redémarré à
// 03:00 UTC, la page `/fr/Facts/taux-promulgation` a servi les chiffres du 9 novembre
// (copie du build du 11 à 05:59, octet pour octet) malgré le marquage du run du 12 au
// soir, et ne s'est reconstruite qu'à 05:59, 48 h pile après le build. Un déploiement
// remet en ligne les chiffres du jour du build de la même façon.
//
// La base d'abord : une page marquée perd son filet et rend 500 tant que la base ne
// répond pas (ARCHITECTURE.md §Rafraîchissement nocturne). Après un redémarrage du VPS,
// Postgres, sur le même serveur, peut répondre après le site : on l'attend avant de
// marquer quoi que ce soit.

import { sql } from '@/lib/db';

const ESSAIS = 60;
const PAUSE_MS = 5_000;
// Borne un appel resté sans réponse : sans elle, la boucle attendrait indéfiniment, sans
// rien journaliser.
const DELAI_APPEL_MS = 30_000;

// `unref` : comme la purge du cache, cette attente ne doit pas retenir le processus.
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms).unref());

/**
 * Attend que la base et le serveur répondent, puis appelle la route de rafraîchissement
 * sur le serveur lui-même. Ne lève jamais : un échec se journalise, et les pages gardent
 * leur minuterie de 48 h comme filet.
 */
async function revalider(): Promise<void> {
  const secret = (process.env.REVALIDATE_SECRET || '').trim();
  if (!secret) {
    console.warn('Rafraîchissement au démarrage : REVALIDATE_SECRET absent, rien de marqué.');
    return;
  }
  // Le Dockerfile fixe `PORT` et écoute sur 0.0.0.0 : la boucle locale suffit, sans
  // passer par Cloudflare ni Traefik.
  const adresse = `http://127.0.0.1:${(process.env.PORT || '3000').trim()}/api/revalidate`;

  let derniereErreur = '';
  for (let essai = 1; essai <= ESSAIS; essai++) {
    // Le serveur n'écoute qu'une fois `register()` terminé : la première tentative
    // attend elle aussi.
    await attendre(PAUSE_MS);
    try {
      await sql`select 1`;
      const reponse = await fetch(adresse, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(DELAI_APPEL_MS),
      });
      const corps = await reponse.text();
      if (reponse.ok) {
        console.log(`Rafraîchissement au démarrage : ${corps}`);
        await purgerCloudflare();
        return;
      }
      // Un secret refusé ne s'arrangera pas en réessayant.
      if (reponse.status === 401) {
        console.error('Rafraîchissement au démarrage : secret refusé (401).');
        return;
      }
      derniereErreur = `${reponse.status} ${corps.slice(0, 200)}`;
    } catch (e) {
      derniereErreur = e instanceof Error ? e.message : String(e);
    }
  }
  console.error(
    `Rafraîchissement au démarrage abandonné après ${ESSAIS} essais : ${derniereErreur}`,
  );
}

/**
 * Vide le cache Cloudflare de loiclair.fr, une fois les pages marquées : une visite
 * passée entre le démarrage et le marquage a pu y déposer la copie du build, que
 * Cloudflare garderait jusqu'à la purge de la nuit (`s-maxage` de 48 h). Même appel que
 * `purge-cloudflare.yml`, dans le même ordre (marquer, puis purger, D-342).
 *
 * Sans `CLOUDFLARE_ZONE_ID` ni `CLOUDFLARE_PURGE_TOKEN`, ne fait rien : l'app d'essai ne
 * les a pas, et son cache Cloudflare est en `BYPASS`. Ne lève jamais.
 */
async function purgerCloudflare(): Promise<void> {
  // `.trim()` : ces valeurs partent dans un en-tête et une URL (CLAUDE.md, §Code).
  const zone = (process.env.CLOUDFLARE_ZONE_ID || '').trim();
  const jeton = (process.env.CLOUDFLARE_PURGE_TOKEN || '').trim();
  if (!zone || !jeton) {
    console.log('Purge Cloudflare au démarrage : pas de zone ni de jeton, rien à purger.');
    return;
  }
  let derniereErreur = '';
  for (let essai = 1; essai <= 3; essai++) {
    try {
      const reponse = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hosts: ['loiclair.fr'] }),
        signal: AbortSignal.timeout(DELAI_APPEL_MS),
      });
      if (reponse.ok) {
        console.log('Purge Cloudflare au démarrage : faite.');
        return;
      }
      derniereErreur = `${reponse.status} ${(await reponse.text()).slice(0, 200)}`;
      // Un jeton refusé ne s'arrangera pas en réessayant.
      if (reponse.status === 401 || reponse.status === 403) break;
    } catch (e) {
      derniereErreur = e instanceof Error ? e.message : String(e);
    }
    await attendre(PAUSE_MS);
  }
  console.error(`Purge Cloudflare au démarrage échouée : ${derniereErreur}`);
}

/** Lance le rafraîchissement sans retenir le démarrage du serveur. */
export function revaliderAuDemarrage(): void {
  // `next build` peut aussi appeler `register()` en préparant une route à prérendre
  // (`RouteModule.ensureInstrumentation`, lu dans Next 16.4, non constaté) : aucun
  // serveur n'y écoute, et la boucle y interrogerait la base pour rien.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  void revalider();
}
