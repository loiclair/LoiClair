// Groupe politique d'un élu à une date donnée, lu dans `acteurs.historique_groupes`.
//
// `acteurs.groupe` ne garde que le groupe en cours, et il bouge : après le
// renouvellement du Sénat de septembre 2026, l'AMO a clos le groupe de sénateurs
// réélus sans publier le nouveau, puis l'a publié quelques jours plus tard. Sur un
// débat passé, ce champ donne un groupe que l'orateur n'avait pas encore, ou aucun.
// Règle commune à tout acte d'un élu, vote ou intervention (D-278), et même règle
// que le groupe d'auteur d'un texte (D-209, `groupe_au_depot` de
// `pipeline/_positions_groupe.py`) : le groupe du jour, et aucun repli sur le
// groupe actuel quand l'historique n'en connaît pas ce jour-là. L'historique ne porte
// que des uid actifs (alias UDR → UDDPLR appliqué à l'écriture, par
// `historique_des_groupes` de `import_acteurs_organes_cloud.py`) : rien à traduire ici.
//
// Appelé par `/api/resume-debats`, dont l'en-tête de chaque intervention entre dans
// les clés de cache : avec le groupe actuel, chaque changement de groupe d'un orateur
// faisait relire par l'IA toutes les séances où il avait parlé. Et par la page de
// séance, dont chaque intervention affiche le groupe de l'orateur ce jour-là.
// `/api/scrutin-votes` ne passe pas par ici : le groupe de chaque votant lui vient de
// l'import du scrutin (`scrutins.groupes_votants`), le même que le décompte du groupe
// pour chaque votant (les absents de l'Assemblée exceptés, rangés par l'historique).

import { sql } from '@/lib/db';

/** Une appartenance de `acteurs.historique_groupes` : dates ISO au jour, bornes incluses. */
export type Appartenance = { debut: string | null; fin: string | null; groupe: string };

export type GroupeOrgane = { libelle: string | null; libelle_abrege: string | null; couleur_associee: string | null };

/**
 * Uid du groupe de l'élu le jour `jour` (« YYYY-MM-DD »), ou null.
 *
 * Même règle que `groupe_au_jour` en Python : bornes incluses, un début manquant vaut
 * « depuis toujours », et si deux appartenances couvrent le jour (l'AMO30 en compte),
 * la plus récente l'emporte, pour que l'ordre de la liste ne décide pas. Sans date,
 * null comme `groupe_au_depot` : un jour vide ne retiendrait que les appartenances sans
 * début, soit un groupe pris au hasard de l'historique.
 */
export function groupeAuJour(historique: Appartenance[] | null, jour: string): string | null {
  if (!jour) return null;
  let retenu: Appartenance | null = null;
  for (const a of historique ?? []) {
    if ((a.debut ?? '') <= jour && (a.fin === null || jour <= a.fin)) {
      if (retenu === null || (a.debut ?? '') > (retenu.debut ?? '')) retenu = a;
    }
  }
  return retenu ? retenu.groupe : null;
}

/**
 * Charge l'historique des élus donnés et les libellés et couleurs de leurs groupes,
 * puis rend une fonction `groupe(acteurUid, jour)` : le groupe de l'élu ce jour-là, ou
 * null (élu inconnu, pas de groupe ce jour-là, organe absent de `organes`).
 *
 * Deux lectures groupées plutôt qu'une jointure par ligne : l'historique est un jsonb
 * qu'une jointure répéterait sur chaque intervention (15 402 pour le plus gros
 * dossier). Lève si une lecture échoue.
 */
export async function lecteurDeGroupes(
  acteurUids: Iterable<string>,
): Promise<(acteurUid: string, jour: string) => GroupeOrgane | null> {
  const uids = [...new Set(acteurUids)];
  const historiques = new Map<string, Appartenance[] | null>();
  const acteurs = await sql<{ uid: string; historique_groupes: Appartenance[] | null }[]>`
    select uid, historique_groupes from acteurs where uid = any(${uids})`;
  for (const l of acteurs) historiques.set(l.uid, l.historique_groupes);

  const organesUids = new Set<string>();
  for (const h of historiques.values()) {
    for (const a of h ?? []) organesUids.add(a.groupe);
  }
  const organes = new Map<string, GroupeOrgane>();
  const lignesOrganes = await sql<({ uid: string } & GroupeOrgane)[]>`
    select uid, libelle, libelle_abrege, couleur_associee from organes where uid = any(${[...organesUids]})`;
  for (const o of lignesOrganes) {
    organes.set(o.uid, { libelle: o.libelle, libelle_abrege: o.libelle_abrege, couleur_associee: o.couleur_associee });
  }

  return (acteurUid, jour) => {
    const groupe = groupeAuJour(historiques.get(acteurUid) ?? null, jour);
    return groupe ? organes.get(groupe) ?? null : null;
  };
}
