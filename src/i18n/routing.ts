// Routage multilingue de next-intl, lu par le proxy (`src/proxy.ts`) et par `navigation.ts`.
// La langue est toujours dans l'URL : deux lecteurs d'une même adresse reçoivent la
// même page, ce qui permet au cache Cloudflare de la garder.
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
  localePrefix: 'always',
  localeDetection: false,
  // Pas d'en-tête HTTP `Link` posé par le proxy : son `x-default` vise l'adresse
  // sans langue, qui redirige, et il doublonnerait les `hreflang` que chaque page
  // pose dans son HTML (`buildAlternates`, `lib/og-metadata.ts`).
  alternateLinks: false,
  // Pas de `Set-Cookie` posé par le serveur : Cloudflare ne garde pas une réponse qui
  // en porte, et next-intl en pose un dès que la langue de la page diffère de celle du
  // navigateur (constaté sur `/fr` avec `Accept-Language: en`, ou sans cet en-tête). Le
  // cookie de langue se pose au clic (`choix-langue.ts`).
  localeCookie: false,
})
