// Confirmation du désabonnement : POST `{ token }` depuis /newsletter/desabonner/confirmer
// (lien de l'email envoyé par `../route.ts`). Le jeton prouve que le lecteur a accès à
// la boîte. Supprime le contact chez Resend, puis la ligne en base. Le champ `error` des
// réponses porte un code, traduit côté client via le namespace `errors`.
import { NextRequest, NextResponse } from 'next/server'
import { sql, auPlusUneLigne } from '@/lib/db'
import { cleResend, envoyerAlerteBestEffort, TIMEOUT_RESEND_MS } from '@/lib/emails'
import { confirmRateLimit, getClientIp } from '@/lib/rate-limit'

/**
 * Marque la ligne pour `rattraperAudience`, qui rejouera la suppression au prochain
 * envoi. Un échec reste au journal : l'appelant alerte de toute façon.
 */
async function marquerDesabonnement(id: string): Promise<void> {
  try {
    await sql`
      update newsletter_subscribers
      set desabonnement_demande_le = ${new Date().toISOString()}
      where id = ${id}`
  } catch (erreurMarquage) {
    const { code, message } = erreurMarquage as { code?: string; message?: string }
    console.error('Marquage désabonnement non écrit :', code, message)
  }
}

export async function POST(request: NextRequest) {
  // Même seau que la confirmation d'inscription : sans limite, la route laisserait
  // énumérer les jetons, et chaque essai coûte une lecture en base.
  const { success } = await confirmRateLimit.limit(getClientIp(request))
  if (!success) {
    return NextResponse.json({ error: 'rateLimited' }, { status: 429 })
  }

  let token: string | null = null
  try {
    const body = await request.json()
    token = typeof body?.token === 'string' ? body.token : null
  } catch {
    return NextResponse.json({ error: 'invalidBody' }, { status: 400 })
  }

  if (!token) {
    return NextResponse.json({ error: 'tokenMissing' }, { status: 400 })
  }

  // Toute erreur vaut « jeton invalide », comme dans `/api/newsletter/confirm` : aucune
  // ligne, plusieurs lignes, un jeton qui n'a pas la forme d'un uuid (Postgres refuse la
  // conversion, 22P02) ou une panne. Un second clic sur le lien arrive ici aussi.
  let subscriber: { id: string; email: string; resend_contact_id: string | null } | null
  try {
    subscriber = await auPlusUneLigne(sql<{ id: string; email: string; resend_contact_id: string | null }[]>`
      select id, email, resend_contact_id from newsletter_subscribers where token = ${token}`, 'newsletter_subscribers (jeton)')
  } catch {
    return NextResponse.json({ error: 'tokenInvalid' }, { status: 400 })
  }
  if (!subscriber) {
    return NextResponse.json({ error: 'tokenInvalid' }, { status: 400 })
  }

  // Supprimer dans Resend — API contacts globaux (audiences dépréciées)
  // Par contact ID si disponible, sinon par email (path parameter)
  const resendIdentifier = subscriber.resend_contact_id || encodeURIComponent(subscriber.email)
  // Une coupure ou un délai dépassé se traite comme un refus, plus bas : sans ce
  // `try`, l'exception rendait un 500 sans marque ni alerte, et la demande se perdait.
  // Si Resend a quand même supprimé le contact, le rattrapage lira un 404 et finira.
  let resendRes: Response | null = null
  try {
    resendRes = await fetch(
      `https://api.resend.com/contacts/${resendIdentifier}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${cleResend()}` },
        signal: AbortSignal.timeout(TIMEOUT_RESEND_MS),
      }
    )
  } catch (erreurResend) {
    console.error('Appel Resend en échec :', erreurResend)
  }

  // 404 vaut succès : le contact n'existe plus chez Resend, l'objectif est atteint.
  if (resendRes && (resendRes.ok || resendRes.status === 404)) {
    try {
      await sql`delete from newsletter_subscribers where id = ${subscriber.id}`
    } catch (deleteError) {
      const { code, message } = deleteError as { code?: string; message?: string }
      console.error('Erreur suppression abonné:', code, message)
      // Le contact a déjà quitté Resend : sans marque, l'adresse resterait en base pour
      // toujours, contre la promesse de `/confidentialite`. Le rattrapage prendra le
      // 404 de Resend pour un succès et supprimera la ligne.
      await marquerDesabonnement(subscriber.id)
      // L'id dans l'alerte : si le marquage a échoué aussi, c'est la seule trace de la
      // ligne à supprimer à la main. Ni le journal ni la base ne la désignent alors.
      await envoyerAlerteBestEffort(
        '[ALERTE] Désabonnement non supprimé en base',
        `<p>Resend a supprimé le contact, mais pas la base : ${code ?? 'erreur inconnue'}.</p>`
        + `<p>La ligne ${subscriber.id} est marquée si la base répondait encore : le rattrapage du prochain envoi la supprimera. Sinon, la supprimer à la main.</p>`,
      )
    }
    return NextResponse.json({ ok: true })
  }

  // Resend a refusé, ou n'a pas répondu. On NE supprime PAS la ligne locale : le contact reçoit
  // toujours la lettre, et détruire la ligne effacerait le seul moyen de rejouer
  // la suppression. L'obligation est de faire cesser le traitement, pas de
  // détruire la trace de la demande. La ligne marquée EST la file de reprise, que
  // `rattraperAudience` vide au prochain envoi.
  //
  // Le lecteur voit quand même un succès : sa demande est enregistrée et
  // aboutira. Lui montrer une erreur l'enverrait dans une boucle sans rien lui
  // apporter.
  const statutResend = resendRes ? `HTTP ${resendRes.status}` : 'pas de réponse'
  console.error('Erreur suppression contact Resend:', statutResend)
  await marquerDesabonnement(subscriber.id)

  await envoyerAlerteBestEffort(
    '[ALERTE] Désabonnement refusé par Resend',
    `<p>Resend a refusé (${statutResend}) la suppression d'un contact qui a demandé son désabonnement.</p>`
    + `<p>La ligne est conservée et marquée : le rattrapage du prochain envoi rejouera la suppression. Si elle échoue encore, supprimer le contact à la main dans le tableau de bord Resend.</p>`,
  )

  return NextResponse.json({ ok: true })
}
