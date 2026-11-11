-- 2026-10-29 : la carte « Amendements adoptés par auteur » sans lire toute la liste
--
-- POURQUOI. La fiche dossier n'affiche que dix auteurs et dix amendements chacun,
-- mais `amendementsAdoptes` lisait tous les amendements du dossier pour les compter
-- et les ranger : 3 306 lignes sur la loi de finances 2026 (DLR5L17N52428), environ
-- 925 Ko bruts de l'ancienne API, à chaque génération ISR de la fiche. Le forfait de trafic de l'époque
-- est de 5 Go par mois.
--
-- DEUX FONCTIONS, appelées par `amendementsAdoptes` (mode carte) dans
-- `src/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/amendements-adoptes.ts` :
--   1. `amendements_adoptes_auteurs(p_dossier)` : une ligne par (auteur_type,
--      auteur_uid, auteur_libelle, chambre), avec son nombre d'amendements, rangées
--      par premier amendement. Le JS en tire les mêmes auteurs qu'avant (fusion par
--      élu, rôle et type pris au premier amendement), leur ordre, et choisit les dix
--      de la carte. La chambre est dans le groupe parce que le JS en fait la clé d'un
--      auteur sans uid ni libellé (`inconnu:AN`, `inconnu:SN`) ; les autres clés la
--      fusionnent de nouveau. 654 lignes courtes pour la loi de finances.
--   2. `amendements_adoptes_premiers(p_dossier, p_cles, p_limite)` : les `p_limite`
--      premiers amendements de chaque auteur retenu. `p_cles` est un tableau jsonb
--      `[{cle, groupes: [{type, uid, libelle, chambre}]}]`, un auteur fusionnant parfois
--      plusieurs groupes de la première fonction (un élu à la fois député et
--      rapporteur).
-- Le rang suit l'ordre de la lecture qu'elles remplacent : `date_amendement`
-- croissante, dates nulles en dernier, puis `uid`. Un rang égal entre deux lignes est
-- impossible, `uid` étant la clé primaire.
--
-- Le panneau, qui montre tout, garde la lecture complète (route
-- `/api/dossiers/[uid]/amendements`).
--
-- `stable` : aucune écriture. `security invoker`, comme `empreinte_debats`.
-- Purement additif. À appliquer avant le déploiement du code qui les appelle.
--
-- CONTRÔLES APRÈS :
--   SELECT count(*), sum(nb) FROM amendements_adoptes_auteurs('DLR5L17N52428');
--     -- 655 groupes, 3 306 amendements au 2026-10-29
--   SELECT proacl FROM pg_proc WHERE proname LIKE 'amendements_adoptes_%';

-- Le drop : une première version, appliquée le 2026-10-29, rendait aussi un rang
-- que le code ne lisait pas, et changer les colonnes rendues demande de recréer.
drop function if exists public.amendements_adoptes_auteurs(text);

create function public.amendements_adoptes_auteurs(p_dossier text)
returns table(auteur_type text, auteur_uid text, auteur_libelle text, chambre text, nb bigint)
language sql
stable
security invoker
as $$
  with r as (
    select a.auteur_type, a.auteur_uid, a.auteur_libelle, a.chambre,
           row_number() over (order by a.date_amendement asc nulls last, a.uid) as rang
    from public.amendements a
    where a.dossier_uid = p_dossier
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
    where a.dossier_uid = p_dossier
  )
  select r.cle, r.uid, r.numero, r.article, r.lieu, r.chambre, r.url
  from r
  where r.n <= p_limite
  order by r.cle, r.n;
$$;

revoke execute on function public.amendements_adoptes_auteurs(text) from public, anon, authenticated;
grant execute on function public.amendements_adoptes_auteurs(text) to service_role;
revoke execute on function public.amendements_adoptes_premiers(text, jsonb, integer) from public, anon, authenticated;
grant execute on function public.amendements_adoptes_premiers(text, jsonb, integer) to service_role;
