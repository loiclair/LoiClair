// src/lib/search/dossier-index.ts
// Client-only : charge l'index des dossiers en trois morceaux, la liste
// (/api/search-index/dossiers), puis les résumés de recherche
// (/api/search-index/dossiers/resumes) et ce que chaque texte change selon « Ce qui
// me concerne » (/api/search-index/dossiers/impacts). Les garde dans IndexedDB par
// version, et construit l'index MiniSearch. Utilisé par la liste des textes et la
// recherche globale du menu, via `chargerIndexDossiers`.

import MiniSearch from 'minisearch';
import { processTermDossiers } from './normalize';
import { idbGet, idbSet } from './idb';
import type { ResumesPayload } from './dossier-resumes';
import type { ImpactsPayload } from './dossier-impacts';

export type DossierMeta = {
  uid: string;
  titre: string;
  /** Titre traduit par l'IA, affiché sur /en par `titreDossier` (`lib/titre-dossier.ts`). */
  titre_en: string | null;
  themes: string[] | null;
  procedure_libelle: string | null;
  date_depot: string | null;
  statut_final: string | null;
  initiateur_nom: string | null;
  initiateur_groupe: string | null;
  has_texte: boolean;
  /** Numéro de dépôt officiel, `null` quand le dossier n'a aucun texte numéroté. */
  numero: string | null;
  /** Chambre du texte porteur du numéro, qui préfixe la référence affichée. */
  chambre: string | null;
  /** Date du dernier acte parlementaire daté. Peut être dans le futur (séance programmée). */
  derniere_activite: string | null;
  /** Code de ce dernier acte, traduit en libellé court par `acteLabelKey()`. */
  dernier_acte_code: string | null;
};

export type DossierIndex = {
  version: string;
  minisearch: MiniSearch;
  metadata: Map<string, DossierMeta>;
  all: DossierMeta[];
  /** Vrai pour le dernier index de la visite : rien de plus frais ni de plus complet
   *  n'arrivera. Faux pour un index tiré de la copie locale, ou sans résumés ni impacts. */
  final: boolean;
};

/** Valeurs cochées de chaque menu de la liste des textes. Un menu absent ou vide ne
 *  filtre rien ; un dossier passe un menu posé si une valeur au moins le retient. */
export type DossierFilters = {
  statut?: string[];
  age?: string[];
  type?: string[];
  groupe?: string[];
  theme?: string[];
};

// Slug du filtre Statut vers les valeurs de `statut_final` qu'il retient. Une loi
// « Appliquée » a d'abord été promulguée, mais « Promulguée » ne la retient pas :
// les deux se cochent ensemble pour voir toutes les lois (raccourci de l'accueil).
const STATUT_MAP: Record<string, readonly string[]> = {
  en_cours_d_examen: ['Déposé - pas encore voté'],
  publie: ['Publié'],
  adopte_par_assemblee: ["Adopté par l'Assemblée nationale"],
  adopte_par_senat: ['Adopté par le Sénat'],
  adopte_par_parlement: ['Adopté par le Parlement'],
  // Le menu n'offre qu'un « Rejeté » : il couvre aussi le rejet par une seule chambre.
  // Pas de slug par chambre : `DossiersResultsClient` écarte toute valeur absente du
  // menu (`filterLabels`), une URL directe n'y arriverait donc jamais.
  rejetee: ['Rejeté', "Rejeté par l'Assemblée nationale", 'Rejeté par le Sénat'],
  promulguee: ['Promulguée'],
  appliquee: ['Appliquée'],
  retire: ['Retiré'],
};

function slugify(str: string): string {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
}

const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;
const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;

/** Vrai si un dépôt vieux de `elapsed` ms tombe dans la tranche `age`. */
function dansTranche(elapsed: number, age: string): boolean {
  if (age === 'moins_6m') return elapsed <= SIX_MONTHS;
  if (age === '6m_1a') return elapsed > SIX_MONTHS && elapsed <= ONE_YEAR;
  if (age === 'plus_1a') return elapsed > ONE_YEAR;
  return false;
}

const pose = (valeurs: string[] | undefined): valeurs is string[] => !!valeurs && valeurs.length > 0;

export function filterDossiers(all: DossierMeta[], filters: DossierFilters): DossierMeta[] {
  const { statut, age, type, groupe, theme } = filters;
  if (!pose(statut) && !pose(age) && !pose(type) && !pose(groupe) && !pose(theme)) return all;
  const now = Date.now();
  return all.filter((d) => {
    if (pose(statut)) {
      const s = d.statut_final;
      if (!s || !statut.some((v) => STATUT_MAP[v]?.includes(s))) return false;
    }
    if (pose(age)) {
      const depot = d.date_depot ? new Date(d.date_depot).getTime() : null;
      if (!depot) return false;
      if (!age.some((a) => dansTranche(now - depot, a))) return false;
    }
    if (pose(type) && (!d.procedure_libelle || !type.includes(slugify(d.procedure_libelle)))) return false;
    if (pose(groupe) && (!d.initiateur_groupe || !groupe.includes(slugify(d.initiateur_groupe)))) return false;
    if (pose(theme) && (!d.themes || !d.themes.some((th) => theme.includes(slugify(th))))) return false;
    return true;
  });
}

/** Réponse de /api/search-index/dossiers, et sa copie IndexedDB (clé `current`).
 *  Une copie écrite avant le découpage n'a pas de `resumesVersion` et porte encore
 *  `search_summary` dans chaque dossier : ignoré, elle sert de liste sans résumés
 *  jusqu'à ce que la liste fraîche la remplace. Une copie écrite avant les impacts
 *  n'a pas d'`impactsVersion` : même chose, la liste fraîche la remplace. */
type Liste = { version: string; resumesVersion?: string; impactsVersion?: string; dossiers: DossierMeta[] };

/** Copies IndexedDB des résumés (clé `resumes`) et des impacts (clé `impacts`) : la
 *  réponse de la route, plus la version que la liste annonçait quand elle a été
 *  téléchargée (voir `charger`). */
type ResumesLocaux = ResumesPayload & { attendue?: string };
type ImpactsLocaux = ImpactsPayload & { attendue?: string };

// Lots de 50 dossiers pour la construction de l'index complet. Mesuré dans Chrome,
// processeur ralenti ×4 pour imiter un téléphone moyen. Le 2026-10-20, des lots de
// 100 indexaient les résumés sans tâche de plus de 50 ms (le seuil où le navigateur
// la compte comme bloquante), contre 1,2 à 1,4 s de gel d'un seul tenant auparavant.
// Le 2026-10-23, les impacts en plus faisaient passer presque chaque lot de 100
// entre 50 et 95 ms ; par 50, il n'en reste qu'un, à 62 ms, comme sans les impacts.
const LOT_INDEXATION = 50;

/** Construit l'index. Sans résumés ni impacts, l'indexation est rapide et se fait
 *  d'un bloc ; avec, elle passe par `addAllAsync`, qui rend la main au navigateur
 *  entre les lots : indexer les 3,4 Mo de résumés d'un seul tenant figeait la page
 *  plus d'une seconde sur téléphone. Tous les index ont les mêmes champs et les
 *  mêmes réglages, un résumé ou des impacts absents étant indexés comme texte vide. */
async function construire(liste: Liste, resumes: ResumesPayload | null, impacts: ImpactsPayload | null): Promise<DossierIndex> {
  const mini = new MiniSearch({
    idField: 'uid',
    // Un seul index pour les deux langues : seul l'affichage choisit le titre. Les
    // impacts portent déjà le français et l'anglais.
    fields: ['titre', 'titre_en', 'search_summary', 'impacts', 'themes', 'initiateur_nom', 'procedure_libelle'],
    storeFields: ['uid'],
    processTerm: (term) => processTermDossiers(term) ?? '',
    searchOptions: {
      fuzzy: 0.2,
      prefix: true,
      combineWith: 'AND',
      // Le poids des impacts ne change que l'ordre, jamais quels textes sont trouvés. À poids
      // égal, un texte dont beaucoup d'articles parlent du sujet passait devant celui
      // dont c'est le titre : « Abrogation de la retraite à 64 ans » tombait de la 1re
      // à la 3e place pour « retraite ». À 0,1, « loyer » et « apprenti » gardent
      // leurs cinq premiers (mesuré le 2026-10-23 sur les 1 633 textes classés).
      boost: { titre: 3, titre_en: 3, initiateur_nom: 2, impacts: 0.1 },
    },
    extractField: (doc: Record<string, unknown>, field) => {
      const v = doc[field];
      if (Array.isArray(v)) return v.join(' ');
      return (v as string | null | undefined) ?? '';
    },
  });

  const metadata = new Map<string, DossierMeta>();
  const docs: Array<Record<string, unknown>> = [];

  for (const d of liste.dossiers) {
    metadata.set(d.uid, {
      uid: d.uid,
      titre: d.titre,
      titre_en: d.titre_en ?? null,
      themes: d.themes,
      procedure_libelle: d.procedure_libelle,
      date_depot: d.date_depot,
      statut_final: d.statut_final,
      initiateur_nom: d.initiateur_nom,
      initiateur_groupe: d.initiateur_groupe,
      has_texte: d.has_texte ?? false,
      numero: d.numero ?? null,
      chambre: d.chambre ?? null,
      derniere_activite: d.derniere_activite ?? null,
      dernier_acte_code: d.dernier_acte_code ?? null,
    });
    docs.push({
      uid: d.uid,
      titre: d.titre ?? '',
      titre_en: d.titre_en ?? '',
      search_summary: resumes?.resumes[d.uid] ?? '',
      impacts: impacts?.impacts[d.uid] ?? '',
      themes: d.themes ?? [],
      initiateur_nom: d.initiateur_nom ?? '',
      procedure_libelle: d.procedure_libelle ?? '',
    });
  }

  if (resumes || impacts) await mini.addAllAsync(docs, { chunkSize: LOT_INDEXATION });
  else mini.addAll(docs);

  const all = [...metadata.values()].sort((a, b) => {
    if (!a.date_depot && !b.date_depot) return 0;
    if (!a.date_depot) return 1;
    if (!b.date_depot) return -1;
    return b.date_depot.localeCompare(a.date_depot);
  });

  return { version: liste.version, minisearch: mini, metadata, all, final: false };
}

/** Télécharge un morceau de l'index, `null` en cas d'échec réseau ou HTTP.
 *  `no-cache` et non `default` : les réponses portent `stale-while-revalidate=604800`,
 *  que le navigateur applique aussi à son propre cache. En `default`, un visiteur
 *  venu dans les sept derniers jours recevrait sa copie périmée. Aucune réponse du
 *  site ne porte d'ETag (constaté en production le 2026-10-20) : la revalidation
 *  ne rend donc jamais 304, et chaque appel retélécharge le morceau entier. D'où la
 *  `resumesVersion` et l'`impactsVersion` de la liste, qui évitent de redemander un
 *  morceau inchangé. */
async function telecharger<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

type Abonne = { surIndex: (idx: DossierIndex) => void; surEchec?: () => void };

const abonnes = new Set<Abonne>();
let dernier: DossierIndex | null = null;
let echec = false;
let lance = false;

function publier(idx: DossierIndex) {
  dernier = idx;
  for (const a of abonnes) a.surIndex(idx);
}

/** Vrai s'il faut télécharger un morceau annoncé en version `voulue` : la copie
 *  locale n'a pas cette version, et aucun téléchargement n'a déjà été tenté pour
 *  elle (voir `attendue` dans `charger`). */
function aTelecharger(local: { version: string; attendue?: string } | null, voulue: string | undefined): boolean {
  return !!voulue && local?.version !== voulue && local?.attendue !== voulue;
}

/** Enchaîne les étapes du chargement, une seule fois par page ouverte. Chaque étape
 *  publie un index utilisable, de mieux en mieux :
 *  1. la copie locale de la liste, sans résumés ni impacts : la liste s'affiche avant
 *     tout réseau ;
 *  2. la même avec les résumés et les impacts locaux, même d'une version passée :
 *     mieux que rien ;
 *  3. la liste fraîche, si sa version diffère de la copie ;
 *  4. les résumés et les impacts frais, si leur version diffère de ceux qu'on a.
 *  Le dernier index publié est republié avec `final`, pour qui attend la fin. */
async function charger() {
  // Lancé avant même la lecture d'IndexedDB : le réseau travaille pendant que la
  // copie locale se lit et s'indexe. `telecharger` ne lève jamais.
  const listeFraiche = telecharger<Liste>('/api/search-index/dossiers');
  const [listeLocale, resumesLocaux, impactsLocaux] = await Promise.all([
    idbGet<Liste>('dossier-index', 'current'),
    idbGet<ResumesLocaux>('dossier-index', 'resumes'),
    idbGet<ImpactsLocaux>('dossier-index', 'impacts'),
  ]);

  let liste = listeLocale ?? null;
  let resumes: ResumesLocaux | null = resumesLocaux ?? null;
  let impacts: ImpactsLocaux | null = impactsLocaux ?? null;
  if (liste) {
    publier(await construire(liste, null, null));
    if (resumes || impacts) publier(await construire(liste, resumes, impacts));
  }

  const fraiche = await listeFraiche;
  if (fraiche && fraiche.version !== liste?.version) {
    liste = fraiche;
    void idbSet('dossier-index', 'current', fraiche);
    publier(await construire(liste, resumes, impacts));
  } else if (
    fraiche && liste &&
    (fraiche.resumesVersion !== liste.resumesVersion || fraiche.impactsVersion !== liste.impactsVersion)
  ) {
    // `version` ne couvre ni les résumés ni les impacts : un résumé IA régénéré sans
    // autre changement laisse la liste identique. Sans reprendre les versions
    // fraîches, la copie locale garderait les anciennes, qui égalent celles des
    // copies locales, et le nouveau contenu ne serait jamais téléchargé. Les
    // dossiers sont les mêmes : rien à republier.
    liste = fraiche;
    void idbSet('dossier-index', 'current', fraiche);
  }
  if (!liste) {
    echec = true;
    for (const a of abonnes) a.surEchec?.();
    return;
  }

  // La liste, les résumés et les impacts sont trois pages figées que le run de nuit
  // invalide ensemble (`/api/revalidate`), mais chacune ne se reconstruit qu'à sa
  // première visite qui suit : la liste peut annoncer une version que la route des
  // résumés ou des impacts ne sert pas encore. `attendue` retient la version annoncée
  // lors du dernier téléchargement, pour ne pas retélécharger un morceau à chaque
  // visite pendant l'écart : une seule tentative par version annoncée. Contrepartie :
  // si la route rattrape ensuite la liste, son nouveau contenu n'arrive qu'avec la
  // prochaine version annoncée.
  // Les deux morceaux se téléchargent ensemble et l'index ne se reconstruit qu'une
  // fois : chaque reconstruction réindexe tous les dossiers.
  const voulueResumes = liste.resumesVersion;
  const voulueImpacts = liste.impactsVersion;
  const [resumesFrais, impactsFrais] = await Promise.all([
    aTelecharger(resumes, voulueResumes)
      ? telecharger<ResumesPayload>('/api/search-index/dossiers/resumes')
      : null,
    aTelecharger(impacts, voulueImpacts)
      ? telecharger<ImpactsPayload>('/api/search-index/dossiers/impacts')
      : null,
  ]);
  let change = false;
  if (resumesFrais) {
    change ||= resumesFrais.version !== resumes?.version;
    resumes = { ...resumesFrais, attendue: voulueResumes };
    void idbSet('dossier-index', 'resumes', resumes);
  }
  if (impactsFrais) {
    change ||= impactsFrais.version !== impacts?.version;
    impacts = { ...impactsFrais, attendue: voulueImpacts };
    void idbSet('dossier-index', 'impacts', impacts);
  }
  if (change) publier(await construire(liste, resumes, impacts));

  if (dernier) publier({ ...dernier, final: true });
}

/**
 * Abonne `surIndex` à l'index des dossiers. Il est appelé à chaque index meilleur
 * que le précédent (voir `charger`), et tout de suite avec le dernier publié si le
 * chargement a déjà avancé : la recherche globale ouverte après la liste ne
 * retélécharge rien. `surEchec` n'est appelé que si aucune liste n'a pu être
 * obtenue, ni en local ni du réseau. Rend la fonction de désabonnement.
 */
export function chargerIndexDossiers(
  surIndex: (idx: DossierIndex) => void,
  surEchec?: () => void
): () => void {
  const abonne: Abonne = { surIndex, surEchec };
  abonnes.add(abonne);
  if (dernier) surIndex(dernier);
  else if (echec) surEchec?.();
  if (!lance) lancer();
  return () => { abonnes.delete(abonne); };
}

/** Lance `charger` une fois. Une exception imprévue (IndexedDB, MiniSearch) laisse
 *  le dernier index publié, republié en `final` : la liste ouverte avec `#q=`
 *  l'attend, et resterait sinon sur son indicateur de chargement. Sans aucun index,
 *  la page doit pouvoir afficher son erreur. */
function lancer() {
  lance = true;
  charger().catch(() => {
    if (dernier) {
      if (!dernier.final) publier({ ...dernier, final: true });
      return;
    }
    echec = true;
    for (const a of abonnes) a.surEchec?.();
  });
}

/**
 * Retente le chargement après un échec, sur un geste du visiteur (bouton
 * « Réessayer » de la liste, réouverture de la recherche globale). Sans effet si
 * le chargement a abouti ou tourne encore : rien ne se télécharge deux fois. Les
 * abonnés restent inscrits et reçoivent l'index par `surIndex`, ou un nouvel
 * `surEchec` si le réseau manque encore. Jamais appelé depuis `surEchec` : un échec
 * répété ne relance rien de lui-même.
 */
export function relancerIndexDossiers() {
  if (!echec) return;
  echec = false;
  lancer();
}
