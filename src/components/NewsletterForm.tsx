"use client"

/**
 * Formulaire d'inscription à la newsletter : adresse, consentement, Turnstile,
 * puis `POST /api/newsletter/subscribe` et redirection vers /newsletter/merci.
 * Appelé par /newsletter (variante `carte`) et /about (variante `light`).
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { Link, useRouter } from "@/i18n/navigation"
import { EMAIL_RE } from "@/lib/utils"
import { useTurnstile } from "@/hooks/useTurnstile"

interface NewsletterFormProps {
  /**
   * carte = dans la carte de /newsletter, papier crème dans les deux thèmes ·
   * light = pill bordée sur le fond de /about, qui suit le thème
   */
  variant: "carte" | "light"
}

// Textes secondaires du formulaire (mention de consentement, note). La carte de
// /newsletter reste crème dans les deux thèmes, d'où des gris fixes : #78716C fait
// 4,6:1 sur sa crème, quand le gris pâle du site (#A8A29E) n'y fait que 2,5:1.
// Le fond de /about, lui, change avec le thème : un gris fixe y tombait à 2,5:1
// et 1,9:1 en clair, alors que `--foreground` mélangé reste lisible dans les deux.
// 66 % et non 62 % : sur le fond beige de la section, 62 % tombait à 4,5:1 pile.
const TEXTE_DISCRET = {
  carte: "#78716C",
  light: "color-mix(in srgb, var(--foreground) 66%, transparent)",
}
const LIEN_DISCRET = {
  carte: "#44403C",
  light: "color-mix(in srgb, var(--foreground) 80%, transparent)",
}
// Anneau du champ actif, à la place du contour natif retiré. L'or plus foncé sur
// fond clair (la carte l'est dans les deux thèmes) : l'Or Doux n'y fait que 2,3:1
// sur blanc, contre 3,2:1 pour celui-ci.
const ANNEAU_FOCUS = "#B8862F"
// Bord de la pill au repos : un beige qui se détache de la crème de la carte, un gris
// sur le fond de /about.
const BORD_PILL = { carte: "#E2DACB", light: "#E7E5E4" }
// Message d'erreur : un rouge foncé sur la crème de la carte, qui ne change pas avec
// le thème.
const ROUGE_ERREUR = { carte: "#B91C1C", light: "#ef4444" }

export default function NewsletterForm({ variant }: NewsletterFormProps) {
  const t = useTranslations("newsletter")
  const tErrors = useTranslations("errors")

  // Les routes `/api/*` rendent un code, pas une phrase : un code inconnu (route
  // plus récente que cette page) retombe sur le message générique plutôt que de
  // faire lever next-intl.
  const messageErreur = (code: unknown): string =>
    typeof code === "string" && tErrors.has(code) ? tErrors(code) : t("errorGeneric")
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const [turnstileEnabled, setTurnstileEnabled] = useState(false)
  const [champActif, setChampActif] = useState(false)
  // Dans la carte, le bouton passe sous le champ : à côté de lui, il ne laissait
  // au champ qu'environ 150 px, moins encore avec l'icône d'un gestionnaire de mots
  // de passe. Choix d'Alex. Sur /about, plus large, la pill garde son bouton.
  const empile = variant === "carte"

  const { setContainer: setTurnstileContainer, token: turnstileToken, reset: resetTurnstile } = useTurnstile({
    sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    enabled: turnstileEnabled,
    // Le widget ne s'affiche que si Cloudflare demande une action au lecteur : par
    // défaut (`always`), un encadré « Succès ! » de 300 × 65 px s'insérait dans le
    // formulaire dès le premier clic dans le champ.
    appearance: "interaction-only",
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!EMAIL_RE.test(email)) {
      setErrorMsg(t("errorEmail"))
      setStatus("error")
      return
    }
    if (!consent) {
      setErrorMsg(t("errorConsent"))
      setStatus("error")
      return
    }
    if (!turnstileToken) {
      setErrorMsg(tErrors("turnstilePending"))
      setStatus("error")
      return
    }
    // Le champ est désactivé pendant l'envoi, et Chrome ne déclenche pas `blur`
    // sur un champ désactivé alors qu'il est actif : sans ceci, l'anneau restait
    // allumé après une erreur sur un champ qui n'avait plus le focus.
    setChampActif(false)
    setStatus("loading")
    setErrorMsg("")
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrorMsg(messageErreur(data.error))
        setStatus("error")
        resetTurnstile()
        return
      }
      router.push("/newsletter/merci")
    } catch {
      setErrorMsg(t("errorGeneric"))
      setStatus("error")
      resetTurnstile()
    }
  }

  // Bouton écrit, flèche en plus : un rond à flèche seule ne disait pas ce qu'il
  // faisait. La flèche est décorative, le libellé suffit.
  const bouton = (
    <button
      type="submit"
      disabled={status === "loading"}
      style={{
        height: 46,
        width: empile ? "100%" : undefined,
        borderRadius: 9999,
        background: "#D4A54A",
        color: "#1C1917",
        border: "none",
        padding: "0 18px",
        fontFamily: "inherit",
        fontSize: "0.9375rem",
        fontWeight: 600,
        whiteSpace: "nowrap",
        cursor: status === "loading" ? "not-allowed" : "pointer",
        flexShrink: 0,
        opacity: status === "loading" ? 0.6 : 1,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => { if (status !== "loading") (e.currentTarget as HTMLElement).style.background = "#C49440" }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#D4A54A" }}
    >
      {t("submitLabel")} <span aria-hidden="true">→</span>
    </button>
  )

  return (
    <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: variant === "carte" ? "0.875rem" : "0.75rem", maxWidth: "30rem" }}>
      {/* Pill : email, et le bouton dedans sauf dans la carte */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "#fff",
          borderRadius: "9999px",
          padding: empile ? "0.6875rem 1.375rem" : "6px 6px 6px 1.5rem",
          border: `1.5px solid ${champActif ? ANNEAU_FOCUS : BORD_PILL[variant]}`,
          boxShadow: champActif ? `0 0 0 2px ${ANNEAU_FOCUS}` : "none",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
      >
        {/* Le placeholder disparaît à la saisie et ne vaut pas un nom pour tous
            les lecteurs d'écran : le champ porte son `aria-label`. */}
        <input
          type="email"
          autoComplete="email"
          aria-label={t("emailLabel")}
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onFocus={() => { setTurnstileEnabled(true); setChampActif(true) }}
          onBlur={() => setChampActif(false)}
          disabled={status === "loading"}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            // 16 px : en dessous, Safari sur iPhone zoome la page au focus du champ.
            fontSize: "1rem",
            background: "transparent",
            color: "#1C1917",
            minWidth: 0,
            padding: "0.25rem 0",
          }}
        />
        {!empile && bouton}
      </div>
      {empile && bouton}

      {/* Consentement RGPD */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", maxWidth: "22rem", textAlign: "left", marginTop: variant === "carte" ? "0.375rem" : 0 }}>
        <input
          type="checkbox"
          id={`nl-consent-${variant}`}
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={status === "loading"}
          style={{
            width: 14,
            height: 14,
            margin: "2px 0 0 0",
            accentColor: "#D4A54A",
            flexShrink: 0,
            cursor: "pointer",
          }}
        />
        <label
          htmlFor={`nl-consent-${variant}`}
          style={{
            fontSize: "0.75rem",
            color: TEXTE_DISCRET[variant],
            lineHeight: 1.55,
            cursor: "pointer",
          }}
        >
          {t("consentLabel")}{" "}
          <Link
            href="/confidentialite"
            style={{
              color: LIEN_DISCRET[variant],
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            }}
          >
            {t("privacyLink")}
          </Link>
        </label>
      </div>

      {/* Erreur */}
      {/* Dans la carte, la place de l'erreur est réservée (deux lignes, `3em` à
          l'interligne 1,5) : sinon la carte grandissait à son apparition. Deux
          lignes, parce que le message le plus long (« La vérification de sécurité
          n'a pas abouti… », 78 caractères) en prend deux sur téléphone. L'élément
          reste dans la page, vide, pour que `role="alert"` annonce son contenu
          quand il change. Sur /about, l'erreur n'apparaît qu'au besoin. */}
      {(empile || status === "error") && (
        <p role="alert" style={{ fontSize: "0.72rem", lineHeight: 1.5, minHeight: empile ? "3em" : undefined, color: ROUGE_ERREUR[variant], margin: 0 }}>
          {status === "error" ? errorMsg : null}
        </p>
      )}

      {/* Widget Turnstile invisible — rendu programmatique via le hook */}
      <div ref={setTurnstileContainer} />

      {/* Note bas de form, sous le widget Turnstile quand il s'affiche : la
          dernière ligne du formulaire (choix d'Alex). */}
      <p style={{ fontSize: variant === "carte" ? "0.71875rem" : "0.75rem", color: TEXTE_DISCRET[variant], margin: 0 }}>
        {t("formNote")}
      </p>
    </form>
  )
}
