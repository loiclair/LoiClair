// Page de bienvenue de la newsletter : l'adresse à ajouter à ses contacts, de quoi
// partager l'inscription, et le renvoi vers Ce qui me concerne. L'abonné y arrive
// depuis `/newsletter/confirmer`, une fois son email confirmé (D-066). Le bandeau
// commun du parcours est posé par `lib/navigation` ; la page n'en rend que le corps.

import { getTranslations, setRequestLocale } from "next-intl/server"
import type { Metadata } from "next"
import { Link } from "@/i18n/navigation"
import ShareButtons from "./ShareButtons"
import { Actions, BlocSuite, EnAttendantLundi, EtatParcours, STYLE_LIEN_DOUX, TexteEtape } from "../EtatParcours"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "newsletter" })
  return {
    title: t("bienvenueTitle"),
    // Hors index, et sans canonical, que Google déconseille d'associer à `noindex` :
    // la page annonce « Votre inscription est confirmée », vrai seulement pour qui
    // arrive de `/newsletter/confirmer`, jamais pour un visiteur venu d'une recherche.
    robots: { index: false, follow: true },
  }
}

export default async function BienvenuePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "newsletter" })

  return (
    <EtatParcours titre={t("bienvenueTitle")} texte={t("bienvenueText")}>
      {/* Conseil anti-spam : l'adresse d'envoi dans les contacts. */}
      <TexteEtape>
        {t.rich("bienvenueContacts", {
          adresse: (chunks) => <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{chunks}</span>,
        })}
      </TexteEtape>
      <BlocSuite titre={t("bienvenuePartager")}>
        <ShareButtons />
      </BlocSuite>
      <EnAttendantLundi titre={t("enAttendantTitre")} texte={t("enAttendantTexte")} lien={t("pourVousLien")} />
      <Actions haut={28}>
        <Link href="/" style={STYLE_LIEN_DOUX}>{t("discoverApp")}</Link>
      </Actions>
    </EtatParcours>
  )
}
