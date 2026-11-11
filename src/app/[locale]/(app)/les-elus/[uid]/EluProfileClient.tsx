'use client';

/**
 * Fiche élu — orchestrateur. Il assemble le hero (bande de contact dans son
 * pied), la barre d'ancres collante, les dix sections repliables et le tiroir
 * de détail ; le rendu des lignes vit dans `EluRows`, le repli dans
 * `SectionRepliable`, le détail dans `EluDrawer`.
 *
 * Dix sections en carte sur le fond teinté que pose `AppShell`, sous un
 * surtitre en capitales : la grammaire de la fiche dossier (D-213). Toutes
 * figurent sur toute fiche (D-306) ; une section sans rien à montrer perd sa
 * carte et ne porte qu'une phrase d'absence en gris (`elu-absent`, table `vide`),
 * comme sur la fiche dossier. `elu-empty` reste pour un manque à l'intérieur
 * d'une carte (des taux de vote mais aucun vote nominatif).
 */

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Info, BadgeCheck, Users, User, CalendarDays, Camera, BookOpen, History,
  Activity, Vote, Mic, ScrollText, PenLine, MessageCircleQuestion, MapPin, Landmark, Eye, ArrowUpRight, Handshake,
} from 'lucide-react';
import ContacterEluCard from '@/components/ContacterEluCard';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LEGAL_AN } from '@/lib/parliament-constants';
import PageHero, { type PageHeroMetaRow, type PageHeroPill } from '@/components/PageHero';
import PhotoEluHero from '@/components/PhotoEluHero';
import { photoElu } from '@/lib/photo-elu';
import { stockageSession } from '@/lib/stockage-navigateur';
import { GroupLogoImage } from '@/components/ui/GroupLogoImage';
import { compterQuota, enVigueur, estFonctionExecutive, statutMandat, type EcheanceCumul } from '@/lib/mandats-locaux';
import { buildShareUrl } from '@/lib/share-url';
import { formatJourNu } from '@/lib/jour-paris';
import { type FonctionKey, type MetricKey } from '@/lib/activite-weights';
import SectionRepliable from '@/components/SectionRepliable';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import BarreAncres from '@/components/BarreAncres';
import CarteDepartementZoom, { type Emprise } from '@/components/ui/CarteDepartementZoom';
import { PREFECTURES } from '@/lib/prefectures';
import EluDrawer, { type DrawerCle } from './EluDrawer';
import BlocElection from './BlocElection';
import type { ElectionAffichee } from '@/lib/election-affichage';
import { InfoBulle } from '@/components/ContacterMesElusBanner';
import ComparerElusModal, { chambreDe } from '@/components/ComparerElusModal';
import type { ActeurMeta } from '@/lib/search/acteur-index';
import {
  AccordGroupeRow, AmendementRow, COULEURS_INFO, FonctionRow, MandatRow, ParoleRow, QuestionRow, RepartitionSorts, StatTaux, TexteRow,
  TransparenceRow, VoteRow,
  type ActiviteScore, type AffinitesVote, type AmendementAdopte, type AmendementsParSort, type BlocMandats, type DateMandat, type MandatTermine, type Dossier, type DossierGroup, type HatvpDeclaration, type Intervention,
  type Paroles,
  type LienWikipedia, type MandatAffiche, type MandatLocal, type Question, type TransparenceElement, type VoteNominatif,
  ORDRE_TRANSPARENCE, TITRE_BLOC_MANDATS,
} from './EluRows';

interface Acteur {
  uid: string;
  prenom: string | null;
  nom: string | null;
  civ: string | null;
  age: number | null;
  libelle_profession: string | null;
  departement_election: string | null;
  num_departement: string | null;
  num_circo: string | null;
  taux_participation_votes_finaux: number | null;
  taux_participation_votes_solennels: number | null;
  taux_cohesion_groupe: number | null;
  scrutins_finaux_pendant_mandat: number | null;
  scrutins_solennels_pendant_mandat: number | null;
  votes_actifs_importants: number | null;
  /** Votes exercés sur les scrutins finaux ou solennels (ceux des deux taux de
   *  participation réunis), et parmi eux ceux qu'un collègue a déposés par délégation.
   *  Député seulement : `null` pour un sénateur, et le taux aussi pour le président
   *  de l'Assemblée (D-124). */
  votes_finaux_solennels: number | null;
  votes_delegues: number | null;
  taux_delegation: number | null;
  place_hemicycle: number | null;
  email: string | null;
  telephone: string | null;
  profil_url: string | null;
  url_profil_officiel: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  /** Permanence, « rue, complément, code postal ville » : l'Assemblée, ou le Sénat
   *  pour ses élus en exercice (`pipeline/_colonnes_senat.py`). */
  adresse_circonscription: string | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  est_ministre_actuel: boolean | null;
  /** Amendements dont l'élu est l'auteur, et cosignés, sur le mandat en cours. Lus
   *  sur `acteurs` et non dans le score : écrits par la même transaction que
   *  `amendements_par_sort`, ils lui restent égaux, et un élu sans score les a aussi. */
  nb_amendements_auteur: number | null;
  nb_amendements_cosignataire: number | null;
  amendements_par_sort: AmendementsParSort | null;
  qualite_actuelle: string | null;
  date_debut_mandat: string | null;
  roles_text: string | null;
  groupe: {
    uid: string;
    libelle: string | null;
    libelle_abrege: string | null;
    couleur_associee: string | null;
    taux_participation_votes_finaux_moyen: number | null;
    taux_participation_votes_solennels_moyen: number | null;
    taux_delegation_moyen: number | null;
    taux_cohesion_interne: number | null;
  } | null;
}

interface AssemblyAverages {
  taux_participation_votes_finaux_moyen: number | null;
  taux_participation_votes_solennels_moyen: number | null;
  taux_cohesion_moyen: number | null;
  /** Absente des moyennes du Sénat : le taux de délégation n'est calculé que pour les députés. */
  taux_delegation_moyen?: number | null;
}

interface Props {
  acteur: Acteur;
  /** Fonction au Bureau de la chambre, extraite côté serveur (voir `page.tsx`).
   *  `court` va dans la pastille, `long` dans son infobulle. */
  fonctionBureau?: { court: string; long: string } | null;
  /** Date d'ouverture du mandat en cours et son sens (`dateDuMandat` dans `page.tsx`).
   *  `null` hors mandat parlementaire. */
  dateMandat?: DateMandat | null;
  /** Le mandat quitté, pour un ancien élu (voir `page.tsx`) ; `null` pour un élu en
   *  exercice ou un ministre. Il grise le portrait, et le pied du hero dit en toutes
   *  lettres que l'élu ne siège plus, à la place de la bande de contact. */
  mandatTermine?: MandatTermine | null;
  /** Dernier groupe d'un ancien élu, que `groupe` ne porte plus (voir `page.tsx`). */
  dernierGroupe?: { libelle: string; couleur: string | null } | null;
  ministere?: { libelle: string | null; libelle_abrege: string | null } | null;
  dossiersInities: Dossier[];
  dossiersCoauteur: Dossier[];
  /** Amendements adoptés de l'élu, du plus récent au plus ancien (`page.tsx`). */
  amendements?: AmendementAdopte[];
  /** Lien vers l'article Wikipédia, `null` sans article certain (D-154). */
  wikipedia: LienWikipedia | null;
  assemblyAverages: AssemblyAverages | null;
  activiteScore?: ActiviteScore | null;
  /** Ses trois sujets de prédilection, déjà traduits et dans l'ordre (`themes_elus_mv`). Vide sans bloc. */
  themesPredilection?: string[];
  /** L'élection qui a donné le siège, prête à afficher (`preparerElection`). `null` sans bloc. */
  election?: ElectionAffichee | null;
  mandatsNationaux?: MandatAffiche[];
  mandatsLocaux?: MandatLocal[];
  /** Dernière vérification au cas par cas des mandats locaux (`sync_etat`). */
  verificationCumul?: string | null;
  /** Délai pour choisir, calculé côté serveur ; `depassee` compare au jour du rendu. */
  echeanceCumul?: { echeance: EcheanceCumul; depassee: boolean } | null;
  transparence?: TransparenceElement[];
  hatvp?: HatvpDeclaration | null;
  questions?: Question[];
  paroles?: Paroles;
  /** Date nue d'où partent les prises de parole (`debutParoles` dans `page.tsx`) : la
   *  borne de la chambre d'un élu en exercice, ou le début de son mandat s'il a changé de
   *  chambre depuis (D-239) ; `null` pour un ministre ou un ancien élu. Le tiroir la passe
   *  à sa demande de texte, pour montrer les mêmes séances que le fil. */
  parolesDepuis?: string | null;
  votesNominatifs?: VoteNominatif[];
  /** Accord de vote avec chaque groupe de sa chambre (voir `page.tsx`). */
  affinites?: AffinitesVote;
}

/** Valeur par défaut de `affinites`, hors du rendu comme `PAROLES_VIDES`. */
const AFFINITES_VIDES: AffinitesVote = { groupes: [], total: 0, groupeMarque: null };

/** Nombre de lignes servies dans le fil ; le reste vit dans le tiroir. */
const RESUME = 5;

/** Valeur par défaut de `paroles`, hors du rendu pour garder la même référence au `useMemo`. */
const PAROLES_VIDES: Paroles = { dossiers: {}, seances: {}, lignes: [] };

/** Clé du repli mémorisé, propre à cette fiche : la fiche dossier a la sienne. */
const CLE_PLI = 'elu-fiche-plie';

/**
 * Codes de département sans tracé du même numéro dans `departements.svg`,
 * renvoyés à la pastille qui les représente : les Français de l'étranger
 * (099 à l'Assemblée, 997 et 998 au Sénat) et Saint-Martin, que la carte
 * dessine avec Saint-Barthélemy. Sans eux, rien ne s'allumait sur leur carte.
 */
const PASTILLE_CARTE: Record<string, string> = { '099': '999', '997': '999', '998': '999', '978': '977' };

const FONCTION_ORDER: FonctionKey[] = ['legiferer', 'deliberer', 'controler', 'commission'];

// Ordre d'affichage des mandats locaux, du plus proche du terrain au plus
// large. L'ordre alphabétique des types n'aurait aucun sens à la lecture.
const ORDRE_LOCAL = ['municipal', 'arrondissement', 'communautaire', 'departemental', 'regional', 'assemblee'];

/**
 * Plafond de lignes par colonne de transparence, tous groupes confondus, et non
 * par groupe : une colonne peut aligner sept natures de fait, et trois lignes
 * chacune donnaient une carte plus longue que tout le reste de la fiche réuni.
 * Le tiroir porte le détail complet.
 *
 * C'est ce plafond qui impose l'ordre de `ORDRE_TRANSPARENCE` : une nature
 * placée après une autre plus fournie n'atteint jamais le fil.
 */
const RESUME_TRANSPARENCE = 4;

/** Nombre de lignes qu'une colonne montre réellement, plafond appliqué. */
function compterLignesVues(groupes: { elements: unknown[] }[]): number {
  return Math.min(RESUME_TRANSPARENCE, groupes.reduce((n, g) => n + g.elements.length, 0));
}

/**
 * Les groupes d'une colonne, tronqués pour que leurs lignes cumulées tiennent
 * dans le plafond. Un groupe qui n'a plus de place disparaît entièrement
 * plutôt que d'afficher un titre sans ligne.
 */
function tronquerColonne<T>(groupes: { categorie: string; elements: T[] }[]) {
  let reste = RESUME_TRANSPARENCE;
  const vus: { categorie: string; elements: T[]; total: number }[] = [];
  for (const groupe of groupes) {
    if (reste <= 0) break;
    vus.push({
      categorie: groupe.categorie,
      elements: groupe.elements.slice(0, reste),
      total: groupe.elements.length,
    });
    reste -= Math.min(groupe.elements.length, reste);
  }
  return vus;
}

// Dix pictogrammes, servis deux fois chacun : devant le surtitre de leur
// section, et dans leur pastille d'ancre. L'ancre cliquée se reconnaît donc dans
// le surtitre vers lequel elle mène.
const ICONES = {
  activite: Activity,
  votes: Vote,
  affinites: Handshake,
  paroles: Mic,
  textes: ScrollText,
  amendements: PenLine,
  questions: MessageCircleQuestion,
  mandats: Landmark,
  transparence: Eye,
  siege: MapPin,
} as const;

type SectionCle = keyof typeof ICONES;

/** Le pictogramme devant le surtitre d'une section, en gris pour rester derrière lui. */
function IconeSection({ cle }: { cle: SectionCle }) {
  const Icone = ICONES[cle];
  return <Icone size={14} strokeWidth={1.5} aria-hidden style={{ flex: 'none', color: 'var(--muted-foreground)' }} />;
}

/** Le lien qui bascule du résumé (le fil) au détail complet (le tiroir). */
function BoutonTiroir({ libelle, onOuvrir }: { libelle: string; onOuvrir: () => void }) {
  return <button type="button" className="elu-voir" onClick={onOuvrir}>{libelle}</button>;
}

export default function EluProfileClient({
  acteur,
  fonctionBureau = null,
  dateMandat = null,
  mandatTermine = null,
  dernierGroupe = null,
  ministere = null,
  dossiersInities,
  dossiersCoauteur,
  amendements = [],
  wikipedia,
  assemblyAverages,
  activiteScore,
  themesPredilection = [],
  election = null,
  mandatsNationaux = [],
  mandatsLocaux = [],
  verificationCumul = null,
  echeanceCumul = null,
  transparence = [],
  hatvp = null,
  questions = [],
  paroles = PAROLES_VIDES,
  parolesDepuis = null,
  votesNominatifs = [],
  affinites = AFFINITES_VIDES,
}: Props) {
  const t = useTranslations('elus');
  const locale = useLocale();
  const shareUrl = buildShareUrl(locale, `/les-elus/${acteur.uid}`);
  const groupColor = acteur.groupe?.couleur_associee ?? '#6b7280';
  const fullName = [acteur.prenom, acteur.nom].filter(Boolean).join(' ');
  // `formatJourNu` n'est pas décoratif : les dates de mandat sont des dates nues
  // ('2024-07-08'), qu'un visiteur à l'ouest de Greenwich lirait sinon la veille.
  const dateLongue = (iso: string) =>
    formatJourNu(iso, locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const debutMandat = dateMandat ? dateLongue(dateMandat.date) : null;
  // Une décimale sur la participation d'un sénateur : neuf sur dix sont au-dessus
  // de 98 % (mesuré au 2026-09-15), et l'entier affichait « 100 % » pour deux
  // taux qu'un vote sépare, à des centiles très éloignés.
  const decimalesParticipation = acteur.est_senateur_actuel ? 1 : 0;
  const mandatePills: PageHeroPill[] = (() => {
    if (acteur.est_ministre_actuel) {
      const qualite = acteur.qualite_actuelle?.trim() || 'Ministre';
      const abrege = ministere?.libelle_abrege?.trim() || null;
      const libelle = ministere?.libelle?.trim() || null;
      const pills: PageHeroPill[] = [{ children: qualite }];
      // 2e pill : portefeuille (ex. « Égalité femmes-hommes »).
      // On la masque si elle dupliquerait la qualité (ex. Premier ministre / PM).
      if (abrege && libelle && libelle.toLowerCase() !== qualite.toLowerCase()) {
        pills.push({ children: abrege, tooltip: libelle });
      }
      return pills;
    }
    const role = acteur.est_depute_actuel
      ? t('roleDepute')
      : acteur.est_senateur_actuel
        ? t('roleSenateur')
        : null;
    if (!role) return [];
    // 2e pill : la fonction au Bureau, pour les 40 élus qui en ont une. Le
    // libellé court suffit à côté du rôle, le long reste en infobulle.
    return fonctionBureau
      ? [{ children: role }, { children: fonctionBureau.court, tooltip: fonctionBureau.long }]
      : [{ children: role }];
  })();
  // Le crédit du portrait vit dans la bande meta, donc ici et non dans
  // `PhotoEluHero` : quand l'image ne charge pas, la vignette retombe sur les
  // initiales et l'entrée meta doit disparaître avec elle.
  const [photoCassee, setPhotoCassee] = useState(false);
  const photo = photoCassee ? null : photoElu(acteur);

  const hemicycleRef = useRef<HTMLDivElement>(null);
  const carteRef = useRef<HTMLDivElement>(null);
  // Tracé et emprise du département de l'élu, lus dans la carte de France une
  // fois injectée : le zoom les redessine sans relire le fichier.
  const [zoomDept, setZoomDept] = useState<{ trace: string; emprise: Emprise } | null>(null);
  const [tiroir, setTiroir] = useState<DrawerCle | null>(null);

  // « Comparer avec… » : la modale de /les-elus, ouverte avec cet élu et la recherche
  // du second. L'élu se décrit ici dans la forme de l'index de recherche, que la modale
  // attend ; un ministre ou un ancien élu n'a pas de chambre, donc pas de lien.
  const moi: ActeurMeta = useMemo(() => ({
    uid: acteur.uid,
    prenom: acteur.prenom,
    nom: acteur.nom,
    civ: acteur.civ,
    groupe_libelle: acteur.groupe?.libelle ?? null,
    groupe_uid: acteur.groupe?.uid ?? null,
    departement_election: acteur.departement_election,
    libelle_profession: acteur.libelle_profession,
    ministere_libelle: null,
    en_exercice: !!(acteur.est_depute_actuel || acteur.est_senateur_actuel || acteur.est_ministre_actuel),
    est_depute_actuel: !!acteur.est_depute_actuel,
    est_senateur_actuel: !!acteur.est_senateur_actuel,
    est_ministre_actuel: !!acteur.est_ministre_actuel,
    qualite_actuelle: acteur.qualite_actuelle,
    url_profil_officiel: acteur.url_profil_officiel,
  }), [acteur]);
  const chambreMoi = chambreDe(moi);
  const [paire, setPaire] = useState<[ActeurMeta, ActeurMeta | null] | null>(null);
  const lienComparer = chambreMoi && (
    <button type="button" className="elu-voir" onClick={() => setPaire([moi, null])}>
      {t('comparer.depuisFiche', { chambre: chambreMoi })}
    </button>
  );

  // Les interventions reconstruites depuis leur forme compacte (`Paroles`) : chaque
  // ligne retrouve sa séance et son dossier, partagés par référence.
  const interventions = useMemo<Intervention[]>(
    () => paroles.lignes.map(([dossierUid, seanceUid]) => ({
      dossier_uid: dossierUid,
      seance: seanceUid ? paroles.seances[seanceUid] ?? null : null,
      dossier: dossierUid ? paroles.dossiers[dossierUid] ?? null : null,
    })),
    [paroles],
  );

  // Interventions groupées par dossier. La Map garde l'ordre d'arrivée, et
  // `page.tsx` les envoie rangées par dossier (du plus récemment débattu au plus
  // ancien) puis par séance décroissante : les groupes en héritent tels quels.
  const dossierGroups = useMemo<DossierGroup[]>(() => {
    const map = new Map<string, DossierGroup>();
    for (const iv of interventions) {
      const key = iv.dossier_uid ?? '__sans_dossier__';
      const existing = map.get(key);
      if (existing) existing.interventions.push(iv);
      else map.set(key, { dossier: iv.dossier, interventions: [iv] });
    }
    return Array.from(map.values());
  }, [interventions]);

  // Sections dont un titre est traduit par l'IA (sur /en) : le badge se pose en tête de
  // la section et de son tiroir, chaque titre de la liste étant un lien, où un badge-lien
  // ne peut pas entrer.
  const titresTraduits: Partial<Record<DrawerCle, boolean>> = {
    votes: votesNominatifs.some((v) => v.titreTraduit),
    paroles: dossierGroups.some((g) => g.dossier?.titreTraduit),
    textes: [...dossiersInities, ...dossiersCoauteur].some((d) => d.titreTraduit),
    amendements: amendements.some((a) => a.dossier?.titreTraduit),
  };

  const metricValues = useMemo<Record<MetricKey, number | null>>(() => ({
    cpPart: activiteScore?.cpPart ?? null,
    cpDoss: activiteScore?.cpDoss ?? null,
    cpCosign: activiteScore?.cpCosign ?? null,
    cpRapp: activiteScore?.cpRapp ?? null,
    cpRappCtrl: activiteScore?.cpRappCtrl ?? null,
    cpAmendAuteur: activiteScore?.cpAmendAuteur ?? null,
    cpAmendCosign: activiteScore?.cpAmendCosign ?? null,
    cpQuestO: activiteScore?.cpQuestO ?? null,
    cpQuestE: activiteScore?.cpQuestE ?? null,
    cpPrisesParole: activiteScore?.cpPrisesParole ?? null,
    cpCommPres: activiteScore?.cpCommPres ?? null,
  }), [activiteScore]);

  // Le compte de chaque mesure, qui accorde son libellé dans la carte (« 1 dossier
  // déposé ») ; null pour la participation, qui est un taux.
  const metricCount = useMemo<Record<MetricKey, number | null>>(() => ({
    cpPart: null,
    cpDoss: activiteScore?.nb_dossiers_inities ?? null,
    cpCosign: activiteScore?.nb_textes_cosignes ?? null,
    cpRapp: activiteScore?.nb_rapporteur ?? null,
    cpRappCtrl: activiteScore?.nb_rapports_controle ?? null,
    cpAmendAuteur: activiteScore?.nb_amendements_auteur ?? null,
    cpAmendCosign: activiteScore?.nb_amendements_cosignataire ?? null,
    cpQuestO: activiteScore?.nb_questions_orales ?? null,
    cpQuestE: activiteScore?.nb_questions_ecrites ?? null,
    cpPrisesParole: activiteScore?.nb_prises_parole ?? null,
    cpCommPres: activiteScore?.nb_commission_presences ?? null,
  }), [activiteScore]);

  const metricRaw = useMemo<Record<MetricKey, string | null>>(() => {
    const nf = new Intl.NumberFormat(locale);
    const comptes = Object.fromEntries(
      Object.entries(metricCount).map(([m, n]) => [m, n === null ? null : nf.format(n)]),
    ) as Record<MetricKey, string | null>;
    return {
      ...comptes,
      // Le brut ne dépend pas du centile : un président de groupe, hors classement,
      // n'a pas de centile mais bien un taux, que la fiche promet de montrer. Seuls
      // les présidents de chambre n'ont pas de taux (D-124), d'où « — » chez eux.
      cpPart: activiteScore && acteur.taux_participation_votes_finaux != null
        // Style `percent` : l'espace avant le signe est français, pas anglais. Les
        // fractions fixées font l'arrondi, au même nombre de décimales que « Ses votes ».
        ? new Intl.NumberFormat(locale, {
            style: 'percent',
            minimumFractionDigits: decimalesParticipation,
            maximumFractionDigits: decimalesParticipation,
          }).format(acteur.taux_participation_votes_finaux / 100) : null,
    };
  }, [activiteScore, metricCount, acteur.taux_participation_votes_finaux, decimalesParticipation, locale]);

  // Les jours de mandat comptés, second chiffre de l'en-tête de la carte Activité,
  // et le seul qui reste hors classement : c'est le dénominateur de toutes les
  // mesures, donc il vaut d'être lu même sans rang.
  const blocJours = (a: ActiviteScore) => (
    <div className="elu-activite-bloc">
      <span className="elu-chiffres-n">{new Intl.NumberFormat(locale).format(a.joursActifs)}</span>
      <span className="elu-activite-legende" title={t('joursActifsTooltip')} style={{ cursor: 'help' }}>
        {t('joursMandatLabel', { count: a.joursActifs, date: dateLongue(a.debutDecompte) })}
      </span>
    </div>
  );

  // Ses sujets de prédilection, sous les quatre fonctions : les noms seuls, dans
  // l'ordre. L'écart à la moyenne de la chambre n'est pas un compte, et un « 12 fois »
  // isolé se lirait mal ; la méthode tient dans l'infobulle. Chaque thème garde son
  // trait collé à lui (`nowrap`) : une ligne coupée ne commence jamais par un trait.
  const blocThemes = themesPredilection.length > 0 && (
    <div className="elu-themes">
      <div className="elu-fonction-nom">
        {t('themesPredilectionTitre')}
        <span className="elu-mesure-info">
          <InfoBulle ariaLabel={t('infoBulleAria')} texte={t('themesPredilectionInfo')} couleurs={COULEURS_INFO} />
        </span>
      </div>
      <p className="elu-themes-liste">
        {themesPredilection.map((theme, i) => (
          <Fragment key={theme}>
            <span style={{ whiteSpace: 'nowrap' }}>
              {theme}
              {i < themesPredilection.length - 1 && <span className="elu-activite-sep" aria-hidden>|</span>}
            </span>
            {' '}
          </Fragment>
        ))}
      </p>
    </div>
  );

  useEffect(() => {
    const key = `viewed_elu_${acteur.uid}`;
    if (stockageSession.lire(key)) return;
    stockageSession.ecrire(key, '1');
    fetch('/api/view-elu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: acteur.uid }),
    }).catch(() => {});
  }, [acteur.uid]);

  const isSenat = !!acteur.est_senateur_actuel;

  // Les trois dessins (hémicycles et carte) se chargent depuis `public/` au lieu
  // de passer en props depuis `page.tsx` : chaque fiche générée par l'ISR était
  // stockée avec eux, recopiés dans le HTML et dans le flux RSC, soit environ
  // 250 Ko compressés sur 375 pour une fiche. Servis en statique, ces fichiers
  // restent en cache navigateur d'une fiche à l'autre.
  // La section, elle, se décide sur les données et part dans la page du serveur,
  // place des dessins réservée (`aspectRatio`) : décidée sur l'arrivée des dessins,
  // elle manquait au chargement, si bien qu'un lien vers `#siege` ne défilait pas et
  // que la page sautait à leur arrivée. Seul un échec du téléchargement retire la
  // colonne concernée.
  const [activeSvg, setActiveSvg] = useState<string | null>(null);
  const [carteSvg, setCarteSvg] = useState<string | null>(null);
  const [hemicycleEchec, setHemicycleEchec] = useState(false);
  const [carteEchec, setCarteEchec] = useState(false);

  // Un ancien élu ou un élu sans place connue ne télécharge pas un hémicycle qui ne
  // s'affichera pas.
  const hemicycleUtile = !!(acteur.place_hemicycle && (acteur.est_depute_actuel || acteur.est_senateur_actuel));

  useEffect(() => {
    if (!hemicycleUtile) return;
    let annule = false;
    fetch(isSenat ? '/hemicycle-senat.svg' : '/hemicycle-an.svg')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((texte) => { if (!annule) setActiveSvg(texte); })
      .catch(() => { if (!annule) setHemicycleEchec(true); });
    return () => { annule = true; };
  }, [hemicycleUtile, isSenat]);

  useEffect(() => {
    if (!acteur.num_departement) return;
    let annule = false;
    fetch('/departements.svg')
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((texte) => { if (!annule) setCarteSvg(texte); })
      .catch(() => { if (!annule) setCarteEchec(true); });
    return () => { annule = true; };
  }, [acteur.num_departement]);

  useEffect(() => {
    if (!activeSvg || !hemicycleRef.current) return;
    const container = hemicycleRef.current;
    container.innerHTML = activeSvg;
    const svg = container.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('width', '100%');
    svg.removeAttribute('height');
    svg.style.overflow = 'visible';
    svg.style.position = 'static';
    svg.style.left = '0';
    // Le viewBox couvre tout le dessin, tribune et murs compris (emprise lue par
    // getBBox). Plus serré, il ne recadrait rien : le SVG reste en `overflow:
    // visible` pour l'ombre du marqueur, et le bas du dessin débordait sur le
    // titre « Département » qui suit quand les colonnes s'empilent sur mobile.
    svg.setAttribute('viewBox', isSenat ? '0 0 950 659' : '0 0 900 582');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    if (acteur.place_hemicycle != null) {
      const placeNum = parseInt(String(acteur.place_hemicycle), 10);
      const seat = svg.querySelector(`[place="${placeNum}"]`) as SVGGraphicsElement | null;
      if (seat) {
        seat.style.fill = groupColor;
        if (isSenat) {
          // Sénat : circles avec cx/cy/r directs
          // On utilise le même r que la base pour éviter tout artefact visuel
          const cx = seat.getAttribute('cx');
          const cy = seat.getAttribute('cy');
          const r  = seat.getAttribute('r') ?? '16';
          if (cx && cy) {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            marker.setAttribute('cx', cx);
            marker.setAttribute('cy', cy);
            marker.setAttribute('r', r);
            marker.setAttribute('fill', groupColor);
            marker.setAttribute('stroke', '#000000');
            marker.setAttribute('stroke-width', '6');
            marker.style.filter = 'drop-shadow(0 0 6px ' + groupColor + ')';
            marker.style.pointerEvents = 'none';
            svg.appendChild(marker);
          }
        } else {
          // Assemblée Nationale : paths, utiliser getBBox
          const bbox = seat.getBBox?.();
          if (bbox) {
            const cx = bbox.x + bbox.width / 2;
            const cy = bbox.y + bbox.height / 2;
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            marker.setAttribute('cx', String(cx));
            marker.setAttribute('cy', String(cy));
            marker.setAttribute('r', '50');
            marker.setAttribute('fill', groupColor);
            marker.setAttribute('stroke', '#000000');
            marker.setAttribute('stroke-width', '6');
            marker.style.filter = 'drop-shadow(0 0 6px ' + groupColor + ')';
            marker.style.pointerEvents = 'none';
            svg.appendChild(marker);
          }
        }
      }
    }
  }, [activeSvg, acteur.place_hemicycle, groupColor, isSenat]);

  useEffect(() => {
    if (!carteSvg || !carteRef.current) return;
    const container = carteRef.current;
    container.innerHTML = carteSvg;
    const svg = container.querySelector('svg');
    if (!svg) return;
    svg.setAttribute('width', '100%');
    svg.removeAttribute('height');
    svg.style.height = 'auto';
    // Set all departments to very light grey
    svg.querySelectorAll('path, circle').forEach((el) => {
      (el as SVGElement).style.fill = '#f3f4f6';
    });
    // Remis à zéro à chaque passage : sans tracé trouvé cette fois-ci, le zoom
    // garderait celui d'un passage précédent.
    let nouveauZoom: { trace: string; emprise: Emprise } | null = null;
    // Highlight the elu's department
    if (acteur.num_departement) {
      const idCarte = PASTILLE_CARTE[acteur.num_departement] ?? acteur.num_departement;
      const dept = svg.querySelector(`#d${idCarte}`) as SVGElement | null;
      if (dept) {
        dept.style.fill = groupColor;
        dept.style.stroke = '#000';
        dept.style.strokeWidth = '1.5';
        // Bring to front so stroke isn't covered by neighboring departments
        dept.parentElement?.appendChild(dept);
        // `getBBox()` rend l'emprise dans le repère propre du tracé, sans son
        // `transform` (Mayotte en porte un) : c'est le repère de PREFECTURES.
        const trace = dept.getAttribute('d');
        if (trace && dept instanceof SVGGraphicsElement) {
          const { x, y, width, height } = dept.getBBox();
          nouveauZoom = { trace, emprise: { x, y, width, height } };
        }
      }
    }
    setZoomDept(nouveauZoom);
    // Crop viewBox to actual content bounds (removes empty space above the map)
    setTimeout(() => {
      const bbox = svg.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        svg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`);
      }
    }, 50);
  }, [carteSvg, acteur.num_departement, groupColor]);

  const showHemicycle = hemicycleUtile && !hemicycleEchec;
  const showCarte = !!acteur.num_departement && !carteEchec;
  // Seulement en exercice : la base garde l'adresse d'un ancien élu, peut-être périmée.
  const showPermanence = !!(acteur.adresse_circonscription && (acteur.est_depute_actuel || acteur.est_senateur_actuel));
  const showSiege = showHemicycle || showCarte || showPermanence;
  // Lu seulement quand `showSiege` est faux, donc sans permanence : un hémicycle ou un
  // département attendu dit que les dessins ont tous échoué, et la section dit l'échec
  // plutôt qu'une absence fausse ; sans eux, l'élu n'a ni siège ni territoire.
  const siegeConnu = hemicycleUtile || !!acteur.num_departement;
  // Pas de zoom sans tracé ni préfecture : Français de l'étranger, Pacifique,
  // Saint-Barthélemy et Saint-Martin n'ont qu'une pastille sur la carte.
  const prefecture = acteur.num_departement ? PREFECTURES[acteur.num_departement] : undefined;
  const zoom = zoomDept && prefecture ? { ...zoomDept, prefecture } : null;

  const circoLabel = [
    acteur.departement_election,
    acteur.num_circo ? t('circoOrdinal', { num: acteur.num_circo }) : null,
  ].filter(Boolean).join(' — ');

  // Les verdicts des taux de « Ses votes » nomment la chambre de l'élu (« de
  // l'Assemblée », « du Sénat ») : « moyenne nationale » désignait la moyenne de
  // sa seule chambre, à côté d'une ligne libellée « Chambre ».
  const chambreVerdict = isSenat ? 'SN' : 'AN';
  const verdicts = {
    verdictBelowGroup: t('verdictBelowGroup'),
    verdictEqualGroup: t('verdictEqualGroup'),
    verdictBelowNational: t('verdictBelowNational', { chambre: chambreVerdict }),
    verdictEqualNational: t('verdictEqualNational', { chambre: chambreVerdict }),
    verdictAboveNational: t('verdictAboveNational', { chambre: chambreVerdict }),
  };

  const aDesTaux = acteur.taux_participation_votes_finaux != null
    || acteur.taux_participation_votes_solennels != null
    || acteur.taux_cohesion_groupe != null
    || acteur.taux_delegation != null;

  const questionsTotal = activiteScore
    ? activiteScore.nb_questions_orales + activiteScore.nb_questions_ecrites
    : questions.length;
  const textesTotal = dossiersInities.length + dossiersCoauteur.length;
  // Les lignes « en tant que ministre » restent listées mais ne comptent pas, comme
  // dans le score : le chiffre des déposés est alors celui de « Dossiers initiés »,
  // `page.tsx` rangeant les dossiers selon la règle de `activite_elus_mv`.
  const nbDeposes = dossiersInities.filter((d) => !d.commeMinistre).length;
  const nbCosignes = dossiersCoauteur.filter((d) => !d.commeMinistre).length;
  const amendSorts = acteur.amendements_par_sort;
  const nbAmendCosignes = acteur.nb_amendements_cosignataire ?? 0;
  // Le grand chiffre d'un bloc `.elu-chiffres-bloc`, porté par la balise `<b>` du message.
  const chiffre = (chunks: ReactNode) => <strong className="elu-chiffres-n">{chunks}</strong>;

  // Encore dans le délai pour choisir, ou élection contestée : la situation est
  // régulière aujourd'hui, et la fiche le dit sans ambre, comme la page
  // `/Facts/cumul-des-mandats` le montre en gris dans son tableau. `null`
  // quand le délai est dépassé ou qu'il n'y a pas de situation.
  const dansLesTemps: 'delai' | 'recours' | null = !echeanceCumul
    ? null
    : echeanceCumul.echeance.etat === 'recours'
      ? 'recours'
      : echeanceCumul.depassee ? null : 'delai';

  const mandatsLocauxAffiches = useMemo<MandatAffiche[]>(() => {
    // À Paris, Lyon et Marseille, le RNE inscrit le même élu au conseil
    // municipal et au conseil d'arrondissement. C'est un seul mandat : le
    // second est l'échelon inférieur du premier, pas un cumul de plus.
    const communes = new Set(
      mandatsLocaux.filter((m) => m.type === 'municipal').map((m) => m.collectivite),
    );
    // La fonction, elle, ne se perd pas avec la ligne : c'est du côté de
    // l'arrondissement que le RNE inscrit « 14ème adjoint au maire
    // d'arrondissement », et l'écarter en silence effacerait le seul endroit
    // où cette responsabilité est écrite.
    // La correction suit la fonction : c'est la ligne d'arrondissement qui la
    // porte quand le registre s'y est trompé (Catherine Dumas, jamais adjointe).
    const arrondissementAvecFonction = new Map(
      mandatsLocaux
        .filter((m) => m.type === 'arrondissement' && m.fonction)
        .map((m) => [m.collectivite, m]),
    );
    return mandatsLocaux
      .filter((m) => !(m.type === 'arrondissement' && communes.has(m.collectivite)))
      .slice()
      .sort((a, b) => ORDRE_LOCAL.indexOf(a.type) - ORDRE_LOCAL.indexOf(b.type))
      .map((m) => {
        // La fonction reportée depuis l'arrondissement doit aussi peser sur le
        // statut : c'est elle qui fait de la ligne un mandat exécutif.
        const arrondissement = m.type === 'municipal' && !m.fonction
          ? arrondissementAvecFonction.get(m.collectivite)
          : undefined;
        const fonction = arrondissement?.fonction ?? m.fonction;
        // Seule une correction de fonction suit la fonction reportée : un siège
        // d'arrondissement quitté ne retire pas le siège municipal.
        const verifiee = m.verif_effet
          ? m
          : arrondissement?.verif_effet && arrondissement.verif_effet !== 'mandat_quitte'
            ? arrondissement
            : null;
        // La fonction du registre reste affichée, la correction dessous dit ce
        // qu'il en est. Le statut, lui, se calcule sur ce qui vaut aujourd'hui :
        // un mandat quitté perd sa pastille, une présidence quittée laisse celle
        // du siège.
        const enCours = enVigueur({ ...m, fonction, verif_effet: verifiee?.verif_effet ?? null });
        const statut = enCours ? statutMandat(enCours) : undefined;
        return {
          id: `${m.type}-${m.collectivite}`,
          categorie: `local_${m.type}`,
          nature: 'mandat' as const,
          libelle: m.collectivite,
          qualite: fonction,
          dateDebut: m.date_debut,
          statut,
          enRegle: statut === 'executif' && dansLesTemps !== null ? true : undefined,
          verification: verifiee?.verif_effet
            ? {
                effet: verifiee.verif_effet,
                date: verifiee.verif_date,
                constateLe: verificationCumul,
                sourceUrl: verifiee.verif_source_url,
                sourceNom: verifiee.verif_source_nom,
              }
            : undefined,
        };
      });
  }, [mandatsLocaux, verificationCumul, dansLesTemps]);

  // `formatJourNu` pour la même raison qu'au-dessus : `date_donnee` est une date
  // nue, qu'un visiteur à l'ouest de Greenwich lirait sinon la veille.
  const millesimeRne = mandatsLocaux[0]?.date_donnee
    ? formatJourNu(mandatsLocaux[0].date_donnee, locale, { month: 'long', year: 'numeric' })
    : null;
  const verificationLisible = verificationCumul
    ? formatJourNu(verificationCumul, locale, { day: 'numeric', month: 'long', year: 'numeric' })
    : '';
  // Les alertes jugent ce qui vaut aujourd'hui, après la vérification au cas
  // par cas : une présidence quittée ne déclenche plus « à régulariser ».
  const mandatsEnVigueur = useMemo(
    () => mandatsLocaux.map(enVigueur).filter((m): m is MandatLocal => m !== null),
    [mandatsLocaux],
  );
  const quotaUtilise = useMemo(() => compterQuota(mandatsEnVigueur), [mandatsEnVigueur]);
  // Une fonction exécutive seule ne dépasse pas le quota, mais sa pastille « à
  // régulariser » appelle la même réserve sur le retard du registre.
  const aFonctionExecutive = useMemo(
    () => mandatsEnVigueur.some((m) => statutMandat(m) === 'executif'),
    [mandatsEnVigueur],
  );
  // La commune trop petite pour que LO 141 compte son conseil, s'il y en a une.
  const mandatExempte = useMemo(
    () => mandatsEnVigueur.find((m) => statutMandat(m) === 'commune_petite')?.collectivite ?? null,
    [mandatsEnVigueur],
  );
  // L'état de la situation de cumul, rangé comme sur `/Facts/cumul-des-mandats` :
  // délai dépassé, encore dans le délai, élection contestée, ou réglée alors que
  // le registre la relève encore. `null` sans situation, ni au registre ni après
  // vérification. C'est lui que disent la pastille sous le résumé et l'encadré.
  const situationAuRegistre = useMemo(
    () => mandatsLocaux.some((m) => estFonctionExecutive(m.fonction)) || compterQuota(mandatsLocaux) > 1,
    [mandatsLocaux],
  );
  // Seul un parlementaire en exercice a une situation de cumul : ses lignes du
  // registre restent jusqu'à l'import hebdomadaire suivant, et un député parti
  // pour garder sa mairie se lirait sinon « à régulariser », faute de délai
  // calculé côté serveur.
  const etatCumul: 'depasse' | 'delai' | 'recours' | 'regularise' | null =
    !(acteur.est_depute_actuel || acteur.est_senateur_actuel)
      ? null
      : quotaUtilise > 1 || aFonctionExecutive
      ? dansLesTemps ?? 'depasse'
      : situationAuRegistre ? 'regularise' : null;
  // Trois blocs et non un total : additionner siège, commissions et groupes
  // d'amitié faisait lire « 24 mandats en cours » là où l'élu n'en détient qu'un
  // au sens du cumul (FICHE-03). Les mandats locaux rejoignent le siège, le reste
  // se range selon `nature`, fixée côté serveur par `TYPES_MANDAT`.
  const blocsMandats = useMemo(() => {
    const blocs: BlocMandats[] = [
      {
        cle: 'mandats',
        lignes: [...mandatsNationaux.filter((m) => m.nature === 'mandat'), ...mandatsLocauxAffiches],
      },
      { cle: 'fonctions', lignes: mandatsNationaux.filter((m) => m.nature === 'fonction') },
      { cle: 'appartenances', lignes: mandatsNationaux.filter((m) => m.nature === 'appartenance') },
    ];
    return blocs.filter((bloc) => bloc.lignes.length > 0);
  }, [mandatsNationaux, mandatsLocauxAffiches]);
  // L'élection suffit à ouvrir la carte : un ancien élu sans ligne de mandat garde
  // ses résultats (D-298).
  const showMandats = blocsMandats.length > 0 || election !== null;
  // La ligne du siège reçoit l'élection qui l'a donné (D-298). `rang: 0` la met en
  // tête du premier bloc, donc toujours dans le fil, jamais coupée par `RESUME`.
  const idLigneChambre = election
    ? blocsMandats.find((bloc) => bloc.cle === 'mandats')?.lignes.find((m) => m.categorie === 'chambre')?.id ?? null
    : null;
  // Le fil garde deux colonnes, les deux premiers blocs non vides : mandats et
  // fonctions le plus souvent, les appartenances ne remontant que chez l'élu à
  // qui il manque l'un des deux. Chaque colonne s'arrête à `RESUME` lignes, et le
  // lien commun n'apparaît que si quelque chose reste hors du fil.
  const blocsFil = blocsMandats.slice(0, 2);
  const lignesMandats = blocsMandats.reduce((n, bloc) => n + bloc.lignes.length, 0);
  const lignesMandatsVues = blocsFil.reduce((n, bloc) => n + Math.min(bloc.lignes.length, RESUME), 0);
  const appartenancesHorsFil = blocsMandats.slice(2).find((bloc) => bloc.cle === 'appartenances')?.lignes.length ?? 0;
  // « 1 mandat parlementaire, 3 mandats locaux et 3 fonctions » : chaque compte a
  // son propre mot, et `ListFormat` pose la conjonction de la langue. Le
  // sous-titre de la section tait les appartenances, qui gonfleraient la phrase
  // de ce qui n'est pas un mandat ; le tiroir, qui les liste, les compte.
  const resumeMandats = (avecAppartenances: boolean) => {
    const compte = (cle: BlocMandats['cle']) =>
      blocsMandats.find((bloc) => bloc.cle === cle)?.lignes.length ?? 0;
    const parlementaires = compte('mandats') - mandatsLocauxAffiches.length;
    // Un mandat quitté reste listé avec sa source, mais n'est plus un mandat
    // que l'élu détient : il sort du compte.
    const locaux = mandatsLocauxAffiches.filter((m) => m.verification?.effet !== 'mandat_quitte').length;
    const fonctions = compte('fonctions');
    const appartenances = compte('appartenances');
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format([
      parlementaires > 0 ? t('mandatsCompteParlementaire', { count: parlementaires }) : null,
      locaux > 0 ? t('mandatsCompteLocaux', { count: locaux }) : null,
      fonctions > 0 ? t('mandatsCompteFonctions', { count: fonctions }) : null,
      avecAppartenances && appartenances > 0 ? t('mandatsCompteAppartenances', { count: appartenances }) : null,
    ].filter((partie): partie is string => partie !== null));
  };
  // Le sous-titre de la section le teste puis l'affiche : calculé une fois.
  const resumeSansAppartenances = resumeMandats(false);

  // Deux colonnes, une par source : les
  // intérêts que l'élu déclare lui-même à la HATVP d'un côté, ce que son
  // assemblée enregistre de l'autre. Ce ne sont pas les mêmes formulaires, ni
  // les mêmes autorités, ni la même obligation, et les empiler sous un titre
  // unique faisait lire un registre pour une déclaration.
  //
  // Chaque colonne se subdivise par nature de fait : un seul bloc en empilait
  // sept que seule une pastille grise distinguait.
  const colonnesTransparence = useMemo(() => {
    const grouper = (garde: (e: TransparenceElement) => boolean) =>
      ORDRE_TRANSPARENCE
        .map((categorie) => ({
          categorie,
          elements: transparence.filter((e) => e.categorie === categorie && garde(e)),
        }))
        .filter((g) => g.elements.length > 0);

    const registres = transparence.filter((e) => e.source !== 'hatvp');
    return {
      hatvp: grouper((e) => e.source === 'hatvp'),
      registres: grouper((e) => e.source !== 'hatvp'),
      // Un député n'a que les registres de l'Assemblée, un sénateur que ceux du
      // Sénat : la source des lignes suffit à nommer la colonne.
      chambreRegistres: registres.some((e) => e.source.startsWith('senat')) ? 'senat' : 'an',
    };
  }, [transparence]);

  const transparenceAffichees =
    compterLignesVues(colonnesTransparence.hatvp)
    + compterLignesVues(colonnesTransparence.registres);
  const hatvpDate = hatvp?.date_depot
    ? formatJourNu(hatvp.date_depot, locale, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // La carte s'affiche dès qu'il y a quelque chose à dire, et une déclaration
  // déposée en fait partie : « déclaration déposée, rien à déclarer » n'est pas
  // la même phrase que « on ne sait pas ». La date de dépôt est la condition de
  // cette seconde forme : les trois phrases de couverture la portent toutes, et
  // six parlementaires ont une déclaration sans date. Sans ce test, leur fiche
  // ouvrait une carte titrée qui ne contenait que le crédit de source. Sinon, la
  // section ne porte que sa phrase d'absence.
  const showTransparence = transparence.length > 0 || (hatvp !== null && hatvpDate !== null);

  // Une ancre par section : toutes figurent sur toute fiche, une phrase d'absence
  // remplaçant le contenu qui manque (« Son siège » chez un ministre).
  const clesAncres: SectionCle[] = [
    'activite', 'votes', 'affinites', 'paroles', 'textes', 'amendements', 'questions',
    'mandats', 'transparence', 'siege',
  ];
  const ancres = clesAncres.map((cle) => {
    const Icone = ICONES[cle];
    return {
      cle,
      label: t(`anchor${cle.charAt(0).toUpperCase()}${cle.slice(1)}` as Parameters<typeof t>[0]),
      icone: <Icone size={15} strokeWidth={1.5} aria-hidden style={{ flex: 'none' }} />,
    };
  });

  // La date limite et sa source, quand la vérification l'a établie plutôt que
  // le calcul.
  const e = echeanceCumul?.echeance;
  const dateEcheance = e?.etat === 'date'
    ? formatJourNu(e.date, locale, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const sourceEcheance = e?.sourceUrl && etatCumul !== 'regularise' && (
    <>
      {' '}
      {t.rich('mandatVerifSource', {
        nom: e.sourceNom ?? e.sourceUrl,
        lien: (chunks) => (
          <a href={e.sourceUrl ?? undefined} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}>
            {chunks}
          </a>
        ),
      })}
    </>
  );

  // Le verdict d'un coup d'œil, sous le résumé des mandats : l'ambre pour un
  // délai dépassé, seul cas à régulariser, le gris sinon.
  // Préfixée de « Cumul des mandats » : seule sous le résumé, elle ne disait pas
  // de quoi elle parlait. Elle mène à l'article, qui explique les deux règles,
  // le délai pour choisir et la liste de tous les élus concernés.
  const pastilleCumul = etatCumul && (
    <Link
      href="/Facts/cumul-des-mandats"
      prefetch={false}
      className="elu-pastille-cumul"
      style={{
        display: 'inline-block', marginTop: '0.5rem', padding: '0.125rem 0.5rem', borderRadius: '0.375rem',
        fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.35, textDecoration: 'none',
        ...(etatCumul === 'depasse'
          ? { backgroundColor: 'rgba(217, 119, 6, 0.14)', color: '#b45309' }
          : { backgroundColor: 'var(--muted)', color: 'var(--muted-foreground)' }),
      }}
    >
      <span style={{ fontWeight: 400 }}>{t('cumulPastillePrefixe')} · </span>
      {etatCumul === 'depasse'
        ? dateEcheance ? t('cumulPastilleDepasse', { date: dateEcheance }) : t('cumulPastilleNonDate')
        : etatCumul === 'delai'
          ? t('cumulPastilleDelai', { date: dateEcheance ?? '' })
          : etatCumul === 'recours' ? t('cumulPastilleRecours') : t('cumulPastilleRegularise')}
      {' →'}
    </Link>
  );

  // L'encadré sous les mandats : le verdict en première ligne, puis le motif
  // relevé par le registre et la date de la vérification. Le verdict venait à
  // la fin d'un paragraphe de cinq lignes, et la fiche ne disait pas clairement
  // s'il y avait une situation à régulariser.
  const verdictCumul =
    etatCumul === 'depasse'
      ? dateEcheance ? t('cumulVerdictDepasse', { date: dateEcheance }) : t('cumulVerdictNonDate')
      : etatCumul === 'delai'
        ? t('cumulVerdictDelai', { date: dateEcheance ?? '' })
        : etatCumul === 'recours' ? t('cumulVerdictRecours') : t('cumulVerdictRegularise');
  const encadreCumul = etatCumul && (
    <div className={etatCumul === 'depasse' ? 'elu-alerte' : 'elu-alerte elu-alerte--neutre'}>
      <p style={{ margin: 0, fontWeight: 600 }}>
        {verdictCumul}
        {sourceEcheance}
      </p>
      <p style={{ margin: '0.25rem 0 0' }}>
        {etatCumul === 'regularise' ? (
          t('cumulMotifRegularise')
        ) : (
          <>
            {quotaUtilise > 1 && t('cumulMotifQuota', { count: quotaUtilise })}
            {quotaUtilise > 1 && aFonctionExecutive && ' '}
            {aFonctionExecutive && t('cumulMotifExecutif')}
          </>
        )}
        {verificationLisible && <> {t('cumulVerifie', { date: verificationLisible })}</>}
      </p>
    </div>
  );

  // Réserve, exemption et date du registre, sous la section et au pied du tiroir :
  // une pastille « à régulariser » ne se lit jamais sans ce qui la nuance (D-274).
  const notesMandats = (
    <>
      {/* On l'énonce comme une règle, jamais comme un reproche : seul un délai
          dépassé est « à régulariser », et en ambre. */}
      {encadreCumul}
      {/* L'exemption des petites communes ne se devine pas depuis la
          pastille seule : elle change ce que l'élu a encore le droit de
          prendre, et c'est ça qu'il faut dire. */}
      {quotaUtilise <= 1 && mandatExempte && (
        <p className="elu-note">
          {t(quotaUtilise === 0 ? 'mandatsExemptionLibre' : 'mandatsExemptionPrise', {
            commune: mandatExempte,
          })}
        </p>
      )}
      {millesimeRne && mandatsLocauxAffiches.length > 0 && (
        <p className="elu-note">{t('mandatsSourceNote', { date: millesimeRne })}</p>
      )}
    </>
  );

  // Les sections qui n'ont que leur phrase d'absence à montrer. Elles gardent titre et
  // ancre (D-306), mais perdent leur carte : la phrase se pose en gris sous le titre,
  // comme sur la fiche dossier (`noCcData`, `noElusData`), sans cadre blanc vide. Une
  // section qui garde un chiffre ou un lien à côté de sa phrase garde sa carte : un
  // élu non classé (lien « Comparer »), un élu qui n'a que cosigné des amendements.
  const vide: Record<SectionCle, boolean> = {
    activite: !activiteScore,
    votes: !aDesTaux && votesNominatifs.length === 0 && !activiteScore?.estPresidentChambre,
    affinites: affinites.groupes.length === 0,
    paroles: dossierGroups.length === 0,
    textes: textesTotal === 0,
    amendements: !amendSorts && nbAmendCosignes === 0,
    questions: questions.length === 0,
    mandats: !showMandats,
    transparence: !showTransparence,
    siege: !showSiege,
  };

  return (
    <div>
      <style>{`
        .elu-logo-hero { display: none; }
        @media (min-width: 1024px) { .elu-logo-hero { display: block; } }

        /* Une seule grammaire de ligne pour les votes, les paroles, les textes
           et les questions, dans le fil comme dans le tiroir. */
        .elu-row { border-top: 1px solid var(--border); padding: 0.875rem 0.625rem; margin: 0 -0.625rem; border-radius: 0.375rem; }
        /* Le survol ne s'allume que sur une ligne qui mène quelque part : une
           prise de parole du tiroir n'a pas de titre cliquable, elle ne le prend pas. */
        .elu-row--clic:hover { background-color: var(--muted); }
        .elu-row-top { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
        .elu-row-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.5rem; margin-top: 0.4rem; font-size: 0.75rem; color: var(--muted-foreground); }

        /* Vote : empilé en mobile, en colonnes dès 720 px. */
        .elu-vote { display: grid; grid-template-columns: 1fr auto; gap: 0.3rem 0.875rem; align-items: baseline; }
        .elu-vote-d { order: 1; }
        .elu-vote-res { order: 2; text-align: right; }
        .elu-vote-t { order: 3; grid-column: 1 / -1; }
        .elu-vote-pos { order: 4; grid-column: 1 / -1; }
        @media (min-width: 720px) {
          .elu-vote { grid-template-columns: 5.5rem 1fr 7rem; }
          .elu-vote--res { grid-template-columns: 5.5rem 1fr 7rem 5.5rem; }
          .elu-vote > * { order: 0; grid-column: auto; text-align: left; }
        }

        .elu-empty { padding: 1.75rem 0.625rem; margin: 0; color: var(--muted-foreground); font-size: 0.875rem; }
        /* La phrase d'une section entièrement vide, hors carte (voir la table vide). */
        .elu-absent { margin: 0; color: var(--muted-foreground); font-size: 0.875rem; line-height: 1.55; }
        /* Les totaux d'une section, au-dessus de sa liste, dans la grammaire de
           l'en-tête de la carte Activité : grand chiffre, libellé atténué dessous,
           trait fin entre deux blocs. Contrairement à cet en-tête, les blocs restent
           côte à côte sur téléphone (le libellé passe à la ligne s'il le faut) :
           leurs libellés sont courts, et les empiler doublerait la hauteur. Le
           libellé est le texte nu du bloc, le chiffre la balise <b> du message. */
        .elu-chiffres { display: flex; gap: 2.25rem; margin: 0 0 1.25rem; }
        .elu-chiffres-bloc { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; margin: 0;
                             font-size: 0.8125rem; color: var(--muted-foreground); }
        .elu-chiffres-bloc + .elu-chiffres-bloc { border-left: 1px solid var(--border); padding-left: 2.25rem; }
        .elu-chiffres-n { font-size: 2.25rem; font-weight: 700; letter-spacing: -0.03em; line-height: 1; color: var(--foreground);
                          font-variant-numeric: tabular-nums; }
        @media (max-width: 559px) {
          .elu-chiffres { gap: 1.25rem; }
          .elu-chiffres-bloc + .elu-chiffres-bloc { padding-left: 1.25rem; }
          /* Quatre blocs (« Amendements ») ne tiennent pas sur une ligne de
             téléphone : deux rangées de deux, le trait seulement entre les deux
             colonnes, sinon il tomberait au bord gauche de la seconde rangée. */
          .elu-chiffres--quatre { display: grid; grid-template-columns: auto auto; justify-content: start; column-gap: 1.25rem; row-gap: 1.25rem; }
          .elu-chiffres--quatre .elu-chiffres-bloc { border-left: 0; padding-left: 0; }
          .elu-chiffres--quatre .elu-chiffres-bloc:nth-child(even) { border-left: 1px solid var(--border); padding-left: 1.25rem; }
        }
        /* La provenance des mandats locaux, en pied de colonne : ils viennent
           d'un fichier trimestriel là où le reste de la fiche se met à jour
           chaque nuit, et cet écart doit se lire. */
        .elu-note { margin: 0.875rem 0 0; padding: 0 0.625rem; font-size: 0.75rem; color: var(--muted-foreground); }
        /* L'ambre, pas le rouge : la situation devra se résoudre, mais elle est
           le plus souvent régulière au moment où on la lit. */
        .elu-alerte { margin: 1rem 0 0; padding: 0.75rem 0.875rem; border-radius: 0.5rem; font-size: 0.8125rem;
                      background-color: rgba(217, 119, 6, 0.10); color: #b45309; }
        /* Encore dans le délai, ou sous recours : même encadré, sans l'ambre. */
        .elu-alerte--neutre { background-color: var(--muted); color: var(--muted-foreground); }
        /* La pastille du cumul est un lien vers l'article : le survol le dit. */
        .elu-pastille-cumul { transition: filter 0.15s ease; }
        .elu-pastille-cumul:hover { filter: brightness(0.93); text-decoration: underline !important; text-underline-offset: 2px; }

        /* Deux blocs côte à côte dès qu'il y a la place : mandats et fonctions,
           ou les deux sources de la transparence. Empilés sur mobile, les deux
           intertitres suffisent à les séparer. */
        /* L'écart vertical ne sert qu'empilé : il sépare la fin du premier bloc
           de l'intertitre du second, dont la marge haute tombe à zéro puisqu'il
           ouvre sa propre colonne. Sur deux colonnes, il n'y a qu'une rangée. */
        .elu-mandats-colonnes { display: grid; grid-template-columns: 1fr; gap: 1.75rem 2.5rem; align-content: start; }
        @media (min-width: 768px) { .elu-mandats-colonnes { grid-template-columns: 1fr 1fr; } }
        .elu-drawer-intertitre { font-size: 0.8125rem; font-weight: 600; color: var(--muted-foreground); margin: 1.75rem 0 0.25rem; }
        .elu-drawer-intertitre:first-child { margin-top: 0; }
        /* Le dossier sous lequel le tiroir range des amendements : un titre de
           ligne, en encre pleine, et non une capitale espacée comme une nature. */
        .elu-amend-dossier { font-size: 0.875rem; font-weight: 600; line-height: 1.4; color: var(--foreground); margin: 1.25rem 0 0.375rem; }
        /* Sous-titre de nature, à l'intérieur d'une colonne de transparence. Il
           reste en encre atténuée : en noir il avait le même poids que le titre
           de la ligne juste en dessous, et la séparation ne se voyait plus. Ce
           sont les capitales espacées et l'air au-dessus qui le distinguent, pas
           la couleur. Pas de filet : la première ligne du groupe en porte un. */
        .elu-groupe-titre {
          font-size: 0.625rem; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--muted-foreground);
          margin: 1.5rem 0 0.125rem;
        }
        .elu-groupe-titre:first-child { margin-top: 0.75rem; }
        /* Les deux colonnes n'ont ni le même nombre de lignes par groupe ni des
           libellés de même longueur : l'objet d'un voyage tient sur trois lignes
           là qu'une fonction de direction en prend une, et le décalage entre les
           colonnes se creusait ligne après ligne. Plafonner chaque champ borne la
           hauteur d'une ligne, le plancher relève celles qui sont courtes. Le
           texte entier reste dans le tiroir et derrière le lien de la source. */
        .elu-transparence-row { min-height: 5.25rem; }
        .elu-transparence-titre {
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .elu-transparence-detail {
          display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
          overflow: hidden;
        }
        /* Dans le tiroir, rien n'est tronqué ni aligné : il n'y a qu'une colonne,
           et c'est là qu'on vient lire le texte complet. */
        .elu-drawer-corps .elu-transparence-row { min-height: 0; }
        .elu-drawer-corps .elu-transparence-titre,
        .elu-drawer-corps .elu-transparence-detail {
          display: block; -webkit-line-clamp: none; overflow: visible;
        }
        .elu-voir { display: inline-block; margin-top: 1.25rem; font-size: 0.8125rem; font-weight: 500; color: var(--primary); background: none; border: 0; padding: 0; cursor: pointer; }
        .elu-voir:hover { text-decoration: underline; }
        /* « Comparer avec… » et la méthodologie, côte à côte, l'un sous l'autre sur téléphone. */
        .elu-liens-activite { display: flex; flex-wrap: wrap; column-gap: 1.75rem; }
        /* Le lien de dépliage du bloc élection (BlocElection) : en --surtitre comme
           la nuance et la mention (D-298), pas en --primary comme .elu-voir. */
        .elu-election-voir { display: inline-flex; align-items: center; gap: 0.3rem; font: inherit; font-size: 0.8125rem; font-weight: 500; color: var(--surtitre); background: none; border: 0; padding: 0.625rem 0; margin: -0.125rem 0 -0.375rem; cursor: pointer; }
        .elu-election-voir:hover { text-decoration: underline; }
        .elu-election-voir:focus-visible { outline: 2px solid var(--ring); outline-offset: 3px; border-radius: 0.25rem; }
        .elu-election-voir svg { transition: transform 0.2s ease; }
        .elu-election-voir[aria-expanded="true"] svg { transform: rotate(180deg); }
        @media (prefers-reduced-motion: reduce) { .elu-election-voir svg { transition: none; } }

        /* En-tête de la carte Activité : le rang et les jours de mandat, séparés
           par un trait fin, empilés sans trait sur téléphone. Au-delà, les blocs
           ne passent jamais à la ligne (leurs libellés le font) : un bloc renvoyé
           sous l'autre garderait son trait et son retrait au bord gauche. */
        .elu-activite-tete { display: flex; flex-wrap: nowrap; gap: 0.875rem 2.25rem; align-items: flex-end; }
        .elu-activite-bloc { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
        .elu-activite-bloc + .elu-activite-bloc { border-left: 1px solid var(--border); padding-left: 2.25rem; }
        .elu-activite-grand { font-size: 2.75rem; font-weight: 700; letter-spacing: -0.04em; line-height: 1; color: var(--foreground); font-variant-numeric: tabular-nums; }
        .elu-activite-grand sup { font-size: 1.125rem; letter-spacing: 0; vertical-align: 1.15em; line-height: 0; margin-left: 1px; }
        .elu-activite-legende { font-size: 0.8125rem; color: var(--muted-foreground); }
        .elu-activite-sep { margin: 0 0.4rem; opacity: 0.5; }

        /* Les quatre fonctions du score, toutes mesures visibles : une colonne,
           deux sur grand écran. Chaque ligne de mesure est sa propre grille, aux
           colonnes de largeur fixe pour que barres et rangs s'alignent d'une ligne
           à l'autre. */
        .elu-fonctions { display: grid; grid-template-columns: 1fr; column-gap: 2.5rem; margin-top: 1.375rem; }
        .elu-fonction { padding: 0.875rem 0 0.625rem; }
        .elu-fonction-tete { display: flex; justify-content: space-between; align-items: baseline; gap: 0.75rem;
                             margin-bottom: 0.375rem; padding: 0.5rem 0.75rem; border-radius: 8px; background: var(--muted); }
        .elu-fonction-nom { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--foreground); }
        .elu-fonction-poids { margin-left: 0.5rem; font-size: 0.75rem; font-weight: 400; text-transform: none; letter-spacing: 0;
                              color: var(--muted-foreground); white-space: nowrap; display: inline-block; }
        .elu-fonction-rang { font-size: 0.875rem; font-weight: 600; color: var(--foreground); white-space: nowrap; font-variant-numeric: tabular-nums; }
        .elu-fonction-rang > span { font-weight: 400; color: var(--muted-foreground); }
        .elu-fonction sup, .elu-mesure sup { font-size: 0.68em; line-height: 0; }
        .elu-mesure { display: grid; grid-template-columns: 4.25rem 1fr auto; align-items: baseline; gap: 2px 0.75rem; padding: 0.375rem 0; }
        .elu-mesure-n { font-size: 1rem; font-weight: 600; color: var(--foreground); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .elu-mesure-l { font-size: 0.8125rem; color: var(--card-foreground); min-width: 0; }
        .elu-mesure-lien { padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer;
                           text-decoration: underline; text-decoration-color: color-mix(in oklch, var(--muted-foreground) 45%, transparent);
                           text-decoration-thickness: 1px; text-underline-offset: 3px; }
        .elu-mesure-lien:hover { text-decoration-color: var(--primary); color: var(--foreground); }
        .elu-mesure-info { display: inline-flex; vertical-align: -1px; margin-left: 0.35rem; }
        .elu-mesure-c { display: flex; align-items: center; gap: 0.625rem; font-size: 0.8125rem; font-weight: 600; color: var(--foreground);
                        white-space: nowrap; font-variant-numeric: tabular-nums; }
        .elu-mesure-barre { position: relative; flex: none; width: 96px; height: 4px; border-radius: 2px; background: var(--border); }
        .elu-mesure-barre > span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; background: var(--primary); }
        .elu-mesure-r { width: 2.6rem; text-align: right; }
        @media (min-width: 900px) { .elu-fonctions { grid-template-columns: 1fr 1fr; } }

        /* Sujets de prédilection : un trait fin les sépare des fonctions, sans carte. */
        .elu-themes { margin-top: 0.75rem; padding-top: 1rem; border-top: 1px solid var(--border); }
        .elu-themes-liste { margin: 0.5rem 0 0; font-size: 0.9375rem; font-weight: 600; line-height: 1.6; color: var(--foreground); }
        @media (max-width: 559px) {
          .elu-activite-tete { flex-wrap: wrap; }
          .elu-activite-bloc + .elu-activite-bloc { border-left: 0; padding-left: 0; }
          .elu-mesure { grid-template-columns: 3.25rem 1fr auto; gap: 2px 0.625rem; }
          .elu-mesure-barre { display: none; }
          .elu-mesure-r { width: auto; }
        }

        /* Chaque StatTaux occupe cinq rangées de cette grille et les reprend en
           subgrid : chiffre, libellé, votes bruts, comparaisons et verdict
           s'alignent donc d'une colonne à l'autre, même quand l'un des cinq est
           vide. Un député a quatre taux, un sénateur deux : une colonne sur
           téléphone, deux de 560 à 1 199 px, puis tous sur une ligne. Laissée à
           auto-fit seul, la grille mettait la quatrième colonne seule sur une
           deuxième ligne entre ~900 et ~1 190 px (constaté le 2026-11-10). Le
           trait fin entre colonnes, celui des totaux des autres sections, ne
           sépare que deux blocs d'une même ligne : en début de ligne, il
           tomberait au bord gauche. */
        .elu-stats { display: grid; column-gap: 2.25rem; row-gap: 1.75rem; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); margin-bottom: 2rem; }
        .elu-stat { display: grid; grid-row: span 5; grid-template-rows: subgrid; row-gap: 0.25rem; min-width: 0; }
        .elu-stat-libelle { font-size: 0.8125rem; color: var(--muted-foreground); }
        .elu-stat-detail { font-size: 0.75rem; color: var(--muted-foreground); line-height: 1.5; }
        @media (min-width: 560px) and (max-width: 1199px) {
          .elu-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .elu-stat:nth-child(even) { border-left: 1px solid var(--border); padding-left: 2.25rem; }
        }
        @media (min-width: 1200px) {
          .elu-stats { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
          .elu-stat + .elu-stat { border-left: 1px solid var(--border); padding-left: 2.25rem; }
        }
        /* Empilés sur téléphone, les blocs n'ont rien à aligner : la ligne vide
           (« N / M votes » absent de la cohésion) n'y laisserait qu'un trou. */
        @media (max-width: 559px) { .elu-stat-detail:empty { display: none; } }

        /* Affinités de vote : une grille à trois colonnes que chaque ligne reprend
           en subgrid (sigle, barre, pourcentage), donc barres et chiffres alignés.
           La barre reprend le rail de .elu-mesure-barre mais occupe toute la
           largeur restante, téléphone compris : c'est elle qui porte l'information.
           La colonne du sigle est bornée à 45 % : un groupe sans sigle affiche son
           libellé long, qui passe alors à la ligne au lieu d'écraser la barre. */
        .elu-accords { display: grid; grid-template-columns: fit-content(45%) 1fr auto; column-gap: 0.875rem; list-style: none; padding: 0; margin: 0; }
        .elu-accord { display: grid; grid-column: 1 / -1; grid-template-columns: subgrid; align-items: center; padding: 0.4375rem 0; }
        .elu-accord-sigle { font-size: 0.875rem; font-weight: 600; color: var(--foreground); line-height: 1.3; }
        .elu-accord-mention { display: block; font-size: 0.6875rem; font-weight: 400; color: var(--muted-foreground); }
        .elu-accord-barre { position: relative; height: 6px; border-radius: 3px; background: var(--border); }
        .elu-accord-barre > span { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 3px; }
        .elu-accord-n { font-size: 0.875rem; font-weight: 600; color: var(--foreground); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

        /* Les deux schémas se répondent, collés à gauche : étalés sur toute la
           largeur ils laissaient un vide plus large qu'eux. */
        .elu-place { display: grid; gap: 2.5rem; grid-template-columns: repeat(auto-fit, minmax(240px, 320px)); justify-content: start; }
      `}</style>

      {(() => {
        const heroMeta: PageHeroMetaRow[] = [];
        if (mandatePills.length > 0) {
          heroMeta.push({
            icon: <BadgeCheck className="h-3 w-3" />,
            label: t('metaMandat'),
            pills: mandatePills,
          });
        }
        // Un ancien élu n'a pas de mandat en cours : la pastille dit lequel il a
        // quitté ; la date de fin est dans le pied du hero, en toutes lettres.
        if (mandatTermine) {
          heroMeta.push({
            icon: <BadgeCheck className="h-3 w-3" />,
            label: t('metaMandat'),
            pills: [{ children: t('ancienMandat', { role: mandatTermine.role, genre: acteur.civ?.trim() === 'Mme' ? 'F' : 'M' }) }],
          });
        }
        // Placée juste après le mandat, dont elle est la date : celle du mandat
        // en cours, pas de la première élection. Le libellé dit ce qu'elle est,
        // élection ou prise de fonction, et la liste des mandats reprend la même.
        if (dateMandat && debutMandat) {
          heroMeta.push({
            icon: <CalendarDays className="h-3 w-3" />,
            label: t('metaDebutMandat', {
              nature: dateMandat.nature,
              genre: acteur.civ?.trim() === 'Mme' ? 'F' : 'M',
            }),
            pills: [{ children: debutMandat }],
          });
        }
        if (acteur.groupe?.libelle) {
          heroMeta.push({
            icon: <Users className="h-3 w-3" />,
            label: t('metaGroupe'),
            pills: [{
              children: (
                <>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: groupColor,
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  {acteur.groupe.libelle}
                </>
              ),
            }],
          });
        } else if (dernierGroupe) {
          heroMeta.push({
            icon: <Users className="h-3 w-3" />,
            label: t('metaDernierGroupe'),
            pills: [{
              children: (
                <>
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: dernierGroupe.couleur ?? '#6b7280',
                      display: 'inline-block',
                      flexShrink: 0,
                    }}
                  />
                  {dernierGroupe.libelle}
                </>
              ),
            }],
          });
        }
        if (acteur.departement_election || acteur.num_circo) {
          heroMeta.push({
            icon: <MapPin className="h-3 w-3" />,
            label: t('metaCirco'),
            pills: [{ children: circoLabel }],
          });
        }
        if (acteur.age != null) {
          heroMeta.push({
            icon: <User className="h-3 w-3" />,
            label: t('metaAge'),
            pills: [{ children: t('yearsOld', { age: acteur.age }) }],
          });
        }
        // Un lien et aucun texte repris (EL-01) : l'extrait affiché avant qualifiait
        // certains élus et pas d'autres, au gré des contributeurs de Wikipédia. Il
        // se range avec le crédit photo, parmi ce qui renvoie ailleurs.
        if (wikipedia) {
          heroMeta.push({
            icon: <BookOpen className="h-3 w-3" />,
            label: t('metaBiographie'),
            pills: [{
              children: t(wikipedia.repliFrancais ? 'wikipediaArticleFrancais' : 'wikipediaArticle'),
              href: wikipedia.url,
            }],
          });
        }
        // En dernier : c'est un crédit d'image, pas une information sur l'élu.
        if (photo) {
          heroMeta.push({
            icon: <Camera className="h-3 w-3" />,
            label: t('metaPhoto'),
            pills: [{
              children: photo.source === 'senat' ? t('photoSourceSenat') : t('photoSourceAssemblee'),
              href: photo.href ?? undefined,
            }],
          });
        }
        return (
          <PageHero
            title={fullName}
            avatar={
              <PhotoEluHero
                photo={photo}
                initiales={[acteur.prenom, acteur.nom].map((p) => p?.[0] ?? '').join('')}
                nomComplet={fullName}
                ancien={!!mandatTermine}
                onErreur={() => setPhotoCassee(true)}
              />
            }
            meta={heroMeta}
            shareUrl={shareUrl}
            aside={acteur.groupe?.uid ? (
              <div className="elu-logo-hero">
                <GroupLogoImage
                  groupeUid={acteur.groupe.uid}
                  imgStyle={{ width: '220px', height: 'auto', maxHeight: '90px', objectFit: 'contain', filter: 'var(--bandeau-logo)' }}
                />
              </div>
            ) : null}
            // La bande de contact vit dans le pied du hero, comme celle de la
            // fiche dossier (D-213). `undefined` et non `false` : `PageHero`
            // teste ce slot pour décider de son padding du bas. Pour un ancien
            // élu, le pied dit qu'il ne siège plus, à la place de la bande de
            // contact, comme le bandeau de la fiche dossier qui ne propose pas de
            // lui écrire : la base garde souvent son adresse parlementaire, que la
            // chambre ferme en fin de mandat.
            footer={mandatTermine ? (
              <p style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', margin: 0, fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--bandeau-texte)' }}>
                <History size={16} strokeWidth={1.5} aria-hidden style={{ flex: 'none', marginTop: '2px', color: 'var(--bandeau-texte-doux)' }} />
                <span>
                  {mandatTermine.fin
                    ? t('ancienBandeauDate', { role: mandatTermine.role, genre: acteur.civ?.trim() === 'Mme' ? 'F' : 'M', date: dateLongue(mandatTermine.fin) })
                    : t('ancienBandeau', { role: mandatTermine.role })}
                </span>
              </p>
            ) : (acteur.est_depute_actuel || acteur.est_senateur_actuel || acteur.email) ? (
              <ContacterEluCard
                acteur={{
                  uid: acteur.uid,
                  prenom: acteur.prenom,
                  nom: acteur.nom,
                  civ: acteur.civ,
                  email: acteur.email,
                  telephone: acteur.telephone,
                  twitter_url: acteur.twitter_url,
                  instagram_url: acteur.instagram_url,
                  facebook_url: acteur.facebook_url,
                  linkedin_url: acteur.linkedin_url,
                  url_profil_officiel: acteur.url_profil_officiel,
                  num_circo: acteur.num_circo,
                  num_departement: acteur.num_departement,
                  est_depute_actuel: acteur.est_depute_actuel,
                  est_senateur_actuel: acteur.est_senateur_actuel,
                  groupe: acteur.groupe
                    ? { libelle: acteur.groupe.libelle, libelle_abrege: acteur.groupe.libelle_abrege }
                    : null,
                }}
              />
            ) : undefined}
          />
        );
      })()}

      <BarreAncres ancres={ancres} ariaLabel={t('anchorsNavLabel')} />

      {/* ── Son activité ─────────────────────────────────────────────────── */}
      <SectionRepliable
        carte={!vide.activite}
        cleStockage={CLE_PLI}
        cle="activite"
        icone={<IconeSection cle="activite" />}
        titre={t('activityScoreTitle')}
        sousTitre={activiteScore?.score != null
          ? t.rich('activiteSectionDesc', { chambre: activiteScore.chambre, sup: (chunks) => <sup>{chunks}</sup> })
          : undefined}
      >
        {/* `!activiteScore` et non `vide.activite`, sa valeur exacte : seul le test
            direct réduit le type pour les branches qui suivent. */}
        {!activiteScore ? (
          <p className="elu-absent">{t('emptyActivite')}</p>
        ) : activiteScore.estPresidentChambre || activiteScore.estPresidentGroupe ? (
          /* Hors classement, mais pas sans activité : le score et le rang tombent,
             les onze mesures restent, sans rien qui situe l'élu dans sa chambre.
             Même rendu pour un président de groupe, avec son propre motif : sa
             participation aux votes n'est pas neutralisée, c'est le travail de
             conduite du groupe qu'aucun compteur ne voit. */
          <>
            <div className="elu-activite-tete">{blocJours(activiteScore)}</div>
            <p className="elu-empty" style={{ padding: '0.875rem 0 0.25rem' }}>
              {activiteScore.estPresidentChambre ? t('scoreUnavailablePresident') : t('scoreUnavailablePresidentGroupe')}
            </p>
            <div className="elu-fonctions">
              {FONCTION_ORDER.map((fk) => (
                <FonctionRow
                  key={fk}
                  fonctionKey={fk}
                  activiteScore={activiteScore}
                  metricValues={metricValues}
                  metricRaw={metricRaw}
                  metricCount={metricCount}
                  sansClassement
                />
              ))}
            </div>
            {blocThemes}
            <div className="elu-liens-activite">
              {lienComparer}
              <Link href="/Activite#methodologie" className="elu-voir hover:underline">
                {t('scoreMethodologyLink')}
              </Link>
            </div>
          </>
        ) : activiteScore.score === null ? (
          <>
            <p className="elu-empty">{t('scoreUnavailable', { joursActifs: activiteScore.joursActifs })}</p>
            {lienComparer}
          </>
        ) : (
          <>
            <div className="elu-activite-tete">
              <div className="elu-activite-bloc">
                <span className="elu-activite-grand">
                  {activiteScore.rank}<sup>{t('rangSuffixe', { rang: activiteScore.rank ?? 0 })}</sup>
                </span>
                <span className="elu-activite-legende">
                  {/* Le total n'est pas l'effectif de la chambre mais le nombre d'élus
                      classés : sans l'infobulle, « sur 554 députés » à côté d'un Palais
                      Bourbon qui en compte 577 se lit comme une erreur. */}
                  <span title={t('rankOutOfTooltip')} style={{ cursor: 'help' }}>
                    {t('rankOutOf', { total: activiteScore.total, chambre: activiteScore.chambre })}
                  </span>
                  <span className="elu-activite-sep" aria-hidden>·</span>
                  {t('scoreSur100', { score: activiteScore.score })}
                  {/* La réserve se lit là où se lit le score : la méthodologie la
                      donnait, mais seul le lecteur qui y descend la voyait. */}
                  <span className="elu-mesure-info">
                    <InfoBulle ariaLabel={t('infoBulleAria')} texte={t('absencesNonPubliees')} couleurs={COULEURS_INFO} />
                  </span>
                </span>
              </div>
              {blocJours(activiteScore)}
            </div>
            <div className="elu-fonctions">
              {FONCTION_ORDER.map((fk) => (
                <FonctionRow
                  key={fk}
                  fonctionKey={fk}
                  activiteScore={activiteScore}
                  metricValues={metricValues}
                  metricRaw={metricRaw}
                  metricCount={metricCount}
                />
              ))}
            </div>
            {blocThemes}
            <div className="elu-liens-activite">
              {lienComparer}
              <Link href="/Activite#methodologie" className="elu-voir hover:underline">
                {t('scoreMethodologyLink')}
              </Link>
            </div>
          </>
        )}
      </SectionRepliable>

      {/* ── Ses votes ────────────────────────────────────────────────────── */}
      <SectionRepliable carte={!vide.votes} cleStockage={CLE_PLI} cle="votes" icone={<IconeSection cle="votes" />} titre={t('votesTitle')}
        sousTitre={vide.votes ? undefined : t('votesDesc')}
        badge={titresTraduits.votes ? <AIBadgeTitre pluriel /> : undefined}>
        {vide.votes ? <p className="elu-absent">{t('emptyVotes')}</p> : (<>
        {/* Les deux chambres neutralisent le taux de participation de leur président
            (D-124). Sans cette note, la section n'afficherait qu'un vide, là où
            l'absence de chiffre est justement l'information. */}
        {activiteScore?.estPresidentChambre && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)', margin: '0 0 1.5rem', lineHeight: 1.6 }}>
            {t('presidentChambreNote')}
          </p>
        )}
        {/* Chez un ministre, tous les taux sont vides : des blocs à « — »
            au-dessus de l'état vide diraient deux fois la même chose. */}
        {aDesTaux && (
        <div className="elu-stats">
          <StatTaux
            label={t('statVotesFinaux')}
            value={acteur.taux_participation_votes_finaux}
            groupAverage={acteur.groupe?.taux_participation_votes_finaux_moyen}
            assemblyAverage={assemblyAverages?.taux_participation_votes_finaux_moyen}
            tooltip={t('tooltipVotesFinaux')}
            rawVotes={acteur.taux_participation_votes_finaux != null && acteur.scrutins_finaux_pendant_mandat != null
              ? Math.round(acteur.taux_participation_votes_finaux / 100 * acteur.scrutins_finaux_pendant_mandat)
              : null}
            rawTotal={acteur.scrutins_finaux_pendant_mandat}
            decimales={decimalesParticipation}
            {...verdicts}
            groupLabel={t('deltaGroupe')}
            chambreLabel={t('deltaChambre')}
            votesUnit={t('votesLabel')}
          />
          {!acteur.est_senateur_actuel && (
            <StatTaux
              label={t('statVotesImportants')}
              value={acteur.taux_participation_votes_solennels}
              groupAverage={acteur.groupe?.taux_participation_votes_solennels_moyen}
              assemblyAverage={assemblyAverages?.taux_participation_votes_solennels_moyen}
              tooltip={t('tooltipVotesImportants')}
              rawVotes={acteur.votes_actifs_importants}
              rawTotal={acteur.scrutins_solennels_pendant_mandat}
              {...verdicts}
              groupLabel={t('deltaGroupe')}
              chambreLabel={t('deltaChambre')}
              votesUnit={t('votesLabel')}
            />
          )}
          {/* La part des votes des deux taux ci-dessus, réunis, déposée par un collègue.
              Elle ne retire rien à la participation : une délégation est un vote valide
              (D-117). Calculée sur les seuls scrutins de l'Assemblée, d'où la même condition. */}
          {!acteur.est_senateur_actuel && (
            <StatTaux
              label={t('statVotesDelegation')}
              value={acteur.taux_delegation}
              groupAverage={acteur.groupe?.taux_delegation_moyen}
              assemblyAverage={assemblyAverages?.taux_delegation_moyen}
              tooltip={t('tooltipVotesDelegation')}
              rawVotes={acteur.votes_delegues}
              rawTotal={acteur.votes_finaux_solennels}
              {...verdicts}
              groupLabel={t('deltaGroupe')}
              chambreLabel={t('deltaChambre')}
              votesUnit={t('votesLabel')}
            />
          )}
          <StatTaux
            label={t('statCohesion')}
            value={acteur.taux_cohesion_groupe}
            groupAverage={acteur.groupe?.taux_cohesion_interne}
            assemblyAverage={assemblyAverages?.taux_cohesion_moyen}
            tooltip={t('tooltipCohesion')}
            {...verdicts}
            groupLabel={t('deltaGroupe')}
            chambreLabel={t('deltaChambre')}
            votesUnit={t('votesLabel')}
          />
        </div>
        )}
        {isSenat && (
          <p style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', margin: '-1rem 0 1.5rem', lineHeight: 1.5 }}>
            {t('senatCohesionNote')}
          </p>
        )}
        {votesNominatifs.length > 0 ? (
          <>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {votesNominatifs.slice(0, RESUME).map((v) => <VoteRow key={v.uid} vote={v} />)}
            </ul>
            <BoutonTiroir libelle={t('voirVotes', { count: votesNominatifs.length })} onOuvrir={() => setTiroir('votes')} />
          </>
        ) : (
          <p className="elu-empty">{t('emptyVotes')}</p>
        )}
        </>)}
      </SectionRepliable>

      {/* ── Ses affinités de vote ────────────────────────────────────────── */}
      {/* Tous les groupes au-dessus du seuil, sans tiroir : douze lignes au plus. La
          méthode tient dans l'info-bulle du sous-titre, comme D-269 le demande partout
          où se lit une position de groupe. Sous le seuil partout (élu très récent),
          la section reste avec sa phrase d'absence (D-306). */}
      <SectionRepliable
        carte={!vide.affinites}
        cleStockage={CLE_PLI}
        cle="affinites"
        icone={<IconeSection cle="affinites" />}
        titre={t('affinitesTitle')}
        sousTitre={!vide.affinites ? (
          <>
            {t('affinitesDesc')}
            <span className="elu-mesure-info">
              <InfoBulle ariaLabel={t('infoBulleAria')} texte={t('affinitesInfo', { total: affinites.total })} couleurs={COULEURS_INFO} />
            </span>
          </>
        ) : undefined}
      >
        {!vide.affinites ? (
          <ul className="elu-accords">
            {affinites.groupes.map((g) => (
              <AccordGroupeRow
                key={g.uid}
                groupe={g}
                mentions={[
                  ...(g.uid !== affinites.groupeMarque?.uid ? []
                    : [affinites.groupeMarque.dernier ? t('affinitesDernierGroupe') : t('affinitesSonGroupe')]),
                  // Un groupe formé en cours de mandat n'a de position que depuis sa
                  // création : son pourcentage repose sur peu de votes, et le dit. Moins
                  // de la moitié des votes comptés : au 2026-11-09, seul GUNPLT (Sénat,
                  // premier vote le 2026-10-19) y tombe ; tous les autres groupes, chez
                  // tous les élus en exercice, dépassent 80 %.
                  ...(g.communs * 2 < affinites.total ? [t('affinitesPeuDeVotes', { count: g.communs })] : []),
                ]}
              />
            ))}
          </ul>
        ) : (
          <p className="elu-absent">{t('emptyAffinites')}</p>
        )}
      </SectionRepliable>

      {/* ── Ses prises de parole ─────────────────────────────────────────── */}
      <SectionRepliable
        carte={!vide.paroles}
        cleStockage={CLE_PLI}
        cle="paroles"
        icone={<IconeSection cle="paroles" />}
        titre={t('speechesInChamber')}
        sousTitre={!vide.paroles ? t('speechesIntro', { count: dossierGroups.length }) : undefined}
        badge={titresTraduits.paroles ? <AIBadgeTitre pluriel /> : undefined}
      >
        {!vide.paroles ? (
          <>
            {/* Le total vient du score, compté sur tout le mandat : `interventions`
                ne couvre que les cinq dossiers listés. */}
            {activiteScore && (
              <div className="elu-chiffres">
                <p className="elu-chiffres-bloc">{t.rich('chiffreParoles', { count: activiteScore.nb_prises_parole, b: chiffre })}</p>
              </div>
            )}
            {dossierGroups.slice(0, RESUME).map((g) => (
              <ParoleRow key={g.dossier?.uid ?? '__sans_dossier__'} group={g} />
            ))}
            {/* Pas de total sur le bouton, pour la même raison : le chiffre de
                `interventions` contredisait celui de la ligne du haut. */}
            <BoutonTiroir libelle={t('voirParoles')} onOuvrir={() => setTiroir('paroles')} />
          </>
        ) : (
          <p className="elu-absent">{t('emptyParoles')}</p>
        )}
      </SectionRepliable>

      {/* ── Ses textes ───────────────────────────────────────────────────── */}
      <SectionRepliable carte={!vide.textes} cleStockage={CLE_PLI} cle="textes" icone={<IconeSection cle="textes" />} titre={t('dossiersTitleLabel')}
        sousTitre={vide.textes ? undefined : t('textesSectionDesc')}
        badge={titresTraduits.textes ? <AIBadgeTitre pluriel /> : undefined}>
        {!vide.textes ? (
          <>
            <div className="elu-chiffres">
              <p className="elu-chiffres-bloc">{t.rich('chiffreDeposes', { count: nbDeposes, b: chiffre })}</p>
              <p className="elu-chiffres-bloc">{t.rich('chiffreCosignes', { count: nbCosignes, b: chiffre })}</p>
            </div>
            {/* Le fil aplatit déposés et cosignés ; le tiroir les sépare. */}
            {[...dossiersInities, ...dossiersCoauteur].slice(0, RESUME).map((d) => (
              <TexteRow key={d.texte_uid ?? d.uid} dossier={d} />
            ))}
            <BoutonTiroir libelle={t('voirTextes', { count: textesTotal })} onOuvrir={() => setTiroir('textes')} />
          </>
        ) : (
          <p className="elu-absent">{t('emptyTextes')}</p>
        )}
      </SectionRepliable>

      {/* ── Ses amendements ──────────────────────────────────────────────── */}
      {/* Toujours rendue, même vide : la carte Activité y renvoie ses deux mesures
          d'amendements (`SECTION_DE_MESURE`). Les chiffres viennent des compteurs,
          la liste de la table des adoptés, bornée au même mandat dans `page.tsx`. */}
      <SectionRepliable carte={!vide.amendements} cleStockage={CLE_PLI} cle="amendements" icone={<IconeSection cle="amendements" />} titre={t('amendementsTitle')}
        sousTitre={amendSorts ? t('amendementsSectionDesc') : undefined}
        badge={titresTraduits.amendements ? <AIBadgeTitre pluriel /> : undefined}>
        {amendSorts ? (
          <>
            <div className="elu-chiffres elu-chiffres--quatre">
              <p className="elu-chiffres-bloc">{t.rich('chiffreAmendDeposes', { count: acteur.nb_amendements_auteur ?? 0, b: chiffre })}</p>
              <p className="elu-chiffres-bloc">{t.rich('chiffreAmendAdoptes', { count: amendSorts.adopte, b: chiffre })}</p>
              {/* Le taux d'adoption se rapporte aux déposés, le premier bloc :
                  irrecevables et amendements en attente compris, il se lit sans
                  explication. `amendSorts` n'existe que si l'élu en a déposé un. */}
              <p className="elu-chiffres-bloc">
                {t.rich('tauxAdoptionAmend', { taux: amendSorts.adopte / Math.max(acteur.nb_amendements_auteur ?? 0, 1), b: chiffre })}
              </p>
              <p className="elu-chiffres-bloc">{t.rich('chiffreAmendCosignes', { count: nbAmendCosignes, b: chiffre })}</p>
            </div>
            <RepartitionSorts sorts={amendSorts} />
            {amendements.length > 0 ? (
              <>
                {amendements.slice(0, RESUME).map((a) => <AmendementRow key={a.uid} amendement={a} />)}
                <BoutonTiroir libelle={t('voirAmendements', { count: amendements.length })} onOuvrir={() => setTiroir('amendements')} />
              </>
            ) : (
              <p className="elu-empty">{t('aucunAmendementAdopte')}</p>
            )}
          </>
        ) : nbAmendCosignes > 0 ? (
          // Un élu qui n'a que cosigné n'a pas de sort à détailler (NULL), mais la carte
          // Activité renvoie ici sa mesure de cosignés : le chiffre doit s'y lire.
          <>
            <div className="elu-chiffres">
              <p className="elu-chiffres-bloc">{t.rich('chiffreAmendCosignes', { count: nbAmendCosignes, b: chiffre })}</p>
            </div>
            <p className="elu-empty">{t('emptyAmendements')}</p>
          </>
        ) : (
          <p className="elu-absent">{t('emptyAmendements')}</p>
        )}
      </SectionRepliable>

      {/* ── Ses questions ────────────────────────────────────────────────── */}
      <SectionRepliable
        carte={!vide.questions}
        cleStockage={CLE_PLI}
        cle="questions"
        icone={<IconeSection cle="questions" />}
        titre={t('questionsTitle')}
        sousTitre={!vide.questions ? t('questionsIntro', { count: Math.min(questions.length, RESUME) }) : undefined}
      >
        {!vide.questions ? (
          <>
            {/* Comptes du score, sur le mandat : la liste s'arrête à 100 questions. */}
            {activiteScore && (
              <div className="elu-chiffres">
                <p className="elu-chiffres-bloc">{t.rich('chiffreQuestionsEcrites', { count: activiteScore.nb_questions_ecrites, b: chiffre })}</p>
                <p className="elu-chiffres-bloc">{t.rich('chiffreQuestionsOrales', { count: activiteScore.nb_questions_orales, b: chiffre })}</p>
              </div>
            )}
            {questions.slice(0, RESUME).map((q) => <QuestionRow key={q.uid} question={q} />)}
            <BoutonTiroir libelle={t('voirQuestions', { count: questionsTotal })} onOuvrir={() => setTiroir('questions')} />
          </>
        ) : (
          <p className="elu-absent">{t('emptyQuestions')}</p>
        )}
      </SectionRepliable>

      {/* ── Ses mandats ──────────────────────────────────────────────────── */}
      <SectionRepliable
        carte={!vide.mandats}
        cleStockage={CLE_PLI}
        cle="mandats"
        icone={<IconeSection cle="mandats" />}
        titre={t('mandatsTitle')}
        sousTitre={resumeSansAppartenances
          ? <>{resumeSansAppartenances}{pastilleCumul && <><br />{pastilleCumul}</>}</>
          : undefined}
      >
        {!vide.mandats ? (
          <>
            {/* Sans ligne de siège (ancien élu, ministre), l'élection ouvre la carte. */}
            {election && idLigneChambre === null && (
              <div style={{ marginBottom: blocsMandats.length > 0 ? '1.75rem' : 0 }}>
                <BlocElection election={election} dansLigne={false} />
              </div>
            )}
            {/* Deux colonnes, chacune avec son intertitre. Le lien vers le tiroir
                vit sous elles deux, parce que le tiroir reprend tous les blocs. */}
            <div className="elu-mandats-colonnes">
              {blocsFil.map((bloc) => (
                <div key={bloc.cle}>
                  <p className="elu-drawer-intertitre">{t(TITRE_BLOC_MANDATS[bloc.cle])}</p>
                  {bloc.lignes.slice(0, RESUME).map((m) => (
                    <MandatRow
                      key={m.id}
                      mandat={m}
                      enDessous={election && m.id === idLigneChambre ? <BlocElection election={election} dansLigne /> : null}
                    />
                  ))}
                </div>
              ))}
            </div>

            {lignesMandats > lignesMandatsVues && (
              <BoutonTiroir
                libelle={t('voirMandats', { count: appartenancesHorsFil })}
                onOuvrir={() => setTiroir('mandats')}
              />
            )}
            {notesMandats}
          </>
        ) : (
          <p className="elu-absent">{t('emptyMandats')}</p>
        )}
      </SectionRepliable>

      {/* ── Sa transparence ──────────────────────────────────────────────── */}
      <SectionRepliable
        carte={!vide.transparence}
        cleStockage={CLE_PLI}
        cle="transparence"
        icone={<IconeSection cle="transparence" />}
        titre={t('transparenceTitle')}
        sousTitre={!vide.transparence ? t('transparenceIntro') : undefined}
      >
        {!vide.transparence ? (
          <>
            {/* Deux colonnes, deux sources, comme les mandats. Les groupes de
                chacune suivent un ordre fixe que leur contenu ne change pas : le
                lecteur qui passe d'une fiche à l'autre retrouve la même lecture,
                et l'absence d'un groupe se voit. */}
            <div className="elu-mandats-colonnes">
              {([
                { cle: 'hatvp', titre: t('transparenceSourceHatvp'), groupes: colonnesTransparence.hatvp },
                {
                  cle: 'registres',
                  titre: t(colonnesTransparence.chambreRegistres === 'senat'
                    ? 'transparenceSourceSenat'
                    : 'transparenceSourceAn'),
                  groupes: colonnesTransparence.registres,
                },
              ] as const).map(({ cle, titre, groupes }) => {
                if (groupes.length === 0) return null;
                const vus = tronquerColonne(groupes);
                return (
                  <div key={cle}>
                    <p className="elu-drawer-intertitre">{titre}</p>
                    {vus.map(({ categorie, elements, total }) => (
                      <div key={categorie}>
                        <p className="elu-groupe-titre">
                          {t(`transparenceGroupe.${categorie}` as Parameters<typeof t>[0])}
                          {total > elements.length && (
                            <span style={{ fontWeight: 400 }}> ({total})</span>
                          )}
                        </p>
                        {elements.map((e) => (
                          <TransparenceRow key={`${e.source}-${e.identifiant}`} element={e} />
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>

            {transparence.length > transparenceAffichees && (
              <BoutonTiroir
                libelle={t('voirTransparence', { count: transparence.length })}
                onOuvrir={() => setTiroir('transparence')}
              />
            )}

            {/* Une section de transparence ne dit jamais rien : elle dit toujours
                ce qu'elle couvre. Une déclaration déposée sans rien à déclarer est
                une information, une publication en attente aussi, et les deux
                valent mieux qu'un blanc que le lecteur interpréterait seul. */}
            {hatvp && hatvpDate && (
              <p className="elu-note">
                {/* « Rien à déclarer » se juge sur la déclaration elle-même, pas sur
                    la section : un élu peut avoir des cadeaux au registre de sa
                    chambre et une déclaration d'intérêts vide, et c'est justement
                    ce cas que la phrase doit dire. */}
                {hatvp.statut_publication === 'Livrée'
                  ? t(colonnesTransparence.hatvp.length > 0 ? 'transparenceDeposee' : 'transparenceDeposeeVide', { date: hatvpDate })
                  : t('transparenceEnAttente', { date: hatvpDate })}
                {hatvp.url_dossier && (
                  <>
                    {' '}
                    <a href={hatvp.url_dossier} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                      {t('transparenceLienHatvp')}
                    </a>
                  </>
                )}
              </p>
            )}
            <p className="elu-note">{t('transparenceSourceNote')}</p>
          </>
        ) : (
          <p className="elu-absent">{t('emptyTransparence')}</p>
        )}
      </SectionRepliable>

      {/* ── Son siège ────────────────────────────────────────────────────── */}
      <SectionRepliable
        carte={!vide.siege}
        cleStockage={CLE_PLI}
        cle="siege"
        icone={<IconeSection cle="siege" />}
        titre={t('anchorSiege')}
        // Le sous-titre annonce les deux repères : il ne s'affiche donc que
        // quand les deux sont là.
        sousTitre={showHemicycle && showCarte ? t('siegeSectionDesc') : undefined}
      >
        {!vide.siege ? (
          <>
            <div className="elu-place">
              {showHemicycle && (
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.125rem' }}>{t('hemicycleSeat')}</h3>
                  {acteur.place_hemicycle != null && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', margin: '0 0 1rem' }}>
                      {t('siegeNum', { num: acteur.place_hemicycle })}
                    </p>
                  )}
                  {/* Proportions du viewBox posé par l'effet d'injection, pour réserver la place avant l'arrivée du dessin. */}
                  <div ref={hemicycleRef} style={{ width: '100%', maxWidth: isSenat ? '380px' : '300px', aspectRatio: activeSvg ? undefined : isSenat ? '950 / 659' : '900 / 582' }} />
                </div>
              )}
              {showCarte && (
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.125rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    {acteur.num_circo ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', cursor: 'default' }}>
                            {t('seatTooltipLabel')}
                            <Info size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('seatTooltipDesc', { count: LEGAL_AN })}
                        </TooltipContent>
                      </Tooltip>
                    ) : t('departementLabel')}
                  </h3>
                  {circoLabel && (
                    <p style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', margin: '0 0 1rem' }}>{circoLabel}</p>
                  )}
                  {/* Proportions de la carte une fois recadrée sur son contenu (emprise mesurée le 2026-10-27, la même pour toute fiche). */}
                  <div ref={carteRef} style={{ width: '100%', maxWidth: '260px', aspectRatio: carteSvg ? undefined : '380 / 440' }} />
                </div>
              )}
              {showCarte && zoom && (
                <div>
                  <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: '0 0 0.125rem' }}>{t('prefectureLabel')}</h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', margin: '0 0 1rem' }}>{zoom.prefecture.nom}</p>
                  <div style={{ width: '100%', maxWidth: '260px' }}>
                    <CarteDepartementZoom
                      trace={zoom.trace}
                      emprise={zoom.emprise}
                      prefecture={zoom.prefecture}
                      couleur={groupColor}
                      ariaLabel={t('carteDepartementZoomAria', {
                        departement: acteur.departement_election ?? acteur.num_departement ?? '',
                        prefecture: zoom.prefecture.nom,
                      })}
                    />
                  </div>
                </div>
              )}
            </div>
            {/* Une ligne sous les schémas, pas une 4e colonne de la grille : au bureau,
                elle tombait seule sur une deuxième rangée, sous un grand vide laissé
                par la hauteur de la carte de France. L'adresse est elle-même le lien. */}
            {showPermanence && (
              <div
                style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: '0.75rem', rowGap: '0.25rem',
                  ...(showHemicycle || showCarte
                    ? { borderTop: '1px solid var(--border)', marginTop: '1.5rem', paddingTop: '1rem' }
                    : {}),
                }}
              >
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <MapPin size={13} aria-hidden style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
                  {t('permanenceLabel')}
                </h3>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(acteur.adresse_circonscription ?? '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('permanenceMapAria', { adresse: acteur.adresse_circonscription ?? '' })}
                  className="hover:underline underline-offset-2"
                  style={{ fontSize: '0.8125rem', color: 'var(--primary)' }}
                >
                  {acteur.adresse_circonscription}
                  <ArrowUpRight size={12} aria-hidden style={{ display: 'inline', verticalAlign: '-0.1em', marginLeft: '0.125rem' }} />
                </a>
              </div>
            )}
          </>
        ) : (
          <p className="elu-absent">{t(siegeConnu ? 'siegeEchec' : 'emptySiege')}</p>
        )}
      </SectionRepliable>

      <ComparerElusModal
        elus={paire}
        onRemplacer={(rang, a) => setPaire((p) => p && (rang === 0 ? [a, p[1]] : [p[0], a]))}
        onClose={() => setPaire(null)}
      />

      <EluDrawer
        cle={tiroir}
        onClose={() => setTiroir(null)}
        eluUid={acteur.uid}
        votes={votesNominatifs}
        dossierGroups={dossierGroups}
        parolesDepuis={parolesDepuis}
        questions={questions}
        questionsTotal={questionsTotal}
        dossiersInities={dossiersInities}
        dossiersCoauteur={dossiersCoauteur}
        amendements={amendements}
        amendementsParSort={amendSorts}
        blocsMandats={blocsMandats}
        resumeMandats={resumeMandats(true)}
        notesMandats={notesMandats}
        transparence={transparence}
        titresTraduits={titresTraduits}
      />
    </div>
  );
}
