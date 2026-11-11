'use client'

// Déroulé du quiz d'affinité : intro (avec la méthode de sélection), questions,
// résultat. Reçoit de `page.tsx` les 20 scrutins de `quiz_affinite_scrutins` et
// les groupes ; le classement est calculé ici, dans le navigateur, par
// `computeAffinite`, et le résultat se garde en localStorage via `useQuizResults`.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useQuizResults } from '@/hooks/useQuizResults'
import { cn } from '@/lib/utils'
import {
  appliquerSeuils,
  computeAffinite,
  nombreReponses,
  type QuizAnswers,
  type QuizUserAnswer,
  type QuizUserAnswers,
  type QuizRankingEntry,
} from '@/lib/quiz-affinite'
import { computeQuestionSetFingerprint } from '@/lib/quiz-utils'
import type { QuizAffiniteGroupe, QuizAffiniteQuestion } from '@/lib/quiz-affinite-queries'
import { useRouter } from '@/i18n/navigation'
import QuizQuestionCard from './QuizQuestionCard'
import QuizResultView from './QuizResultView'

type Phase = 'intro' | 'question' | 'result'

// Centre le contenu verticalement dans le viewport disponible sous la nav
// (4.5rem + 6px, cf. AppShell) — appliqué aux 3 écrans du quiz.
const PHASE_WRAPPER = 'max-w-2xl mx-auto min-h-[calc(100dvh-4.5rem-6px)] flex flex-col justify-center'

export default function AffiniteQuizClient({
  questions,
  groupes,
}: {
  questions: QuizAffiniteQuestion[]
  groupes: QuizAffiniteGroupe[]
}) {
  const t = useTranslations('quiz')
  const router = useRouter()
  const { data: savedResult, setResult, clear } = useQuizResults()
  const [phase, setPhase] = useState<Phase>('intro')
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<QuizUserAnswers>({})
  const [ranking, setRanking] = useState<QuizRankingEntry[]>([])

  const currentFingerprint = useMemo(
    () => computeQuestionSetFingerprint(questions.map((q) => q.scrutinUid)),
    [questions],
  )

  // Un résultat déjà enregistré (localStorage) → on le montre directement au
  // lieu de l'intro, sans jamais interrompre une partie déjà en cours. Si la
  // sélection de scrutins a changé depuis (script mensuel), le résultat ne
  // correspond plus aux questions actuelles : on l'efface plutôt que de
  // l'afficher désynchronisé. Les seuils sont réappliqués au classement lu :
  // un résultat enregistré avant eux gardait tous les groupes. Une partie
  // terminée sans résultat (trop peu de réponses) se rouvre aussi sur l'écran
  // qui l'explique, d'où le test sur les réponses et non sur le classement.
  useEffect(() => {
    if (!savedResult) return
    if (savedResult.questionSetFingerprint !== currentFingerprint) {
      clear()
      return
    }
    const savedAnswers = savedResult.answers ?? {}
    if (Object.keys(savedAnswers).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réagit à un changement de localStorage (source externe) via useQuizResults
      setRanking(appliquerSeuils(savedResult.ranking, nombreReponses(savedAnswers)))
      setAnswers(savedAnswers)
      setPhase((p) => (p === 'intro' ? 'result' : p))
    }
  }, [savedResult, currentFingerprint, clear])

  const handleStart = useCallback(() => {
    setAnswers({})
    setIndex(0)
    setPhase('question')
  }, [])

  const handleAnswer = useCallback(
    (position: QuizUserAnswer) => {
      const question = questions[index]
      const nextAnswers = { ...answers, [question.scrutinUid]: position }
      setAnswers(nextAnswers)
      if (index + 1 < questions.length) {
        setIndex(index + 1)
        return
      }
      // Les questions passées sont exclues du calcul (ni matched ni comparable).
      const scoringAnswers = Object.fromEntries(
        Object.entries(nextAnswers).filter(([, value]) => value !== 'pass'),
      ) as QuizAnswers
      const computed = computeAffinite(scoringAnswers, questions, groupes)
      setRanking(computed)
      setResult(computed, nextAnswers, currentFingerprint)
      setPhase('result')
    },
    [index, answers, questions, groupes, setResult, currentFingerprint],
  )

  const handleBack = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1))
  }, [])

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
        {/* Dit avant la première question, parce que le site utilise l'IA ailleurs
            et qu'on peut la croire derrière le classement, alors que
            `computeAffinite` ne fait que compter les votes concordants. */}
        <p className="text-muted-foreground text-sm">{t('introNoAi')}</p>
        <Button size="lg" onClick={handleStart}>
          {t('introStartCta')}
        </Button>
        {/* Méthode de sélection, visible avant de répondre : c'est elle qui dit
            pourquoi ces 20 questions et pas d'autres. Le texte décrit les règles
            de `pipeline/select_quiz_scrutins.py` et se corrige avec lui. */}
        <section className="mt-4 border-t pt-6 text-left max-w-md">
          <h2 className="font-semibold text-foreground" style={{ fontSize: '0.875rem', lineHeight: 1.4 }}>
            {t('methodTitle')}
          </h2>
          <p className="mt-2 text-muted-foreground" style={{ fontSize: '0.875rem', lineHeight: 1.6 }}>
            {t('methodBody')}
          </p>
        </section>
      </div>
    )
  }

  if (phase === 'question') {
    const question = questions[index]
    return (
      <div className={cn(PHASE_WRAPPER, 'gap-6 py-8')}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleBack}
                disabled={index === 0}
                aria-label={t('previousQuestion')}
                className="rounded-full p-1 -ml-1 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-0 disabled:pointer-events-none transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-sm text-muted-foreground">
                {t('questionCounter', { current: index + 1, total: questions.length })}
              </span>
            </div>
            <button
              type="button"
              onClick={handleQuit}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('quitCta')}
            </button>
          </div>
          <Progress value={((index + 1) / questions.length) * 100} />
        </div>
        <QuizQuestionCard
          key={question.scrutinUid}
          question={question}
          defaultAnswer={answers[question.scrutinUid]}
          onAnswer={handleAnswer}
        />
      </div>
    )
  }

  return (
    <div className={cn(PHASE_WRAPPER, 'justify-start pt-16 pb-8')}>
      <QuizResultView
        ranking={ranking}
        groupes={groupes}
        questions={questions}
        answers={answers}
        onRetry={handleRetry}
      />
    </div>
  )
}
