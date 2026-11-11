// Mapping des valeurs brutes de la base de données vers les clés i18n du namespace "definitions".
// Utiliser getDefinition() pour récupérer le terme et la définition traduits.

/**
 * Libellé exact de l'acte « procédure accélérée » dans `actes_legislatifs`.
 * Unique en base, et recopié nulle part ailleurs : `/etat-des-lieux` compte
 * les dossiers qui le portent, cette table le traduit.
 */
export const LIBELLE_PROCEDURE_ACCELEREE =
  "Le gouvernement déclare l'urgence / engage la procédure accélérée"

export const DEFINITION_KEYS: Record<string, string> = {
  // ── Statuts des dossiers ──
  "Adopté par l'Assemblée nationale": 'adopteAN',
  'Adopté par le Parlement': 'adopteParlement',
  "Adopté par le Sénat": 'adopteSenat',
  'Appliquée': 'appliquee',
  "Déposé - pas encore voté": 'enCoursExamen',
  'Publié': 'publie',
  'Promulguée': 'promulguee',
  'Rejeté': 'rejete',
  "Rejeté par l'Assemblée nationale": 'rejeteAN',
  'Rejeté par le Sénat': 'rejeteSenat',
  'Retiré': 'retire',

  // ── Types de procédures ──
  "Allocution du Président de l'Assemblée nationale": 'allocutionPresident',
  "Commission d'enquête": 'commissionEnquete',
  'Engagement de la responsabilité gouvernementale': 'engagementResponsabilite',
  "Mission d'information": 'missionInformation',
  'Pétitions': 'petitions',
  'Projet de loi de financement de la sécurité sociale': 'projetFinancementSecu',
  "Projet de loi de finances de l'année": 'projetFinancesAnnee',
  'Projet de loi de finances rectificative': 'projetFinancesRectificative',
  'Projet de loi ordinaire': 'projetLoiOrdinaire',
  'Projet de ratification des traités et conventions': 'projetRatificationTraites',
  'Projet ou proposition de loi constitutionnelle': 'projetLoiConstitutionnelle',
  'Projet ou proposition de loi organique': 'projetLoiOrganique',
  // « relative » est la graphie de la base, pas une coquille d'ici.
  'Projet de loi relative aux résultats de la gestion et portant approbation des comptes': 'projetApprobationComptes',
  "Proposition de loi présentée en application de l'article 11 de la Constitution": 'propositionLoiReferendaire',
  'Proposition de loi ordinaire': 'propositionLoiOrdinaire',
  "Rapport d'information sans mission": 'rapportInformation',
  'Résolution': 'resolution',
  'Résolution Article 34-1': 'resolutionArticle34',
  'Responsabilité pénale du président de la république': 'responsabilitePenale',

  // ── Étapes législatives ──
  "1er dépôt d'une initiative.": 'premierDepot',
  "1ère lecture (1ère assemblée saisie)": 'premiereRecture1',
  "1ère lecture (2ème assemblée saisie)": 'premiereRecture2',
  'Accord international': 'accordInternational',
  'Application complète de la loi': 'applicationComplete',
  "Avis du Conseil d'Etat": 'avisConseilEtat',
  'Commission Mixte Paritaire': 'commissionMixteParity',
  'Conclusion du conseil constitutionnel': 'conclusionConseilConstitutionnel',
  'Conseil constitutionnel': 'conseilConstitutionnel',
  "Convocation d'une CMP": 'convocationCMP',
  "Création d'une commission d'enquête": 'creationCommissionEnquete',
  "Création d'une mission d'information": 'creationMissionInformation',
  'Débat': 'debat',
  'Décision': 'decision',
  'Décision de la CMP': 'decisionCMP',
  'Décision sur une motion de censure': 'decisionMotionCensure',
  "Décrets d'application": 'decretsApplication',
  "Dépôt d'un projet de loi": 'depotProjetLoi',
  "Dépôt d'une déclaration du gouvernement": 'depotDeclarationGouvernement',
  "Dépôt d'une initiative en navette": 'depotInitiativeNavette',
  "Dépôt d'une lettre rectificative.": 'depotLettreRectificative',
  'Dépôt de rapport': 'depotRapport',
  "Dépôt du rapport d'une CMP": 'depotRapportCMP',
  'deuxième lecture': 'deuxiemeLecture',
  'Discussion en séance publique': 'discussionSeancePublique',
  "Etude d'impact": 'etudeImpact',
  [LIBELLE_PROCEDURE_ACCELEREE]: 'procedureAcceleree',
  'Lecture définitive': 'lectureDefinitive',
  'Lecture unique': 'lectureUnique',
  "Loi d'application directe": 'loiApplicationDirecte',
  'Mise en application de la loi': 'miseEnApplication',
  'Motion de censure': 'motionCensure',
  'Motion de procédure': 'motionProcedure',
  'Nomination de rapporteur': 'nominationRapporteur',
  'Nomination de rapporteur budgétaire': 'nominationRapporteurBudgetaire',
  'Nouvelle Lecture': 'nouvelleLecture',
  // Deux libellés en base pour le même acte : une seule entrée au glossaire.
  "Promulgation d'une loi": 'promulgationLoi2',
  'Promulgation de la loi': 'promulgationLoi2',
  "Publication d'un décret d'application": 'publicationDecretApplication',
  "Rapport sur l'application des lois": 'rapportApplicationLois',
  'Renvoi en commission au fond': 'renvoiCommissionFond',
  'Renvoi préalable': 'renvoiPrealable',
  'Renvoi préalable à la CAE': 'renvoiPrealableCAE',
  "Retrait d'une initiative": 'retraitInitiative',
  'Réunion de commission': 'reunionCommission',
  'Saisine du conseil constitutionnel': 'saisineConseilConstitutionnel',
  "Saisine pour avis d'une commission": 'saisiePourAvisCommission',
  'Travaux': 'travaux',
  "Travaux d'une commission saisie pour avis": 'travauxCommissionSaisieAvis',
  'Travaux de la commission saisie au fond': 'travauxCommissionFond',
  'Travaux des commissions': 'travauxCommissions',
  'troisième lecture': 'troisiemeLecture',

  // ── Provenance des textes ──
  'Texte Déposé': 'texteDepose',
  'Commission': 'commission',
  'Séance': 'seance',
  'LEGIFRANCE': 'legifrance',
  'Légifrance': 'legifrance',
};

/**
 * Retourne le terme et la définition traduits pour une valeur brute de la base de données.
 * @param dbKey  Valeur telle qu'elle est stockée en base (ex. "Projet de loi ordinaire")
 * @param t      Fonction de traduction du namespace "definitions"
 */
export function getDefinition(
  dbKey: string,
  t: (key: string) => string
): { term: string; definition: string } | null {
  const i18nKey = DEFINITION_KEYS[dbKey];
  if (!i18nKey) return null;
  return {
    term: t(`${i18nKey}.term`),
    definition: t(`${i18nKey}.definition`),
  };
}
