import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import crypto from 'crypto'
import { routing } from '@/i18n/routing'

/**
 * Rafraîchit les pages figées du site, toutes les fiches, les index de recherche
 * (dossiers, élus), la liste des élus à contacter et le sitemap à la fin du run de nuit.
 *
 * Appelée par la dernière étape du job d'import de `sync-data-nightly.yml`, avec le secret
 * `REVALIDATE_SECRET` en `Authorization: Bearer`. Sans elle, une page figée ne se
 * régénère que sur sa minuterie, sans lien avec l'heure où les données ont changé :
 * elle pouvait montrer les chiffres de l'avant-veille jusqu'au soir.
 *
 * La liste est explicite plutôt qu'un `revalidatePath('/', 'layout')`, qui marquerait
 * aussi les pages sans données. Seules les pages qui lisent la base y figurent, plus
 * toutes les pages `/Facts`, dont le hub et les deux budgets, qui n'ont que la date du
 * pied de page à mettre à jour ; les autres gardent leur minuterie de 24 h.
 *
 * Règle : une nouvelle page figée qui lit la base s'ajoute ici et prend
 * `export const revalidate = 172800`. Les 48 h ne sont qu'un filet pour une nuit
 * où cet appel n'aurait pas lieu. Exceptions : les fiches de `FICHES` gardent 24 h,
 * pour qu'une nuit sans appel les laisse en retard d'un jour et non de deux, et
 * `/Activite` aussi, pour ne pas décrocher des fiches élu, qui affichent les mêmes
 * chiffres. Contrepartie : une fiche très lue peut se régénérer deux fois certains
 * jours. Les routes de `ROUTES_NOCTURNES` gardent aussi leurs 24 h, voir plus bas.
 * Une nouvelle route d'API figée (`export const revalidate`) entre dans cette liste-là.
 *
 * `revalidatePath` ne régénère rien sur le coup : il marque la page, et la visite
 * suivante la reconstruit. Une fiche jamais visitée ne coûte donc rien, et le premier
 * lecteur attend le rendu au lieu de voir la version de la veille.
 *
 * Ce marquage retire le filet des pages qui lèvent sur une panne : Next ne relit pas
 * l'ancienne copie d'une page marquée. Constaté le 2026-11-05, base coupée sur un vrai
 * build : une fiche marquée rend 500 à chaque visite, sans mise en cache (`no-store`),
 * et revient seule quelques secondes après le retour de la base. Une régénération sur
 * minuterie garde, elle, la version précédente.
 *
 * Cette route ne vide pas le cache Cloudflare : c'est `purge-cloudflare.yml`, lancé
 * par le workflow de nuit une fois la réponse rendue. Dans l'autre ordre, un visiteur
 * passé entre les deux ferait garder à Cloudflare l'ancienne page.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Chemins sans préfixe de langue ; la chaîne vide est la landing. Aucun segment
// dynamique : c'est ce qui permet d'appeler `revalidatePath` sans son argument `type`.
const PAGES_NOCTURNES = [
  '',
  '/Activite',
  '/ce-qui-me-concerne',
  '/documentation/glossaire',
  '/dossiers-legislatifs',
  '/etat-des-lieux',
  '/les-elus',
  '/Month',
  '/processus-legislatif',
  '/Quiz',
  '/Quiz/affinite',
  '/Facts',
  '/Facts/alliances',
  '/Facts/amendements',
  '/Facts/budget/assemblee-nationale',
  '/Facts/budget/senat',
  '/Facts/cumul-des-mandats',
  '/Facts/delais',
  '/Facts/loyaute',
  '/Facts/participation',
  '/Facts/taux-application',
  '/Facts/taux-promulgation',
  '/Facts/representativite/age',
  '/Facts/representativite/genre',
  '/Facts/representativite/geographie',
  '/Facts/representativite/metiers',
  '/Facts/succes-legislatif/efficacite',
  '/Facts/succes-legislatif/victoires',
  '/Facts/succes-legislatif/volume',
]

// Index de recherche, que la liste de `/dossiers-legislatifs` et la recherche d'élus
// téléchargent au lieu de lire la base. Sans cet appel, leur minuterie de 24 h
// tournait sans lien avec l'heure du run : le 2026-10-21, les 26 dossiers importés
// par le run de nuit figuraient dans le fil d'actu et manquaient à la liste et à la
// recherche. Les durées de cache de ces routes ne changent pas (D-263). Pas de
// préfixe de langue : ces routes sont communes à /fr et /en. Le sitemap suit la même
// règle : il liste les fiches, donc il doit voir celles que le run vient de créer.
// `/api/elus-contact` aussi : sans cet appel, Next resservirait une copie d'avant l'import,
// et Cloudflare, sous sa règle de cache, la reprendrait après sa purge pour la garder
// jusqu'à la purge suivante.
const ROUTES_NOCTURNES = [
  '/api/elus-contact',
  '/api/search-index/acteurs',
  '/api/search-index/dossiers',
  '/api/search-index/dossiers/resumes',
  '/api/search-index/dossiers/impacts',
  '/sitemap.xml',
]

// Toutes les fiches plutôt qu'une liste tirée des lignes écrites : les élus classés
// changent chaque nuit (`jours_actifs`), et une fiche dépend aussi d'élus et de
// scrutins qui ne sont pas les siens. Ce sont des motifs de route, écrits comme le
// dossier de `src/app`, groupe `(app)` compris : `[locale]` y couvre déjà /fr et /en,
// et un segment dynamique rend obligatoire l'argument `'page'` de `revalidatePath`.
const FICHES = [
  '/[locale]/(app)/les-elus/[uid]',
  '/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia',
  '/[locale]/(app)/dossiers-legislatifs/[uid]/debats',
  '/[locale]/(app)/dossiers-legislatifs/[uid]/debats/[seance]',
  '/[locale]/(app)/Scrutins/[uid]',
  '/[locale]/(app)/Amendements/[uid]',
]

// `localePrefix: 'always'` : l'URL porte toujours la langue, et la middleware
// next-intl ne réécrit pas ces chemins. Le chemin visible est donc aussi celui
// sous lequel Next range la page en cache.
const CHEMINS = [
  ...routing.locales.flatMap((locale) =>
    PAGES_NOCTURNES.map((page) => `/${locale}${page}`)
  ),
  ...ROUTES_NOCTURNES,
]

export async function POST(request: NextRequest) {
  // `.trim()` : un retour à la ligne collé avec le secret dans Coolify ferait
  // échouer la comparaison, sans autre symptôme qu'un 401.
  const secret = (process.env.REVALIDATE_SECRET || '').trim()
  const authHeader = request.headers.get('Authorization') || ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const secretBuf = Buffer.from(secret)
  const providedBuf = Buffer.from(provided)
  const valid = secretBuf.length > 0 &&
    secretBuf.length === providedBuf.length &&
    crypto.timingSafeEqual(secretBuf, providedBuf)
  if (!valid) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  for (const chemin of CHEMINS) revalidatePath(chemin)
  for (const motif of FICHES) revalidatePath(motif, 'page')

  return NextResponse.json({ revalidated: CHEMINS.length + FICHES.length })
}
