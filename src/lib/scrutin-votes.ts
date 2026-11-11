// Détail nominatif d'un scrutin : position majoritaire de chaque groupe, puis vote de
// chaque élu. Lu par la route `/api/scrutin-votes` (le tiroir de la fiche d'un texte, qui
// le charge à l'ouverture), par la page d'un vote, `/Scrutins/[uid]`, qui le rend côté
// serveur pour que la liste des noms soit lisible sans JavaScript, et, depuis la table à
// part `votes_amendements`, par la page d'un amendement (`chargerVoteAmendement`).
//
// Voir D-308 : au Sénat, tout sénateur ayant siégé depuis le 2 octobre 2023 est nommé, en
// fonction ou non ; avant cette date, la liste reste partielle. La réponse n'essaie pas de
// combler les trous, le tiroir et la page les annoncent. Chaque nom est rangé sous le
// groupe que l'élu avait le jour du vote (D-278), jamais sous son groupe actuel : celui que
// l'import du scrutin a écrit dans `scrutins.groupes_votants`, le même que le décompte du
// groupe pour chaque votant. Seuls les absents de l'Assemblée, que la source ne cite pas, y
// reçoivent le groupe de l'historique de l'AMO au jour du vote.
//
// Ce module ne s'importe que côté serveur (il lit la base) ; les types, eux, servent
// aussi aux composants clients, par `import type`.

import { sql } from '@/lib/db';
import { rangsHemicycle } from '@/lib/groupes-ordre';

type PositionRow = {
  groupe_uid: string;
  position_majoritaire: 'pour' | 'contre' | 'abstention';
  nb_pour: number | null;
  nb_contre: number | null;
  nb_abstentions: number | null;
  nb_membres: number | null;
};

type OrganeRow = {
  uid: string;
  libelle: string | null;
  libelle_abrege: string | null;
  couleur_associee: string | null;
};

type ActeurRow = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  url_profil_officiel: string | null;
  departement_election: string | null;
  num_circo: string | null;
};

/** Un groupe parlementaire et sa position sur ce scrutin.
 *  Les compteurs valent `null` quand la base n'a pas de position officielle pour ce
 *  groupe : le groupe n'apparaît alors que comme regroupement de la liste nominative. */
export type VoteGroupe = {
  uid: string;
  libelle: string | null;
  libelleAbrege: string | null;
  couleur: string | null;
  position: 'pour' | 'contre' | 'abstention' | null;
  nbPour: number | null;
  nbContre: number | null;
  nbAbstentions: number | null;
  nbMembres: number | null;
};

/** `position` reprend telle quelle la clé de `scrutins.votes_nominatifs` :
 *  pour | contre | abstentions | nonVotants | institutionnels | absents. */
export type VoteElu = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  groupeUid: string | null;
  position: string;
  /** Fiche officielle : `photoElu` en tire le portrait des sénateurs. */
  urlProfil: string | null;
  /** Département d'élection, et circonscription pour un député (null au Sénat). Ceux
   *  d'aujourd'hui, comme la photo : la table ne garde pas ceux du jour du vote. */
  departement: string | null;
  circo: string | null;
};

export type ScrutinVotesResponse = {
  groupes: VoteGroupe[];
  elus: VoteElu[];
};

/**
 * Les votes d'un scrutin, groupes et élus, ou `null` quand le scrutin est absent ou n'a
 * pas de liste nominative (la plupart des votes d'amendement de l'Assemblée). Une panne
 * de base lève : l'appelant distingue ainsi un vrai « introuvable » d'une panne, la route
 * pour rendre 503, la page pour ne pas figer un 404 (D-136).
 *
 * L'uid doit avoir été validé par `estUidScrutin` : la fonction ne le revérifie pas.
 */
export async function chargerVotesScrutin(uid: string): Promise<ScrutinVotesResponse | null> {
  type ScrutinRow = {
    votes_nominatifs: Record<string, string[]> | null;
    groupes_votants: Record<string, string | null> | null;
  };
  // Les positions sont rangées par groupe dans une table : leur ordre ne compte pas,
  // le tri par uid ne fait que le fixer.
  const [scrutinRows, positions] = await Promise.all([
    sql<ScrutinRow[]>`select votes_nominatifs, groupes_votants from scrutins where uid = ${uid} limit 1`,
    sql<PositionRow[]>`
      select groupe_uid, position_majoritaire, nb_pour, nb_contre, nb_abstentions, nb_membres
      from scrutins_groupes_positions
      where scrutin_uid = ${uid}
      order by groupe_uid`,
  ]);

  const votesNominatifs = scrutinRows[0]?.votes_nominatifs ?? null;
  if (!votesNominatifs) return null;

  return construireVotes(votesNominatifs, scrutinRows[0]?.groupes_votants ?? {}, positions, uid.startsWith('VTSN') ? 'SEN' : 'AN');
}

/** Un vote sur un amendement adopté, tel que `votes_amendements` le garde : ses chiffres
 *  officiels, et le détail des noms au format de `chargerVotesScrutin`. */
export type VoteAmendement = {
  uid: string;
  chambre: 'AN' | 'SN';
  date_scrutin: string | null;
  titre: string | null;
  pour: number;
  contre: number;
  abstentions: number;
  votants: number;
  non_votants: number;
  suffrages_requis: number;
  votes: ScrutinVotesResponse;
};

/** Ceux des amendements donnés qu'un vote public tranche, pour le dire dans les listes
 *  avant toute ouverture. Le filtre `&&` passe par l'index GIN de `amendement_uids`. */
export async function amendementsAvecVote(uids: string[]): Promise<Set<string>> {
  if (uids.length === 0) return new Set();
  const lignes = await sql<{ uid: string }[]>`
    select distinct u as uid
    from votes_amendements v, unnest(v.amendement_uids) u
    where v.amendement_uids && ${uids}::text[] and u = any(${uids})`;
  return new Set(lignes.map((l) => l.uid));
}

/**
 * Le vote par scrutin public qui a adopté cet amendement, ou `null` quand aucun n'a pu lui
 * être relié (`_votes_amendements.py`), le cas général : main levée ou commission. Une panne
 * lève, comme `chargerVotesScrutin`.
 *
 * Un amendement n'a presque toujours qu'un vote ; une seconde délibération peut lui en
 * donner deux, et seul le dernier a décidé, d'où le tri et le `limit` : on veut cette ligne.
 */
export async function chargerVoteAmendement(amendementUid: string): Promise<VoteAmendement | null> {
  type Ligne = Omit<VoteAmendement, 'votes'> & {
    votes_nominatifs: Record<string, string[]> | null;
    groupes_votants: Record<string, string | null> | null;
    positions_groupes: PositionRow[] | null;
  };
  const lignes = await sql<Ligne[]>`
    select uid, chambre, date_scrutin, titre, pour, contre, abstentions, votants, non_votants,
      suffrages_requis, votes_nominatifs, groupes_votants, positions_groupes
    from votes_amendements
    where ${amendementUid} = any(amendement_uids)
    order by date_scrutin desc nulls last, uid desc
    limit 1`;
  const v = lignes[0];
  if (!v?.votes_nominatifs) return null;
  const { votes_nominatifs, groupes_votants, positions_groupes, ...chiffres } = v;
  return {
    ...chiffres,
    votes: await construireVotes(votes_nominatifs, groupes_votants ?? {}, positions_groupes ?? [], v.chambre === 'SN' ? 'SEN' : 'AN'),
  };
}

/** Assemble groupes et élus à partir des trois colonnes d'un vote (`scrutins` ou
 *  `votes_amendements`) : les noms, les libellés de groupe et leur ordre dans l'hémicycle. */
async function construireVotes(
  votesNominatifs: Record<string, string[]>,
  groupesVotants: Record<string, string | null>,
  positions: readonly PositionRow[],
  chambre: 'AN' | 'SEN',
): Promise<ScrutinVotesResponse> {
  // Aplatir le JSONB {pour: [uid…], contre: [uid…], …} en une position par acteur.
  const positionByActeur = new Map<string, string>();
  for (const [position, uids] of Object.entries(votesNominatifs)) {
    for (const acteurUid of uids ?? []) positionByActeur.set(acteurUid, position);
  }

  // Noms des élus du scrutin, en une lecture. Triés par uid : le tri par nom plus bas
  // est stable, et deux homonymes (les trois Bonnet de l'Assemblée) gardent ainsi
  // toujours le même ordre. L'ancienne lecture par lots ne triait pas, et leur ordre
  // suivait celui des lignes sur le disque.
  const acteurs = await sql<ActeurRow[]>`
    select uid, prenom, nom, url_profil_officiel, departement_election, num_circo
    from acteurs where uid = any(${[...positionByActeur.keys()]}) order by uid`;

  const elus: VoteElu[] = acteurs
    .map((a) => ({
      uid: a.uid,
      prenom: a.prenom,
      nom: a.nom,
      // Le groupe du jour écrit par l'import, pas `acteurs.groupe` (D-278) : avec le groupe
      // actuel, un député élu sénateur depuis s'affichait sous un groupe du Sénat dans un
      // vote de l'Assemblée. Ni l'historique de l'AMO : il publie parfois un groupe avec
      // quelques jours de retard, et l'élu sortait du groupe sous lequel le scrutin le
      // décompte. Aucun repli : un nom sans groupe va dans « groupe non renseigné ».
      groupeUid: groupesVotants[a.uid] ?? null,
      position: positionByActeur.get(a.uid)!,
      urlProfil: a.url_profil_officiel,
      departement: a.departement_election,
      circo: a.num_circo,
    }))
    .sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? '', 'fr'));

  // Un groupe entre dans la liste s'il a une position officielle, ou s'il regroupe au
  // moins un nom. Le second cas couvre les scrutins sans ligne dans
  // `scrutins_groupes_positions` : on peut quand même ranger les élus par groupe.
  const groupeUids = new Set<string>([
    ...positions.map((p) => p.groupe_uid),
    ...elus.map((e) => e.groupeUid).filter((g): g is string => !!g),
  ]);

  const organes = await sql<OrganeRow[]>`
    select uid, libelle, libelle_abrege, couleur_associee from organes where uid = any(${[...groupeUids]})`;
  const organeByUid = new Map(organes.map((o) => [o.uid, o]));
  const positionByGroupe = new Map(positions.map((p) => [p.groupe_uid, p]));

  const nbNomsParGroupe = new Map<string, number>();
  for (const e of elus) {
    if (e.groupeUid) nbNomsParGroupe.set(e.groupeUid, (nbNomsParGroupe.get(e.groupeUid) ?? 0) + 1);
  }

  const groupesNonTries: VoteGroupe[] = [...groupeUids]
    .map((groupeUid) => {
      const o = organeByUid.get(groupeUid);
      const p = positionByGroupe.get(groupeUid);
      return {
        uid: groupeUid,
        libelle: o?.libelle ?? null,
        libelleAbrege: o?.libelle_abrege ?? null,
        couleur: o?.couleur_associee ?? null,
        // La position vient de la base, sans recalcul : le pipeline la déduit lui-même du
        // décompte de voix (voir D-269), et un groupe dont personne n'a voté, ou à égalité,
        // n'y a pas de ligne du tout, pas plus que les non-inscrits (D-313) ni aucun groupe
        // sur une motion de censure.
        // Recalculer ici rouvrirait une seconde source de vérité.
        position: p?.position_majoritaire ?? null,
        nbPour: p?.nb_pour ?? null,
        nbContre: p?.nb_contre ?? null,
        nbAbstentions: p?.nb_abstentions ?? null,
        nbMembres: p?.nb_membres ?? null,
      };
    });

  // De gauche à droite, dans l'ordre où les groupes siègent (`rangsHemicycle`) : on
  // empile une barre par groupe, et cet ordre fait lire les votes comme l'hémicycle.
  // Un groupe sans siège se range par taille, sur le nombre de noms rattachés, seule
  // grandeur connue de tous les groupes : `nb_membres` (effectif du groupe sur le
  // scrutin, dans les deux chambres) manque à ceux qui n'ont pas de ligne de position, et
  // ne sert qu'au groupe sans aucun nom. L'uid départage en dernier.
  const rangs = await rangsHemicycle(chambre, groupesNonTries);
  const groupes = groupesNonTries.sort((a, b) =>
    rangs.get(a.uid)! - rangs.get(b.uid)!
    || (nbNomsParGroupe.get(b.uid) ?? b.nbMembres ?? 0) - (nbNomsParGroupe.get(a.uid) ?? a.nbMembres ?? 0)
    || a.uid.localeCompare(b.uid));

  return { groupes, elus };
}
