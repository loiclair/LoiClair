// Utilitaire partagé entre les quiz (affinité, processus législatif).

/** Identifiant stable d'un ensemble de questions (ordre indifférent) : permet
 * de détecter qu'un résultat sauvegardé en localStorage correspond à une
 * sélection de questions différente de celle actuellement servie. */
export function computeQuestionSetFingerprint(questionIds: string[]): string {
  return [...questionIds].sort().join(",")
}
