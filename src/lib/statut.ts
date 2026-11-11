// src/lib/statut.ts
//
// Tables du statut d'un dossier (`statut_final`, toujours en français en base) :
// code stable, clé de traduction, couleur de puce. Une valeur que le pipeline
// (`import_dossiers_cloud.py`) se met à écrire entre dans les trois, sinon elle
// s'affiche brute dans toutes les langues, en orange. Lu par les listes et fiches de
// dossiers, les fiches d'élus, la recherche, « Ce qui me concerne » et le serveur MCP
// (`mcp/codes.ts`).

/** Slug → DB label mapping for statut_final.
 *  Lu aussi par `pipeline/_statuts.py`, qui arrête l'import des dossiers sur un
 *  statut absent d'ici : garder un libellé entre guillemets doubles par ligne. */
export const STATUT_MAP: Record<string, string> = {
  en_cours_d_examen: "Déposé - pas encore voté",
  publie: "Publié",
  adopte_par_assemblee: "Adopté par l'Assemblée nationale",
  adopte_par_senat: "Adopté par le Sénat",
  adopte_par_parlement: "Adopté par le Parlement",
  rejetee: "Rejeté",
  rejete_par_assemblee: "Rejeté par l'Assemblée nationale",
  rejete_par_senat: "Rejeté par le Sénat",
  promulguee: "Promulguée",
  appliquee: "Appliquée",
  retire: "Retiré",
};

/** DB statut_final value → key in `dossiers` translation namespace */
const STATUT_FINAL_TO_KEY: Record<string, string> = {
  "Déposé - pas encore voté": "statutEnCours",
  "Publié": "statutPublie",
  "Adopté par l'Assemblée nationale": "statutAdopteAssemblee",
  "Adopté par le Sénat": "statutAdopteSenat",
  "Adopté par le Parlement": "statutAdopteParlement",
  "Rejeté": "statutRejete",
  "Rejeté par l'Assemblée nationale": "statutRejeteAssemblee",
  "Rejeté par le Sénat": "statutRejeteSenat",
  "Promulguée": "statutPromulguee",
  "Appliquée": "statutAppliquee",
  "Retiré": "statutRetire",
};

/**
 * Translate a French statut_final value via the `dossiers` namespace.
 * Falls back to the original string when the value is unknown (e.g. raw scrutin sort).
 */
export function translateStatut(
  statut: string | null | undefined,
  t: (key: string) => string,
): string {
  if (!statut) return "";
  const key = STATUT_FINAL_TO_KEY[statut];
  return key ? t(key) : statut;
}

/** Statut d'une décision du Conseil constitutionnel (`statut_conclusion` d'un acte
 *  `CC-CONCLUSION`, toujours en français en base) → suffixe de ses deux clés du
 *  namespace `resumeIA` : `ccStatut<suffixe>` pour le libellé, `ccExplain<suffixe>`
 *  pour ce qu'il signifie. */
const CC_STATUT_SUFFIXE: Record<string, string> = {
  "Conforme": "Conforme",
  "Conforme avec réserve": "ConformeReserve",
  "Partiellement conforme": "Partiel",
  "Non conforme": "NonConforme",
};

/**
 * Libellé traduit et explication d'une décision du Conseil constitutionnel, lus
 * par la section et la carte du parcours de la fiche dossier, et par `/Month`.
 * `t` est celui du namespace `resumeIA`. Un statut inconnu garde son texte brut et
 * n'a pas d'explication. La couleur du badge, elle, se lit toujours sur la valeur
 * française (`getStatusBadgeClass`).
 */
export function statutCC(
  statut: string | null | undefined,
  t: (key: string) => string,
): { libelle: string; explication: string | null } {
  if (!statut) return { libelle: "", explication: null };
  const suffixe = CC_STATUT_SUFFIXE[statut];
  return suffixe
    ? { libelle: t(`ccStatut${suffixe}`), explication: t(`ccExplain${suffixe}`) }
    : { libelle: statut, explication: null };
}

/** Statut → bullet color mapping */
export function statutBulletColor(statut: string | null): string {
  if (statut === 'Appliquée') return '#DAA520';
  if (statut === 'Promulguée') return '#27AE60';
  if (statut === 'Publié') return '#3498DB';
  // « Rejeté », et les rejets d'une seule chambre (« Rejeté par le Sénat »…).
  if (statut?.startsWith('Rejeté')) return '#E74C3C';
  if (statut?.includes('Adopt')) return '#8B5CF6';
  if (statut === 'Déposé - pas encore voté') return '#F39C12';
  if (statut === 'Retiré') return '#95A5A6';
  return '#F39C12';
}
