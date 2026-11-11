-- Migration : tables `debat_seances`, `debat_interventions` + colonnes cache résumé IA débats
-- À appliquer à la main avant le déploiement.
--
-- Objet : stocker les verbatims des débats parlementaires (Syseron AN + CRI Sénat)
--         pour alimenter (a) l'onglet Interventions sur la fiche élu,
--                       (b) le résumé IA des débats sur la fiche dossier,
--                       (c) la page verbatim reconstitué `/dossiers-legislatifs/[uid]/debats`.
-- Volume attendu : ~3 300 séances, plusieurs millions d'interventions (sur l'historique Sénat depuis 2003).

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Table `debat_seances` — 1 ligne par séance (AN ou Sénat)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.debat_seances (
  uid          text primary key,                         -- "AN:CRSANR5L17S2026O1N002" | "SEN:d20260409"
  chambre      text not null check (chambre in ('AN', 'SEN')),
  date_seance  date not null,
  legislature  integer,
  session_lib  text,
  titre        text,
  url_source   text,                                     -- lien vers le compte-rendu officiel
  created_at   timestamptz not null default now()
);

create index if not exists idx_debat_seances_date
  on public.debat_seances (date_seance desc);

create index if not exists idx_debat_seances_chambre_date
  on public.debat_seances (chambre, date_seance desc);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Table `debat_interventions` — 1 ligne par prise de parole
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.debat_interventions (
  id              bigserial primary key,
  seance_uid      text not null references public.debat_seances(uid) on delete cascade,
  ordre           integer not null,
  point_titre     text,
  article         text,                                  -- " 1er", " 3", … (AN)
  amendement      text,                                  -- " 603", …      (AN)
  dossier_uid     text references public.dossiers_legislatifs(uid) on delete set null,
  texte_num       text,                                  -- num_notice AN ou signet Sénat (audit)
  acteur_uid      text references public.acteurs(uid) on delete set null,
  orateur_nom     text,                                  -- fallback : ministre, invité, président
  orateur_qualite text,                                  -- "rapporteur", "ministre de la justice", "président"
  role_debat      text,
  texte           text not null,                         -- verbatim nettoyé (HTML → texte, didascalies gardées)
  stime           numeric,                               -- AN uniquement, timecode audio/vidéo
  created_at      timestamptz not null default now()
);

create unique index if not exists idx_debat_interventions_seance_ordre
  on public.debat_interventions (seance_uid, ordre);

create index if not exists idx_debat_interventions_dossier_date
  on public.debat_interventions (dossier_uid, seance_uid, ordre);

create index if not exists idx_debat_interventions_acteur_seance
  on public.debat_interventions (acteur_uid, seance_uid);

create index if not exists idx_debat_interventions_texte_tsv
  on public.debat_interventions using gin (to_tsvector('french', texte));

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Cache résumé IA des débats sur `dossiers_legislatifs`
--    Même pattern que `textes.resume_ia` — pas de nouvelle table pour 5 colonnes.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.dossiers_legislatifs
  add column if not exists resume_debats_ia              text,
  add column if not exists resume_debats_ia_en           text,
  add column if not exists resume_debats_prompt_version  text,
  add column if not exists resume_debats_hash_source     text,
  add column if not exists resume_debats_created_at      timestamptz;
