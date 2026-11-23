import { getTranslations } from "next-intl/server"
import { ArrowRight, CircleCheck, Code, Landmark, ShieldCheck } from "lucide-react"

import { Link } from "@/i18n/navigation"

/**
 * Bande d'appel de fin de landing : « Une loi vous intrigue ? Lisez-la en deux
 * minutes. », les quatre preuves courtes de LoiClair (gratuit, sources officielles, non
 * partisan, open source), puis un bouton vers la liste des textes. Rendue par
 * `(landing)/page.tsx` entre la FAQ et « Nos sources ».
 *
 * Sur une surface beige aux coins arrondis (`.landing-surface`), et non sur un dégradé
 * teal comme dans la maquette v8 : les bandes pleine largeur de l'accueil sont celles
 * des sections, crème, beige ou brun profond (D-375).
 */

/** Les quatre preuves, chacune une clé de `landing.preuves`. */
const PREUVES = [
  { key: "gratuit", icon: CircleCheck },
  { key: "sources", icon: Landmark },
  { key: "nonPartisan", icon: ShieldCheck },
  { key: "openSource", icon: Code },
] as const

export async function BandeFinale({ locale }: { locale: string }) {
  const [t, tLoi, tPreuves] = await Promise.all([
    getTranslations({ locale, namespace: "landing.bandeFinale" }),
    getTranslations({ locale, namespace: "landing.loiEnClair" }),
    getTranslations({ locale, namespace: "landing.preuves" }),
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
        <ul
          className="flex flex-wrap justify-center"
          style={{ maxWidth: "40rem", margin: "1.25rem auto 0", gap: "0.5rem 1.25rem", fontSize: "1rem", color: "var(--muted-foreground)" }}
        >
          {PREUVES.map(({ key, icon: Icon }) => (
            <li key={key} className="inline-flex items-center" style={{ gap: "0.4rem" }}>
              <Icon aria-hidden strokeWidth={1.5} style={{ width: 16, height: 16, flex: "none", color: "var(--primary)" }} />
              {tPreuves(key)}
            </li>
          ))}
        </ul>
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
