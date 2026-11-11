// Calcul pur du classement d'affinité : compare les réponses de l'utilisateur
// à la position majoritaire de chaque groupe sur les mêmes scrutins.
// Appelé par `AffiniteQuizClient` (fin de partie) ; les seuils et les ex æquo
// sont aussi relus par `QuizResultView` et `QuizHubCard` sur un résultat
// sauvegardé, pour qu'un résultat enregistré avant ces règles les respecte.

import type { QuizAffinitePosition, QuizAffiniteGroupe, QuizAffiniteQuestion } from "@/lib/quiz-affinite-queries"

export type QuizAnswers = Record<string, QuizAffinitePosition>

/** Réponse de l'utilisateur pendant le quiz : une position réelle, ou 'pass'
 * s'il choisit de ne pas se prononcer (exclu du calcul d'affinité). */
export type QuizUserAnswer = QuizAffinitePosition | "pass"
export type QuizUserAnswers = Record<string, QuizUserAnswer>

export type QuizRankingEntry = {
  groupeUid: string
  percent: number
  /** Nombre de réponses identiques à la position majoritaire du groupe. */
  matched: number
  /** Nombre de scrutins comparables (le groupe avait une position dessus). */
  total: number
}

/** En dessous de ce nombre de réponses (questions passées exclues), aucun
 * résultat : sur deux ou trois votes, un groupe peut afficher 100 % par hasard. */
export const QUIZ_MIN_REPONSES = 10

/** Un groupe n'est classé que s'il a pris position sur au moins ce nombre de
 * questions auxquelles l'utilisateur a répondu. Sans ce plancher, un groupe
 * dont la position n'est connue que sur deux scrutins pouvait passer en tête
 * avec 100 %, le dénominateur étant propre à chaque groupe. */
export const QUIZ_MIN_COMPARABLES = 10

/** Nombre de réponses réelles, les questions passées ne comptant pas. */
export function nombreReponses(answers: QuizUserAnswers): number {
  return Object.values(answers).filter((a) => a !== "pass").length
}

/**
 * Applique les deux seuils à un classement déjà calculé : vide sous
 * `QUIZ_MIN_REPONSES` réponses, et sans les groupes sous `QUIZ_MIN_COMPARABLES`
 * questions comparables. Séparé de `computeAffinite` parce qu'un résultat
 * sauvegardé ne garde que le classement et les réponses, pas les questions.
 */
export function appliquerSeuils(ranking: QuizRankingEntry[], reponses: number): QuizRankingEntry[] {
  if (reponses < QUIZ_MIN_REPONSES) return []
  return ranking.filter((entry) => entry.total >= QUIZ_MIN_COMPARABLES)
}

/** Les groupes à égalité en tête, au pourcentage affiché : deux groupes lus à
 * 76 % sont présentés ensemble, jamais l'un devant l'autre par l'ordre des uid. */
export function groupesEnTete(ranking: QuizRankingEntry[]): QuizRankingEntry[] {
  const top = ranking[0]
  if (!top) return []
  return ranking.filter((entry) => entry.percent === top.percent)
}

/** Libellés joints selon la langue (« A et B », « A, B and C ») : sert aux
 * ex æquo, dans le résultat, le hub, la page partagée et son image. */
export function joindreLibelles(libelles: string[], locale: string): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(libelles)
}

export function computeAffinite(
  answers: QuizAnswers,
  questions: QuizAffiniteQuestion[],
  groupes: QuizAffiniteGroupe[],
): QuizRankingEntry[] {
  const reponses = questions.filter((question) => answers[question.scrutinUid]).length
  const ranking = groupes
    .map((groupe) => {
      let matched = 0
      let comparable = 0
      for (const question of questions) {
        const userAnswer = answers[question.scrutinUid]
        const groupePosition = question.positions[groupe.uid]
        if (!userAnswer || !groupePosition) continue
        comparable++
        if (userAnswer === groupePosition) matched++
      }
      const percent = comparable > 0 ? Math.round((matched / comparable) * 100) : 0
      return { groupeUid: groupe.uid, percent, matched, total: comparable }
    })
    .sort((a, b) => b.percent - a.percent)
  return appliquerSeuils(ranking, reponses)
}
