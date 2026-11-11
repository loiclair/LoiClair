"use client"

// Page ouverte par le lien de l'email de désabonnement. Le lecteur doit cliquer :
// contrairement à /newsletter/confirmer, rien ne part au chargement, parce que les
// messageries ouvrent seules les liens d'un email pour les analyser, et qu'un
// désabonnement est définitif. Envoie le token à `/api/newsletter/unsubscribe/confirm`,
// puis mène vers /newsletter/desabonne. Le bandeau commun du parcours est posé par
// `lib/navigation` ; la page n'en rend que le corps.

import { Suspense, useState } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Link, useRouter } from "@/i18n/navigation"
import { Actions, EtatParcours, FLECHE, STYLE_BOUTON_NEUTRE, STYLE_BOUTON_OR, STYLE_LIEN } from "../../EtatParcours"
import { useFocusEtape } from "../../useFocusEtape"

function ConfirmerContent() {
  const t = useTranslations("newsletter")
  const tErrors = useTranslations("errors")
  const token = useSearchParams().get("token")
  const router = useRouter()
  // `error` : lien refusé (400 : jeton absent, inconnu, ou désabonnement déjà fait).
  // `passager` : limite de requêtes, erreur serveur ou réseau coupé, le même lien
  // marchera plus tard. Même partage que /newsletter/confirmer.
  const [status, setStatus] = useState<"pret" | "loading" | "error" | "passager">(token ? "pret" : "error")
  const [limite, setLimite] = useState(false)

  async function confirmer() {
    setStatus("loading")
    try {
      const res = await fetch("/api/newsletter/unsubscribe/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      // `replace` : le bouton retour ne doit pas rouvrir une page dont le lien est mort.
      if (res.ok) router.replace("/newsletter/desabonne")
      else if (res.status === 400) setStatus("error")
      else {
        setLimite(res.status === 429)
        setStatus("passager")
      }
    } catch {
      setLimite(false)
      setStatus("passager")
    }
  }

  // « Désabonnement… » garde le titre de l'étape prête : le focus reste sur le bouton.
  useFocusEtape(t(status === "error" ? "confirmErrorTitle" : status === "passager" ? "unsubscribePassagerTitle" : "unsubscribeConfirmTitle"))

  if (status === "error") {
    return (
      <EtatParcours titre={t("confirmErrorTitle")} texte={t("unsubscribeConfirmErrorText")} annonce>
        <Actions haut={8}>
          <Link href="/newsletter/desabonner" style={STYLE_LIEN}>{t("unsubscribeConfirmErrorCta")}{FLECHE}</Link>
        </Actions>
      </EtatParcours>
    )
  }

  if (status === "passager") {
    return (
      <EtatParcours titre={t("unsubscribePassagerTitle")} texte={tErrors(limite ? "rateLimited" : "serverError")} annonce>
        <Actions haut={8}>
          <button type="button" onClick={confirmer} style={STYLE_BOUTON_OR}>{tErrors("retry")}</button>
        </Actions>
      </EtatParcours>
    )
  }

  // Prêt, ou envoi en cours : le bouton reste, désactivé le temps de la réponse.
  return (
    <EtatParcours titre={t("unsubscribeConfirmTitle")} texte={t("unsubscribeConfirmIntro")} annonce>
      <Actions haut={8}>
        <button
          type="button"
          onClick={confirmer}
          disabled={status === "loading"}
          style={{ ...STYLE_BOUTON_NEUTRE, opacity: status === "loading" ? 0.7 : 1, cursor: status === "loading" ? "not-allowed" : "pointer" }}
        >
          {status === "loading" ? t("unsubscribeConfirmLoading") : t("unsubscribeConfirmSubmit")}
        </button>
      </Actions>
    </EtatParcours>
  )
}

export default function ConfirmerDesabonnementPage() {
  return (
    <Suspense>
      <ConfirmerContent />
    </Suspense>
  )
}
