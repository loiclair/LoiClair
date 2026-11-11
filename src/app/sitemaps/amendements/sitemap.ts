// Sitemaps des pages d'amendements, à part de `app/sitemap.ts` : à eux seuls, les
// amendements de séance approchent la limite de 50 000 adresses par fichier, au-delà de
// laquelle Google refuse tout le fichier. Découpés en fichiers de `AMENDEMENTS_PAR_FICHIER`,
// servis à `/sitemaps/amendements/sitemap/<n>.xml` et annoncés par `app/robots.ts`.
// Hors de `[locale]` et terminés par `.xml` : la middleware des langues ne les touche pas.
//
// Rafraîchis toutes les 24 h, sans l'appel du run de nuit qui rafraîchit `/sitemap.xml` :
// un amendement adopté entre au sitemap au plus un jour après son import.

import type { MetadataRoute } from "next"
import { sql } from "@/lib/db"
import { AMENDEMENTS_PAR_FICHIER, entrees, nombreFichiersAmendements } from "@/lib/sitemap"

export const revalidate = 86400

export async function generateSitemaps() {
  const n = await nombreFichiersAmendements()
  return Array.from({ length: n }, (_, id) => ({ id }))
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = Number(await props.id)
  // L'ordre par uid rend chaque fichier stable d'un jour à l'autre, un nouvel amendement
  // ne décalant que les fichiers qui suivent sa place.
  const amendements = await sql<{ uid: string }[]>`
    select a.uid from amendements a
    join dossiers_legislatifs d on d.uid = a.dossier_uid
    where a.lieu = 'seance' and d.hors_liste = false
    order by a.uid
    offset ${id * AMENDEMENTS_PAR_FICHIER} limit ${AMENDEMENTS_PAR_FICHIER}`
  return amendements.flatMap(({ uid }) => entrees(`/Amendements/${uid}`, {}))
}
