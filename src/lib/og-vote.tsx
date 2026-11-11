// Image de partage (Open Graph) d'un vote, commune à la page d'un scrutin
// (`api/og/scrutin`) et à celle d'un amendement adopté par scrutin public
// (`api/og/amendement`) : les deux pages montrent le même vote, leurs images ne doivent
// pas pouvoir diverger.
//
// À gauche : la case Lc et le nom du site, une ligne qui nomme le vote (étape ou numéro
// d'amendement) et sa date, le statut en grand et à sa couleur, puis les nombres du vote.
// À droite : l'hémicycle, sur le même plan et dans le même ordre que sur la page
// (`lib/hemicycle.ts`).
// Satori n'est pas un navigateur : flexbox partout, couleurs en dur (pas de variables CSS).

import { ImageResponse } from 'next/og';
import { getTranslations } from 'next-intl/server';
import { ECHELLE_HEMICYCLE, pointsHemicycle } from '@/lib/hemicycle';
import { affichageScrutin, SCRUTIN_COLORS, type ChiffresScrutin } from '@/lib/scrutin-affichage';
import type { ScrutinVotesResponse } from '@/lib/scrutin-votes';
import { CaseLcNomCoin, OG_TAILLE, imageGenerique } from '@/lib/og-image';
import { polices } from '@/lib/og-polices';

// Un jour au CDN, comme l'image commune : un vote ne change plus une fois publié, et sans
// cet en-tête chaque robot d'aperçu recalculerait l'image et relirait la base.
export const CACHE_OG_VOTE = 'public, s-maxage=86400, stale-while-revalidate=604800';
// Pendant une panne de base, l'image commune quelques minutes seulement : gardée un jour,
// elle remplacerait l'image du vote bien après le retour de la base.
export const CACHE_OG_PANNE = 'public, s-maxage=300';

const FOND = '#F7F5F2';
const TEXTE = '#1C1917';
const DOUX = '#78716C';
// Le reste neutre des points (absents, non recensés), plus marqué que sur le site : sur
// une vignette réduite, le gris pâle de la page disparaît dans le fond.
const NEUTRE = '#D6D3D1';

function couleurPoint(position: string | null): string {
  if (position === 'pour') return SCRUTIN_COLORS.pour;
  if (position === 'contre') return SCRUTIN_COLORS.contre;
  if (position === 'abstentions') return SCRUTIN_COLORS.abstentions;
  if (position === 'nonVotants') return SCRUTIN_COLORS.nonVotants;
  return NEUTRE;
}

/** L'image commune du site, servie quand un vote n'a pas d'image à lui (uid invalide ou
 *  inconnu, pas de vote public, panne). `cache` raccourcit sa durée pendant une panne. */
export async function imageCommune(locale: 'fr' | 'en', cache = CACHE_OG_VOTE): Promise<ImageResponse> {
  const [tOg, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: 'og' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  return new ImageResponse(
    imageGenerique({ tagline: tCommon('tagline').split(/(?<=\.)\s+/), offre: [tOg('offre1'), tOg('offre2'), tOg('offre3')] }),
    { ...OG_TAILLE, fonts: await polices(), headers: { 'Cache-Control': cache } },
  );
}

/**
 * L'image d'un vote, prête à servir. `surtitre` nomme le vote, `statut` est déjà traduit
 * (ou `null`), `chiffres.chambre` vaut « Sénat » pour le Sénat (effectif de la chambre dans
 * `affichageScrutin`), `chambre` choisit le plan de l'hémicycle.
 */
export async function imageVote({
  locale, surtitre, date, statut, couleurStatut, chiffres, votes, chambre,
}: {
  locale: 'fr' | 'en';
  surtitre: string;
  date: string | null;
  statut: string | null;
  couleurStatut: string;
  chiffres: ChiffresScrutin;
  votes: ScrutinVotesResponse;
  chambre: 'AN' | 'SEN';
}): Promise<ImageResponse> {
  const t = await getTranslations({ locale, namespace: 'scrutinVotes' });
  const { pour, contre, abstentions } = chiffres;
  const { segments, estMotionCensure } = affichageScrutin(chiffres);
  const valeur = (cle: string) => segments.find((x) => x.cle === cle)?.valeur ?? 0;
  const nombre = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR');
  // Sur une motion de censure, seules les voix favorables sont recensées : deux nombres.
  const nombres: { valeur: number; libelle: string; couleur: string }[] = estMotionCensure
    ? [
      { valeur: pour, libelle: t('grandMotionPour'), couleur: SCRUTIN_COLORS.pour },
      { valeur: chiffres.suffragesRequis, libelle: t('grandMotionRequis'), couleur: TEXTE },
    ]
    : [
      { valeur: pour, libelle: t('grandPour'), couleur: SCRUTIN_COLORS.pour },
      { valeur: contre, libelle: t('grandContre'), couleur: SCRUTIN_COLORS.contre },
      { valeur: abstentions, libelle: t('grandAbstentions', { count: abstentions }), couleur: '#8A827C' },
      { valeur: valeur('nonVotants') + valeur('absents'), libelle: t('grandSansVote'), couleur: DOUX },
    ];

  const hemicycle = pointsHemicycle(votes, chambre);
  const marge = ECHELLE_HEMICYCLE * 0.03;
  const viewBox = `${-ECHELLE_HEMICYCLE - marge} ${-ECHELLE_HEMICYCLE - marge} ${2 * (ECHELLE_HEMICYCLE + marge)} ${ECHELLE_HEMICYCLE + 2 * marge}`;

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', backgroundColor: FOND, fontFamily: 'IBM Plex Sans', position: 'relative' }}>
        <CaseLcNomCoin />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', width: 520, paddingLeft: 56, paddingTop: 70 }}>
          <span style={{ fontSize: 26, color: DOUX, fontWeight: 600 }}>{surtitre}</span>
          {date && <span style={{ fontSize: 24, color: DOUX, marginTop: 4 }}>{date}</span>}
          {statut && (
            <span style={{ fontSize: 76, fontWeight: 800, color: couleurStatut, marginTop: 18, lineHeight: 1 }}>{statut}</span>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 34, width: 460 }}>
            {nombres.map((n) => (
              <div key={n.libelle} style={{ display: 'flex', flexDirection: 'column', width: 230, marginBottom: 22 }}>
                <span style={{ fontSize: 52, fontWeight: 700, color: n.couleur, lineHeight: 1 }}>{nombre.format(n.valeur)}</span>
                <span style={{ fontSize: 22, color: DOUX, marginTop: 4 }}>{n.libelle}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 680, paddingRight: 40 }}>
          <svg width={640} height={(640 * (ECHELLE_HEMICYCLE + 2 * marge)) / (2 * (ECHELLE_HEMICYCLE + marge))} viewBox={viewBox}>
            {hemicycle.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={hemicycle.rayon * 1.1} fill={couleurPoint(p.position)} />
            ))}
          </svg>
        </div>
      </div>
    ),
    { ...OG_TAILLE, fonts: await polices(), headers: { 'Cache-Control': CACHE_OG_VOTE } },
  );
}
