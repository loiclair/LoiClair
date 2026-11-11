'use client';

// Les pièces du résultat d'un vote :
// - `BadgeStatut`, le statut en pastille, dans l'en-tête de la page et du tiroir, et en
//   tête de la carte des chiffres ;
// - `CarteChiffres`, montée par `SectionsVote` dans la section « Le résultat » (page et
//   tiroir) : le statut et ce que le vote décidait, les votants, les suffrages exprimés et
//   la majorité requise en colonne, puis pour, contre, abstentions et « n'ont pas pris part
//   au vote » (le libellé du Sénat) en grand, et pour finir la participation et la barre.
//
// Les segments, la participation et le repère de majorité viennent d'`affichageScrutin`,
// comme la barre partout ailleurs : une motion de censure n'y a que ses voix favorables.
//
// Composants clients parce qu'ils montent `ScrutinBar`, export d'un module client ; aucun
// état, la page les rend côté serveur.

import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { affichageScrutin } from '@/lib/scrutin-affichage';
import { getStatusBadgeClass } from '@/lib/status-mapping';
import { LEGAL_AN, LEGAL_SN } from '@/lib/parliament-constants';
import { ScrutinBar, SCRUTIN_COLORS } from '../../dossiers-legislatifs/[uid]/resume-ia/ScrutinScore';
import type { ScrutinData } from '../../dossiers-legislatifs/[uid]/resume-ia/ResumeIAClient';

/** Chiffres du scrutin pour `affichageScrutin`. La colonne `chambre` prime, `chambreKey`
 *  sert de secours quand elle est vide, comme dans `ScrutinScore`. */
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

/** Le statut (« Adopté », « Rejeté ») en pastille, aux couleurs de celle du tiroir.
 *  `statut` est la valeur brute qui choisit la couleur, `statutLabel` sa traduction. */
export function BadgeStatut({ statut, statutLabel }: { statut: string | null; statutLabel: string | null }) {
  if (!statutLabel) return null;
  return (
    <span className={`inline-block shrink-0 px-2 py-0.5 rounded-full font-semibold border ${getStatusBadgeClass(statut)}`} style={{ fontSize: '11px' }}>
      {statutLabel}
    </span>
  );
}

/** Un nombre en grand, son libellé dessous et, au besoin, une précision qui le prolonge sur la même ligne. */
function Grand({ valeur, libelle, couleur, compact, precision }: { valeur: string; libelle: string; couleur: string; compact: boolean; precision?: string }) {
  return (
    <div className="flex flex-col" style={{ minWidth: 0 }}>
      <span style={{ fontSize: compact ? '1.625rem' : 'clamp(1.75rem, 7vw, 2.5rem)', lineHeight: 1.05, fontWeight: 700, color: couleur, fontVariantNumeric: 'tabular-nums' }}>
        {valeur}
      </span>
      <span className="text-muted-foreground" style={{ fontSize: compact ? '12px' : '13px', lineHeight: 1.35 }}>{precision ? `${libelle}, ${precision}` : libelle}</span>
    </div>
  );
}

/** Le statut, puis ce qui décide du résultat, en grand et alignés en colonne pour se
 *  comparer d'un coup d'œil aux chiffres du vote : votants, suffrages exprimés, majorité
 *  requise. Un séparateur, puis les quatre nombres du vote.
 *
 *  Sur une motion de censure, seules les voix favorables sont recensées : la colonne dit
 *  les voix pour la motion et celles qu'il fallait, et il n'y a ni suffrages exprimés ni
 *  autre nombre à montrer sous le séparateur. */
export function CarteChiffres({ scrutin, chambreKey, statut, statutLabel, sens, compact = false }: {
  scrutin: ScrutinData;
  chambreKey: string | null;
  statut: string | null;
  statutLabel: string | null;
  /** Ce que le vote décidait, en une phrase (`sensDuVote` de la page), ou `null`. */
  sens: string | null;
  /** Dans le tiroir, plus étroit : nombres et libellés plus petits. */
  compact?: boolean;
}) {
  const t = useTranslations('scrutinVotes');
  const locale = useLocale();
  const nombre = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR');
  const { segments, estMotionCensure } = affichage(scrutin, chambreKey);
  const valeur = (cle: string) => segments.find((x) => x.cle === cle)?.valeur ?? 0;
  const senat = chambreKey === 'SEN' || scrutin.chambre === 'Sénat';
  const total = senat ? LEGAL_SN : LEGAL_AN;
  const chambre = senat ? 'sen' : 'an';

  const colonne: { valeur: number; libelle: string }[] = estMotionCensure
    ? [
      { valeur: scrutin.pour, libelle: t('hemicycleMotion', { total, chambre }) },
      ...(scrutin.suffragesRequis > 0 ? [{ valeur: scrutin.suffragesRequis, libelle: t('grandMotionRequis') }] : []),
    ]
    : [
      { valeur: scrutin.votants, libelle: t('hemicycleVotants', { count: scrutin.votants, total, chambre }) },
      { valeur: scrutin.pour + scrutin.contre, libelle: t('ligneExprimes', { count: scrutin.pour + scrutin.contre }) },
      ...(scrutin.suffragesRequis > 0 ? [{ valeur: scrutin.suffragesRequis, libelle: t('ligneMajorite') }] : []),
    ];

  return (
    <div className="flex flex-col" style={{ gap: '18px' }}>
      <div className="flex flex-col" style={{ gap: '8px' }}>
        <div><BadgeStatut statut={statut} statutLabel={statutLabel} /></div>
        {sens && <p className="m-0" style={{ fontSize: compact ? '13px' : '14px', lineHeight: 1.5 }}>{sens}</p>}
      </div>
      {/* Deux colonnes : les nombres, calés à droite pour que les chiffres s'alignent,
          puis leur libellé. */}
      <div className="grid items-baseline" style={{ gridTemplateColumns: 'max-content 1fr', columnGap: '10px', rowGap: '4px' }}>
        {colonne.map((l) => (
          <Fragment key={l.libelle}>
            <span style={{ color: 'var(--foreground)', fontSize: compact ? '1.625rem' : 'clamp(1.75rem, 7vw, 2.5rem)', lineHeight: 1.15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>
              {nombre.format(l.valeur)}
            </span>
            <span className="text-muted-foreground" style={{ fontSize: compact ? '12px' : '13px', lineHeight: 1.35 }}>{l.libelle}</span>
          </Fragment>
        ))}
      </div>
      {!estMotionCensure && (
        <>
          <div aria-hidden style={{ height: '1px', backgroundColor: 'var(--border)' }} />
          {/* Deux sur deux sur téléphone : à quatre colonnes, « n'ont pas pris part au
              vote » tenait sur trois lignes à 390 px. */}
          <div className="grid grid-cols-2 sm:grid-cols-4" style={{ gap: '16px 12px' }}>
            <Grand valeur={nombre.format(scrutin.pour)} libelle={t('grandPour')} couleur={SCRUTIN_COLORS.pour} compact={compact} />
            <Grand valeur={nombre.format(scrutin.contre)} libelle={t('grandContre')} couleur={SCRUTIN_COLORS.contre} compact={compact} />
            <Grand valeur={nombre.format(scrutin.abstentions)} libelle={t('grandAbstentions', { count: scrutin.abstentions })} couleur={SCRUTIN_COLORS.abstentions} compact={compact} />
            {/* Tous ceux qui n'ont pas voté, comme le compte le Sénat. Ceux qui ne pouvaient
                pas voter (Assemblée seulement) sont précisés ici, sous le nombre qui les
                contient : ils ont une teinte à eux dans l'hémicycle et la barre. */}
            <Grand
              valeur={nombre.format(valeur('nonVotants') + valeur('absents'))}
              libelle={t('grandSansVote')}
              couleur="var(--muted-foreground)"
              compact={compact}
              precision={valeur('nonVotants') > 0 ? t('grandDontNonVotants', { count: valeur('nonVotants') }) : undefined}
            />
          </div>
        </>
      )}
      <div aria-hidden style={{ height: '1px', backgroundColor: 'var(--border)' }} />
      <Participation scrutin={scrutin} chambreKey={chambreKey} compact={compact} />
    </div>
  );
}

/** Les chiffres de participation en lignes courtes, puis la barre du vote dans la forme
 *  du tiroir (barre et repère de majorité, décompte), en pied de `CarteChiffres`. Le
 *  statut n'y est pas répété : il ouvre la carte. */
function Participation({ scrutin, chambreKey, compact }: { scrutin: ScrutinData; chambreKey: string | null; compact: boolean }) {
  const tR = useTranslations('resumeIA');
  const { total, participationPct, estMotionCensure } = affichage(scrutin, chambreKey);

  // Le type de scrutin garde la casse de la source, sauf la première lettre.
  const type = scrutin.type ? scrutin.type.charAt(0).toUpperCase() + scrutin.type.slice(1) : null;
  const lignes: string[][] = estMotionCensure
    ? [[type, tR('motionCensureNote')].filter((x): x is string => !!x)]
    : [
      [type, participationPct !== null ? tR('participationRate', { percent: participationPct, count: scrutin.votants, total }) : null]
        .filter((x): x is string => !!x),
    ];

  return (
    <div className="flex flex-col" style={{ gap: '16px' }}>
      <div className="flex flex-col text-muted-foreground" style={{ fontSize: compact ? '12px' : '13px', lineHeight: 1.5, gap: '2px' }}>
        {lignes.filter((l) => l.length > 0).map((l, i) => <p key={i} className="m-0">{l.join(' · ')}</p>)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ScrutinBar scrutin={scrutin} chambreKey={chambreKey} />
        <span className="text-muted-foreground tabular-nums shrink-0 font-medium whitespace-nowrap" style={{ fontSize: '12px' }}>
          {estMotionCensure ? scrutin.pour : `${scrutin.pour}–${scrutin.contre}–${scrutin.abstentions}`}
        </span>
      </div>
    </div>
  );
}
