import { getTranslations } from "next-intl/server"
import { ArrowRight } from "lucide-react"

import { Link } from "@/i18n/navigation"

/**
 * Bande d'appel de fin de landing : « Une loi vous intrigue ? Lisez-la en deux
 * minutes. », puis un bouton vers la liste des textes. Rendue par `(landing)/page.tsx`
 * entre la FAQ et « Nos sources ».
 *
 * Sur une surface beige aux coins arrondis (`.landing-surface`), et non sur un dégradé
 * teal comme dans la maquette v8 : les bandes pleine largeur de l'accueil sont celles
 * des sections, crème, beige ou brun profond (D-375).
 */
export async function BandeFinale({ locale }: { locale: string }) {
  const [t, tLoi] = await Promise.all([
    getTranslations({ locale, namespace: "landing.bandeFinale" }),
    getTranslations({ locale, namespace: "landing.loiEnClair" }),
  ])
  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: "clamp(1.5rem, 3vw, 2.5rem)" }}>
      <div className="landing-surface" style={{ borderRadius: 28, padding: "clamp(2.5rem, 6vw, 4.5rem) clamp(1.25rem, 4vw, 3rem)", textAlign: "center" }}>
        <h2
          className="text-balance"
          style={{ maxWidth: "20em", marginInline: "auto", fontSize: "clamp(1.75rem, 3.2vw, 2.5rem)", fontWeight: 700, lineHeight: 1.1, letterSpacing: "-0.03em" }}
        >
          {t("titre")}
        </h2>
        <p className="text-muted-foreground" style={{ maxWidth: "36rem", margin: "1rem auto 0", fontSize: "1.0625rem", lineHeight: 1.6 }}>
          {t("sousTitre")}
        </p>
        <Link
          href="/dossiers-legislatifs"
          className="inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground"
          style={{ marginTop: "1.75rem", gap: 8, padding: "0.8rem 1.3rem", fontSize: "0.9375rem", fontWeight: 600, lineHeight: 1 }}
        >
          {tLoi("lien")}
          <ArrowRight aria-hidden style={{ width: 16, height: 16 }} />
        </Link>
      </div>
    </section>
  )
}
