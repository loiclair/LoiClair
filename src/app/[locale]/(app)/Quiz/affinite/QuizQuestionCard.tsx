'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ArrowRight, ThumbsUp, ThumbsDown, Minus } from 'lucide-react'
import { Link } from '@/i18n/navigation'
import { Card, CardFooter } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { libelleTheme } from '@/lib/themes-dossiers'
import type { QuizAffiniteQuestion, QuizAffinitePosition } from '@/lib/quiz-affinite-queries'
import type { QuizUserAnswer } from '@/lib/quiz-affinite'
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements'

// Carte d'une question du quiz d'affinité : date et thèmes du scrutin, son titre
// officiel (traduit par l'IA sur /en), le lien vers la fiche du dossier, puis les trois
// réponses. Rendue par AffiniteQuizClient ; `onAnswer` part après l'animation de sortie.

// Durée de l'animation « la carte s'envole » — l'avance vers la question
// suivante est retardée d'autant pour laisser l'animation se jouer.
const SWIPE_EXIT_MS = 420

export default function QuizQuestionCard({
  question,
  defaultAnswer,
  onAnswer,
}: {
  question: QuizAffiniteQuestion
  defaultAnswer?: QuizUserAnswer
  onAnswer: (position: QuizUserAnswer) => void
}) {
  const t = useTranslations('quiz')
  const tThemes = useTranslations('themesDossiers')
  const locale = useLocale()
  const [exiting, setExiting] = useState<QuizUserAnswer | null>(null)
  const timeoutRef = useRef<number | undefined>(undefined)
  const dateStr = question.dateScrutin
    ? new Date(question.dateScrutin).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  // Annule le timer différé si la carte est démontée avant la fin de
  // l'animation (ex. l'utilisateur clique « retour » juste après avoir voté).
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  const options: { value: QuizAffinitePosition; label: string; icon: typeof ThumbsUp }[] = [
    { value: 'pour', label: t('answerPour'), icon: ThumbsUp },
    { value: 'contre', label: t('answerContre'), icon: ThumbsDown },
    { value: 'abstention', label: t('answerAbstention'), icon: Minus },
  ]

  const handleValueChange = (value: string) => {
    if (exiting) return
    const position = value as QuizAffinitePosition
    setExiting(position)
    timeoutRef.current = window.setTimeout(() => onAnswer(position), SWIPE_EXIT_MS)
  }

  const handlePass = () => {
    if (exiting) return
    setExiting('pass')
    timeoutRef.current = window.setTimeout(() => onAnswer('pass'), SWIPE_EXIT_MS)
  }

  return (
    <Card
      className={cn(
        'quiz-card-enter relative',
        exiting === 'pour' && 'quiz-exit-pour',
        exiting === 'contre' && 'quiz-exit-contre',
        (exiting === 'abstention' || exiting === 'pass') && 'quiz-exit-abstention',
      )}
    >
      {/* Hauteur plancher et non fixe : les 480 px servaient au résumé IA, retiré
          des cartes. Le plancher garde les boutons à peu près au même endroit
          d'une question à l'autre, sans laisser un grand vide sous un titre court. */}
      <div className="px-6 flex flex-col gap-3" style={{ minHeight: '11rem' }}>
        <div className="flex flex-col gap-1">
          {dateStr && (
            <span className="text-sm font-bold text-muted-foreground">
              {t('questionLabelScrutin', { date: dateStr })}
            </span>
          )}
          {question.themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {question.themes.map((theme) => (
                <Badge key={theme} variant="outline" className="font-normal text-muted-foreground">
                  {libelleTheme(theme, tThemes)}
                </Badge>
              ))}
            </div>
          )}
          <h2 className="text-lg font-semibold leading-snug text-balance pb-2">
            {question.titre}
            {question.titreTraduit && <span style={{ marginLeft: '8px', verticalAlign: '3px' }}><AIBadgeTitre /></span>}
          </h2>
        </div>
        {/* Pas de résumé IA ici : il décrivait le texte tel que déposé, alors que le
            vote comparé porte souvent sur la version finale réécrite. La carte s'en
            tient au titre officiel du scrutin et renvoie à la page de ce vote, qui
            existe toujours : le quiz ne tire que des scrutins à liste nominative. */}
        <div className="flex flex-col gap-1.5">
          <Button
            asChild
            variant="outline"
            className="self-start rounded-full gap-1.5 h-7 px-2.5 text-xs border-gold/40 bg-gold/5 text-gold hover:bg-gold/10 hover:border-gold/60"
          >
            <Link
              href={`/Scrutins/${question.scrutinUid}`}
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('voirVote')}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
      </div>
      <CardFooter className="flex-col gap-3 border-t bg-muted/20">
        <RadioGroup
          className="w-full grid-cols-3 gap-3"
          defaultValue={defaultAnswer}
          onValueChange={handleValueChange}
        >
          {options.map((option) => {
            const Icon = option.icon
            return (
              <Label
                key={option.value}
                htmlFor={`answer-${option.value}`}
                className={cn(
                  'flex flex-col items-center justify-center gap-2 rounded-xl border-2 p-4 cursor-pointer text-center transition-colors',
                  option.value === 'pour' &&
                    'border-primary/25 bg-primary/5 hover:bg-primary/10 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/15',
                  option.value === 'contre' &&
                    'border-destructive/25 bg-destructive/5 hover:bg-destructive/10 has-[[data-state=checked]]:border-destructive has-[[data-state=checked]]:bg-destructive/15',
                  option.value === 'abstention' &&
                    'border-gold/25 bg-gold/5 hover:bg-gold/10 has-[[data-state=checked]]:border-gold has-[[data-state=checked]]:bg-gold/15',
                )}
              >
                <RadioGroupItem value={option.value} id={`answer-${option.value}`} disabled={!!exiting} className="sr-only" />
                <Icon
                  className={cn(
                    'h-6 w-6',
                    option.value === 'pour' && 'text-primary',
                    option.value === 'contre' && 'text-destructive',
                    option.value === 'abstention' && 'text-gold',
                  )}
                />
                <span className="text-sm sm:text-base font-semibold">{option.label}</span>
              </Label>
            )
          })}
        </RadioGroup>
        <button
          type="button"
          onClick={handlePass}
          disabled={!!exiting}
          className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors disabled:opacity-0 disabled:pointer-events-none"
        >
          {t('answerPass')}
        </button>
      </CardFooter>
    </Card>
  )
}
