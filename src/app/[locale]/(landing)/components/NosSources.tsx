import { getTranslations } from "next-intl/server"
import { ArrowRight } from "lucide-react"
import { Link } from "@/i18n/navigation"
import { SOURCES_ACCUEIL } from "@/lib/sources"

/**
 * Section « Nos sources », dernière de la landing, centrée juste avant le pied de
 * page : les noms courts des sources et le lien vers `/about#sources`. Appelé par
 * `(landing)/page.tsx`. Les noms viennent de la liste unique `lib/sources.ts`, chaque
 * nom court une fois, officielles puis tierces.
 *
 * Du texte seul, sans logo : une rangée de logos institutionnels se lit comme une
 * caution, que les licences de données ne permettent pas de suggérer ; les logos, le
 * détail de chaque source et la mention d'indépendance vivent sur `/about#sources`.
 * Les noms ne tiennent pas sur une ligne, même à la largeur maximale de la section :
 * ils passent à la ligne, centrés.
 */

export async function NosSources({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "landing" })

  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: "clamp(2.5rem, 5vw, 4rem)", textAlign: "center" }}>
      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.02em" }}>{t("s5SourcesLabel")}</h2>
      {/* Des noms séparés par un écart et non par des « · » : un séparateur finissait
        toujours une ligne sur un point orphelin, à la coupure. Chaque nom reste
        d'un bloc (`nowrap`), et les lignes se centrent. */}
      <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0 0", display: "flex", flexWrap: "wrap", justifyContent: "center", columnGap: "1.5rem", fontSize: "0.9375rem", fontWeight: 500, lineHeight: 1.9 }}>
        {SOURCES_ACCUEIL.map(({ cle }) => (
          <li key={cle} style={{ whiteSpace: "nowrap" }}>
            {t(cle)}
          </li>
        ))}
      </ul>
      <Link
        href="/about#sources"
        className="inline-flex items-center hover:underline"
        style={{ marginTop: "0.75rem", gap: 6, fontSize: "0.875rem", fontWeight: 600, color: "var(--primary)" }}
      >
        {t("s5SourcesDetail")}
        <ArrowRight aria-hidden style={{ width: 14, height: 14 }} />
      </Link>
    </section>
  )
}
