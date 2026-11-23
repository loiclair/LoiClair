// Landing `/fr`, `/en`, organisée autour de ce que le site apporte au lecteur (LOI-91) :
// le hero (titre, recherche, sujets, preuves), « Les lois dans l'actualité », six
// sections numérotées et illustrées (01 Pour vous, 02 Les lois, 03 Les débats, 04 Les
// votes, 05 Les chiffres, 06 Vos élus), dont la maquette change de côté d'une section à
// la suivante, puis 07 « Pourquoi nous faire confiance », « Aussi sur LoiClair », la
// FAQ, la bande finale et les sources, juste avant le pied de page. La méthode, qui
// occupait l'ancien accueil, vit dans la section Confiance et dans la FAQ.
// Lisent la base : `ActualiteLois`, `VotesSection` (le dernier vote) et `ChiffresSection`
// (le vrai taux de promulgation). Statique, recalculée chaque nuit. Porte aussi la fiche
// schema.org de l'association éditrice. `.landing-page` (globals.css) pose le fond crème
// de toute la page.
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { hasLocale } from "next-intl"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { routing } from "@/i18n/routing"
import { Hero } from "./components/Hero"
import { ActualiteLois } from "./components/ActualiteLois"
import { PourVousSection } from "./components/PourVousSection"
import { LoiEnClair } from "./components/LoiEnClair"
import { ChiffresSection, DebatsSection, ElusSection, VotesSection } from "./components/SectionsBenefices"
import { Confiance } from "./components/Confiance"
import { SectionsBand } from "./components/SectionsBand"
import { FaqAccueil } from "./components/FaqAccueil"
import { BandeFinale } from "./components/BandeFinale"
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
  // rend en même temps que lui, et `toLocaleString()` de `ChiffresSection` levait une
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
      <Hero locale={locale} />
      <ActualiteLois locale={locale} />
      <PourVousSection locale={locale} />
      <LoiEnClair locale={locale} />
      <DebatsSection locale={locale} />
      <VotesSection locale={locale} />
      <ChiffresSection locale={locale} />
      <ElusSection locale={locale} />
      <Confiance locale={locale} />
      <SectionsBand />
      <FaqAccueil locale={locale} />
      <BandeFinale locale={locale} />
      <NosSources locale={locale} />
    </div>
  )
}
