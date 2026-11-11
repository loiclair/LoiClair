// src/app/api/search-index/dossiers/impacts/route.ts
// Endpoint statique de ce que chaque texte change selon « Ce qui me concerne »
// (phrases des articles, résumés des amendements adoptés), par uid. Chargé par le
// client après la liste et les résumés, pour trouver un texte par ses effets. Le
// client ne le demande que si sa copie IndexedDB n'a pas l'`impactsVersion`
// annoncée par la liste. Mêmes durées de cache que la liste (D-263).

import { NextResponse } from 'next/server';
import { lireImpacts, type ImpactsPayload } from '@/lib/search/dossier-impacts';

export const revalidate = 86400;

export async function GET() {
  let payload: ImpactsPayload;
  try {
    payload = await lireImpacts();
  } catch (e) {
    console.error('[search-index/dossiers/impacts]', e);
    // Relancée, jamais rendue en réponse 500 : Next mettrait l'erreur en cache ISR
    // pour 24 h. Sur une régénération par la minuterie, une exception garde l'ancienne
    // version.
    // Après le marquage de `/api/revalidate`, Next ne relit plus cette copie : la route
    // rend 500 tant que la base ne répond pas.
    throw new Error('[search-index/dossiers/impacts] lecture des impacts impossible');
  }
  const res = NextResponse.json(payload);
  res.headers.set(
    'Cache-Control',
    'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
  );
  return res;
}
