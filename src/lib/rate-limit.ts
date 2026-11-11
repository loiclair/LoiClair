// Limiteurs de débit des routes `/api/*` (Upstash Redis, fenêtre glissante),
// plafond quotidien et verrous des générations IA, et dédoublonnage des vues comptées.
// Appelé par les routes d'API, et par le cache du serveur MCP (`src/lib/mcp/cache.ts`),
// qui réutilise son client Redis et son préfixe.

import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'

export const RATE_LIMIT_RESET_HEADER = 'X-RateLimit-Reset'

// Exporté parce que le cache du serveur MCP (`src/lib/mcp/cache.ts`) s'en sert
// aussi. Un second client marcherait (c'est un client HTTP sans pool de
// connexions) mais il dupliquerait la lecture des deux variables, et c'est ce
// genre de doublon qui survit à une rotation de secret d'un seul côté.
export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// Préfixe de toutes les clés Redis, sauf celles des résumés IA (`PREFIXE_IA`).
// Le Redis Upstash est partagé entre la production, l'app d'essai et les serveurs
// locaux : sans préfixe, une réponse MCP calculée par un code de test serait servie
// à la production jusqu'à 12 h, et une visite d'essai consommerait les quotas et le
// « une vue par jour » de la même IP en production. Vide en production, pour que ses
// clés ne changent pas. `SITE_ENV=production` n'est posée que dans l'app Coolify de
// production : absente, elle vaut « hors production », le côté sûr.
export const PREFIXE_REDIS = process.env.SITE_ENV?.trim() === 'production' ? '' : 'test:'

/**
 * Limiteur à fenêtre glissante, seul endroit qui pose le préfixe des quotas : un
 * limiteur ajouté ici ne peut pas l'oublier. `nom` donne la clé `rl:<nom>`, appelée
 * par chaque limiteur de ce fichier.
 */
function limiteur(jetons: number, fenetre: Parameters<typeof Ratelimit.slidingWindow>[1], nom: string) {
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(jetons, fenetre),
    prefix: `${PREFIXE_REDIS}rl:${nom}`,
  })
}

export const subscribeRateLimit = limiteur(5, '10 m', 'subscribe')

// Seau distinct de `subscribeRateLimit` : partagé, cinq inscriptions consommeraient
// le droit de confirmer. Un lecteur normal confirme une fois, jamais dix.
export const confirmRateLimit = limiteur(10, '10 m', 'confirm')

// Chaque demande de désabonnement acceptée envoie un email : seau distinct de
// l'inscription, pour qu'un lecteur qui change d'avis ne soit pas bloqué.
export const desabonnementRateLimit = limiteur(5, '10 m', 'unsubscribe')

export const signalerRateLimit = limiteur(5, '1 h', 'signaler')

// Une demande d'adhésion part en email au bureau. Le compteur passe avant
// Turnstile et la validation, donc un essai refusé consomme aussi une place :
// cinq par heure, comme les signalements, laissent corriger une erreur de saisie
// et coupent un envoi en boucle.
export const adhesionRateLimit = limiteur(5, '1 h', 'adhesion')

// Préfixe des clés Redis des routes de résumé IA (PDF refusés, verrous, plafond).
// Une vérification locale qui mémoriserait un faux PDF sans texte ferait refuser le
// vrai à la production : hors production, ces clés vivent à part, comme les autres
// (`ia:test:`, écrit avant `PREFIXE_REDIS` et gardé pour ne pas changer les clés).
export const PREFIXE_IA = `ia:${PREFIXE_REDIS}`

/** Générations IA lancées par jour (UTC) sur tout le site, les deux routes de résumé
 *  confondues. Valeur choisie par Alex le 2026-10-28. */
export const PLAFOND_GENERATIONS_JOUR = 300

/** Durée de vie d'un verrou de génération. Assez longue pour qu'un verrou n'expire pas
 *  pendant une génération, qu'un second lecteur relancerait et paierait une seconde
 *  fois ; rien ne borne plus cette durée côté serveur. Contrepartie : un traitement
 *  interrompu (serveur redémarré) ne rend pas son verrou et bloque le texte 15 minutes. */
const DUREE_VERROU_IA_S = 900

/** Intervalle entre deux relectures de la base par un lecteur qui attend. */
const ATTENTE_VERROU_MS = 3000

/** Attente maximale d'un lecteur devant un verrou, comptée depuis l'arrivée de sa
 *  requête. Le lecteur qui attend plus longtemps reçoit 503, que la carte
 *  affiche comme un délai dépassé, avec un bouton Réessayer. */
const ATTENTE_VERROU_MAX_MS = 120_000

export type VerrouIa = { cle: string; jeton: string }

function clePlafondIa(): string {
  return `${PREFIXE_IA}plafond:${new Date().toISOString().slice(0, 10)}`
}

/**
 * Dit, sans rien compter, si le plafond du jour est atteint. Appelée avant la
 * limite horaire du lecteur : un lecteur qui ne pourra pas avoir de résumé ne
 * perd pas une de ses dix places de l'heure, et le PDF n'est pas téléchargé.
 */
export async function plafondIaAtteint(): Promise<boolean> {
  return Number((await redis.get<number>(clePlafondIa())) ?? 0) >= PLAFOND_GENERATIONS_JOUR
}

/**
 * Compte une génération dans le plafond du jour et dit si elle peut partir.
 * Appelée par les deux routes de résumé juste avant le premier appel au modèle :
 * un cache servi, un lecteur qui attend un verrou ou un refus ne comptent pas.
 * Une génération qui échoue compte quand même, ses appels étant payés.
 * La durée de vie se repose à chaque appel, dans la même transaction que
 * l'incrément : aucune clé ne reste sans expiration.
 */
export async function consommerPlafondIa(): Promise<boolean> {
  const cle = clePlafondIa()
  const [n] = await redis.multi().incr(cle).expire(cle, 48 * 3600).exec<[number, number]>()
  return n <= PLAFOND_GENERATIONS_JOUR
}

/** Pose le verrou de génération `cle`, ou rend null s'il est déjà tenu. Appelée
 *  seule par un appelant qui a mieux à faire qu'attendre, comme servir une synthèse
 *  précédente. */
export async function prendreVerrouIa(cle: string): Promise<VerrouIa | null> {
  const jeton = crypto.randomUUID()
  const pose = await redis.set(cle, jeton, { nx: true, ex: DUREE_VERROU_IA_S })
  return pose === 'OK' ? { cle, jeton } : null
}

/**
 * Lève un verrou, seulement s'il est encore le sien : passé sa durée de vie, la
 * clé peut appartenir à un autre lecteur, qu'un `del` nu libérerait. Une erreur
 * est journalisée et avalée, le verrou expirant seul.
 */
export async function rendreVerrouIa(verrou: VerrouIa): Promise<void> {
  try {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      [verrou.cle],
      [verrou.jeton],
    )
  } catch (e) {
    console.error(`[ia] verrou ${verrou.cle} non rendu :`, e)
  }
}

/**
 * Une seule génération à la fois par texte et par langue. Sans verrou, N lecteurs
 * d'un texte paru le jour même lançaient N générations complètes jusqu'à ce que la
 * première écrive le cache.
 *
 * Rend `{ verrou }` quand l'appelant doit générer, puis lever le verrou avec
 * `rendreVerrouIa`. Sinon le lecteur attend, sans consommer de place de la limite
 * horaire : `lirePret` relit la base toutes les 3 s (une colonne, quelques
 * octets) et rend le résumé dès qu'il est écrit, `{ resume }`. Si le verrou tombe
 * sans résumé (génération en échec, fonction coupée), le lecteur le reprend et
 * génère lui-même. Passé ATTENTE_VERROU_MAX_MS depuis `recuA`, l'heure d'arrivée
 * de la requête, `{ delaiDepasse }`.
 *
 * Le verrou pris, `lirePret` est relu une fois : le tenant précédent a pu écrire
 * le résumé puis lever son verrou entre deux relectures. Si cette relecture lève,
 * le verrou est rendu avant que l'erreur remonte : la route ne le connaît pas
 * encore, et il bloquerait le texte 310 s.
 */
export async function attendreOuPrendreVerrouIa(
  cle: string,
  lirePret: () => Promise<string | null>,
  recuA: number,
): Promise<{ verrou: VerrouIa } | { resume: string } | { delaiDepasse: true }> {
  const fin = recuA + ATTENTE_VERROU_MAX_MS
  for (;;) {
    const verrou = await prendreVerrouIa(cle)
    if (verrou) {
      let resume: string | null
      try {
        resume = await lirePret()
      } catch (e) {
        await rendreVerrouIa(verrou)
        throw e
      }
      if (resume === null) return { verrou }
      await rendreVerrouIa(verrou)
      return { resume }
    }
    do {
      if (Date.now() + ATTENTE_VERROU_MS > fin) return { delaiDepasse: true }
      await new Promise((r) => setTimeout(r, ATTENTE_VERROU_MS))
      const resume = await lirePret()
      if (resume !== null) return { resume }
    } while (await redis.exists(cle))
  }
}

export const aiRateLimit = limiteur(10, '1 h', 'ai')

// Détail d'un élément de « Ce qui me concerne » (`/api/ce-qui-me-concerne/element`).
// Le client y passe `v`, l'instant de construction de la page, que la route ignore
// mais dont le CDN fait une clé de cache : chaque valeur inventée relisait la base
// (jusqu'à 200 Ko pour un article du budget). Seuls les défauts de cache atteignent
// la fonction, et un lecteur ouvre ses tiroirs un par un : 60 par minute ne le gêne
// pas et borne ce qu'une IP peut faire lire.
export const elementRateLimit = limiteur(60, '1 m', 'element')

export const viewRateLimit = limiteur(60, '1 m', 'view')

/**
 * Premier filtre des compteurs de vues (`/api/view-elu`, `/api/view-dossier`),
 * avant toute lecture Redis. Ces compteurs font « Les plus consultés » et la
 * newsletter : une page tierce pouvait faire tirer leurs POST par les navigateurs
 * de ses propres visiteurs (`mode: 'no-cors'`, l'en-tête CORS n'empêchant que la
 * lecture de la réponse) et pousser un élu en tête.
 *
 * - `Content-Type: application/json` exigé (415) : une requête `no-cors` ne peut
 *   pas le poser, le navigateur la limitant aux types d'un formulaire.
 * - `Origin` exigé et égal à l'hôte de la requête (403) : le navigateur pose cet
 *   en-tête sur tout POST, même de même origine, et la page ne peut pas le
 *   choisir. L'hôte de la requête plutôt qu'un domaine écrit en dur : la même
 *   règle vaut en production, en preview et en local.
 * Rend la réponse de refus, ou null.
 */
export function refuserVueEtrangere(request: NextRequest): NextResponse | null {
  const type = (request.headers.get('content-type') ?? '').toLowerCase()
  if (!type.startsWith('application/json')) {
    return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415 })
  }
  let hoteOrigine: string | null = null
  try {
    hoteOrigine = new URL(request.headers.get('origin') ?? '').host
  } catch {
    hoteOrigine = null
  }
  if (!hoteOrigine || hoteOrigine !== request.headers.get('host')) {
    return NextResponse.json({ error: 'forbidden_origin' }, { status: 403 })
  }
  return null
}

/**
 * Retient pour 24 h la vue de `uid` par cette IP aujourd'hui (UTC), et rend la
 * clé posée, ou null si la vue était déjà comptée. Un même lecteur, ou un script
 * qui rejoue la requête, ne compte donc qu'une fois par jour et par fiche. L'IP
 * n'est gardée que hachée : rien de lisible dans Redis. Si l'incrément échoue
 * ensuite, l'appelant supprime la clé, sans quoi la vue serait perdue pour la
 * journée.
 */
export async function premiereVueDuJour(request: NextRequest, type: 'elu' | 'dossier', uid: string): Promise<string | null> {
  const ip = createHash('sha256').update(getClientIp(request)).digest('hex').slice(0, 32)
  const cle = `${PREFIXE_REDIS}vue:${type}:${new Date().toISOString().slice(0, 10)}:${ip}:${uid}`
  return (await redis.set(cle, '1', { nx: true, ex: 86400 })) === 'OK' ? cle : null
}

export const feedbackRateLimit = limiteur(3, '24 h', 'feedback')

// Un seul seau pour tout le serveur MCP, et une clé fixe : le protocole
// 2026-07-28 est sans état, il n'y a donc ni session ni identité à partitionner,
// et `getClientIp` ne sépare rien puisque les appels arrivent derrière les
// adresses d'Anthropic ou d'OpenAI. Ce n'est pas de l'équité, c'est un plafond
// de dépense : un seul appelant vorace peut en sortir tout le monde. Les clés
// d'accès corrigeront ça ; d'ici là, le vrai plafond est la forme des outils :
// dix outils fermés, vingt lignes rendues au maximum, et deux seulement qui
// paginent, `chiffres_cles` et le filtre sur le cumul de `chercher_elu`.
// Chaque outil consomme un nombre de jetons proportionnel à ce qu'il coûte, et
// ce coût se mesure en temps de calcul, pas en nombre de requêtes : une
// recherche de loi balaie les titres pendant près de 733 ms, là où une fiche
// lue sur clé primaire ne coûte que des allers-retours. Soixante jetons par
// minute plafonnent donc le pire cas à six appels de l'outil le plus cher, soit
// une poignée de secondes de calcul, ce que l'instance encaisse sans que
// loiclair.fr, qui la partage, ralentisse. Le cache de six heures rend gratuits
// les appels répétés, l'usage réel est donc très loin de ce plafond.
export const mcpRateLimit = limiteur(60, '1 m', 'mcp')

// Cloudflare ajoute la vraie adresse *derrière* celle que le client a envoyée dans
// x-forwarded-for : son premier élément est donc une valeur choisie par le visiteur,
// et la faire tourner annulerait tous les limiteurs. cf-connecting-ip est posé par
// Cloudflare et ne peut pas être écrit depuis l'extérieur : il passe en premier.
// Le repli 'unknown' met les requêtes sans en-tête dans un seau commun, donc plus
// strict qu'une valeur unique par requête, qui supprimerait la limite au lieu de la durcir.
export function getClientIp(request: NextRequest): string {
  const cfIp = request.headers.get('cf-connecting-ip')
  if (cfIp) return cfIp.trim()
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return 'unknown'
}

export async function enforceAiRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const { success, reset } = await aiRateLimit.limit(getClientIp(request))
  if (success) return null
  // Un code, jamais une phrase : le corps d'une route ne connaît pas la langue du
  // lecteur. Les cartes de résumé n'affichent pas ce corps (elles lisent le statut
  // et l'en-tête de reprise pour composer leur propre message), il ne sert donc
  // qu'à un appelant direct de l'API.
  return NextResponse.json(
    { error: 'rateLimited' },
    { status: 429, headers: { [RATE_LIMIT_RESET_HEADER]: String(reset) } },
  )
}
