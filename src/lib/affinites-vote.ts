// Accord de vote d'un élu avec chaque groupe de sa chambre (D-354). Lu par la fiche
// élu (« Ses affinités de vote », `les-elus/[uid]/page.tsx`) et par l'outil MCP
// `fiche_elu` (`lib/mcp/elus.ts`) : un seul calcul, pour que le site et les assistants
// ne puissent pas donner deux chiffres différents sur la même personne.

import { sql } from '@/lib/db';

/** Un groupe ne compte qu'à partir de ce nombre de votes en commun avec l'élu : le
 *  `THRESHOLD` de `/Facts/alliances`, qu'un `page.tsx` ne peut pas exporter. Sans lui,
 *  un groupe formé en cours de mandat montrerait 100 % sur deux votes. */
export const SEUIL_VOTES_COMMUNS = 10;

/** Une ligne par groupe au-dessus du seuil, déjà triée. */
export type AccordGroupeLigne = {
  groupe_uid: string;
  libelle: string | null;
  libelle_abrege: string | null;
  couleur_associee: string | null;
  /** Part des votes communs où l'élu a voté comme le groupe, de 0 à 100, une décimale. */
  accord: number;
  communs: number;
  /** Votes finaux de l'élu entrés dans le calcul, répété sur chaque ligne. */
  total: number;
};

/**
 * Accord de l'élu avec chaque groupe, à partir de ses positions (le seau de
 * `votes_nominatifs`, tel que le rend `positions_scrutins_elu`), du plus récent au plus
 * ancien.
 *
 * Côté élu, seuls pour, contre et abstention comptent : un absent, un non-votant ou le
 * président de séance n'a pas pris position, le scrutin sort. Périmètre de
 * `scrutins_groupes_positions` (votes finaux, sans motion de censure ni non-inscrits,
 * D-299 et D-313), position de groupe tirée du décompte (D-269). Une seule chambre :
 * `chambre` pour un élu en exercice, même sans vote final encore (un député devenu
 * sénateur n'a alors aucune ligne, et non ses groupes de l'Assemblée) ; à `null`, celle
 * de son dernier vote final, pour un ministre ou un ancien élu (D-239). Tri : accord,
 * votes communs, puis `groupe_uid` pour départager.
 *
 * Lève sur une panne, comme les lectures voisines (D-136).
 */
export async function lireAccordsGroupes(
  positions: { uid: string; position: string }[],
  chambre: 'AN' | 'SN' | null,
): Promise<AccordGroupeLigne[]> {
  const exprimes = positions.filter((p) => p.position === 'pour' || p.position === 'contre' || p.position === 'abstentions');
  if (exprimes.length === 0) return [];
  return sql<AccordGroupeLigne[]>`
    with votes as (
      select v.uid, case v.pos when 'abstentions' then 'abstention' else v.pos end as pos, v.rang
      from unnest(${exprimes.map((p) => p.uid)}::text[], ${exprimes.map((p) => p.position)}::text[])
        with ordinality as v(uid, pos, rang)
    ), chambre as (
      select coalesce(${chambre}::text, (
        select g.chambre
        from votes v
        join scrutins_groupes_positions g on g.scrutin_uid = v.uid
        order by v.rang
        limit 1)) as chambre
    ), finaux as (
      select v.uid, v.pos
      from votes v
      where exists (
        select 1
        from scrutins_groupes_positions g
        join chambre c on c.chambre = g.chambre
        where g.scrutin_uid = v.uid)
    )
    select g.groupe_uid, o.libelle, o.libelle_abrege, o.couleur_associee,
      round(100.0 * count(*) filter (where g.position_majoritaire = f.pos) / count(*), 1)::float8 as accord,
      count(*)::int as communs,
      (select count(*) from finaux)::int as total
    from finaux f
    join scrutins_groupes_positions g on g.scrutin_uid = f.uid
    left join organes o on o.uid = g.groupe_uid
    group by g.groupe_uid, o.libelle, o.libelle_abrege, o.couleur_associee
    having count(*) >= ${SEUIL_VOTES_COMMUNS}
    order by accord desc, communs desc, g.groupe_uid`;
}
