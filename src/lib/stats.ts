// Helpers statistiques partagés — utilisés par les pages /Facts/*, /etat-des-lieux et le serveur MCP.
//
// `mean` arrondit à l'entier, et c'est voulu : les grands chiffres des articles, les
// tuiles du tableau de bord et les boîtes à moustaches affichent tous des moyennes entières,
// et tirent le même nombre de cette fonction. Une moyenne à décimale se calcule à part
// plutôt qu'en retirant cet arrondi, qui changerait le format de tous ces écrans.

export const mean = (arr: number[]): number => {
  if (arr.length === 0) return 0
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
}

export const percentile = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

export const median = (arr: number[]): number => Math.round(percentile(arr, 0.5))

/**
 * Les sept valeurs d'une ligne de `BoxPlotChart`, toutes arrondies à l'entier ;
 * chaque page y ajoute `label` et `countLabel`.
 *
 * Écrit une fois pour les cinq pages à boîtes à moustaches (âge, amendements,
 * délais, loyauté, participation), qui en tenaient chacune une copie. Une page dont
 * le grand chiffre vient d'un helper remplace `mean` par ce chiffre, pour que la
 * boîte et la réponse ne puissent pas diverger.
 */
export const boxStats = (arr: number[]) => ({
  min: arr.length ? Math.round(Math.min(...arr)) : 0,
  q1: Math.round(percentile(arr, 0.25)),
  median: median(arr),
  q3: Math.round(percentile(arr, 0.75)),
  max: arr.length ? Math.round(Math.max(...arr)) : 0,
  mean: mean(arr),
  count: arr.length,
})
