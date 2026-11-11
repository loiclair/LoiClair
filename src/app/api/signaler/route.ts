/**
 * POST /api/signaler : reçoit le formulaire « Signaler » (`SignalerProbleme.tsx`).
 *
 * Ce qui est public : type, date, description et la page signalée quand le visiteur
 * l'a donnée partent dans une issue GitHub, visible par tous le jour où le dépôt
 * l'est. L'adresse de la page d'où il écrit n'est ni demandée ni lue : elle pouvait
 * porter une recherche (après le `#`) et finir publiée sans qu'il le sache.
 * Ce qui reste privé : l'e-mail du visiteur, facultatif. Il n'entre jamais dans
 * l'issue ; il part à contact@loiclair.fr avec le même contenu, en `replyTo`.
 */
import { NextRequest, NextResponse } from "next/server"
import { signalerRateLimit, getClientIp } from "@/lib/rate-limit"
import { envoyerAEquipe } from "@/lib/emails"
import { refusTurnstile } from "@/lib/turnstile"
import { echapperHtml } from "@/lib/echapper-html"
import { blocDeCode, codeEnLigne } from "./markdown"

const TYPES_PROBLEME = ["donnee-incorrecte", "affichage", "lien-casse", "ia", "autre-probleme"]
const TYPES_IDEE = ["nouvelle-fonctionnalite", "amelioration", "autre-idee"]
const CATEGORIES_VALIDES = ["probleme", "idee"]

const TYPE_LABELS: Record<string, string> = {
  "donnee-incorrecte": "Donnée incorrecte",
  "affichage": "Problème d'affichage",
  "lien-casse": "Lien cassé",
  "ia": "Résumé IA incorrect",
  "autre-probleme": "Autre problème",
  "nouvelle-fonctionnalite": "Nouvelle fonctionnalité",
  "amelioration": "Amélioration existante",
  "autre-idee": "Autre idée",
}

/** Tronque à 1 000 caractères puis échappe : tronquer après couperait une entité en deux. */
function sanitize(str: string): string {
  return echapperHtml(str.slice(0, 1000))
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export async function POST(request: NextRequest) {
  try {
    const { success } = await signalerRateLimit.limit(getClientIp(request))
    if (!success) {
      return NextResponse.json(
        { error: 'reportRateLimited' },
        { status: 429 }
      )
    }

    // Un corps illisible, ou le JSON `null`, est une erreur du client et non du
    // serveur : sans ce garde, `body.turnstileToken` lèverait et rendrait un 500.
    // Même garde que `/api/adhesion`.
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: 'invalidBody' }, { status: 400 })
    }
    const turnstileToken: string = body.turnstileToken || ''
    if (!turnstileToken) {
      return NextResponse.json({ error: 'turnstileMissing' }, { status: 400 })
    }
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || ''
    const refus = await refusTurnstile(turnstileToken, ip)
    if (refus) {
      return NextResponse.json({ error: refus }, { status: 400 })
    }

    const { category, type, description, email, pageConcernee } = body

    // Validation
    if (!category || !CATEGORIES_VALIDES.includes(category)) {
      return NextResponse.json(
        { error: 'invalidCategory' },
        { status: 400 }
      )
    }
    const typesValides = category === "probleme" ? TYPES_PROBLEME : TYPES_IDEE
    if (!type || !typesValides.includes(type)) {
      return NextResponse.json(
        { error: 'invalidType' },
        { status: 400 }
      )
    }
    if (!description || typeof description !== "string" || !description.trim()) {
      return NextResponse.json(
        { error: 'descriptionRequired' },
        { status: 400 }
      )
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json(
        { error: 'invalidEmail' },
        { status: 400 }
      )
    }

    // Deux formes de chaque saisie libre : brute pour l'issue, où `blocDeCode` et
    // `codeEnLigne` la neutralisent, échappée pour le HTML de l'e-mail à l'équipe.
    const descBrute = description.trim().slice(0, 1000)
    const descSanitized = sanitize(description.trim())
    const pageBrute =
      typeof pageConcernee === "string" && pageConcernee.trim()
        ? pageConcernee.trim().slice(0, 300)
        : ""
    const pageSignalee = pageBrute ? sanitize(pageBrute) : ""
    const now = new Date().toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Paris",
    })

    // Création issue GitHub
    const isIdee = category === "idee"
    const tag = isIdee ? "Idée" : "Signalement"
    // Le titre porte la page signalée quand le visiteur l'a donnée. Texte brut :
    // GitHub n'y active ni mention ni lien, et l'objet de l'e-mail, qui le
    // reprend, est du texte et non du HTML.
    const issueTitle = `[${tag}] ${TYPE_LABELS[type]}${pageBrute ? ` — ${pageBrute.slice(0, 80)}` : ""}`
    const issueBody = [
      `## ${tag} utilisateur`,
      "",
      `**Type :** ${TYPE_LABELS[type]}`,
      ...(pageBrute ? [`**Page signalée :** ${codeEnLigne(pageBrute)}`] : []),
      `**Date :** ${now}`,
      `**Contact :** ${email ? "transmis en privé" : "non fourni"}`,
      "",
      "### Description",
      blocDeCode(descBrute),
      "",
      "---",
      `_${tag} automatique depuis LoiClair._`,
    ].join("\n")

    // Vérifié avant l'e-mail : sinon un jeton absent enverrait l'e-mail puis
    // rendrait 500, et chaque nouvel essai du visiteur en enverrait un de plus.
    const token = process.env.GITHUB_TOKEN
    if (!token) {
      console.error("GITHUB_TOKEN manquant")
      return NextResponse.json(
        { error: 'serverMisconfigured' },
        { status: 500 }
      )
    }

    // L'e-mail part avant l'issue. S'il échoue, rien n'est publié et le visiteur
    // peut réessayer sans créer de doublon public ; si c'est l'issue qui échoue
    // ensuite, le seul doublon possible est un e-mail privé.
    // Tout ce qui vient du visiteur est échappé : `isValidEmail` laisse passer
    // `<`, `>` et `"`.
    if (email) {
      const emailSafe = sanitize(email)
      try {
        await envoyerAEquipe(
          issueTitle,
          [
            `<p><strong>Type :</strong> ${TYPE_LABELS[type]}</p>`,
            ...(pageSignalee ? [`<p><strong>Page signalée :</strong> ${pageSignalee}</p>`] : []),
            `<p><strong>Date :</strong> ${now}</p>`,
            `<p><strong>Contact :</strong> <a href="mailto:${emailSafe}">${emailSafe}</a></p>`,
            `<p style="white-space:pre-wrap">${descSanitized}</p>`,
          ].join("\n"),
          email,
        )
      } catch (err) {
        console.error("Erreur e-mail /api/signaler:", err instanceof Error ? err.message : String(err))
        return NextResponse.json(
          { error: 'reportFailed' },
          { status: 502 }
        )
      }
    }

    const ghRes = await fetch(
      "https://api.github.com/repos/loiclair/LoiClair/issues",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: issueTitle,
          body: issueBody,
          labels: [isIdee ? "idée" : "signalement", type],
        }),
      }
    )

    if (!ghRes.ok) {
      const ghError = await ghRes.text()
      console.error("Erreur GitHub API:", ghRes.status, ghError)
      return NextResponse.json(
        { error: 'reportFailed' },
        { status: 502 }
      )
    }

    const ghData = await ghRes.json()

    return NextResponse.json({ issueUrl: ghData.html_url })
  } catch (error) {
    console.error("Erreur /api/signaler:", error)
    return NextResponse.json(
      { error: 'serverError' },
      { status: 500 }
    )
  }
}
