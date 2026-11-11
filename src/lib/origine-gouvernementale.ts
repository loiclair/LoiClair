/** Libellé que l'import écrit dans `initiateur_groupe_libelle` pour un texte du
 *  Gouvernement. C'est une valeur de donnée, pas un texte d'interface : le filtre
 *  par groupe de `/dossiers-legislatifs` en tire son slug. */
export const LIBELLE_GOUVERNEMENT = 'Gouvernement';

/**
 * Dit si un dossier ou un dépôt vient du Gouvernement. Appelé par l'index de
 * recherche des dossiers, le hero du résumé IA et le fil du mois, pour afficher
 * « Gouvernement » au lieu du groupe parlementaire de l'auteur.
 *
 * Deux preuves, l'une ou l'autre suffit :
 * - un texte dont l'uid commence par `PRJL` (projet de loi) ou `DECL`
 *   (déclaration du Gouvernement), règle de l'import (D-152) ;
 * - `initiateur_groupe_libelle` à « Gouvernement », valeur que l'import écrit.
 *
 * Le libellé seul ne suffit pas, parce que l'affichage doit rester juste avant
 * comme après la correction de l'import : au 2026-09-14, 26 projets de loi
 * portaient encore le groupe parlementaire actuel de leur ministre
 * (14 « Droite Républicaine », 12 « Ensemble pour la République »), écrit par
 * la branche « acteur » de l'import, qui passe avant le repli sur le
 * gouvernement. Aucun dossier ne portait « Gouvernement » sans texte PRJL ou
 * DECL.
 */
export function estOrigineGouvernementale(
  uidsTextes: readonly (string | null | undefined)[] | null | undefined,
  initiateurGroupeLibelle?: string | null,
): boolean {
  if (initiateurGroupeLibelle === LIBELLE_GOUVERNEMENT) return true;
  return (uidsTextes ?? []).some((uid) => !!uid && (uid.startsWith('PRJL') || uid.startsWith('DECL')));
}

/** Les colonnes de `dossiers_legislatifs` que lit `initiateurAffiche`, avec
 *  `initiateur_acteur_ref(prenom, nom, groupe:organes(libelle))` embarqué. */
export type InitiateurSource = {
  initiateur_groupe_libelle: string | null;
  textes_associes_refs: string[] | null;
  initiateur_acteur_ref: {
    prenom?: string | null;
    nom?: string | null;
    groupe?: { libelle?: string | null } | { libelle?: string | null }[] | null;
  } | null;
};

/**
 * Nom et groupe de l'initiateur affichés dans la liste des dossiers (index de
 * `/api/search-index/dossiers`) et dans le filtre Groupe de « Ce qui me concerne ».
 *
 * Un texte du Gouvernement rend « Gouvernement » avant le groupe actuel de
 * l'acteur : un ministre redevenu député rangeait sinon son projet de loi dans
 * son groupe d'aujourd'hui (Barnier et le budget 2025 sous « Droite
 * Républicaine »). La chaîne est la valeur de donnée, pas une traduction : le
 * filtre par groupe de `/dossiers-legislatifs` compare son slug à ceux de la vue
 * `dossiers_groupes_distincts`.
 */
export function initiateurAffiche(d: InitiateurSource): { nom: string | null; groupe: string | null } {
  const gouvernemental = estOrigineGouvernementale(d.textes_associes_refs, d.initiateur_groupe_libelle);
  const a = d.initiateur_acteur_ref;
  if (!a) return { nom: null, groupe: gouvernemental ? LIBELLE_GOUVERNEMENT : null };
  const prenom = a.prenom ?? '';
  const nom = a.nom ?? '';
  const full = `${prenom} ${nom}`.trim();
  const groupe = Array.isArray(a.groupe) ? a.groupe[0] : a.groupe;
  return {
    nom: full || null,
    groupe: gouvernemental ? LIBELLE_GOUVERNEMENT : groupe?.libelle ?? d.initiateur_groupe_libelle ?? null,
  };
}
