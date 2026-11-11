// La liste complète des autres amendements adoptés sur le même article, chargée quand le
// lecteur clique « Voir les N autres » : seuls les premiers partent avec la page, qui reste
// en cache sur le disque, et un article de budget en compte jusqu'à 1 027.
//
//   GET /api/amendements/AMANR5L17PO59048B3210P1D1N001588/autres
//
// Réponse : AutreAmendement[]. Une erreur rend un code, jamais une phrase (voir CLAUDE.md).
// La réponse est la même pour tous : le CDN la garde une journée.

import { NextRequest, NextResponse } from 'next/server';
import { AUTRES_TOUS, lireAmendement, lireAutresAmendements, type AutreAmendement } from '@/lib/amendement-page';
import { estUidAmendement } from '@/lib/uid-fiches';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  // Valider la forme borne ce qui atteint la base sur une route publique en lecture seule.
  if (!estUidAmendement(uid)) return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  let liste: AutreAmendement[] | null;
  try {
    const ligne = await lireAmendement(uid);
    liste = ligne ? (await lireAutresAmendements(ligne, AUTRES_TOUS)).liste : null;
  } catch (e) {
    console.error('[amendements/autres]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });
  }
  if (!liste) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const res = NextResponse.json(liste);
  res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
  return res;
}
