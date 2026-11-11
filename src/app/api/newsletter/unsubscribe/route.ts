// Demande de désabonnement : POST depuis le formulaire de /newsletter/desabonner
// (jeton Turnstile exigé). Elle n'efface rien : elle envoie à l'adresse saisie un lien
// de confirmation, pour que connaître une adresse ne suffise plus à la désabonner.
// La lettre ne peut pas porter ce lien elle-même : un broadcast Resend part identique
// vers toute l'audience, sans donnée propre à chaque abonné. La suppression vit dans
// `confirm/route.ts`. Le champ `error` des réponses porte un code, traduit côté client
// via le namespace `errors`.
import { NextRequest, NextResponse } from 'next/server'
import { sql, auPlusUneLigne } from '@/lib/db'
import { clientResend, donneesOuLeve, EXPEDITEUR_NEWSLETTER } from '@/lib/emails'
import { desabonnementRateLimit, getClientIp } from '@/lib/rate-limit'
import { EMAIL_RE } from '@/lib/utils'
import { refusTurnstile } from '@/lib/turnstile'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://loiclair.fr'

export async function POST(request: NextRequest) {
  // Chaque demande acceptée envoie un email, sur le quota transactionnel de Resend.
  const { success } = await desabonnementRateLimit.limit(getClientIp(request))
  if (!success) {
    return NextResponse.json({ error: 'rateLimited' }, { status: 429 })
  }

  let email: string
  let turnstileToken: string
  try {
    const body = await request.json()
    email = (body?.email || '').trim().toLowerCase()
    turnstileToken = body?.turnstileToken || ''
  } catch {
    return NextResponse.json({ error: 'invalidBody' }, { status: 400 })
  }

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalidEmail' }, { status: 400 })
  }

  if (!turnstileToken) {
    return NextResponse.json({ error: 'turnstileMissing' }, { status: 400 })
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''
  const refus = await refusTurnstile(turnstileToken, ip)
  if (refus) {
    return NextResponse.json({ error: refus }, { status: 400 })
  }

  // La panne de lecture reste distincte du cas « pas de ligne » : confondues, elles
  // annonceraient un email à quelqu'un à qui rien n'est parti.
  let subscriber: { token: string } | null
  try {
    subscriber = await auPlusUneLigne(sql<{ token: string }[]>`
      select token from newsletter_subscribers where email = ${email}`, 'newsletter_subscribers (email)')
  } catch (erreurLecture) {
    const { code, message } = erreurLecture as { code?: string; message?: string }
    console.error('Erreur lecture abonné:', code, message)
    return NextResponse.json({ error: 'serverError' }, { status: 500 })
  }

  // Réponse générique pour ne pas révéler si l'email est abonné
  if (!subscriber) return NextResponse.json({ ok: true })

  // En français, comme la lettre elle-même (D-345). Le lien mène à une page avec un
  // bouton, jamais à une suppression directe : les messageries ouvrent seules les liens
  // d'un email pour les analyser, ce qui désabonnerait le lecteur à son insu.
  const lien = `${SITE_URL}/fr/newsletter/desabonner/confirmer?token=${subscriber.token}`
  try {
    donneesOuLeve(await clientResend().emails.send({
      from: EXPEDITEUR_NEWSLETTER,
      to: email,
      subject: 'Confirmez votre désabonnement de la newsletter LoiClair',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:2rem;color:#1c1917;">
          <h2 style="margin-bottom:1rem;">Se désabonner</h2>
          <p>Vous avez demandé à ne plus recevoir la newsletter de LoiClair. Cliquez sur le bouton ci-dessous pour le confirmer&nbsp;:</p>
          <a href="${lien}" style="display:inline-block;margin:1.5rem 0;padding:0.75rem 1.5rem;background:#d97706;color:#fff;border-radius:9999px;text-decoration:none;font-weight:600;">Confirmer mon désabonnement</a>
          <p style="font-size:0.8rem;color:#78716c;">Si vous n'avez rien demandé, ignorez cet e-mail&nbsp;: vous resterez abonné.</p>
        </div>
      `,
    }), 'emails.send (désabonnement)')
  } catch (err) {
    console.error('Erreur envoi lien de désabonnement:', err)
    return NextResponse.json({ error: 'mailFailed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
