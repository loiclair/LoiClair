// src/lib/mcp/elus.ts
//
// Outils du serveur MCP qui portent sur les parlementaires.
//
// La fiche rendue ici n'est pas celle du site : la page web fait jusqu'à dix-neuf
// requêtes parce qu'elle affiche les textes, les débats et les votes de l'élu.
// Un assistant qui demande « qui est untel » n'a besoin que de l'identité, du
// cumul, de la transparence, de l'activité et de l'accord de vote avec chaque
// groupe : cinq lectures sur clé primaire, plus les positions de l'élu
// (`positions_scrutins_elu`) que demande l'accord. Les tables portent leurs
// agrégats en colonnes, ce qui rend cette économie possible.
//
// Appelé par `src/app/api/mcp/route.ts`.

import { sql, auPlusUneLigne } from '@/lib/db';
import {
  compterQuota,
  echeanceSituation,
  enVigueur,
  motifSituation,
  statutMandat,
  TYPES_LOCAUX_LO141,
  type EffetVerification,
  type MandatLocalRow,
  type SituationCumul,
  type StatutMandat,
} from '@/lib/mandats-locaux';
import {
  ACTIVITE_METHODE_MAJ,
  fonctionsDeLigne,
  type FonctionKey,
} from '@/lib/activite-weights';
import { enveloppe, troncature, urlFr, urlEn, type Enveloppe, type Troncature } from '@/lib/mcp/enveloppe';
import { lireOuCalculer, cleCache, TTL_COURT } from '@/lib/mcp/cache';
import { codeChambre, SEUIL_JOURS_CLASSEMENT, type CodeChambre, type CodeExclusion } from '@/lib/mcp/codes';
import { aujourdhuiAParisIso } from '@/lib/jour-paris';
import { lireAccordsGroupes, SEUIL_VOTES_COMMUNS } from '@/lib/affinites-vote';

/** Pages qui expliquent la méthode des chiffres que cet outil rend. */
const ARTICLES_FICHE_ELU = [
  '/Activite',
  '/Facts/participation',
  '/Facts/loyaute',
  '/Facts/cumul-des-mandats',
];

/** Nombre maximum d'éléments de transparence rendus dans une fiche. */
const MAX_TRANSPARENCE = 20;

type GroupeRow = { uid: string; libelle: string | null; libelle_abrege: string | null };

type ActeurRow = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  age: number | null;
  libelle_profession: string | null;
  departement_election: string | null;
  num_departement: string | null;
  num_circo: string | null;
  qualite_actuelle: string | null;
  date_debut_mandat: string | null;
  url_profil_officiel: string | null;
  taux_participation_votes_finaux: number | null;
  taux_participation_votes_solennels: number | null;
  taux_cohesion_groupe: number | null;
  votes_finaux_solennels: number | null;
  votes_delegues: number | null;
  taux_delegation: number | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  est_ministre_actuel: boolean | null;
  en_exercice: boolean | null;
  groupe: GroupeRow | null;
};

type ActiviteRow = {
  score: number | null;
  rang_chambre: number | null;
  jours_actifs: number | null;
  est_president_chambre: boolean | null;
  est_president_groupe: boolean | null;
  chambre: string | null;
  taux_participation_votes_finaux: number | null;
  nb_dossiers_inities: number | null;
  nb_textes_cosignes: number | null;
  nb_rapporteur: number | null;
  nb_rapports_controle: number | null;
  nb_amendements_auteur: number | null;
  nb_amendements_cosignataire: number | null;
  nb_questions_orales: number | null;
  nb_questions_ecrites: number | null;
  nb_prises_parole: number | null;
  nb_commission_presences: number | null;
};

type LigneTransparence = {
  source: string;
  categorie: string | null;
  date_element: string | null;
  intitule: string | null;
  tiers: string | null;
  valeur_texte: string | null;
  url_source: string | null;
};

export type FicheElu = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  chambre: CodeChambre | null;
  est_ministre: boolean;
  en_exercice: boolean;
  qualite: string | null;
  groupe: { uid: string; libelle: string | null; abrege: string | null } | null;
  departement: string | null;
  num_departement: string | null;
  num_circo: string | null;
  profession: string | null;
  age: number | null;
  mandat_debut: string | null;
  taux_participation_votes_finaux: number | null;
  taux_participation_votes_solennels: number | null;
  taux_cohesion_groupe: number | null;
  /** Part de ses votes finaux et solennels déposés par un collègue porteur de sa
   *  délégation, et les deux compteurs qui la donnent. Député seulement : `null`
   *  pour un sénateur, et le taux aussi pour le président de l'Assemblée (D-124).
   *  Un vote délégué reste valide et compte dans la participation (D-117). */
  delegation: { votes_delegues: number; votes: number; taux: number | null } | null;
  url: string;
  url_en: string;
  url_officielle: string | null;
  cumul: {
    mandats_comptes_dans_quota: number;
    a_fonction_executive: boolean;
    /** Délai pour choisir, quand il y a une situation à régulariser : sa date
     *  limite (calculée, ou établie par la vérification), ou un recours en cours
     *  qui le suspend. Nul sans situation. */
    delai: {
      date_limite: string | null;
      depassee: boolean;
      recours_en_cours: boolean;
      source: { nom: string | null; url: string } | null;
    } | null;
    /** Les lignes du registre, telles quelles. `statut` juge ce qui vaut aujourd'hui,
     *  nul pour un mandat quitté ; `verification` dit ce que LoiClair a constaté. */
    mandats: {
      type: string;
      collectivite: string;
      fonction: string | null;
      statut: StatutMandat | null;
      verification?: {
        effet: EffetVerification;
        date: string | null;
        source: { nom: string | null; url: string | null };
      };
    }[];
  };
  transparence: {
    declaration: { statut: string | null; depose_le: string | null; url: string | null } | null;
    elements: {
      source: string;
      categorie: string | null;
      date: string | null;
      intitule: string | null;
      tiers: string | null;
      valeur_texte: string | null;
      url_source: string | null;
    }[];
    elements_total: number;
  };
  activite: {
    score: number | null;
    rang_chambre: number | null;
    exclusion_classement: CodeExclusion | null;
    sous_scores: Record<FonctionKey, number | null>;
    compteurs: Record<string, number | null>;
    jours_actifs: number | null;
    methode_maj: string;
    methode_url: string;
    methode_url_en: string;
  } | null;
  /** Accord de vote avec chaque groupe de sa chambre (D-354), le calcul de « Ses
   *  affinités de vote » sur la fiche du site. `groupes` est vide sous le seuil. */
  affinites_vote: {
    votes_finaux_comptes: number;
    seuil_votes_communs: number;
    groupes: {
      uid: string;
      libelle: string | null;
      abrege: string | null;
      accord_pct: number;
      votes_communs: number;
    }[];
  };
};

/**
 * Pourquoi cet élu n'a ni score ni rang.
 *
 * Un `score: null` livré nu produit « il n'a rien fait », sur une personne
 * réelle. Ce champ est le garde-fou : il vit dans les données, là où la
 * description de l'outil n'est lue qu'une fois.
 *
 * L'ordre suit celui des exclusions en base : la présidence l'emporte sur la
 * durée de mandat, qu'un président de chambre franchit de toute façon.
 */
function exclusionClassement(r: ActiviteRow): CodeExclusion | null {
  if (r.score !== null && r.rang_chambre !== null) return null;
  if (r.est_president_chambre) return 'president_chambre';
  if (r.est_president_groupe) return 'president_groupe';
  if ((r.jours_actifs ?? 0) < SEUIL_JOURS_CLASSEMENT) return 'mandat_moins_180_jours';
  return null;
}

function chambreDe(a: ActeurRow, act: ActiviteRow | null): CodeChambre | null {
  if (act?.chambre) return codeChambre(act.chambre);
  if (a.est_depute_actuel) return 'assemblee';
  if (a.est_senateur_actuel) return 'senat';
  return null;
}

/**
 * Fiche d'un parlementaire : identité, cumul, transparence, activité.
 *
 * Rend `null` si l'uid est inconnu : l'appelant le traduit en code d'erreur.
 */
export async function ficheElu(uid: string): Promise<Enveloppe<FicheElu> | null> {
  const fiche = await lireOuCalculer(cleCache('fiche_elu', { uid }), TTL_COURT, async () => {
    // Toutes les lectures lèvent sur une panne (D-136), y compris les cinq
    // secondaires. Sans ça, une panne sur `mandats_locaux` publiait « cet élu ne
    // cumule pas » et le cache gardait la réponse six heures : une panne devenue
    // un fait sur une personne nommée. Seul un uid inconnu rend `null`.
    const [a, lignesMandats, lignesTransparence, decl, act, situation, positions] = await Promise.all([
      // `groupe` est un objet jsonb, ou `null` pour un élu sans groupe : la forme
      // qu'attendent les appelants.
      auPlusUneLigne(sql<ActeurRow[]>`
        select a.uid, a.prenom, a.nom, a.age, a.libelle_profession, a.departement_election,
          a.num_departement, a.num_circo, a.qualite_actuelle, a.date_debut_mandat,
          a.url_profil_officiel, a.taux_participation_votes_finaux,
          a.taux_participation_votes_solennels, a.taux_cohesion_groupe,
          a.votes_finaux_solennels, a.votes_delegues, a.taux_delegation,
          a.est_depute_actuel, a.est_senateur_actuel, a.est_ministre_actuel, a.en_exercice,
          (select jsonb_build_object('uid', o.uid, 'libelle', o.libelle, 'libelle_abrege', o.libelle_abrege)
            from organes o where o.uid = a.groupe) as groupe
        from acteurs a
        where a.uid = ${uid}`, 'acteurs'),
      // La clé primaire est (uid, type, collectivite) : le tri est donc total.
      sql<MandatLocalRow[]>`
        select type, collectivite, fonction, population, date_debut, date_debut_fonction,
          verif_effet, verif_date, verif_source_url, verif_source_nom
        from mandats_locaux
        where uid = ${uid}
        order by type, collectivite`,
      // Le total part avec les lignes par `count(*) over ()`, calculé avant la
      // coupe à vingt : une seule lecture. C'est un compte de lignes, jamais une
      // somme : `valeur_texte` mélange un montant, une durée et un nombre de
      // parts sociales, donc rien ne s'y agrège (contrainte d'ARCHITECTURE.md).
      sql<(LigneTransparence & { total: number })[]>`
        select source, categorie, date_element, intitule, tiers, valeur_texte, url_source,
          count(*) over () as total
        from transparence_elements
        where uid = ${uid}
        order by date_element desc nulls last, identifiant
        limit ${MAX_TRANSPARENCE}`,
      auPlusUneLigne(sql<{ statut_publication: string | null; date_depot: string | null; url_dossier: string | null }[]>`
        select statut_publication, date_depot, url_dossier
        from hatvp_declarations
        where uid = ${uid}`, 'hatvp_declarations'),
      // `select *` volontaire : nommer une colonne que la vue n'a pas encore
      // fait échouer toute la requête pendant la fenêtre entre un déploiement et
      // sa migration. La fiche élu du site fait le même choix, pour la même raison.
      auPlusUneLigne(sql<ActiviteRow[]>`
        select * from activite_elus_mv where uid = ${uid}`, 'activite_elus_mv'),
      auPlusUneLigne(sql<SituationCumul[]>`
        select recours, date_limite, source_url, source_nom
        from situations_cumul
        where uid = ${uid}`, 'situations_cumul'),
      // Les positions de l'élu, du plus récent au plus ancien (ordre de la fonction),
      // pour l'accord de vote. Deux colonnes seulement : le titre ne sert à rien ici.
      sql<{ uid: string; position: string }[]>`
        select uid, "position"
        from positions_scrutins_elu(p_uid => ${uid})`,
    ]);

    if (!a) return null;
    const g = a.groupe;
    // Le décompte juge les lignes après vérification au cas par cas, comme la
    // page et la fiche du site : une présidence quittée n'est plus une fonction
    // exécutive, un siège quitté ne compte plus.
    const mandatsEnVigueur = lignesMandats.map(enVigueur).filter((m): m is MandatLocalRow => m !== null);
    // Le délai pour choisir, par la même règle que la page et la fiche du site.
    // Seulement pour un parlementaire en exercice qui a encore une situation
    // après vérification : une ligne de `situations_cumul` (un recours) survit à
    // une situation que les corrections ont réglée, et `delai` se dit nul sans
    // situation.
    const chambre = chambreDe(a, act);
    const aujourdhui = aujourdhuiAParisIso();
    const quota = compterQuota(mandatsEnVigueur);
    const aFonctionExecutive = mandatsEnVigueur.some((m) => statutMandat(m) === 'executif');
    const enSituation =
      (a.est_depute_actuel || a.est_senateur_actuel) && (quota > 1 || aFonctionExecutive);
    const echeance = chambre && enSituation
      ? echeanceSituation({
          motif: motifSituation(mandatsEnVigueur),
          chambre: chambre === 'assemblee' ? 'AN' : 'SN',
          entree: a.date_debut_mandat,
          situation,
          aujourdhui,
        })
      : null;
    const elements: LigneTransparence[] = lignesTransparence;
    // La chambre actuelle, comme la fiche du site : à `null`, ministre ou ancien élu,
    // le calcul prend celle de son dernier vote final.
    const accords = await lireAccordsGroupes(
      positions,
      a.est_depute_actuel ? 'AN' : a.est_senateur_actuel ? 'SN' : null,
    );

    // Les sous-scores se lisent dans la vue, qui les calcule. Les centiles, eux, ne
    // sortent jamais du serveur : hors de leur cohorte et de leur fenêtre, un centile
    // n'est pas un fait sur la personne, c'est une position dans un calcul maison
    // qu'un assistant présenterait comme un fait.
    const sousScores = act
      ? fonctionsDeLigne(act, 'score')
      : { legiferer: null, deliberer: null, controler: null, commission: null };

    const donnees: FicheElu = {
      uid: a.uid,
      prenom: a.prenom,
      nom: a.nom,
      chambre,
      est_ministre: !!a.est_ministre_actuel,
      en_exercice: !!a.en_exercice,
      qualite: a.qualite_actuelle,
      groupe: g ? { uid: g.uid, libelle: g.libelle, abrege: g.libelle_abrege } : null,
      departement: a.departement_election,
      num_departement: a.num_departement,
      num_circo: a.num_circo,
      profession: a.libelle_profession,
      age: a.age,
      mandat_debut: a.date_debut_mandat,
      taux_participation_votes_finaux: a.taux_participation_votes_finaux,
      taux_participation_votes_solennels: a.taux_participation_votes_solennels,
      taux_cohesion_groupe: a.taux_cohesion_groupe,
      // Bloc entier ou `null` : les deux compteurs n'existent que pour un député, et
      // un taux isolé de sa base se lirait sans savoir sur combien de votes il porte.
      delegation: a.votes_finaux_solennels != null && a.votes_delegues != null
        ? { votes_delegues: a.votes_delegues, votes: a.votes_finaux_solennels, taux: a.taux_delegation }
        : null,
      url: urlFr(`/les-elus/${a.uid}`),
      url_en: urlEn(`/les-elus/${a.uid}`),
      url_officielle: a.url_profil_officiel,
      cumul: {
        // `compterQuota` et `statutMandat` portent la règle LO 141 et ne se
        // réimplémentent jamais : un décompte refait à la main avait publié
        // 26 situations irrégulières au lieu de 16.
        mandats_comptes_dans_quota: quota,
        a_fonction_executive: aFonctionExecutive,
        delai: echeance && {
          date_limite: echeance.etat === 'date' ? echeance.date : null,
          depassee: echeance.etat === 'date' && echeance.date < aujourdhui,
          recours_en_cours: echeance.etat === 'recours',
          source: echeance.sourceUrl ? { nom: echeance.sourceNom, url: echeance.sourceUrl } : null,
        },
        mandats: lignesMandats.map((m) => {
          const enCours = enVigueur(m);
          return {
            type: m.type,
            collectivite: m.collectivite,
            fonction: m.fonction,
            statut: enCours ? statutMandat(enCours) : null,
            ...(m.verif_effet && {
              verification: {
                effet: m.verif_effet,
                date: m.verif_date ?? null,
                source: { nom: m.verif_source_nom ?? null, url: m.verif_source_url ?? null },
              },
            }),
          };
        }),
      },
      transparence: {
        declaration: decl
          ? { statut: decl.statut_publication, depose_le: decl.date_depot, url: decl.url_dossier }
          : null,
        elements: elements.map((e) => ({
          source: e.source,
          categorie: e.categorie,
          date: e.date_element,
          intitule: e.intitule,
          tiers: e.tiers,
          valeur_texte: e.valeur_texte,
          url_source: e.url_source,
        })),
        // Aucune ligne : pas de `total` à lire, et le compte vaut bien zéro.
        elements_total: lignesTransparence[0]?.total ?? 0,
      },
      activite: act
        ? {
            score: act.score,
            rang_chambre: act.rang_chambre,
            exclusion_classement: exclusionClassement(act),
            sous_scores: sousScores,
            compteurs: {
              taux_participation_votes_finaux: act.taux_participation_votes_finaux,
              nb_dossiers_inities: act.nb_dossiers_inities,
              nb_textes_cosignes: act.nb_textes_cosignes,
              nb_rapporteur: act.nb_rapporteur,
              nb_rapports_controle: act.nb_rapports_controle,
              nb_amendements_auteur: act.nb_amendements_auteur,
              nb_amendements_cosignataire: act.nb_amendements_cosignataire,
              nb_questions_orales: act.nb_questions_orales,
              nb_questions_ecrites: act.nb_questions_ecrites,
              nb_prises_parole: act.nb_prises_parole,
              nb_commission_presences: act.nb_commission_presences,
            },
            jours_actifs: act.jours_actifs,
            // La date de dernière modification de la méthode et son lien partent
            // avec le score : /Activite#methodologie est la page qui promet au
            // lecteur de pouvoir vérifier, un score sorti sans elle casse cette
            // promesse.
            methode_maj: ACTIVITE_METHODE_MAJ,
            methode_url: urlFr('/Activite#methodologie'),
            methode_url_en: urlEn('/Activite#methodologie'),
          }
        : null,
      affinites_vote: {
        votes_finaux_comptes: accords[0]?.total ?? 0,
        seuil_votes_communs: SEUIL_VOTES_COMMUNS,
        groupes: accords.map((l) => ({
          uid: l.groupe_uid,
          libelle: l.libelle,
          abrege: l.libelle_abrege,
          accord_pct: l.accord,
          votes_communs: l.communs,
        })),
      },
    };

    return donnees;
  });

  if (!fiche) return null;
  return enveloppe('fiche_elu', fiche, ARTICLES_FICHE_ELU);
}

// ---------------------------------------------------------------------------
// chercher_elu
// ---------------------------------------------------------------------------

/** Pages qui expliquent les chiffres rendus par la recherche. */
const ARTICLES_CHERCHER_ELU = ['/Facts/participation', '/Facts/cumul-des-mandats'];

/** Plafond de lignes rendues par un outil de liste, quelle que soit la combinaison de filtres. */
const LIMITE_MAX = 20;

/** Une ligne de plus que demandé : sa présence signale qu'il en reste, sans payer un comptage. */
function plafond(limite: number): number {
  return Math.min(limite, LIMITE_MAX) + 1;
}

/**
 * Fenêtre de lecture quand le cumul est filtré.
 *
 * Le cumul ne se calcule pas en SQL : il faut lire les lignes, puis filtrer en
 * mémoire. La fenêtre doit donc couvrir tout l'effectif, sinon une liste
 * amputée peut partir sans que rien ne le dise. 1 001 élus sont en exercice
 * (mesuré le 2026-09-20) : cette valeur les couvre, et borne ce qu'une seule
 * requête rapatrie. Au-delà (avec les anciens parlementaires, 3 123 lignes), la
 * fenêtre coupe, et c'est `chercherElu` qui pose alors la troncature.
 */
const FENETRE_CUMUL = 2000;

/** Tranches de participation, en bornes littérales : jamais une valeur venue de l'appelant. */
const TRANCHES_PARTICIPATION: Record<string, [number, number]> = {
  moins_50: [0, 50],
  de_50_a_75: [50, 75],
  de_75_a_90: [75, 90],
  plus_90: [90, 101],
};

export type FiltresElu = {
  nom?: string;
  departement?: string;
  num_departement?: string;
  groupe?: string;
  chambre?: CodeChambre;
  cumul?: 'avec' | 'sans';
  participation?: keyof typeof TRANCHES_PARTICIPATION;
  inclure_anciens?: boolean;
  limite?: number;
};

export type ResultatElu = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  chambre: CodeChambre | null;
  groupe: string | null;
  departement: string | null;
  num_circo: string | null;
  profession: string | null;
  taux_participation_votes_finaux: number | null;
  url: string;
  url_en: string;
};

type LigneRecherche = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  num_circo: string | null;
  departement_election: string | null;
  num_departement: string | null;
  libelle_profession: string | null;
  taux_participation_votes_finaux: number | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  groupe: { libelle: string | null } | null;
};

/**
 * Normalise un terme de recherche comme le font les colonnes `*_search`.
 *
 * Depuis la migration du 2026-09-20, `acteurs.nom_search` et `prenom_search` sont
 * des colonnes générées par `lower(translate(...))`. Appliquer ici la même
 * transformation est ce qui permet à « melenchon » de trouver « Mélenchon »,
 * c'est-à-dire ce qu'un utilisateur tape réellement à son assistant.
 */
function normaliser(terme: string): string {
  return terme
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Motif `ilike` « contient ce terme ». `*` y est converti en `%` : une étoile
 * dans un terme reste un joker. Le motif part en paramètre de la requête, jamais
 * collé dans le SQL : `%` et `_` gardent leur sens de joker, rien d'autre.
 * Aussi utilisé par la recherche en texte libre de `lois.ts`.
 */
export function motifContient(terme: string): string {
  return `%${terme.replace(/\*/g, '%')}%`;
}

/**
 * Les uid des élus qui détiennent au moins un mandat local au sens de LO 141.
 *
 * Même définition que `/Facts/cumul-des-mandats`, et pas une autre : détenir un
 * mandat local est un fait, le seuil des communes de mille habitants ne dit que
 * si ce cumul occupe l'unique place autorisée. Filtrer sur `compterQuota() > 0`
 * appliquait ce seuil et rendait un total différent de celui que publie la page
 * dont la réponse porte le lien, dans la même conversation.
 *
 * Toute la table en une lecture, sans plafond, comme `facts-queries.ts` la lit :
 * 746 lignes aujourd'hui, mais `import_rne.py` la reconstruit à chaque
 * millésime. Le tri suit la clé primaire, pour un ordre de lecture fixe.
 */
async function uidsCumulards(): Promise<Set<string>> {
  return lireOuCalculer(cleCache('cumulards'), TTL_COURT, async () => {
    const mandats = await sql<(MandatLocalRow & { uid: string })[]>`
      select uid, type, collectivite, fonction, population, verif_effet
      from mandats_locaux
      order by uid, type, collectivite`;

    const cumulards = new Set<string>();
    // Un siège quitté ne fait plus un cumulard, comme sur la page.
    for (const m of mandats) if (TYPES_LOCAUX_LO141.has(m.type) && enVigueur(m)) cumulards.add(m.uid);
    return [...cumulards];
  }).then((liste) => new Set(liste));
}

/**
 * Recherche d'élus, filtres combinables.
 *
 * Les colonnes et les opérateurs sont des littéraux de ce fichier ; seules les
 * valeurs viennent de l'appelant, et chacune part en paramètre de la requête,
 * jamais collée dans le SQL. L'expression stricte que le schéma applique en
 * amont (`route.ts`) reste utile : elle borne ce qu'un motif `ilike` peut
 * demander.
 */
export async function chercherElu(f: FiltresElu): Promise<Enveloppe<ResultatElu[]>> {
  const limite = Math.min(f.limite ?? 10, LIMITE_MAX);
  const cle = cleCache('chercher_elu', { ...f, limite });

  const brut = await lireOuCalculer(cle, TTL_COURT, async () => {
    // Le cumul ne se calcule pas en SQL : il faut les lignes de mandats. On
    // sur-lit donc l'effectif entier, puis on filtre et on coupe.
    const surLecture = f.cumul ? FENETRE_CUMUL : plafond(limite);

    // `est_depute_actuel` et `est_senateur_actuel` sont faux pour tout ancien
    // parlementaire : les poser en plus de `inclure_anciens` rendait zéro
    // résultat à chaque fois, y compris sur l'exemple que la description cite.
    // La base ne garde pas la chambre d'un mandat achevé, le filtre ne peut
    // donc pas s'appliquer à eux : il les laisse passer plutôt que de les
    // écarter, et leur champ `chambre` reste vide, qui est la vérité.
    const filtreChambre =
      f.chambre === 'assemblee'
        ? f.inclure_anciens
          ? sql`and (a.est_depute_actuel = true or a.en_exercice = false)`
          : sql`and a.est_depute_actuel = true`
        : f.chambre === 'senat'
          ? f.inclure_anciens
            ? sql`and (a.est_senateur_actuel = true or a.en_exercice = false)`
            : sql`and a.est_senateur_actuel = true`
          : sql``;
    const nom = f.nom ? motifContient(normaliser(f.nom)) : null;
    const tranche = f.participation ? TRANCHES_PARTICIPATION[f.participation] : null;

    // `groupe` est un objet jsonb, ou `null` pour un élu sans groupe : la forme
    // qu'attendent les appelants. Le filtre sur le groupe passe par `exists` et
    // n'est posé que s'il est demandé : en permanence, les élus sans groupe
    // (ministres, non-inscrits de certaines périodes) disparaîtraient des
    // résultats, un trou discret.
    //
    // Par défaut, seuls les élus en fonction : « qui est mon député » est la
    // question la plus fréquente, et faire remonter un ancien parlementaire
    // homonyme y répondrait à côté. Les anciens restent atteignables, mais il
    // faut le demander.
    //
    // `departement_election` n'a pas de jumelle normalisée, à la différence du
    // nom : la recherche y est donc sensible aux accents, et le schéma de
    // l'outil dit de préférer le numéro de département.
    //
    // Tri stable : la clé primaire en dernier critère, pour que deux appels
    // identiques rendent les mêmes lignes dans le même ordre.
    const lues = await sql<LigneRecherche[]>`
      select a.uid, a.prenom, a.nom, a.num_circo, a.departement_election, a.num_departement,
        a.libelle_profession, a.taux_participation_votes_finaux,
        a.est_depute_actuel, a.est_senateur_actuel,
        (select jsonb_build_object('libelle', o.libelle) from organes o where o.uid = a.groupe) as groupe
      from acteurs a
      where true
        ${f.inclure_anciens ? sql`` : sql`and a.en_exercice = true`}
        ${nom ? sql`and (a.nom_search ilike ${nom} or a.prenom_search ilike ${nom})` : sql``}
        ${filtreChambre}
        ${f.num_departement ? sql`and a.num_departement = ${f.num_departement}` : sql``}
        ${f.departement ? sql`and a.departement_election ilike ${motifContient(f.departement)}` : sql``}
        ${f.groupe
          ? sql`and exists (select 1 from organes o where o.uid = a.groupe and o.libelle ilike ${motifContient(f.groupe)})`
          : sql``}
        ${tranche
          ? sql`and a.taux_participation_votes_finaux >= ${tranche[0]} and a.taux_participation_votes_finaux < ${tranche[1]}`
          : sql``}
      order by a.nom, a.prenom, a.uid
      limit ${surLecture}`;

    let lignes: LigneRecherche[] = lues;
    if (f.cumul) {
      const cumulards = await uidsCumulards();
      lignes = lignes.filter((l) => (f.cumul === 'avec' ? cumulards.has(l.uid) : !cumulards.has(l.uid)));
    }

    // Deux façons de rendre une liste incomplète, et les deux posent le bloc :
    // il reste des lignes après la coupe, ou la fenêtre de lecture a elle-même
    // été remplie, auquel cas des élus n'ont jamais été examinés. Sans la
    // seconde, un filtre sur le cumul pouvait rendre une liste amputée sans
    // rien dire.
    //
    // La coupe se fait ici, et pas après le cache : la fenêtre du cumul pèse
    // 2 000 lignes, soit trois cents kilo-octets par combinaison de filtres, et
    // une écriture qu'Upstash refuserait pour sa taille serait avalée par le
    // `try` de `lireOuCalculer`. Le cache ne garde donc que ce qui part.
    return {
      lignes: lignes.slice(0, limite),
      coupe: lignes.length > limite || lues.length >= surLecture,
    };
  });

  const resultats: ResultatElu[] = brut.lignes.map((l) => {
    return {
      uid: l.uid,
      prenom: l.prenom,
      nom: l.nom,
      chambre: l.est_depute_actuel ? 'assemblee' : l.est_senateur_actuel ? 'senat' : null,
      groupe: l.groupe?.libelle ?? null,
      departement: l.departement_election,
      num_circo: l.num_circo,
      profession: l.libelle_profession,
      taux_participation_votes_finaux: l.taux_participation_votes_finaux,
      url: urlFr(`/les-elus/${l.uid}`),
      url_en: urlEn(`/les-elus/${l.uid}`),
    };
  });

  const tronque: Troncature | undefined = brut.coupe ? troncature(limite) : undefined;
  return enveloppe('chercher_elu', resultats, ARTICLES_CHERCHER_ELU, tronque);
}
