import type { MetadataRoute } from "next"
import { FACTS_ARTICLES } from "@/lib/facts-registry"
import { estAncienElu, type DrapeauxMandat } from "@/lib/ancien-elu"
import { sql } from "@/lib/db"
import { entrees } from "@/lib/sitemap"

// `/api/revalidate` le rafraîchit à la fin du run de nuit : une fiche créée par
// l'import y entre sans attendre un déploiement. Les 24 h ne sont qu'un filet.
export const revalidate = 86400

/**
 * Sitemap du site. Quatre règles à ne pas défaire.
 *
 * Les URL portent toutes leur préfixe de langue, parce que `localePrefix` vaut
 * `always` : `https://loiclair.fr/Facts` répond 307 vers `/fr/Facts`, et une URL
 * qui redirige est refusée par la Search Console (« URL soumise avec
 * redirection »). Les douze premières entrées étaient dans ce cas.
 *
 * Les articles des faits ne se recopient pas ici : ils viennent de
 * `FACTS_ARTICLES`, le registre qui sert déjà au hub et à « Continuez
 * d'explorer ». Un article ajouté là entre donc au sitemap sans autre geste,
 * et l'oubli d'aujourd'hui, dix-neuf articles absents, ne peut pas se refaire.
 *
 * Chaque page y figure une fois par langue, chacune avec ses `hreflang` : Google
 * demande que toutes les versions listées se citent les unes les autres, et une
 * version anglaise qui n'apparaît qu'en `hreflang` n'est pas soumise comme page.
 *
 * Les fiches d'élus, de textes et de votes viennent de la base. Elles y sont indispensables :
 * les pages `/les-elus` et `/dossiers-legislatifs` filtrent côté navigateur et ne
 * lient que les plus consultées, donc un robot n'atteindrait pas les autres. Une
 * fiche de texte s'y écrit avec `/resume-ia`, sa vraie adresse : la forme courte
 * répond 308, refusée comme ci-dessus. Les débats n'y sont pas, la fiche les lie.
 * Les dossiers `hors_liste` non plus, écartés comme de toutes les listes du site, ni
 * les anciens élus, dont la fiche est en `noindex` (D-234). Les amendements ont leurs
 * propres fichiers (`app/sitemaps/amendements/sitemap.ts`) : avec eux, celui-ci
 * approcherait la limite de 50 000 adresses, au-delà de laquelle Google le refuse entier.
 */
const ROUTES: { path: string; changeFrequency?: MetadataRoute.Sitemap[number]["changeFrequency"]; priority?: number }[] = [
  { path: "", changeFrequency: "weekly", priority: 1 },
  { path: "/etat-des-lieux", changeFrequency: "daily", priority: 0.9 },
  { path: "/dossiers-legislatifs", changeFrequency: "daily", priority: 0.9 },
  { path: "/les-elus", changeFrequency: "daily", priority: 0.8 },
  { path: "/Facts", changeFrequency: "weekly", priority: 0.7 },
  // Les articles eux-mêmes, chiffres recalculés à chaque run de nuit.
  ...FACTS_ARTICLES.map((a) => ({ path: a.href, changeFrequency: "daily" as const, priority: 0.8 })),
  { path: "/Month", changeFrequency: "monthly", priority: 0.7 },
  { path: "/ce-qui-me-concerne", changeFrequency: "weekly", priority: 0.7 },
  { path: "/Quiz", changeFrequency: "monthly", priority: 0.6 },
  { path: "/processus-legislatif", changeFrequency: "monthly", priority: 0.6 },
  { path: "/about", changeFrequency: "monthly", priority: 0.5 },
  { path: "/newsletter", changeFrequency: "monthly", priority: 0.5 },
  { path: "/nous-aider", changeFrequency: "monthly", priority: 0.4 },
  { path: "/documentation/glossaire", changeFrequency: "monthly", priority: 0.5 },
  { path: "/documentation/choix-modele-ia", changeFrequency: "monthly", priority: 0.5 },
  { path: "/documentation/prompts-ia", changeFrequency: "monthly", priority: 0.5 },
  { path: "/documentation/conformite-ia", changeFrequency: "monthly", priority: 0.5 },
  { path: "/documentation/corrections", changeFrequency: "monthly", priority: 0.5 },
  { path: "/documentation/mcp", changeFrequency: "monthly", priority: 0.5 },
  { path: "/mentions-legales", changeFrequency: "yearly", priority: 0.3 },
  { path: "/confidentialite", changeFrequency: "yearly", priority: 0.3 },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const [elus, dossiers, scrutins] = await Promise.all([
    sql<({ uid: string } & DrapeauxMandat)[]>`
      select uid, est_depute_actuel, est_senateur_actuel, est_ministre_actuel, roles_text
      from acteurs order by uid`,
    sql<{ uid: string }[]>`select uid from dossiers_legislatifs where hors_liste = false order by uid`,
    // Les seuls votes qui ont une page : ceux à liste nominative, les autres rendent 404.
    sql<{ uid: string }[]>`select uid from scrutins where votes_nominatifs is not null order by uid`,
  ])

  return [
    // `now` n'est vrai que d'une page recalculée chaque nuit. Le sitemap se régénérant
    // chaque jour, il dirait sinon que `/mentions-legales` vient de changer.
    ...ROUTES.flatMap(({ path, ...details }) =>
      entrees(path, details.changeFrequency === "daily" ? { ...details, lastModified: now } : details),
    ),
    // Sans `lastModified`, pour la même raison : rien ne dit quand une fiche a changé.
    ...elus.filter((e) => !estAncienElu(e)).flatMap(({ uid }) => entrees(`/les-elus/${uid}`, {})),
    ...dossiers.flatMap(({ uid }) => entrees(`/dossiers-legislatifs/${uid}/resume-ia`, {})),
    ...scrutins.flatMap(({ uid }) => entrees(`/Scrutins/${uid}`, {})),
  ]
}
