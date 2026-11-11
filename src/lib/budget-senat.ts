/**
 * Chiffres du budget 2025 du Sénat, lus par /Facts/budget/senat (chapitre 2 de
 * « Budget des chambres », après `budget-assemblee.ts`).
 *
 * Périmètre : les trois budgets du Sénat, mission institutionnelle, Jardin et
 * Musée du Luxembourg, que le rapport appelle ensemble « budget du Sénat ». Tout
 * est saisi depuis les documents officiels, en euros exacts. Sauf mention, la
 * page citée est celle du rapport de la commission spéciale sur les comptes 2025
 * (`DOCUMENTS.rapport`, n° 628, où page imprimée et page du PDF coïncident).
 *
 * Le découpage des dépenses en postes (POSTES) est calculé, pas recopié : le
 * tableau d'exécution ne publie que des chapitres à 3 chiffres, chacun découpé
 * d'après les tableaux détaillés du rapport, et le contrôle retombe sur le
 * tableau par destination de la p. 22. Le rangement et la génération de ce bloc
 * vivent hors du dépôt, avec les données extraites : `Data brute/Budget
 * chambres/Senat/scripts/` (`fonctions_senat_2025.py`, `genere_site_senat_2025.py`,
 * qui écrit aussi `public/data/budget-senat-2025.csv`). Regénérer plutôt que
 * retoucher un montant à la main, sinon le CSV publié et la page divergent.
 *
 * Importé seulement par la page, un Server Component. Les libellés vivent dans
 * le namespace `answerBudgetSenat` : les clés ci-dessous sont stables et ne
 * servent jamais d'intitulé. Mêmes clés de poste qu'à l'Assemblée quand le sens
 * est le même.
 */

export { POPULATION } from '@/lib/budget-assemblee';

export const EXERCICE = 2025;

/** Documents officiels cités par la page. */
export const DOCUMENTS = {
  /** Rapport d'information n° 628 (2025-2026) de la commission spéciale sur les comptes 2025. */
  rapport: 'https://www.senat.fr/rap/r25-628/r25-6281.pdf',
  /** Cour des comptes, rapport de certification des comptes 2025 (S2026-0572, avril 2026). */
  certification: 'https://www.senat.fr/fileadmin/cru-1789036660/Connaitre_le_Senat/Fiches_techniques/Controle_des_comptes_du_Senat/S2026-0572_Senat_2025_Rapport_de_certification.pdf',
  controle: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/le-controle-des-comptes-du-senat.html',
  indemnite: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/lindemnite-parlementaire.html',
  moyens: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/les-moyens-mis-a-la-disposition-des-senateurs.html',
  fraisMandat: 'https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/les-frais-de-mandat.html',
  /** Arrêté du Bureau n° 2017-272 sur les frais de mandat, consolidé au 15 décembre 2022. */
  arreteBureau: 'https://www.senat.fr/fileadmin/cru-1789036660/Connaitre_le_Senat/Fiches_techniques/frais_de_mandat/ab2017-272Consolide_Frais_de_mandat_15_12_2022.pdf',
  /** Arrêté de Questure n° 2017-1202, consolidé après l'arrêté n° 2025-952 du 14 octobre 2025. */
  arreteQuesture: 'https://www.senat.fr/fileadmin/cru-1789036660/Connaitre_le_Senat/Fiches_techniques/frais_de_mandat/AQ_2017-1202_Frais_de_mandat_01.pdf',
  /** Circulaire des Questeurs sur les frais de mandat, 2 décembre 2021. */
  circulaire: 'https://www.senat.fr/fileadmin/cru-1789036660/Connaitre_le_Senat/Fiches_techniques/frais_de_mandat/Circulaire_Questeurs_Frais_de_mandat.pdf',
  /** Comité de déontologie parlementaire, rapport d'activité 2024-2025, publié en avril 2026. */
  deontologie: 'https://www.senat.fr/fileadmin/cru-1789036660/Organisation_interne/Comite_de_deontologie/Rapports_d_activite/RapportActivite2024-2025.pdf',
  /** Rapport spécial « Pouvoirs publics » du projet de loi de finances pour 2026, 24 novembre 2025. */
  plf2026: 'https://www.senat.fr/rap/l25-139-322/l25-139-322_mono.html',
  /** Rapport de la commission spéciale sur les comptes 2024 (n° 603, 7 mai 2025). */
  rapport2024: 'https://www.senat.fr/rap/r24-603/r24-603_mono.html',
  /** Comptes rendus du Bureau du Sénat, dont le 15 mai 2025, le 28 mai et le 2 juillet 2026. */
  bureau: 'https://www.senat.fr/vos-senateurs/organisation-interne/bureau/comptes-rendus-des-reunions-du-bureau-du-senat.html',
  groupes: 'https://www.senat.fr/vos-senateurs/groupes-politiques/les-comptes-des-groupes-politiques.html',
  /** Liste publique des collaborateurs, édition du 13 septembre 2026. */
  agas: 'https://www.senat.fr/pubagas/liste_senateurs_collaborateurs.pdf',
  deports: 'https://data.senat.fr/registre-des-deports/',
  cadeaux: 'https://www.senat.fr/fileadmin/cru-1766394347/Connaitre_le_Senat/Fiches_techniques/Deontologie/Liste_cadeaux_avantages_invitations.pdf',
  /** Bilan démographique 2025 de l'Insee, déjà cité par le chapitre 1. */
  insee: 'https://www.insee.fr/fr/statistiques/8719824',
  csv: '/data/budget-senat-2025.csv',
} as const;

/**
 * Les trois budgets additionnés (p. 9, 17, 23, 70, 82). Le Sénat finit l'année en
 * excédent : dotation et recettes propres dépassent la dépense, et le surplus
 * retourne aux disponibilités.
 */
export const TOTAUX = {
  budgetInitial: 378_941_751,
  /** Budget réparti en début d'année, reports de travaux pluriannuels compris (p. 9). */
  budgetReparti: 381_842_114,
  dotationEtat: 353_470_900,
  /** Hausse de dotation abandonnée par amendement des Questeurs à l'automne 2024 (p. 11). */
  hausseAbandonnee: 6_000_000,
  /** Crédits mis en réserve en début d'année pour tenir le gel (p. 11). */
  miseEnReserve: 3_700_000,
  /** Sénat 7 264 043 €, Jardin 853 057 €, Musée 151 297 € (p. 24, 69, 82). */
  recettesPropres: 8_268_397,
  depense: 358_746_346,
  solde: 2_992_951,
  /**
   * Prélèvement sur les disponibilités inscrit au budget réparti, pour les trois
   * budgets (lignes V des p. 23, 70 et 82) : « finalement pas rendu nécessaire » (p. 14).
   */
  prelevementPrevu: 21_624_630,
  /** Excédent des caisses de sécurité sociale reversé au budget, jamais prévu (p. 14 et 106). */
  excedentCaissesSecu: 955_186,
  /**
   * Somme des lignes du découpage, donc des POSTES : 4 € de moins que `depense`,
   * les montants du rapport étant arrondis à l'euro ligne par ligne.
   */
  sommeLignes: 358_746_342,
} as const;

/** Répartition entre les trois budgets (p. 23, 70, 82). */
export const ENTITES = {
  senat: 345_622_022,
  jardin: 12_931_821,
  musee: 192_503,
  dotationJardin: 11_606_900,
  redevanceMusee: 151_297,
  concessionsJardin: 757_471,
} as const;

/**
 * Budget et comptabilité (p. 91-95) : le compte de résultat « tous budgets »
 * amortit les travaux et compte les opérations financières de la réserve.
 */
export const COMPTABILITE = {
  resultatComptable: 11_931_793,
  chargesTotales: 434_436_372,
} as const;

/** Dotation de Public Sénat, reçue de l'État et reversée en entier à la chaîne (p. 117 et 187). */
export const PUBLIC_SENAT = 17_648_000;

export interface SousPoste {
  cle: string;
  montant: number;
}

export interface Poste {
  cle: string;
  montant: number;
  sousPostes: SousPoste[];
}

/** Généré par `genere_site_senat_2025.py`, trié par montant décroissant. */
export const POSTES: Poste[] = [
  { cle: 'personnel', montant: 114742924, sousPostes: [
    { cle: 'salairesFonctionnaires', montant: 91090108 },
    { cle: 'salairesContractuels', montant: 8951524 },
    { cle: 'cotisations', montant: 4789442 },
    { cle: 'cabinet', montant: 4466065 },
    { cle: 'sante', montant: 1924788 },
    { cle: 'impotsSalaires', montant: 1117812 },
    { cle: 'recrutement', montant: 1085364 },
    { cle: 'restauration', montant: 863835 },
    { cle: 'rapatriement', montant: 238575 },
    { cle: 'autresPersonnel', montant: 215411 },
  ] },
  { cle: 'collaborateurs', montant: 68282800, sousPostes: [
    { cle: 'agas', montant: 68282800 },
  ] },
  { cle: 'fraisMandat', montant: 38646708, sousPostes: [
    { cle: 'afm', montant: 25640763 },
    { cle: 'hebergement', montant: 3791388 },
    { cle: 'avion', montant: 3157074 },
    { cle: 'taxis', montant: 1418445 },
    { cle: 'train', montant: 1384096 },
    { cle: 'telephone', montant: 1283201 },
    { cle: 'affranchissement', montant: 1205959 },
    { cle: 'avanceInformatique', montant: 383764 },
    { cle: 'representation', montant: 349019 },
    { cle: 'autresTransports', montant: 32999 },
  ] },
  { cle: 'retraites', montant: 36509846, sousPostes: [
    { cle: 'anciensFonctionnaires', montant: 22538805 },
    { cle: 'anciensSenateurs', montant: 13971041 },
  ] },
  { cle: 'senateurs', montant: 35197263, sousPostes: [
    { cle: 'indemnites', montant: 33210725 },
    { cle: 'protectionSociale', montant: 1591125 },
    { cle: 'retourEmploi', montant: 211488 },
    { cle: 'restaurant', montant: 123325 },
    { cle: 'formation', montant: 60600 },
  ] },
  { cle: 'batiments', montant: 20115094, sousPostes: [
    { cle: 'entretien', montant: 5569007 },
    { cle: 'equipements', montant: 3326769 },
    { cle: 'energie', montant: 3292820 },
    { cle: 'travaux', montant: 2842298 },
    { cle: 'loyers', montant: 2216374 },
    { cle: 'nettoyage', montant: 1199192 },
    { cle: 'etudes', montant: 1115744 },
    { cle: 'impotsLocaux', montant: 552890 },
  ] },
  { cle: 'groupes', montant: 12974571, sousPostes: [
    { cle: 'subventionGroupes', montant: 12974571 },
  ] },
  { cle: 'jardinMusee', montant: 11504397, sousPostes: [
    { cle: 'jardinPersonnel', montant: 7533360 },
    { cle: 'jardinFonctionnement', montant: 2211564 },
    { cle: 'jardinInvestissement', montant: 1566970 },
    { cle: 'musee', montant: 192503 },
  ] },
  { cle: 'fonctionnement', montant: 6383787, sousPostes: [
    { cle: 'vehicules', montant: 1832416 },
    { cle: 'avocats', montant: 1028629 },
    { cle: 'fournitures', montant: 856421 },
    { cle: 'courrier', montant: 687585 },
    { cle: 'receptions', montant: 601402 },
    { cle: 'divers', montant: 410692 },
    { cle: 'assurances', montant: 271006 },
    { cle: 'etudesDiverses', montant: 198074 },
    { cle: 'mobilier', montant: 196502 },
    { cle: 'impressions', montant: 172845 },
    { cle: 'garde', montant: 94772 },
    { cle: 'subventions', montant: 33443 },
  ] },
  { cle: 'communication', montant: 4704115, sousPostes: [
    { cle: 'video', montant: 2655274 },
    { cle: 'comm', montant: 1462107 },
    { cle: 'photo', montant: 586734 },
  ] },
  { cle: 'informatique', montant: 4558989, sousPostes: [
    { cle: 'maintenance', montant: 2973796 },
    { cle: 'materiel', montant: 634067 },
    { cle: 'licences', montant: 514731 },
    { cle: 'developpement', montant: 229780 },
    { cle: 'reseaux', montant: 127612 },
    { cle: 'logiciels', montant: 79003 },
  ] },
  { cle: 'activite', montant: 3464362, sousPostes: [
    { cle: 'missions', montant: 2024576 },
    { cle: 'international', montant: 913523 },
    { cle: 'presidence', montant: 428583 },
    { cle: 'offices', montant: 97680 },
  ] },
  { cle: 'patrimoine', montant: 1661486, sousPostes: [
    { cle: 'documentation', montant: 1101630 },
    { cle: 'oeuvres', montant: 559856 },
  ] },
];

/**
 * Découpage : ce que le script a dû estimer ou déduire, dit par la méthodologie.
 * La cotisation de la mission institutionnelle à la caisse du personnel est la
 * cotisation reçue par la caisse (p. 104) moins la part publiée du Jardin
 * (p. 77-78) ; le reste de personnel est ce que le tableau par destination
 * (p. 22) compte en plus des chapitres identifiés, pris sur le chapitre 625.
 */
export const DECOUPAGE = {
  cotisationCaissePersonnel: 13_578_213,
  cotisationCaissePersonnelJardin: 950_285,
  restePersonnelSansDetail: 215_411,
  /** Dépenses du Jardin (retraites et pensions de son personnel) rangées dans le poste « Retraites ». */
  jardinVersRetraites: 1_619_925,
} as const;

/**
 * Subvention 2025 de chaque groupe, en milliers d'euros comme le tableau de la
 * note 7.3.2 (p. 187). Ce tableau totalise 12 914 k€, quand le compte 658110 en
 * compte 12 974 571 € (p. 52-53) : écart non expliqué, dit dans `ERREURS_SOURCE`.
 * Noms officiels, affichés tels quels dans les deux langues.
 */
export const GROUPES = [
  { nom: 'Les Républicains', milliers: 4_209 },
  { nom: 'Socialiste, Écologiste et Républicain', milliers: 2_286 },
  { nom: 'Union Centriste', milliers: 2_086 },
  { nom: 'Les Indépendants – République et Territoires', milliers: 882 },
  { nom: 'Rassemblement des démocrates progressistes et indépendants', milliers: 871 },
  { nom: 'Communiste Républicain Citoyen et Écologiste – Kanaky', milliers: 839 },
  { nom: 'Écologiste – Solidarité et Territoires', milliers: 807 },
  { nom: 'Rassemblement Démocratique et Social Européen', milliers: 788 },
  { nom: 'Réunion administrative des Sénateurs non-inscrits', milliers: 146 },
] as const;

/**
 * Indemnité parlementaire mensuelle, inchangée toute l'année 2025 : barème du
 * 1er janvier 2024 (fiche `DOCUMENTS.indemnite`), le point d'indice n'ayant
 * « pas évolué depuis juillet 2023 » (p. 45).
 */
export const INDEMNITE = {
  brute: 7_637.39,
  base: 5_931.95,
  residence: 177.96,
  fonction: 1_527.48,
  nette: 5_676.12,
  /**
   * Indemnité de fonction versée en plus aux sénateurs qui occupent une fonction
   * particulière, même fiche : du secrétaire du Bureau au Président du Sénat.
   * La fiche emploie le même nom que pour `fonction`, la part que touchent tous
   * les sénateurs ; l'Assemblée parle, elle, d'« indemnités spéciales »
   * (`INDEMNITE_SPECIALE` de `budget-assemblee.ts`).
   */
  fonctionParticuliereMin: 748.7,
  fonctionParticuliereMax: 7_591.58,
} as const;

/** Sièges de sénateurs : les moyennes par sénateur se calculent sur ce nombre (p. 186). */
export const SIEGES = 348;

/**
 * Les moyens du mandat : plafonds de l'arrêté de Questure (`DOCUMENTS.arreteQuesture`,
 * art. 3 à 16), montants de la circulaire et du rapport (p. 48-52).
 */
export const MANDAT = {
  /** Avance générale mensuelle depuis le 1er janvier 2024 (p. 51). */
  avanceGenerale: 6_600,
  avanceGeneraleAvant2024: 5_900,
  majorationOutreMer: 375,
  majorationEtranger: 2_500,
  avanceHebergementMax: 1_500,
  avanceRepresentationMax: 750,
  avanceInformatiqueTroisAns: 6_000,
  telephoneAnnuel: 7_300,
  /** Taxis et transports franciliens, art. 4 : 3 900 €, et jusqu'à 11 700 € pour certaines fonctions. */
  taxisAnnuel: 3_900,
  taxisAnnuelMaxFonctions: 11_700,
  passagesAvion: 80,
  /**
   * Dépenses justifiées par une simple attestation, sans pièce d'un tiers :
   * 13,4 % de l'avance arrondis à l'euro supérieur, soit 885 € par mois en moyenne
   * (guide pratique p. 18) et 10 620 € par an (circulaire p. 11). Le mensuel est
   * cité : 13,4 % de 79 200 € donnerait 10 613 € et ferait croire à une erreur.
   */
  sansJustificatifMensuel: 885,
  sansJustificatifAnnuel: 10_620,
  /** Avance non dépensée remise à disposition l'année suivante, au plus (arrêté de Questure, art. 14). */
  reportMax: 6_600,
  /** Créances diverses au 31 décembre 2025, « principalement » des avances non consommées (p. 174). */
  creancesDiverses: 8_273_000,
  /** Crédit brut mensuel par sénateur depuis le 1er juillet 2023, strictement mensuel (p. 48). */
  creditCollaborateur: 8_827.4,
  collaborateursMax: 5,
  /** Subvention exacte à l'AGAS (p. 48) ; le poste en garde 1 € de moins, arrondi du chapitre 658. */
  subventionAgas: 68_282_801,
  /** Subvention 2023, année de renouvellement et de licenciements (rapport 2025, p. 49). */
  subventionAgas2023: 69_290_241,
  /** Moyens fournis en plus à l'AGAS : neuf agents du Sénat et des locaux (p. 187). */
  agentsMisADisposition: 9,
  agentsMisADispositionCout: 912_000,
  locauxAgas: 175_000,
  congesNonPris: 3_300_000,
  /**
   * Listes publiques de l'AGAS, édition du 13 septembre 2026 (`DOCUMENTS.agas`),
   * seul décompte publié : aucun chiffre au 31 décembre 2025.
   */
  contratsCollaborateurs: 907,
  personnesCollaborateurs: 854,
} as const;

/**
 * Contrôle des frais de mandat : rapport d'activité du Comité de déontologie
 * 2024-2025 (`DOCUMENTS.deontologie`, p. 15-18). La campagne de 2025 porte sur les
 * dépenses de 2024 ; le bilan des dépenses 2025 n'est pas publié au 13 septembre 2026.
 */
export const CONTROLE = {
  senateursControles: 362,
  fraisDeclares: 29_900_000,
  justificatifs: 149_685,
  tauxControleMoyen: 0.521,
  tauxControleMax: 0.864,
  controlesApprofondis: 73,
  controlesTransversaux: 289,
  membresComite: 9,
  membresCommissionSpeciale: 13,
  recommandationsCour: 6,
  recommandationsCour2024: 9,
  /**
   * Transports, téléphone et courrier payés directement par le Sénat (p. 50),
   * que l'arrêté du Bureau exclut du contrôle du Comité (art. 16).
   */
  prisesEnChargeDirectes: 5_992_614 + 1_283_201 + 1_205_959,
} as const;

/**
 * Caisses de retraites (p. 99-105), placements (p. 178) et engagements (p. 185-186).
 * Les caisses paient leurs pensions avec cotisations et placements, « sans
 * solliciter de subvention » (p. 99) : le budget ne leur verse que la cotisation
 * d'employeur et les accessoires de pension.
 */
export const RETRAITES = {
  pensionsAnciensSenateurs: 41_978_720,
  cotisationsCaisseSenateurs: 13_332_198,
  deficitCaisseSenateurs: 28_646_523,
  pensionnesSenateurs: 746,
  pensionsPersonnel: 63_991_035,
  cotisationsCaissePersonnel: 18_504_030,
  deficitCaissePersonnel: 45_490_889,
  retraitesPersonnel: 1_258,
  /**
   * Placements des deux caisses (K€ du tableau p. 178, en euros). Les plus-values
   * se calculent sur le prix d'achat et hors intérêts à recevoir : achat 1 363 M€
   * + plus-values 380 M€ + intérêts 18 M€ = marché 1 762 M€. Le bilan, lui, garde
   * le prix d'achat diminué de 12 M€ de provisions (1 352 M€) : bilan et marché ne
   * se soustraient donc pas pour retrouver les plus-values.
   */
  placementsAchat: 1_363_399_000,
  placementsMarche: 1_761_716_000,
  plusValuesLatentes: 380_173_000,
  interetsARecevoir: 18_144_000,
  /** Valeur de marché des placements de chaque caisse, à comparer à ses engagements de retraite. */
  placementsMarcheSenateurs: 847_876_000,
  placementsMarchePersonnel: 913_840_000,
  engagementsRetraiteSenateurs: 771_052_000,
  engagementsRetraitePersonnel: 1_675_747_000,
  /** Tous engagements de retraite et avantages similaires, santé comprise. */
  engagementsTotaux: 2_717_165_000,
  engagementsTotaux2024: 2_946_317_000,
  tauxActualisation2024: 0.0341,
  tauxActualisation2025: 0.0402,
  /** Capital promis à des fonds de capital-investissement, pas encore versé (p. 187). */
  capitalRestantAAppeler: 100_000_000,
} as const;

/**
 * Qui travaille au Sénat au 31 décembre 2025 (p. 186). Pour les fonctionnaires,
 * le rapport compte des emplois budgétaires, des postes et non des personnes
 * (p. 58), que l'annexe reprend sous « Personnels du Sénat » ; les deux pages ne
 * donnent pas le même chiffre pour 2024.
 */
export const AGENTS = {
  senateurs: 348,
  fonctionnaires: 1_096,
  fonctionnaires2024Texte: 1_068,
  fonctionnaires2024Annexe: 1_067,
  contractuels: 151,
  contractuels2024: 144,
} as const;

/**
 * Réserve et perspectives. Réserve spéciale d'intervention (RSI) au bilan
 * (p. 173) ; projections du rapport spécial sur le projet de loi de finances
 * pour 2026 (`DOCUMENTS.plf2026`) ; budget 2027 et autonomie : Bureau du 28 mai
 * et du 2 juillet 2026 (`DOCUMENTS.bureau`).
 */
export const AVENIR = {
  reserveBilan2025: 136_549_000,
  reserveMarche2025: 142_693_000,
  reserveFin2026: 96_100_000,
  reserveFin2027: 68_600_000,
  reserveFin2028: 32_600_000,
  /**
   * Prélèvement 2025 que le même rapport prévoyait encore en novembre 2025 : ses
   * projections partent d'avant l'excédent de 2025, sur une base non publiée.
   */
  prelevementPrevu2025ParLeRapport: 18_720_000,
  moisDeDepensesRequis: 3,
  prelevementPrevu2026: 22_140_000,
  investissement2026: 16_200_000,
  investissement2027: 23_000_000,
  investissement2028: 28_100_000,
  /** + 7,1 M€, « + 2 % » (Bureau du 2 juillet 2026) : la page cite le pourcentage, les deux montants étant arrondis. */
  dotation2027: 360_500_000,
  depenses2027: 383_300_000,
  anneeAutonomieMenacee: 2029,
} as const;

/**
 * Déclarations publiques, décomptées dans les fichiers du Sénat au 13 septembre
 * 2026 : registre des déports (`DOCUMENTS.deports`) et liste des cadeaux et
 * invitations de plus de 150 € (`DOCUMENTS.cadeaux`), par date de réception.
 */
export const TRANSPARENCE = {
  deports2025: 3,
  cadeaux2025: 18,
  deplacements2025: 36,
} as const;

/**
 * Contradictions internes du rapport, citées telles quelles : transports (texte
 * p. 52 contre tableau p. 50, le tableau est retenu), groupes (p. 52 contre
 * p. 187), réserve (p. 96 contre p. 97 et 173). Les dates « 2025 » des p. 7, 86
 * et 87 désignent une transmission et deux réunions de 2026.
 */
export const ERREURS_SOURCE = {
  avion: [3_157_074, 3_154_197],
  ratp: [204_506, 205_506],
  groupes: [12_974_571, 12_914_000],
  reserve: [136_549_000, 130_000_000],
} as const;

/** Dépenses réalisées et solde des trois budgets, rapport de chaque année (2025 : p. 17). */
export const HISTORIQUE = [
  { annee: 2020, depense: 332_667_118, solde: -1_360_780, evenement: 'crise' },
  { annee: 2021, depense: 328_185_587, solde: 1_935_833, evenement: null },
  { annee: 2022, depense: 348_380_504, solde: -1_528_652, evenement: 'inflation' },
  { annee: 2023, depense: 358_319_092, solde: -4_166_527, evenement: 'renouvellement' },
  { annee: 2024, depense: 357_234_909, solde: 5_743_998, evenement: 'dotation' },
  { annee: 2025, depense: 358_746_346, solde: 2_992_951, evenement: 'gel' },
] as const;
