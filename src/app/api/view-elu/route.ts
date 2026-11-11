// Compte une vue de la fiche d'un élu (`acteurs.view_count_month`), qui fait
// « Les plus consultés » de la liste des élus et la newsletter. Appelée une fois
// par session et par fiche par `EluProfileClient`. Une vue ne compte qu'une fois
// par IP, fiche et jour, et seulement depuis une page du site (voir
// `refuserVueEtrangere` et `premiereVueDuJour`).

import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { viewRateLimit, getClientIp, premiereVueDuJour, redis, refuserVueEtrangere } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const refus = refuserVueEtrangere(request);
  if (refus) return refus;

  const { success } = await viewRateLimit.limit(getClientIp(request));
  if (!success) return NextResponse.json({ error: 'rate_limit' }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const uid = (body as Record<string, unknown>)?.uid;
  if (typeof uid !== 'string' || uid.trim() === '' || uid.length > 100) {
    return NextResponse.json({ error: 'invalid_uid' }, { status: 400 });
  }

  // Déjà comptée aujourd'hui : même réponse qu'une vue comptée, rien à apprendre
  // à qui rejoue la requête.
  const cleVue = await premiereVueDuJour(request, 'elu', uid.trim());
  if (!cleVue) return NextResponse.json({ ok: true });

  try {
    await sql`select increment_view_count_month_acteur(acteur_uid => ${uid.trim()})`;
  } catch (error) {
    console.error('[view-elu]', (error as Error).message);
    // Vue non comptée : elle doit pouvoir l'être à la prochaine visite du jour.
    await redis.del(cleVue);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
