// src/app/api/search-index/dossiers/resumes/route.ts
// Endpoint statique des résumés de recherche de tous les dossiers, par uid. Chargé
// par le client après la liste (`/api/search-index/dossiers`), pour enrichir la
// recherche par mots-clés sans retarder l'affichage. Le client ne le demande que si
// sa copie IndexedDB n'a pas la `resumesVersion` annoncée par la liste.
// Mêmes durées de cache que la liste (D-263).

import { NextResponse } from 'next/server';
import { lireResumes, type ResumesPayload } from '@/lib/search/dossier-resumes';

export const revalidate = 86400;

export async function GET() {
  let payload: ResumesPayload;
  try {
    payload = await lireResumes();
  } catch (e) {
    console.error('[search-index/dossiers/resumes]', e);
    // Relancée, jamais rendue en réponse 500 : Next mettrait l'erreur en cache ISR
    // pour 24 h. Sur une régénération par la minuterie, une exception garde l'ancienne
    // version.
    // Après le marquage de `/api/revalidate`, Next ne relit plus cette copie : la route
    // rend 500 tant que la base ne répond pas.
    throw new Error('[search-index/dossiers/resumes] lecture des résumés impossible');
  }
  const res = NextResponse.json(payload);
  res.headers.set(
    'Cache-Control',
    'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800'
  );
  return res;
}
