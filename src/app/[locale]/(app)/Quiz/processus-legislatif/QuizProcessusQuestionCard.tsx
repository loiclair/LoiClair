'use client'

// Carte d'une question du quiz « Processus législatif », rendue par
// `QuizProcessusClient` pour la question en cours. Reçoit la question déjà
// mélangée (`drawQuizProcessusRound`) et remonte l'indice choisi via `onAnswer`.

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Check, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { QuizProcessusRoundQuestion } from '@/lib/quiz-processus'

// Le score est verrouillé au premier clic (pas de retry qui le fausserait) —
// bonne réponse : avance auto après une courte confirmation visuelle.
const CORRECT_AUTO_ADVANCE_MS = 900

export default function QuizProcessusQuestionCard({
  question,
  onAnswer,
}: {
  question: QuizProcessusRoundQuestion
  onAnswer: (selectedIndex: number) => void
}) {
  const t = useTranslations('quizProcessus')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const timeoutRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== undefined) window.clearTimeout(timeoutRef.current)
    }
  }, [])

  const isCorrectSelection = selectedIndex === question.reponseCorrecteIndex
  const locked = selectedIndex !== null

  const handleSelect = (index: number) => {
    if (locked) return
    setSelectedIndex(index)
    if (index === question.reponseCorrecteIndex) {
      timeoutRef.current = window.setTimeout(() => onAnswer(index), CORRECT_AUTO_ADVANCE_MS)
    }
  }

  const handleContinue = () => onAnswer(selectedIndex as number)

  return (
    <Card className="quiz-card-enter p-6 flex flex-col gap-4">
      <h2 className="text-lg font-semibold leading-snug text-balance">{question.enonce}</h2>

      <div role="radiogroup" aria-label={question.enonce} className="flex flex-col gap-2.5">
        {question.propositions.map((proposition, index) => {
          const isSelected = selectedIndex === index
          const isCorrectOption = index === question.reponseCorrecteIndex
          const revealCorrect = locked && !isCorrectSelection && isCorrectOption

          return (
            <button
              key={proposition}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={locked}
              onClick={() => handleSelect(index)}
              className={cn(
                'flex items-start justify-between gap-3 rounded-xl border-2 p-3.5 text-left text-sm sm:text-base transition-colors',
                !locked && 'border-border bg-background hover:border-primary/40 hover:bg-primary/5 cursor-pointer',
                locked && !isSelected && !revealCorrect && 'border-border bg-background opacity-50',
                (isSelected && isCorrectOption) || revealCorrect
                  ? 'border-emerald-500 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200'
                  : '',
                isSelected && !isCorrectOption && 'border-destructive bg-destructive/10 text-destructive',
                'disabled:cursor-default',
              )}
            >
              <span className="font-medium">{proposition}</span>
              {/* Emplacement toujours réservé (même vide) pour que le texte ne se
                  redistribue pas au moment où l'icône apparaît, une fois verrouillé. */}
              <span className="h-5 w-5 shrink-0 flex items-center justify-center">
                {(isSelected && isCorrectOption) || revealCorrect ? (
                  <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                ) : isSelected && !isCorrectOption ? (
                  <X className="h-5 w-5 text-destructive" />
                ) : null}
              </span>
            </button>
          )
        })}
      </div>

      {locked && !isCorrectSelection && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <Button type="button" onClick={handleContinue} className="self-start">
            {t('continueCta')}
          </Button>
          <p className="text-sm text-foreground/80">{question.explication}</p>
          {/* Seulement après une mauvaise réponse : une bonne réponse passe seule
              à la suite au bout de 900 ms, trop tôt pour cliquer un lien. Les
              sources des bonnes réponses restent dans le détail des réponses. */}
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
      )}
    </Card>
  )
}
