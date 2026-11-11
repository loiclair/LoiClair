'use client';

// Éléments partagés des cartes IA de la fiche dossier (résumé, débat, décision
// du Conseil constitutionnel) : cadre doré, badge, pied, message de limite
// horaire, attente du fournisseur et rangée de liens vers les IA externes.

import { useEffect, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Clock } from 'lucide-react';
import type { IconType } from 'react-icons';
import { RiSparkling2Fill } from 'react-icons/ri';
import { Link } from '@/i18n/navigation';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatRateLimitResetTime } from './useAiErrorStatus';
import { ASK_AI_SEP_WIDTH, ASK_AI_TARGETS } from '@/lib/ask-ai-targets';

// Bordure dorée signature (pas de halo, pas de gradient padding —
// les deux donnaient un tint amber perceptible à l'intérieur).
// Le double-wrapper outer/inner reste pour compat des sites d'appel.
export const AI_FRAME_STYLE: React.CSSProperties = {
  border: '1px solid rgba(212, 165, 74, 0.45)',
  borderRadius: '14px',
  backgroundColor: 'var(--card)',
};

export const AI_INNER_STYLE: React.CSSProperties = {};

/** Les sept usages de l'IA, dans l'ordre de `/documentation/prompts-ia`, où chacun
 *  est aussi l'ancre de sa section. */
export type UsageIA = 'loi' | 'debats' | 'cc' | 'search' | 'concerne' | 'titres' | 'nl';

/**
 * Mention IA (D-002) : le badge visible de chaque texte rédigé par l'IA, qui mène
 * aux instructions publiées. L'infobulle au survol dit ce qu'est ce texte et ce que
 * fait le clic ; `infobulle` la remplace quand l'appelant a plus précis à dire (le
 * tri par profil de « Ce qui me concerne » et ses explications). Choix assumé : rien de plus sur
 * téléphone, où le toucher suit le lien.
 *
 * `court` réduit le libellé à « IA », pour un titre de section où le libellé complet
 * prendrait une ligne à lui seul (amendements du tiroir de « Ce qui me concerne ») ;
 * le lecteur d'écran garde le libellé complet. L'étincelle pleine, celle que le grand
 * public associe à l'IA (les étincelles en traits de lucide ne la rappelaient pas),
 * fait reconnaître l'IA d'un coup d'œil, surtout sur la version courte. Tailles et
 * espacements en ligne, pas en classes (Safari).
 */
// `surBandeau` : posé sur le bandeau d'en-tête (`PageHero`), dont le fond clair est
// exactement `--muted` (#F7F5F2) ; le badge n'y avait plus de fond visible. Le voile
// du bandeau, lui, change avec le thème.
// `usage` : la section des instructions qui a écrit ce texte, ouverte à l'arrivée
// (`AccordionUsages`). Obligatoire, pour qu'un nouveau badge ne retombe pas en silence
// sur le haut de la page. Un tableau quand le badge couvre plusieurs textes d'IA
// (`#concerne+titres`) : toutes ces sections s'ouvrent.
// `infobulle={false}` : pas d'infobulle du tout, quand le badge ne marque pas un
// texte affiché sur la page. Sur /newsletter, il annonce les e-mails à venir, et
// l'infobulle par défaut (« Ce texte est rédigé… ») désignait la page elle-même.
export function AIBadge({ usage, infobulle, court, surBandeau }: { usage: UsageIA | UsageIA[]; infobulle?: string | false; court?: boolean; surBandeau?: boolean }) {
  const t = useTranslations('resumeIA');
  const badge = (
    <Link
      href={`/documentation/prompts-ia#${[usage].flat().join('+')}`}
      aria-label={court ? t('aiBadge') : undefined}
      className="inline-flex items-center rounded-full bg-muted font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      style={{
        ...(court
          ? { gap: 3, padding: '1px 7px', fontSize: 11, lineHeight: 1.35, flex: 'none' }
          : { gap: 5, padding: '3px 10px', fontSize: 12, lineHeight: 1.35 }),
        ...(surBandeau ? { backgroundColor: 'var(--bandeau-voile-fort)' } : {}),
      }}
    >
      <RiSparkling2Fill aria-hidden size={court ? 11 : 13} style={{ flex: 'none' }} />
      {t(court ? 'aiBadgeCourt' : 'aiBadge')}
    </Link>
  );
  if (infobulle === false) return badge;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent>{infobulle ?? t('aiBadgeTooltip')}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Mention IA d'un titre traduit (`lib/titre-dossier.ts`), hors de la fiche du dossier :
 * le badge court, avec une infobulle qui parle de traduction et non de rédaction.
 * `pluriel` quand le badge est en tête d'une section qui liste plusieurs titres : il
 * se pose là quand chaque titre est déjà un lien ou un bouton, où un badge-lien ne
 * peut pas entrer.
 */
export function AIBadgeTitre({ pluriel, surBandeau }: { pluriel?: boolean; surBandeau?: boolean }) {
  const t = useTranslations('resumeIA');
  return <AIBadge usage="titres" court surBandeau={surBandeau} infobulle={t(pluriel ? 'titresIAInfobulle' : 'titreIAInfobulle')} />;
}

/**
 * Message de limite horaire, affiché dans la carte à la place du résumé manquant.
 *
 * Il vit au plus près du contenu absent, et non en tête de page : un bandeau
 * global affirmait « vous avez atteint votre limite » pour tout le site, ce que
 * le lecteur voyait démenti dès le dossier suivant dont le résumé était déjà
 * écrit. Le texte ne parle donc que des résumés que LoiClair doit encore écrire,
 * sans rien promettre sur les autres pages.
 *
 * `resetMs` vient de l'en-tête X-RateLimit-Reset ; l'appelant ne le rend que
 * lorsqu'il est lisible (cf. useAiErrorStatus).
 */
export function RateLimitNotice({
  resetMs,
  askAIPrompt,
}: {
  resetMs: number | null;
  /** Question à poser aux IA externes ; null quand le texte n'a pas de lien officiel. */
  askAIPrompt?: string | null;
}) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();
  const resetTime = formatRateLimitResetTime(resetMs, locale);
  return (
    <div className="avis-limite flex items-start gap-2.5 rounded-lg px-3 py-3 text-sm">
      <Clock className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
      <div className="min-w-0">
        <p style={{ lineHeight: 1.6 }}>
          {askAIPrompt
            ? t('generationRateLimited', { time: resetTime })
            : t('generationRateLimitedNoLink', { time: resetTime })}
        </p>
        {askAIPrompt && (
          <div style={{ marginTop: '6px' }}>
            <AskAILinks prompt={askAIPrompt} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Attente imposée par la limite par minute du fournisseur IA (`'busy'` dans
 * useAiErrorStatus), affichée dans la carte à la place du résumé manquant.
 *
 * Même rangée que l'erreur générique, pour ne pas alourdir la carte, mais une
 * horloge en couleur neutre plutôt que le rouge : rien n'est cassé, il faut
 * attendre. Le bouton reste grisé pendant le compte à rebours, parce qu'une
 * relance dans la minute heurterait la même limite et ferait attendre au
 * lecteur les reprises de la route (1 s puis 4 s, `DELAIS_REPRISE_WEB`) pour
 * rien. `untilMs` est l'heure de fin, calculée par le hook à partir de
 * `Retry-After`.
 */
export function BusyNotice({ untilMs, onRetry }: { untilMs: number; onRetry: () => void }) {
  const t = useTranslations('resumeIA');
  const [now, setNow] = useState(() => Date.now());
  const seconds = Math.max(0, Math.ceil((untilMs - now) / 1000));
  const done = seconds === 0;

  // Dépend de `done` et non de `seconds` : un seul minuteur pour tout le compte
  // à rebours, arrêté à zéro, plutôt qu'un nouveau à chaque seconde.
  useEffect(() => {
    if (done) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [done]);

  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="flex items-start gap-1.5 text-muted-foreground">
        <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span>{t('generationBusy')}</span>
      </span>
      {/* `leading-5` : la hauteur de ligne du message (text-sm). Avec celle de
          text-xs, plus courte, le bouton calé en haut montait au-dessus du texte. */}
      {!done ? (
        <button type="button" disabled className="text-xs leading-5 text-muted-foreground shrink-0 tabular-nums cursor-default">
          {t('retryIn', { seconds })}
        </button>
      ) : (
        <button type="button" onClick={onRetry} className="text-xs leading-5 text-primary hover:underline shrink-0">
          {t('retry')}
        </button>
      )}
    </div>
  );
}

/**
 * Rangée de liens « posez la question à… », sous le résumé et dans le message
 * de limite horaire. `prompt` est la question en clair, encodée ici une fois.
 *
 * Logos monochromes, dans la couleur du texte : six couleurs de marque dans
 * le bandeau doré chargeraient la carte. La rangée passe à la ligne sur iPhone
 * plutôt que de déborder.
 *
 * Chaque lien porte son point séparateur devant lui, dans une case de largeur
 * fixe (`ASK_AI_SEP_WIDTH`). La rangée est décalée d'autant vers la gauche dans
 * un cadre qui rogne : le point du premier lien de chaque ligne tombe hors du
 * cadre, et aucune ligne ne commence par « · » quand la rangée passe à la ligne.
 * Le cadre déborde de 3 px de chaque côté (marge négative compensée par autant
 * de padding) : sans cette marge, il rognerait aussi le contour de focus clavier
 * des liens du bord, et le point, centré dans sa case de 16 px, reste caché.
 */
export function AskAILinks({ prompt }: { prompt: string }) {
  const t = useTranslations('resumeIA');
  const q = encodeURIComponent(prompt);
  return (
    <span className="block" style={{ overflow: 'hidden', padding: '3px', margin: '-3px' }}>
      <span className="flex flex-wrap items-center" style={{ rowGap: '4px', marginLeft: `-${ASK_AI_SEP_WIDTH}px` }}>
        {ASK_AI_TARGETS.map((ia) => {
          const label = ia.labelKey ? t(ia.labelKey) : ia.name;
          // Le Mode IA se nomme avec sa marque pour le lecteur d'écran, qui n'a pas le logo.
          const ariaName = ia.labelKey ? `${ia.name} ${label}` : label;
          return (
            <span key={ia.name} className="inline-flex items-center">
              <AskAISeparator />
              <AskAILink href={ia.url(q)} label={label} ariaLabel={t('askAIAria', { ia: ariaName })} Icon={ia.Icon} />
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** Point séparateur de la rangée, centré dans sa case. La maquette de l'accueil (LoiEnClair.tsx) en recopie le rendu. */
function AskAISeparator() {
  return (
    <span
      aria-hidden="true"
      className="inline-block text-center text-muted-foreground"
      style={{ width: `${ASK_AI_SEP_WIDTH}px`, opacity: 0.5 }}
    >
      ·
    </span>
  );
}

/** Un lien de la rangée. Survol doré en état React et style en ligne, comme les autres survols de la fiche : Tailwind v4 est peu fiable sur Safari. */
function AskAILink({ href, label, ariaLabel, Icon }: { href: string; label: string; ariaLabel: string; Icon: IconType }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={`inline-flex items-center whitespace-nowrap ${hovered ? '' : 'text-muted-foreground'}`}
      style={{
        gap: '5px',
        fontSize: '0.8125rem',
        fontWeight: 500,
        color: hovered ? '#D4A54A' : undefined,
        transition: 'color 0.15s ease',
        WebkitTransition: 'color 0.15s ease',
      }}
    >
      <Icon aria-hidden="true" style={{ width: '14px', height: '14px', flexShrink: 0 }} />
      {label}
    </a>
  );
}

/**
 * Pied d'une carte IA — source du contenu résumé, puis mention de génération.
 *
 * Rendu en fin de contenu, donc dans le rembourrage de la carte : le trait
 * s'arrête à l'aplomb du texte, comme l'avertissement de tête du résumé, et non
 * bord à bord comme la bande d'action qui suit. Les trois cartes de la page
 * (résumé, débat, décision du Conseil constitutionnel) n'ont pas le même
 * rembourrage, un trait pleine largeur y demanderait trois marges négatives.
 *
 * `children` porte la ligne de source, propre à chaque carte ; la mention de
 * génération, elle, est la même partout.
 */
export function AICardFooter({ children }: { children?: React.ReactNode }) {
  const t = useTranslations('resumeIA');
  return (
    <div className="mt-6 pt-3 border-t border-border/60">
      {children}
      <p className="text-xs text-muted-foreground italic mt-0.5 leading-snug">{t('summaryDisclaimer')}</p>
    </div>
  );
}
