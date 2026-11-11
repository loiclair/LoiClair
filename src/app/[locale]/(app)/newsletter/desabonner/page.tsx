"use client"

/**
 * /newsletter/desabonner : demande de désabonnement par saisie de l'adresse, protégée
 * par Turnstile. `POST /api/newsletter/unsubscribe` envoie un lien de confirmation,
 * qui mène à /newsletter/desabonner/confirmer. La page annonce cet email sans dire si
 * l'adresse est abonnée. Le bandeau commun du parcours est posé par `lib/navigation` ;
 * la page n'en rend que le corps.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { useTheme } from "next-themes"
import { Link } from "@/i18n/navigation"
import { useTurnstile } from "@/hooks/useTurnstile"
import { Actions, EtatParcours, STYLE_BOUTON_NEUTRE, STYLE_LIEN_DOUX } from "../EtatParcours"
import { useFocusEtape } from "../useFocusEtape"

// Anneau du champ actif, à la place du contour natif retiré : l'or foncé de
// `NewsletterForm`, lisible sur la pill blanche dans les deux thèmes.
const ANNEAU_FOCUS = "#B8862F"

export default function DesabonnerPage() {
  const t = useTranslations("newsletter")
  const tErrors = useTranslations("errors")

  // Les routes `/api/*` rendent un code, pas une phrase : un code inconnu (route
  // plus récente que cette page) retombe sur le message générique plutôt que de
  // faire lever next-intl.
  const messageErreur = (code: unknown): string =>
    typeof code === "string" && tErrors.has(code) ? tErrors(code) : t("errorGeneric")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [champActif, setChampActif] = useState(false)
  const [envoye, setEnvoye] = useState(false)

  // Le widget suit le thème du site, et non celui du système (`auto`) : les deux
  // peuvent différer quand le lecteur a choisi l'un à la main.
  const { resolvedTheme } = useTheme()
  const { setContainer: setTurnstileContainer, token, reset: resetTurnstile } = useTurnstile({
    sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    theme: resolvedTheme === "dark" ? "dark" : "light",
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!email.trim()) {
      setError(t("unsubscribeErrorEmail"))
      return
    }

    if (!token) {
      setError(t("unsubscribeErrorTurnstile"))
      return
    }

    setLoading(true)
    // Réseau coupé ou réponse non JSON (page d'erreur HTML d'un proxy) : sans ce
    // `try`, le bouton restait désactivé sur « en cours », ou l'échec ne disait rien.
    try {
      const res = await fetch("/api/newsletter/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, turnstileToken: token }),
      })
      if (res.ok) {
        setEnvoye(true)
      } else {
        const data = await res.json().catch(() => ({}))
        setError(messageErreur(data.error))
        resetTurnstile()
      }
    } catch {
      setError(t("errorGeneric"))
      resetTurnstile()
    } finally {
      setLoading(false)
    }
  }

  useFocusEtape(t(envoye ? "unsubscribeSentTitle" : "unsubscribeTitle"))

  if (envoye) {
    return (
      <EtatParcours titre={t("unsubscribeSentTitle")} texte={t("unsubscribeSentText")} annonce>
        <Actions haut={8}>
          <Link href="/" style={STYLE_LIEN_DOUX}>{t("backHome")}</Link>
        </Actions>
      </EtatParcours>
    )
  }

  return (
    <EtatParcours titre={t("unsubscribeTitle")} texte={t("unsubscribeIntro")} annonce>
      <form onSubmit={handleSubmit} style={{ maxWidth: 440, marginTop: 20 }}>
        <label htmlFor="nl-desabonner-email" style={{ display: "block", fontSize: "0.8125rem", fontWeight: 500, color: "var(--foreground)", margin: "0 0 6px" }}>
          {t("emailLabel")}
        </label>
        {/* Pill blanche dans les deux thèmes, comme celle de l'inscription, et le
            bouton dessous, comme dans la carte d'inscription (choix d'Alex). */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "#fff",
            borderRadius: 9999,
            padding: "0.6875rem 1.375rem",
            border: `1.5px solid ${champActif ? ANNEAU_FOCUS : "color-mix(in srgb, var(--foreground) 12%, transparent)"}`,
            boxShadow: champActif ? `0 0 0 2px ${ANNEAU_FOCUS}` : "none",
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
        >
          <input
            id="nl-desabonner-email"
            type="email"
            autoComplete="email"
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={e => setEmail(e.target.value)}
            onFocus={() => setChampActif(true)}
            onBlur={() => setChampActif(false)}
            required
            style={{
              flex: 1,
              minWidth: 0,
              border: "none",
              outline: "none",
              background: "transparent",
              color: "#1C1917",
              // 16 px : en dessous, Safari sur iPhone zoome la page au focus du champ.
              fontSize: "1rem",
              padding: "0.25rem 0",
            }}
          />
        </div>

        {/* Bouton neutre et non or : on ne pousse pas à se désabonner. À contour et
            non plein : plein, aux couleurs du thème, il sortait blanc cassé en thème
            sombre juste sous le champ blanc, et les deux se confondaient. */}
        <button
          type="submit"
          disabled={loading}
          style={{
            ...STYLE_BOUTON_NEUTRE,
            background: "transparent",
            color: "var(--foreground)",
            border: "1.5px solid color-mix(in srgb, var(--foreground) 40%, transparent)",
            width: "100%",
            marginTop: 14,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? t("unsubscribeLoading") : t("unsubscribeSubmit")}
        </button>

        {/* Widget Turnstile, rendu programmatique via le hook */}
        <div ref={setTurnstileContainer} style={{ marginTop: 14 }} />

        {error && (
          <p role="alert" style={{ fontSize: "0.8125rem", color: "var(--destructive)", margin: "10px 0 0" }}>{error}</p>
        )}
      </form>
    </EtatParcours>
  )
}
