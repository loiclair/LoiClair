// Logique pure du quiz "Processus législatif" : tirage d'une partie depuis le
// pool statique, mélange des propositions, calcul du score. Pas de lecture en base
// ici (synchrone), donc pas de fichier `-queries.ts` séparé comme pour le
// quiz d'affinité.

// `import type` et non un import de valeur : ce module est chargé par les
// composants client du quiz, et importer le pool ici l'embarquerait dans leur
// bundle. Le pool est choisi côté serveur (`quiz-processus-selection.ts`) et
// arrive en prop.
import type { QuizProcessusDifficulte, QuizProcessusQuestion, QuizProcessusSource } from '@/lib/quiz-processus-pool'

export const QUIZ_PROCESSUS_ROUND_SIZE: Record<QuizProcessusDifficulte, number> = {
  facile: 8,
  moyen: 7,
  difficile: 5,
}
export const QUIZ_PROCESSUS_TOTAL = 20

export type QuizProcessusRoundQuestion = {
  id: string
  difficulte: QuizProcessusDifficulte
  enonce: string
  propositions: string[]
  /** Ordre de tirage : `ordrePropositions[n]` est l'indice, dans le pool, de la
   *  proposition affichée en position n. C'est ce qui est enregistré, plutôt
   *  que le texte, pour que le détail des réponses suive la langue de la page. */
  ordrePropositions: number[]
  reponseCorrecteIndex: number
  explication: string
  source: QuizProcessusSource
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function shuffleQuestion(question: QuizProcessusQuestion): QuizProcessusRoundQuestion {
  // On mélange les indices et non les textes : l'ordre tiré doit rester
  // enregistrable sans dépendre de la langue dans laquelle la partie a été jouée.
  const ordrePropositions = shuffle(question.propositions.map((_, i) => i))
  return {
    id: question.id,
    difficulte: question.difficulte,
    enonce: question.enonce,
    propositions: ordrePropositions.map((i) => question.propositions[i]),
    ordrePropositions,
    reponseCorrecteIndex: ordrePropositions.indexOf(question.reponseCorrecteIndex),
    explication: question.explication,
    source: question.source,
  }
}

/** Tire 8 questions faciles / 7 moyennes / 5 difficiles, mélange leur ordre
 * et l'ordre des propositions de chacune. */
export function drawQuizProcessusRound(pool: QuizProcessusQuestion[]): QuizProcessusRoundQuestion[] {
  const byDifficulte = (difficulte: QuizProcessusDifficulte) =>
    shuffle(pool.filter((q) => q.difficulte === difficulte)).slice(0, QUIZ_PROCESSUS_ROUND_SIZE[difficulte])

  const selection = [...byDifficulte('facile'), ...byDifficulte('moyen'), ...byDifficulte('difficile')]
  return shuffle(selection).map(shuffleQuestion)
}

/**
 * Une réponse telle qu'elle est enregistrée dans le `localStorage`. Rien de
 * textuel ici : l'énoncé et les propositions sont retrouvés dans le pool de la
 * langue courante à partir de `questionId` et de `ordrePropositions`, sinon une
 * partie jouée en français se relirait en français sur la version anglaise.
 */
export type QuizProcessusAnswerRecord = {
  questionId: string
  /** Indices des propositions dans l'ordre où elles ont été présentées. */
  ordrePropositions: number[]
  reponseCorrecteIndex: number
  userAnswerIndex: number
  isCorrect: boolean
}

export type QuizProcessusScore = {
  score: number
  total: number
}

export function computeQuizProcessusScore(answers: QuizProcessusAnswerRecord[]): QuizProcessusScore {
  return { score: answers.filter((a) => a.isCorrect).length, total: answers.length }
}

export type QuizProcessusTierKey = 'debutant' | 'eclaire' | 'expert' | 'connaisseur'

export type QuizProcessusTier = {
  key: QuizProcessusTierKey
  color: string
}

// Paliers de score de la plaque de résultat — couleurs reprises de la palette
// de marque (--muted-foreground, --primary, --gold, --foreground, cf.
// globals.css) plutôt que des couleurs neuves, du plus neutre au plus valorisant.
const QUIZ_PROCESSUS_TIERS: (QuizProcessusTier & { minScore: number })[] = [
  { key: 'debutant', color: '#A8A29E', minScore: 0 },
  { key: 'eclaire', color: '#06B6D4', minScore: 8 },
  { key: 'expert', color: '#D4A54A', minScore: 14 },
  { key: 'connaisseur', color: '#1C1917', minScore: 18 },
]

// Clés i18n (namespace `quizProcessus`) associées à chaque palier — centralisées
// ici pour être partagées entre l'écran de résultat et la page résultat partagée.
export const QUIZ_PROCESSUS_TIER_LABEL_KEYS: Record<QuizProcessusTierKey, string> = {
  debutant: 'tierDebutantLabel',
  eclaire: 'tierEclaireLabel',
  expert: 'tierExpertLabel',
  connaisseur: 'tierConnaisseurLabel',
}

export const QUIZ_PROCESSUS_TIER_MESSAGE_KEYS: Record<QuizProcessusTierKey, string> = {
  debutant: 'tierDebutantMessage',
  eclaire: 'tierEclaireMessage',
  expert: 'tierExpertMessage',
  connaisseur: 'tierConnaisseurMessage',
}

export function resolveQuizProcessusTier(score: number): QuizProcessusTier {
  let tier = QUIZ_PROCESSUS_TIERS[0]
  for (const candidate of QUIZ_PROCESSUS_TIERS) {
    if (score >= candidate.minScore) tier = candidate
  }
  return { key: tier.key, color: tier.color }
}

export type QuizProcessusSharedResult = { score: number; total: number }

/**
 * Valide un résultat partagé via URL (`?score=...`) : un entier entre 0 et
 * QUIZ_PROCESSUS_TOTAL. Utilisé par la page résultat partagée et l'image OG
 * dynamique — ce paramètre vient d'une URL publique modifiable, jamais de
 * valeur non validée ne doit atteindre le rendu.
 */
export function resolveQuizProcessusShareParams(scoreParam: string | null | undefined): QuizProcessusSharedResult | null {
  const score = scoreParam != null ? Number.parseInt(scoreParam, 10) : NaN
  if (!Number.isInteger(score) || score < 0 || score > QUIZ_PROCESSUS_TOTAL) return null
  return { score, total: QUIZ_PROCESSUS_TOTAL }
}
