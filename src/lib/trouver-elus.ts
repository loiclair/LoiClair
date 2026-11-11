// Recherche du député et des sénateurs d'un visiteur, faite dans son navigateur.
// Appelée par la modale « Trouver mes élus » (`TrouverMonDeputeModal`) avec deux fichiers
// identiques pour tous : la table des codes postaux (`public/data/circonscriptions.json`)
// et la liste des élus (`/api/elus-contact`). Rien de ce que tape le visiteur ne part donc
// vers LoiClair, et c'est ce que promet la bulle d'info de la bande « Écrire à mes élus ».
// Fonctions pures, sans `fetch` : le chargement reste à l'appelant.

import type { PeriodeMandat } from '@/hooks/useMesElus';

/** Une ligne de `circonscriptions.json` : une commune d'un code postal, dans une circo. */
export type Commune = {
  cp: string;
  insee: string;
  libelle: string;
  dept: string;
  circo: string;
};

export type CirconscriptionsCp = { version: string; communes: Commune[] };

// `public/data/circonscriptions_fe.json` porte les noms dans les deux langues du site :
// tenus à la main, ils ne dépendent pas des noms de pays propres à chaque navigateur.
export type FePays = { code: string; nom_fr: string; nom_en: string };
export type FeCirco = { num: string; libelle: string; libelle_en: string; pays: FePays[] };
export type FeJson = { circos: FeCirco[] };

export type EluLite = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  // « M. » ou « Mme » : les boutons de contact nomment l'élu « M. Nom » (`appellation`).
  civ: string | null;
  email: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  num_circo: string | null;
  num_departement: string | null;
  date_debut_mandat: string | null;
  /** Périodes dans la chambre actuelle, voir `EluRef`. */
  periodes_mandat_assemblee: PeriodeMandat[] | null;
  groupe_libelle: string | null;
  groupe_abrege: string | null;
  /** Fiche officielle, servie pour les sénateurs seulement : le fichier de leur photo
   *  se nomme d'après elle (`photo-elu.ts`), alors que celle d'un député se déduit de
   *  son uid. Null pour un député, ce qui garde la liste plus légère. */
  url_profil_officiel: string | null;
};

/** Un élu tel que le rend `/api/elus-contact`. `hors_de_france` : élu des Français de l'étranger. */
export type EluContact = EluLite & { hors_de_france: boolean };
export type ElusContact = { deputes: EluContact[]; senateurs: EluContact[] };

export type LookupCommune = { insee: string; libelle: string; dept: string; circos: string[] };

export type LookupResult = {
  origine: 'cp' | 'pays';
  input: string;
  communes?: LookupCommune[];
  circo?: { num: string; libelle: string | null; dept: string };
  depute: EluLite | null;
  senateurs: EluLite[];
};

/** Regroupe les communes par code postal, une fois par chargement de la table. */
export function indexerCodesPostaux(data: CirconscriptionsCp): Map<string, Commune[]> {
  const index = new Map<string, Commune[]>();
  for (const c of data.communes) {
    const list = index.get(c.cp);
    if (list) list.push(c);
    else index.set(c.cp, [c]);
  }
  return index;
}

function deputeDe(elus: ElusContact, dept: string, circo: string): EluLite | null {
  return elus.deputes.find((d) => d.num_departement === dept && d.num_circo === circo) ?? null;
}

function senateursDe(elus: ElusContact, dept: string): EluLite[] {
  return elus.senateurs.filter((s) => s.num_departement === dept);
}

/** Un code postal à cinq chiffres : soit une seule commune dans une seule circo, et ses
 *  élus ; soit la liste des communes et circos possibles, à faire choisir au visiteur. */
export function chercherParCodePostal(cp: string, index: Map<string, Commune[]>, elus: ElusContact): LookupResult {
  const matches = index.get(cp) ?? [];
  if (matches.length === 0) {
    return { origine: 'cp', input: cp, communes: [], depute: null, senateurs: [] };
  }

  // Groupe par (insee, dept) → liste de circos possibles
  const byCommune = new Map<string, { insee: string; libelle: string; dept: string; circos: Set<string> }>();
  for (const m of matches) {
    const key = `${m.dept}|${m.insee}`;
    const existing = byCommune.get(key);
    if (existing) existing.circos.add(m.circo);
    else byCommune.set(key, { insee: m.insee, libelle: m.libelle, dept: m.dept, circos: new Set([m.circo]) });
  }
  const communes = [...byCommune.values()].map((c) => ({
    insee: c.insee,
    libelle: c.libelle,
    dept: c.dept,
    circos: [...c.circos].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)),
  }));

  if (communes.length === 1 && communes[0].circos.length === 1) {
    const c = communes[0];
    return {
      origine: 'cp',
      input: cp,
      communes,
      circo: { num: c.circos[0], libelle: c.libelle, dept: c.dept },
      depute: deputeDe(elus, c.dept, c.circos[0]),
      senateurs: senateursDe(elus, c.dept),
    };
  }

  // Cas ambigu : les sénateurs sont déjà connus si toutes les communes sont dans le même département.
  const depts = new Set(communes.map((c) => c.dept));
  return {
    origine: 'cp',
    input: cp,
    communes,
    depute: null,
    senateurs: depts.size === 1 ? senateursDe(elus, [...depts][0]) : [],
  };
}

/** La circo choisie par le visiteur dans la liste d'un code postal ambigu. */
export function chercherParCirco(dept: string, circo: string, libelle: string, elus: ElusContact): LookupResult {
  return {
    origine: 'cp',
    input: `${dept}-${circo}`,
    circo: { num: circo, libelle, dept },
    depute: deputeDe(elus, dept, circo),
    senateurs: senateursDe(elus, dept),
  };
}

/** Un pays (code ISO à deux lettres) : sa circo des Français de l'étranger, son député, et
 *  les sénateurs des Français de l'étranger, communs à tous les pays. Le libellé de la
 *  circo est rendu dans la langue `locale` de la page. */
export function chercherParPays(pays: string, fe: FeJson, elus: ElusContact, locale: string): LookupResult {
  const found = fe.circos.find((c) => c.pays.some((p) => p.code === pays));
  if (!found) {
    return { origine: 'pays', input: pays, depute: null, senateurs: [] };
  }
  return {
    origine: 'pays',
    input: pays,
    circo: { num: found.num, libelle: locale === 'fr' ? found.libelle : found.libelle_en, dept: '099' },
    depute: elus.deputes.find((d) => d.hors_de_france && d.num_circo === found.num) ?? null,
    senateurs: elus.senateurs.filter((s) => s.hors_de_france),
  };
}
