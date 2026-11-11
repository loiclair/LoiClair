// Détail d'un amendement adopté, en JSON : ce que montre son tiroir sur la fiche du texte.
// Chargé à l'ouverture : le panneau du budget compte 3 306 lignes, dont chacune porterait
// sinon un texte, un exposé et jusqu'à 577 noms dans le HTML de la fiche.
//
//   GET /api/amendements/AMANR5L17PO59048B3210P1D1N001588?locale=fr
//
// Une erreur rend un code, jamais une phrase (voir CLAUDE.md). La réponse est la même pour
// tous : le CDN la garde une journée.

import { NextRequest, NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';
import { chargerDetailAmendement, lireAmendement, type DetailAmendement } from '@/lib/amendement-page';
import { estUidAmendement } from '@/lib/uid-fiches';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const locale = req.nextUrl.searchParams.get('locale') ?? '';
  // Valider la forme borne ce qui atteint la base sur une route publique en lecture seule.
  if (!estUidAmendement(uid) || !(routing.locales as readonly string[]).includes(locale)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  let detail: DetailAmendement | null;
  try {
    const ligne = await lireAmendement(uid);
    detail = ligne ? await chargerDetailAmendement(ligne, locale) : null;
  } catch (e) {
    console.error('[amendements]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });
  }
  if (!detail) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const res = NextResponse.json(detail);
  res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
  return res;
}
