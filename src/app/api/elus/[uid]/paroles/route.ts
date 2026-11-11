// src/app/api/elus/[uid]/paroles/route.ts
// Le texte des interventions d'un élu sur ses cinq derniers dossiers, pour le tiroir
// « Ses prises de parole » de sa fiche (`EluDrawer`), qui l'appelle à sa première
// ouverture.
//
// Pourquoi une route : le texte alourdirait le HTML et le flux RSC de chaque génération
// ISR de la fiche pour les seuls lecteurs qui ouvrent le tiroir. Mesuré sur la base le
// 2026-11-05 : 18 Ko compressés pour un élu ordinaire, 203 Ko pour le plus bavard.
//
// Le client envoie ses dossiers (`?dossiers=a,b`) et, pour un élu en exercice, la date
// d'où partent ses prises de parole (`?depuis=AAAA-MM-JJ`, `debutParoles` de la fiche :
// borne de sa chambre, ou début de mandat après un changement de chambre, D-239).
// La route ne refait pas le choix des cinq dossiers : la fiche et le tiroir ne peuvent
// donc pas diverger sur ce choix, même quand l'une date d'avant la nuit d'import et pas
// l'autre.
//
// Les lignes retenues sont celles de `page.tsx`, par le même `filtreParolesElu`.
//
// Pas de `lecteurDeTextes` : son contrôle d'empreinte sert aux appelants qui lisent les
// lignes et le texte en deux requêtes. Ici, tout vient de la même requête, donc un
// texte ne peut pas se retrouver sur la ligne d'une autre version de la séance.
//
// Route dynamique qui déclare 24 h de cache au CDN (`s-maxage`), comme
// `/api/dossiers/[uid]/elus-actifs`. Sans effet au 2026-11-05 : Cloudflare n'a pas encore
// de règle de cache (BACKLOG, `[INFRA]`), donc chaque ouverture du tiroir lit la base.

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { filtreParolesElu } from '@/lib/debats-texte';
import { estUidDossier, estUidElu } from '@/lib/uid-fiches';
import type { ParoleTexte } from '@/app/[locale]/(app)/les-elus/[uid]/EluRows';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Le nombre de dossiers de la fiche (`cinqDerniersDossiers`) : borne le coût d'un appel forgé. */
const DOSSIERS_MAX = 5;

const DATE_NUE = /^[12]\d{3}-\d{2}-\d{2}$/;

/**
 * Une date nue qui existe : refuser le reste avant la base, où un cast raté lèverait en
 * 503. `Date.parse` seul ne suffit pas, il reporte le 31 février au 3 mars sans erreur.
 */
function estDateNue(x: string): boolean {
  if (!DATE_NUE.test(x)) return false;
  const instant = Date.parse(x);
  return !Number.isNaN(instant) && new Date(instant).toISOString().startsWith(x);
}

export async function GET(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  const { searchParams } = new URL(request.url);
  const dossiers = (searchParams.get('dossiers') ?? '').split(',').filter(Boolean);
  const depuis = searchParams.get('depuis');
  if (
    !estUidElu(uid)
    || dossiers.length === 0
    || dossiers.length > DOSSIERS_MAX
    || !dossiers.every(estUidDossier)
    || (depuis !== null && !estDateNue(depuis))
  ) {
    return NextResponse.json({ error: 'invalidBody' }, { status: 400 });
  }
  try {
    const interventions = await sql<ParoleTexte[]>`
      select i.id, i.dossier_uid, i.seance_uid, s.date_seance, i.article, i.amendement, i.texte
      from debat_interventions i
      join debat_seances s on s.uid = i.seance_uid
      where i.acteur_uid = ${uid}
        and ${filtreParolesElu()}
        and i.dossier_uid = any(${dossiers})
        ${depuis
          // Une séance sans date reste, comme dans le fil (`dansParoles` de `page.tsx`) :
          // sans ce `is null`, la comparaison à NULL l'écartait du seul tiroir.
          ? sql`and (s.date_seance is null or s.date_seance >= ${depuis})`
          : sql``}
      order by s.date_seance desc, i.ordre desc, i.id desc`;
    const res = NextResponse.json({ interventions });
    res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=86400');
    return res;
  } catch (e) {
    // Sans en-tête de cache : une erreur ne doit pas rester 24 h au CDN.
    console.error('[elus/paroles]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'serverError' }, { status: 503 });
  }
}
