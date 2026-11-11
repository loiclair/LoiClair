-- Titre anglais des scrutins, traduit par Claude Haiku 5.5 depuis le titre officiel
-- (« sur l'ensemble de la proposition de loi… »), comme celui des dossiers
-- (`2026-10-19_titre_en.sql`). Affiché sur /en par la fiche du dossier, la fiche d'élu,
-- Month et le quiz d'affinité (`src/lib/titre-dossier.ts`).
--
-- Écrites par `traduire_titres.py` seul, pour les seuls scrutins que le site affiche
-- (filtre de `CIBLES`). `import_scrutins_cloud.py` et `sync_senat.py` font des upserts
-- sur `uid` dont le payload ne les contient pas : ils n'y touchent donc pas.
--
-- Deux colonnes nullables sans valeur par défaut : Postgres les ajoute sans réécrire
-- la table.
--
-- `positions_scrutins_elu` rend en plus `titre_en`, pour la fiche d'élu. Postgres
-- refuse `create or replace` quand le type de retour change : la fonction est
-- supprimée puis recréée, dans la même transaction pour que la fiche ne la trouve
-- jamais absente. Le reste de sa définition, et ses droits, sont ceux de
-- `2026-09-22_positions_scrutins_elu.sql`, dont les commentaires valent toujours.
--
-- ORDRE D'APPLICATION : avant le déploiement du code qui lit `titre_en`. L'ancien
-- code ignore la colonne de plus que rend la fonction.
--
-- CONTRÔLES APRÈS :
--   SELECT count(*) FROM positions_scrutins_elu('PA1008');  -- même nombre qu'avant
--   SELECT proacl FROM pg_proc WHERE proname = 'positions_scrutins_elu';  -- service_role seul

begin;

alter table public.scrutins
  add column if not exists titre_en text,
  -- md5(titre + version du prompt) : un titre ou un prompt modifié relance la traduction.
  add column if not exists titre_en_empreinte text;

drop function if exists public.positions_scrutins_elu(text);

create function public.positions_scrutins_elu(p_uid text)
returns table (
  uid text,
  titre text,
  titre_en text,
  date_scrutin timestamp,
  sort_code text,
  sort_libelle text,
  type_vote_code text,
  type_vote_libelle text,
  synthese_pour int,
  synthese_contre int,
  synthese_abstentions int,
  "position" text
)
language sql
stable
security invoker
as $$
  select s.uid,
         s.titre,
         s.titre_en,
         s.date_scrutin,
         s.sort_code,
         s.sort_libelle,
         s.type_vote_code,
         s.type_vote_libelle,
         s.synthese_pour,
         s.synthese_contre,
         s.synthese_abstentions,
         kv.key
  from public.scrutins s
  cross join lateral jsonb_each(s.votes_nominatifs) kv
  where s.votes_nominatifs is not null
    and jsonb_exists(kv.value, p_uid)
  order by s.date_scrutin desc, s.uid
$$;

revoke execute on function public.positions_scrutins_elu(text) from public, anon, authenticated;
grant execute on function public.positions_scrutins_elu(text) to service_role;

commit;
