'use client'

// Écran de résultat du quiz « Processus législatif » : plaque de niveau, partage,
// et volet du détail des réponses. Rendu par `QuizProcessusClient` en fin de
// partie ou quand un résultat enregistré existe déjà.

import { useEffect, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Landmark } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import ShareButton from '@/components/ShareButton'
import { buildShareUrl } from '@/lib/share-url'
import { getReadableTextColor } from '@/lib/groupe-colors'
import { cn } from '@/lib/utils'
import {
  resolveQuizProcessusTier,
  QUIZ_PROCESSUS_TIER_LABEL_KEYS,
  QUIZ_PROCESSUS_TIER_MESSAGE_KEYS,
  type QuizProcessusScore,
  type QuizProcessusAnswerRecord,
} from '@/lib/quiz-processus'
import type { QuizProcessusQuestion } from '@/lib/quiz-processus-pool'

// Mêmes couleurs que QuizProcessusQuestionCard (Check emerald / X destructive).
const ANSWER_BADGE_CLASSES = {
  correct: 'border-emerald-500/30 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
  incorrect: 'border-destructive/30 bg-destructive/10 text-destructive',
} as const

export default function QuizProcessusResultView({
  score,
  answers,
  pool,
  onRetry,
}: {
  score: QuizProcessusScore
  answers: QuizProcessusAnswerRecord[]
  /** Pool de la langue affichée : les réponses n'enregistrent que des indices,
   *  leurs textes se relisent ici. */
  pool: QuizProcessusQuestion[]
  onRetry: () => void
}) {
  const t = useTranslations('quizProcessus')
  const locale = useLocale()

  const questionsParId = new Map(pool.map((q) => [q.id, q]))
  const tier = resolveQuizProcessusTier(score.score)
  const tierLabel = t(QUIZ_PROCESSUS_TIER_LABEL_KEYS[tier.key])
  const tierMessage = t(QUIZ_PROCESSUS_TIER_MESSAGE_KEYS[tier.key])

  const shareUrl = buildShareUrl(locale, `/Quiz/processus-legislatif/resultat?score=${score.score}`)
  const shareMessage = t('resultShareMessage', { score: score.score, niveau: tierLabel })

  const plaqueWrapRef = useRef<HTMLDivElement>(null)

  // Léger effet de tilt/parallaxe au survol de la plaque — même pattern que
  // le quiz d'affinité (souris uniquement, aucun effet sur tactile).
  useEffect(() => {
    const wrap = plaqueWrapRef.current
    if (!wrap) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return

    const MAX_TILT_DEG = 4
    const MAX_PARALLAX_PX = 6

    const handleMove = (e: MouseEvent) => {
      const rect = wrap.getBoundingClientRect()
      const centerX = rect.left + rect.width / 2
      const centerY = rect.top + rect.height / 2
      const px = Math.max(-1, Math.min(1, (e.clientX - centerX) / rect.width))
      const py = Math.max(-1, Math.min(1, (e.clientY - centerY) / rect.height))
      wrap.style.setProperty('--ry', `${px * MAX_TILT_DEG}deg`)
      wrap.style.setProperty('--rx', `${py * -MAX_TILT_DEG}deg`)
      wrap.style.setProperty('--tx', `${px * MAX_PARALLAX_PX}px`)
      wrap.style.setProperty('--ty', `${py * MAX_PARALLAX_PX}px`)
    }

    window.addEventListener('mousemove', handleMove)
    return () => window.removeEventListener('mousemove', handleMove)
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div
        ref={plaqueWrapRef}
        className="quiz-result-reveal quiz-plaque-perspective"
        style={{ '--gcolor': tier.color } as React.CSSProperties}
      >
        <Card className="quiz-plaque flex flex-col items-center gap-3 rounded-[22px] border-0 p-10 text-center">
          <div className="quiz-plaque-wash" />
          <div className="quiz-plaque-frost" />
          <div className="quiz-plaque-sheen" />
          <div className="quiz-plaque-rim" />

          <div className="quiz-plaque-content relative z-10 flex flex-col items-center gap-2">
            <p className="text-lg text-foreground/60">{t('resultTitle')}</p>
            <div className="rounded-lg border bg-white p-2.5">
              <Landmark className="h-6 w-6" style={{ color: tier.color }} />
            </div>
            <h1 className="text-xl md:text-2xl font-bold text-balance">{tierLabel}</h1>
            <div
              className="mt-2 rounded-xl px-5 py-2.5"
              style={{ backgroundColor: tier.color, color: getReadableTextColor(tier.color) }}
            >
              <span className="text-xl font-extrabold">
                {score.score}/{score.total}
              </span>
            </div>
            <p className="text-sm text-foreground/70 mt-1 max-w-xs">{tierMessage}</p>
          </div>
        </Card>
      </div>

      <div className="quiz-result-reveal-delay-1 flex justify-center">
        <ShareButton url={shareUrl} message={shareMessage} label={t('resultShareCta')} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        {answers.length > 0 && (
          <>
            <Sheet>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
                >
                  {t('resultDetailCta')}
                </button>
              </SheetTrigger>
              <SheetContent side="right" size="default" className="overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>{t('resultDetailSheetTitle')}</SheetTitle>
                </SheetHeader>
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">{t('resultDetailDescription')}</p>
                  {answers.map((a) => {
                    const question = questionsParId.get(a.questionId)
                    // Une question retirée du pool depuis la partie : l'empreinte
                    // aurait dû effacer le résultat avant d'en arriver là.
                    if (!question) return null
                    const propositions = a.ordrePropositions.map((i) => question.propositions[i])
                    return (
                    <div key={a.questionId} className="rounded-lg border p-3 flex flex-col gap-2">
                      <h3 className="text-sm font-semibold leading-snug text-balance">{question.enonce}</h3>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs font-semibold text-muted-foreground">
                          {t('resultDetailYourAnswer')}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            'whitespace-normal break-words shrink min-w-0 text-left',
                            ANSWER_BADGE_CLASSES[a.isCorrect ? 'correct' : 'incorrect'],
                          )}
                        >
                          {propositions[a.userAnswerIndex]}
                        </Badge>
                      </div>
                      {!a.isCorrect && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {t('resultDetailCorrectAnswer')}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn('whitespace-normal break-words shrink min-w-0 text-left', ANSWER_BADGE_CLASSES.correct)}
                          >
                            {propositions[a.reponseCorrecteIndex]}
                          </Badge>
                        </div>
                      )}
                      {/* Pour toutes les questions, justes ou fausses : pendant la
                          partie, une bonne réponse avance seule avant qu'on puisse
                          ouvrir sa source, c'est donc ici qu'on la retrouve. */}
                      <p className="text-muted-foreground" style={{ fontSize: '0.75rem', lineHeight: '1rem' }}>
                        {t('sourcePrefix')}{' '}
                        <a
                          href={question.source.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2 hover:text-foreground transition-colors"
                        >
                          {question.source.label}
                        </a>
                      </p>
                    </div>
                    )
                  })}
                </div>
              </SheetContent>
            </Sheet>
            <span className="text-muted-foreground/50" aria-hidden="true">
              ·
            </span>
          </>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
        >
          {t('resultRetryCta')}
        </button>
        <span className="text-muted-foreground/50" aria-hidden="true">
          ·
        </span>
        <Link
          href="/processus-legislatif"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
        >
          {t('resultSourceCta')}
        </Link>
        <span className="text-muted-foreground/50" aria-hidden="true">
          ·
        </span>
        <Link
          href="/Quiz"
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
        >
          {t('resultBackToQuiz')}
        </Link>
      </div>
    </div>
  )
}
