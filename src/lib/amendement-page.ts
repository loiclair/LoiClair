// Lectures de la page d'un amendement adopté (`Amendements/[uid]/page.tsx`) et de ses deux
// tiroirs : sur la fiche du texte (`/api/amendements/[uid]`) et dans « Ce qui me concerne »
// (`/api/ce-qui-me-concerne/element`). Serveur uniquement : lit la base.
//
// `lireAmendement` passe par `cache` de React : `generateMetadata` et la page l'appellent
// toutes deux pendant le même rendu, et la base n'est lue qu'une fois.

import { cache } from 'react';
import { getTranslations } from 'next-intl/server';
import { auPlusUneLigne, sql } from '@/lib/db';
import { auteurDe } from '@/lib/auteur-amendement';
import { PROCEDURES_BUDGET, resumesAmendements, type AuteurElement } from '@/lib/ce-qui-me-concerne';
import { chargerVoteAmendement, type VoteAmendement } from '@/lib/scrutin-votes';
import { sansGuillemetsExterieurs } from '@/lib/passage-cite';
import { translateStatut } from '@/lib/statut';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { dateDuVote } from '@/lib/vote-page';

export type AmendementLigne = {
  uid: string;
  dossier_uid: string;
  chambre: 'AN' | 'SN';
  lieu: 'seance' | 'commission';
  numero: string;
  article: string | null;
  auteur_type: AuteurElement['type'] & ('parlementaire' | 'rapporteur' | 'commission' | 'gouvernement');
  auteur_uid: string | null;
  auteur_libelle: string | null;
  date_amendement: string | null;
  url: string;
  dispositif: string | null;
  expose: string | null;
  dossier_titre: string | null;
  dossier_titre_en: string | null;
  statut_final: string | null;
  date_promulgation: string | null;
  procedure_libelle: string | null;
  /** Parution au Journal officiel, la date que montre aussi le tiroir d'un article. */
  date_jo: string | null;
};

/** La ligne de l'amendement et de son dossier, ou `null` s'il n'existe pas. Une panne lève
 *  (`auPlusUneLigne`) : la régénération garde alors la page précédente au lieu de figer un
 *  404 (D-136). `uid` doit avoir passé `estUidAmendement`. */
export const lireAmendement = cache(async (uid: string): Promise<AmendementLigne | null> =>
  auPlusUneLigne(sql<AmendementLigne[]>`
    select a.uid, a.dossier_uid, a.chambre, a.lieu, a.numero, a.article, a.auteur_type, a.auteur_uid,
      a.auteur_libelle, a.date_amendement, a.url, a.dispositif, a.expose,
      d.titre as dossier_titre, d.titre_en as dossier_titre_en, d.statut_final, d.date_promulgation, d.procedure_libelle,
      (select min(l.date_publication) from textes l where l.dossier_ref = d.uid and l.uid like 'LOI%' and not (l.is_version_consolidee is true)) as date_jo
    from amendements a
    join dossiers_legislatifs d on d.uid = a.dossier_uid
    where a.uid = ${uid}`, 'amendements (page de l\'amendement)'));

/** Ce que veut dire « adopté » pour cet amendement, en clé de traduction. Adopté n'est pas
 *  « dans la loi » : une commission est suivie de la séance, une lecture des suivantes, et
 *  aucune table ne dit si l'amendement a survécu jusqu'au texte final. D'où des phrases
 *  qui décrivent la situation sans jamais affirmer qu'il figure dans la loi. */
export function porteeAdoption(a: Pick<AmendementLigne, 'lieu' | 'statut_final' | 'date_promulgation' | 'procedure_libelle'>) {
  const rejete = (a.statut_final ?? '').startsWith('Rejeté');
  const loi = !!a.date_promulgation || a.statut_final === 'Promulguée' || a.statut_final === 'Appliquée';
  if (a.lieu === 'commission') {
    if (rejete) return 'porteeCommissionRejete' as const;
    if (loi) return 'porteeCommissionLoi' as const;
    // Au budget, la séance repart du texte du Gouvernement (art. 42 de la Constitution).
    return PROCEDURES_BUDGET.has(a.procedure_libelle ?? '') ? 'porteeCommissionBudget' as const : 'porteeCommission' as const;
  }
  if (rejete) return 'porteeRejete' as const;
  return loi ? 'porteePromulgue' as const : 'porteeAutre' as const;
}

/** Ce que partagent la page et les tiroirs (`SectionsAmendement`). Sérialisable. */
export type DetailAmendement = {
  uid: string;
  dossier_uid: string;
  /** Le titre affiché du texte, dans la langue demandée, et s'il est traduit par l'IA. */
  titre_texte: string;
  titre_traduit: boolean;
  /** Titre officiel et statut du texte, pour le courriel aux élus des tiroirs. */
  dossier_titre: string | null;
  statut_final: string | null;
  /** L'état du texte, déjà traduit, pour l'en-tête : un amendement adopté peut appartenir
   *  à un texte rejeté. `null` quand le texte n'a pas de statut. */
  etat_texte: { statut: string; libelle: string; date: string | null } | null;
  chambre: 'AN' | 'SN';
  lieu: 'seance' | 'commission';
  numero: string;
  article: string | null;
  url: string;
  dispositif: string | null;
  expose: string | null;
  portee: ReturnType<typeof porteeAdoption>;
  /** Résumé de l'IA dans la langue demandée, pour les quelque 10 % classés. */
  resume: string | null;
  auteur: AuteurElement;
  vote: VoteAmendement | null;
  /** Les profils que l'amendement touche, regroupés par passage cité (plusieurs profils
   *  citent souvent le même). Noms déjà traduits : ils partent seuls au navigateur, plutôt
   *  que le catalogue de « Ce qui me concerne » dans chaque page en cache. Un amendement n'a
   *  pas de phrase par profil, seulement son résumé commun et ces passages. */
  profils: { noms: string[]; passage: string | null }[];
  /** Date déjà écrite dans la langue : la formater ici évite tout écart serveur-navigateur. */
  debats: { seance_uid: string; date: string | null; nb: number }[];
  autres: { liste: AutreAmendement[]; total: number };
};

/** Un groupe par passage distinct, dans l'ordre des profils. Sans passage retrouvé dans le
 *  texte, le profil reste nommé, sans citation. */
function parPassage(lignes: { nom: string; passage: string | null }[]): DetailAmendement['profils'] {
  const groupes = new Map<string, DetailAmendement['profils'][number]>();
  for (const { nom, passage } of lignes) {
    const texte = passage ? sansGuillemetsExterieurs(passage) : '';
    const groupe = groupes.get(texte);
    if (groupe) groupe.noms.push(nom);
    else groupes.set(texte, { noms: [nom], passage: texte || null });
  }
  return [...groupes.values()];
}

/** Résumé, auteur, vote, débats et voisins d'un amendement, ajoutés à sa ligne. Une panne lève. */
export async function chargerDetailAmendement(a: AmendementLigne, locale: string): Promise<DetailAmendement> {
  const [resumes, auteur, vote, debats, autres, lignesProfils, tConcerne, tDossiers] = await Promise.all([
    resumesAmendements('element_id', [a.uid], locale === 'en'),
    auteurDe(a),
    chargerVoteAmendement(a.uid),
    lireDebatsAmendement(a),
    lireAutresAmendements(a),
    sql<{ profil: string; passage: string | null }[]>`
      select profil, passage from impacts_courants
      where element_type = 'amendement' and element_id = ${a.uid}
      order by profil`,
    getTranslations({ locale, namespace: 'ceQuiMeConcerne' }),
    getTranslations({ locale, namespace: 'dossiers' }),
  ]);
  const statutTexte = translateStatut(a.statut_final, tDossiers);
  const datePublication = a.date_promulgation ? dateDuVote(locale, a.date_jo ?? a.date_promulgation) : null;
  return {
    uid: a.uid,
    dossier_uid: a.dossier_uid,
    titre_texte: titreDossier({ titre: a.dossier_titre, titre_en: a.dossier_titre_en }, locale),
    titre_traduit: titreTraduit({ titre: a.dossier_titre, titre_en: a.dossier_titre_en }, locale),
    dossier_titre: a.dossier_titre,
    statut_final: a.statut_final,
    etat_texte: a.statut_final && statutTexte ? { statut: a.statut_final, libelle: statutTexte, date: datePublication } : null,
    chambre: a.chambre,
    lieu: a.lieu,
    numero: a.numero,
    article: a.article,
    url: a.url,
    dispositif: a.dispositif,
    expose: a.expose,
    portee: porteeAdoption(a),
    resume: resumes.get(a.uid) ?? null,
    auteur,
    vote,
    profils: parPassage(lignesProfils.map((l) => ({ nom: tConcerne(`profils.${l.profil}`), passage: l.passage }))),
    debats: debats.map((d) => ({ seance_uid: d.seance_uid, date: d.date_seance ? dateDuVote(locale, d.date_seance) : null, nb: d.nb })),
    autres,
  };
}

/** Lignes livrées avec la page dans « Autres amendements adoptés sur cet article » : un
 *  article de budget en compte des centaines, et chaque lien pèse dans la page en cache.
 *  Le reste se charge au clic (`/api/amendements/[uid]/autres`). */
const AUTRES_PREMIERS = 10;
/** Borne de la liste complète, au-delà du plus gros article (1 027 voisins, mesuré le
 *  2026-11-09) : une route publique ne lit pas sans limite. */
export const AUTRES_TOUS = 5000;

export type AutreAmendement = { uid: string; numero: string; lieu: 'seance' | 'commission'; chambre: 'AN' | 'SN' };

/** Les autres adoptés du même article du même dossier, dans la même chambre, et leur
 *  nombre total. La chambre compte : le Sénat renumérote les articles, et son « Art. 2 »
 *  peut viser un autre article que celui de l'Assemblée. Séance d'abord, puis du plus
 *  récent au plus ancien, l'uid départageant. */
export async function lireAutresAmendements(a: AmendementLigne, limite = AUTRES_PREMIERS): Promise<{ liste: AutreAmendement[]; total: number }> {
  if (!a.article) return { liste: [], total: 0 };
  const lignes = await sql<(AutreAmendement & { total: number })[]>`
    select uid, numero, lieu, chambre, count(*) over ()::int as total
    from amendements
    where dossier_uid = ${a.dossier_uid} and article = ${a.article} and chambre = ${a.chambre} and uid <> ${a.uid}
    order by lieu desc, date_amendement desc nulls last, uid
    limit ${limite}`;
  return {
    liste: lignes.map(({ uid, numero, lieu, chambre }) => ({ uid, numero, lieu, chambre })),
    total: lignes[0]?.total ?? 0,
  };
}

export type DebatAmendement = { seance_uid: string; date_seance: string | null; nb: number };

/** Les séances où cet amendement a été discuté, et le nombre d'interventions de chacune.
 *  Assemblée seulement : le compte rendu du Sénat ne rattache pas une prise de parole à un
 *  amendement (`debat_interventions.amendement` y est toujours vide). La colonne porte le
 *  numéro sans préfixe, parfois plusieurs (« 1, 46, 47 et 48 »), d'où le motif à bornes.
 *  Sans préfixe, un numéro revient d'une lecture à l'autre (le I-71 et le II-71 d'un budget,
 *  deux n° 12 en première et en nouvelle lecture) : seules comptent les séances à un jour
 *  au plus de l'adoption. Mesuré le 2026-11-09 : 3 559 liens gardés, 433 écartés, tous
 *  vers une séance éloignée d'au moins deux jours. */
export async function lireDebatsAmendement(a: AmendementLigne): Promise<DebatAmendement[]> {
  const numero = a.numero.split('-').pop() ?? '';
  if (a.chambre !== 'AN' || a.lieu !== 'seance' || !/^\d+$/.test(numero)) return [];
  return sql<DebatAmendement[]>`
    select i.seance_uid, s.date_seance, count(*)::int as nb
    from debat_interventions i
    join debat_seances s on s.uid = i.seance_uid
    where i.dossier_uid = ${a.dossier_uid} and i.seance_uid like 'AN:%'
      and i.amendement ~ ${`(^|[^0-9])${numero}([^0-9]|$)`}
      and (${a.date_amendement}::date is null or s.date_seance::date between ${a.date_amendement}::date - 1 and ${a.date_amendement}::date + 1)
    group by i.seance_uid, s.date_seance
    order by s.date_seance, i.seance_uid`;
}
