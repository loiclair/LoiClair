// src/lib/search/amendement-textes.ts
// Serveur uniquement : lit la base. Le texte cherchable des amendements de la table
// (adoptés, et rejetés par scrutin public depuis LOI-85), leur
// dispositif et le résumé de l'IA en français et en anglais, servi à part des
// métadonnées par `/api/search-index/amendements/textes` (15,8 Mo bruts de dispositif
// au 2026-11-20, contre quelques centaines de Ko de métadonnées). La route des
// métadonnées (`/api/search-index/amendements`) annonce leur version, calculée par
// Postgres sur les mêmes lignes (`lireVersionTextesAmendements`) : le client sait sans
// rien télécharger si sa copie est encore bonne. L'exposé des motifs n'y est pas
// (11,4 Mo compressés). Seuls les quelque 1 500 amendements classés par « Ce qui me
// concerne » ont un résumé.
//
// Format texte et non JSON (`amendement-format.ts`). Mesuré le 2026-11-20 dans Chrome,
// processeur ×4 : l'analyse du même contenu en JSON prenait 250 ms d'un tenant, et sa
// copie dans IndexedDB 210 ms, là où une chaîne se copie d'un bloc et se découpe ligne à
// ligne pendant l'indexation, par lots (`amendement-index.ts`).

import { sql } from '@/lib/db';
import { SEP_CHAMP, SEP_LIGNE } from './amendement-format';

const sansSeparateurs = (s: string | null) => (s ?? '').replace(/[\u001e\u001f]/g, ' ');

/** Le résumé du classement le plus récent de chaque amendement, comme `resumesAmendements`
 *  (`lib/ce-qui-me-concerne.ts`) : le dernier dans l'ordre (created_at, prompt_version). */
const RESUMES = sql`
  select distinct on (element_id) element_id, resume_fr, resume_en
  from impacts
  where element_type = 'amendement' and modele = 'claude-haiku-5-5'
  order by element_id, created_at desc, prompt_version desc`;

/** Amendements adoptés des dossiers de la liste : `hors_liste` écarte ceux que la page
 *  Textes ne montre pas, comme la route de la liste. Même filtre que la route des
 *  métadonnées : un amendement trouvé doit avoir sa ligne de métadonnées. */
const AMENDEMENTS_LISTES = sql`
  from amendements a
  join dossiers_legislatifs d on d.uid = a.dossier_uid and d.hors_liste = false
  left join (${RESUMES}) r on r.element_id = a.uid`;

/** Change quand la forme du payload change sans que les lignes bougent : l'empreinte de
 *  Postgres ne voit que les lignes. 2 : passage du JSON au format texte. */
const FORMAT = '2';

/** Empreinte des lignes que sert `lireTextesAmendements`, calculée par Postgres : la
 *  route des métadonnées l'annonce sans relire les 15,8 Mo de dispositif. Lève si la
 *  lecture échoue (une réponse d'erreur rendue serait mise en cache 24 h). */
export async function lireVersionTextesAmendements(): Promise<string> {
  // `chr(1)` et `chr(2)` séparent les champs et les lignes : deux contenus différents ne
  // s'écrivent jamais pareil.
  const [{ v }] = await sql<{ v: string | null }[]>`
    select md5(string_agg(
      a.uid || chr(1) || coalesce(a.dispositif, '') || chr(1) || coalesce(r.resume_fr, '') || chr(1) || coalesce(r.resume_en, ''),
      chr(2) order by a.uid)) as v
    ${AMENDEMENTS_LISTES}`;
  if (typeof v !== 'string') throw new Error('version des textes d’amendements : réponse vide');
  return `${FORMAT}-${v}`;
}

/** Le corps de la route : la version, un saut de ligne, puis les lignes (voir l'en-tête
 *  du fichier). Lève si la lecture échoue. */
export async function lireTextesAmendements(): Promise<string> {
  const [rows, version] = await Promise.all([
    sql<{ uid: string; dispositif: string | null; resume_fr: string | null; resume_en: string | null }[]>`
      select a.uid, a.dispositif, r.resume_fr, r.resume_en
      ${AMENDEMENTS_LISTES}
      order by a.uid`,
    lireVersionTextesAmendements(),
  ]);
  const lignes = rows.map((r) =>
    [r.uid, sansSeparateurs(r.dispositif), sansSeparateurs(r.resume_fr), sansSeparateurs(r.resume_en)].join(SEP_CHAMP));
  return `${version}\n${lignes.join(SEP_LIGNE)}`;
}
