// Vérification côté serveur d'un jeton Cloudflare Turnstile, partagée par les
// routes des formulaires publics (newsletter, désabonnement, signalement,
// adhésion). Le jeton vient du widget rendu par `useTurnstile` côté client.

/** Codes de Cloudflare qui visent le jeton lui-même : périmé, déjà utilisé ou
 *  illisible. Tout autre code désigne notre configuration ou Cloudflare. */
const CODES_JETON = new Set(['timeout-or-duplicate', 'invalid-input-response']);

export type RefusTurnstile = 'turnstileExpired' | 'turnstileFailed';

/**
 * Rend `null` si Cloudflare valide le jeton pour cette adresse IP, sinon le code
 * d'erreur à renvoyer au formulaire.
 *
 * Les deux refus appellent deux réponses du lecteur. Les quatre formulaires
 * relancent le widget après une erreur : un jeton périmé se règle par un nouvel
 * essai immédiat, alors qu'une panne ne se règle pas en réessayant, comme le
 * 2026-11-05. Seule la panne s'écrit au journal, avec les codes de Cloudflare :
 * c'est eux qui disent quoi réparer, et un jeton périmé n'a rien à réparer.
 *
 * Le secret est `.trim()`é : il part dans le corps d'une requête vers un service
 * tiers, et un `\n` collé depuis un terminal a déjà mis toutes les routes POST à
 * 500 en production (voir `CLAUDE.md` §Code).
 *
 * `remoteip` est facultatif chez Cloudflare : il n'est envoyé que pour une vraie
 * adresse, pas pour la chaîne vide ni le `'unknown'` de `getClientIp`. Le délai
 * borne l'attente : sans lui, un Cloudflare muet garderait la fonction ouverte
 * jusqu'à sa durée maximale ; un dépassement lève, comme une erreur réseau.
 */
export async function refusTurnstile(token: string, ip: string): Promise<RefusTurnstile | null> {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: (process.env.TURNSTILE_SECRET_KEY || '').trim(),
      response: token,
      ...(ip && ip !== 'unknown' ? { remoteip: ip } : {}),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
  if (data.success === true) return null
  const codes = data['error-codes'] ?? []
  if (codes.length > 0 && codes.every((code) => CODES_JETON.has(code))) return 'turnstileExpired'
  console.error('[turnstile] refus :', codes.join(', ') || 'sans code')
  return 'turnstileFailed'
}
