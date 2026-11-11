// Le champ `error` des réponses porte un code, jamais une phrase : la route ne
// connaît pas la langue du lecteur, et l'appelant traduit via le namespace
// `errors`. Un nouveau code s'ajoute dans `fr.json` et `en.json` du même geste,
// sinon le client retombe sur son message générique.
import { NextRequest, NextResponse } from 'next/server'
import { sql, uneLigne } from '@/lib/db'
import { clientResend, donneesOuLeve, EXPEDITEUR_NEWSLETTER } from '@/lib/emails'
import { EMAIL_RE } from '@/lib/utils'
import { subscribeRateLimit, getClientIp } from '@/lib/rate-limit'
import { refusTurnstile } from '@/lib/turnstile'
import dns from 'dns'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://loiclair.fr'

const MX_TIMEOUT_MS = 2000

async function hasMxRecord(domain: string): Promise<boolean> {
  try {
    const records = await Promise.race([
      dns.promises.resolveMx(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Object.assign(new Error('MX timeout'), { code: 'TIMEOUT' })), MX_TIMEOUT_MS),
      ),
    ])
    return records.length > 0
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code
    // Only reject when DNS confirms the domain doesn't exist or has no MX.
    // Any other failure (timeout, runtime DNS unavailable, c-ares misconfig on local
    // macOS dev, etc.) is treated as valid — Turnstile + Resend bounce handling catch
    // real bad emails downstream.
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NXDOMAIN') {
      return false
    }
    return true
  }
}

export async function POST(request: NextRequest) {
  try {
    const { success } = await subscribeRateLimit.limit(getClientIp(request))
    if (!success) {
      return NextResponse.json({ error: 'rateLimited' }, { status: 429 })
    }

    const body = await request.json()
    // Seule l'adresse est lue : `/confidentialite` promet que l'inscription ne collecte
    // rien d'autre (D-065). Un champ de plus envoyé au corps de la requête est ignoré.
    const email: string = (body.email || '').trim().toLowerCase()
    const turnstileToken: string = body.turnstileToken || ''

    if (!turnstileToken) {
      return NextResponse.json({ error: 'turnstileMissing' }, { status: 400 })
    }
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''
    const refus = await refusTurnstile(turnstileToken, ip)
    if (refus) {
      return NextResponse.json({ error: refus }, { status: 400 })
    }

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'invalidEmail' }, { status: 400 })
    }

    const domain = email.split('@')[1]
    const validMx = await hasMxRecord(domain)
    if (!validMx) {
      return NextResponse.json({ error: 'invalidEmail' }, { status: 400 })
    }

    // Upsert silencieux — ne révèle jamais si l'email existe déjà.
    // `do update set email = excluded.email` et non `do nothing` : il faut que la
    // ligne existante revienne par `returning` (jeton et statut), ce que
    // `do nothing` ne fait pas. La valeur réécrite est identique, rien ne change.
    let subscriber: { token: string; confirmed: boolean | null }
    try {
      subscriber = await uneLigne(sql<{ token: string; confirmed: boolean | null }[]>`
        insert into newsletter_subscribers ${sql({ email })}
        on conflict (email) do update set email = excluded.email
        returning token, confirmed`, 'newsletter_subscribers (upsert)')
    } catch (dbError) {
      const { code, message } = dbError as { code?: string; message?: string }
      console.error('Erreur upsert subscriber:', code, message)
      return NextResponse.json({}, { status: 200 })
    }

    // Ne renvoyer un email que si pas encore confirmé.
    //
    // Un refus de Resend doit se voir : sans `donneesOuLeve`, la route rendait 200,
    // le formulaire annonçait « vérifie ta boîte mail », la personne ne recevait
    // rien, et sa ligne non confirmée était détruite 48 h plus tard par
    // `cleanup_expired_tokens`. L'inscription disparaissait sans laisser de trace,
    // et elle est le seul témoin possible de la panne.
    //
    // Pas d'alerte ops : une adresse en liste de suppression produit un refus par
    // visiteur, et une alerte par visiteur finirait ignorée, ce qui détruirait la
    // valeur de celles du pipeline hebdomadaire. Une panne Resend globale, elle,
    // sera signalée le lundi suivant par la route d'envoi.
    if (!subscriber.confirmed) {
      const confirmUrl = `${SITE_URL}/fr/newsletter/confirmer?token=${subscriber.token}`
      donneesOuLeve(await clientResend().emails.send({
        from: EXPEDITEUR_NEWSLETTER,
        to: email,
        subject: 'Confirmez votre inscription à la newsletter LoiClair',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:2rem;color:#1c1917;">
            <h2 style="margin-bottom:1rem;">Bienvenue !</h2>
            <p>Vous avez demandé à recevoir la newsletter hebdomadaire de LoiClair — le résumé clair et non partisan de l'activité législative française.</p>
            <p>Cliquez sur le bouton ci-dessous pour confirmer votre inscription&nbsp;:</p>
            <a href="${confirmUrl}" style="display:inline-block;margin:1.5rem 0;padding:0.75rem 1.5rem;background:#d97706;color:#fff;border-radius:9999px;text-decoration:none;font-weight:600;">Confirmer mon inscription</a>
            <p style="font-size:0.8rem;color:#78716c;">Ce lien est valable 48&nbsp;h. Si vous n'avez pas demandé cette inscription, ignorez cet e-mail.</p>
          </div>
        `,
      }), 'emails.send (confirmation)')
    }

    return NextResponse.json({}, { status: 200 })
  } catch (err) {
    // Message générique côté lecteur : le détail Resend reste dans le journal, et
    // la réponse ne dit pas si l'adresse était déjà connue.
    console.error('Erreur subscribe:', err)
    return NextResponse.json({ error: 'mailFailed' }, { status: 500 })
  }
}
