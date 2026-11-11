// Métadonnées Open Graph et adresses de référence d'une page, appelées par le
// `generateMetadata` de chaque route. L'image est celle de la langue, la même pour
// toutes les pages (`/api/og`). Elle se répète ici parce que l'`openGraph` d'une page
// remplace en entier celui de la mise en page racine : sans elle, la page partirait
// sans image.
//
// Toutes les adresses portent le préfixe de langue, `/fr` compris : le proxy
// (`localePrefix: 'always'`) redirige l'adresse sans préfixe, et une adresse qui
// redirige ne vaut ni comme canonical ni comme `og:url`.

const BASE_URL = 'https://loiclair.fr';

/** Adresse de l'image de partage d'une langue. */
export function ogImageUrl(locale: string): string {
  return `${BASE_URL}/api/og?locale=${locale === 'en' ? 'en' : 'fr'}`;
}

/**
 * Adresse de référence (« canonical ») de la page et ses versions par langue
 * (`hreflang`). `pathname` est le chemin sans la langue, `''` pour l'accueil.
 * `x-default`, la version servie à une langue que le site n'a pas, est le français.
 * Une page sans cet appel n'a pas de canonical du tout : la mise en page n'en pose
 * plus, puisqu'elle ne connaît pas le chemin de la page.
 */
export function buildAlternates(locale: string, pathname: string) {
  return {
    canonical: `${BASE_URL}/${locale}${pathname}`,
    languages: {
      fr: `${BASE_URL}/fr${pathname}`,
      en: `${BASE_URL}/en${pathname}`,
      'x-default': `${BASE_URL}/fr${pathname}`,
    },
  };
}

/** Adresse de l'image de partage d'un vote (`api/og/scrutin`) : avec celle d'un amendement
 *  adopté par scrutin public, la seule exception à l'image commune, l'hémicycle et le
 *  résultat s'y lisant sans titre (voir D-302). */
export function ogImageScrutinUrl(locale: string, uid: string): string {
  return `${BASE_URL}/api/og/scrutin?uid=${encodeURIComponent(uid)}&locale=${locale === 'en' ? 'en' : 'fr'}`;
}

/** Adresse de l'image de partage d'un amendement adopté par scrutin public
 *  (`api/og/amendement`), la même mise en page que celle d'un vote. La page ne la demande
 *  que si l'amendement a un vote détaillé ; sinon elle garde l'image commune. */
export function ogImageAmendementUrl(locale: string, uid: string): string {
  return `${BASE_URL}/api/og/amendement?uid=${encodeURIComponent(uid)}&locale=${locale === 'en' ? 'en' : 'fr'}`;
}

export function buildOpenGraph(locale: string, pathname: string, title: string, description?: string, image?: string) {
  return {
    title,
    description,
    siteName: 'LoiClair',
    type: 'article' as const,
    url: `${BASE_URL}/${locale}${pathname}`,
    images: [{ url: image ?? ogImageUrl(locale), width: 1200, height: 630 }],
  };
}
