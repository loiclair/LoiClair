"use client"

// Quatre ronds de partage de la page d'accueil (X, LinkedIn, WhatsApp, copier le
// lien). Rendus par le pied de page et par la section « Autres façons d'aider » de
// /nous-aider. Les couleurs `--footer-share-*` sont posées sur `:root` et `.dark`
// dans globals.css, donc valables hors du pied de page.

import { useTranslations } from "next-intl"
import { ShareIconX, ShareIconLinkedIn, ShareIconWhatsApp, ShareIconCopy, ShareIconCheck } from "@/components/ShareIcons"
import { buildXShareUrl, buildLinkedInShareUrl, buildWhatsAppShareUrl } from "@/lib/share-url"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"

const SHARE_URL = "https://www.loiclair.fr"

export default function FooterShare() {
  const t = useTranslations("footer")
  const tShare = useTranslations("share")
  const { copied, copy } = useCopyToClipboard()

  const message = t("shareMessage")
  const xUrl = buildXShareUrl(SHARE_URL, message)
  const linkedInUrl = buildLinkedInShareUrl(SHARE_URL)
  const waUrl = buildWhatsAppShareUrl(SHARE_URL, message)

  const circle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "2.5rem",
    height: "2.5rem",
    borderRadius: "9999px",
    border: "1px solid var(--footer-share-border)",
    background: "var(--footer-share-bg)",
    color: "var(--footer-share-color)",
    cursor: "pointer",
  }

  // Les ronds vont par paires : quand la ligne manque de place (demi-colonne du
  // pied de page sur téléphone), seule la seconde paire passe dessous, ce qui
  // donne un carré 2×2 et jamais trois ronds plus un orphelin.
  const paire: React.CSSProperties = { display: "flex", gap: "0.625rem" }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.625rem" }}>
      <div style={paire}>
        <a href={xUrl} target="_blank" rel="noopener noreferrer" style={circle} aria-label={tShare("shareX")}>
          <ShareIconX />
        </a>
        <a href={linkedInUrl} target="_blank" rel="noopener noreferrer" style={circle} aria-label={tShare("shareLinkedIn")}>
          <ShareIconLinkedIn />
        </a>
      </div>
      <div style={paire}>
        <a href={waUrl} target="_blank" rel="noopener noreferrer" style={circle} aria-label={tShare("shareWhatsApp")}>
          <ShareIconWhatsApp />
        </a>
        <button type="button" onClick={() => copy(SHARE_URL)} style={{ ...circle, fontFamily: "inherit" }} aria-label={tShare("copyLink")}>
          {copied ? <ShareIconCheck /> : <ShareIconCopy />}
        </button>
      </div>
    </div>
  )
}
