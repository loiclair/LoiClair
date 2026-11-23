// Lectures en base de la page d'accueil (`app/[locale]/(landing)`), rendue statique et
// recalculée chaque nuit par `/api/revalidate` : « Les lois dans l'actualité »
// (`ActualiteLois.tsx`) et le lien de la section des votes (`SectionsBenefices.tsx`). Le
// taux de promulgation de la section des chiffres, lui, vient de `getTauxPromulgation`
// (`facts-queries.ts`), le helper de son article (D-014).

import { sql } from '@/lib/db';
import { ACTES_MARQUANTS } from '@/lib/actes-marquants';
import { aujourdhuiAParisIso } from '@/lib/jour-paris';

/** Fenêtre de « Les lois dans l'actualité », en jours, aujourd'hui compris. */
export const JOURS_ACTUALITE = 30;

/** Un texte de « Les lois dans l'actualité ». */
export type LoiActualite = {
  uid: string;
  titre: string | null;
  titre_en: string | null;
  statut_final: string | null;
  /** Étapes marquantes (`ACTES_MARQUANTS`) franchies dans la fenêtre. */
  nb_etapes: number;
  /** Date de la plus récente, `2026-11-19T00:00:00`. */
  derniere_etape: string;
  /** Ces étapes, la plus récente d'abord : ce qui fait que le texte est là. */
  liste_etapes: { code: string; date: string }[];
  /** Articles de presse accessibles rattachés au texte, toutes dates confondues. */
  nb_articles: number;
  /** Jusqu'à trois sources de ces articles, la plus récente d'abord. */
  sources: string[];
};

/**
 * Les `limite` textes qui ont franchi le plus d'étapes marquantes ces trente derniers
 * jours, hors dossiers `hors_liste` : la règle est neutre (elle ne regarde ni le sujet,
 * ni l'auteur, ni la presse) et se dit en une phrase sous le titre de la section, et
 * chaque carte liste ses étapes (`liste_etapes`). Ex æquo départagés par l'étape la plus
 * récente, puis par `uid` pour un ordre qui ne varie jamais d'un rendu à l'autre ; dans
 * un texte, deux étapes du même jour par leur `uid`. Une seule requête ; la presse est
 * comptée par sous-requête, pour les seuls textes retenus. Peut rendre moins de `limite`
 * textes, ou aucun : la section s'adapte (`ActualiteLois`).
 */
export async function getLoisDansLActualite(limite = 6): Promise<LoiActualite[]> {
  // Le jour de Paris, pas `current_date` : celui-ci suit le fuseau de la session
  // Postgres, et la page se régénère à la première visite après `/api/revalidate`, à
  // n'importe quelle heure. Même règle que `actualite_parlementaire` (`lib/mcp/chiffres.ts`).
  const jour = aujourdhuiAParisIso();
  return sql<LoiActualite[]>`
    with etapes as (
      select a.dossier_uid, count(*)::int as nb_etapes, max(a.date_acte) as derniere_etape,
        jsonb_agg(jsonb_build_object('code', a.code_acte, 'date', a.date_acte)
          order by a.date_acte desc, a.uid desc) as liste_etapes
      from actes_legislatifs a
      join dossiers_legislatifs d on d.uid = a.dossier_uid and d.hors_liste = false
      where a.code_acte = any(${ACTES_MARQUANTS})
        and a.date_acte >= ${jour}::date - ${JOURS_ACTUALITE - 1}::int
        and a.date_acte < ${jour}::date + 1
      group by a.dossier_uid
      order by nb_etapes desc, derniere_etape desc, a.dossier_uid
      limit ${limite}
    )
    select d.uid, d.titre, d.titre_en, d.statut_final, e.nb_etapes, e.derniere_etape, e.liste_etapes,
      (select count(*)::int from articles_presse p
        where p.dossier_uid = e.dossier_uid and p.url_accessible = true) as nb_articles,
      (select coalesce(jsonb_agg(s.source_nom order by s.derniere desc nulls last, s.source_nom), '[]'::jsonb)
        from (select p.source_nom, max(p.date_publication) as derniere
              from articles_presse p
              where p.dossier_uid = e.dossier_uid and p.url_accessible = true and p.source_nom <> ''
              group by p.source_nom
              order by derniere desc nulls last, p.source_nom
              limit 3) s) as sources
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
