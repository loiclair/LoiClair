// src/lib/mcp/codes.ts
//
// Traduction des valeurs de la base vers les codes stables que le serveur MCP
// rend à ses appelants. Aucune chaîne sortie d'ici n'est un libellé affichable :
// c'est l'assistant qui formule dans la langue de son utilisateur, et un libellé
// français servi comme identifiant deviendrait une clé instable le jour où il
// serait traduit (règle du projet sur les libellés qui ne sont jamais des clés).
//
// Appelé par les trois modules d'outils (`elus.ts`, `lois.ts`, `chiffres.ts`).

import { STATUT_MAP } from '@/lib/statut';
import { PROCEDURE_KEY } from '@/lib/facts-shared';

/** Libellé `statut_final` tel qu'il est en base → slug d'URL du site. */
const STATUT_VERS_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(STATUT_MAP).map(([slug, libelle]) => [libelle, slug]),
);

/**
 * Code stable du statut d'un dossier.
 *
 * Rend `null` sur une valeur inconnue : mieux vaut un champ vide qu'un code
 * inventé, qu'un assistant présenterait comme un fait.
 */
export function codeStatut(statutFinal: string | null | undefined): string | null {
  if (!statutFinal) return null;
  return STATUT_VERS_CODE[statutFinal] ?? null;
}

/**
 * Valeurs de `statut_final` qu'un code de statut désigne, pour filtrer.
 *
 * C'est la réciproque exacte de `codeStatut`, et elle doit le rester : un
 * libellé que l'une rendrait sans que l'autre le cherche laisserait des
 * dossiers dans un statut sans jamais les rendre dans sa liste.
 *
 * Rend une liste vide sur un code inconnu : l'appelant n'applique alors aucun
 * filtre plutôt que de chercher une valeur qui n'existe pas.
 */
export function valeursStatut(code: string): string[] {
  const libelle = STATUT_MAP[code];
  return libelle ? [libelle] : [];
}

/** Code stable de la procédure, repris tel quel de la table partagée avec /Facts. */
export function codeProcedure(procedureLibelle: string | null | undefined): string | null {
  if (!procedureLibelle) return null;
  return PROCEDURE_KEY[procedureLibelle] ?? null;
}

export type CodeChambre = 'assemblee' | 'senat';

/**
 * Code stable de la chambre.
 *
 * `scrutins.chambre` porte les libellés complets des dumps officiels
 * (« Assemblée Nationale », « Sénat »), `activite_elus_mv.chambre` porte des
 * sigles (« AN », « SN ») : les deux formes arrivent ici selon la table lue.
 */
export function codeChambre(valeur: string | null | undefined): CodeChambre | null {
  if (!valeur) return null;
  const v = valeur.toLowerCase();
  if (v === 'an' || v.startsWith('assembl')) return 'assemblee';
  if (v === 'sn' || v.startsWith('sénat') || v.startsWith('senat')) return 'senat';
  return null;
}

/**
 * Position d'un élu sur un scrutin.
 *
 * Huit valeurs : les six seaux de `votes_nominatifs`, un scrutin sans aucun
 * détail nominatif, et le cas de la motion de censure. Trois d'entre elles se
 * lisent de travers si on ne les nomme pas avec soin, et le contresens
 * porterait sur une personne réelle :
 *
 *   - `aucun_vote` : la chambre n'a enregistré aucune position à son nom. Ce
 *     n'est PAS une absence de l'hémicycle. Le site ne le dit jamais autrement
 *     (D-117), pour deux raisons que la donnée impose : un élu absent qui
 *     délègue son vote est enregistré comme votant (la délégation pèse jusqu'à
 *     un tiers des suffrages d'un scrutin solennel), et un élu présent qui
 *     n'appuie pas tombe dans ce seau.
 *   - `fonction_institutionnelle` : présidence de séance et statuts assimilés.
 *     Distinct de `non_votant`, qui est une position déclarée.
 *   - `non_recense` : sur une motion de censure, l'article 49 de la
 *     Constitution ne fait recenser que les voix favorables. Hors la présidence
 *     de séance, qui garde son code, tout le reste tombe dans le seau `absents`
 *     sans avoir été opposé ni absent : la position n'était pas enregistrable.
 *     `scrutin-affichage.ts` porte la même règle pour les barres du site,
 *     mesurée sur les 23 scrutins de type MOC de la 17ᵉ législature.
 *
 * Le seau brut s'appelle `absents` en base. On ne relaie jamais ce nom : c'est
 * le nom du champ, plus que la description de l'outil, que le modèle lit à
 * chaque réponse.
 */
export type CodePosition =
  | 'pour'
  | 'contre'
  | 'abstention'
  | 'non_votant'
  | 'aucun_vote'
  | 'fonction_institutionnelle'
  | 'non_recense'
  | 'non_publie';

/**
 * Type de vote d'une motion de censure, tel que `scrutins.type_vote_code` le
 * porte. Le Sénat ne publie pas de type, la colonne y est nulle.
 */
export const TYPE_VOTE_MOTION_CENSURE = 'MOC';

/** Seau de `scrutins.votes_nominatifs` → code de position. */
export const SEAU_VERS_POSITION: Record<string, CodePosition> = {
  pour: 'pour',
  contre: 'contre',
  abstentions: 'abstention',
  nonVotants: 'non_votant',
  absents: 'aucun_vote',
  institutionnels: 'fonction_institutionnelle',
};

/**
 * Raison pour laquelle un élu n'a ni score d'activité ni rang.
 *
 * Un `score` vide se lit « il ne fait rien » si rien ne dit pourquoi. Trois
 * exclusions sont documentées et assumées : les présidents des deux chambres
 * (D-123), les présidents de groupe (migration du 2026-09-15), et les mandats
 * de moins de 180 jours (D-031), qu'un score normalisé par la durée rendrait
 * incomparables.
 *
 * Vérifié en base le 2026-09-20, et ces trois cas sont exhaustifs : sur les
 * 925 lignes de la vue, les 47 sans score sont exactement 2 présidents de
 * chambre, 18 présidents de groupe et 27 mandats trop récents.
 */
export type CodeExclusion =
  | 'president_chambre'
  | 'president_groupe'
  | 'mandat_moins_180_jours';

/** Nombre de jours de mandat en deçà duquel un élu sort du classement (D-031). */
export const SEUIL_JOURS_CLASSEMENT = 180;
