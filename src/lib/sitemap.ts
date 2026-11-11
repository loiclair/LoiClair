// Ce que partagent les sitemaps du site (`app/sitemap.ts`, et ceux des amendements
// `app/sitemaps/amendements/sitemap.ts`) et `app/robots.ts`, qui les annonce.

import type { MetadataRoute } from "next"
import { routing } from "@/i18n/routing"
import { sql } from "@/lib/db"
import { buildAlternates } from "@/lib/og-metadata"

export const BASE_URL = "https://loiclair.fr"

/** Une entrée par langue pour un chemin, avec ses `hreflang` (voir l'en-tête de `app/sitemap.ts`). */
export function entrees(path: string, details: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">): MetadataRoute.Sitemap {
  // Sans x-default, Google choisit lui-même la page servie à qui ne parle
  // ni français ni anglais ; le site, lui, sert le français par défaut.
  const { languages } = buildAlternates(routing.defaultLocale, path)
  return routing.locales.map((locale) => ({
    ...details,
    url: `${BASE_URL}/${locale}${path}`,
    alternates: { languages },
  }))
}

/** Amendements par fichier : deux adresses chacun (fr et en), soit 40 000 adresses, sous
 *  la limite de 50 000 au-delà de laquelle Google refuse le fichier entier. */
export const AMENDEMENTS_PAR_FICHIER = 20_000

/** Les amendements qui entrent au sitemap : ceux de séance, hors dossiers `hors_liste`,
 *  écartés comme leurs dossiers. Ceux de commission n'y sont pas (choix du 2026-11-08). */
export async function nombreFichiersAmendements(): Promise<number> {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from amendements a
    join dossiers_legislatifs d on d.uid = a.dossier_uid
    where a.lieu = 'seance' and d.hors_liste = false`
  return Math.max(1, Math.ceil(n / AMENDEMENTS_PAR_FICHIER))
}

/** Adresse publique du fichier `id` des amendements (convention de `generateSitemaps`). */
export function urlSitemapAmendements(id: number): string {
  return `${BASE_URL}/sitemaps/amendements/sitemap/${id}.xml`
}
