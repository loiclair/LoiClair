/**
 * Résolution de couleur pour un groupe politique.
 *
 * - Assemblée nationale : la colonne `couleur_associee` de la table `organes`
 *   porte la couleur officielle publiée par l'open data AN. Les 12 groupes
 *   actifs sont couverts à 100 %.
 * - Sénat : l'open data Sénat ne publie pas ce champ. Les couleurs viennent du
 *   dessin de l'hémicycle de senat.fr, recopiées dans `COULEURS_GROUPES_SENAT`
 *   (`pipeline/_positions_groupe.py`) et écrites dans la même colonne par
 *   `import_acteurs_organes_cloud.py`. Les non-inscrits n'en ont pas.
 */

const FALLBACK_COLOR = '#A8A29E';

/**
 * Retourne la couleur à utiliser pour un groupe parlementaire.
 * En l'absence de `couleur_associee` en base (non-inscrits du Sénat, ancien
 * groupe du Sénat absent de la table), renvoie `defaultColor`, typiquement la
 * teinte de la page.
 *
 * @param couleurAssociee Valeur de `organes.couleur_associee`, si présente.
 * @param defaultColor    Couleur à utiliser sinon (typiquement la teinte de la page).
 */
export function resolveGroupeColor(
  couleurAssociee: string | null | undefined,
  defaultColor: string = FALLBACK_COLOR
): string {
  return couleurAssociee || defaultColor;
}

/**
 * Choisit noir ou blanc selon la luminance perçue (formule YIQ) d'une couleur
 * de groupe, pour garantir un contraste lisible sur un fond de cette couleur.
 */
export function getReadableTextColor(hex: string): string {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#1C1917' : '#FFFFFF';
}
