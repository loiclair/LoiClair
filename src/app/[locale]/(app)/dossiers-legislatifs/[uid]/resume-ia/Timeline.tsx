"use client";

// Parcours d'un dossier, étape par étape : point, trait, date, durées, cartes de
// décision et, sur un dossier de contrôle, le lien vers le rapport. Les étapes sont
// calculées côté serveur dans page.tsx et passées par ResumeIAClient.

import { Check, Flag } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type { DecisionData } from './ResumeIAClient';
import DecisionCard, { CompositeDecisionCard, LienTexteSortant } from './DecisionCard';
import { aujourdhuiAParisIso, formateurDate } from '@/lib/jour-paris';

/** Étape du parcours, calculée dans page.tsx et passée telle quelle par ResumeIAClient. */
export interface TimelineStep {
  code: string;
  label: string;
  date: string | null;
  done: boolean;
  detail: string | null;
  /** Texte produit par l'étape (rapport d'un dossier de contrôle), quand il est en ligne. */
  lien?: { href: string; label: string } | null;
}

interface TimelineProps {
  uid: string;
  steps: TimelineStep[];
  statutFinal: string | null;
  datePromulgation: string | null;
  dureeTotal: number | null;
  dureeApplication: number | null;
  isAppDirecte: boolean;
  decisionsByMilestone?: Record<string, DecisionData[]>;
  nbMesuresAttendues?: number | null;
  nbMesuresAppliquees?: number | null;
  ccSaisineCounts?: Record<'PM' | 'AN' | 'SN' | 'DROIT', number>;
  /** Loi promulguée telle que publiée, rendue sous l'étape PROM comme le texte
   *  issu d'un vote sous sa carte de décision. Null tant qu'elle n'est pas lisible. */
  lienTextePromulgue?: string | null;
}

const toDateStr = (s: string) => s.slice(0, 10);

export default function Timeline({ steps, statutFinal, datePromulgation, dureeTotal, dureeApplication, isAppDirecte, decisionsByMilestone, nbMesuresAttendues, nbMesuresAppliquees, ccSaisineCounts, lienTextePromulgue }: TimelineProps) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();
  const today = aujourdhuiAParisIso();
  const isRejected = statutFinal === 'Rejeté';
  const lastDoneIdx = steps.reduce((acc, s, i) => s.done ? i : acc, -1);
  const hasPendingSteps = steps.some(s => !s.done);
  // « Publié » est le statut final des procédures sans vote (rapports, missions,
  // commissions d'enquête, pétitions, allocutions) : rien ne les promulgue, et sans
  // cette condition leur dernière étape pulsait « en cours » sous un hero qui les dit
  // publiées. Une étape encore en attente garde le point animé, par `hasPendingSteps`.
  const isOngoing = !datePromulgation && !isRejected && statutFinal !== 'Publié';

  const formatDate = (iso: string) => {
    const d = new Date(toDateStr(iso) + 'T00:00:00');
    return formateurDate(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  };

  const formatDuration = (diff: number): string => {
    if (diff > 60) {
      const months = Math.round(diff / 30);
      return t('durationMonths', { count: months });
    }
    return t('durationDays', { count: diff });
  };

  const daysBetween = (a: string, b: string): number => {
    return Math.round((new Date(toDateStr(b) + 'T00:00:00').getTime() - new Date(toDateStr(a) + 'T00:00:00').getTime()) / 86400000);
  };

  return (
    <div className="flex flex-col gap-0 mt-1">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const isLastDone = i === lastDoneIdx;
        const nextStep = !isLast ? steps[i + 1] : null;
        const isNextPending = nextStep && !nextStep.done;
        const isCurrent = isLastDone && (hasPendingSteps || isOngoing) && !isRejected;
        const dotColor = !step.done
          ? 'border-muted-foreground bg-transparent'
          : isRejected && isLastDone
            ? 'border-red-500 bg-red-500'
            : 'border-primary bg-primary';
        const lineColor = isNextPending || !step.done ? 'border-muted-foreground' : isRejected ? 'border-red-400' : 'border-primary';
        const lineStyle = isNextPending || !step.done ? 'dashed' : 'solid';

        // Durée entre deux étapes complétées (affichée sur le trait)
        const durationDays = (step.done && nextStep?.done && step.date && nextStep.date)
          ? daysBetween(step.date, nextStep.date)
          : null;
        const showDurationOnLine = durationDays !== null && durationDays > 0;

        const decisions = decisionsByMilestone?.[step.code] ?? [];

        return (
          <div key={step.code} className="flex gap-3" style={{ minHeight: isLast ? undefined : '70px' }}>
            {/* Colonne gauche : point + ligne */}
            <div className="flex flex-col items-center" style={{ width: '14px' }}>
              <div className="relative shrink-0" style={{ width: '14px', height: '14px', marginTop: '3px' }}>
                {isCurrent && (
                  <div
                    className="absolute rounded-full border-2 border-primary animate-ping"
                    style={{ inset: 0, opacity: 0.4 }}
                  />
                )}
                {step.code === 'PROM' && step.done ? (
                  <div
                    className="absolute flex items-center justify-center rounded-full bg-primary"
                    style={{ top: '0px', left: '0px', width: '14px', height: '14px' }}
                  >
                    <Check className="text-primary-foreground" style={{ width: '10px', height: '10px' }} />
                  </div>
                ) : step.code === 'AN-APPLI' && step.done ? (
                  <div
                    className="absolute flex items-center justify-center rounded-full bg-primary"
                    style={{ top: '0px', left: '0px', width: '14px', height: '14px' }}
                  >
                    <Flag className="text-primary-foreground" style={{ width: '9px', height: '9px' }} />
                  </div>
                ) : (
                  <div
                    className={`absolute rounded-full border-2 ${dotColor}`}
                    style={{ top: '2px', left: '2px', width: '10px', height: '10px' }}
                  />
                )}
              </div>
              {!isLast && (
                <div
                  className={lineColor}
                  style={{
                    flex: 1,
                    minHeight: '28px',
                    borderLeftWidth: '2px',
                    borderLeftStyle: lineStyle,
                    position: 'relative',
                  }}
                >
                  {showDurationOnLine && (
                    <span
                      className="text-muted-foreground"
                      style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        background: 'color-mix(in srgb, var(--background) 70%, var(--muted))',
                        padding: '1px 5px',
                        fontSize: '10px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {formatDuration(durationDays!)}
                    </span>
                  )}
                </div>
              )}
            </div>
            {/* Colonne droite : contenu */}
            <div className="flex flex-col flex-1" style={{ paddingBottom: isLast ? 0 : '8px' }}>
              <div className="flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${step.done ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {step.label}
                </span>
                <span className="text-foreground/60" style={{ fontSize: '11px' }}>
                  {step.date ? formatDate(step.date) : step.done ? '' : t('pending')}
                </span>
              </div>
              {step.lien && (
                <div>
                  <LienTexteSortant href={step.lien.href} title={step.lien.label}>
                    {t('lireLeRapport')}
                  </LienTexteSortant>
                </div>
              )}

              {step.code === 'DECAPP' && nbMesuresAttendues !== null && nbMesuresAttendues !== undefined && nbMesuresAttendues > 0 && (
                <span className="text-xs text-muted-foreground" style={{ marginTop: '2px' }}>
                  {t('measuresPublished', { published: nbMesuresAppliquees ?? 0, total: nbMesuresAttendues })}
                </span>
              )}
              {step.code === 'CC' && ccSaisineCounts && (() => {
                const parts: string[] = [];
                const labels: Record<'PM' | 'AN' | 'SN' | 'DROIT', string> = {
                  PM: t('seizedByPM'),
                  AN: t('seizedByAN'),
                  SN: t('seizedBySN'),
                  DROIT: t('seizedByDroit'),
                };
                (['PM', 'AN', 'SN', 'DROIT'] as const).forEach(type => {
                  const n = ccSaisineCounts[type];
                  if (n > 0) parts.push(n > 1 ? `${labels[type]} (×${n})` : labels[type]);
                });
                if (parts.length === 0) return null;
                return (
                  <span className="text-xs text-muted-foreground" style={{ marginTop: '2px' }}>
                    {t('seizedBy', { authors: parts.join(', ') })}
                  </span>
                );
              })()}
              {/* Ces deux lignes sont décalées de 14 px : avec la date, elles portent l'étape
                  à trois lignes, et le milieu du trait tombe alors à hauteur du lien. La
                  durée posée sur le trait, centrée sur 14 px, déborde à droite : « 10 mois »
                  mordait de 5 px sur le début du lien, « 10 months » de 11. Sans durée sur le
                  trait (application directe, où PROM est la dernière étape, ou décrets pas
                  encore parus), rien ne déborde et les lignes restent alignées sur le titre. */}
              {step.code === 'PROM' && step.done && dureeTotal !== null && (
                <span className="text-xs font-semibold" style={{ color: '#27AE60', marginLeft: showDurationOnLine ? '14px' : undefined, marginTop: '4px' }}>
                  {isAppDirecte ? t('promulgatedAndApplied', { count: dureeTotal }) : t('promulgatedIn', { count: dureeTotal })}
                </span>
              )}
              {step.code === 'PROM' && step.done && lienTextePromulgue && (
                <div style={{ marginLeft: showDurationOnLine ? '14px' : undefined }}>
                  <LienTexteSortant href={lienTextePromulgue} title={t('textePromulgue')}>
                    {t('textePromulgue')}
                  </LienTexteSortant>
                </div>
              )}
              {step.code === 'AN-APPLI' && step.done && dureeApplication !== null && (
                <span className="text-xs font-semibold" style={{ color: '#27AE60' }}>
                  {t('appliedIn', { count: dureeApplication })}
                </span>
              )}
              {isCurrent && step.date && !step.detail && !isLast && (
                <span className="text-xs" style={{ color: '#F39C12', marginTop: '4px' }}>
                  {t('ongoingSince', { duration: formatDuration(daysBetween(step.date, today)) })}
                </span>
              )}
              {step.detail && (
                <span className="text-xs" style={{ color: step.detail.startsWith('en cours') ? '#F39C12' : undefined, opacity: step.detail.startsWith('en cours') ? 1 : 0.7, marginTop: '4px' }}>
                  {step.detail}
                </span>
              )}

              {decisions.length === 1 && (
                <div className="mt-2 mb-4">
                  <DecisionCard decision={decisions[0]} etapeLabel={step.label} />
                </div>
              )}
              {decisions.length > 1 && (
                <div className="mt-2 mb-4">
                  <CompositeDecisionCard decisions={decisions} etapeLabel={step.label} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
