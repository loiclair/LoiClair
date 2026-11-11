"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Share } from "lucide-react"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { ShareIconX, ShareIconLinkedIn, ShareIconWhatsApp, ShareIconCopy, ShareIconCheck } from "@/components/ShareIcons"
import { buildXShareUrl, buildLinkedInShareUrl, buildWhatsAppShareUrl } from "@/lib/share-url"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"

interface ShareButtonProps {
  url: string
  message?: string
  /** Grande pilule teal, action mise en valeur (résultats de quiz). Sans lui ni
   *  `compact`, elle porte le mot de la traduction. */
  label?: string
  /** Pilule « Partager » à hauteur d'entête (PageHero), plus basse que le grand CTA des
   *  résultats de quiz. Le mot vient de la traduction, et n'apparaît qu'à partir de 768 px. */
  compact?: boolean
  /** Icône et mot « Partager », sans contour, à côté de la croix d'un tiroir. */
  discret?: boolean
  /** Nom du bouton pour les lecteurs d'écran ; « Partager cette page » par défaut. */
  ariaLabel?: string
}

// Trois formes : la pilule compacte, posée sur le bandeau de PageHero et qui suit
// ses jetons `--bandeau-*` (crème en thème clair, brun en sombre), la grande
// pilule teal des résultats de quiz, et le bouton sans contour du tiroir d'un
// changement (« Ce qui me concerne »), qui reprend l'opacité de la croix voisine.
export default function ShareButton({ url, message, label, compact = false, discret = false, ariaLabel }: ShareButtonProps) {
  const t = useTranslations("share")
  const { copied, copy } = useCopyToClipboard()
  const [hovered, setHovered] = useState(false)

  const texteBouton = label ?? t("shareCta")
  // `discret` l'emporte sur `compact` : seule la pilule d'entête réduit son mot à l'icône.
  const pilule = compact && !discret

  const text = message ?? t("defaultMessage")
  const xUrl = buildXShareUrl(url, text)
  const linkedInUrl = buildLinkedInShareUrl(url)
  const waUrl = buildWhatsAppShareUrl(url, text)

  const labelTriggerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.75rem 1.5rem",
    borderRadius: "9999px",
    border: "1.5px solid var(--primary)",
    background: hovered ? "var(--primary)" : "transparent",
    color: hovered ? "var(--primary-foreground)" : "var(--primary)",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "background-color 0.15s ease, color 0.15s ease",
  }

  // Pilule d'entête : assez lisible pour se voir au repos sur le bandeau,
  // assez basse pour tenir sur la ligne du fil d'Ariane. 2,25rem = cible tactile minimale acceptable.
  // Largeur et padding viennent de la classe `partager-compact` (globals.css) :
  // icône seule sur téléphone, icône et mot à partir de 768 px.
  const compactTriggerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.4rem",
    minHeight: "2.25rem",
    borderRadius: "9999px",
    // Couleurs empruntées aux pilules du bandeau (`CestMonEluToggle`). Partager est une
    // action secondaire : elle se range dans le vocabulaire de l'entête au lieu d'en sortir.
    border: `1px solid ${hovered ? "var(--bandeau-trait-fort)" : "var(--bandeau-trait)"}`,
    background: hovered ? "var(--bandeau-voile)" : "transparent",
    // Texte à pleine force : à 60 % d'opacité comme les pilules voisines, un bouton
    // avec un contour se lit comme désactivé. Seul le contour reste discret.
    color: "var(--bandeau-texte)",
    fontSize: "0.8125rem",
    fontWeight: 600,
    lineHeight: 1,
    cursor: "pointer",
    transition: "background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease",
  }

  // Icône de 16 px, comme la croix du tiroir (`SheetContent`), dont le bouton reprend
  // la couleur et l'opacité, au repos et au survol : en gris plus clair, les deux
  // voisins ne se lisaient pas comme une paire. 28 px de haut, centré sur la croix.
  const discretTriggerStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.35rem",
    height: 28,
    padding: "0 6px",
    fontSize: "0.8125rem",
    fontWeight: 500,
    lineHeight: 1,
    border: 0,
    borderRadius: 4,
    background: "transparent",
    color: "var(--foreground)",
    opacity: hovered ? 1 : 0.7,
    cursor: "pointer",
    transition: "opacity 0.15s ease",
  }

  const rowClass = "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted transition-colors"

  // Sur écran tactile, le clic ouvre la feuille de partage du système au lieu du popover.
  // preventDefault suffit à annuler l'ouverture : Radix compose son handler avec le nôtre
  // et renonce quand l'événement est déjà neutralisé.
  // Détection au clic et non au montage : rien à synchroniser, donc pas d'écart d'hydratation.
  // Chrome de bureau expose aussi navigator.share, d'où le filtre sur l'écran tactile — son
  // panneau système est plus pauvre que notre popover.
  const ouvrirFeuilleNative = (e: React.MouseEvent) => {
    if (typeof navigator.share !== "function" || !window.matchMedia("(pointer: coarse)").matches) return
    e.preventDefault()
    // L'URL va dans le texte, et le champ `url` reste vide : le système transmet `text` et
    // `url` comme deux éléments séparés, et une app qui ne lit que le premier perd le lien
    // sans rien signaler (Signal ; iMessage, WhatsApp et Messenger recollent les deux).
    // Fondus en une seule chaîne, ils ne peuvent plus être dissociés, et les apps à aperçu
    // de lien détectent l'URL dans le texte.
    // Rejet volontaire quand l'utilisateur ferme la feuille (AbortError) : rien à signaler.
    navigator.share({ text: `${text}\n${url}` }).catch(() => {})
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={pilule ? "partager-compact" : undefined}
          style={discret ? discretTriggerStyle : compact ? compactTriggerStyle : labelTriggerStyle}
          aria-label={ariaLabel ?? t("shareLabel")}
          onClick={ouvrirFeuilleNative}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <Share size={discret ? 16 : compact ? 15 : 18} strokeWidth={discret ? 2 : 2.5} />
          {pilule ? <span className="partager-libelle">{texteBouton}</span> : texteBouton}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto min-w-[11rem] p-1.5">
        <a href={xUrl} target="_blank" rel="noopener noreferrer" className={rowClass}>
          <ShareIconX />
          {t("shareX")}
        </a>
        <a href={linkedInUrl} target="_blank" rel="noopener noreferrer" className={rowClass}>
          <ShareIconLinkedIn />
          {t("shareLinkedIn")}
        </a>
        <a href={waUrl} target="_blank" rel="noopener noreferrer" className={rowClass}>
          <ShareIconWhatsApp />
          {t("shareWhatsApp")}
        </a>
        <button type="button" onClick={() => copy(url)} className={rowClass} style={{ width: "100%", textAlign: "left", fontFamily: "inherit" }}>
          {copied ? <ShareIconCheck /> : <ShareIconCopy />}
          {copied ? t("copied") : t("copyLink")}
        </button>
      </PopoverContent>
    </Popover>
  )
}
