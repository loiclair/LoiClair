// src/app/api/dossiers/[uid]/elus-actifs/route.ts
// Tous les élus de la section « Les plus actifs dans ce dossier », chambre par
// chambre, triés par score, pour le panneau « Voir les N » de la fiche dossier
// (`ElusActifsSection`), qui l'appelle à sa première ouverture.
//
// Pourquoi une route : la fiche n'envoie plus que sa carte (cinq élus par chambre).
// La liste entière pesait 217 Ko sur la loi de finances 2026, recopiés dans le HTML et
// le flux RSC de chaque génération ISR de la fiche, alors que seuls les lecteurs qui
// ouvrent le panneau la lisent. Le badge « Rapporteur » n'y est pas posé
// (`rapporteur` vaut false) : le panneau le pose d'après les rapporteurs que la fiche
// connaît déjà, sans que la route ait à relire tous les textes du dossier.
//
// Route dynamique qui déclare 24 h de cache au CDN (`s-maxage`), comme
// `/api/dossiers/[uid]/amendements`. Sans effet au 2026-11-05 : Cloudflare n'a pas encore
// de règle de cache (BACKLOG, `[INFRA]`), donc chaque appel lit la base.

import { NextResponse } from 'next/server';
import { elusActifs } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/elus-actifs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Les uid de dossier suivent DLR…, DSNRAP… ou DSNRES… (relevé en base le 2026-10-27).
// Valider la forme écarte avant la base ce qui ne peut pas être un dossier.
const DOSSIER_UID = /^D(LR|SN)[A-Z0-9]{1,40}$/;

export async function GET(_request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!DOSSIER_UID.test(uid)) {
    return NextResponse.json({ error: 'invalidBody' }, { status: 400 });
  }
  try {
    const res = NextResponse.json({ chambres: await elusActifs(uid) });
    res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
    return res;
  } catch (e) {
    // Sans en-tête de cache : une erreur ne doit pas rester 24 h au CDN.
    console.error('[dossiers/elus-actifs]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'serverError' }, { status: 503 });
  }
}
