// Image de partage (Open Graph) du site, une par langue : `buildOpenGraph` et la mise
// en page racine pointent ici avec `locale`. Toutes les pages d'une langue partagent
// la même image : les réseaux affichent déjà le titre de la page sous l'image, et un
// titre officiel de dossier tient mal sur une image (choix d'Alex du 2026-10-28).
//
// Pourquoi une route plutôt qu'un PNG fixe dans `public/` : le design vit dans le
// code (`lib/og-image.tsx`) et les textes dans les catalogues de traduction, donc une
// tagline modifiée suit sans regénérer d'image à la main. La réponse n'est gardée que
// par le CDN (`Cache-Control`), sans écriture ISR.
//
// `locale` vient d'une URL publique : toute valeur autre que `en` rend le français.

import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { OG_TAILLE, imageGenerique } from '@/lib/og-image';
import { polices } from '@/lib/og-polices';

export const dynamic = 'force-dynamic';

const CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';

export async function GET(request: NextRequest) {
  const locale = new URL(request.url).searchParams.get('locale') === 'en' ? 'en' : 'fr';
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: 'og' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  // La tagline officielle (D-007) tient en deux phrases, une par ligne.
  const tagline = tCommon('tagline').split(/(?<=\.)\s+/);

  return new ImageResponse(imageGenerique({ tagline, offre: [t('offre1'), t('offre2'), t('offre3')] }), {
    ...OG_TAILLE,
    fonts: await polices(),
    headers: { 'Cache-Control': CACHE },
  });
}
