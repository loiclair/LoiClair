// Image OG dynamique pour un résultat partagé du quiz "Processus législatif".
// `score` vient d'une URL publique (potentiellement modifiée par
// l'utilisateur) : jamais de valeur non validée injectée dans l'image, validée
// contre un entier 0–20. En cas de paramètre invalide, image générique de secours.

import { ImageResponse } from "next/og"
import { CaseLcCoin } from "@/lib/og-image"
import { polices } from "@/lib/og-polices"
import type { NextRequest } from "next/server"
import { resolveQuizProcessusShareParams, resolveQuizProcessusTier } from "@/lib/quiz-processus"

// Mise en cache par le CDN, un jour, comme l'image générique (`api/og/route.tsx`) :
// sans cet en-tête, chaque robot d'aperçu (X, LinkedIn, WhatsApp…) recalculerait
// l'image lors d'un partage viral. Un `revalidate` ne suffit pas : la route lit
// l'URL de la requête, elle est donc dynamique, et il y serait inerte.
const CACHE = "public, s-maxage=86400, stale-while-revalidate=604800"

export const dynamic = "force-dynamic"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const COPY = {
  fr: {
    brand: "LoiClair",
    tagline: "Quiz processus législatif",
    resultBadge: "Mon résultat",
    cta: "Faites le test à votre tour →",
    tierLabels: {
      debutant: "Apprenti citoyen",
      eclaire: "Citoyen éclairé",
      expert: "Expert du Parlement",
      connaisseur: "Grand connaisseur du Parlement",
    },
  },
  en: {
    brand: "LoiClair",
    tagline: "Legislative process quiz",
    resultBadge: "My result",
    cta: "Take the quiz yourself →",
    tierLabels: {
      debutant: "Apprentice citizen",
      eclaire: "Informed citizen",
      expert: "Parliament expert",
      connaisseur: "Parliament connoisseur",
    },
  },
} as const

const baseStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#F7F5F2",
  fontFamily: "IBM Plex Sans",
  position: "relative",
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const locale = searchParams.get("locale") === "en" ? "en" : "fr"
  const copy = COPY[locale]

  const result = resolveQuizProcessusShareParams(searchParams.get("score"))

  if (!result) {
    return new ImageResponse(
      (
        <div style={baseStyle}>
          <CaseLcCoin />
          <span style={{ fontSize: 48, fontWeight: 700, color: "#06B6D4" }}>{copy.brand}</span>
          <span style={{ fontSize: 28, color: "#44403C", marginTop: 16 }}>{copy.tagline}</span>
        </div>
      ),
      { ...size, fonts: await polices(), headers: { "Cache-Control": CACHE } },
    )
  }

  const tier = resolveQuizProcessusTier(result.score)

  return new ImageResponse(
    (
      <div style={baseStyle}>
        <CaseLcCoin />
        <span style={{ fontSize: 24, fontWeight: 600, color: "#06B6D4" }}>
          {copy.brand} · {copy.tagline}
        </span>
        <span
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#A8A29E",
            letterSpacing: 3,
            marginTop: 48,
          }}
        >
          {copy.resultBadge.toUpperCase()}
        </span>
        <span style={{ fontSize: 160, fontWeight: 800, color: tier.color, marginTop: 24, lineHeight: 1 }}>
          {result.score}
          <span style={{ fontSize: 64, color: "#A8A29E" }}>/{result.total}</span>
        </span>
        <span style={{ fontSize: 32, fontWeight: 600, color: "#1C1917", marginTop: 8 }}>
          {copy.tierLabels[tier.key]}
        </span>
        <div
          style={{
            display: "flex",
            marginTop: 48,
            backgroundColor: "#1C1917",
            borderRadius: 999,
            paddingLeft: 32,
            paddingRight: 32,
            paddingTop: 16,
            paddingBottom: 16,
          }}
        >
          <span style={{ fontSize: 26, fontWeight: 600, color: "#F7F5F2" }}>{copy.cta}</span>
        </div>
      </div>
    ),
    { ...size, fonts: await polices(), headers: { "Cache-Control": CACHE } },
  )
}
