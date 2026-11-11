"use client"

// Boutons de partage de la page de bienvenue de la newsletter : X, WhatsApp, copie
// du lien. Le texte partagé suit la langue de la page. Couleurs du thème : la page
// est sur le fond du site, plus sur une carte brune.

import { useTranslations } from "next-intl"
import { ShareIconX, ShareIconWhatsApp, ShareIconCopy, ShareIconCheck } from "@/components/ShareIcons"
import { buildXShareUrl, buildWhatsAppShareUrl } from "@/lib/share-url"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"

const SHARE_URL = "https://www.loiclair.fr"

export default function ShareButtons() {
  const t = useTranslations("newsletter")
  const tShare = useTranslations("share")
  const { copied, copy } = useCopyToClipboard()

  const shareText = t("bienvenueShareText")
  const xUrl = buildXShareUrl(SHARE_URL, shareText)
  const waUrl = buildWhatsAppShareUrl(SHARE_URL, shareText)

  const btnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    padding: "0.4375rem 0.875rem",
    borderRadius: 9999,
    fontSize: "0.8125rem",
    fontWeight: 500,
    textDecoration: "none",
    border: "1px solid color-mix(in srgb, var(--foreground) 18%, transparent)",
    color: "var(--card-foreground)",
    background: "transparent",
    cursor: "pointer",
    letterSpacing: "-0.01em",
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.625rem" }}>
      <a href={xUrl} target="_blank" rel="noopener noreferrer" style={btnStyle}>
        <ShareIconX size={14} />
        {tShare("shareX")}
      </a>
      <a href={waUrl} target="_blank" rel="noopener noreferrer" style={btnStyle}>
        <ShareIconWhatsApp size={14} />
        WhatsApp
      </a>
      <button onClick={() => copy(SHARE_URL)} style={{ ...btnStyle, fontFamily: "inherit" }}>
        {copied ? (
          <>
            <ShareIconCheck size={14} />
            {tShare("copied")}
          </>
        ) : (
          <>
            <ShareIconCopy size={14} />
            {tShare("copyLink")}
          </>
        )}
      </button>
    </div>
  )
}
