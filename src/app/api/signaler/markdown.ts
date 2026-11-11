/**
 * Neutralise le texte d'un visiteur avant qu'il entre dans le corps Markdown
 * d'une issue GitHub publique (`route.ts` de `/api/signaler`).
 *
 * Laissé tel quel, ce texte serait interprété : une mention `@quelqu'un` notifie
 * ce compte GitHub, une image `![](…)` est chargée par chaque lecteur de l'issue,
 * un lien peut se déguiser. Dans un bloc de code ou un code en ligne, GitHub
 * n'active ni mention, ni lien, ni image, ni balise HTML : le texte s'affiche
 * tel que le visiteur l'a écrit. Aucun échappement HTML ici, il s'afficherait
 * en `&lt;` à l'intérieur du code.
 */

/** Longueur de la plus longue suite d'accents graves du texte. */
function plusLongueSuiteDAccentsGraves(texte: string): number {
  return Math.max(0, ...(texte.match(/`+/g) ?? []).map(s => s.length))
}

/**
 * Bloc de code clôturé. La clôture est plus longue que toute suite d'accents
 * graves du texte : sinon une ligne de « ``` » saisie par le visiteur fermerait
 * le bloc, et la suite redeviendrait du Markdown actif.
 */
export function blocDeCode(texte: string): string {
  const cloture = '`'.repeat(Math.max(3, plusLongueSuiteDAccentsGraves(texte) + 1))
  return `${cloture}text\n${texte}\n${cloture}`
}

/**
 * Code en ligne, sur une seule ligne. Même règle de délimiteur que le bloc ; les
 * espaces ajoutées autour quand le texte commence ou finit par un accent grave
 * sont celles que la spécification CommonMark retire à l'affichage.
 */
export function codeEnLigne(texte: string): string {
  const ligne = texte.replace(/\s+/g, ' ')
  const delimiteur = '`'.repeat(plusLongueSuiteDAccentsGraves(ligne) + 1)
  const marge = ligne.startsWith('`') || ligne.endsWith('`') ? ' ' : ''
  return `${delimiteur}${marge}${ligne}${marge}${delimiteur}`
}
