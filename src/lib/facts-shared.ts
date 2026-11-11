// Constantes partagées entre les pages /Facts/* pour éviter la duplication.
// La 17ᵉ législature a débuté le 18 juillet 2024 — toutes les requêtes
// filtrées sur le périmètre de la législature utilisent cette borne.

export const LEGISLATURE_17_START = '2024-07-18';

export const PROCEDURES_PROMULGABLES = new Set<string>([
  'Proposition de loi ordinaire',
  'Projet de loi ordinaire',
  'Projet ou proposition de loi constitutionnelle',
  'Projet ou proposition de loi organique',
  'Projet de ratification des traités et conventions',
  'Projet de loi de finances rectificative',
  'Projet de loi de financement de la sécurité sociale',
  "Projet de loi de finances de l'année",
  'Projet de loi relative aux résultats de la gestion et portant approbation des comptes',
]);

/**
 * Libellé de procédure tel qu'il arrive de la base → clé stable du namespace
 * `textTypes.short`, où vit la forme courte affichée, dans les deux langues.
 *
 * La table rend une clé et non un texte parce que ses valeurs servent aussi à
 * agréger : `PROCEDURES_FINANCIERES` teste l'appartenance sur ce qu'elle rend,
 * et la page amendements groupe ses dossiers dessus. Un libellé traduit à cette
 * place viderait le groupe en anglais et ferait diverger les pourcentages entre
 * les deux locales, sans erreur ni warning.
 *
 * Un libellé absent de la table (procédure rare, ou nouvelle côté Assemblée) est
 * affiché tel quel : voir `procedureLabel` dans les pages /Facts.
 */
export const PROCEDURE_KEY: Record<string, string> = {
  'Proposition de loi ordinaire': 'propositionLoi',
  'Projet de loi ordinaire': 'projetLoi',
  'Projet ou proposition de loi constitutionnelle': 'loiConstitutionnelle',
  'Projet ou proposition de loi organique': 'loiOrganique',
  'Projet de ratification des traités et conventions': 'projetRatification',
  'Projet de loi de finances rectificative': 'projetLoiFinancesRectif',
  'Projet de loi de financement de la sécurité sociale': 'projetLoiSS',
  "Projet de loi de finances de l'année": 'projetLoiFinances',
  "Proposition de loi présentée en application de l'article 11 de la Constitution":
    'propositionLoiReferendaire',
  'Résolution': 'resolution',
  'Résolution Article 34-1': 'resolutionArt341',
  "Rapport d'information sans mission": 'rapportSansMission',
  "Mission d'information": 'missionInformation',
  'Engagement de la responsabilité gouvernementale': 'engagementResponsabilite',
  "Commission d'enquête": 'commissionEnquete',
  'Responsabilité pénale du président de la république': 'responsabilitePenale',
  'Pétitions': 'petitions',
  // « relative » est la graphie de la base, pas une coquille d'ici.
  'Projet de loi relative aux résultats de la gestion et portant approbation des comptes':
    'projetLoiComptes',
};

// Lois financières, en clés de `PROCEDURE_KEY` et jamais en libellés affichés : ces
// groupes gardent la même composition quelle que soit la langue. Partagé entre
// `getAmendementsTotaux` (la moyenne hors lois financières que cite /Facts/amendements)
// et les graphiques de cette page. La loi d'approbation des comptes en fait partie :
// c'est une loi de finances au sens de la loi organique relative aux lois de finances.
export const PROCEDURES_FINANCIERES = new Set<string>([
  'projetLoiFinances',
  'projetLoiSS',
  'projetLoiFinancesRectif',
  'projetLoiComptes',
]);

export const estPromulgueeOuAppliquee = (statutFinal: string | null | undefined): boolean => {
  if (!statutFinal) return false;
  const s = statutFinal.toLowerCase();
  return s.includes('promulgu') || s.includes('appliqu');
};

// Textes sans vote chambre — exclus des dénominateurs AN et SN
export const EXCLUS_TOUS = new Set<string>([
  'Pétitions',
  "Allocution du Président de l'Assemblée nationale",
  "Commission d'enquête",
  "Mission d'information",
  "Rapport d'information sans mission",
]);

// Textes supplémentaires exclus du dénominateur SN (procédures AN uniquement)
export const EXCLUS_SN_SUPPL = new Set<string>([
  'Engagement de la responsabilité gouvernementale',
  'Résolution',
]);

// Codes d'actes qui décident d'un texte dans une chambre (lectures, nouvelle lecture,
// lecture définitive, lecture des conclusions de CMP). Les codes de CMP
// (`CMP-DEBATS-AN-DEC`, `CMP-DEBATS-SN-DEC`) ne commencent ni par `AN` ni par `SN` :
// un test `startsWith` seul les écarte. Une seule définition pour /Facts/delais et
// /Facts/succes-legislatif/efficacite, qui en avaient chacune une copie fausse.
export const isDecisionAN = (code: string): boolean =>
  code === 'CMP-DEBATS-AN-DEC' || (code.startsWith('AN') && code.endsWith('DEBATS-DEC'));
export const isDecisionSN = (code: string): boolean =>
  code === 'CMP-DEBATS-SN-DEC' || (code.startsWith('SN') && code.endsWith('DEBATS-DEC'));

// ──────────────────────────────────────────────────────────────────────
// Repères INSEE de population française
// Partagés entre les pages /Facts/representativite/* et /etat-des-lieux :
// la tuile du tableau de bord doit citer exactement le même repère que
// l'article qu'elle ouvre.
// ──────────────────────────────────────────────────────────────────────

// Âge moyen de la population française — INSEE, Bilan démographique,
// données provisoires au 1er janvier 2026.
export const INSEE_AGE_MOYEN = 43.1;

// Population française au 1ᵉʳ janvier 2026 — INSEE, estimations de population
// (35 531 milliers de femmes sur 69 082 milliers, données provisoires).
// Source : https://www.insee.fr/fr/statistiques/2381474 — vérifié le 2026-04-11.
export const FRANCE_PCT_FEMMES = 51.4;
