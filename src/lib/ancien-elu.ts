// Ancien élu : ni député, ni sénateur, ni ministre, ni Président de la République en
// exercice. Une seule règle pour le statut `ancien` du bandeau « Écrire à mes élus »
// de la fiche dossier (`versPersonneContact`, page.tsx), les vignettes
// (`PhotoEluVignette`), le badge de rôle au passé de la fiche dossier (`BadgeRole`) et
// la fiche élu, et un seul gris (`STYLE_ANCIEN`). Un ministre n'est pas un ancien élu,
// même sans mandat de parlementaire : il exerce, et le bandeau lui garde un moyen d'écrire.

/** Les trois drapeaux de mandat d'une ligne `acteurs` et ses rôles (`roles_text`),
 *  tels que `COLONNES_MANDAT` les fait lire. */
export interface DrapeauxMandat {
  est_depute_actuel?: boolean | null;
  est_senateur_actuel?: boolean | null;
  est_ministre_actuel?: boolean | null;
  roles_text?: string | null;
}

/** Le gris d'un portrait d'ancien élu, le même partout : vignettes (`PhotoEluVignette`),
 *  en-tête de sa fiche (`PhotoEluHero`) et bandeau « Écrire à mes élus »
 *  (`PhotoEluBandeau`). À étaler dans le `style` du portrait. */
export const STYLE_ANCIEN = { filter: 'grayscale(1)', opacity: 0.55 } as const;

/** Colonnes à ajouter au `select` d'une requête `acteurs` pour appeler `estAncienElu`.
 *  Sans `roles_text`, le Président de la République passerait pour un ancien élu. */
export const COLONNES_MANDAT = 'est_depute_actuel, est_senateur_actuel, est_ministre_actuel, roles_text';

export function estAncienElu(a: DrapeauxMandat): boolean {
  if (a.est_depute_actuel || a.est_senateur_actuel || a.est_ministre_actuel) return false;
  // Le Président de la République en exercice n'a aucun des trois drapeaux, mais il
  // exerce : l'import n'écrit ce libellé, seul dans `roles_text`, que pour un mandat
  // PRESREP encore ouvert (`import_acteurs_organes_cloud.py`). Sans ce cas, son
  // portrait (PA702992) était grisé et l'auteur d'un projet de loi constitutionnelle
  // devenait « Ancien membre du Gouvernement ».
  return (a.roles_text ?? '').trim() !== 'Président de la République';
}

/** Le mandat qu'un ancien élu a quitté, lu dans `roles_text`, qui garde tous les
 *  mandats passés. Un élu passé par les deux chambres est « parlementaire » : rien ne
 *  dit laquelle il a quittée en dernier. Clé du libellé `elus.ancienMandat`, que lisent
 *  la fiche élu (`mandatTermine`) et l'en-tête d'un dossier (`fonctionElu`). */
export type RoleQuitte = 'depute' | 'senateur' | 'parlementaire' | 'gouvernement' | 'autre';

export function roleQuitte(rolesText: string | null | undefined): RoleQuitte {
  // Rôles comparés un par un, et non par `\bDéputé\b` : pour JavaScript, « é »
  // n'est pas une lettre, et la frontière de mot après lui ne se trouve jamais.
  const roles = new Set((rolesText ?? '').split(',').map((r) => r.trim()));
  const depute = roles.has('Député');
  const senateur = roles.has('Sénateur');
  return depute && senateur ? 'parlementaire'
    : depute ? 'depute'
    : senateur ? 'senateur'
    : roles.has('Ministre') || roles.has("Secrétaire d'État") || roles.has('Haut-commissaire') ? 'gouvernement'
    : 'autre';
}

/** La fonction d'un élu aujourd'hui : celle qu'il exerce, ou le mandat qu'il a quitté
 *  (`ancien`). Le Gouvernement passe avant la chambre, comme dans `versPersonneContact` :
 *  un ministre peut garder un mandat de parlementaire ouvert dans la source. Sert à
 *  l'en-tête d'un dossier, qui nomme l'auteur et les rapporteurs. */
export type FonctionElu =
  | { ancien: false; role: 'gouvernement' | 'depute' | 'senateur' | 'president' }
  | { ancien: true; role: RoleQuitte };

export function fonctionElu(a: DrapeauxMandat): FonctionElu {
  if (a.est_ministre_actuel) return { ancien: false, role: 'gouvernement' };
  if (a.est_depute_actuel) return { ancien: false, role: 'depute' };
  if (a.est_senateur_actuel) return { ancien: false, role: 'senateur' };
  if (!estAncienElu(a)) return { ancien: false, role: 'president' };
  return { ancien: true, role: roleQuitte(a.roles_text) };
}

/** uid du dernier groupe d'un élu dans `acteurs.historique_groupes` (`[{debut, fin,
 *  groupe}]`, uid toujours actifs) : celui dont le début est le plus récent. Sert à
 *  nommer le groupe d'un ancien élu, dont la colonne `groupe` est vide dès qu'il ne
 *  siège plus. `null` sans historique exploitable. */
export function dernierGroupe(historique: unknown): string | null {
  if (!Array.isArray(historique)) return null;
  let dernier: { debut: string; groupe: string } | null = null;
  for (const h of historique as { debut?: unknown; groupe?: unknown }[]) {
    if (typeof h?.groupe !== 'string' || !h.groupe || typeof h.debut !== 'string') continue;
    if (!dernier || h.debut > dernier.debut) dernier = { debut: h.debut, groupe: h.groupe };
  }
  return dernier?.groupe ?? null;
}
