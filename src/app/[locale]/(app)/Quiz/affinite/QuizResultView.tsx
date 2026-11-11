'use client'

import { useEffect, useRef } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { GroupeBarChart } from '@/components/ui/GroupeBarChart'
import { GroupLogoImage } from '@/components/ui/GroupLogoImage'
import ShareButton from '@/components/ShareButton'
import { buildShareUrl } from '@/lib/share-url'
import { getReadableTextColor } from '@/lib/groupe-colors'
import { cn } from '@/lib/utils'
import {
  QUIZ_MIN_COMPARABLES,
  QUIZ_MIN_REPONSES,
  groupesEnTete,
  joindreLibelles,
  nombreReponses,
  type QuizRankingEntry,
  type QuizUserAnswers,
} from '@/lib/quiz-affinite'
import type { QuizAffiniteGroupe, QuizAffiniteQuestion } from '@/lib/quiz-affinite-queries'
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements'

// Teinte de la plaque quand plusieurs groupes sont à égalité : prendre la couleur
// de l'un d'eux le mettrait visuellement devant les autres. C'est l'accent du
// graphique de détail ci-dessous.
const COULEUR_EX_AEQUO = '#06B6D4'

// Même code couleur que les boutons de réponse du quiz (QuizQuestionCard) :
// pour = primary, contre = destructive, abstention = gold.
const POSITION_BADGE_CLASSES = {
  pour: 'border-primary/30 bg-primary/10 text-primary',
  contre: 'border-destructive/30 bg-destructive/10 text-destructive',
  abstention: 'border-gold/30 bg-gold/10 text-gold',
} as const

/**
 * Écran de résultat du quiz d'affinité, rendu par `AffiniteQuizClient`.
 * `ranking` arrive déjà filtré par les seuils de `lib/quiz-affinite.ts` : vide,
 * il n'y a pas de résultat, et l'écran dit pourquoi au lieu d'afficher un
 * groupe. Les groupes à égalité en tête partagent la plaque et le partage.
 */
export default function QuizResultView({
  ranking,
  groupes,
  questions,
  answers,
  onRetry,
}: {
  ranking: QuizRankingEntry[]
  groupes: QuizAffiniteGroupe[]
  questions: QuizAffiniteQuestion[]
  answers: QuizUserAnswers
  onRetry: () => void
}) {
  const t = useTranslations('quiz')
  const locale = useLocale()

  const groupesByUid = new Map(groupes.map((g) => [g.uid, g]))
  const enTete = groupesEnTete(ranking)
  const topGroupes = enTete
    .map((entry) => groupesByUid.get(entry.groupeUid))
    .filter((g): g is QuizAffiniteGroupe => g !== undefined)
  const top = enTete[0]
  const exAequo = topGroupes.length > 1
  const couleurPlaque = exAequo ? COULEUR_EX_AEQUO : topGroupes[0]?.couleur
  const libellesTete = joindreLibelles(topGroupes.map((g) => g.libelle), locale)
  const reponses = nombreReponses(answers)

  const shareUrl = top && topGroupes.length > 0
    ? buildShareUrl(locale, `/Quiz/affinite/resultat?g=${topGroupes.map((g) => g.uid).join(',')}&pct=${top.percent}`)
    : undefined
  const shareMessage = top && topGroupes.length > 0
    ? t('resultShareMessage', { groupe: libellesTete, percent: top.percent })
    : undefined

  const chartData = ranking
    .map((entry) => {
      const groupe = groupesByUid.get(entry.groupeUid)
      if (!groupe) return null
      return {
        groupe: groupe.libelleAbrege,
        value: entry.percent,
        fill: groupe.couleur,
        matched: entry.matched,
        total: entry.total,
      }
    })
    .filter((d): d is { groupe: string; value: number; fill: string; matched: number; total: number } => d !== null)

  const plaqueWrapRef = useRef<HTMLDivElement>(null)

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
      {top && couleurPlaque ? (
        <div
          ref={plaqueWrapRef}
          className="quiz-result-reveal quiz-plaque-perspective"
          style={{ '--gcolor': couleurPlaque } as React.CSSProperties}
        >
          <Card className="quiz-plaque flex flex-col items-center gap-3 rounded-[22px] border-0 p-10 text-center">
            <div className="quiz-plaque-wash" />
            <div className="quiz-plaque-frost" />
            <div className="quiz-plaque-sheen" />
            <div className="quiz-plaque-rim" />

            <div className="quiz-plaque-content relative z-10 flex flex-col items-center gap-2">
              <p className="text-lg text-foreground/60">
                {exAequo ? t('resultIntroPhraseTie') : t('resultIntroPhrase')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {topGroupes.map((g) => (
                  <div key={g.uid} className="rounded-lg border bg-white p-2">
                    <GroupLogoImage
                      groupeUid={g.uid}
                      imgStyle={{ height: 40, width: 'auto', maxWidth: 160 }}
                    />
                  </div>
                ))}
              </div>
              <h1 className="text-xl md:text-2xl font-bold text-balance">{libellesTete}</h1>
              <div
                className="mt-2 rounded-xl px-5 py-2.5"
                style={{ backgroundColor: couleurPlaque, color: getReadableTextColor(couleurPlaque) }}
              >
                <span className="text-xl font-extrabold">{top.percent}%</span>
                <span className="ml-1.5 text-xs font-semibold opacity-90">{t('resultBandLabel')}</span>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        // Pas de résultat : trop peu de réponses, ou aucun groupe n'a pris position
        // sur assez de questions répondues pour qu'un pourcentage veuille dire
        // quelque chose.
        <Card className="quiz-result-reveal flex flex-col items-center gap-2 p-8 text-center">
          <h1 className="font-bold text-balance" style={{ fontSize: '1.25rem', lineHeight: 1.3 }}>
            {t('resultNoResultTitle')}
          </h1>
          <p className="text-muted-foreground text-balance" style={{ fontSize: '0.9375rem', lineHeight: 1.6 }}>
            {reponses < QUIZ_MIN_REPONSES
              ? t('resultNotEnoughAnswers', { count: reponses, total: questions.length, min: QUIZ_MIN_REPONSES })
              : t('resultNoGroupRanked', { min: QUIZ_MIN_COMPARABLES })}
          </p>
        </Card>
      )}

      {shareUrl && (
        <div className="quiz-result-reveal-delay-1 mt-2 flex justify-center">
          <ShareButton url={shareUrl} message={shareMessage} label={t('resultShareCta')} />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        {questions.length > 0 && (
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
              <Tabs defaultValue="groupes">
                <TabsList className="w-full">
                  <TabsTrigger value="groupes" className="flex-1">
                    {t('resultTabGroupLabel')}
                  </TabsTrigger>
                  <TabsTrigger value="scrutins" className="flex-1">
                    {t('resultTabScrutinLabel')}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="groupes">
                  <p className="text-sm text-muted-foreground">
                    {t('resultChartSeuilNote', { min: QUIZ_MIN_COMPARABLES })}
                  </p>
                  {chartData.length > 0 && (
                    <GroupeBarChart
                      data={chartData}
                      title=""
                      description={t('resultChartDescription')}
                      color="#06B6D4"
                      valueLabel={t('resultChartValueLabel')}
                      xDomain={[0, 100]}
                      rowHeight={26}
                      minHeight={0}
                      animate={false}
                      renderValueLabel={(row) =>
                        t('resultChartBarLabel', { percent: row.value, matched: row.matched, total: row.total })
                      }
                    />
                  )}
                </TabsContent>

                <TabsContent value="scrutins" className="flex flex-col gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t('resultDetailDescription')}
                    {/* Un badge pour toute la liste des titres de scrutins traduits, sur /en. */}
                    {questions.some((q) => q.titreTraduit) && <span style={{ marginLeft: '8px', verticalAlign: '1px' }}><AIBadgeTitre pluriel /></span>}
                  </p>
                  {questions.map((question) => {
                    const userAnswer = answers[question.scrutinUid]
                    const hasAnswer = userAnswer && userAnswer !== 'pass'
                    const sameGroupes = hasAnswer
                      ? groupes.filter((g) => question.positions[g.uid] === userAnswer)
                      : []
                    const differentGroupes = hasAnswer
                      ? groupes.filter((g) => question.positions[g.uid] && question.positions[g.uid] !== userAnswer)
                      : groupes.filter((g) => question.positions[g.uid])

                    return (
                      <div key={question.scrutinUid} className="rounded-lg border p-3 flex flex-col gap-2">
                        <h3 className="text-sm font-semibold leading-snug text-balance">{question.titre}</h3>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-semibold text-muted-foreground">
                            {t('resultDetailYourAnswer')}
                          </span>
                          {hasAnswer ? (
                            <Badge variant="outline" className={cn(POSITION_BADGE_CLASSES[userAnswer])}>
                              {t(`answer${userAnswer === 'pour' ? 'Pour' : userAnswer === 'contre' ? 'Contre' : 'Abstention'}`)}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t('resultDetailPassed')}
                            </Badge>
                          )}
                        </div>
                        {hasAnswer && sameGroupes.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground">
                              {t('resultDetailAgreeLabel')}
                            </span>
                            {sameGroupes.map((groupe) => (
                              <Badge key={groupe.uid} variant="outline" className={POSITION_BADGE_CLASSES[userAnswer]}>
                                {groupe.libelleAbrege}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {differentGroupes.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-semibold text-muted-foreground">
                              {hasAnswer ? t('resultDetailDisagreeLabel') : t('resultDetailGroupsLabel')}
                            </span>
                            {differentGroupes.map((groupe) => (
                              <Badge
                                key={groupe.uid}
                                variant="outline"
                                className={POSITION_BADGE_CLASSES[question.positions[groupe.uid]]}
                              >
                                {groupe.libelleAbrege}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </TabsContent>
              </Tabs>
            </SheetContent>
          </Sheet>
        )}

        {questions.length > 0 && (
          <span className="text-muted-foreground/50" aria-hidden="true">
            ·
          </span>
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
          href="/Quiz"
          className="text-muted-foreground hover:text-foreground underline-offset-4 hover:underline transition-colors"
        >
          {t('resultBackToQuiz')}
        </Link>
      </div>
    </div>
  )
}
