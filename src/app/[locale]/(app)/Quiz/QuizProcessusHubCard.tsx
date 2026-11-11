'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Landmark } from 'lucide-react'
import { useQuizProcessusResult } from '@/hooks/useQuizProcessusResult'
import QuizCard from './QuizCard'

// L'empreinte arrive en prop et n'est pas importée : la calculer ici tirerait le
// pool de 60 questions dans le bundle de la page hub, qui n'en affiche aucune.
export default function QuizProcessusHubCard({ poolFingerprint }: { poolFingerprint: string }) {
  const t = useTranslations('quizProcessus')
  const { data, clear } = useQuizProcessusResult()
  const [wasStale, setWasStale] = useState(false)

  // Le pool de questions peut changer (ajout/retrait) : un résultat sauvegardé
  // qui ne correspond plus au pool actuel est effacé, avec un message
  // expliquant pourquoi.
  useEffect(() => {
    if (data && data.questionSetFingerprint !== poolFingerprint) {
      clear()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réagit à un changement de localStorage (source externe)
      setWasStale(true)
    }
  }, [data, clear, poolFingerprint])

  const hasResult = !!data

  return (
    <QuizCard
      icon={Landmark}
      accent="gold"
      title={t('hubCardTitle')}
      description={t('hubCardDescription')}
      countLabel={t('hubCardMetaCount')}
      durationLabel={t('hubCardMetaDuration')}
      href="/Quiz/processus-legislatif"
      hasResult={hasResult}
      resultSummary={hasResult ? t('hubResultSummary', { score: data.score, total: data.total }) : undefined}
      notice={wasStale ? t('hubResultStaleNotice') : undefined}
      ctaLabel={t('hubCardCta')}
      viewResultLabel={t('hubViewResultCta')}
      retryLabel={t('resultRetryCta')}
      deleteLabel={t('hubDeleteResultCta')}
      onRetry={clear}
      onDelete={clear}
    />
  )
}
