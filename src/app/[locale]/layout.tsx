import type { Viewport } from "next"
import { IBM_Plex_Sans } from "next/font/google"
import { GeistMono } from "geist/font/mono"
import { notFound } from "next/navigation"
import { ThemeProvider } from "next-themes"
import { NextIntlClientProvider, hasLocale } from "next-intl"
import { setRequestLocale, getMessages, getTranslations } from "next-intl/server"
import { routing } from "@/i18n/routing"
import { messagesClient } from "@/i18n/messages-client"
import NavigationOverlay from "@/components/NavigationOverlay"
import { ogImageUrl } from "@/lib/og-metadata"

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
})

export const viewport: Viewport = {
  viewportFit: "cover",
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

type LayoutProps = {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "meta" })
  return {
    title: t("title"),
    description: t("description"),
    // Ni `alternates` ni `openGraph.url` ici : la mise en page ne connaît pas le
    // chemin de la page, et les poser y donnait l'accueil comme adresse de référence
    // à toutes les pages. Chaque page les pose par `buildAlternates` et
    // `buildOpenGraph` ; une page qui ne le fait pas n'en a aucun plutôt qu'un faux.
    openGraph: {
      title: t("title"),
      description: t("description"),
      siteName: "LoiClair",
      type: "website",
      images: [{ url: ogImageUrl(locale), width: 1200, height: 630 }],
    },
    // Ni `images`, ni titre, ni description ici : sans eux, Next recopie dans
    // `twitter:*` ceux de l'`openGraph` de la page (constaté le 2026-10-28), qui
    // restent les seuls à tenir. Un titre posé ici couvrirait celui de chaque fiche
    // sur X, qui lit `twitter:title` avant `og:title`.
    twitter: {
      card: "summary_large_image",
    },
  }
}

// Mise en page commune à toutes les pages d'une langue, au-dessus des groupes
// (landing) et (app) : vérifie la locale, pose `<html lang>` et les polices, fournit
// traductions et thème. `<html>` vit ici et non dans `app/layout.tsx`, seul endroit
// où la langue est connue : le HTML sort du serveur avec la bonne langue, là où
// il sortait en `fr` pour toutes, corrigé seulement une fois chargé dans le navigateur.
export default async function LocaleLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }
  setRequestLocale(locale)
  // Seul le socle du catalogue, que lisent les mises en page communes, part ici dans
  // le HTML de chaque page ; une route qui lit d'autres traductions côté client les
  // ajoute par son propre layout. Voir `messagesClient` et `TRADUCTIONS_PAR_ROUTE`.
  const messages = messagesClient(await getMessages({ locale }))

  return (
    <html lang={locale} className={`${ibmPlexSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-screen antialiased bg-background">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            {children}
            {/* Ici et pas dans une mise en page de groupe : il doit couvrir toutes
                les pages, accueil compris, et lire les traductions du provider. */}
            <NavigationOverlay />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
