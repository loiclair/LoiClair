/**
 * Le jour civil d'aujourd'hui, à Paris, et l'affichage d'un jour nu.
 *
 * Règle du projet pour les dates sans heure (dépôt d'un dossier, date d'un acte,
 * publication d'un article) :
 *   - elles se stockent en `date`, jamais en horodatage : un jour n'a pas de fuseau ;
 *   - un jour nu (`YYYY-MM-DD`) s'affiche avec `timeZone: 'UTC'`, car `new Date()` le
 *     lit comme minuit UTC, et tout autre fuseau à l'ouest de Greenwich afficherait
 *     la veille : `formatJourNu`, plus bas, le fait ;
 *   - « aujourd'hui » se calcule ici, à Paris, et jamais par
 *     `new Date().toISOString()`, qui rend le jour UTC : entre minuit et deux heures
 *     du matin à Paris, ce serait encore la veille.
 *
 * Utilisable côté serveur comme côté client : `Intl` fait la conversion.
 */

/**
 * Aujourd'hui à Paris, au format `YYYY-MM-DD`.
 *
 * Assemblé depuis `formatToParts` plutôt que lu dans le rendu d'une locale : ce
 * module tourne aussi dans le navigateur, dont les données de locale varient d'une
 * version à l'autre, alors que les composantes numériques, elles, ne bougent pas.
 */
export function aujourdhuiAParisIso(): string {
  const parties = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const val = (type: 'year' | 'month' | 'day') => parties.find((p) => p.type === type)?.value ?? '';
  return `${val('year')}-${val('month')}-${val('day')}`;
}

/**
 * Formate un jour nu, le même au serveur et dans tout navigateur.
 *
 * Reçoit `YYYY-MM-DD`, ou un horodatage dont seul le jour compte
 * (`2024-07-18T00:00:00`, sans fuseau, que `new Date` lirait en heure locale) :
 * ramené au jour nu puis formaté en UTC. Le serveur et le navigateur n'étant pas
 * forcément dans le même fuseau, tout autre chemin peut faire dire la veille ou le
 * lendemain à l'un des deux, et React lève l'erreur d'hydratation #418.
 * `locale` est passée telle quelle : à l'appelant de choisir `en-GB` ou `en`.
 * Passe par `formateurDate`, pour la même raison.
 */
export function formatJourNu(
  jour: string,
  locale: string,
  options: Omit<Intl.DateTimeFormatOptions, 'timeZone'>,
): string {
  return formateurDate(locale, { ...options, timeZone: 'UTC' }).format(new Date(jour.slice(0, 10)));
}

/**
 * Aligne septembre abrégé en anglais britannique, seul format qui diverge entre
 * le serveur et Safari.
 *
 * En `en-GB`, Node et Chrome écrivent `Sept`, Safari `Sep`. Une date rendue au
 * serveur ne correspond donc plus dans Safari : React lève l'erreur #418 et
 * reconstruit l'arbre. Comparés le 2026-11-05 sur douze mois et huit formats, en
 * `en-GB`, `fr-FR`, `en` et `fr`, seul ce mois diffère, dans les formats à mois
 * court. `Sep` garde les trois lettres des onze autres ; le français (`sept.`)
 * n'est pas touché.
 *
 * Le mot entier seulement : `formatJourNu` y fait aussi passer les mois longs, et
 * `September` deviendrait `Sepember`.
 */
const moisCourtStable = (date: string): string => date.replace(/\bSept\b/, 'Sep');

/**
 * Seule porte d'entrée d'un format à mois abrégé (`month: 'short'`,
 * `dateStyle: 'medium'`), à la place de `Intl.DateTimeFormat` ou de
 * `toLocaleDateString`. La règle `no-restricted-syntax` de `eslint.config.mjs`
 * refuse ces formats écrits à la main : un oubli ramènerait l'erreur #418 dans
 * Safari, sans que rien d'autre le signale. Rend un objet `format`, comme
 * `Intl.DateTimeFormat` : l'appelant garde son cache s'il en a un.
 *
 * Une date invalide rend `Invalid Date`, comme `toLocaleDateString` : `Intl` lèverait
 * une `RangeError`, et une seule date illisible coûterait tout le rendu de la page.
 */
export function formateurDate(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): { format: (date: Date) => string } {
  const formateur = new Intl.DateTimeFormat(locale, options);
  return {
    format: (date) => (Number.isNaN(date.getTime()) ? String(date) : moisCourtStable(formateur.format(date))),
  };
}

/** Aujourd'hui à Paris, en composantes de date civile (mois de 1 à 12). */
export function aujourdhuiAParis(): { annee: number; mois: number; jour: number } {
  const [annee, mois, jour] = aujourdhuiAParisIso().split('-').map(Number);
  return { annee, mois, jour };
}
