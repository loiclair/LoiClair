// src/app/[locale]/(app)/Month/monthKeys.ts
// Arithmétique et libellés des clés de mois `YYYY-MM` du fil d'actualité.
//
// Module pur, sans `"use client"` : il sert au Server Component (`page.tsx`), au
// Server Action (`actions.ts`) et au composant client (`MonthFeedClient.tsx`).
// C'est la source unique du format de mois du fil : personne d'autre ne
// construit de formateur sur un mois.

import { LEGISLATURE_17_START } from '@/lib/facts-shared';
import { formateurDate } from '@/lib/jour-paris';

/** Plancher du fil : le mois d'ouverture de la 17ᵉ législature (`2024-07`).
 *  Dérivé de la constante partagée plutôt que recopié, pour que les deux ne
 *  puissent pas diverger. */
export const MOIS_PLANCHER = LEGISLATURE_17_START.slice(0, 7);

const FORME_CLE = /^\d{4}-\d{2}$/;

/** Vrai si la chaîne est une clé de mois du fil : bien formée et dans la
 *  législature. La comparaison de bornes se fait lexicographiquement, ce qui est
 *  exact sur du `YYYY-MM` zéro-paddé (`'2024-07' < '2024-10'`) et évite de
 *  construire des `Date` juste pour comparer. */
export function estMoisValide(cle: string): boolean {
  return FORME_CLE.test(cle) && cle >= MOIS_PLANCHER;
}

function versDate(cle: string): Date {
  const [an, mois] = cle.split('-');
  // Le 15 à midi, jamais le 1er à minuit : voir le commentaire de libelleMois().
  return new Date(parseInt(an, 10), parseInt(mois, 10) - 1, 15, 12, 0, 0);
}

export function formatISOMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Décale une clé de `pas` mois. `new Date` normalise seul le passage d'année
 *  (`new Date(2025, -1, 1)` vaut décembre 2024). */
function decale(cle: string, pas: number): string {
  const d = versDate(cle);
  return formatISOMonth(new Date(d.getFullYear(), d.getMonth() + pas, 1));
}

export const moisPrecedent = (cle: string) => decale(cle, -1);
export const moisSuivant = (cle: string) => decale(cle, 1);

/** Liste décroissante des clés, du plafond inclus jusqu'au plancher inclus.
 *  Alimente le sélecteur de mois de la barre. */
export function moisEntre(plancher: string, plafond: string): string[] {
  const cles: string[] = [];
  for (let cle = plafond; cle >= plancher; cle = moisPrecedent(cle)) cles.push(cle);
  return cles;
}

/** Libellé localisé d'un mois.
 *
 *  La date est construite **au 15 à midi**, jamais au 1er à minuit. Avec
 *  `timeZone: 'Europe/Paris'`, minuit local du 1er août chez un utilisateur en
 *  UTC+13 vaut le 31 juillet à Paris : `Intl` afficherait « juillet ». Le 15 à
 *  midi absorbe tous les décalages horaires.
 *
 *  La casse suit la langue : `Intl` rend « août 2026 » en minuscule et
 *  « August 2026 » en majuscule. C'est correct en milieu de phrase, ce pour quoi
 *  les libellés du namespace `month` sont formulés. Ne jamais forcer la casse
 *  ici : capitaliser en anglais est déjà fait, et le forcer en français casse
 *  les phrases où le mois est en incise. */
function libelleMois(cle: string, locale: string, mois: 'long' | 'short'): string {
  return formateurDate(locale, {
    month: mois,
    year: 'numeric',
    timeZone: 'Europe/Paris',
  }).format(versDate(cle));
}

/** « août 2026 » / « August 2026 » */
export const libelleMoisLong = (cle: string, locale: string) => libelleMois(cle, locale, 'long');

/** « août » / « Aug » : le sélecteur groupe déjà par année, l'année y serait redondante. */
export function libelleMoisCourt(cle: string, locale: string): string {
  return formateurDate(locale, {
    month: 'short',
    timeZone: 'Europe/Paris',
  }).format(versDate(cle));
}

/** Vrai si le libellé appelle l'élision : « Chargement d'octobre » et non
 *  « Chargement de octobre ». Trois mois sur douze sont concernés en français,
 *  avril, août et octobre ; aucun ne commence par un h, d'où l'absence de cas
 *  aspiré. Sert d'argument à la clé `month.loadingMonth`, dont la version
 *  anglaise ignore simplement le paramètre. */
export function appelleElision(libelle: string): boolean {
  return /^[aàâeéèêiîoôuûy]/i.test(libelle);
}

/** Capitalise la première lettre, pour les emplois où le mois ouvre une ligne
 *  (la pastille de la barre) plutôt qu'une phrase. Sans effet en anglais, où
 *  `Intl` capitalise déjà. */
export function capitaliser(libelle: string): string {
  return libelle.charAt(0).toUpperCase() + libelle.slice(1);
}
