// src/app/api/search-index/amendements/textes/route.ts
// Endpoint statique du texte cherchable des amendements adoptés : dispositif et résumés
// de l'IA, au format texte de `lib/search/amendement-format.ts` (lu par
// `lib/search/amendement-textes.ts`). Chargé par le client après les métadonnées
// (`/api/search-index/amendements`), et seulement si sa copie IndexedDB n'a pas la
// `textesVersion` qu'elles annoncent. Mêmes durées de cache (D-263).

import { lireTextesAmendements } from '@/lib/search/amendement-textes';

export const revalidate = 86400;

export async function GET() {
  let corps: string;
  try {
    corps = await lireTextesAmendements();
  } catch (e) {
    console.error('[search-index/amendements/textes]', e);
    // Relancée, jamais rendue en réponse 500 : Next mettrait l'erreur en cache ISR pour
    // 24 h. Après le marquage de `/api/revalidate`, la route rend 500 tant que la base ne
    // répond pas.
    throw new Error('[search-index/amendements/textes] lecture des textes impossible');
  }
  return new Response(corps, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
}
