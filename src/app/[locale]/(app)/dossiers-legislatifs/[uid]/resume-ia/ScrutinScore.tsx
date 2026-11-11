'use client';

// Rendu du résultat chiffré d'un scrutin : barre empilée, légende, ligne de méta.
// Partagé par la carte de vote du parcours (DecisionCard) et par le volet de détail
// (ScrutinVotesSheet), qui doivent montrer exactement la même chose du même vote. Le volet
// y prend aussi la barre de chaque groupe (`ScrutinBarGroupe`), dessinée avec les mêmes
// segments.
//
// Quels segments existent et avec quelles valeurs est décidé par `affichageScrutin`,
// partagé avec la carte du fil Actualité : un même vote doit se lire pareil des deux
// côtés du site. Ici on n'habille que ce que ce module a décidé.

import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { affichageScrutin, SCRUTIN_COLORS, type PositionScrutin } from '@/lib/scrutin-affichage';
import type { ScrutinData } from './ResumeIAClient';

// La palette vit dans `scrutin-affichage.ts`, lisible aussi côté serveur (image de partage
// d'un vote, `api/og/scrutin`) ; réexportée ici pour ses appelants historiques.
export { SCRUTIN_COLORS };

/** Clé de traduction du libellé de chaque segment, dans le namespace `resumeIA`. */
const LABEL_KEY: Record<PositionScrutin, string> = {
  pour: 'voteFor',
  contre: 'voteAgainst',
  abstentions: 'voteAbstentions',
  nonVotants: 'voteNonVoting',
  absents: 'voteAbsent',
  nonRecenses: 'voteNotRecorded',
};

/** Teinte pleine d'un segment. Le reste neutre (absents, non recensés) n'en a pas :
 *  il se rend avec une paire clair / sombre, d'où le null. */
const COULEUR: Record<PositionScrutin, string | null> = {
  pour: SCRUTIN_COLORS.pour,
  contre: SCRUTIN_COLORS.contre,
  abstentions: SCRUTIN_COLORS.abstentions,
  nonVotants: SCRUTIN_COLORS.nonVotants,
  absents: null,
  nonRecenses: null,
};

/** La colonne `chambre` du scrutin prime, `chambreKey` sert de secours quand elle est vide. */
function affichage(scrutin: ScrutinData, chambreKey: string | null) {
  return affichageScrutin({
    typeVoteCode: scrutin.typeVoteCode ?? null,
    pour: scrutin.pour,
    contre: scrutin.contre,
    abstentions: scrutin.abstentions,
    nonVotants: scrutin.nonVotants,
    votants: scrutin.votants,
    suffragesRequis: scrutin.suffragesRequis,
    chambre: scrutin.chambre ?? (chambreKey === 'SEN' ? 'Sénat' : null),
  });
}

/** Segments d'une barre empilée, partagés par la barre du scrutin et celle de chaque
 *  groupe : une position garde la même teinte et le même rendu dans les deux. */
function Segments({ segments, total }: { segments: { cle: PositionScrutin; valeur: number }[]; total: number }) {
  return segments.map(({ cle, valeur }) => {
    const largeur = `${(valeur / total) * 100}%`;
    const couleur = COULEUR[cle];
    // Le reste neutre n'a pas de teinte pleine : il suit le thème, d'où les
    // deux div dont une seule est visible à la fois.
    if (couleur === null) {
      return (
        <Fragment key={cle}>
          <div style={{ width: largeur, backgroundColor: '#F0EDEA' }} className="h-full dark:hidden" />
          <div style={{ width: largeur, backgroundColor: '#44403C' }} className="h-full hidden dark:block" />
        </Fragment>
      );
    }
    return (
      <div
        key={cle}
        style={{ width: largeur, backgroundColor: couleur, minWidth: valeur > 0 ? '2px' : '0' }}
        className="h-full"
      />
    );
  });
}

export function ScrutinBar({ scrutin, chambreKey }: { scrutin: ScrutinData; chambreKey: string | null }) {
  const t = useTranslations('resumeIA');
  const { total, segments, majoritePct } = affichage(scrutin, chambreKey);

  return (
    <div
      className="relative h-2 rounded-full overflow-hidden isolate"
      style={{ display: 'flex', backgroundColor: 'var(--color-muted)', flex: 1, minWidth: '120px' }}
    >
      <Segments segments={segments} total={total} />
      {majoritePct > 0 && (
        <div
          className="absolute top-0 h-full w-0.5 bg-foreground/60"
          style={{ left: `${majoritePct}%` }}
          title={t('majorityRequired', { count: scrutin.suffragesRequis })}
        />
      )}
    </div>
  );
}

/** Barre d'un groupe dans la liste du volet : mêmes teintes et même ordre que la barre
 *  du scrutin, plus fine, sans repère de majorité (le seuil vaut pour la chambre, pas
 *  pour un groupe). `aucunVote` est l'effectif moins les votes exprimés : la base ne
 *  sépare pas non-votants et absents par groupe, d'où un seul segment neutre. Sur une
 *  motion de censure, ce reste se nomme « non recensés », comme dans la barre du scrutin.
 *  L'`aria-label` dit en toutes lettres ce que les couleurs montrent.
 *
 *  `echelle` (0 à 1) est l'effectif du groupe rapporté au plus gros groupe de la liste :
 *  la barre occupe cette fraction de sa case, si bien qu'un groupe de 120 élus se voit
 *  plus long qu'un groupe de 17. La case n'a pas de fond : un rail gris sous une barre
 *  courte se confondrait avec le segment neutre « aucun vote ». */
export function ScrutinBarGroupe({ pour, contre, abstentions, aucunVote, estMotion, echelle }: {
  pour: number;
  contre: number;
  abstentions: number;
  aucunVote: number;
  estMotion: boolean;
  echelle: number;
}) {
  const t = useTranslations('resumeIA');
  const segments = ([
    { cle: 'pour', valeur: pour },
    { cle: 'contre', valeur: contre },
    { cle: 'abstentions', valeur: abstentions },
    { cle: estMotion ? 'nonRecenses' : 'absents', valeur: aucunVote },
  ] as { cle: PositionScrutin; valeur: number }[]).filter((s) => s.valeur > 0);
  const total = pour + contre + abstentions + aucunVote;

  return (
    <div
      role="img"
      aria-label={segments.map(({ cle, valeur }) => t(LABEL_KEY[cle] as Parameters<typeof t>[0], { count: valeur })).join(', ')}
      style={{ flex: '1 1 0', minWidth: '40px' }}
    >
      {total > 0 && (
        <div
          className="rounded-full overflow-hidden isolate"
          style={{ display: 'flex', height: '6px', width: `${Math.min(echelle, 1) * 100}%`, minWidth: '2px' }}
        >
          <Segments segments={segments} total={total} />
        </div>
      )}
    </div>
  );
}

export function ScrutinLegende({ scrutin, chambreKey }: { scrutin: ScrutinData; chambreKey: string | null }) {
  const t = useTranslations('resumeIA');
  const { segments } = affichage(scrutin, chambreKey);

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground" style={{ fontSize: '11px' }}>
      {segments.map(({ cle, valeur }) => (
        <span key={cle} className="inline-flex items-center">
          {COULEUR[cle] === null ? (
            <span className="inline-block rounded-full mr-1.5 bg-[#F0EDEA] dark:bg-[#44403C]" style={{ width: '6px', height: '6px' }} />
          ) : (
            <span className="inline-block rounded-full mr-1.5" style={{ width: '6px', height: '6px', backgroundColor: COULEUR[cle] as string }} />
          )}
          {t(LABEL_KEY[cle] as Parameters<typeof t>[0], { count: valeur })}
        </span>
      ))}
    </div>
  );
}

export function ScrutinMeta({ scrutin, chambreKey }: { scrutin: ScrutinData; chambreKey: string | null }) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();
  const { total, participationPct, estMotionCensure } = affichage(scrutin, chambreKey);

  const voteDateLong = scrutin.date
    ? new Date(scrutin.date).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })
    : null;

  return (
    <div className="text-muted-foreground" style={{ fontSize: '11px', opacity: 0.85 }}>
      {scrutin.type && <><span className="capitalize">{scrutin.type}</span> · </>}
      {voteDateLong && <>{voteDateLong}</>}
      {participationPct !== null && <> · {t('participationRate', { percent: participationPct, count: scrutin.votants, total })}</>}
      {scrutin.suffragesRequis > 0 && <> · {t('majorityRequired', { count: scrutin.suffragesRequis })}</>}
      {estMotionCensure && (
        <div style={{ marginTop: '0.35rem' }}>{t('motionCensureNote')}</div>
      )}
    </div>
  );
}
