// src/lib/mcp/lois.ts
//
// Outils du serveur MCP qui portent sur les dossiers législatifs, les textes et
// les scrutins.
//
// La fiche rendue ici ne reconstruit pas la frise des étapes du site : ce calcul
// vit dans les huit cents lignes de la page `resume-ia`, il enchaîne treize
// jalons, des correctifs de commission mixte et des règles de tri, et l'extraire
// pour cette route ferait courir un risque de régression à une page qui marche.
// « Où en est cette loi » se répond avec le statut, les dates et l'état
// d'application, qui sont tous des colonnes.
//
// Appelé par `src/app/api/mcp/route.ts`.

import { sql, auPlusUneLigne } from '@/lib/db';
import { buildShareUrl } from '@/lib/share-url';
import { premierDebutPeriode } from '@/lib/mandat-actuel';
import { enveloppe, troncature, urlFr, urlEn, type Enveloppe, type Troncature } from '@/lib/mcp/enveloppe';
import { lireOuCalculer, cleCache, TTL_COURT } from '@/lib/mcp/cache';
import { motifContient } from '@/lib/mcp/elus';
import {
  codeStatut,
  codeProcedure,
  codeChambre,
  valeursStatut,
  SEAU_VERS_POSITION,
  TYPE_VOTE_MOTION_CENSURE,
  type CodeChambre,
  type CodePosition,
} from '@/lib/mcp/codes';

/** Pages qui expliquent la méthode des chiffres que cet outil rend. */
const ARTICLES_FICHE_LOI = ['/Facts/taux-promulgation', '/Facts/taux-application', '/Facts/delais'];

type InitiateurRow = { uid: string; prenom: string | null; nom: string | null };

type DossierRow = {
  uid: string;
  titre: string | null;
  statut_final: string | null;
  procedure_libelle: string | null;
  themes: string[] | null;
  date_depot: string | null;
  date_promulgation: string | null;
  code_loi: string | null;
  titre_loi: string | null;
  url_legifrance: string | null;
  lien_an: string | null;
  lien_senat: string | null;
  nb_amendements_deposes: number | null;
  nb_amendements_adoptes: number | null;
  initiateur_groupe_libelle: string | null;
  resume_debats_created_at: string | null;
  initiateur: InitiateurRow | null;
};

type ApplicationRow = {
  statut_application: string | null;
  application_directe: boolean | null;
  nb_mesures_attendues: number | null;
  nb_mesures_appliquees: number | null;
  taux_application: number | null;
  delai_moyen_jours: number | null;
  date_publication: string | null;
};

export type FicheLoi = {
  uid: string;
  titre: string | null;
  statut: string | null;
  procedure: string | null;
  themes: string[];
  date_depot: string | null;
  date_promulgation: string | null;
  code_loi: string | null;
  titre_loi: string | null;
  initiateur: { uid: string; prenom: string | null; nom: string | null } | null;
  initiateur_groupe: string | null;
  amendements: { deposes: number | null; adoptes: number | null };
  application: {
    statut: string | null;
    application_directe: boolean | null;
    mesures_attendues: number | null;
    mesures_appliquees: number | null;
    taux_application: number | null;
    delai_moyen_jours: number | null;
    date_publication: string | null;
  } | null;
  /**
   * Un résumé des débats existe, avec sa date. Le texte lui-même ne sort pas du
   * serveur : il est produit par un modèle, et le lire hors de la page qui porte
   * ses avertissements ferait passer du texte généré pour une source. Le lien
   * l'emporte, l'assistant peut le proposer.
   */
  resume_debats: { existe: boolean; cree_le: string | null; url: string; url_en: string };
  url: string;
  url_en: string;
  url_legifrance: string | null;
  url_assemblee: string | null;
  url_senat: string | null;
};

/**
 * Fiche d'un dossier législatif : où il en est, qui l'a déposé, ce qu'il est devenu.
 *
 * Rend `null` si l'uid est inconnu.
 */
export async function ficheLoi(uid: string): Promise<Enveloppe<FicheLoi> | null> {
  const fiche = await lireOuCalculer(cleCache('fiche_loi', { uid }), TTL_COURT, async () => {
    // Les deux lectures lèvent sur une panne (D-136). Une panne sur
    // `application_lois` ne doit pas se lire « aucun décret d'application
    // connu » : ce serait un fait sur un texte, et le cache le garderait six
    // heures. Seul un uid inconnu rend `null`.
    const [d, app] = await Promise.all([
      // `initiateur` est un objet jsonb, ou `null` sans initiateur connu : la forme
      // qu'attendent les appelants.
      auPlusUneLigne(sql<DossierRow[]>`
        select d.uid, d.titre, d.statut_final, d.procedure_libelle, d.themes, d.date_depot,
          d.date_promulgation, d.code_loi, d.titre_loi, d.url_legifrance, d.lien_an, d.lien_senat,
          d.nb_amendements_deposes, d.nb_amendements_adoptes, d.initiateur_groupe_libelle,
          d.resume_debats_created_at,
          (select jsonb_build_object('uid', a.uid, 'prenom', a.prenom, 'nom', a.nom)
            from acteurs a where a.uid = d.initiateur_acteur_ref) as initiateur
        from dossiers_legislatifs d
        where d.uid = ${uid}`, 'dossiers_legislatifs'),
      auPlusUneLigne(sql<ApplicationRow[]>`
        select statut_application, application_directe, nb_mesures_attendues, nb_mesures_appliquees,
          taux_application, delai_moyen_jours, date_publication
        from application_lois
        where dossier_uid = ${uid}`, 'application_lois'),
    ]);

    if (!d) return null;
    const init = d.initiateur;
    const chemin = `/dossiers-legislatifs/${d.uid}/resume-ia`;

    const donnees: FicheLoi = {
      uid: d.uid,
      titre: d.titre,
      statut: codeStatut(d.statut_final),
      procedure: codeProcedure(d.procedure_libelle),
      themes: d.themes ?? [],
      date_depot: d.date_depot,
      date_promulgation: d.date_promulgation,
      code_loi: d.code_loi,
      titre_loi: d.titre_loi,
      initiateur: init ? { uid: init.uid, prenom: init.prenom, nom: init.nom } : null,
      initiateur_groupe: d.initiateur_groupe_libelle,
      amendements: { deposes: d.nb_amendements_deposes, adoptes: d.nb_amendements_adoptes },
      application: app
        ? {
            statut: app.statut_application,
            application_directe: app.application_directe,
            mesures_attendues: app.nb_mesures_attendues,
            mesures_appliquees: app.nb_mesures_appliquees,
            taux_application: app.taux_application,
            delai_moyen_jours: app.delai_moyen_jours,
            date_publication: app.date_publication,
          }
        : null,
      resume_debats: {
        existe: d.resume_debats_created_at !== null,
        cree_le: d.resume_debats_created_at,
        url: urlFr(chemin),
        url_en: urlEn(chemin),
      },
      url: urlFr(chemin),
      url_en: urlEn(chemin),
      url_legifrance: d.url_legifrance,
      url_assemblee: d.lien_an,
      url_senat: d.lien_senat,
    };

    return donnees;
  });

  if (!fiche) return null;
  return enveloppe('fiche_loi', fiche, ARTICLES_FICHE_LOI);
}


// ---------------------------------------------------------------------------
// chercher_loi et trouver_texte
// ---------------------------------------------------------------------------

const ARTICLES_CHERCHER_LOI = ['/Facts/taux-promulgation', '/Facts/succes-legislatif/volume'];

/** Même plafond que la recherche d'élus, pour la même raison : il borne le coût hors de toute branche. */
const LIMITE_MAX = 20;

function plafond(limite: number): number {
  return Math.min(limite, LIMITE_MAX) + 1;
}

/**
 * Nombre de mots retenus d'une recherche en texte libre.
 *
 * Chaque mot devient un `ilike` de plus, combinés en ET. Au-delà de quatre, la
 * requête coûte sans rien resserrer : un titre de loi contient rarement cinq
 * mots-clés distincts choisis par un lecteur.
 */
const MOTS_MAX = 4;

/** Les mots d'une recherche libre, au plus `MOTS_MAX`. */
function motsDe(texte: string | undefined): string[] {
  return texte ? texte.split(/\s+/).filter(Boolean).slice(0, MOTS_MAX) : [];
}

/**
 * Un ET de `colonne ilike motif`, un par mot, ou rien sans mot. `colonne` est
 * un littéral de ce fichier, jamais une valeur de l'appelant. Le motif de chaque
 * mot est celui de `motifContient` (`elus.ts`).
 */
function filtreMots(colonne: string, mots: string[]) {
  return mots.reduce((acc, m) => sql`${acc} and ${sql(colonne)} ilike ${motifContient(m)}`, sql``);
}

export type FiltresLoi = {
  mots?: string;
  theme?: string;
  statut?: string;
  limite?: number;
};

export type ResultatLoi = {
  uid: string;
  titre: string | null;
  statut: string | null;
  procedure: string | null;
  themes: string[];
  date_depot: string | null;
  date_promulgation: string | null;
  url: string;
  url_en: string;
};

type LigneLoi = {
  uid: string;
  titre: string | null;
  statut_final: string | null;
  procedure_libelle: string | null;
  themes: string[] | null;
  date_depot: string | null;
  date_promulgation: string | null;
};

/**
 * Recherche de dossiers législatifs.
 *
 * La recherche porte sur le titre officiel, et elle est sensible aux accents :
 * `dossiers_legislatifs` n'a pas de colonne normalisée, contrairement aux élus.
 * Le schéma de l'outil le dit, et `trouver_texte` sert de repli exact par numéro
 * de dépôt.
 *
 * `search_summary` n'est jamais interrogé, bien qu'il décrive mieux le contenu :
 * c'est un texte produit par un modèle, et faire dépendre le rappel d'un texte
 * qu'on refuse de servir rendrait les résultats inexplicables.
 */
export async function chercherLoi(f: FiltresLoi): Promise<Enveloppe<ResultatLoi[]>> {
  const limite = Math.min(f.limite ?? 10, LIMITE_MAX);
  const cle = cleCache('chercher_loi', { ...f, limite });

  const lignes = await lireOuCalculer(cle, TTL_COURT, async () => {
    // Le filtre de statut reçoit un code stable et le retraduit en valeurs de
    // base : l'appelant ne voit jamais les libellés français, et ne peut donc pas
    // en inventer un qui existerait en base. `valeursStatut` rend une liste, vide
    // sur un code inconnu : aucun filtre plutôt qu'un filtre faux.
    const statuts = f.statut ? valeursStatut(f.statut) : [];

    // Le thème part en tableau d'un élément, en paramètre : « Économie et
    // finances, fiscalité » reste un seul thème malgré sa virgule. Deux thèmes
    // de l'Assemblée en portent une (418 dossiers), et la description de
    // l'outil donne justement l'un des deux en exemple.
    // hors_liste : dossiers comptés dans le score mais absents des listes (migration 2026-10-29_dossiers_hors_liste.sql).
    const lues = await sql<LigneLoi[]>`
      select uid, titre, statut_final, procedure_libelle, themes, date_depot, date_promulgation
      from dossiers_legislatifs
      where hors_liste = false
        ${filtreMots('titre', motsDe(f.mots))}
        ${f.theme ? sql`and themes @> array[${f.theme}]::text[]` : sql``}
        ${statuts.length > 0 ? sql`and statut_final = any(${statuts})` : sql``}
      order by date_depot desc nulls last, uid
      limit ${plafond(limite)}`;
    return lues as LigneLoi[];
  });

  const coupe = lignes.length > limite;
  const resultats: ResultatLoi[] = lignes.slice(0, limite).map((l) => ({
    uid: l.uid,
    titre: l.titre,
    statut: codeStatut(l.statut_final),
    procedure: codeProcedure(l.procedure_libelle),
    themes: l.themes ?? [],
    date_depot: l.date_depot,
    date_promulgation: l.date_promulgation,
    url: urlFr(`/dossiers-legislatifs/${l.uid}/resume-ia`),
    url_en: urlEn(`/dossiers-legislatifs/${l.uid}/resume-ia`),
  }));

  const tronque: Troncature | undefined = coupe ? troncature(limite) : undefined;
  return enveloppe('chercher_loi', resultats, ARTICLES_CHERCHER_LOI, tronque);
}

export type FiltresTexte = {
  numero?: string;
  mots?: string;
  dossier_uid?: string;
  chambre?: CodeChambre;
  limite?: number;
};

export type ResultatTexte = {
  uid: string;
  numero: string | null;
  titre: string | null;
  type: string | null;
  chambre: CodeChambre | null;
  date_depot: string | null;
  statut_adoption: string | null;
  dossier_uid: string | null;
  url_dossier: string | null;
  url_dossier_en: string | null;
  /** Lien officiel du texte, sur le site de la chambre ou sur Légifrance. */
  url_officielle: string | null;
  /** Le document est-il consultable en ligne : certains dépôts n'ont pas encore de PDF publié. */
  consultable_en_ligne: boolean;
};

type LigneTexte = {
  uid: string;
  num_notice: string | null;
  titre_principal_court: string | null;
  titre_principal: string | null;
  type_libelle: string | null;
  chambre: string | null;
  date_depot: string | null;
  libelle_statut_adoption: string | null;
  dossier_ref: string | null;
  /** Booléen : le texte est-il consultable en ligne. Ce n'est PAS une adresse. */
  url_accessible: boolean | null;
  lien_texte: string | null;
};

/**
 * Retrouve un texte et son lien officiel.
 *
 * C'est le repli exact de `chercher_loi` : sur 8 795 textes, 8 792 portent un
 * lien et 8 615 un numéro de dépôt. Quand on connaît le numéro, on ne dépend
 * plus de la façon dont le titre est orthographié.
 */
export async function trouverTexte(f: FiltresTexte): Promise<Enveloppe<ResultatTexte[]>> {
  const limite = Math.min(f.limite ?? 10, LIMITE_MAX);
  const cle = cleCache('trouver_texte', { ...f, limite });

  const lignes = await lireOuCalculer(cle, TTL_COURT, async () => {
    const chambre =
      f.chambre === 'assemblee' ? 'Assemblée Nationale' : f.chambre === 'senat' ? 'Sénat' : null;
    const lues = await sql<LigneTexte[]>`
      select uid, num_notice, titre_principal_court, titre_principal, type_libelle, chambre, date_depot,
        libelle_statut_adoption, dossier_ref, url_accessible, lien_texte
      from textes
      where true
        ${f.numero ? sql`and num_notice = ${f.numero}` : sql``}
        ${f.dossier_uid ? sql`and dossier_ref = ${f.dossier_uid}` : sql``}
        ${chambre ? sql`and chambre = ${chambre}` : sql``}
        ${filtreMots('titre_principal', motsDe(f.mots))}
      order by date_depot desc nulls last, uid
      limit ${plafond(limite)}`;
    return lues as LigneTexte[];
  });

  const coupe = lignes.length > limite;
  const resultats: ResultatTexte[] = lignes.slice(0, limite).map((l) => ({
    uid: l.uid,
    numero: l.num_notice,
    titre: l.titre_principal_court ?? l.titre_principal,
    type: l.type_libelle,
    chambre: codeChambre(l.chambre),
    date_depot: l.date_depot,
    statut_adoption: l.libelle_statut_adoption,
    dossier_uid: l.dossier_ref,
    url_dossier: l.dossier_ref ? urlFr(`/dossiers-legislatifs/${l.dossier_ref}/resume-ia`) : null,
    url_dossier_en: l.dossier_ref ? urlEn(`/dossiers-legislatifs/${l.dossier_ref}/resume-ia`) : null,
    url_officielle: l.lien_texte,
    consultable_en_ligne: l.url_accessible ?? false,
  }));

  const tronque: Troncature | undefined = coupe ? troncature(limite) : undefined;
  return enveloppe('trouver_texte', resultats, [], tronque);
}


// ---------------------------------------------------------------------------
// votes_elu et detail_scrutin
// ---------------------------------------------------------------------------

const ARTICLES_VOTES = ['/Facts/participation', '/Facts/loyaute'];

/**
 * Les six seaux de `scrutins.votes_nominatifs`, chacun portant une liste d'uid.
 *
 * Aucun de ces noms ne ressort du serveur : `absents` devient `aucun_vote`, et
 * `institutionnels` devient `fonction_institutionnelle`, parce que le nom du
 * champ est ce qu'un modèle lit à chaque réponse. Sur une motion de censure, la
 * correspondance ne tient plus du tout : voir `positionDe`.
 */
type VotesNominatifs = Partial<Record<string, string[]>>;

type ScrutinRow = {
  uid: string;
  numero: number | null;
  date_scrutin: string | null;
  titre: string | null;
  objet_libelle: string | null;
  type_vote_libelle: string | null;
  type_vote_code: string | null;
  sort_libelle: string | null;
  chambre: string | null;
  synthese_pour: number | null;
  synthese_contre: number | null;
  synthese_abstentions: number | null;
  synthese_nombre_votants: number | null;
  votes_nominatifs: VotesNominatifs | null;
};

/** Colonnes lues d'un scrutin, dans cet ordre ; `sql(COLONNES_SCRUTIN)` les écrit en identifiants. */
const COLONNES_SCRUTIN = [
  'uid', 'numero', 'date_scrutin', 'titre', 'objet_libelle', 'type_vote_libelle', 'type_vote_code',
  'sort_libelle', 'chambre', 'synthese_pour', 'synthese_contre', 'synthese_abstentions',
  'synthese_nombre_votants', 'votes_nominatifs',
];

/**
 * Position d'un élu dans un scrutin, ou `aucun_vote` s'il n'apparaît dans aucun seau.
 *
 * Sur une motion de censure, l'article 49 de la Constitution ne fait recenser
 * que les voix favorables : le seau `absents` y contient les opposants, pas des
 * absents. Rendre `aucun_vote` pour eux produirait un contresens sur une
 * personne nommée, exactement ce que ce serveur existe pour éviter. La règle et
 * sa mesure sur les 23 scrutins concernés vivent dans `scrutin-affichage.ts`,
 * qui l'applique aux barres du site ; elle est reprise ici, pas réinventée.
 *
 * La présidence de séance fait exception et garde son code : sur les 23 motions,
 * les seaux `contre`, `abstentions` et `nonVotants` sont vides, mais
 * `institutionnels` porte 86 entrées. Ce statut-là, la chambre l'a bien
 * enregistré, et le noyer dans `non_recense` serait le contresens inverse.
 */
function positionDe(
  votes: VotesNominatifs | null,
  uid: string,
  typeVoteCode: string | null,
): CodePosition {
  if (!votes) return 'non_publie';
  if (typeVoteCode === TYPE_VOTE_MOTION_CENSURE) {
    if (votes.pour?.includes(uid)) return 'pour';
    if (votes.institutionnels?.includes(uid)) return 'fonction_institutionnelle';
    return 'non_recense';
  }
  for (const [seau, code] of Object.entries(SEAU_VERS_POSITION)) {
    if (votes[seau]?.includes(uid)) return code;
  }
  // Absent de tous les seaux : la chambre n'a rien enregistré à son nom sur ce
  // scrutin. Ce n'est pas une absence de l'hémicycle, et le code le dit.
  return 'aucun_vote';
}

export type VotesEluResultat = {
  /**
   * Qui est l'élu, et siège-t-il encore.
   *
   * Sans ce bloc, les votes d'un ancien parlementaire rendent `aucun_vote` sur
   * toute la liste, puisque les scrutins récents sont postérieurs à son mandat.
   * Lu tel quel, cela se conclut « il ne vote jamais », sur une personne réelle.
   * La période de mandat est donc rendue avec les votes.
   */
  elu: {
    uid: string;
    prenom: string | null;
    nom: string | null;
    en_exercice: boolean;
    mandat_debut: string | null;
    mandat_fin: string | null;
  };
  /** La chambre effectivement lue, y compris quand l'appelant ne l'a pas posée. */
  chambre: CodeChambre | null;
  votes: VoteElu[];
};

export type VoteElu = {
  scrutin_uid: string;
  numero: number | null;
  date: string | null;
  objet: string | null;
  type_vote: string | null;
  /**
   * Code du type de vote, `MOC` pour une motion de censure. Il accompagne la
   * position parce que `non_recense` ne se comprend qu'avec lui.
   */
  type_vote_code: string | null;
  chambre: CodeChambre | null;
  resultat: string | null;
  position: CodePosition;
};

/**
 * Les votes d'un parlementaire sur les scrutins que LoiClair suit.
 *
 * Le périmètre n'est pas « tous ses votes » : la couverture nominative est de
 * 100 % au Sénat et sur les scrutins solennels de l'Assemblée, mais de 199 sur
 * 8 339 scrutins publics ordinaires. Promettre davantage ferait conclure à un
 * assistant qu'un élu n'a pas voté là où le détail n'a simplement pas été publié.
 *
 * On lit les N derniers scrutins nominatifs plutôt que les 536 : chacun porte
 * une liste de près de six cents identifiants, et le coût d'une lecture complète
 * ne se justifie pas pour répondre « comment a-t-il voté récemment ». Pour un élu
 * en exercice lu dans sa chambre actuelle, ces scrutins commencent au début de son
 * mandat dans cette chambre.
 *
 * Rend `null` si l'uid est inconnu, comme les trois autres fiches.
 */
export async function votesElu(
  uid: string,
  limite: number,
  chambre?: CodeChambre,
): Promise<Enveloppe<VotesEluResultat> | null> {
  const n = Math.min(limite, LIMITE_MAX);
  const cle = cleCache('votes_elu', { uid, n, chambre });

  const resultat = await lireOuCalculer(cle, TTL_COURT, async () => {
    const a = await auPlusUneLigne(sql<{
      uid: string;
      prenom: string | null;
      nom: string | null;
      en_exercice: boolean | null;
      date_debut_mandat: string | null;
      date_fin_mandat: string | null;
      est_depute_actuel: boolean | null;
      est_senateur_actuel: boolean | null;
      periodes_mandat_assemblee: unknown;
    }[]>`
      select uid, prenom, nom, en_exercice, date_debut_mandat, date_fin_mandat,
        est_depute_actuel, est_senateur_actuel, periodes_mandat_assemblee
      from acteurs
      where uid = ${uid}`, 'acteurs');

    if (!a) return null;

    // Les scrutins nominatifs récents alternent les deux chambres : sans ce
    // repli, la moitié de la liste d'un député revient en `aucun_vote` sur des
    // scrutins du Sénat, où il ne pouvait pas voter. La chambre de l'élu est
    // donc le défaut, et l'appelant ne la pose que pour la forcer.
    const lue: CodeChambre | null =
      chambre ?? (a.est_depute_actuel ? 'assemblee' : a.est_senateur_actuel ? 'senat' : null);

    const chambreLue = lue === 'assemblee' ? 'Assemblée Nationale' : lue === 'senat' ? 'Sénat' : null;
    // Les votes du mandat en cours seulement, la règle de la fiche de l'élu : un député
    // élu sénateur le 1er octobre 2026 recevait sinon les scrutins du Sénat d'avant son
    // arrivée, tous en `aucun_vote` (9 élus au 2026-10-29). La fiche ne borne que l'élu
    // qui a changé de chambre ; borner tout élu en exercice revient au même, puisqu'il
    // ne figure sur aucun scrutin de sa chambre antérieur à son mandat. Les périodes de
    // `periodes_mandat_assemblee` sont celles de la chambre actuelle d'un élu en
    // exercice, ouvertes à la date de début de la fenêtre suivie. Pas de borne pour un
    // ancien élu, ni pour l'autre chambre forcée par l'appelant ; la chambre actuelle
    // forcée garde la sienne, pour qu'un paramètre égal au défaut ne change rien.
    const chambreActuelle: CodeChambre | null = a.est_depute_actuel
      ? 'assemblee'
      : a.est_senateur_actuel
        ? 'senat'
        : null;
    const debutMandat =
      lue && lue === chambreActuelle ? premierDebutPeriode(a.periodes_mandat_assemblee) : null;

    const scrutins = await sql<ScrutinRow[]>`
      select ${sql(COLONNES_SCRUTIN)}
      from scrutins
      where votes_nominatifs is not null
        ${chambreLue ? sql`and chambre = ${chambreLue}` : sql``}
        ${debutMandat ? sql`and date_scrutin >= ${debutMandat}` : sql``}
      order by date_scrutin desc nulls last, uid
      limit ${n}`;

    return {
      elu: {
        uid: a.uid,
        prenom: a.prenom,
        nom: a.nom,
        en_exercice: !!a.en_exercice,
        mandat_debut: a.date_debut_mandat,
        mandat_fin: a.date_fin_mandat,
      },
      chambre: lue,
      votes: scrutins.map((s) => ({
        scrutin_uid: s.uid,
        numero: s.numero,
        date: s.date_scrutin,
        objet: s.objet_libelle ?? s.titre,
        type_vote: s.type_vote_libelle,
        type_vote_code: s.type_vote_code,
        chambre: codeChambre(s.chambre),
        resultat: s.sort_libelle,
        position: positionDe(s.votes_nominatifs, uid, s.type_vote_code),
      })),
    };
  });

  if (!resultat) return null;
  return enveloppe('votes_elu', resultat, ARTICLES_VOTES);
}

export type DetailScrutin = {
  uid: string;
  numero: number | null;
  date: string | null;
  objet: string | null;
  type_vote: string | null;
  /** Code du type de vote, `MOC` pour une motion de censure. Voir `effectifs`. */
  type_vote_code: string | null;
  chambre: CodeChambre | null;
  resultat: string | null;
  synthese: {
    pour: number | null;
    contre: number | null;
    abstentions: number | null;
    votants: number | null;
  };
  /**
   * Le nombre d'élus par position, jamais la liste de leurs noms : un scrutin
   * en compte près de six cents, et une réponse qui les énumère sature le
   * contexte de l'appelant sans rien lui apprendre. Pour la position d'une
   * personne précise, c'est `votes_elu` qui répond.
   *
   * Sur une motion de censure, trois positions seulement : les voix favorables,
   * seules recensées par l'article 49, la présidence de séance, et le reste en
   * `non_recense`. Le total y compte les élus publiés dans les seaux, non les
   * 577 sièges sur lesquels le site dessine sa barre.
   */
  effectifs: Partial<Record<CodePosition, number>>;
  /**
   * Toujours vide sur une motion de censure : l'import n'y écrit aucune position
   * de groupe. Seules les voix favorables y sont recensées, et une position
   * calculée dès un votant y disait « pour » un groupe dont un seul membre sur
   * quarante-neuf avait voté la censure. Les non-inscrits n'y figurent jamais : ils
   * ne forment pas un groupe (D-313).
   */
  positions_groupes: {
    groupe: string | null;
    position: string;
    pour: number | null;
    contre: number | null;
    abstentions: number | null;
    membres: number | null;
  }[];
  detail_nominatif_publie: boolean;
  /** Adresse de la page du vote, `null` sans liste nominative (pas de page). */
  page_vote: string | null;
};

type PositionGroupeRow = {
  groupe_uid: string;
  position_majoritaire: string;
  nb_pour: number | null;
  nb_contre: number | null;
  nb_abstentions: number | null;
  nb_membres: number | null;
};

/** Détail d'un scrutin : sa synthèse, les positions de groupe, les effectifs par position. */
export async function detailScrutin(uid: string): Promise<Enveloppe<DetailScrutin> | null> {
  const detail = await lireOuCalculer(cleCache('detail_scrutin', { uid }), TTL_COURT, async () => {
    const [s, positions] = await Promise.all([
      auPlusUneLigne(sql<ScrutinRow[]>`
        select ${sql(COLONNES_SCRUTIN)} from scrutins where uid = ${uid}`, 'scrutins'),
      // `scrutins_groupes_positions` ne porte aucune clé étrangère vers
      // `organes`. Les libellés se résolvent en une seconde lecture, comme le
      // fait déjà `/api/scrutin-votes`. Sans tri : l'ordre des groupes rendu à
      // l'assistant est celui du stockage, non garanti. En fixer un (taille, uid) changerait la réponse, ce qui est
      // un choix produit et non une réécriture.
      sql<PositionGroupeRow[]>`
        select groupe_uid, position_majoritaire, nb_pour, nb_contre, nb_abstentions, nb_membres
        from scrutins_groupes_positions
        where scrutin_uid = ${uid}`,
    ]);

    if (!s) return null;

    const libelles = new Map<string, string>();
    if (positions.length > 0) {
      // Une panne ici lève : sans cela, tous les groupes passeraient à `null`,
      // et les positions seraient publiées sans dire de qui elles sont.
      const organes = await sql<{ uid: string; libelle: string | null }[]>`
        select uid, libelle from organes where uid = any(${positions.map((p) => p.groupe_uid)})`;
      for (const o of organes) {
        if (o.libelle) libelles.set(o.uid, o.libelle);
      }
    }

    const effectifs: Partial<Record<CodePosition, number>> = {};
    if (s.votes_nominatifs) {
      if (s.type_vote_code === TYPE_VOTE_MOTION_CENSURE) {
        // Seules les voix favorables sont recensées, la présidence de séance
        // mise à part : les autres seaux portent des élus dont la position
        // n'était pas enregistrable, et les ranger sous leur nom les dirait
        // absents ou opposants.
        //
        // Le total compte les noms que la chambre a publiés, et non l'effectif
        // légal : `scrutin-affichage.ts` dessine une barre sur les 577 sièges,
        // ce champ dit combien d'élus figurent dans chaque seau. Les deux
        // chiffres diffèrent donc de quelques unités sur un même scrutin, parce
        // qu'ils ne répondent pas à la même question. Seule la règle de position
        // est commune aux deux.
        const pour = s.votes_nominatifs.pour?.length ?? 0;
        const institutionnels = s.votes_nominatifs.institutionnels?.length ?? 0;
        const publies = Object.values(s.votes_nominatifs).reduce((n, l) => n + (l?.length ?? 0), 0);
        effectifs.pour = pour;
        if (institutionnels > 0) effectifs.fonction_institutionnelle = institutionnels;
        effectifs.non_recense = publies - pour - institutionnels;
      } else {
        for (const [seau, code] of Object.entries(SEAU_VERS_POSITION)) {
          const liste = s.votes_nominatifs[seau];
          if (liste) effectifs[code] = liste.length;
        }
      }
    }

    const donnees: DetailScrutin = {
      uid: s.uid,
      numero: s.numero,
      date: s.date_scrutin,
      objet: s.objet_libelle ?? s.titre,
      type_vote: s.type_vote_libelle,
      type_vote_code: s.type_vote_code,
      chambre: codeChambre(s.chambre),
      resultat: s.sort_libelle,
      synthese: {
        pour: s.synthese_pour,
        contre: s.synthese_contre,
        abstentions: s.synthese_abstentions,
        votants: s.synthese_nombre_votants,
      },
      effectifs,
      positions_groupes: positions.map((g) => ({
        groupe: libelles.get(g.groupe_uid) ?? null,
        position: g.position_majoritaire,
        pour: g.nb_pour,
        contre: g.nb_contre,
        abstentions: g.nb_abstentions,
        membres: g.nb_membres,
      })),
      detail_nominatif_publie: s.votes_nominatifs !== null,
      // Seuls les votes à liste nominative ont une page (`/Scrutins/[uid]`).
      page_vote: s.votes_nominatifs !== null ? buildShareUrl('fr', `/Scrutins/${s.uid}`) : null,
    };

    return donnees;
  });

  if (!detail) return null;
  return enveloppe('detail_scrutin', detail, ARTICLES_VOTES);
}
