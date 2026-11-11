-- Migration : table `questions` + compteurs sur `acteurs` + mise à jour RPC `get_activite_elus`
-- À appliquer à la main avant le déploiement.
--
-- Objet : exposer les questions parlementaires (AN : QG/QOSD/QE, Sénat : QO) pour
--          (a) alimenter le score d'activité (2 nouvelles métriques par chambre)
--          (b) afficher les 5 dernières questions sur la fiche élu.
-- Volume attendu : ~40–50k lignes (métadonnées uniquement, pas de verbatim).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Table `questions`
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.questions (
  uid          text primary key,
  uid_auteur   text references public.acteurs(uid) on delete cascade,
  chambre      text not null check (chambre in ('AN', 'SENAT')),
  type         text not null check (type in ('QG', 'QOSD', 'QE', 'QO')),
  date_jo      date,
  titre        text,
  rubrique     text,
  ministere    text,
  a_reponse    boolean not null default false,
  url_source   text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_questions_auteur_date
  on public.questions (uid_auteur, date_jo desc);

create index if not exists idx_questions_chambre_type_date
  on public.questions (chambre, type, date_jo desc);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Compteurs sur `acteurs`
-- ────────────────────────────────────────────────────────────────────────────
alter table public.acteurs
  add column if not exists nb_questions_orales  integer not null default 0,
  add column if not exists nb_questions_ecrites integer not null default 0;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RPC `get_activite_elus`
--
-- À exécuter APRÈS avoir vérifié la définition actuelle en base
-- (Dashboard → Database → Functions → get_activite_elus → View SQL).
--
-- Modifications nécessaires par rapport à la version actuelle :
--   • RETURN TABLE : ajouter  nb_questions_orales  integer,
--                              nb_questions_ecrites integer
--   • SELECT       : ajouter  a.nb_questions_orales,
--                              a.nb_questions_ecrites
--   (ces colonnes existent désormais sur `acteurs` — pas de jointure requise).
--
-- Modèle (à adapter au corps existant — surtout ne pas écraser la logique
-- de nb_dossiers_inities / nb_textes_cosignes / nb_rapporteur) :
--
-- create or replace function public.get_activite_elus()
-- returns table (
--   uid                               text,
--   prenom                            text,
--   nom                               text,
--   groupe                            text,
--   chambre                           text,
--   taux_participation_votes_finaux   numeric,
--   nb_dossiers_inities               integer,
--   nb_textes_cosignes                integer,
--   nb_rapporteur                     integer,
--   nb_amendements_auteur             integer,
--   nb_amendements_cosignataire       integer,
--   nb_questions_orales               integer,
--   nb_questions_ecrites              integer
-- )
-- language sql stable as $$
--   -- … corps existant …
--   -- remplacer la liste des colonnes retournées par :
--   --   a.uid, a.prenom, a.nom, a.groupe, <chambre>,
--   --   a.taux_participation_votes_finaux,
--   --   <nb_dossiers_inities>, <nb_textes_cosignes>, <nb_rapporteur>,
--   --   a.nb_amendements_auteur, a.nb_amendements_cosignataire,
--   --   a.nb_questions_orales, a.nb_questions_ecrites
-- $$;
