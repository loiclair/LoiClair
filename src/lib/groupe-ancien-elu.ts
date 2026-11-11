// Le dernier groupe d'un ancien élu, pour les listes qui l'affichent sous son nom.
//
// La colonne `acteurs.groupe` ne porte que le groupe d'aujourd'hui : elle est vide dès
// qu'un élu ne siège plus, et sa ligne n'affichait alors aucun groupe (Harold Huwart,
// député jusqu'au 2026-07-25, sur le texte de l'urbanisme qu'il a rapporté). Le
// dernier groupe se lit dans `historique_groupes` (`dernierGroupe`).
//
// À part d'`ancien-elu.ts`, qui ne porte que des règles pures : ce module lit la base.
// Appelé par la fiche dossier (`resume-ia/page.tsx`) et par la route du tiroir de
// « Ce qui me concerne ».

import { sql } from '@/lib/db';
import { dernierGroupe, estAncienElu, type DrapeauxMandat } from '@/lib/ancien-elu';

type Groupe = { uid: string; libelle: string };

/**
 * Rend les lignes `acteurs` avec, pour chaque ancien élu sans groupe, son dernier
 * groupe en place de `groupe` (`{ uid, libelle }`, la forme de la jointure
 * `groupe:organes(uid, libelle)`). Les autres lignes ne changent pas. Deux lectures
 * de plus, et seulement s'il y a un ancien élu sans groupe : son historique, puis le
 * libellé des groupes. Lève sur une panne, comme les lectures de ses appelants (D-136).
 */
export async function completerGroupesAnciens<T extends DrapeauxMandat & { uid?: string | null; groupe?: unknown }>(
  lignes: T[],
): Promise<T[]> {
  const sansGroupe = (a: T) => !(Array.isArray(a.groupe) ? a.groupe[0] : a.groupe);
  const refs = [...new Set(lignes.filter((a) => a.uid && estAncienElu(a) && sansGroupe(a)).map((a) => a.uid as string))];
  if (refs.length === 0) return lignes;

  const historiques = await sql<{ uid: string; historique_groupes: unknown }[]>`
    select uid, historique_groupes from acteurs where uid = any(${refs}) order by uid`;
  const dernier = new Map(historiques.map((h) => [h.uid, dernierGroupe(h.historique_groupes)]));
  const uidsGroupes = [...new Set([...dernier.values()].filter((g): g is string => !!g))];
  if (uidsGroupes.length === 0) return lignes;

  const groupes = await sql<Groupe[]>`
    select uid, libelle from organes where uid = any(${uidsGroupes}) order by uid`;
  const parUid = new Map(groupes.map((g) => [g.uid, g]));

  return lignes.map((a) => {
    if (!a.uid || !estAncienElu(a) || !sansGroupe(a)) return a;
    const g = parUid.get(dernier.get(a.uid) ?? '');
    return g ? { ...a, groupe: g } : a;
  });
}
