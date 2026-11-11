/**
 * POST /api/adhesion : reçoit le formulaire « Devenir membre » (`AdhesionDialog.tsx`).
 *
 * La demande part par email à contact@loiclair.fr, l'adresse du demandeur en
 * `replyTo` pour que le bureau réponde en un clic. Rien n'est stocké sur le site :
 * le registre des membres est tenu à la main par le secrétaire (D-230).
 *
 * L'objet commence par `[ADHESION]`, sans accent, pour qu'un filtre de
 * messagerie puisse trier ou automatiser le traitement de ces emails.
 *
 * Le champ `error` des réponses porte un code, jamais une phrase : la route ne
 * connaît pas la langue du lecteur, et le tiroir traduit via le namespace
 * `errors`.
 */
import { NextRequest, NextResponse } from "next/server"
import { adhesionRateLimit, getClientIp } from "@/lib/rate-limit"
import { envoyerAEquipe } from "@/lib/emails"
import { refusTurnstile } from "@/lib/turnstile"
import { EMAIL_RE } from "@/lib/utils"
import { echapperHtml } from "@/lib/echapper-html"

/** Échappe le HTML d'une saisie libre, qui finit dans le corps de l'email. */
function echapper(texte: string, max: number): string {
  return echapperHtml(texte.slice(0, max))
}

const texte = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
const oui = (v: boolean) => (v ? "oui" : "non")

export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const { success } = await adhesionRateLimit.limit(ip)
    if (!success) {
      return NextResponse.json({ error: "membershipRateLimited" }, { status: 429 })
    }

    // Un corps illisible, ou le JSON `null`, est une erreur du client et non du
    // serveur : sans ce garde, `body.turnstileToken` lèverait et rendrait un 500.
    let body: Record<string, unknown>
    try {
      body = (await request.json()) ?? {}
    } catch {
      return NextResponse.json({ error: "invalidBody" }, { status: 400 })
    }
    const turnstileToken = texte(body.turnstileToken)
    if (!turnstileToken) {
      return NextResponse.json({ error: "turnstileMissing" }, { status: 400 })
    }
    const refus = await refusTurnstile(turnstileToken, ip)
    if (refus) {
      return NextResponse.json({ error: refus }, { status: 400 })
    }

    // Mêmes règles que le tiroir, revérifiées ici : le bouton désactivé ne
    // protège que le visiteur honnête.
    const nom = texte(body.nom)
    const email = texte(body.email)
    const contribution = texte(body.contribution)
    const precision = texte(body.precision)
    const statuts = body.statuts === true
    const independant = body.independant === true
    const consentement = body.consentement === true
    const langue = body.locale === "en" ? "en" : "fr"

    if (!nom) return NextResponse.json({ error: "nameRequired" }, { status: 400 })
    if (!email || !EMAIL_RE.test(email)) return NextResponse.json({ error: "invalidEmail" }, { status: 400 })
    if (!statuts) return NextResponse.json({ error: "commitmentRequired" }, { status: 400 })
    if (!independant && !precision) return NextResponse.json({ error: "situationRequired" }, { status: 400 })
    if (!consentement) return NextResponse.json({ error: "consentRequired" }, { status: 400 })

    const nomSur = echapper(nom, 120)
    const emailSur = echapper(email, 254)
    const date = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris", dateStyle: "short", timeStyle: "short" })

    try {
      await envoyerAEquipe(
        // Sauts de ligne aplatis : l'objet doit tenir sur une ligne, quoi qu'envoie le client.
        `[ADHESION] ${nom.replace(/\s+/g, " ").slice(0, 120)}`,
        [
          `<p><strong>Nom :</strong> ${nomSur}</p>`,
          `<p><strong>Email :</strong> <a href="mailto:${emailSur}">${emailSur}</a></p>`,
          `<p><strong>Ce qu'il ou elle souhaite apporter :</strong></p>`,
          `<p style="white-space:pre-wrap">${contribution ? echapper(contribution, 1000) : "(non renseigné)"}</p>`,
          `<p><strong>A lu les statuts et s'engage à les respecter :</strong> ${oui(statuts)}</p>`,
          `<p><strong>Ne relève d'aucune situation de l'article 2.1 du règlement intérieur :</strong> ${oui(independant)}</p>`,
          ...(independant ? [] : [`<p><strong>Situation déclarée :</strong></p><p style="white-space:pre-wrap">${echapper(precision, 500)}</p>`]),
          `<p><strong>Consentement explicite au traitement :</strong> ${oui(consentement)}</p>`,
          `<p><strong>Date :</strong> ${date} · <strong>Langue :</strong> ${langue}</p>`,
        ].join("\n"),
        email,
      )
    } catch (err) {
      console.error("Erreur e-mail /api/adhesion:", err instanceof Error ? err.message : String(err))
      return NextResponse.json({ error: "membershipFailed" }, { status: 502 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error("Erreur /api/adhesion:", error)
    return NextResponse.json({ error: "serverError" }, { status: 500 })
  }
}
