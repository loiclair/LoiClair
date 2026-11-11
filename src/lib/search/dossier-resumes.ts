// src/lib/search/dossier-resumes.ts
// Serveur uniquement. Résumés de recherche des dossiers (`search_summary`), servis à
// part de la liste par `/api/search-index/dossiers/resumes` : ils font 70 % du poids
// de l'index et ne s'affichent jamais, la liste n'a donc pas à les attendre.
// La route de la liste calcule la même version sur les mêmes lignes, pour que le
// client sache sans rien télécharger si sa copie des résumés est encore bonne.

import { createHash } from 'node:crypto';
import { sql } from '@/lib/db';

export type ResumesPayload = { version: string; resumes: Record<string, string> };

/** Empreinte courte d'une valeur sérialisable : change exactement quand la valeur change. */
export function empreinte(valeur: unknown): string {
  return createHash('sha1').update(JSON.stringify(valeur)).digest('base64url').slice(0, 16);
}

/** Résumés par uid, dossiers sans résumé omis. Les lignes doivent arriver triées par
 *  uid : l'ordre des clés entre dans l'empreinte, et les deux routes doivent tomber
 *  sur la même. */
export function resumesPayload(rows: { uid: string; search_summary: string | null }[]): ResumesPayload {
  const resumes: Record<string, string> = {};
  for (const r of rows) if (r.search_summary) resumes[r.uid] = r.search_summary;
  return { version: empreinte(resumes), resumes };
}

/** Lit tous les résumés. Lève si la lecture échoue (voir la route de la liste : une
 *  réponse d'erreur rendue serait mise en cache 24 h). */
export async function lireResumes(): Promise<ResumesPayload> {
  const rows = await sql<{ uid: string; search_summary: string | null }[]>`
    select uid, search_summary
    from dossiers_legislatifs
    -- hors_liste : dossiers comptés dans le score mais absents des listes (migration 2026-10-29_dossiers_hors_liste.sql).
    -- Même filtre que la route de la liste : la version des résumés doit y correspondre.
    where hors_liste = false
    order by uid`;
  return resumesPayload(rows);
}
