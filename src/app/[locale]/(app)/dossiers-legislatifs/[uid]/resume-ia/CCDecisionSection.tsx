"use client";

// Section du Conseil constitutionnel de la fiche dossier : la décision rendue sur le
// texte (statut, résumé IA écrit la nuit, articles censurés), ou une phrase d'absence
// quand il n'a rien décidé (saisi ou non). Données préparées par page.tsx (`ccDecisionInfo`).

import { useTranslations, useLocale } from 'next-intl';
import { AIBadge, AICardFooter, AI_FRAME_STYLE } from './AICardElements';
import { CLE_PLI, IconeSection } from './SectionsDossier';
import SectionRepliable from '@/components/SectionRepliable';
import { getStatusBadgeClass } from '@/lib/status-mapping';
import { statutCC } from '@/lib/statut';
import { formateurDate } from '@/lib/jour-paris';

export interface CcDecisionInfo {
  statut: string | null;
  resumeCc: string | null;
  articlesCensures: Array<{ texte: string; objet: string; raison: string }> | null;
  urlConclusion: string | null;
  date: string | null;
}

/** Section « Le contrôle du Conseil constitutionnel » de la fiche dossier, rendue par
 *  ResumeIAClient. Présente sur toute fiche : `info` vaut null quand le Conseil n'a
 *  pas rendu de décision, et la section le dit au lieu de disparaître. `saisi` (un acte
 *  `CC-SAISIE-*` au dossier) distingue alors la décision attendue de l'absence de
 *  saisine : sans lui, un texte déféré se lirait « non saisi » jusqu'à la décision. */
export default function CCDecisionSection({ info, saisi }: { info: CcDecisionInfo | null; saisi: boolean }) {
  const t = useTranslations('resumeIA');

  return (
    <SectionRepliable
      cle="cc"
      cleStockage={CLE_PLI}
      icone={<IconeSection cle="cc" />}
      titre={t('sectionCC')}
      badge={info ? <AIBadge usage="cc" /> : undefined}
    >
      {info ? <Decision info={info} /> : (
        <p className="text-sm text-muted-foreground">{t(saisi ? 'ccSaisiEnAttente' : 'noCcData')}</p>
      )}
    </SectionRepliable>
  );
}

/** La carte de la décision : statut, date, résumé IA, articles censurés, lien. */
function Decision({ info }: { info: CcDecisionInfo }) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();

  const dateShort = info.date
    ? formateurDate(
        locale === 'en' ? 'en-GB' : 'fr-FR',
        { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' },
      ).format(new Date(info.date))
    : null;

  return (
    <div style={AI_FRAME_STYLE} className="p-4 sm:p-6">
      <div className="flex flex-col gap-4">

        {/* En-tête : badge statut + date */}
        <div className="flex flex-wrap items-center gap-2">
          {info.statut && (
            <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${getStatusBadgeClass(info.statut)}`}>
              {statutCC(info.statut, t).libelle}
            </span>
          )}
          {dateShort && (
            <span className="text-sm text-muted-foreground">{dateShort}</span>
          )}
        </div>

        {/* Résumé global ou message d'attente */}
        {info.resumeCc ? (
          <p className="text-sm leading-relaxed text-foreground/90 m-0">
            {info.resumeCc}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground italic m-0">
            {t('ccPending')}
          </p>
        )}

        {/* Articles censurés */}
        {info.articlesCensures && info.articlesCensures.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground m-0">
              {t('ccArticlesCensures')}
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 m-0 p-0 list-none">
              {info.articlesCensures.map((item, i) => (
                <li key={i} className="flex flex-col gap-1.5 rounded-md bg-muted/40 p-3">
                  <p className="text-sm font-medium text-foreground m-0 italic">{item.texte}</p>
                  <p className="text-sm text-muted-foreground m-0">
                    <span className="font-medium text-foreground/70">{t('ccObjet')} </span>
                    {item.objet}
                  </p>
                  <p className="text-sm text-muted-foreground m-0">
                    <span className="font-medium text-foreground/70">{t('ccRaison')} </span>
                    {item.raison}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>

      <AICardFooter>
        {info.urlConclusion && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <a
              href={info.urlConclusion}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline font-medium py-1 -my-1"
            >
              {t('ccSource')} →
            </a>
          </div>
        )}
      </AICardFooter>
    </div>
  );
}
