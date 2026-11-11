-- Migration : table scrutins_groupes_positions
-- Une ligne par (scrutin, groupe politique) avec la position majoritaire
-- et le décompte des votes. Peuplée par import_scrutins_cloud.py (AN)
-- et sync_senat.py (Sénat). Limitée aux votes finaux (un scrutin est final
-- s'il est référencé par actes_legislatifs.vote_refs).

create table if not exists public.scrutins_groupes_positions (
  scrutin_uid       text not null,
  groupe_uid        text not null,
  chambre           text not null check (chambre in ('AN', 'SN')),
  position_majoritaire text not null check (position_majoritaire in ('pour', 'contre', 'abstention')),
  nb_pour           integer,
  nb_contre         integer,
  nb_abstentions    integer,
  nb_membres        integer,
  updated_at        timestamptz default now(),
  primary key (scrutin_uid, groupe_uid)
);

create index if not exists idx_sgp_groupe    on public.scrutins_groupes_positions (groupe_uid);
create index if not exists idx_sgp_chambre   on public.scrutins_groupes_positions (chambre);
