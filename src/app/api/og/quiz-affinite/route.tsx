// Image OG dynamique pour un résultat partagé du quiz d'affinité.
// `g` et `pct` viennent d'une URL publique (potentiellement modifiée par
// l'utilisateur) : jamais de texte libre injecté dans l'image, chaque uid de
// `g` (plusieurs quand des groupes sont ex æquo) est validé contre la liste
// réelle des groupes actifs et `pct` contre un entier 0–100. En cas de
// paramètre invalide, image générique de secours.

import { ImageResponse } from "next/og"
import { CaseLcCoin } from "@/lib/og-image"
import { polices } from "@/lib/og-polices"
import type { NextRequest } from "next/server"
import { joindreLibelles } from "@/lib/quiz-affinite"
import { resolveQuizAffiniteShareParams } from "@/lib/quiz-affinite-queries"

// Mise en cache par le CDN, un jour, comme l'image générique (`api/og/route.tsx`) :
// les groupes actifs ne changent qu'une fois par nuit, et sans cet en-tête chaque
// robot d'aperçu (X, LinkedIn, WhatsApp…) recalculerait l'image et relirait la base
// lors d'un partage viral. Un `revalidate` ne suffit pas : la route lit l'URL de la
// requête, elle est donc dynamique, et il y serait inerte.
const CACHE = "public, s-maxage=86400, stale-while-revalidate=604800"

export const dynamic = "force-dynamic"

export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const COPY = {
  fr: {
    brand: "LoiClair",
    tagline: "Quiz d'affinité politique",
    resultBadge: "Mon résultat",
    affinityWith: "d'affinité avec",
    cta: "Faites le test à votre tour →",
  },
  en: {
    brand: "LoiClair",
    tagline: "Political affinity quiz",
    resultBadge: "My result",
    affinityWith: "aligned with",
    cta: "Take the quiz yourself →",
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

  const result = await resolveQuizAffiniteShareParams(searchParams.get("g"), searchParams.get("pct"))

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

  // Ex æquo : couleur de la marque plutôt que celle d'un des groupes, qui le
  // mettrait devant les autres.
  const couleur = result.groupes.length > 1 ? "#06B6D4" : result.groupes[0].couleur

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
        <span style={{ fontSize: 160, fontWeight: 800, color: couleur, marginTop: 24, lineHeight: 1 }}>
          {result.percent}%
        </span>
        <span
          style={{
            fontSize: 32,
            fontWeight: 600,
            color: "#1C1917",
            marginTop: 8,
            maxWidth: 900,
            textAlign: "center",
          }}
        >
          {copy.affinityWith} {joindreLibelles(result.groupes.map((g) => g.libelle), locale)}
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
