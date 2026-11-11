// Image de partage (Open Graph) d'un amendement adopté par scrutin public,
// `/api/og/amendement?uid=…&locale=…`, pointée par les métadonnées de sa page
// (`Amendements/[uid]/page.tsx`) quand un vote détaillé l'a tranché. La même image que celle
// d'un vote (`lib/og-vote.tsx`, exception à D-302 comme `api/og/scrutin`) : le numéro de
// l'amendement, la date du vote, « Adopté », les nombres et l'hémicycle.
//
// Un amendement adopté à main levée ou en commission n'a pas de chiffres : sa page garde
// l'image commune, et cette route la rend aussi pour lui si on l'appelle quand même.
// `uid` et `locale` viennent d'une URL publique : l'uid est validé (`estUidAmendement`) et
// aucun texte de l'URL n'entre dans l'image.

import type { NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { estUidAmendement } from '@/lib/uid-fiches';
import { lireAmendement } from '@/lib/amendement-page';
import { chargerVoteAmendement } from '@/lib/scrutin-votes';
import { SCRUTIN_COLORS } from '@/lib/scrutin-affichage';
import { dateDuVote } from '@/lib/vote-page';
import { CACHE_OG_PANNE, imageCommune, imageVote } from '@/lib/og-vote';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const locale = params.get('locale') === 'en' ? 'en' : 'fr';
  const uid = (params.get('uid') ?? '').trim();
  if (!estUidAmendement(uid)) return imageCommune(locale);

  // Une panne de base ne doit pas priver le lien de tout aperçu : image commune, cache court.
  let donnees;
  try {
    donnees = await Promise.all([lireAmendement(uid), chargerVoteAmendement(uid)]);
  } catch (e) {
    console.error('[og/amendement]', e instanceof Error ? e.message : e);
    return imageCommune(locale, CACHE_OG_PANNE);
  }
  const [a, v] = donnees;
  if (!a || !v) return imageCommune(locale);

  const [t, tResume] = await Promise.all([
    getTranslations({ locale, namespace: 'amendementPage' }),
    getTranslations({ locale, namespace: 'resumeIA' }),
  ]);

  // La page n'existe que pour un amendement adopté : le statut est toujours « Adopté ».
  return imageVote({
    locale,
    surtitre: t('nom', { numero: a.numero }),
    date: v.date_scrutin ? dateDuVote(locale, v.date_scrutin) : null,
    statut: tResume('adopted'),
    couleurStatut: SCRUTIN_COLORS.pour,
    chiffres: {
      typeVoteCode: null,
      pour: v.pour,
      contre: v.contre,
      abstentions: v.abstentions,
      nonVotants: v.non_votants,
      votants: v.votants,
      suffragesRequis: v.suffrages_requis,
      chambre: v.chambre === 'SN' ? 'Sénat' : null,
    },
    votes: v.votes,
    chambre: v.chambre === 'SN' ? 'SEN' : 'AN',
  });
}
