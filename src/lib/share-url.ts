const BASE_URL = 'https://loiclair.fr';

/**
 * Construit l'URL absolue et partageable d'une page.
 * Le routage (`src/i18n/routing.ts`) utilise localePrefix: 'always' : toutes les locales (y compris fr) sont préfixées,
 * comme dans `buildAlternates` et `buildOpenGraph` (`og-metadata.ts`) et dans le sitemap.
 */
export function buildShareUrl(locale: string, path: string): string {
  return `${BASE_URL}/${locale}${path}`;
}

export function buildXShareUrl(url: string, text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function buildLinkedInShareUrl(url: string): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

export function buildWhatsAppShareUrl(url: string, text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`;
}
