// src/lib/search/acteur-index.ts
// Index complet des acteurs pour la recherche 100 % client, keyword uniquement.

import MiniSearch from 'minisearch';
import { processTerm, normalizeFr } from './normalize';
import { idbGet, idbSet } from './idb';
import { DEPT_FILTER_VARIANTS, DEPT_NAME_TO_SVG_ID } from '@/lib/departements';

export type ActeurMeta = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  civ: string | null;
  groupe_libelle: string | null;
  /** Identifiant de l'organe du groupe, qui nomme son logo. Absent des index
   *  servis avant la version `-v4`. */
  groupe_uid: string | null;
  departement_election: string | null;
  libelle_profession: string | null;
  ministere_libelle: string | null;
  en_exercice: boolean;
  est_depute_actuel: boolean;
  est_senateur_actuel: boolean;
  est_ministre_actuel: boolean;
  qualite_actuelle: string | null;
  /** Fiche officielle, renseignée pour les seuls sénateurs : `photoElu` en
   *  dérive l'URL de leur portrait, là où l'`uid` suffit côté Assemblée. */
  url_profil_officiel: string | null;
};

export type ActeurIndex = {
  version: string;
  minisearch: MiniSearch;
  all: ActeurMeta[];
  byUid: Map<string, ActeurMeta>;
};

function build(version: string, acteurs: ActeurMeta[]): ActeurIndex {
  const mini = new MiniSearch({
    idField: 'uid',
    fields: ['nom', 'prenom', 'groupe_libelle', 'departement_election', 'dept_code', 'libelle_profession', 'ministere_libelle', 'qualite_actuelle'],
    storeFields: ['uid'],
    processTerm: (term) => processTerm(term) ?? '',
    searchOptions: {
      fuzzy: 0.2,
      prefix: true,
      combineWith: 'AND',
      boost: { nom: 3, prenom: 3, groupe_libelle: 2 },
    },
  });

  const byUid = new Map<string, ActeurMeta>();
  const docs: Array<Record<string, unknown>> = [];
  for (const a of acteurs) {
    byUid.set(a.uid, a);
    const svgId = a.departement_election ? DEPT_NAME_TO_SVG_ID[a.departement_election] : undefined;
    const rawCode = svgId ? svgId.replace('d', '') : '';
    // For zero-padded two-digit codes (01–09), also index the short form (1–9)
    const deptCode = rawCode && /^0\d$/.test(rawCode) ? `${rawCode} ${rawCode[1]}` : rawCode;

    docs.push({
      uid: a.uid,
      nom: a.nom ?? '',
      prenom: a.prenom ?? '',
      groupe_libelle: a.groupe_libelle ?? '',
      departement_election: a.departement_election ?? '',
      dept_code: deptCode,
      libelle_profession: a.libelle_profession ?? '',
      ministere_libelle: a.ministere_libelle ?? '',
      qualite_actuelle: a.qualite_actuelle ?? '',
    });
  }
  mini.addAll(docs);

  return { version, minisearch: mini, all: acteurs, byUid };
}

let cached: Promise<ActeurIndex> | null = null;

/**
 * Index des élus, téléchargé une fois par page : la liste `/les-elus`, la recherche
 * du menu et la comparaison partagent la même promesse. Une promesse rejetée (ni
 * réseau ni copie locale) ne reste pas en cache : l'appel suivant, sur un geste du
 * visiteur (« Réessayer », réouverture de la recherche), retente le téléchargement.
 */
export function loadActeurIndex(): Promise<ActeurIndex> {
  if (cached) return cached;
  const promesse = (async () => {
    const stored = await idbGet<{ version: string; acteurs: ActeurMeta[] }>('acteur-index', 'current');
    // `no-cache` et non `force-cache`, pour la même raison que l'index des
    // dossiers : `force-cache` sert la copie du navigateur sans jamais
    // revalider, donc le numéro de version ci-dessous ne peut rien invalider —
    // la requête qui le porte n'est plus faite. Mesuré le 2026-09-06 sur un
    // navigateur ordinaire : index reçu daté du 30 août, une semaine de retard,
    // élus remplacés absents de la recherche. `no-cache` force la revalidation ;
    // si rien n'a bougé le serveur répond 304 et l'index ne repart pas.
    // Hors ligne, `fetch` lève au lieu de rendre une réponse en erreur : les deux
    // cas retombent sur la copie locale.
    const res = await fetch('/api/search-index/acteurs', { cache: 'no-cache' }).catch(() => null);
    if (!res?.ok) {
      if (stored) return build(stored.version, stored.acteurs);
      throw new Error('Index indisponible');
    }
    const fresh = (await res.json()) as { version: string; acteurs: ActeurMeta[] };
    if (stored && stored.version === fresh.version) {
      return build(stored.version, stored.acteurs);
    }
    void idbSet('acteur-index', 'current', fresh);
    return build(fresh.version, fresh.acteurs);
  })();
  cached = promesse;
  // Comparée avant d'effacer : un appel plus récent a pu remplacer la promesse.
  promesse.catch(() => { if (cached === promesse) cached = null; });
  return promesse;
}

/** Filtres de l'annuaire. Groupes et départements sont des listes de valeurs
 *  cochées : un élu passe s'il est de l'un d'eux. Liste absente ou vide : aucun filtre. */
export type ActeurFilters = {
  role?: 'deputes' | 'senateurs' | undefined;
  groupeSlug?: string[] | undefined;
  /** Noms de départements tels que les liste le filtre ; chacun retient aussi ses
   *  autres graphies en base (`DEPT_FILTER_VARIANTS`). */
  dept?: string[] | undefined;
  query?: string | undefined;
};

function toGroupeSlug(libelle: string): string {
  return normalizeFr(libelle)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+$/, '');
}

export function filterActeurs(index: ActeurIndex, filters: ActeurFilters): ActeurMeta[] {
  let pool: ActeurMeta[];

  if (filters.query && filters.query.trim()) {
    const hits = index.minisearch.search(filters.query.trim()) as Array<{ id: string }>;
    pool = [];
    for (const h of hits) {
      const a = index.byUid.get(h.id);
      if (a) pool.push(a);
    }
  } else {
    pool = index.all;
  }

  const filtered = pool.filter((a) => {
    // Exclure les acteurs sans rôle actif (données incohérentes)
    if (!a.est_depute_actuel && !a.est_senateur_actuel && !a.est_ministre_actuel) return false;

    if (filters.role === 'deputes' && !a.est_depute_actuel) return false;
    if (filters.role === 'senateurs' && !a.est_senateur_actuel) return false;

    if (filters.groupeSlug && filters.groupeSlug.length > 0) {
      if (!a.groupe_libelle || !filters.groupeSlug.includes(toGroupeSlug(a.groupe_libelle))) return false;
    }

    if (filters.dept && filters.dept.length > 0) {
      const d = a.departement_election;
      if (!d || !filters.dept.some((v) => (DEPT_FILTER_VARIANTS[v] ?? [v]).includes(d))) return false;
    }

    return true;
  });

  if (!filters.query || !filters.query.trim()) {
    filtered.sort((a, b) =>
      (a.nom ?? '').localeCompare(b.nom ?? '', 'fr') ||
      (a.prenom ?? '').localeCompare(b.prenom ?? '', 'fr')
    );
  }

  return filtered;
}

/**
 * Le mandat affiché à côté du nom, dans la langue de la page : annuaire
 * `/les-elus` et recherche globale du menu. L'autorisation du Sénat sur les
 * portraits impose de les montrer « à côté du nom et du mandat ». `t` lit le
 * namespace `elus`. Un membre du Gouvernement garde sa qualité telle que la base
 * l'écrit (« Ministre délégué ») : c'est une donnée, comme les noms de groupe.
 * Le mandat d'une élue s'accorde (« Députée », « Sénatrice »), la civilité de la
 * base faisant foi. Vide pour un élu sans mandat en cours.
 */
export function libelleMandat(a: ActeurMeta, t: (cle: string) => string): string {
  if (a.est_ministre_actuel) return a.qualite_actuelle ?? t('roleGouvernement');
  const elue = a.civ === 'Mme';
  if (a.est_depute_actuel) return t(elue ? 'roleDeputee' : 'roleDepute');
  if (a.est_senateur_actuel) return t(elue ? 'roleSenatrice' : 'roleSenateur');
  return '';
}
