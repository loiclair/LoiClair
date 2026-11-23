// Lectures en base de la page d'accueil (`app/[locale]/(landing)`), rendue statique et
// recalculée chaque nuit par `/api/revalidate` : « Les lois dans l'actualité »
// (`ActualiteLois.tsx`) et le lien de la section des votes (`SectionsBenefices.tsx`). Le
// taux de promulgation de la section des chiffres, lui, vient de `getTauxPromulgation`
// (`facts-queries.ts`), le helper de son article (D-014).

import { sql } from '@/lib/db';
import { ACTES_MARQUANTS } from '@/lib/actes-marquants';
import type { DrapeauxMandat } from '@/lib/ancien-elu';
import { aujourdhuiAParisIso } from '@/lib/jour-paris';

/** Fenêtre de « Les lois dans l'actualité », en jours, aujourd'hui compris. */
export const JOURS_ACTUALITE = 30;

/** L'élu à l'initiative d'un texte, de quoi le nommer, le montrer et dire s'il siège encore. */
export type InitiateurActualite = DrapeauxMandat & {
  uid: string;
  prenom: string | null;
  nom: string | null;
  url_profil_officiel: string | null;
  groupe: { libelle: string | null } | null;
};

/** Un texte de « Les lois dans l'actualité ». */
export type LoiActualite = {
  uid: string;
  titre: string | null;
  titre_en: string | null;
  statut_final: string | null;
  /** La plus récente des étapes marquantes (`ACTES_MARQUANTS`) de la fenêtre : son code
   *  et sa date, `2026-11-19T00:00:00`. C'est le « dernier événement » de la carte. */
  derniere_etape_code: string;
  derniere_etape: string;
  /** Lus par `initiateurAffiche` (`lib/origine-gouvernementale.ts`), qui dit si le texte
   *  vient du Gouvernement et quel groupe afficher. */
  initiateur_groupe_libelle: string | null;
  textes_associes_refs: string[] | null;
  initiateur_acteur_ref: InitiateurActualite | null;
  /** Quand cette dernière étape est un vote qui a une liste nominative : le scrutin
   *  qu'elle cite (le plus récent, s'il y en a plusieurs), de quoi dire son résultat. La
   *  carte en dessine l'hémicycle (`chargerVotesScrutin`). `null` sinon : vote à main
   *  levée, dépôt, promulgation… */
  dernier_vote: {
    uid: string;
    titre: string | null;
    sort_libelle: string | null;
    pour: number | null;
    contre: number | null;
    abstentions: number | null;
  } | null;
};

/**
 * Les `limite` textes qui ont franchi le plus d'étapes marquantes ces trente derniers
 * jours, hors dossiers `hors_liste` : la règle est neutre (elle ne regarde ni le sujet,
 * ni l'auteur, ni la presse) et se dit en une phrase sous le titre de la section. Ex æquo
 * départagés par l'étape la plus récente, puis par `uid` pour un ordre qui ne varie jamais
 * d'un rendu à l'autre ; deux étapes du même jour dans un texte, par leur `uid`, pour dire
 * laquelle est la dernière. Une seule requête, l'auteur et le dernier vote joints en jsonb
 * (les votes élu par élu, plus lourds, sont lus à part pour les seuls textes qui en ont,
 * par `chargerVotesScrutin`). Peut rendre moins
 * de `limite` textes, ou aucun : la section s'adapte (`ActualiteLois`).
 */
export async function getLoisDansLActualite(limite = 10): Promise<LoiActualite[]> {
  // Le jour de Paris, pas `current_date` : celui-ci suit le fuseau de la session
  // Postgres, et la page se régénère à la première visite après `/api/revalidate`, à
  // n'importe quelle heure. Même règle que `actualite_parlementaire` (`lib/mcp/chiffres.ts`).
  const jour = aujourdhuiAParisIso();
  return sql<LoiActualite[]>`
    with etapes as (
      select a.dossier_uid, count(*)::int as nb_etapes, max(a.date_acte) as derniere_etape,
        (array_agg(a.code_acte order by a.date_acte desc, a.uid desc))[1] as derniere_etape_code,
        (array_agg(a.uid order by a.date_acte desc, a.uid desc))[1] as derniere_etape_uid
      from actes_legislatifs a
      join dossiers_legislatifs d on d.uid = a.dossier_uid and d.hors_liste = false
      where a.code_acte = any(${ACTES_MARQUANTS})
        and a.date_acte >= ${jour}::date - ${JOURS_ACTUALITE - 1}::int
        and a.date_acte < ${jour}::date + 1
      group by a.dossier_uid
      order by nb_etapes desc, derniere_etape desc, a.dossier_uid
      limit ${limite}
    )
    select d.uid, d.titre, d.titre_en, d.statut_final, e.derniere_etape_code, e.derniere_etape,
      d.initiateur_groupe_libelle, d.textes_associes_refs,
      -- Les drapeaux de mandat sont ceux de COLONNES_MANDAT (lib/ancien-elu.ts), nommés
      -- un à un pour tenir dans le jsonb : s'il en gagne un, il s'ajoute ici.
      (select jsonb_build_object(
          'uid', a.uid, 'prenom', a.prenom, 'nom', a.nom, 'url_profil_officiel', a.url_profil_officiel,
          'est_depute_actuel', a.est_depute_actuel, 'est_senateur_actuel', a.est_senateur_actuel,
          'est_ministre_actuel', a.est_ministre_actuel, 'roles_text', a.roles_text,
          'groupe', (select jsonb_build_object('libelle', o.libelle) from organes o where o.uid = a.groupe))
        from acteurs a where a.uid = d.initiateur_acteur_ref) as initiateur_acteur_ref,
      (select jsonb_build_object(
          'uid', s.uid, 'titre', s.titre, 'sort_libelle', s.sort_libelle,
          'pour', s.synthese_pour, 'contre', s.synthese_contre, 'abstentions', s.synthese_abstentions)
        from actes_legislatifs a2
        join scrutins s on s.uid = any(a2.vote_refs)
        where a2.uid = e.derniere_etape_uid and s.votes_nominatifs is not null
        order by s.date_scrutin desc nulls last, s.uid desc
        limit 1) as dernier_vote
    from etapes e
    join dossiers_legislatifs d on d.uid = e.dossier_uid
    order by e.nb_etapes desc, e.derniere_etape desc, e.dossier_uid`;
}

/**
 * L'adresse du dernier vote qui a une page (`/Scrutins/[uid]`, liste nominative
 * présente), pour le lien de la section « Les votes ». `null` si la table n'en a aucun :
 * la section renvoie alors à la liste des textes.
 */
export async function getDernierScrutinNominatif(): Promise<string | null> {
  const [ligne] = await sql<{ uid: string }[]>`
    select uid from scrutins
    where votes_nominatifs is not null
    order by date_scrutin desc nulls last, uid desc
    limit 1`;
  return ligne?.uid ?? null;
}
