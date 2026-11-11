// Image de partage (Open Graph) d'un vote, `/api/og/scrutin?uid=…&locale=…`, pointée par
// les métadonnées de sa page (`Scrutins/[uid]/page.tsx`). Exception à l'image commune du
// site (D-302), comme celle d'un amendement adopté par scrutin public (`api/og/amendement`) :
// l'hémicycle et le résultat s'y lisent sans titre, que les réseaux affichent déjà sous
// l'image. Le titre officiel, trop long pour 1200 × 630, est ce qui avait fait retirer les
// images par page.
//
// La mise en page vit dans `lib/og-vote.tsx`, partagée avec l'image d'un amendement. Ici :
// l'étape et la date du vote, son statut et sa couleur.
//
// `uid` et `locale` viennent d'une URL publique : l'uid est validé (`estUidScrutin`) et
// aucun texte de l'URL n'entre dans l'image. Un uid inconnu rend l'image commune du site.

import type { NextRequest } from 'next/server';
import { getTranslations } from 'next-intl/server';
import { estUidScrutin } from '@/lib/uid-fiches';
import { chargerVotesScrutin } from '@/lib/scrutin-votes';
import { SCRUTIN_COLORS } from '@/lib/scrutin-affichage';
import { contexteDuVote, dateDuVote, lireActe, lireScrutin, nomEtape } from '@/lib/vote-page';
import { CACHE_OG_PANNE, imageCommune, imageVote } from '@/lib/og-vote';

export const dynamic = 'force-dynamic';

const TEXTE = '#1C1917';

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const locale = params.get('locale') === 'en' ? 'en' : 'fr';
  const uid = (params.get('uid') ?? '').trim();
  if (!estUidScrutin(uid)) return imageCommune(locale);

  // Une panne de base ne doit pas priver le lien de tout aperçu : image commune, cache court.
  let donnees;
  try {
    donnees = await Promise.all([lireScrutin(uid), lireActe(uid), chargerVotesScrutin(uid)]);
  } catch (e) {
    console.error('[og/scrutin]', e instanceof Error ? e.message : e);
    return imageCommune(locale, CACHE_OG_PANNE);
  }
  const [s, { decision }, votes] = donnees;
  if (!s || !votes) return imageCommune(locale);

  const [tResume, tSteps] = await Promise.all([
    getTranslations({ locale, namespace: 'resumeIA' }),
    getTranslations({ locale, namespace: 'steps' }),
  ]);

  // La chambre, le statut et l'étape : les règles de la page du vote (`vote-page.ts`).
  const { chambreKey, statut, milestone } = contexteDuVote(uid, s, decision);
  const etape = nomEtape(milestone, chambreKey, (k) => tSteps(k as Parameters<typeof tSteps>[0]), (k) => tResume(k as Parameters<typeof tResume>[0]))
    ?? (chambreKey === 'SEN' ? tResume('decisionLabelVoteSenat') : tResume('decisionLabelVoteAN'));
  const statutLabel = statut === 'Adopté' ? tResume('adopted') : statut === 'Rejeté' ? tResume('rejected') : statut;

  return imageVote({
    locale,
    surtitre: etape,
    date: s.date_scrutin ? dateDuVote(locale, s.date_scrutin) : null,
    statut: statutLabel,
    couleurStatut: statut === 'Adopté' ? SCRUTIN_COLORS.pour : statut === 'Rejeté' ? SCRUTIN_COLORS.contre : TEXTE,
    chiffres: {
      typeVoteCode: s.type_vote_code,
      pour: s.synthese_pour ?? 0,
      contre: s.synthese_contre ?? 0,
      abstentions: s.synthese_abstentions ?? 0,
      nonVotants: s.synthese_non_votants ?? 0,
      votants: s.synthese_nombre_votants ?? 0,
      suffragesRequis: s.synthese_suffrages_requis ?? 0,
      chambre: s.chambre ?? (chambreKey === 'SEN' ? 'Sénat' : null),
    },
    votes,
    chambre: uid.startsWith('VTSN') ? 'SEN' : 'AN',
  });
}
