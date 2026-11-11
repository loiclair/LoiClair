// Page atteinte après le formulaire d'inscription (`NewsletterForm`) : l'e-mail de
// confirmation est parti (D-066). Le bandeau commun du parcours est posé par
// `lib/navigation` ; la page n'en rend que le corps.

import { getTranslations, setRequestLocale } from "next-intl/server"
import type { Metadata } from "next"
import { Link } from "@/i18n/navigation"
import { buildAlternates } from "@/lib/og-metadata"
import { Actions, EnAttendantLundi, EtatParcours, STYLE_LIEN_DOUX, TexteEtape } from "../EtatParcours"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "newsletter" })
  return { title: t("merciTitle"), alternates: buildAlternates(locale, "/newsletter/merci") }
}

export default async function MerciPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "newsletter" })

  return (
    <EtatParcours titre={t("merciTitle")} texte={t("merciText")}>
      <TexteEtape>{t("merciDoubleOptIn")}</TexteEtape>
      <EnAttendantLundi titre={t("enAttendantTitre")} texte={t("enAttendantTexte")} lien={t("pourVousLien")} />
      <Actions haut={28}>
        <Link href="/" style={STYLE_LIEN_DOUX}>{t("backHome")}</Link>
      </Actions>
    </EtatParcours>
  )
}
