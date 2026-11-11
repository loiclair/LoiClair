create table if not exists public.quiz_affinite_scrutins (
  scrutin_uid  text primary key,
  dossier_uid  text not null,
  rang         integer not null,
  updated_at   timestamptz not null default now()
);

create index if not exists idx_quiz_affinite_scrutins_rang
  on public.quiz_affinite_scrutins (rang);
