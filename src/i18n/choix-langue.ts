// Mémorise la langue choisie par le lecteur, pour que les adresses sans préfixe de
// langue l'y ramènent (voir `src/proxy.ts`). Appelé par les seuls gestes explicites :
// la bascule du pied de page (`LocaleToggle`) et la carte de langue de la landing
// (`SectionsBand`).
//
// Posé depuis le navigateur et jamais par le serveur : Cloudflare ne garde pas une
// réponse qui porte un `Set-Cookie`. Le nom reste celui que cite la politique de
// confidentialité (`section2NavigationCookie`).

export const COOKIE_LANGUE = 'NEXT_LOCALE'

const UN_AN = 60 * 60 * 24 * 365

export function memoriserLangue(locale: 'fr' | 'en') {
  document.cookie = `${COOKIE_LANGUE}=${locale}; Path=/; Max-Age=${UN_AN}; SameSite=Lax`
}
