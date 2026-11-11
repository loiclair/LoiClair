"use client"

// Page ouverte par le lien de l'email de confirmation newsletter. Elle envoie le
// token à `/api/newsletter/confirm` en POST, puis mène l'abonné confirmé vers
// `/newsletter/bienvenue` (D-066). Elle n'affiche elle-même que l'attente et les
// échecs : lien mort (réponse 400) d'un côté, incident passager de l'autre. Le
// bandeau commun du parcours est posé par `lib/navigation` ; la page n'en rend que
// le corps.

import { Suspense, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Link, useRouter } from "@/i18n/navigation"
import { Actions, EtatParcours, FLECHE, STYLE_BOUTON_OR, STYLE_LIEN, TEXTE_DOUX } from "../EtatParcours"
import { useFocusEtape } from "../useFocusEtape"

function ConfirmerContent() {
  const t = useTranslations("newsletter")
  const tErrors = useTranslations("errors")
  const searchParams = useSearchParams()
  const router = useRouter()
  // `error` : la route a refusé le lien (400, jeton absent, inconnu ou périmé), il
  // faut se réinscrire. `passager` : limite de requêtes (429), erreur serveur ou
  // réseau coupé, le même lien marchera plus tard et ne doit pas pousser à se réinscrire.
  const [status, setStatus] = useState<"loading" | "error" | "passager">("loading")
  const [limite, setLimite] = useState(false)
  // Incrémenté par « Réessayer » pour relancer l'effet avec le même jeton.
  const [essai, setEssai] = useState(0)

  useEffect(() => {
    const token = searchParams.get("token")
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réception du token via query param après redirection email
      setStatus("error")
      return
    }

    fetch("/api/newsletter/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        // `replace` et non `push` : avec `push`, le bouton retour rouvrirait cette page,
        // qui reposterait le token (accepté sans fin une fois confirmé) et renverrait
        // aussitôt vers la bienvenue : le lecteur ne pourrait plus revenir en arrière.
        if (res.ok) router.replace("/newsletter/bienvenue")
        else if (res.status === 400) setStatus("error")
        else {
          setLimite(res.status === 429)
          setStatus("passager")
        }
      })
      .catch(() => {
        setLimite(false)
        setStatus("passager")
      })
  }, [searchParams, router, essai])

  useFocusEtape(t(status === "loading" ? "confirmLoading" : status === "error" ? "confirmErrorTitle" : "confirmPassagerTitle"))

  if (status === "loading") {
    return (
      <EtatParcours titre={t("confirmLoading")} annonce>
        <p style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: "0.9375rem", color: TEXTE_DOUX, margin: 0 }}>
          <Loader2 className="animate-spin" aria-hidden="true" style={{ width: 16, height: 16 }} />
          {t("confirmAttente")}
        </p>
      </EtatParcours>
    )
  }

  if (status === "error") {
    return (
      <EtatParcours titre={t("confirmErrorTitle")} texte={t("confirmErrorText")} annonce>
        <Actions haut={8}>
          <Link href="/newsletter" style={STYLE_LIEN}>{t("confirmErrorCta")}{FLECHE}</Link>
        </Actions>
      </EtatParcours>
    )
  }

  return (
    <EtatParcours titre={t("confirmPassagerTitle")} texte={tErrors(limite ? "rateLimited" : "serverError")} annonce>
      <Actions haut={8}>
        <button
          type="button"
          onClick={() => {
            setStatus("loading")
            setEssai((n) => n + 1)
          }}
          style={STYLE_BOUTON_OR}
        >
          {tErrors("retry")}
        </button>
      </Actions>
    </EtatParcours>
  )
}

export default function ConfirmerPage() {
  return (
    <Suspense>
      <ConfirmerContent />
    </Suspense>
  )
}
