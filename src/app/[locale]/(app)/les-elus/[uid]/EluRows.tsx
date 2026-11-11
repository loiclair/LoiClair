'use client';

/**
 * Lignes partagées entre le fil de la fiche élu (`EluProfileClient`) et son
 * tiroir de détail (`EluDrawer`). Un vote, une question, une prise de parole, un
 * texte ou un amendement doit avoir la même allure aux deux endroits : c'est ce qui fait lire
 * le tiroir comme la suite de la section, et non comme un autre écran.
 *
 * Les types de données de la fiche vivent ici parce que les trois fichiers de
 * la page en ont besoin ; les déclarer dans l'orchestrateur créerait un cycle
 * d'imports avec le tiroir.
 *
 * Les classes `.elu-*` employées ici sont définies une seule fois, dans le bloc
 * `<style>` de `EluProfileClient`. Il est monté tant que la page l'est, donc le
 * tiroir (rendu dans un portail Radix) en hérite aussi.
 */

import { Link } from '@/i18n/navigation';
import { allerASection } from '@/components/BarreAncres';
import type { RoleQuitte } from '@/lib/ancien-elu';
import { InfoBulle } from '@/components/ContacterMesElusBanner';
import { statutBulletColor, translateStatut } from '@/lib/statut';
import { getDefinition } from '@/lib/definitions';
import { formatJourNu } from '@/lib/jour-paris';
import { useLocale, useTranslations } from 'next-intl';
import type { EffetVerification, StatutMandat } from '@/lib/mandats-locaux';
import {
  ACTIVITE_FUNCTIONS,
  type FonctionKey,
  type MetricKey,
} from '@/lib/activite-weights';

// ── Types de la fiche ──────────────────────────────────────────────────────

export interface Dossier {
  uid: string;
  titre: string | null;
  statut_final: string | null;
  procedure_libelle: string | null;
  date_depot: string | null;
  date_promulgation: string | null;
  initiateur?: { prenom: string | null; nom: string | null } | { prenom: string | null; nom: string | null }[] | null;
  texte_uid?: string;
  denomination?: string | null;
  /** Signé comme ministre (dossier du Gouvernement) : non compté dans le score. */
  commeMinistre?: boolean;
  /** Vrai quand `titre` est la traduction de l'IA (sur /en) : la section porte le badge. */
  titreTraduit?: boolean;
}

/**
 * Le bloc où se range une ligne de la section « Ses mandats » : le siège de
 * parlementaire et les mandats locaux (`mandat`), ce que l'élu exerce dans sa
 * chambre ou au Gouvernement (`fonction`), les organismes dont il est membre
 * (`appartenance` : groupes d'études et d'amitié, assemblées internationales,
 * organismes extérieurs, parti). Fixée par `TYPES_MANDAT` dans `page.tsx`.
 */
export type NatureMandat = 'mandat' | 'fonction' | 'appartenance';

/**
 * Un bloc de la section « Ses mandats », non vide. Construit une fois par
 * `EluProfileClient` et repris tel quel par `EluDrawer`, pour que le fil et le
 * tiroir rangent les mêmes lignes sous les mêmes intertitres.
 */
export interface BlocMandats {
  cle: 'mandats' | 'fonctions' | 'appartenances';
  lignes: MandatAffiche[];
}

/** Clé de traduction de l'intertitre de chaque bloc, sous `elus`. */
export const TITRE_BLOC_MANDATS: Record<BlocMandats['cle'], string> = {
  mandats: 'mandatsBlocMandats',
  fonctions: 'mandatsBlocFonctions',
  appartenances: 'mandatsBlocAppartenances',
};

/**
 * Un mandat prêt à afficher, quelle que soit sa provenance. Les deux sources
 * n'ont rien en commun (un jsonb de l'open data parlementaire d'un côté, six
 * CSV du Répertoire national des élus de l'autre) mais produisent la même
 * ligne : `MandatRow` n'a pas à savoir laquelle il rend.
 */
export interface MandatAffiche {
  id: string;
  /** Clé de traduction du type de mandat, résolue sous `elus.mandatType.*`. */
  categorie: string;
  nature: NatureMandat;
  libelle: string | null;
  qualite: string | null;
  dateDebut: string | null;
  /** Statut au regard du cumul, pour les seuls mandats locaux. Absent d'un
   *  mandat local quitté : il ne compte plus. */
  statut?: StatutMandat;
  /** Sur une fonction exécutive seulement : l'élu est encore dans son délai pour
   *  choisir, ou une contestation le suspend. La pastille dit alors « Fonction
   *  exécutive » en gris, sans ambre ni statut : le statut précis, qui se périme
   *  si personne ne refait la vérification, ne vit qu'en tête de section, à côté
   *  de la date de vérification. */
  enRegle?: boolean;
  /** Ce que LoiClair a constaté sur la ligne du registre, avec sa source. */
  verification?: VerificationMandat;
}

/**
 * Une correction du registre, telle que la ligne la montre. `constateLe` date le
 * changement quand la source ne le fait pas : c'est la dernière vérification.
 */
export interface VerificationMandat {
  effet: EffetVerification;
  date: string | null;
  constateLe: string | null;
  sourceUrl: string | null;
  sourceNom: string | null;
}

/**
 * Un fait de transparence, tel que `transparence_elements` le rend : un intérêt
 * déclaré à la HATVP, un cadeau ou un voyage déclaré à son assemblée, un déport.
 *
 * Les six registres d'origine produisent la même ligne à l'écran, d'où ce type
 * unique. `categorie` dit dans quel bloc la ligne se range et sert de clé de
 * traduction ; `source` ne sert qu'à savoir d'où elle vient, jamais au rendu.
 */
export interface TransparenceElement {
  source: string;
  identifiant: string;
  categorie: string;
  date_element: string | null;
  intitule: string;
  tiers: string | null;
  /** Texte libre (« Supérieur à 150 euros », « 3 jours »), jamais un nombre à comparer. */
  valeur_texte: string | null;
  detail: string | null;
  url_source: string | null;
}

/**
 * Ordre des groupes de la section Transparence.
 *
 * Colonne de la déclaration : ce que l'élu exerce, puis ce qu'il détient.
 * Colonne des registres : **les retraits d'abord**, parce qu'ils nomment le
 * texte dont l'élu s'écarte et le motif qu'il en donne, et qu'ils sont vingt
 * fois moins nombreux que les voyages — placés en dernier, ils tombaient hors
 * du plafond de la colonne sur toutes les fiches qui en ont un.
 *
 * Partagé par le fil et le tiroir, qui doivent lire dans le même ordre.
 */
export const ORDRE_TRANSPARENCE = [
  'interet_activite', 'interet_conseil', 'interet_direction', 'interet_benevolat',
  'interet_participation', 'interet_observation',
  'deport', 'voyage', 'cadeau',
] as const;

/** L'état de la déclaration d'intérêts d'un élu, de `hatvp_declarations`. */
export interface HatvpDeclaration {
  statut_publication: string;
  date_depot: string | null;
  url_dossier: string | null;
}

/** Une ligne de `mandats_locaux`, telle que la base la rend. */
export interface MandatLocal {
  type: string;
  collectivite: string;
  fonction: string | null;
  date_debut: string | null;
  date_donnee: string;
  /** Renseignée pour les seuls mandats communaux, cf. le seuil de LO 141. */
  population: number | null;
  /** Ce que LoiClair a constaté depuis, cf. `enVigueur` (`lib/mandats-locaux`). */
  verif_effet: EffetVerification | null;
  verif_date: string | null;
  verif_source_url: string | null;
  verif_source_nom: string | null;
}

export interface Question {
  uid: string;
  type: 'QG' | 'QOSD' | 'QE' | 'QO';
  date_jo: string | null;
  titre: string | null;
  rubrique: string | null;
  ministere: string | null;
  a_reponse: boolean;
  url_source: string | null;
}

export interface VoteNominatif {
  uid: string;
  titre: string | null;
  date_scrutin: string | null;
  sort_code: string | null;
  sort_libelle: string | null;
  type_vote_code: string | null;
  type_vote_libelle: string | null;
  synthese_pour: number | null;
  synthese_contre: number | null;
  synthese_abstentions: number | null;
  position: string;
  dossier_uid: string | null;
  /** Vrai quand `titre` est la traduction de l'IA (sur /en) : la section porte le badge. */
  titreTraduit?: boolean;
}

/** Une intervention, reconstruite par `EluProfileClient` à partir de `Paroles`. */
export interface Intervention {
  dossier_uid: string | null;
  seance: {
    uid: string;
    chambre: 'AN' | 'SEN';
    date_seance: string;
  } | null;
  dossier: { uid: string; titre: string | null; titreTraduit?: boolean } | null;
}

/**
 * Les interventions d'un élu telles que `page.tsx` les envoie : chaque ligne ne porte
 * que les uid de son dossier et de sa séance, et chaque dossier, chaque séance n'est
 * rangé qu'une fois. Recopiés sur chacune des 930 lignes de la fiche la plus chargée
 * (PA795310), ils pesaient 418 Ko du HTML (mesuré le 2026-10-29). Les lignes gardent
 * l'ordre d'affichage décidé par la page.
 */
export interface Paroles {
  dossiers: Record<string, NonNullable<Intervention['dossier']>>;
  seances: Record<string, NonNullable<Intervention['seance']>>;
  lignes: [dossierUid: string | null, seanceUid: string | null][];
}

/** Les interventions d'un élu sur un même dossier, du plus récent au plus ancien. */
export interface DossierGroup {
  dossier: Intervention['dossier'];
  interventions: Intervention[];
}

/**
 * Une intervention avec son texte, telle que `/api/elus/[uid]/paroles` la rend au
 * tiroir, de la plus récente à la plus ancienne. `article` et `amendement` sont les
 * valeurs brutes des comptes rendus, mises en forme par `ParolesTiroir`.
 */
export interface ParoleTexte {
  id: number;
  dossier_uid: string;
  seance_uid: string;
  date_seance: string;
  article: string | null;
  amendement: string | null;
  texte: string;
}

/**
 * Les huit cases de `acteurs.amendements_par_sort`, écrites par
 * `import_amendements.py` (`SORTS_AMENDEMENT`). Leur somme égale
 * `acteurs.nb_amendements_auteur` : les amendements dont l'élu est l'auteur, sur le
 * mandat en cours.
 */
export type AmendementsParSort = Record<
  'adopte' | 'rejete' | 'tombe' | 'non_soutenu' | 'retire' | 'irrecevable' | 'en_attente' | 'autre',
  number
>;

/**
 * Un amendement adopté dont l'élu est l'auteur, lu dans la table `amendements` par
 * `page.tsx`, déjà borné au mandat comme le compteur : c'est la liste des
 * `adopte` de `AmendementsParSort`. Le texte de l'amendement n'est pas chargé.
 */
export interface AmendementAdopte {
  uid: string;
  /** Tel que la chambre l'affiche (« CE291 », « COM-6 »). */
  numero: string;
  /** Article visé, en forme courte (« Art. 2 », « Après art. 4 »). */
  article: string | null;
  lieu: 'seance' | 'commission';
  date_amendement: string | null;
  /** Page officielle de l'amendement. */
  url: string;
  /** Vrai quand un vote public y est relié ; absent sinon, pour ne pas alourdir la fiche. */
  avecVote?: boolean;
  dossier: { uid: string; titre: string | null; titreTraduit?: boolean } | null;
}

/**
 * Le lien vers l'article Wikipédia de l'élu, résolu par `lienWikipedia` dans
 * `page.tsx`. `repliFrancais` : l'interface n'est pas en français mais l'article
 * n'existe qu'en français, ce que le libellé du lien doit dire.
 */
export interface LienWikipedia {
  url: string;
  repliFrancais: boolean;
}

/**
 * La date d'ouverture du mandat en cours et son sens : `election` se lit « Élu
 * le », `fonction` « En fonction depuis le ». Choisie dans `page.tsx`
 * (`dateDuMandat`), qui explique quand l'une ou l'autre s'applique.
 */
export interface DateMandat {
  date: string;
  nature: 'election' | 'fonction';
}

/** Le mandat qu'un ancien élu a quitté (`mandatTermine` dans `page.tsx`) : ce que dit
 *  sa pastille, et la date de fin quand la base la connaît. */
export interface MandatTermine {
  role: RoleQuitte;
  fin: string | null;
}

/** Accord de vote de l'élu avec un groupe de sa chambre, lu par `page.tsx`. */
export interface AccordGroupe {
  uid: string;
  /** Sigle, ou libellé long pour un groupe qui n'en a pas. */
  sigle: string;
  libelle: string | null;
  /** Couleur déjà résolue (`resolveGroupeColor`), jamais vide. */
  couleur: string;
  /** Part des votes finaux communs où l'élu a voté comme le groupe, de 0 à 100, une décimale. */
  accord: number;
  communs: number;
}

/** « Ses affinités de vote » : les groupes au-dessus du seuil, déjà triés, et le
 *  nombre de votes finaux de l'élu entrés dans le calcul. `groupeMarque` est le
 *  groupe à signaler dans la liste : le groupe actuel, ou le dernier d'un ancien
 *  élu (`dernier`) ; `null` pour un ministre ou un élu sans groupe. */
export interface AffinitesVote {
  groupes: AccordGroupe[];
  total: number;
  groupeMarque: { uid: string; dernier: boolean } | null;
}

export interface ActiviteScore {
  score: number | null;
  rank: number | null;
  total: number;
  chambre: 'AN' | 'SN';
  cpPart: number | null;
  cpDoss: number | null;
  cpCosign: number | null;
  cpRapp: number | null;
  cpRappCtrl: number | null;
  cpAmendAuteur: number | null;
  cpAmendCosign: number | null;
  cpQuestO: number | null;
  cpQuestE: number | null;
  cpPrisesParole: number | null;
  cpCommPres: number | null;
  nb_dossiers_inities: number;
  nb_textes_cosignes: number;
  nb_rapporteur: number;
  nb_rapports_controle: number;
  nb_amendements_auteur: number;
  nb_amendements_cosignataire: number;
  nb_questions_orales: number;
  nb_questions_ecrites: number;
  nb_prises_parole: number;
  nb_commission_presences: number | null;
  joursActifs: number;
  /** Date nue d'où partent les jours actifs : borne de la chambre, ou prise de
   *  fonction si elle est plus tardive. Calculée dans `page.tsx`. */
  debutDecompte: string;
  // Un score absent se justifie de trois façons, et la fiche doit dire laquelle :
  // mandat de moins de 180 jours, présidence de la chambre (D-123), présidence
  // d'un groupe politique.
  estPresidentChambre: boolean;
  estPresidentGroupe: boolean;
  sousScores?: Record<FonctionKey, { rang: number | null; total: number }>;
  /** Rang de l'élu sur chaque mesure, null hors classement ou quand la mesure ne
   *  s'applique pas. Lu dans les colonnes `rang_*` d'`activite_elus_mv` par `page.tsx`. */
  rangsMesures?: Record<MetricKey, number | null>;
}

// ── Helpers de présentation ────────────────────────────────────────────────

// `en-GB` plutôt que `en` : garde l'ordre jour-mois du français, seul le nom du
// mois change. C'est le format retenu partout ailleurs sur les fiches dossier.
// Les deux passent par `formatJourNu` : `date_depot`, `date_jo` et `date_seance`
// arrivent nus (`2026-10-27`), et formatés en heure locale, le serveur (en UTC)
// écrivait le 27 et un navigateur de Seattle le 26, d'où l'erreur #418.
const localeCourte = (locale: string) => (locale === 'en' ? 'en-GB' : 'fr-FR');

// Dates des dossiers et des amendements ; rien quand la date manque.
function formatDate(dateStr: string | null, locale: string): string {
  if (!dateStr) return '';
  return formatJourNu(dateStr, localeCourte(locale), { day: 'numeric', month: 'short', year: 'numeric' });
}

// Dates des votes, questions et séances, jour sur deux chiffres ; un tiret quand la
// date manque.
export function formatDateCourte(dateStr: string | null, locale: string): string {
  if (!dateStr) return '—';
  return formatJourNu(dateStr, localeCourte(locale), { day: '2-digit', month: 'short', year: 'numeric' });
}

const tagStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 500,
  padding: '0.125rem 0.5rem',
  borderRadius: '9999px',
  backgroundColor: 'var(--muted)',
  color: 'var(--muted-foreground)',
  whiteSpace: 'nowrap',
};

// ── StatTaux ───────────────────────────────────────────────────────────────
// Un taux de la section « Ses votes », comparé à la moyenne du groupe et à celle
// de la chambre. Rendu par `EluProfileClient`, qui fournit tous les libellés.
// Le taux s'écrit en grand chiffre, au format des totaux des autres sections ;
// groupe, chambre et verdict suivent en petit et en gris, sans barre ni couleur
// de groupe. La structure du rendu est mise à plat en cinq blocs, pour que la
// grille `.elu-stats` puisse les aligner en subgrid.

export function StatTaux({
  label,
  value,
  groupAverage,
  assemblyAverage,
  tooltip,
  rawVotes,
  rawTotal,
  decimales = 0,
  verdictBelowGroup,
  verdictEqualGroup,
  verdictBelowNational,
  verdictEqualNational,
  verdictAboveNational,
  groupLabel,
  chambreLabel,
  votesUnit,
}: {
  label: string;
  value: number | null;
  groupAverage?: number | null;
  assemblyAverage?: number | null;
  tooltip?: string;
  rawVotes?: number | null;
  rawTotal?: number | null;
  /** Décimales affichées. Une seule sur la participation d'un sénateur, où
   *  presque tout le monde dépasse 98 % et où l'arrondi à l'entier cachait
   *  l'écart qui fait bouger le rang. */
  decimales?: 0 | 1;
  verdictBelowGroup: string;
  verdictEqualGroup: string;
  verdictBelowNational: string;
  verdictEqualNational: string;
  verdictAboveNational: string;
  groupLabel?: string;
  chambreLabel?: string;
  votesUnit?: string;
}) {
  const t = useTranslations('elus');
  // Le style `percent` pose l'espace avant le signe en français et le colle en
  // anglais ; les valeurs arrivent déjà en pourcentage, d'où le /100.
  const locale = useLocale();
  const pourcent = new Intl.NumberFormat(locale, {
    style: 'percent', minimumFractionDigits: decimales, maximumFractionDigits: decimales,
  });
  const ecart = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimales, maximumFractionDigits: decimales, signDisplay: 'exceptZero',
  });

  const pct = value != null ? Math.min(Math.max(value, 0), 100) : null;
  const groupPct = groupAverage != null ? Math.min(Math.max(groupAverage, 0), 100) : null;
  const assemblyPct = assemblyAverage != null ? Math.min(Math.max(assemblyAverage, 0), 100) : null;

  // Tout se compare sur les valeurs telles qu'affichées, en entiers d'unités
  // affichées (dixièmes de point avec une décimale) pour échapper aux flottants.
  // Comparer les décimales cachées faisait écrire « Sous la moyenne de son
  // groupe » à côté de « 97 % » contre « 97 % », « +0 pts ».
  const echelle = 10 ** decimales;
  const affiche = (v: number | null) => (v != null ? Math.round(v * echelle) : null);
  const eluA = affiche(pct);
  const groupeA = affiche(groupPct);
  const chambreA = affiche(assemblyPct);

  let verdict: string | null = null;
  if (eluA != null && groupeA != null) {
    if (eluA < groupeA) verdict = verdictBelowGroup;
    else if (eluA === groupeA) verdict = verdictEqualGroup;
    else if (chambreA != null && eluA < chambreA) verdict = verdictBelowNational;
    else if (chambreA != null && eluA === chambreA) verdict = verdictEqualNational;
    else verdict = verdictAboveNational;
  }

  // Deltas, dans la même unité que le verdict
  const groupDelta = eluA != null && groupeA != null ? (eluA - groupeA) / echelle : null;
  const assemblyDelta = eluA != null && chambreA != null ? (eluA - chambreA) / echelle : null;

  // Les cinq blocs sont des enfants directs, chacun sur sa propre rangée de la
  // grille `.elu-stats` (subgrid) : c'est ce qui aligne les lignes entre
  // colonnes même quand l'une porte une ligne « 73 / 95 votes » et l'autre pas.
  return (
    <div className="elu-stat">
      {/* Grand chiffre, au format des totaux de la fiche (`.elu-chiffres-n`) */}
      <span className="elu-chiffres-n">
        {eluA != null ? pourcent.format(eluA / echelle / 100) : '—'}
      </span>

      {/* Libellé. `InfoBulle` plutôt que le Tooltip Radix, qui ignore le toucher. */}
      <span className="elu-stat-libelle">
        {label}
        {tooltip && (
          <span className="elu-mesure-info">
            <InfoBulle ariaLabel={t('infoBulleAria')} texte={tooltip} couleurs={COULEURS_INFO} />
          </span>
        )}
      </span>

      {/* Votes bruts */}
      <span className="elu-stat-detail">
        {rawTotal != null ? `${rawVotes != null ? `${rawVotes} / ` : ''}${rawTotal} ${votesUnit ?? 'votes'}` : null}
      </span>

      {/* Comparaisons, en gris : le signe et le verdict disent déjà le sens. */}
      <span className="elu-stat-detail">
        {groupDelta != null && (
          <span style={{ display: 'block' }}>
            {groupLabel ?? t('deltaGroupe')} {pourcent.format(groupeA! / echelle / 100)} · {ecart.format(groupDelta)} pts
          </span>
        )}
        {assemblyDelta != null && (
          <span style={{ display: 'block' }}>
            {chambreLabel ?? t('deltaChambre')} {pourcent.format(chambreA! / echelle / 100)} · {ecart.format(assemblyDelta)} pts
          </span>
        )}
      </span>

      {/* Verdict */}
      <p className="elu-stat-detail" style={{ margin: 0 }}>
        {verdict}
      </p>
    </div>
  );
}

// ── VoteRow ────────────────────────────────────────────────────────────────

/**
 * Une ligne de scrutin. Dans le fil, la colonne « résultat » disparaît : ce qui
 * compte au survol de la page, c'est la position de l'élu, pas le sort du texte.
 * Le tiroir la rétablit, sous l'en-tête de colonnes.
 */
export function VoteRow({ vote, avecResultat = false }: { vote: VoteNominatif; avecResultat?: boolean }) {
  const t = useTranslations('elus');
  const locale = useLocale();

  const POSITION_LABEL: Record<string, string> = {
    pour: t('votePositionPour'), contre: t('votePositionContre'),
    abstentions: t('votePositionAbstention'), nonVotants: t('votePositionNonVotant'),
    institutionnels: t('votePositionInstitutionnel'), absents: t('votePositionAbsent'),
  };
  // Les couleurs de position portent du sens (pour / contre / abstention) :
  // elles ne passent pas aux jetons neutres.
  const POSITION_COLOR: Record<string, string> = {
    pour: '#16a34a', contre: '#dc2626', abstentions: '#d97706',
    nonVotants: '#6b7280', institutionnels: '#9ca3af', absents: '#6b7280',
  };

  const posColor = POSITION_COLOR[vote.position] ?? '#6b7280';
  const isAdopte = vote.sort_code === 'adopté';
  const isRejete = vote.sort_code === 'rejeté';
  const isMinority = (vote.position === 'pour' && isRejete) || (vote.position === 'contre' && isAdopte);
  const rawTitle = vote.titre ?? '—';
  const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

  const titreEl = (
    <span style={{ fontSize: '0.8125rem', fontWeight: 500, lineHeight: 1.45, color: 'var(--foreground)' }}>
      {title}
    </span>
  );

  return (
    <li className={`elu-row elu-vote elu-row--clic${avecResultat ? ' elu-vote--res' : ''}`}>
      <span className="elu-vote-d" style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
        {formatDateCourte(vote.date_scrutin, locale)}
      </span>
      <span className="elu-vote-t">
        {/* Vers la page du vote, qui existe pour chaque ligne : la fiche ne liste que des
            scrutins à liste nominative. Une motion de censure sans dossier y mène aussi. */}
        <Link href={`/Scrutins/${vote.uid}`} prefetch={false} className="hover:underline">
          {titreEl}
        </Link>
      </span>
      <span className="elu-vote-pos" style={{ fontSize: '0.8125rem', fontWeight: 600, color: posColor }}>
        {POSITION_LABEL[vote.position] ?? vote.position}
        {isMinority && (
          <small style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 400, color: 'var(--muted-foreground)' }}>
            {t('voteMinoritaire')}
          </small>
        )}
      </span>
      {avecResultat && (
        <span className="elu-vote-res" style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
          {vote.sort_code ? (isAdopte ? t('voteResultAdopte') : isRejete ? t('voteResultRejete') : vote.sort_libelle) : ''}
        </span>
      )}
    </li>
  );
}

// ── QuestionRow ────────────────────────────────────────────────────────────

export function QuestionRow({ question }: { question: Question }) {
  const t = useTranslations('elus');
  const locale = useLocale();

  const typeLabel: Record<Question['type'], string> = {
    QG: t('questionTypeQG'), QOSD: t('questionTypeQOSD'), QE: t('questionTypeQE'), QO: t('questionTypeQO'),
  };
  const typeColor: Record<Question['type'], string> = {
    QG: '#f59e0b', QOSD: '#d97706', QO: '#b45309', QE: '#2563eb',
  };

  const contenu = (
    <>
      <div className="elu-row-top">
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4, margin: 0 }}>
          {question.titre ?? question.rubrique ?? t('questionUntitled')}
        </h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', flex: 'none' }}>
          {formatDateCourte(question.date_jo, locale)}
        </span>
      </div>
      <div className="elu-row-meta">
        <span style={{ ...tagStyle, backgroundColor: typeColor[question.type] + '20', color: typeColor[question.type], fontWeight: 600 }}>
          {typeLabel[question.type]}
        </span>
        <span
          style={{
            ...tagStyle,
            backgroundColor: question.a_reponse ? '#16a34a20' : 'var(--muted)',
            color: question.a_reponse ? '#15803d' : 'var(--muted-foreground)',
          }}
        >
          {question.a_reponse ? t('questionReplied') : t('questionPending')}
        </span>
        {question.ministere && <span>{t('questionMinistere', { name: question.ministere })}</span>}
      </div>
    </>
  );

  return (
    <div className={`elu-row${question.url_source ? ' elu-row--clic' : ''}`}>
      {question.url_source ? (
        <a href={question.url_source} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
          {contenu}
        </a>
      ) : contenu}
    </div>
  );
}

// ── ParoleRow ──────────────────────────────────────────────────────────────

/**
 * L'en-tête d'un dossier sur lequel l'élu est intervenu : titre, nombre
 * d'interventions, date de la dernière, chambre. Partagé par la ligne du fil et par
 * `ParolesTiroir`, qui ne lui passe pas de lien : il y porte déjà un lien par séance
 * et le lien vers le débat, un titre cliquable en ferait un troisième. `nombre` : ce
 * que l'appelant affiche, les deux lectures pouvant différer le temps d'un cache.
 */
export function ParoleEntete({ group, nombre, lienDossier }: { group: DossierGroup; nombre: number; lienDossier: string | null }) {
  const t = useTranslations('elus');
  const tResumeIA = useTranslations('resumeIA');
  const locale = useLocale();

  const premiere = group.interventions[0];
  const chambre = premiere?.seance?.chambre === 'AN' ? tResumeIA('assemblee')
    : premiere?.seance?.chambre === 'SEN' ? tResumeIA('senat')
    : null;
  const derniereDate = group.interventions.map((iv) => iv.seance?.date_seance).find(Boolean) ?? null;
  const titre = group.dossier?.titre ?? t('unknownDossier');

  return (
    <>
      <div className="elu-row-top">
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4, margin: 0 }}>
          {lienDossier ? (
            <Link href={lienDossier} prefetch={false} className="hover:underline" style={{ color: 'var(--foreground)' }}>
              {titre}
            </Link>
          ) : titre}
        </h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', flex: 'none' }}>
          {t('interventionCount', { count: nombre })}
          {derniereDate ? ` · ${formatDateCourte(derniereDate, locale)}` : ''}
        </span>
      </div>
      {chambre && <div className="elu-row-meta">{chambre}</div>}
    </>
  );
}

/**
 * Un dossier sur lequel l'élu est intervenu, dans le fil : une seule ligne dont le
 * titre mène à la fiche du dossier, comme les lignes de votes et de textes. Le texte
 * des interventions se lit dans le tiroir (`ParolesTiroir`).
 */
export function ParoleRow({ group }: { group: DossierGroup }) {
  const lienDossier = group.dossier?.uid ? `/dossiers-legislatifs/${group.dossier.uid}/resume-ia` : null;
  return (
    <div className={`elu-row${lienDossier ? ' elu-row--clic' : ''}`}>
      <ParoleEntete group={group} nombre={group.interventions.length} lienDossier={lienDossier} />
    </div>
  );
}

// ── TexteRow ───────────────────────────────────────────────────────────────

/** Un dossier que l'élu a initié, cosigné ou rapporté. La pastille « comme
 *  ministre » explique pourquoi un texte listé ici ne compte pas dans le score. */
export function TexteRow({ dossier, montrerInitiateur = false }: { dossier: Dossier; montrerInitiateur?: boolean }) {
  const t = useTranslations('elus');
  const tDossiers = useTranslations('dossiers');
  const tDef = useTranslations('definitions');
  const locale = useLocale();
  // La couleur du reste du site, pour qu'un statut ait la même teinte ici et
  // dans la liste des dossiers.
  const couleurStatut = statutBulletColor(dossier.statut_final);
  const ini = Array.isArray(dossier.initiateur) ? dossier.initiateur[0] : (dossier.initiateur ?? null);
  const nomInitiateur = montrerInitiateur && (ini?.prenom || ini?.nom)
    ? [ini?.prenom, ini?.nom].filter(Boolean).join(' ')
    : null;
  // Les listes sont rangées sur cette même date dans `page.tsx` (`dateAffichee`) :
  // changer l'une sans l'autre remettrait des lignes hors de leur place.
  const date = dossier.date_promulgation ?? dossier.date_depot;

  return (
    <div className="elu-row elu-row--clic">
      <Link
        href={`/dossiers-legislatifs/${dossier.uid}/resume-ia`}
        prefetch={false}
        className="hover:underline"
        style={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4, color: 'var(--foreground)', display: 'block' }}
      >
        {dossier.titre ?? t('dossierSansTitre')}
      </Link>
      <div className="elu-row-meta">
        {dossier.denomination && <span style={tagStyle}>{dossier.denomination}</span>}
        {dossier.statut_final && (
          <span
            style={{
              ...tagStyle,
              backgroundColor: couleurStatut + '22',
              color: couleurStatut,
            }}
          >
            {translateStatut(dossier.statut_final, tDossiers)}
          </span>
        )}
        {dossier.commeMinistre && <span style={tagStyle}>{t('commeMinistreNonCompte')}</span>}
        {nomInitiateur && <span>{nomInitiateur}</span>}
        {dossier.procedure_libelle && (
          // Même terme que la fiche du dossier ; une procédure absente du glossaire
          // reste en clair plutôt que de disparaître.
          <span>{getDefinition(dossier.procedure_libelle, tDef)?.term ?? dossier.procedure_libelle}</span>
        )}
        {date && <span>{formatDate(date, locale)}</span>}
      </div>
    </div>
  );
}

// ── Amendements ────────────────────────────────────────────────────────────

/**
 * Les quatre segments de la barre du fil, regroupant les huit cases. « Sans vote »
 * réunit ce qui n'a jamais été mis aux voix, pour une raison que seul le tiroir
 * détaille : tombé, non soutenu, retiré, irrecevable. L'ordre est celui de la barre.
 */
const SEGMENTS_SORT = [
  { cle: 'adoptes', cases: ['adopte'], couleur: 'var(--primary)' },
  { cle: 'rejetes', cases: ['rejete'], couleur: 'color-mix(in oklch, var(--muted-foreground) 70%, transparent)' },
  {
    cle: 'sansVote',
    cases: ['tombe', 'non_soutenu', 'retire', 'irrecevable', 'autre'],
    couleur: 'color-mix(in oklch, var(--muted-foreground) 35%, transparent)',
  },
  { cle: 'enAttente', cases: ['en_attente'], couleur: 'var(--border)' },
] as const satisfies readonly { cle: string; cases: readonly (keyof AmendementsParSort)[]; couleur: string }[];

/** Ordre des huit cases dans le détail du tiroir, du vote à l'absence de vote. */
export const ORDRE_SORTS: (keyof AmendementsParSort)[] = [
  'adopte', 'rejete', 'tombe', 'non_soutenu', 'retire', 'irrecevable', 'en_attente', 'autre',
];

/**
 * Le sort des amendements d'un élu en une barre de quatre segments, et sa légende.
 * Un segment vide sort de la barre comme de la légende. La barre est muette pour un
 * lecteur d'écran : la légende porte les mêmes chiffres en texte. Appelée par
 * `EluProfileClient`, sous les chiffres de la section.
 */
export function RepartitionSorts({ sorts }: { sorts: AmendementsParSort }) {
  const t = useTranslations('elus');
  const locale = useLocale();
  const nf = new Intl.NumberFormat(locale);
  const segments = SEGMENTS_SORT
    .map((s) => ({ ...s, n: s.cases.reduce((total, c) => total + sorts[c], 0) }))
    .filter((s) => s.n > 0);
  const total = segments.reduce((n, s) => n + s.n, 0);
  if (total === 0) return null;

  return (
    <div style={{ margin: '0 0 1.25rem' }}>
      {/* Hauteur, rayon et écart en style : propriétés visuelles que Tailwind v4
          rend mal sur Safari (CLAUDE.md). */}
      <div aria-hidden style={{ display: 'flex', gap: '2px', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
        {segments.map((s) => (
          <span key={s.cle} style={{ flex: `${s.n} 0 0`, minWidth: '3px', background: s.couleur }} />
        ))}
      </div>
      <ul style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem 1.25rem', listStyle: 'none', padding: 0, margin: '0.625rem 0 0' }}>
        {segments.map((s) => (
          <li key={s.cle} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>
            <span aria-hidden style={{ width: '8px', height: '8px', borderRadius: '2px', background: s.couleur, flex: 'none' }} />
            <span>
              <strong style={{ fontWeight: 600, color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>{nf.format(s.n)}</strong>
              {' '}{t(`segmentSort.${s.cle}` as Parameters<typeof t>[0], { count: s.n })}
            </span>
            {s.cle === 'sansVote' && (
              <InfoBulle ariaLabel={t('infoBulleAria')} texte={t('segmentSortSansVoteInfo')} couleurs={COULEURS_INFO} />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Un amendement adopté de l'élu. Dans le fil, le titre du dossier mène à sa fiche,
 * comme les lignes de textes ; dans le tiroir, où les amendements sont déjà rangés
 * sous leur dossier, `avecDossier` à faux ne garde que la ligne de l'amendement. Le
 * numéro mène à sa page sur le site (`/Amendements/[uid]`), et « Vote public » dit qu'un
 * scrutin public y est relié.
 */
export function AmendementRow({ amendement, avecDossier = true }: { amendement: AmendementAdopte; avecDossier?: boolean }) {
  const t = useTranslations('elus');
  const locale = useLocale();
  const lienDossier = avecDossier && amendement.dossier?.uid
    ? `/dossiers-legislatifs/${amendement.dossier.uid}/resume-ia`
    : null;

  return (
    <div className={`elu-row${lienDossier ? ' elu-row--clic' : ''}`}>
      {avecDossier && (
        <div className="elu-row-top">
          <h3 style={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4, margin: 0 }}>
            {lienDossier ? (
              <Link href={lienDossier} prefetch={false} className="hover:underline" style={{ color: 'var(--foreground)' }}>
                {amendement.dossier?.titre ?? t('dossierSansTitre')}
              </Link>
            ) : t('unknownDossier')}
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', flex: 'none' }}>
            {formatDate(amendement.date_amendement, locale)}
          </span>
        </div>
      )}
      <div className="elu-row-meta" style={avecDossier ? undefined : { marginTop: 0 }}>
        <Link
          href={`/Amendements/${amendement.uid}`}
          prefetch={false}
          aria-label={t('amendementLienAria', { numero: amendement.numero })}
          className="hover:underline underline-offset-2"
          style={{ color: 'var(--primary)', fontWeight: 500 }}
        >
          {t('amendementNumero', { numero: amendement.numero })}
        </Link>
        {amendement.article && <span style={tagStyle}>{amendement.article}</span>}
        <span>{t(amendement.lieu === 'commission' ? 'amendementCommission' : 'amendementSeance')}</span>
        {amendement.avecVote && <span>{t('amendementVotePublic')}</span>}
        {!avecDossier && amendement.date_amendement && <span>{formatDate(amendement.date_amendement, locale)}</span>}
      </div>
    </div>
  );
}

// ── MandatRow ──────────────────────────────────────────────────────────────

/**
 * Trois teintes pour trois statuts de cumul. L'ambre marque ce que la loi
 * interdit, sans le rouge de l'erreur : la situation est le plus souvent
 * régulière le temps des recours, et la fiche n'a pas à trancher. Le gris marque
 * ce qui ne compte pas, et le neutre ce qui occupe l'unique place autorisée.
 */
const STATUT_STYLES: Record<StatutMandat, React.CSSProperties> = {
  executif: { backgroundColor: 'rgba(217, 119, 6, 0.14)', color: '#b45309' },
  quota: { backgroundColor: 'rgba(15, 118, 110, 0.12)', color: '#0f766e' },
  commune_petite: {},
  flechage: {},
};

/**
 * Une ligne de mandat, nationale ou locale. Le titre porte ce qui identifie le
 * mandat (l'organe ou la collectivité), les pastilles disent de quelle nature
 * il est, quelle fonction y est exercée, et depuis quand.
 *
 * La date se réduit au mois et à l'année : le jour d'une prise de fonction
 * dans une commission n'apprend rien, et l'aligner sur les autres lignes du
 * fil ferait croire à une précision qui n'a pas d'intérêt ici.
 *
 * `enDessous` : ce qui suit la ligne dans son cadre. La fiche y pose, sous le siège
 * de député ou de sénateur, l'élection qui l'a donné (`BlocElection`, D-298).
 */
export function MandatRow({ mandat, enDessous }: { mandat: MandatAffiche; enDessous?: React.ReactNode }) {
  const t = useTranslations('elus');
  const locale = useLocale();

  // `formatJourNu` : les dates de mandat sont des dates nues, qu'un visiteur à
  // l'ouest de Greenwich lirait sinon au mois précédent pour tout mandat commencé
  // un 1er.
  const depuis = mandat.dateDebut
    ? formatJourNu(mandat.dateDebut, locale, { month: 'long', year: 'numeric' })
    : null;
  // Au jour près, contrairement à `depuis` : c'est un délai de trente jours qui
  // court, et le mois seul ne dirait pas s'il est tenu.
  const dateLongue = (iso: string) =>
    formatJourNu(iso, locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const v = mandat.verification;

  return (
    <div className="elu-row">
      <span style={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4, color: 'var(--foreground)', display: 'block' }}>
        {mandat.libelle ?? t(`mandatType.${mandat.categorie}` as Parameters<typeof t>[0])}
      </span>
      <div className="elu-row-meta">
        {mandat.libelle && (
          <span style={tagStyle}>{t(`mandatType.${mandat.categorie}` as Parameters<typeof t>[0])}</span>
        )}
        {mandat.qualite && <span style={{ fontWeight: 600 }}>{mandat.qualite}</span>}
        {/* Le statut de cumul, en pastille colorée : sans lui, rien ne distingue
            un siège de conseil de village, qui ne compte pas, d'une fonction
            exécutive que la loi interdit. Seule pastille autorisée à passer à la
            ligne : « Commune de moins de 1 000 habitants · ne compte pas dans la
            limite » mesure 366 px sur une ligne, et poussait la colonne Mandats
            hors d'un écran de 390 px. Les coins moins arrondis gardent une forme
            propre sur deux lignes. */}
        {mandat.statut && (
          <span style={{ ...tagStyle, whiteSpace: 'normal', borderRadius: '0.5rem', ...(mandat.enRegle ? {} : STATUT_STYLES[mandat.statut]) }}>
            {t(
              (mandat.enRegle
                ? `mandatStatut.${mandat.statut}_enRegle`
                : `mandatStatut.${mandat.statut}`) as Parameters<typeof t>[0],
            )}
          </span>
        )}
        {depuis && <span>{t('mandatDepuis', { date: depuis })}</span>}
      </div>
      {/* La ligne du registre reste telle quelle au-dessus, la correction vient
          dessous avec sa source : le lecteur voit les deux, et d'où vient la
          seconde. */}
      {v && (
        <p style={{ fontSize: '0.75rem', lineHeight: 1.4, color: 'var(--muted-foreground)', margin: '0.25rem 0 0' }}>
          {v.effet === 'fonction_jamais_exercee'
            ? t('mandatVerifErreur')
            : v.date
              ? t('mandatVerifDatee', { effet: v.effet, date: dateLongue(v.date) })
              : t('mandatVerifConstatee', { effet: v.effet, date: v.constateLe ? dateLongue(v.constateLe) : '' })}
          {v.sourceUrl && (
            <>
              {' · '}
              {t.rich('mandatVerifSource', {
                nom: v.sourceNom ?? v.sourceUrl,
                lien: (chunks) => (
                  <a
                    href={v.sourceUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}
                  >
                    {chunks}
                  </a>
                ),
              })}
            </>
          )}
        </p>
      )}
      {enDessous}
    </div>
  );
}

// ── TransparenceRow ────────────────────────────────────────────────────────

/**
 * Un fait de transparence : l'intitulé en titre, puis la date, la catégorie, le
 * tiers et la valeur en pastilles, et le détail en dessous quand il y en a un.
 *
 * Aucune teinte d'alerte ici, contrairement aux mandats : un cadeau déclaré est
 * une déclaration conforme, pas une anomalie. Le site montre le fait, il ne le
 * qualifie pas.
 *
 * La ligne est cliquable quand la source publie une page où la vérifier, et
 * seulement dans ce cas (`.elu-row--clic`).
 */
export function TransparenceRow({ element }: { element: TransparenceElement }) {
  const locale = useLocale();

  // `formatJourNu` : ce sont des dates nues, qu'un visiteur à l'ouest de
  // Greenwich lirait sinon la veille.
  const date = element.date_element
    ? formatJourNu(element.date_element, locale, { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const corps = (
    <>
      <div className="elu-row-top">
        <h3
          className="elu-transparence-titre"
          style={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.4, margin: 0 }}
        >
          {element.intitule}
        </h3>
        {date && (
          <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', whiteSpace: 'nowrap', flex: 'none' }}>
            {date}
          </span>
        )}
      </div>
      {/* Pas de pastille de catégorie : l'intertitre du groupe la porte déjà, et
          la répéter sur chaque ligne ajoutait du gris sans rien apprendre. */}
      <div className="elu-row-meta">
        {element.tiers && <span style={{ fontWeight: 600 }}>{element.tiers}</span>}
        {element.valeur_texte && <span>{element.valeur_texte}</span>}
      </div>
      {element.detail && (
        <p
          className="elu-transparence-detail"
          style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', lineHeight: 1.5, margin: '0.375rem 0 0' }}
        >
          {element.detail}
        </p>
      )}
    </>
  );

  if (!element.url_source) {
    return <div className="elu-row elu-transparence-row">{corps}</div>;
  }
  return (
    <a
      className="elu-row elu-row--clic elu-transparence-row"
      href={element.url_source}
      target="_blank"
      rel="noopener noreferrer"
      style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}
    >
      {corps}
    </a>
  );
}

// ── FonctionRow ────────────────────────────────────────────────────────────

/** La section de la fiche qui détaille chaque mesure, quand il y en a une : le
 *  libellé y mène par `allerASection`, qui la rouvre si elle est repliée. Les
 *  présences en commission n'ont pas de section, leur libellé reste du texte. Les
 *  cinq clés sont des sections toujours rendues. */
const SECTION_DE_MESURE: Partial<Record<MetricKey, string>> = {
  cpDoss: 'textes', cpCosign: 'textes', cpRapp: 'textes', cpRappCtrl: 'textes',
  cpPart: 'votes', cpPrisesParole: 'paroles', cpQuestO: 'questions', cpQuestE: 'questions',
  cpAmendAuteur: 'amendements', cpAmendCosign: 'amendements',
};

/** Couleurs de l'icône ⓘ sur le fond de carte, celles du bandeau sombre étant le
 *  défaut d'`InfoBulle`. Exportées pour l'en-tête de la carte (`EluProfileClient`). */
export const COULEURS_INFO = { repos: 'var(--muted-foreground)', actif: 'var(--foreground)' };

/**
 * Une ligne de « Ses affinités de vote » : sigle, barre à la couleur du groupe,
 * pourcentage. Les trois cellules entrent dans la grille de `.elu-accords` par
 * `subgrid`, pour que barres et pourcentages s'alignent d'une ligne à l'autre
 * quelle que soit la longueur du sigle (« Les Indépendants » au Sénat).
 *
 * Sous le sigle, des mentions grises plutôt qu'une couleur ou un badge : « son
 * groupe » (le dernier, pour un ancien élu), et le nombre de votes communs quand
 * il est faible. `mentions` arrive traduit par l'appelant (`EluProfileClient`),
 * vide sur la plupart des lignes.
 */
export function AccordGroupeRow({ groupe, mentions }: {
  groupe: AccordGroupe;
  mentions: string[];
}) {
  const locale = useLocale();
  // Une décimale toujours, pour que les pourcentages alignés à droite tombent
  // sur la même colonne de chiffres.
  const pourcentage = new Intl.NumberFormat(locale, {
    style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1,
  }).format(groupe.accord / 100);
  return (
    <li className="elu-accord">
      <span className="elu-accord-sigle" title={groupe.libelle ?? undefined}>
        {groupe.sigle}
        {mentions.map((m) => <span key={m} className="elu-accord-mention">{m}</span>)}
      </span>
      <span className="elu-accord-barre" aria-hidden>
        <span style={{ width: `${groupe.accord}%`, background: groupe.couleur }} />
      </span>
      <span className="elu-accord-n">{pourcentage}</span>
    </li>
  );
}

/**
 * Une des quatre fonctions parlementaires de la carte Activité, toutes mesures
 * visibles. Un bandeau donne le nom, le poids et le rang de la fonction ; puis une
 * ligne par mesure : chiffre brut, libellé accordé au chiffre, barre remplie au
 * centile, rang de l'élu sur la mesure. Le centile ne s'écrit nulle part : il ne
 * sert qu'à la longueur de la barre.
 *
 * Appelée par `EluProfileClient`. `metricValues` porte les centiles, `metricRaw` le
 * chiffre déjà formaté, `metricCount` le compte qui accorde le libellé (null pour la
 * participation, qui est un taux, et pour un compte absent). Les rangs viennent de
 * `activiteScore.rangsMesures`, lus par `page.tsx` dans la vue `activite_elus_mv`.
 *
 * `sansClassement` retire tout ce qui situe l'élu dans sa chambre : le rang de la
 * fonction, les barres et les rangs par mesure. Servi aux présidents de chambre et
 * de groupe, hors classement (D-123), pour qui ces éléments seraient vides. Restent
 * les chiffres bruts, qui sont l'information réelle.
 */
export function FonctionRow({
  fonctionKey,
  activiteScore,
  metricValues,
  metricRaw,
  metricCount,
  sansClassement = false,
}: {
  fonctionKey: FonctionKey;
  activiteScore: ActiviteScore;
  metricValues: Record<MetricKey, number | null>;
  metricRaw: Record<MetricKey, string | null>;
  metricCount: Record<MetricKey, number | null>;
  sansClassement?: boolean;
}) {
  const t = useTranslations('elus');
  const fonction = ACTIVITE_FUNCTIONS[fonctionKey];
  const rang = activiteScore.sousScores?.[fonctionKey]?.rang ?? null;
  const totalFn = activiteScore.sousScores?.[fonctionKey]?.total ?? 0;

  return (
    <section className="elu-fonction">
      <div className="elu-fonction-tete">
        <span className="elu-fonction-nom">
          {t(`activite.fonctions.${fonctionKey}` as Parameters<typeof t>[0])}
          <span className="elu-fonction-poids">{t('fonctionPoids', { percent: fonction.percent })}</span>
        </span>
        {!sansClassement && rang !== null && (
          <span className="elu-fonction-rang">
            {rang}<sup>{t('rangSuffixe', { rang })}</sup>
            <span> {t('fonctionRank', { total: totalFn })}</span>
          </span>
        )}
      </div>
      {fonction.metrics.map((m) => {
        const centile = metricValues[m];
        const rangMesure = activiteScore.rangsMesures?.[m] ?? null;
        const section = SECTION_DE_MESURE[m];
        // Sans compte (participation, présence en commission non suivie), le
        // libellé se lit au pluriel.
        const libelle = t(`activite.mesures.${m}` as Parameters<typeof t>[0], { count: metricCount[m] ?? 2 });
        return (
          <div key={m} className="elu-mesure">
            <span className="elu-mesure-n">{metricRaw[m] ?? '—'}</span>
            <span className="elu-mesure-l">
              {section ? (
                <button type="button" className="elu-mesure-lien" onClick={() => allerASection(section)}>
                  {libelle}
                </button>
              ) : libelle}
              {/* Au Sénat, presque tous les taux de participation sont collés à
                  100 % : un vote d'écart y sépare des rangs très éloignés, ce qui
                  se lit comme une erreur sans cette note. Seulement là où le rang
                  s'affiche, donc pas chez un élu hors classement. */}
              {m === 'cpPart' && activiteScore.chambre === 'SN' && !sansClassement && (
                <span className="elu-mesure-info">
                  <InfoBulle ariaLabel={t('infoBulleAria')} texte={t('senatParticipationNote')} couleurs={COULEURS_INFO} />
                </span>
              )}
            </span>
            {!sansClassement && centile !== null && (
              <span className="elu-mesure-c">
                <span className="elu-mesure-barre" aria-hidden>
                  <span style={{ width: `${centile}%` }} />
                </span>
                <span className="elu-mesure-r">
                  {rangMesure !== null && <>{rangMesure}<sup>{t('rangSuffixe', { rang: rangMesure })}</sup></>}
                </span>
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}
