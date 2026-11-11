// Choix du pool de questions du quiz « Processus législatif » selon la langue,
// et empreinte de ce pool.
//
// **Ce module n'est importé que par des Server Components.** Il tient les deux
// pools en mémoire (60 questions chacun) : importé depuis un composant client,
// la ternaire ne serait pas éliminable statiquement et les deux langues
// partiraient chez tous les visiteurs. Les pages `/Quiz` et
// `/Quiz/processus-legislatif` ont déjà `locale`, résolvent ici, et passent le
// résultat en prop.

import { QUIZ_PROCESSUS_POOL, type QuizProcessusQuestion } from '@/lib/quiz-processus-pool'
import { QUIZ_PROCESSUS_POOL_EN } from '@/lib/quiz-processus-pool.en'
import { computeQuestionSetFingerprint } from '@/lib/quiz-utils'

export function poolQuizProcessus(locale: string): QuizProcessusQuestion[] {
  return locale === 'en' ? QUIZ_PROCESSUS_POOL_EN : QUIZ_PROCESSUS_POOL
}

/**
 * Empreinte du pool (les 60 `id`, ordre indifférent). Un résultat sauvegardé
 * avec une empreinte différente a été joué sur un autre jeu de questions.
 *
 * Calculée sur le pool français seul : les deux pools portent les mêmes `id`,
 * donc changer de langue en cours de route ne périme pas un résultat.
 */
export const QUIZ_PROCESSUS_POOL_FINGERPRINT = computeQuestionSetFingerprint(
  QUIZ_PROCESSUS_POOL.map((q) => q.id),
)
