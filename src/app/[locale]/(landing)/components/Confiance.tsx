import { getTranslations } from "next-intl/server"
import { ArrowRight, Calculator, History, Link2, Tag, X, type LucideIcon } from "lucide-react"

import { Link } from "@/i18n/navigation"
import { STYLE_TITRE_SECTION, SurTitre } from "./Maquettes"

/**
 * Section 07 « Confiance » de la landing : « Pourquoi nous faire confiance ». Quatre
 * cartes, les règles que LoiClair s'impose (`landing.regles.*`), puis « Ce que LoiClair
 * n'est pas » en trois lignes (`landing.nEstPas.*`) et le lien vers la méthode
 * (`/about`). Rendue par `(landing)/page.tsx` après les six sections numérotées ; elle
 * remplace les anciennes sections de méthode, de règles et « Ce que LoiClair n'est
 * pas », dont la FAQ (`FaqAccueil`) reprend les textes de méthode.
 *
 * Chaque règle doit rester vérifiable sur le site (D-184) : une formule qu'un lecteur
 * pourrait démentir en une capture décrédibilise toute la section. « Sans éditorialiser »
 * vit à la ligne « Un média d'opinion » (D-184) : c'est la mission du site, elle ne se
 * retire pas en allégeant la section.
 */

const REGLES: Array<{ key: "ia" | "calcul" | "source" | "corrections"; icon: LucideIcon }> = [
  { key: "ia", icon: Tag },
  { key: "calcul", icon: Calculator },
  { key: "source", icon: Link2 },
  { key: "corrections", icon: History },
]

const N_EST_PAS = ["opinion", "officiel", "jugement"] as const

export async function Confiance({ locale }: { locale: string }) {
  const [t, tLanding] = await Promise.all([
    getTranslations({ locale, namespace: "landing.confiance" }),
    getTranslations({ locale, namespace: "landing" }),
  ])

  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: "clamp(3.5rem, 7vw, 5.5rem)" }}>
      <SurTitre numero={7} libelle={t("surTitre")} />
      <h2 className="text-balance" style={{ ...STYLE_TITRE_SECTION, marginTop: "0.75rem" }}>
        {t("titre")}
      </h2>
      <p className="text-muted-foreground" style={{ marginTop: "0.9rem", maxWidth: "40rem", fontSize: "1.0625rem", lineHeight: 1.6 }}>
        {t("sousTitre")}
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4" style={{ marginTop: "2rem", gap: "1rem" }}>
        {REGLES.map(({ key, icon: Icon }) => (
          <li key={key} className="border bg-card" style={{ borderRadius: 16, padding: "1.4rem" }}>
            <Icon aria-hidden strokeWidth={1.5} style={{ width: 20, height: 20, color: "var(--primary)" }} />
            <strong style={{ display: "block", marginTop: "0.6rem", fontSize: "1rem", fontWeight: 600, lineHeight: 1.35 }}>
              {tLanding(`regles.${key}Titre`)}
            </strong>
            <span className="text-muted-foreground" style={{ display: "block", marginTop: "0.3rem", fontSize: "0.875rem", lineHeight: 1.55 }}>
              {tLanding(`regles.${key}Texte`)}
            </span>
          </li>
        ))}
      </ul>
      <h3 style={{ marginTop: "2.25rem", fontSize: "1.0625rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{tLanding("nEstPas.titre")}</h3>
      <ul className="grid grid-cols-1 md:grid-cols-3" style={{ marginTop: "0.9rem", gap: "1rem 2rem" }}>
        {N_EST_PAS.map((key) => (
          <li key={key} className="flex items-start" style={{ gap: "0.6rem" }}>
            <X aria-hidden style={{ width: 16, height: 16, flex: "none", marginTop: "0.2rem", color: "var(--muted-foreground)" }} />
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: "block", fontSize: "0.9375rem", fontWeight: 600, lineHeight: 1.4 }}>{tLanding(`nEstPas.${key}Titre`)}</strong>
              <span className="text-muted-foreground" style={{ display: "block", marginTop: "0.15rem", fontSize: "0.875rem", lineHeight: 1.5 }}>
                {tLanding(`nEstPas.${key}Texte`)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Link
        href="/about"
        className="inline-flex items-center hover:underline"
        style={{ marginTop: "1.75rem", gap: 6, fontSize: "0.9375rem", fontWeight: 600, color: "var(--primary)" }}
      >
        {t("lien")}
        <ArrowRight aria-hidden style={{ width: 16, height: 16 }} />
      </Link>
    </section>
  )
}
