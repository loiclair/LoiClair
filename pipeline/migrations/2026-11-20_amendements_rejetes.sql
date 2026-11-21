-- 2026-11-20 : les amendements rejetés par scrutin public, dans `amendements` (LOI-85)
--
-- POURQUOI. La recherche de la page Textes trouve les votes publics sur un amendement,
-- surtout rejetés, et chacun menait à un 404 : la base ne gardait que les adoptés.
-- Choix d'Alex : un amendement rejeté par scrutin public a sa page d'amendement, avec
-- le résultat du vote, et entre dans la table existante avec un sort.
--
-- `amendements.sort` : 'adopte' (toutes les lignes jusqu'ici, et la valeur par défaut)
-- ou 'rejete'. Écrit par `import_amendements.py`. Un rejeté n'y entre que s'il a eu
-- un scrutin public retrouvé (`RattachementVotes`) ; il ne s'efface jamais, la
-- réconciliation de nuit ne supprimant que des adoptés.
--
-- PIÈGE. Tout lecteur qui liste ou compte des amendements adoptés filtre
-- `sort = 'adopte'` : fiche du texte, fiche élu, « autres amendements de l'article »,
-- Ce qui me concerne, `classer_articles.py`, et les deux fonctions de la carte des
-- auteurs, redéfinies plus bas. Seuls la page d'un amendement, son image de partage,
-- l'index de recherche et le plan du site lisent les deux sorts.
--
-- `votes_amendements.adopte` : le sort du vote. La table reçoit désormais tous les
-- votes sur amendement de l'Assemblée, rejetés compris (`import_scrutins_cloud.py`) ;
-- `relier_votes` ne relie un vote qu'à un amendement de même sort. Les lignes
-- existantes sont toutes des votes d'adoption, d'où le défaut.
--
-- Une colonne à valeur par défaut constante ne réécrit pas la table (Postgres 11+).
--
-- CONTRÔLE APRÈS : les deux fonctions rendent les mêmes lignes qu'avant tant
-- qu'aucun rejeté n'est écrit (comparées dans une même transaction).

ALTER TABLE amendements
  ADD COLUMN IF NOT EXISTS sort text NOT NULL DEFAULT 'adopte'
    CONSTRAINT amendements_sort_check CHECK (sort IN ('adopte', 'rejete'));

ALTER TABLE votes_amendements
  ADD COLUMN IF NOT EXISTS adopte boolean NOT NULL DEFAULT true;

-- Mêmes fonctions que `2026-10-29_amendements_adoptes_carte.sql`, adoptés seuls.
create or replace function public.amendements_adoptes_auteurs(p_dossier text)
returns table(auteur_type text, auteur_uid text, auteur_libelle text, chambre text, nb bigint)
language sql
stable
security invoker
as $$
  with r as (
    select a.auteur_type, a.auteur_uid, a.auteur_libelle, a.chambre,
           row_number() over (order by a.date_amendement asc nulls last, a.uid) as rang
    from public.amendements a
    where a.dossier_uid = p_dossier and a.sort = 'adopte'
  )
  select r.auteur_type, r.auteur_uid, r.auteur_libelle, r.chambre, count(*)
  from r
  group by r.auteur_type, r.auteur_uid, r.auteur_libelle, r.chambre
  order by min(r.rang);
$$;

create or replace function public.amendements_adoptes_premiers(p_dossier text, p_cles jsonb, p_limite integer)
returns table(cle text, uid text, numero text, article text, lieu text, chambre text, url text)
language sql
stable
security invoker
as $$
  with g as (
    select c ->> 'cle' as cle, x ->> 'type' as t, x ->> 'uid' as u, x ->> 'libelle' as l,
           x ->> 'chambre' as ch
    from jsonb_array_elements(p_cles) c,
         jsonb_array_elements(c -> 'groupes') x
  ), r as (
    select g.cle, a.uid, a.numero, a.article, a.lieu, a.chambre, a.url,
           row_number() over (partition by g.cle order by a.date_amendement asc nulls last, a.uid) as n
    from public.amendements a
    join g on a.auteur_type = g.t
          and a.auteur_uid is not distinct from g.u
          and a.auteur_libelle is not distinct from g.l
          and a.chambre = g.ch
    where a.dossier_uid = p_dossier and a.sort = 'adopte'
  )
  select r.cle, r.uid, r.numero, r.article, r.lieu, r.chambre, r.url
  from r
  where r.n <= p_limite
  order by r.cle, r.n;
$$;
