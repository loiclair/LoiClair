// robots.txt du site. `/api/og` est rouvert malgré le blocage de `/api/` : le robot
// de X respecte robots.txt et n'affiche pas une image de partage qu'il lui interdit
// (constaté le 2026-10-28), or toutes les images Open Graph du site vivent là. La
// règle la plus longue l'emporte, donc `/api/og` passe avant `/api/`. Sans barre
// finale : l'image commune est `/api/og?locale=fr`, que `/api/og/` ne couvrait pas.
//
// Les fiches ne s'ouvrent qu'aux moteurs nommés et aux robots d'aperçu de lien. Pour
// un robot qui s'annonce comme tel (Semrush, Ahrefs), ce fichier est le seul frein :
// le contrôle Cloudflare des fiches (D-324) ne vise que les signatures de navigateur.
// Un robot nommé dans un groupe n'applique que ce groupe et ignore `*` : le sien doit
// donc reprendre les interdictions utiles.
//
// Il annonce `/sitemap.xml` et chaque fichier des amendements, dont le nombre suit la
// base : d'où la lecture et le rafraîchissement quotidien, comme les sitemaps.

import type { MetadataRoute } from "next"
import { BASE_URL, nombreFichiersAmendements, urlSitemapAmendements } from "@/lib/sitemap"

export const revalidate = 86400

const ROBOTS_FICHES = [
  "Googlebot",
  "Bingbot",
  "Twitterbot",
  "LinkedInBot",
  "facebookexternalhit",
  "WhatsApp",
  "Slackbot-LinkExpanding",
  "Discordbot",
  "TelegramBot",
]

// Communes aux deux groupes : `ROBOTS_FICHES` ignore `*`, il doit donc garder la
// même ouverture de `/api/og` et la même fermeture de `/api/`.
const ALLOW_COMMUN = ["/", "/api/og"]
const DISALLOW_API = "/api/"

export default async function robots(): Promise<MetadataRoute.Robots> {
  const fichiers = await nombreFichiersAmendements()
  return {
    rules: [
      {
        userAgent: "ClaudeBot",
        disallow: "/",
      },
      {
        userAgent: ROBOTS_FICHES,
        allow: ALLOW_COMMUN,
        disallow: DISALLOW_API,
      },
      {
        userAgent: "*",
        allow: ALLOW_COMMUN,
        disallow: [
          DISALLOW_API,
          "/fr/dossiers-legislatifs/",
          "/en/dossiers-legislatifs/",
          "/fr/les-elus/",
          "/en/les-elus/",
        ],
      },
    ],
    sitemap: [`${BASE_URL}/sitemap.xml`, ...Array.from({ length: fichiers }, (_, id) => urlSitemapAmendements(id))],
  }
}
