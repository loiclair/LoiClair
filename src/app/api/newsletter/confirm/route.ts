// Confirmation d'inscription à la newsletter : POST `{ token }` depuis la page
// /newsletter/confirmer (lien de l'email de `subscribe/route.ts`). Marque la ligne
// confirmée, puis ajoute le contact à l'audience Resend. Le champ `error` des
// réponses porte un code, traduit côté client via le namespace `errors`.
import { NextRequest, NextResponse } from 'next/server'
import { sql, uneLigne } from '@/lib/db'
import { cleResend, TIMEOUT_RESEND_MS } from '@/lib/emails'
import { confirmRateLimit, getClientIp } from '@/lib/rate-limit'

type LigneAbonne = {
  id: string
  email: string
  confirmed: boolean | null
  resend_contact_id: string | null
  subscribed_at: string
}

export async function POST(request: NextRequest) {
  // La route distingue « jeton inconnu » de « jeton périmé » : sans limite, c'est un
  // oracle qui laisse énumérer les jetons, et chaque essai coûte une lecture en base.
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

  // Toute erreur vaut « jeton invalide », comme avec `.single()` avant : aucune
  // ligne, plusieurs lignes (la colonne n'a pas d'index unique), un jeton qui n'a
  // pas la forme d'un uuid (Postgres refuse la conversion, 22P02) ou une panne.
  let subscriber: LigneAbonne
  try {
    subscriber = await uneLigne(sql<LigneAbonne[]>`
      select id, email, confirmed, resend_contact_id, subscribed_at
      from newsletter_subscribers
      where token = ${token}`, 'newsletter_subscribers (jeton)')
  } catch {
    return NextResponse.json({ error: 'tokenInvalid' }, { status: 400 })
  }

  // Token valide 48h
  const age = Date.now() - new Date(subscriber.subscribed_at).getTime()
  if (!subscriber.confirmed && age > 48 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'tokenExpired' }, { status: 400 })
  }

  if (!subscriber.confirmed) {
    try {
      await sql`
        update newsletter_subscribers
        set ${sql({ confirmed: true, confirmed_at: new Date().toISOString() })}
        where id = ${subscriber.id}`
    } catch (updateError) {
      const { code, message } = updateError as { code?: string; message?: string }
      console.error('Erreur confirmation abonné:', code, message)
      return NextResponse.json({ error: 'serverError' }, { status: 500 })
    }

    // Ajouter dans l'audience Resend utilisée pour les broadcasts.
    //
    // Un échec ici ne rend PAS d'erreur au lecteur : sa confirmation a réussi, la
    // ligne est bien `confirmed`. Lui afficher « erreur » l'inciterait à recliquer
    // un lien qui marche, pour un problème qui ne le concerne pas.
    //
    // Ce qui répare : `confirmed = true AND resend_contact_id IS NULL` est le
    // marqueur, et le rattrapage de `send/route.ts` le consomme juste avant le
    // broadcast du lundi. C'est le seul instant où être dans l'audience compte.
    const audienceId = (process.env.RESEND_AUDIENCE_ID || '').trim()
    if (!audienceId) {
      // Sans garde, l'URL devenait `/audiences/undefined/contacts` et l'échec
      // tombait dans la même branche muette que les autres.
      console.error('Contact Resend non créé : RESEND_AUDIENCE_ID manquant.')
    } else {
      try {
        const resendRes = await fetch(`https://api.resend.com/audiences/${audienceId}/contacts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cleResend()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ email: subscriber.email, unsubscribed: false }),
          // `fetch` de Node n'a pas de délai par défaut : une connexion pendue
          // bloquerait la route.
          signal: AbortSignal.timeout(TIMEOUT_RESEND_MS),
        })
        if (!resendRes.ok) throw new Error(`${resendRes.status} ${(await resendRes.text()).slice(0, 200)}`)
        const resendData = await resendRes.json()
        if (resendData?.id) {
          try {
            await sql`update newsletter_subscribers set resend_contact_id = ${resendData.id} where id = ${subscriber.id}`
          } catch (erreurId) {
            // Le contact existe chez Resend mais la base l'ignore : le rattrapage
            // repostera, et l'ajout est idempotent. Rattrapé ici et non par le
            // `catch` de Resend en dessous, qui journaliserait un autre message.
            const { code, message } = erreurId as { code?: string; message?: string }
            console.error('resend_contact_id non écrit :', code, message)
          }
        }
      } catch (e) {
        console.error('Erreur création contact Resend:', (e as Error)?.message)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
