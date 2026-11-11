'use client'

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Vote } from 'lucide-react'
import { useQuizResults } from '@/hooks/useQuizResults'
import { appliquerSeuils, groupesEnTete, joindreLibelles, nombreReponses } from '@/lib/quiz-affinite'
import type { QuizAffiniteGroupe } from '@/lib/quiz-affinite-queries'
import QuizCard from './QuizCard'

// Carte du quiz d'affinité sur le hub `/Quiz` : invitation à jouer, ou rappel du
// dernier résultat enregistré dans le navigateur. Rendue par `Quiz/page.tsx`.

export default function QuizHubCard({
  groupes,
  currentFingerprint,
}: {
  groupes: QuizAffiniteGroupe[]
  currentFingerprint: string
}) {
  const t = useTranslations('quiz')
  const locale = useLocale()
  const { data, clear } = useQuizResults()
  const [wasStale, setWasStale] = useState(false)

  // Le script mensuel de sélection des scrutins peut changer les questions du
  // quiz : un résultat sauvegardé qui ne correspond plus à la sélection
  // actuelle est effacé, avec un message expliquant pourquoi.
  useEffect(() => {
    if (data && data.questionSetFingerprint !== currentFingerprint) {
      clear()
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réagit à un changement de localStorage (source externe) via useQuizResults
      setWasStale(true)
    }
  }, [data, currentFingerprint, clear])

  // Mêmes règles que l'écran de résultat : seuils réappliqués au classement
  // sauvegardé, et groupes à égalité en tête nommés ensemble. Sans résultat
  // (trop peu de réponses), la carte se présente comme un quiz non fait.
  const enTete = data ? groupesEnTete(appliquerSeuils(data.ranking, nombreReponses(data.answers ?? {}))) : []
  const top = enTete[0]
  const topGroupes = enTete
    .map((entry) => groupes.find((g) => g.uid === entry.groupeUid))
    .filter((g): g is QuizAffiniteGroupe => g !== undefined)
  const hasResult = !!top && topGroupes.length > 0

  return (
    <QuizCard
      icon={Vote}
      accent="primary"
      title={t('hubCardTitle')}
      description={t('hubCardDescription')}
      countLabel={t('hubCardMetaCount')}
      durationLabel={t('hubCardMetaDuration')}
      href="/Quiz/affinite"
      hasResult={hasResult}
      resultSummary={hasResult
        ? t('hubResultSummary', { groupe: joindreLibelles(topGroupes.map((g) => g.libelle), locale), percent: top.percent })
        : undefined}
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
