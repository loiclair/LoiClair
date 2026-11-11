'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useQuizProcessusResult } from '@/hooks/useQuizProcessusResult'
import { cn } from '@/lib/utils'
import {
  drawQuizProcessusRound,
  computeQuizProcessusScore,
  QUIZ_PROCESSUS_TOTAL,
  type QuizProcessusRoundQuestion,
  type QuizProcessusAnswerRecord,
  type QuizProcessusScore,
} from '@/lib/quiz-processus'
import type { QuizProcessusQuestion } from '@/lib/quiz-processus-pool'
import { useRouter } from '@/i18n/navigation'
import QuizProcessusQuestionCard from './QuizProcessusQuestionCard'
import QuizProcessusResultView from './QuizProcessusResultView'

type Phase = 'intro' | 'question' | 'result'

// Centre le contenu verticalement dans le viewport disponible sous la nav
// (4.5rem + 6px, cf. AppShell) — même pattern que le quiz d'affinité.
const PHASE_WRAPPER = 'max-w-2xl mx-auto min-h-[calc(100dvh-4.5rem-6px)] flex flex-col justify-center'

type Props = {
  /** Pool de la langue de la page, choisi côté serveur. */
  pool: QuizProcessusQuestion[]
  poolFingerprint: string
}

export default function QuizProcessusClient({ pool, poolFingerprint }: Props) {
  const t = useTranslations('quizProcessus')
  const router = useRouter()
  const { data: savedResult, setResult, clear } = useQuizProcessusResult()
  const [phase, setPhase] = useState<Phase>('intro')
  const [round, setRound] = useState<QuizProcessusRoundQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<QuizProcessusAnswerRecord[]>([])
  const [score, setScore] = useState<QuizProcessusScore | null>(null)

  // Un résultat déjà enregistré (localStorage) → on le montre directement au
  // lieu de l'intro, sans jamais interrompre une partie déjà en cours. Si le
  // pool de questions a changé depuis (ajout/retrait), le résultat ne
  // correspond plus forcément aux questions actuelles : on l'efface plutôt
  // que de l'afficher désynchronisé.
  useEffect(() => {
    if (!savedResult) return
    if (savedResult.questionSetFingerprint !== poolFingerprint) {
      clear()
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- réagit à un changement de localStorage (source externe)
    setScore(savedResult)
    setAnswers(savedResult.answers ?? [])
    setPhase((p) => (p === 'intro' ? 'result' : p))
  }, [savedResult, clear, poolFingerprint])

  const handleStart = useCallback(() => {
    setRound(drawQuizProcessusRound(pool))
    setIndex(0)
    setAnswers([])
    setPhase('question')
  }, [pool])

  const handleAnswer = useCallback(
    (selectedIndex: number) => {
      const question = round[index]
      const nextAnswers = [
        ...answers,
        {
          questionId: question.id,
          ordrePropositions: question.ordrePropositions,
          reponseCorrecteIndex: question.reponseCorrecteIndex,
          userAnswerIndex: selectedIndex,
          isCorrect: selectedIndex === question.reponseCorrecteIndex,
        },
      ]
      setAnswers(nextAnswers)
      if (index + 1 < round.length) {
        setIndex(index + 1)
        return
      }
      const computed = computeQuizProcessusScore(nextAnswers)
      setScore(computed)
      setResult(computed, nextAnswers, poolFingerprint)
      setPhase('result')
    },
    [index, answers, round, setResult, poolFingerprint],
  )

  const handleRetry = useCallback(() => {
    setPhase('intro')
  }, [])

  const handleQuit = useCallback(() => {
    router.push('/Quiz')
  }, [router])

  if (phase === 'intro') {
    return (
      <div className={cn(PHASE_WRAPPER, 'items-center text-center gap-6 py-10')}>
        <h1 className="text-2xl md:text-3xl font-bold text-balance">{t('introTitle')}</h1>
        <p className="text-muted-foreground text-base">{t('introDescription')}</p>
        <Button size="lg" onClick={handleStart}>
          {t('introStartCta')}
        </Button>
      </div>
    )
  }

  if (phase === 'question') {
    const question = round[index]
    return (
      <div className={cn(PHASE_WRAPPER, 'justify-start gap-6 py-8')}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {t('questionCounter', { current: index + 1, total: QUIZ_PROCESSUS_TOTAL })}
            </span>
            <button
              type="button"
              onClick={handleQuit}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('quitCta')}
            </button>
          </div>
          <Progress value={((index + 1) / QUIZ_PROCESSUS_TOTAL) * 100} />
        </div>
        <QuizProcessusQuestionCard key={question.id} question={question} onAnswer={handleAnswer} />
      </div>
    )
  }

  if (!score) return null

  return (
    <div className={cn(PHASE_WRAPPER, 'justify-start pt-16 pb-8')}>
      <QuizProcessusResultView score={score} answers={answers} pool={pool} onRetry={handleRetry} />
    </div>
  )
}
