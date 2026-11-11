// Landing `/fr`, `/en`, en sections illustrées : hero (présentation et recherche),
// la carte avant / après (`LoiEnClair`, animée), « Comment on résume les lois »,
// « Ce que les lois changent pour vous, selon votre situation » (`PourVousSection`),
// « Comment on arrive à nos chiffres », les règles, « Ce que LoiClair n'est pas »,
// « Aussi sur LoiClair », puis les sources, juste avant le pied de page. Les sections
// illustrées changent de côté de maquette d'une section à la suivante. Seule
// `MethodeChiffres` lit la base, pour le vrai taux de promulgation de sa maquette.
// Statique. Porte aussi la fiche schema.org de l'association éditrice.
// `.landing-page` (globals.css) pose le fond crème de toute la page.
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { routing } from "@/i18n/routing"
import { Hero } from "./components/Hero"
import { LoiEnClair } from "./components/LoiEnClair"
import { PourVousSection } from "./components/PourVousSection"
import { MethodeChiffres, MethodeResumes } from "./components/MethodeCard"
import { ReglesBand } from "./components/ReglesBand"
import { NEstPas } from "./components/NEstPas"
import { SectionsBand } from "./components/SectionsBand"
import { NosSources } from "./components/NosSources"
import { ASSOCIATION, FONDATEURS } from "@/lib/association"
import { buildAlternates, buildOpenGraph } from "@/lib/og-metadata"

/**
 * Fiche schema.org de l'association, lue par les moteurs de recherche pour
 * reconnaître qui édite le site. Posée sur l'accueil seul, comme Google le
 * recommande pour une organisation. `logo` est l'icône de 512 px, la case Lc sur
 * fond teal : Google demande au moins 112 px, que le favicon (32 px) n'atteint pas.
 */
const FICHE_ASSOCIATION = {
  "@context": "https://schema.org",
  "@type": "NGO",
  name: ASSOCIATION.nom,
  url: "https://loiclair.fr",
  logo: "https://loiclair.fr/icon-512.png",
  email: ASSOCIATION.email,
  foundingDate: ASSOCIATION.dateDeclaration,
  address: {
    "@type": "PostalAddress",
    streetAddress: ASSOCIATION.siege.rue,
    postalCode: ASSOCIATION.siege.codePostal,
    addressLocality: ASSOCIATION.siege.ville,
    addressCountry: "FR",
  },
  founder: FONDATEURS.map((f) => ({ "@type": "Person", name: f.nom, sameAs: f.linkedin })),
  sameAs: ["https://github.com/loiclair/LoiClair"],
}

export const revalidate = 172800 // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static'

// Titre et description du site, ceux que la mise en page pose déjà ; la page ajoute
// son adresse de référence, `/fr` ou `/en`, que la mise en page ne pose plus.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "meta" })
  const title = t("title")
  const description = t("description")
  return {
    title,
    description,
    alternates: buildAlternates(locale, ""),
    openGraph: { ...buildOpenGraph(locale, "", title, description), type: "website" },
  }
}

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  // Une adresse d'un seul segment avec un point (`/wp-login.php`) échappe au proxy
  // et arrive ici comme langue. Le `notFound()` du layout ne suffit pas : la page se
  // rend en même temps que lui, et `toLocaleString()` de `MethodeChiffres` levait une
  // RangeError, d'où une 500 au lieu de la 404.
  if (!hasLocale(routing.locales, locale)) notFound()
  setRequestLocale(locale)
  return (
    <div className="landing-page">
      {/* `<` échappé comme le recommande la doc de Next, pour qu'aucune valeur ne
          puisse fermer la balise. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FICHE_ASSOCIATION).replace(/</g, "\\u003c") }}
      />
      <Hero />
      <LoiEnClair locale={locale} />
      <MethodeResumes locale={locale} />
      <PourVousSection locale={locale} />
      <MethodeChiffres locale={locale} />
      <ReglesBand locale={locale} />
      <NEstPas locale={locale} />
      <SectionsBand />
      <NosSources locale={locale} />
    </div>
  )
}
