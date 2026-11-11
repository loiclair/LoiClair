import { getTranslations } from "next-intl/server"
import { X } from "lucide-react"
import { STYLE_TITRE_SECTION } from "./Maquettes"

/**
 * Section « Ce que LoiClair n'est pas » de la landing : trois cartes (un média
 * d'opinion, un site officiel, un jugement sur les personnes). Appelé par
 * `(landing)/page.tsx`.
 *
 * « Sans éditorialiser » vit ici, à la ligne « Un média d'opinion » (D-184) : c'est
 * la mission du site, elle ne se retire pas en allégeant la section.
 */

const CARTES = ["opinion", "officiel", "jugement"] as const

export async function NEstPas({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" })

  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: "clamp(3rem, 6vw, 5rem)" }}>
      <h2 className="text-balance" style={STYLE_TITRE_SECTION}>
        {t("nEstPas.titre")}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 16, marginTop: "1.75rem" }}>
        {CARTES.map((key) => (
          <div key={key} className="landing-surface" style={{ borderRadius: 28, padding: 24 }}>
            <span
              aria-hidden
              className="grid place-items-center"
              style={{ width: 32, height: 32, borderRadius: 999, backgroundColor: "var(--card)", color: "var(--muted-foreground)" }}
            >
              <X style={{ width: 16, height: 16 }} />
            </span>
            <h3 style={{ marginTop: 16, fontSize: "1.0625rem", fontWeight: 700, letterSpacing: "-0.01em" }}>{t(`nEstPas.${key}Titre`)}</h3>
            <p className="text-muted-foreground" style={{ marginTop: 6, fontSize: "0.9375rem", lineHeight: 1.5 }}>
              {t(`nEstPas.${key}Texte`)}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
