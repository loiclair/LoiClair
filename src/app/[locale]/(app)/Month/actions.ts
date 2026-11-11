"use server";

import { fetchMonthData } from './page';
import { estMoisValide } from './monthKeys';
import { hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { routing } from '@/i18n/routing';
import type { MonthData } from './page';

/** Charge un mois du fil à la demande du navigateur.
 *
 *  C'est le seul canal de changement de mois : `/Month` est en `force-static`,
 *  donc les `searchParams` n'atteignent jamais le serveur et un lien `?mois=`
 *  rend toujours le mois courant. Un Server Action, lui, s'exécute normalement.
 *
 *  Le garde-fou n'est pas de la défense contre un cas impossible : un Server
 *  Action est un point d'entrée HTTP public, et sans lui un POST fabriqué sur
 *  `1789-07` déclenche les dix-sept requêtes de `fetchMonthData`.
 *  `estMoisValide` vit dans `monthKeys.ts` parce que `"use server"` impose que
 *  tous les exports de ce fichier soient asynchrones.
 *
 *  La langue arrive du navigateur (`useLocale` de `MonthFeedClient`) : `getLocale()`
 *  rendait `fr` sur /en, une Server Action ne voyant pas le segment `[locale]` de la
 *  page, et tout mois autre que celui d'arrivée s'affichait en français (constaté le
 *  2026-10-28). Une langue inconnue retombe sur la langue par défaut, comme les pages. */
export async function loadMonthAction(monthKey: string, langue: string): Promise<MonthData> {
  if (!estMoisValide(monthKey)) {
    throw new Error(`Clé de mois hors périmètre : ${monthKey}`);
  }
  const locale = hasLocale(routing.locales, langue) ? langue : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: 'month' });
  return fetchMonthData(monthKey, locale, t('lawFullyApplied'));
}
