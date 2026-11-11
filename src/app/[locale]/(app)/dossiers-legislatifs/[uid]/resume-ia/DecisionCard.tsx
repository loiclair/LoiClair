"use client";

// Cartes de décision du parcours d'un dossier (vote d'une chambre, CMP, Conseil
// constitutionnel), rendues par Timeline sous l'étape à laquelle la décision se rattache.

import type { ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { getStatusBadgeClass } from '@/lib/status-mapping';
import { statutCC } from '@/lib/statut';
import ScrutinVotesSheet from './ScrutinVotesSheet';
import { AIBadgeTitre } from './AICardElements';
import { ScrutinBar, ScrutinLegende, ScrutinMeta } from './ScrutinScore';
import type { DecisionData } from './ResumeIAClient';
import { formateurDate } from '@/lib/jour-paris';

/** Lien vers un texte publié par la chambre, ouvert dans un nouvel onglet : le texte
 *  issu d'un vote sur une carte de décision, le rapport d'un dossier de contrôle dans le
 *  parcours. Un seul composant pour que les deux sorties se ressemblent. `title` porte
 *  le titre du texte, le libellé visible disant seulement ce qu'on va lire. */
export function LienTexteSortant({ href, title, children }: { href: string; title: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className="inline-flex items-center gap-1 text-primary hover:underline"
      style={{ fontSize: '11px', fontWeight: 500, padding: '2px 0' }}
    >
      {children}
      <ExternalLink style={{ width: '11px', height: '11px' }} />
    </a>
  );
}

/** Jour et mois courts d'une décision à l'heure de Paris, pour les deux cartes ci-dessous. */
function jourMoisCourt(date: string, locale: string): string {
  return formateurDate(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }).format(new Date(date));
}

function DecisionRow({ decision, rowLabel, etapeLabel }: { decision: DecisionData; rowLabel?: string | null; etapeLabel?: string | null }) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();

  const statut = decision.statutConclusion;
  const badgeLabel = statut
    ? (statut === 'Adopté' ? t('adopted') : statut === 'Rejeté' ? t('rejected') : statut)
    : null;

  const s = decision.scrutin;

  const rowDateShort = decision.date ? jourMoisCourt(decision.date, locale) : null;

  const badge = badgeLabel ? (
    <span className={`inline-block shrink-0 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusBadgeClass(statut)}`}>
      {badgeLabel}
    </span>
  ) : null;

  return (
    <div className="flex flex-col gap-2">
      {/* Titre de rangée (composite) ou titre de scrutin (simple) */}
      {rowLabel ? (
        <p className="text-muted-foreground m-0" style={{ fontSize: '11px', lineHeight: 1.4 }}>
          <span className="text-foreground font-medium">{rowLabel}</span>
          {rowDateShort && <> · {rowDateShort}</>}
        </p>
      ) : decision.scrutinTitre ? (
        <p className="text-foreground m-0" style={{ fontSize: '12px', lineHeight: 1.4 }}>
          {decision.scrutinTitre}
          {decision.scrutinTitreTraduit && <span style={{ marginLeft: '6px', verticalAlign: '1px' }}><AIBadgeTitre /></span>}
        </p>
      ) : null}

      {/* Badge + barre + score compact (même ligne) */}
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        {s && (
          <>
            <ScrutinBar scrutin={s} chambreKey={decision.chambreKey} />
            {/* Score compact « pour–contre–abstentions ». Sur une motion de censure il
                se réduirait à « 132–0–0 » : la Constitution ne fait recenser que les
                votes favorables, les deux zéros ne mesurent rien. */}
            <span className="text-muted-foreground tabular-nums shrink-0 font-medium whitespace-nowrap" style={{ fontSize: '11px' }}>
              {s.typeVoteCode === 'MOC' ? s.pour : `${s.pour}–${s.contre}–${s.abstentions}`}
            </span>
          </>
        )}
      </div>

      {/* Sans détail des voix, une phrase dit ce qui s'est passé, à la place de la barre. */}
      {!s && decision.sansDetail && (
        <p className="text-muted-foreground m-0" style={{ fontSize: '12px', lineHeight: 1.5 }}>
          {decision.sansDetail === '49-3' ? t('sansDetail493')
            : decision.sansDetail === '151-7' ? t('sansDetail1517')
              : t('sansDetailInconnu')}
        </p>
      )}

      {s && (
        <>
          <ScrutinLegende scrutin={s} chambreKey={decision.chambreKey} />
          <ScrutinMeta scrutin={s} chambreKey={decision.chambreKey} />
        </>
      )}

      {/* Sorties de la carte : le détail nominatif du vote, et le texte qui en est issu */}
      {(s || decision.texteVote) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {s && (
            <ScrutinVotesSheet
              scrutin={s}
              chambreKey={decision.chambreKey}
              titre={decision.scrutinTitre}
              titreTraduit={decision.scrutinTitreTraduit}
              etapeLabel={[etapeLabel, rowLabel].filter(Boolean).join(' · ') || null}
              statut={statut}
              statutLabel={badgeLabel}
            />
          )}
          {decision.texteVote && (
            <LienTexteSortant href={decision.texteVote.lien} title={decision.texteVote.label}>
              {t('texteIssuDuVote')}
            </LienTexteSortant>
          )}
        </div>
      )}
    </div>
  );
}

function CCDecisionCard({ decision }: { decision: DecisionData }) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();
  const statut = decision.statutConclusion;

  const dateShort = decision.date ? jourMoisCourt(decision.date, locale) : null;

  const { libelle, explication: explain } = statutCC(statut, t);

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border max-w-2xl"
      style={{ padding: '10px 12px', background: 'var(--card)' }}
    >
      <p className="text-foreground font-medium m-0" style={{ fontSize: '12px' }}>
        {t('ccDecisionTitle')}
        {dateShort && <span className="text-muted-foreground font-normal"> · {dateShort}</span>}
      </p>
      {statut && (
        <span className={`inline-block self-start px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getStatusBadgeClass(statut)}`}>
          {libelle}
        </span>
      )}
      {explain && (
        <p className="text-muted-foreground m-0" style={{ fontSize: '12px', lineHeight: 1.5 }}>
          {explain}
        </p>
      )}
    </div>
  );
}

export default function DecisionCard({ decision, etapeLabel }: { decision: DecisionData; etapeLabel?: string | null }) {
  if (decision.chambreKey === 'CC') {
    return <CCDecisionCard decision={decision} />;
  }
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border max-w-2xl"
      style={{ padding: '10px 12px', background: 'var(--card)' }}
    >
      <DecisionRow decision={decision} etapeLabel={etapeLabel} />
    </div>
  );
}

export function CompositeDecisionCard({ decisions, etapeLabel }: { decisions: DecisionData[]; etapeLabel?: string | null }) {
  const t = useTranslations('resumeIA');

  const labelFor = (chambreKey: DecisionData['chambreKey']): string | null => {
    if (chambreKey === 'CMP') return t('decisionLabelCMP');
    if (chambreKey === 'AN') return t('decisionLabelVoteAN');
    if (chambreKey === 'SEN') return t('decisionLabelVoteSenat');
    return null;
  };

  return (
    <div
      className="flex flex-col rounded-lg border max-w-2xl"
      style={{ padding: '10px 12px', background: 'var(--card)' }}
    >
      {decisions.map((decision, idx) => (
        <div
          key={decision.acteUid}
          className={idx > 0 ? 'border-t border-border/50 pt-2 mt-2' : ''}
        >
          <DecisionRow decision={decision} rowLabel={labelFor(decision.chambreKey)} etapeLabel={etapeLabel} />
        </div>
      ))}
    </div>
  );
}
