// Détail nominatif d'un scrutin, en JSON. Appelée à l'ouverture du volet de détail,
// depuis la carte de vote du parcours de la loi (fiche dossier). La lecture elle-même vit
// dans `lib/scrutin-votes.ts`, partagée avec la page d'un vote (`/Scrutins/[uid]`).
//
// Chargement à la demande plutôt que rendu serveur : un scrutin porte ~577 noms, et une
// fiche dossier compte jusqu'à cinq votes. Les embarquer dans le payload de chaque fiche
// coûterait à tout le monde ce que seuls les lecteurs qui ouvrent le volet consomment.

import { NextRequest, NextResponse } from 'next/server';
import { chargerVotesScrutin, type ScrutinVotesResponse } from '@/lib/scrutin-votes';
import { estUidScrutin } from '@/lib/uid-fiches';

// Route dynamique : lire `searchParams` la sort du rendu statique. Un `revalidate` ici
// serait donc inerte, et c'est ce qu'on veut : une correction en base se voit
// immédiatement, sans redéploiement ni purge de cache.
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const uid = (req.nextUrl.searchParams.get('uid') ?? '').trim();
  // Valider la forme borne le nombre de valeurs distinctes qui atteignent la base, ce qui
  // évite d'avoir à poser un rate limit Redis sur une route publique en lecture seule.
  if (!estUidScrutin(uid)) {
    return NextResponse.json({ error: 'invalid_uid' }, { status: 400 });
  }

  let body: ScrutinVotesResponse | null;
  try {
    body = await chargerVotesScrutin(uid);
  } catch (e) {
    console.error('[scrutin-votes]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });
  }
  if (!body) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(body);
}
