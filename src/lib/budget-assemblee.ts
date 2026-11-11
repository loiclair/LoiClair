/**
 * Chiffres du budget 2025 de l'Assemblée nationale, lus par /Facts/budget/assemblee-nationale.
 *
 * Aucune source ouverte structurée n'existe après 2017 (le jeu budgétaire de
 * data.assemblee-nationale.fr s'arrête là) : tout est saisi depuis les documents
 * officiels publiés sur assemblee-nationale.fr/dyn/compte-an, en euros exacts.
 * La page citée en commentaire est la page imprimée du document.
 *
 * Le découpage des dépenses en postes (POSTES) est calculé, pas recopié : chaque
 * article du tableau d'exécution est rangé dans un seul poste selon ce qu'il
 * paie, puis sommé. Le rangement et la génération de ce bloc vivent hors du
 * dépôt, avec les données extraites : `Data brute/Budget chambres/AN/scripts/`
 * (`fonctions_an_2025.py`, `genere_site_an_2025.py`, qui écrit aussi
 * `public/data/budget-assemblee-nationale-2025.csv`). Regénérer plutôt que
 * retoucher un montant à la main, sinon le CSV publié et la page divergent.
 *
 * Importé seulement par la page, un Server Component. Les libellés vivent dans
 * le namespace `answerBudgetAssemblee` : les clés ci-dessous sont stables et ne
 * servent jamais d'intitulé.
 */

export const EXERCICE = 2025;

/** Documents officiels cités par la page. */
export const DOCUMENTS = {
  comptes: 'https://www.assemblee-nationale.fr/dyn/compte-an',
  questeurs: 'https://www2.assemblee-nationale.fr/static/comptes/Rapport_du_college_des_Questeures_commission_speciale_2025.pdf',
  commission: 'https://www2.assemblee-nationale.fr/static/comptes/Rapport_comptes_2025.pdf',
  certification: 'https://www2.assemblee-nationale.fr/static/comptes/Certification_des_comptes_2025.pdf',
  etatsFinanciers: 'https://www2.assemblee-nationale.fr/static/comptes/Etats_financiers_et_annexe_2025-signes.pdf',
  deontologue: 'https://www.assemblee-nationale.fr/dyn/contenu/visualisation/1110434/file/Rapport_Deontologue_2025.pdf',
  csv: '/data/budget-assemblee-nationale-2025.csv',
  /** Fiche de synthèse n° 7, « La situation matérielle du député », mise à jour en janvier 2026. */
  fiche: 'https://www.assemblee-nationale.fr/dyn/synthese/deputes-groupes-parlementaires/la-situation-materielle-du-depute',
  /** Bilan démographique 2025 de l'Insee : population au 1er janvier 2026. */
  insee: 'https://www.insee.fr/fr/statistiques/8719824',
  /** Arrêté du Bureau n° 12/XV sur les frais de mandat, version mise en ligne le 7 mai 2025. */
  arrete: 'https://www2.assemblee-nationale.fr/static/12_XV_Bureau_frais%20de%20mandat.pdf',
  /**
   * Conseil d'État, 27 juin 2019, n° 427725 (Regards Citoyens) : les relevés du
   * compte de frais de mandat ne sont pas des documents administratifs
   * communicables (considérant 13).
   */
  conseilEtat: 'https://www.conseil-etat.fr/fr/arianeweb/CE/decision/2019-06-27/427725',
  /** Rapport spécial « Pouvoirs publics » du Sénat sur le projet de loi de finances pour 2026 : dotations des chaînes parlementaires. */
  plf2026: 'https://www.senat.fr/rap/l25-139-322/l25-139-322_mono.html',
} as const;

/**
 * Dotation 2025 de la chaîne LCP-Assemblée nationale, qui ne compte pas dans le
 * budget de l'Assemblée : l'État la finance par la ligne « La Chaîne
 * parlementaire » de la mission « Pouvoirs publics » (35 245 822 € en 2025),
 * partagée avec Public Sénat (17 648 000 €, rapport du Sénat sur ses comptes 2025,
 * p. 117). Le montant de LCP n'est pas publié seul pour 2025 : il se déduit de ces
 * deux chiffres (`DOCUMENTS.plf2026`), et retombe sur la dotation 2026 annoncée,
 * 17 798 900 €, soit 201 078 € de plus.
 */
export const DOTATION_LCP = 17_597_822;

/**
 * Allocation d'aide au retour à l'emploi des anciens députés, l'équivalent du
 * chômage : fiche n° 7 (`DOCUMENTS.fiche`) pour le montant, les durées et la
 * cotisation, rapport des Questeurs p. 48 pour les allocataires fin 2025. Le
 * sous-poste « retourEmploi » est la subvention d'équilibre que l'Assemblée verse
 * au fonds qui la paie, en plus des cotisations.
 */
export const RETOUR_EMPLOI = {
  allocationMensuelle: 4_353.31,
  cotisationMensuelle: 76.37,
  allocatairesFin2025: 55,
} as const;

/**
 * Avance de frais de mandat mensuelle en 2025, versée en entier chaque mois.
 * Du 1er mai : arrêté du Bureau n° 12/XV (`DOCUMENTS.arrete`, article 2), après le
 * transfert du téléphone et de l'expertise comptable. Avant mai : 5 950 € depuis
 * l'arrêté n° 50/XVI du 24 janvier 2024, montant rapporté par LCP, le texte
 * consolidé ne gardant que le montant en vigueur.
 */
export const AVANCE_MENSUELLE_2025 = {
  avantMai: 5_950,
  metropoleOutreMer: 6_353,
  pacifique: 6_553,
  etranger: 6_463,
} as const;

/**
 * Population de la France (métropole et DOM) au 1er janvier 2026, estimée par
 * l'Insee (`DOCUMENTS.insee`) : sert au coût par habitant de la réponse.
 */
export const POPULATION = 69_100_000;

/** Rapport des Questeurs p. 16, sauf mention. */
export const TOTAUX = {
  budgetVote: 643_185_200,
  /** Dotation demandée à l'origine, avant le gel voté par amendement (p. 7-8). */
  dotationDemandee: 617_977_578,
  dotationEtat: 607_647_569,
  recettesPropres: 5_716_355,
  depense: 629_261_451,
  solde: -15_897_527,
  /**
   * Somme des articles du tableau d'exécution, donc des POSTES : 5 € de moins
   * que `depense`, écart d'arrondi présent dans le rapport lui-même.
   */
  sommeArticles: 629_261_446,
} as const;

/**
 * Comment le déficit a été couvert, et l'état des réserves : rapport de la
 * commission spéciale p. 8 et p. 10-11. Le déficit 2025 n'a pas touché aux
 * réserves, contrairement à ce que laisse croire l'expression « prélèvement sur
 * les réserves » du budget voté. Les intérêts du placement de la dotation sont
 * des produits hors budget (rapport des Questeurs p. 121) : ils ne figurent pas
 * dans `TOTAUX.recettesPropres`, qui ne compte que les recettes budgétaires.
 */
export const RESERVES = {
  produitsPlacementDotation: 10_600_000,
  reservesFin2025: 237_200_000,
  plancherPrudentiel: 150_000_000,
  /** Rythme de déficit sous lequel la commission situe l'épuisement vers 2032. */
  deficitHypothese: 30_000_000,
  anneeEpuisementTheorique: 2032,
  deficitPrevu2026: -34_140_000,
} as const;

/** Coût net définitif de la dissolution de 2024 (rapport des Questeurs 2024, p. 10). */
export const COUT_DISSOLUTION = 16_927_360;

/**
 * L'informatique telle que le rapport la présente, en deux chapitres séparés :
 * investissement (p. 26) et prestations extérieures (p. 102). Le poste
 * « Informatique » de la page y ajoute petit matériel, téléphonie et
 * hébergement du site, et part des articles eux-mêmes : son investissement
 * vaut 3,96 M€, pas les 4,06 M€ du périmètre de la direction informatique.
 */
export const INFORMATIQUE_RAPPORT = { investissement: 4_060_000, prestations: 8_960_000 } as const;

/**
 * Budget et comptabilité ne comptent pas pareil (rapport des Questeurs p. 16) :
 * le résultat comptable écarte les investissements, amortis sur plusieurs
 * années, et ajoute les intérêts de placement et autres produits hors budget.
 */
export const COMPTABILITE = { resultatComptable: 5_419_310 } as const;

/**
 * Principal placement des réserves, un fonds commun de placement inscrit à sa
 * valeur d'achat alors que sa valeur liquidative est trois fois supérieure
 * (états financiers, note 4, p. 33).
 */
export const PLACEMENTS = { fondsValeurBilan: 63_600_000, fondsValeurReelle: 197_150_000 } as const;

/**
 * Dotation de fonctionnement parlementaire brute mensuelle depuis le
 * 1er janvier 2026, qui fusionne l'avance de frais de mandat et la dotation
 * matérielle (rapport du Déontologue p. 33). Cinq montants selon le lieu
 * d'élection : la page cite les deux extrêmes.
 */
export const DOTATION_MENSUELLE = { metropole: 7_238.04, horsEurope: 8_239.1 } as const;

/**
 * Indemnité parlementaire brute mensuelle, la même en 2025 et en 2026 : fiche de
 * synthèse n° 7 de l'Assemblée (`DOCUMENTS.fiche`), et aucune revalorisation du
 * point d'indice depuis les 5 points du 1er janvier 2024 (rapport des Questeurs
 * p. 46). Le net cité par la fiche vaut pour 2026 : la page ne l'affiche pas.
 */
export const INDEMNITE_BRUTE = 7_637.39;

/**
 * Indemnités spéciales mensuelles brutes versées en plus aux députés qui occupent
 * une fonction particulière (fiche n° 7, `DOCUMENTS.fiche`) : du secrétaire du
 * Bureau à la présidence de l'Assemblée. Le nom suit la fiche : son « indemnité
 * de fonction » (1 527,48 €) est autre chose, une part de `INDEMNITE_BRUTE` que
 * touchent tous les députés. Montants de la fiche mise à jour en janvier 2026,
 * cités pour 2025 comme `INDEMNITE_BRUTE` ; aucun barème 2025 distinct n'a été
 * retrouvé pour les vérifier.
 */
export const INDEMNITE_SPECIALE = { min: 733.19, max: 7_698.5 } as const;

/**
 * Réforme des frais de mandat au 1er janvier 2026 (commission spéciale p. 30-32,
 * rapport des Questeurs p. 69-71) : la dotation fusionne l'avance et la dotation
 * matérielle, moins 345 € par mois passés au crédit collaborateur, qui vaut alors
 * 11 463 € (fiche n° 7).
 */
export const REFORME = {
  transfertCollaborateurMensuel: 345,
  creditCollaborateur2026: 11_463,
} as const;

/**
 * Ce que les documents disent sans le publier, ou publient sans le détailler.
 * Registres : rapport du Déontologue p. 51-57 ; bail : états financiers, note 17 ;
 * recommandations : certification p. 18.
 */
export const TRANSPARENCE = {
  deports: 4,
  declarationsCadeaux2025: 69,
  voyages2025: 71,
  voyagesTaiwan: 9,
  voyagesQatar: 6,
  engagementsHorsBilan2024: 75_530_000,
  engagementsHorsBilan2025: 560_890_000,
  recommandationsCour: 9,
} as const;

/**
 * Contradictions internes des documents 2025, citées telles quelles : caisse du
 * personnel (Questeurs p. 139 contre p. 85 et p. 141, le tableau est retenu),
 * déficit prévisionnel (p. 7 contre p. 16), taux d'investissement (p. 7 contre
 * p. 8), recommandations de 2024 (certification p. 18 contre commission p. 6).
 */
export const ERREURS_SOURCE = {
  caissePersonnel: [45_570_000, 48_565_926],
  deficitPrevu: [-23_700_000, -23_070_000],
  tauxInvestissement: [0.936, 0.799],
  recommandations2024: [13, 14],
} as const;

/** Commission spéciale p. 8, p. 10-11, p. 18, p. 20-22. */
export const AVENIR = {
  investissementAnnuelRecent: 30_000_000,
  projetAccueilBudget: 62_500_000,
  projetAccueilPaye: 4_432_807,
  /** Dépenses 2025 inférieures aux prévisions, dont « la moitié » tient à la pause du chantier d'accueil (p. 8). */
  depensesSousPrevision2025: 13_920_000,
  projetAccueilBudget2025: 12_320_000,
  projetAccueilNonDepense2025: 8_500_000,
  gelPensionsEconomieMin: 750_000,
  gelPensionsEconomieMax: 800_000,
} as const;

export interface SousPoste {
  cle: string;
  montant: number;
}

export interface Poste {
  cle: string;
  montant: number;
  sousPostes: SousPoste[];
}

/** Généré par `genere_site_an_2025.py`, trié par montant décroissant. */
export const POSTES: Poste[] = [
  { cle: 'personnel', montant: 151943516, sousPostes: [
    { cle: 'salairesFonctionnaires', montant: 91831205 },
    { cle: 'salairesContractuels', montant: 32314541 },
    { cle: 'cotisations', montant: 13353436 },
    { cle: 'interim', montant: 4478598 },
    { cle: 'impotsSalaires', montant: 3922674 },
    { cle: 'restauration', montant: 2768220 },
    { cle: 'cabinet', montant: 1263981 },
    { cle: 'recrutement', montant: 1211984 },
    { cle: 'missionsPersonnel', montant: 664999 },
    { cle: 'sante', montant: 133878 },
  ] },
  { cle: 'collaborateurs', montant: 130945764, sousPostes: [
    { cle: 'salairesCredit', montant: 83886603 },
    { cle: 'cotisationsCollab', montant: 32540477 },
    { cle: 'taxeSalaires', montant: 8256620 },
    { cle: 'supplements', montant: 4016997 },
    { cle: 'finMandat', montant: 1387931 },
    { cle: 'deplacementsCollab', montant: 857136 },
  ] },
  { cle: 'retraites', montant: 130783410, sousPostes: [
    { cle: 'anciensDeputes', montant: 70868445 },
    { cle: 'anciensFonctionnaires', montant: 59722427 },
    { cle: 'pensionsHistoriques', montant: 192538 },
  ] },
  { cle: 'fraisMandat', montant: 63754462, sousPostes: [
    { cle: 'afm', montant: 42731480 },
    { cle: 'dotationMaterielle', montant: 11004175 },
    { cle: 'avion', montant: 4089017 },
    { cle: 'hebergement', montant: 2892781 },
    { cle: 'train', montant: 2522754 },
    { cle: 'expertiseComptable', montant: 389870 },
    { cle: 'autresTransports', montant: 124385 },
  ] },
  { cle: 'deputes', montant: 60914741, sousPostes: [
    { cle: 'indemnites', montant: 53495469 },
    { cle: 'protectionSociale', montant: 4500706 },
    { cle: 'retourEmploi', montant: 2470000 },
    { cle: 'formation', montant: 320911 },
    { cle: 'protectionJuridique', montant: 83404 },
    { cle: 'insignes', montant: 44251 },
  ] },
  { cle: 'batiments', montant: 48323049, sousPostes: [
    { cle: 'travaux', montant: 20310065 },
    { cle: 'entretien', montant: 13675585 },
    { cle: 'loyers', montant: 4833158 },
    { cle: 'etudes', montant: 4385160 },
    { cle: 'energie', montant: 3779742 },
    { cle: 'impotsLocaux', montant: 1090843 },
    { cle: 'equipements', montant: 248496 },
  ] },
  { cle: 'groupes', montant: 15454241, sousPostes: [
    { cle: 'subventionGroupes', montant: 15137364 },
    { cle: 'informatiqueGroupes', montant: 316877 },
  ] },
  { cle: 'informatique', montant: 13261717, sousPostes: [
    { cle: 'maintenance', montant: 4334969 },
    { cle: 'materiel', montant: 2846663 },
    { cle: 'licences', montant: 2690422 },
    { cle: 'developpement', montant: 1219827 },
    { cle: 'logiciels', montant: 1218165 },
    { cle: 'bases', montant: 792894 },
    { cle: 'reseaux', montant: 158777 },
  ] },
  { cle: 'fonctionnement', montant: 6858903, sousPostes: [
    { cle: 'vehicules', montant: 2074875 },
    { cle: 'fournitures', montant: 1507335 },
    { cle: 'mobilier', montant: 538774 },
    { cle: 'assurances', montant: 530340 },
    { cle: 'subventions', montant: 507926 },
    { cle: 'transports', montant: 423200 },
    { cle: 'garde', montant: 386382 },
    { cle: 'avocats', montant: 290413 },
    { cle: 'divers', montant: 230544 },
    { cle: 'impressions', montant: 198438 },
    { cle: 'courrier', montant: 170676 },
  ] },
  { cle: 'activite', montant: 3929451, sousPostes: [
    { cle: 'international', montant: 2432360 },
    { cle: 'commissions', montant: 815992 },
    { cle: 'presidence', montant: 410557 },
    { cle: 'delegations', montant: 128336 },
    { cle: 'enquetes', montant: 87541 },
    { cle: 'opecst', montant: 54665 },
  ] },
  { cle: 'communication', montant: 1932245, sousPostes: [
    { cle: 'video', montant: 1077225 },
    { cle: 'comm', montant: 713733 },
    { cle: 'photo', montant: 141287 },
  ] },
  { cle: 'patrimoine', montant: 1159947, sousPostes: [
    { cle: 'documentation', montant: 897293 },
    { cle: 'oeuvres', montant: 262654 },
  ] },
];

/**
 * Subvention mensuelle de chaque groupe multipliée par douze (p. 49), hors
 * subventions « paie » et « comptabilité » et hors crédit d'équipement
 * informatique : la somme ne retombe donc pas sur le poste « Groupes ». Noms
 * officiels, affichés tels quels dans les deux langues comme partout ailleurs
 * sur le site.
 */
export const GROUPES = [
  { nom: 'Rassemblement national', annuel: 2_383_348 },
  { nom: 'Ensemble pour la République', annuel: 1_951_348 },
  { nom: 'La France insoumise – Nouveau Front Populaire', annuel: 1_605_748 },
  { nom: 'Socialistes et apparentés', annuel: 1_533_748 },
  { nom: 'Droite républicaine', annuel: 1_260_148 },
  { nom: 'Écologiste et Social', annuel: 1_130_548 },
  { nom: 'Les Démocrates', annuel: 1_101_748 },
  { nom: 'Horizons & Indépendants', annuel: 1_058_548 },
  { nom: 'Libertés, Indépendants, Outre-mer et Territoires', annuel: 900_148 },
  { nom: 'Gauche démocrate et républicaine', annuel: 828_148 },
  { nom: 'Union des droites pour la République', annuel: 813_748 },
] as const;

/**
 * Les députés et leurs équipes : rapport des Questeurs p. 50-53, p. 70-73. Les
 * montants exacts (avance, dotation matérielle, avion, train, logement) sont
 * des sous-postes de POSTES et ne sont pas recopiés ici.
 */
export const MANDAT = {
  /**
   * Crédit mensuel 2025 pour les salaires bruts (p. 50-51) ; cotisations
   * patronales, taxe sur les salaires et prime d'ancienneté sont payées en dehors.
   * Pas un plafond strict : les reliquats se reportent jusqu'à la fin de la
   * législature (fiche n° 7), d'où une paie imputée supérieure à 577 × 12 fois ce
   * montant. 11 463 € en 2026, voir `REFORME`.
   */
  creditCollaborateurMensuel: 11_118,
  contratsCollaborateurs: 2_122,
  /** Détail de la dotation matérielle, arrondi au dixième de million par le rapport (p. 70). */
  courrierM: 4.8,
  impressionsM: 2.4,
  taxiM: 2.1,
  equipementM: 1.6,
  deputesLoyersParis: 183,
  nuitsHotel: 1_366,
  /** Nuits à la Résidence de l'Assemblée : 8 110 pour les députés, 742 pour les vice-présidents (p. 73). */
  nuitsResidence: 8_852,
} as const;

/**
 * Contrôle des frais de mandat en 2025 : rapport du Déontologue, mai 2026,
 * p. 19-26. Le contrôle de 2025 porte sur les dépenses de 2024.
 */
export const CONTROLE = {
  deputesControles: 577,
  soldesRestitues: 5_700_000,
  demandesRenseignements: 311,
  demandesReversement: 84,
  montantReversements: 276_335,
  plafondSansJustificatif: 150,
  plafondPropose: 80,
  /** Plafond déjà proposé par les deux déontologues précédents, en 2022 et 2023 (p. 23-24). */
  plafondProposeAvant: 100,
  exclusions: 2,
  /** Contrôle spécial de septembre 2025, montant arrondi par le rapport (p. 26). */
  exempleRembourse: 1_500,
  /** Anonymiser tous les relevés de l'année pour la Cour : commission spéciale p. 33. */
  relevesAnnee: 6_924,
  joursAnonymisation: 208,
  /** Congés des collaborateurs déclarés comme pris : commission spéciale p. 29. */
  partCongesDeclares: 0.378,
} as const;

/**
 * Pensions : rapport des Questeurs p. 133-137 ; taux de couverture : commission
 * spéciale p. 17-18 ; engagements : états financiers 2025, note 15.
 */
export const RETRAITES = {
  pensionsAnciensDeputes: 76_833_758,
  cotisationsDeputes: 5_950_913,
  beneficiairesAnciensDeputes: 1_926,
  /** Cotisations des députés plus contribution employeur de l'Assemblée : « de l'ordre de 23 % ». */
  couvertureAvecContribution: 0.23,
  /** Caisse du personnel : les contractuels n'y cotisent pas. */
  couverturePersonnel2019: 0.379,
  couverturePersonnel2025: 0.261,
  /** Subvention d'équilibre 2025 à la caisse du personnel, article 7420 de la caisse (Questeurs p. 85). */
  subventionEquilibrePersonnel: 48_565_926,
  hausseSubventionPersonnel: 0.059,
  engagementsAnciensDeputes: 1_260_950_000,
  engagementsPersonnel: 1_587_060_000,
} as const;

/** Sièges de députés : la moyenne par député de l'enveloppe 3 se calcule sur ce nombre. */
export const SIEGES = 577;

/**
 * Qui travaille à l'Assemblée au 31 décembre 2025 : rapport des Questeurs p. 77
 * (fonctionnaires, entrées et départs), p. 79 (contractuels, recrutements,
 * apprentis, stagiaires gratifiés), p. 89 (gardes républicains) ; mêmes effectifs
 * dans les états financiers, note 16. Les contractuels du cabinet de la
 * Présidence sont comptés à part par le rapport.
 */
export const AGENTS = {
  /**
   * Députés en fonction au 31 décembre 2025 (états financiers, note 16) : 577
   * sièges, dont des vacances après deux annulations d'élections et trois
   * démissions d'office (Questeurs p. 48). Les moyennes par député restent
   * calculées sur `SIEGES`.
   */
  deputesFin2025: 575,
  fonctionnaires: 804,
  fonctionnaires2017: 1_105,
  entreesFonctionnaires: 23,
  departsFonctionnaires: 53,
  contractuels: 587,
  partContractuels: 0.422,
  partContractuels2021: 0.278,
  hausseContractuels5Ans: 232,
  recrutementsContractuels: 90,
  remplacementsFonctionnaires: 35,
  cabinetPresidence: 12,
  gardesRepublicains: 34,
  apprentis: 32,
  stagiaires: 264,
} as const;

/** Dépenses réalisées et solde de chaque exercice, tirés du rapport des Questeurs de l'année. */
export const HISTORIQUE = [
  { annee: 2020, depense: 540_617_793, solde: -20_687_574, evenement: null },
  { annee: 2021, depense: 557_843_963, solde: -37_291_634, evenement: null },
  { annee: 2022, depense: 603_836_715, solde: -39_288_583, evenement: 'elections' },
  { annee: 2023, depense: 593_876_752, solde: -19_631_480, evenement: null },
  { annee: 2024, depense: 635_347_446, solde: 432_935, evenement: 'dissolution' },
  { annee: 2025, depense: 629_261_451, solde: -15_897_527, evenement: 'gel' },
] as const;
