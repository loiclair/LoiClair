'use client';

// Carte « Le débat » de la fiche dossier : arguments pour et contre tirés des
// comptes rendus de séance. Montée par ResumeIAClient, elle appelle
// /api/resume-debats à son affichage et à chaque Réessayer, puis rend l'objet
// JSON de la synthèse. Les compteurs et la date de dernière séance viennent de la
// vue `dossiers_debats_stats`, lue par page.tsx.

import { useEffect, useRef, useState } from 'react';
import { useCompletion } from '@ai-sdk/react';
import { useLocale, useTranslations } from 'next-intl';
import { ThumbsUp, ThumbsDown, AlertCircle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { AI_FRAME_STYLE, AI_INNER_STYLE, AICardFooter, BusyNotice, RateLimitNotice } from './AICardElements';
import { useAiErrorStatus } from './useAiErrorStatus';
import type { ArgumentDebat, ResumeDebatsIa } from '@/lib/ai-schemas';

const LOADING_STEPS_FR = [
  'Lecture des interventions…',
  'Extraction des arguments…',
  'Analyse en cours…',
  'Synthèse des positions…',
];
const LOADING_STEPS_EN = [
  'Reading interventions…',
  'Extracting arguments…',
  'Analyzing…',
  'Synthesizing positions…',
];

interface Props {
  dossierUid: string;
  hasInterventions: boolean;
  nbInterventions: number;
  nbSeancesAN: number;
  nbSeancesSEN: number;
  /** Date ISO de la dernière séance du dossier : le résumé la suit pendant le débat. */
  derniereSeance: string | null;
  /** Question à poser aux IA externes, construite par ResumeIAClient ; null sans lien officiel. */
  askAIPrompt?: string | null;
}

/**
 * Lit la synthèse rendue par la route, qui est un objet JSON contraint par schéma.
 *
 * Ce que ça corrige, au-delà du format : avant, une puce hors gabarit était
 * ignorée en silence, et un parsing raté s'affichait exactement comme une absence
 * réelle d'arguments. Le lecteur ne pouvait pas faire la différence entre « aucune
 * opposition n'a été exprimée » et « on n'a pas su lire la réponse ». Désormais un
 * tableau vide ne veut dire qu'une chose, et un objet illisible ne s'affiche pas
 * du tout.
 *
 * La garde couvre les deux seuls cas restants : une réponse encore en transfert,
 * et une ligne de cache écrite avant la migration, restée en markdown.
 */
function lireSynthese(text: string): ResumeDebatsIa | null {
  if (!text) return null;
  try {
    const objet = JSON.parse(text) as ResumeDebatsIa;
    return Array.isArray(objet?.pour) && Array.isArray(objet?.contre) ? objet : null;
  } catch {
    return null;
  }
}

// `groupes` vide : argument porté par des orateurs sans groupe connu, ou dont
// tous les libellés ont été retirés par le filtre de la route. Il s'affiche seul.
function ArgumentCard({ arg, accent }: { arg: ArgumentDebat; accent: 'pour' | 'contre' }) {
  const accentColor = accent === 'pour' ? '#1F8B4C' : '#B91C1C';

  return (
    <p className="text-sm text-foreground" style={{ lineHeight: 1.55 }}>
      {arg.groupes && (
        <>
          <span className="font-semibold" style={{ color: accentColor }}>{arg.groupes}</span>
          {' — '}
        </>
      )}
      {arg.argument}
    </p>
  );
}

function SkeletonColumn({ color }: { color: string }) {
  return (
    <div className="space-y-4">
      {[0, 1, 2].map(i => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-4" style={{ width: `${85 - i * 10}%`, opacity: 0.6 }} />
          <Skeleton className="h-3" style={{ width: `${70 - i * 8}%`, opacity: 0.4, backgroundColor: color }} />
        </div>
      ))}
    </div>
  );
}

/**
 * Déclenche la synthèse des débats du dossier et l'affiche : étapes de
 * chargement, erreurs qualifiées par useAiErrorStatus, puis colonnes pour et
 * contre. Sans intervention en base, n'affiche qu'une phrase d'absence et
 * n'appelle pas la route ; même phrase quand la route refuse faute
 * d'intervention de fond.
 */
export default function ArgumentsPourContre({
  dossierUid,
  hasInterventions,
  nbInterventions,
  nbSeancesAN,
  nbSeancesSEN,
  derniereSeance,
  askAIPrompt,
}: Props) {
  const locale = useLocale();
  const t = useTranslations('resumeIA');
  const [triggered, setTriggered] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [snapshot, setSnapshot] = useState<string | null>(null);

  const { customFetch, errorKind, rateLimitResetMs, busyUntilMs, handleCompletionError } = useAiErrorStatus();

  const { completion, complete, isLoading } = useCompletion({
    api: '/api/resume-debats',
    experimental_throttle: 50,
    fetch: customFetch,
    onError: handleCompletionError,
  });

  useEffect(() => {
    if (!hasInterventions) return;
    if (triggered && retryKey === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- déclenchement initial du résumé IA : se fait au mount + à chaque retryKey
    setTriggered(true);
    setSnapshot(null);
    complete(JSON.stringify({ dossier_uid: dossierUid, locale }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenchement intentionnel : monter + retry uniquement, pas sur changement de `complete`/`triggered`
  }, [dossierUid, hasInterventions, retryKey, locale]);

  // Fige la réponse une fois la requête finie. Le drapeau reste levé jusqu'à
  // l'instantané, et non le seul rendu suivant : `completion` peut arriver
  // après `isLoading` repassé à faux. Constaté avec une réponse servie en 3 ms,
  // quand le test ne regardait que le rendu suivant : la carte restait sur son
  // squelette. Le drapeau ne se lève qu'en cours de requête, pour qu'une
  // relance ne refige pas l'ancienne réponse.
  const attendInstantane = useRef(false);
  useEffect(() => {
    if (isLoading) {
      attendInstantane.current = true;
      return;
    }
    if (attendInstantane.current && completion && snapshot === null) {
      const timer = setTimeout(() => {
        attendInstantane.current = false;
        setSnapshot(completion);
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [isLoading, completion, snapshot]);

  const [loadingStep, setLoadingStep] = useState(0);
  const loadingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const steps = locale === 'en' ? LOADING_STEPS_EN : LOADING_STEPS_FR;

  useEffect(() => {
    if (isLoading && !completion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset du compteur d'étapes au démarrage du loading
      setLoadingStep(0);
      loadingInterval.current = setInterval(() => {
        setLoadingStep(prev => Math.min(prev + 1, steps.length - 1));
      }, 4500);
      return () => { if (loadingInterval.current) clearInterval(loadingInterval.current); };
    } else {
      if (loadingInterval.current) clearInterval(loadingInterval.current);
    }
  }, [isLoading, completion, steps.length]);

  // Un refus définitif de la route ('unavailable') dit la même chose qu'un
  // dossier sans intervention : `hasInterventions` compte aussi les interventions
  // de procédure, que la route filtre avant de conclure qu'il n'y a rien de fond.
  if (!hasInterventions || errorKind === 'unavailable') {
    return (
      <p className="text-sm text-muted-foreground">{t('noDebateData')}</p>
    );
  }

  const synthese = lireSynthese(snapshot || completion);
  const isReady = snapshot !== null && synthese !== null;
  const showLoading = snapshot === null && !errorKind;
  // Corps illisible alors que la requête a abouti : une ligne de cache restée en
  // markdown, ou un objet tronqué. Sans ce cas, le composant se rendrait vide et
  // le resterait : ni squelette, ni message, ni bouton pour relancer.
  const corpsIllisible = snapshot !== null && synthese === null && !errorKind;
  const nbSeances = nbSeancesAN + nbSeancesSEN;

  // « jusqu'au X » situe le résumé dans le temps : il suit le débat pendant qu'il a
  // lieu. timeZone obligatoire : une date nue 'YYYY-MM-DD' est lue à minuit UTC,
  // donc affichée la veille pour tout lecteur à l'ouest de Greenwich.
  const sessionLabel = t('debateBasis', {
    nbInterventions,
    nbSeances,
    nbSeancesAN,
    nbSeancesSEN,
    deuxChambres: nbSeancesAN > 0 && nbSeancesSEN > 0 ? 'oui' : 'non',
    date: derniereSeance
      ? new Date(derniereSeance).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          timeZone: 'Europe/Paris',
        })
      : '',
  });

  const handleRetry = () => {
    setSnapshot(null);
    setRetryKey(k => k + 1);
  };

  return (
    <div style={AI_FRAME_STYLE}>
      <div style={{ ...AI_INNER_STYLE, padding: '20px 24px' }}>
        {showLoading && (
          <div className="flex items-center gap-2 mb-5 text-sm" style={{ color: '#0891B2' }}>
            <span
              className="h-3 w-3 rounded-full border-2 animate-spin"
              style={{ borderColor: '#06B6D4', borderTopColor: 'transparent' }}
            />
            {steps[loadingStep]}
          </div>
        )}
        {errorKind === 'rate-limit' && (
          <RateLimitNotice resetMs={rateLimitResetMs} askAIPrompt={askAIPrompt} />
        )}
        {errorKind === 'busy' && busyUntilMs && (
          <BusyNotice untilMs={busyUntilMs} onRetry={handleRetry} />
        )}
        {errorKind && errorKind !== 'rate-limit' && errorKind !== 'busy' && (
          <div className="flex items-start gap-3 text-sm">
            <span className="flex items-start gap-1.5" style={{ color: '#B91C1C' }}>
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{errorKind === 'quota' ? t('generationQuotaExceeded') : t('generationFailed')}</span>
            </span>
            {errorKind !== 'quota' && (
              <button type="button" onClick={handleRetry} className="text-xs leading-5 text-primary hover:underline shrink-0">
                {t('retry')}
              </button>
            )}
          </div>
        )}
        {corpsIllisible && (
          <div className="flex items-start gap-3 text-sm">
            <span className="flex items-start gap-1.5" style={{ color: '#B91C1C' }}>
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{t('generationFailed')}</span>
            </span>
            <button type="button" onClick={handleRetry} className="text-xs leading-5 text-primary hover:underline shrink-0">
              {t('retry')}
            </button>
          </div>
        )}
        <div>
          {showLoading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <ThumbsUp className="h-4 w-4" style={{ color: '#1F8B4C', opacity: 0.5 }} />
                  <span className="text-sm font-semibold" style={{ color: '#1F8B4C', opacity: 0.5 }}>
                    {t('argumentsFor')}
                  </span>
                </div>
                <SkeletonColumn color="#1F8B4C" />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <ThumbsDown className="h-4 w-4" style={{ color: '#B91C1C', opacity: 0.5 }} />
                  <span className="text-sm font-semibold" style={{ color: '#B91C1C', opacity: 0.5 }}>
                    {t('argumentsAgainst')}
                  </span>
                </div>
                <SkeletonColumn color="#B91C1C" />
              </div>
            </div>
          )}

          {isReady && synthese && (
            <div className="fade-slide-in">
              {synthese.synthese && (
                <p className="text-sm text-foreground mb-6" style={{ lineHeight: 1.7 }}>
                  {synthese.synthese}
                </p>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: '#1F8B4C' }}>
                    <ThumbsUp className="h-4 w-4" />
                    {t('argumentsFor')}
                  </h3>
                  {synthese.pour.length > 0 ? (
                    <div className="space-y-4">
                      {synthese.pour.map((arg, i) => (
                        <ArgumentCard key={i} arg={arg} accent="pour" />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      {t('noArgumentFor')}
                    </p>
                  )}
                </div>

                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold mb-4" style={{ color: '#B91C1C' }}>
                    <ThumbsDown className="h-4 w-4" />
                    {t('argumentsAgainst')}
                  </h3>
                  {synthese.contre.length > 0 ? (
                    <div className="space-y-4">
                      {synthese.contre.map((arg, i) => (
                        <ArgumentCard key={i} arg={arg} accent="contre" />
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      {t('noArgumentAgainst')}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <AICardFooter>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{sessionLabel}</span>
            <Link
              href={`/dossiers-legislatifs/${dossierUid}/debats`}
              prefetch={false}
              className="text-xs text-primary hover:underline font-medium py-1 -my-1"
            >
              {t('viewFullVerbatim')}
            </Link>
          </div>
        </AICardFooter>
      </div>
    </div>
  );
}
