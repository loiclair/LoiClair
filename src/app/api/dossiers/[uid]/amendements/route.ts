// src/app/api/dossiers/[uid]/amendements/route.ts
// Tous les amendements adoptés d'un dossier, regroupés par auteur, pour le panneau
// « Amendements adoptés par auteur » de la fiche dossier (`ModificationsSection`),
// qui l'appelle à sa première ouverture.
//
// Pourquoi une route : la fiche n'envoie plus que sa carte (dix auteurs, dix
// amendements chacun). La liste entière pesait 845 Ko sur la loi de finances 2026,
// recopiés dans le HTML et le flux RSC de chaque génération ISR de la fiche, alors que
// seuls les lecteurs qui ouvrent le panneau la lisent.
//
// Route dynamique qui déclare 24 h de cache au CDN (`s-maxage`), comme
// `/api/ce-qui-me-concerne/element`. Sans effet au 2026-11-05 : Cloudflare n'a pas encore
// de règle de cache (BACKLOG, `[INFRA]`), donc chaque appel lit la base. La fiche ne se
// régénère qu'au bout de 24 h : la carte peut donc retarder sur le panneau d'autant.

import { NextResponse } from 'next/server';
import { amendementsAdoptes } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/amendements-adoptes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Les uid de dossier suivent DLR…, DSNRAP… ou DSNRES… (relevé en base le 2026-10-27).
// Valider la forme écarte avant la base ce qui ne peut pas être un dossier.
const DOSSIER_UID = /^D(LR|SN)[A-Z0-9]{1,40}$/;

export async function GET(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  if (!DOSSIER_UID.test(uid)) {
    return NextResponse.json({ error: 'invalidBody' }, { status: 400 });
  }
  // La route ne lit aucun paramètre, mais le CDN en fait une clé de cache : chaque
  // `?x=1`, `?x=2`… relisait la liste en base (845 Ko pour la loi de finances).
  // Toute adresse avec paramètres renvoie donc vers l'adresse nue, sans lecture, et
  // le CDN garde la redirection comme la réponse : la rejouer ne coûte plus d'appel.
  // `Location` reste relatif, donc pas de `NextResponse.redirect`, qui exige une adresse
  // absolue : sur le VPS, `request.url` porte l'adresse interne du conteneur
  // (`0.0.0.0:3000`), et le lecteur serait renvoyé vers elle.
  const adresse = new URL(request.url);
  if (adresse.search) {
    return new NextResponse(null, {
      status: 308,
      headers: {
        Location: adresse.pathname,
        'Cache-Control': 'public, max-age=0, s-maxage=86400',
      },
    });
  }
  try {
    const res = NextResponse.json({ auteurs: await amendementsAdoptes(uid, true) });
    res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
    return res;
  } catch (e) {
    // Sans en-tête de cache : une erreur ne doit pas rester 24 h au CDN.
    console.error('[dossiers/amendements]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'serverError' }, { status: 503 });
  }
}
