-- 2026-11-09 : part des votes d'un député déposés par délégation
--
-- POURQUOI. L'open data de l'Assemblée marque `parDelegation` chaque vote nominatif qu'un
-- collègue a déposé à la place du député, sur presque tous ses scrutins (9 693 scrutins
-- ordinaires sur 9 695 au 2026-11-09, et tous les solennels sauf deux). La fiche d'un
-- député affiche cette part dans « Ses votes ». Périmètre : les votes qui comptent dans
-- ses deux taux de participation, votes finaux et scrutins solennels réunis, motions de
-- censure exclues (D-107). La participation n'en est pas changée : un vote par délégation
-- reste un vote valide (D-117).
--
-- SÛRE. Quatre colonnes vides et une clé de plus dans `get_assembly_averages`, à `null`
-- tant que le script n'a pas tourné. La signature de la fonction ne change pas, donc ses
-- droits (2026-07-05_revoke_security_definer_execute.sql) sont gardés.
--
-- ORDRE. À appliquer AVANT que `import_scrutins_cloud.py` et `sync_senat.py` atteignent
-- `main` (le cron écrit ces colonnes), et avant que le site les lise en production.

alter table public.acteurs
  add column if not exists votes_finaux_solennels integer,
  add column if not exists votes_delegues integer,
  add column if not exists taux_delegation numeric(5,2);

alter table public.organes
  add column if not exists taux_delegation_moyen numeric(5,2);

comment on column public.acteurs.votes_finaux_solennels is
  'Votes exercés (pour, contre, abstention) du député pendant son mandat sur les scrutins '
  'finaux ou solennels, motions de censure exclues : la base du taux de délégation. Écrite '
  'par import_scrutins_cloud.py ; null pour un sénateur.';

comment on column public.acteurs.votes_delegues is
  'Parmi votes_finaux_solennels, ceux déposés par un collègue (parDelegation). Écrite par '
  'import_scrutins_cloud.py ; null pour un sénateur.';

comment on column public.acteurs.taux_delegation is
  'votes_delegues / votes_finaux_solennels, en %. Null si aucun vote, pour le président de '
  'l''Assemblée (D-124) et pour un sénateur.';

comment on column public.organes.taux_delegation_moyen is
  'Part des votes des membres du groupe déposés par délégation, sur le même périmètre que '
  'acteurs.taux_delegation : délégués cumulés / votes cumulés. Écrite par '
  'import_scrutins_cloud.py.';

create or replace function public.get_assembly_averages()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  SELECT jsonb_build_object(
    'taux_participation_votes_finaux_moyen', ROUND(AVG(taux_participation_votes_finaux)::numeric, 2),
    'taux_participation_votes_solennels_moyen', ROUND(AVG(taux_participation_votes_solennels)::numeric, 2),
    'taux_cohesion_moyen', ROUND(AVG(taux_cohesion_groupe)::numeric, 2),
    'taux_delegation_moyen', ROUND(AVG(taux_delegation)::numeric, 2)
  )
  FROM acteurs
  WHERE est_depute_actuel = true;
$function$;
