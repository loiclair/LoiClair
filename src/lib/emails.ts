/**
 * Envoi d'e-mails et d'alertes ops via Resend, côté TypeScript.
 *
 * Pendant de `pipeline/_alertes.py`, dont ce fichier reprend l'expéditeur, le
 * destinataire et le délai. La moitié Python avait été durcie il y a des mois ; la
 * moitié TypeScript envoyait encore ses alertes par le mécanisme le plus silencieux
 * du dépôt.
 *
 * ── LA RÈGLE, ET LA RAISON ────────────────────────────────────────────────────
 *
 * **Le SDK Resend ne lève pas sur une erreur d'API.** `emails.send`,
 * `broadcasts.create` et `broadcasts.send` rendent tous
 * `{ data: T, error: null } | { data: null, error: ErrorResponse }` et ne lèvent
 * que sur panne réseau. Un `try/catch` autour d'eux n'attrape donc AUCUNE erreur
 * métier : ni 422 destinataire invalide, ni 403 domaine non vérifié, ni 429, ni
 * 5xx. Le 2026-09-09, un e-mail de test envoyé à une adresse invalide a rendu
 * HTTP 200 alors que Resend refusait en 422.
 *
 * D'où `donneesOuLeve` : **tout retour du client passe par lui**, sans exception.
 * C'est ce qui rend les `try/catch` déjà en place enfin utiles. Aucune règle de
 * lint ne le garantit ; le garde-fou est un grep de relecture, `await
 * clientResend()\.`, où chaque occurrence doit être enveloppée ou avoir son
 * `error` testé. Voir D-136. Les lectures en base, elles, lèvent d'elles-mêmes
 * (`src/lib/db.ts`).
 *
 * Il n'y a ni Sentry ni log drain sur ce projet : un `console.error` de route finit
 * dans les journaux du conteneur, que personne ne consulte. « Silencieux » veut donc dire
 * strictement invisible, et c'est pourquoi une erreur doit devenir soit un statut
 * HTTP non-200, soit un e-mail.
 */

import { Resend } from 'resend'

/** Expéditeur des lettres et des confirmations, celui que le lecteur voit. */
export const EXPEDITEUR_NEWSLETTER = 'LoiClair <newsletter@loiclair.fr>'

/** `fetch` de Node n'a pas de délai par défaut : une connexion pendue bloquerait
 *  la route. Même valeur que `_alertes.TIMEOUT`. */
export const TIMEOUT_RESEND_MS = 15_000

const EXPEDITEUR_SYSTEME = 'LoiClair System <newsletter@loiclair.fr>'
const DESTINATAIRE_ALERTE = 'contact@loiclair.fr'

/** La clé, toujours `.trim()`ée : elle finit dans un en-tête `Authorization`, et
 *  un `\n` parasite collé depuis un terminal a déjà mis toutes les routes
 *  `/api/*` POST à 500 en production, sans erreur lisible. */
export function cleResend(): string {
  const cle = (process.env.RESEND_API_KEY || '').trim()
  if (!cle) throw new Error('RESEND_API_KEY manquant.')
  return cle
}

let client: Resend | undefined

/** Client paresseux, jamais instancié à l'import : `new Resend(undefined)` lève,
 *  et ce module est importé par le chemin d'alerte lui-même. Une clé absente doit
 *  faire échouer l'envoi, pas l'import de tous les appelants. Même raisonnement
 *  que le docstring de `_alertes.py` sur sa non-dépendance à `_sync_cache`. */
export function clientResend(): Resend {
  if (!client) client = new Resend(cleResend())
  return client
}

/**
 * Déballe un retour du SDK, ou lève.
 *
 * Rend un `T` non-nullable : c'est ce qui fait disparaître les `data?.id` derrière
 * lesquels une erreur passait inaperçue.
 *
 * @param quoi nom de l'appel, pour que le message dise lequel a échoué.
 */
export function donneesOuLeve<T>(
  reponse: { data: T | null; error: { name: string; message: string; statusCode: number | null } | null },
  quoi: string,
): T {
  if (reponse.error) {
    const { name, message, statusCode } = reponse.error
    throw new Error(`Resend ${quoi} : ${name} (${statusCode ?? '?'}) ${message}`)
  }
  if (reponse.data === null) throw new Error(`Resend ${quoi} : réponse sans données ni erreur.`)
  return reponse.data
}

/**
 * E-mail à l'équipe (contact@loiclair.fr), qui lève si Resend refuse.
 *
 * Pendant de `_alertes.envoyer_alerte`. Appelée directement par `/api/signaler`,
 * qui doit savoir si le message est parti avant de publier l'issue, et par
 * `envoyerAlerteBestEffort`, qui en rattrape l'échec.
 *
 * @param repondreA adresse mise en `replyTo`, pour répondre au visiteur en un clic.
 */
export async function envoyerAEquipe(sujet: string, html: string, repondreA?: string): Promise<void> {
  donneesOuLeve(
    await clientResend().emails.send({
      from: EXPEDITEUR_SYSTEME,
      to: DESTINATAIRE_ALERTE,
      subject: sujet,
      html,
      ...(repondreA ? { replyTo: repondreA } : {}),
    }),
    'emails.send (équipe)',
  )
}

/**
 * Alerte ops, qui journalise au lieu de lever.
 *
 * Pendant de `_alertes.envoyer_alerte_best_effort`, et pour la même raison : tous
 * ses appelants accompagnent un `return 500` déjà décidé, et l'échec de l'e-mail
 * ne doit pas masquer l'erreur qu'on cherchait à signaler.
 */
export async function envoyerAlerteBestEffort(sujet: string, html: string): Promise<void> {
  try {
    await envoyerAEquipe(sujet, html)
  } catch (err) {
    console.error('Échec envoi alerte email :', err instanceof Error ? err.message : String(err))
  }
}
