// Le contenu de « Ce qui me concerne » par blocs fixes : le bloc `k` porte les dossiers
// classés rangés par uid, du `k × 500`-ième au suivant, avec tous leurs éléments et les
// phrases de tous les profils, dans la langue demandée. Le navigateur charge tous les
// blocs (leur nombre est dans l'index de la page), puis trie, filtre et cherche chez
// lui : les mêmes requêtes pour tout le monde, rien qui dise ce que le lecteur est ni
// ce qu'il cherche (D-243).
//
//   GET /api/ce-qui-me-concerne/tout?locale=fr&bloc=0&v=<version de l'index>
// Réponse : { dossiers: DossierConcerne[] } ; une erreur rend un code, jamais une
// phrase (CLAUDE.md).
//
// Mise en cache par le CDN pour la journée, et une heure par le navigateur, qui ne
// retélécharge pas ainsi le contenu entier (0,8 Mo compressé) à chaque visite : le
// classement ne change qu'une fois par nuit. `v` (instant de construction de l'index
// de la page), que la route ignore, change la clé du cache : un index régénéré la nuit
// ne relit pas les blocs de la veille.

import { NextRequest, NextResponse } from 'next/server';
import { routing } from '@/i18n/routing';
import { assemblerBloc } from '@/lib/ce-qui-me-concerne';

export const runtime = 'nodejs';

// Borne ce qui atteint la base sur une route publique : au-delà de 20 blocs (10 000
// dossiers classés), le périmètre aurait quadruplé et ce découpage serait à revoir.
const BLOC_MAX = 19;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const locale = p.get('locale') ?? '';
  const bloc = Number(p.get('bloc'));
  if (!Number.isInteger(bloc) || bloc < 0 || bloc > BLOC_MAX || !(routing.locales as readonly string[]).includes(locale)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  try {
    const dossiers = await assemblerBloc(bloc, locale);
    const res = NextResponse.json({ dossiers });
    res.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    return res;
  } catch (e) {
    console.error('[ce-qui-me-concerne/tout]', e);
    return NextResponse.json({ error: 'db_unavailable' }, { status: 503 });
  }
}
