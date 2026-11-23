import { getTranslations } from "next-intl/server"

import NewsletterForm from "@/components/NewsletterForm"
import { MARGE_SECTION, STYLE_TITRE_SECTION, SurTitre } from "./Maquettes"

/**
 * Section 07 « La lettre du lundi » de la landing : la newsletter, avec son formulaire
 * d'inscription (`NewsletterForm`, variante `light`, celle de `/about`), pour s'inscrire
 * sans quitter l'accueil. Elle remplace « Aussi sur LoiClair » (choix d'Alex après
 * l'essai du 2026-11-22). Rendue par `(landing)/page.tsx` après les six sections, avant
 * la FAQ ; le namespace `newsletter` du formulaire part au navigateur sur l'accueil
 * (`TRADUCTIONS_PAR_ROUTE`).
 *
 * Sur toute la largeur et sans maquette, à la différence des sections 01 à 06 (retour
 * d'Alex) : le titre et le texte à gauche, le formulaire à droite à partir de `lg` ; en
 * dessous, l'un sous l'autre.
 */
export async function LettreSection({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing.lettre" })

  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: MARGE_SECTION }}>
      <div className="grid grid-cols-1 lg:grid-cols-2 lg:items-center" style={{ gap: "2rem clamp(2.5rem, 5vw, 5rem)" }}>
        <div style={{ minWidth: 0 }}>
          <SurTitre numero={7} libelle={t("surTitre")} />
          <h2 className="text-balance" style={{ ...STYLE_TITRE_SECTION, marginTop: "0.75rem" }}>
            {t("titre")}
          </h2>
          <p className="text-muted-foreground" style={{ marginTop: "1rem", maxWidth: "34rem", fontSize: "1.0625rem", lineHeight: 1.65 }}>
            {t("texte")}
          </p>
        </div>
        <div style={{ minWidth: 0 }}>
          <NewsletterForm variant="light" />
        </div>
      </div>
    </section>
  )
}
