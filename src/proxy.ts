// Routage des langues, lancé sur toutes les pages (voir `matcher`) avant le rendu.
// next-intl gère les préfixes `/fr` et `/en` ; les adresses sans préfixe, qui ne sont
// jamais gardées par Cloudflare (une redirection sans `Cache-Control`), suivent ici le
// choix mémorisé du lecteur. Une adresse en `/fr/…` reste en français : un lien dit sa
// langue, et Cloudflare peut la servir sans passer par ce fichier.
//
// C'est le « proxy » de Next 16, nouveau nom de `middleware.ts` (déprécié). Il se place
// à côté de `app/`, donc dans `src/`, et tourne dans le moteur Node.js, là où
// `middleware.ts` tournait dans le moteur Edge.
import { NextResponse, type NextRequest } from 'next/server'
import createIntlMiddleware from 'next-intl/middleware'
import { routing } from '@/i18n/routing'
import { COOKIE_LANGUE } from '@/i18n/choix-langue'

const intl = createIntlMiddleware(routing)

const aUneLangue = (chemin: string) =>
  routing.locales.some((l) => chemin === `/${l}` || chemin.startsWith(`/${l}/`))

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  if (!aUneLangue(pathname) && request.cookies.get(COOKIE_LANGUE)?.value === 'en') {
    // Adresse absolue, sinon le proxy plante (`Invalid URL`, réponse 500). Derrière
    // Traefik, `request.url` porte l'adresse interne du conteneur, mais Next réécrit en
    // relatif toute redirection vers le même hôte : le lecteur ne la voit pas.
    return NextResponse.redirect(new URL(`/en${pathname === '/' ? '' : pathname}${search}`, request.url), 307)
  }
  return intl(request)
}

export const config = {
  matcher: '/((?!api|_next|.*\\..*).*)',
}
