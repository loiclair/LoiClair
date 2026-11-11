// Dernière étape du désabonnement, atteinte depuis `/newsletter/desabonner/confirmer`
// une fois le lien accepté. Le bandeau commun du parcours est posé par
// `lib/navigation` ; la page n'en rend que le corps.

import { getTranslations, setRequestLocale } from "next-intl/server"
import type { Metadata } from "next"
import { Link } from "@/i18n/navigation"
import { buildAlternates } from "@/lib/og-metadata"
import { Actions, EtatParcours, FLECHE, STYLE_LIEN, STYLE_LIEN_DOUX } from "../EtatParcours"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "newsletter" })
  return { title: t("desabonneTitle"), alternates: buildAlternates(locale, "/newsletter/desabonne") }
}

export default async function DesabonnePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "newsletter" })

  return (
    <EtatParcours titre={t("desabonneTitle")} texte={t("desabonneText")}>
      <Actions haut={8}>
        <Link href="/newsletter" style={STYLE_LIEN}>{t("resubscribe")}{FLECHE}</Link>
        <Link href="/" style={STYLE_LIEN_DOUX}>{t("backHome")}</Link>
      </Actions>
    </EtatParcours>
  )
}
