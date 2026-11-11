// Lectures et règles d'un vote partagées par sa page (`Scrutins/[uid]/page.tsx`) et son
// image de partage (`api/og/scrutin`), pour que les deux disent la même chose : la ligne du
// scrutin, l'acte de décision qui le cite, la chambre, le statut et le nom de l'étape. La
// frise du parcours (`lireParcours`, `friseDuVote`) ne sert qu'à la page.
// Serveur uniquement : lit la base.
//
// `lireScrutin` et `lireActe` passent par `cache` de React : `generateMetadata` et la page
// les appellent toutes deux pendant le même rendu, et la base n'est lue qu'une fois.

import { cache } from 'react';
import { auPlusUneLigne, sql } from '@/lib/db';
import { PARCOURS_ACTE_CODES, STEP_CONFIG, milestoneOf, parcoursDuDossier, type EtapeDuParcours } from '@/lib/legislative-steps';
import { deriveChambreKey, statutDuVote } from '@/lib/scrutin-affichage';
import { formateurDate } from '@/lib/jour-paris';
import { seanceVersSlug } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/debats/seance-slug';

export type ScrutinLigne = {
  uid: string;
  titre: string | null;
  titre_en: string | null;
  sort_libelle: string | null;
  type_vote_libelle: string | null;
  type_vote_code: string | null;
  sort_code: string | null;
  synthese_pour: number | null;
  synthese_contre: number | null;
  synthese_abstentions: number | null;
  synthese_nombre_votants: number | null;
  synthese_non_votants: number | null;
  synthese_suffrages_requis: number | null;
  date_scrutin: string | null;
  chambre: string | null;
  a_liste: boolean;
};

/** La ligne du scrutin, ou `null` s'il n'existe pas ou n'a pas de liste nominative.
 *  Une panne lève (`auPlusUneLigne`) : la régénération de la page garde alors la version
 *  précédente au lieu de figer un 404 (D-136). */
export const lireScrutin = cache(async (uid: string): Promise<ScrutinLigne | null> => {
  const s = await auPlusUneLigne(sql<ScrutinLigne[]>`
    select uid, titre, titre_en, sort_libelle, type_vote_libelle, type_vote_code, sort_code, synthese_pour, synthese_contre,
      synthese_abstentions, synthese_nombre_votants, synthese_non_votants, synthese_suffrages_requis, date_scrutin,
      chambre, votes_nominatifs is not null as a_liste
    from scrutins
    where uid = ${uid}`, 'scrutins (page du vote)');
  return s?.a_liste ? s : null;
});

export type ActeLigne = {
  uid: string;
  code_acte: string;
  date_acte: string | null;
  statut_conclusion: string | null;
  dossier_uid: string | null;
  dossier_titre: string | null;
  dossier_titre_en: string | null;
};

/** L'acte de décision qui cite ce vote, et son dossier. Les actes parents d'une lecture
 *  (`AN1`, `AN1-DEBATS`) citent aussi le vote, sans date : seul compte l'acte que
 *  `milestoneOf` rattache à une étape, comme sur la fiche du texte. S'il y en a plusieurs,
 *  le plus récent, l'uid départageant. Sans acte de décision, le dossier d'un autre acte
 *  qui cite le vote sert encore au lien « Voir le texte ». */
export const lireActe = cache(async (uid: string): Promise<{ decision: ActeLigne | null; dossier: ActeLigne | null }> => {
  const actes = await sql<ActeLigne[]>`
    select a.uid, a.code_acte, a.date_acte, a.statut_conclusion, a.dossier_uid,
      d.titre as dossier_titre, d.titre_en as dossier_titre_en
    from actes_legislatifs a
    left join dossiers_legislatifs d on d.uid = a.dossier_uid
    where ${uid} = any(a.vote_refs)
    order by a.date_acte desc nulls last, a.uid desc`;
  const decision = actes.find((a) => a.date_acte && milestoneOf(a.code_acte)) ?? null;
  const dossier = decision?.dossier_uid ? decision : actes.find((a) => a.dossier_uid) ?? null;
  return { decision, dossier };
});

/**
 * Où lire les débats d'un vote, en chemin de page : la séance du même dossier, du même jour
 * et de la même chambre, ou l'index des débats du dossier quand ce jour en compte plusieurs,
 * rien ne disant laquelle a porté le vote (`scrutins.seance_ref` n'a pas la forme des uid de
 * séance et manque au Sénat). `null` sans séance ce jour-là. Mesuré le 2026-11-08 sur 559
 * votes : 460 avec une séance, 58 avec plusieurs, 41 sans.
 */
export async function cheminDebats(dossierUid: string, uid: string, dateScrutin: string | null): Promise<string | null> {
  if (!dateScrutin) return null;
  const chambre = uid.startsWith('VTSN') ? 'SEN' : 'AN';
  const seances = await sql<{ seance_uid: string }[]>`
    select seance_uid from dossiers_seances_stats
    where dossier_uid = ${dossierUid} and chambre = ${chambre} and date_seance::date = ${dateScrutin}::date
    order by seance_uid`;
  if (seances.length === 0) return null;
  return seances.length === 1
    ? `/dossiers-legislatifs/${dossierUid}/debats/${seanceVersSlug(seances[0].seance_uid)}`
    : `/dossiers-legislatifs/${dossierUid}/debats`;
}

/** La chambre du vote, son statut et son étape. La chambre est celle de l'acte de décision
 *  quand il y en a un (un vote sur les conclusions d'une CMP appartient à la chambre qui
 *  vote), sinon celle que dit l'uid. Une motion de censure sans acte reçoit quand même
 *  l'étape `MOTION`, comme sur la frise. */
export function contexteDuVote(uid: string, s: ScrutinLigne, decision: ActeLigne | null) {
  const chambreKey = (decision && deriveChambreKey(decision.code_acte)) || (uid.startsWith('VTSN') ? 'SEN' : 'AN');
  const statut = statutDuVote(s.titre, s.sort_libelle, decision?.statut_conclusion ?? null, !!decision);
  const milestone = decision ? milestoneOf(decision.code_acte) : s.type_vote_code === 'MOC' ? 'MOTION' : null;
  return { chambreKey, statut, milestone };
}

/** Le parcours du dossier d'un vote, calculé comme sur la fiche du texte : mêmes actes, même
 *  filtre, même date de Journal officiel. Sans le baromètre d'application, qui ne décide que
 *  des décrets et de l'application, que la frise n'affiche pas (`friseDuVote`). */
export async function lireParcours(dossierUid: string): Promise<EtapeDuParcours[]> {
  const [dossier, actes, textes] = await Promise.all([
    auPlusUneLigne(sql<{ date_depot: string | null; date_promulgation: string | null; statut_final: string | null; procedure_libelle: string | null }[]>`
      select date_depot, date_promulgation, statut_final, procedure_libelle
      from dossiers_legislatifs
      where uid = ${dossierUid}`, 'dossiers_legislatifs (parcours du vote)'),
    sql<{ code_acte: string; date_acte: string | null; parent_uid: string | null; textes_associes: string[] | null }[]>`
      select code_acte, date_acte, parent_uid, textes_associes
      from actes_legislatifs
      where dossier_uid = ${dossierUid}
        and (code_acte = any(${PARCOURS_ACTE_CODES}) or vote_refs is not null or textes_associes is not null
          or texte_adopte is not null)
      order by date_acte asc nulls last, uid`,
    sql<{ uid: string; date_publication: string | null }[]>`
      select uid, date_publication from textes
      where dossier_ref = ${dossierUid} and not (uid ilike '%TAP%')
      order by uid`,
  ]);
  return dossier ? parcoursDuDossier(actes, dossier, textes, null).etapes : [];
}

/** Les étapes de la frise d'un vote, du dépôt à la promulgation, ou `null` si l'étape du vote
 *  est absente du parcours (masquée par D-102, ou vote sans étape). */
export function friseDuVote(etapes: readonly EtapeDuParcours[], milestone: string | null): EtapeDuParcours[] | null {
  const frise = etapes.filter((e) => e.code !== 'DECAPP' && e.code !== 'AN-APPLI');
  return frise.some((e) => e.code === milestone) ? frise : null;
}

type Traducteur = (cle: string) => string;

/** Nom d'une étape, comme sur la frise de la fiche du texte (`steps`) ; un vote en CMP
 *  précise la chambre, comme la carte qui en réunit deux (`resumeIA`). `null` pour un
 *  code qui n'est pas une étape. */
export function nomEtape(milestone: string | null, chambre: string | null, tSteps: Traducteur, tResume: Traducteur): string | null {
  if (!milestone || !STEP_CONFIG[milestone]) return null;
  return [
    tSteps(STEP_CONFIG[milestone].labelKey),
    milestone === 'CMP' && chambre === 'AN' ? tResume('decisionLabelVoteAN')
      : milestone === 'CMP' && chambre === 'SEN' ? tResume('decisionLabelVoteSenat') : null,
  ].filter(Boolean).join(' · ');
}

/** Date longue d'un vote, à l'heure de Paris. */
export function dateDuVote(locale: string, d: string): string {
  return formateurDate(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(d));
}
