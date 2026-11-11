-- Ce que la vérification au cas par cas établit sur la situation d'un parlementaire
-- en cumul, et qu'aucun registre ne publie : un recours contre l'élection est en
-- cours (il suspend le délai de trente jours de LO 151), ou la date limite de
-- régularisation est connue alors que le calcul ne sait pas la dater (un sénateur
-- réélu dont la base garde une date d'entrée sans rapport avec la réélection).
--
-- Une ligne par parlementaire, et seulement pour ceux-là : les autres ont une date
-- limite calculée par `dateLimite` (`src/lib/mandats-locaux.ts`). Écrite par
-- `import_rne.py` seul, d'après la liste `situations` de
-- `pipeline/corrections_rne.json`, recopiée en entier à chaque import.
--
-- RLS activée sans politique, comme `mandats_locaux` : le site la lit avec la clé
-- de service, et rien d'autre n'a à la lire.

create table if not exists public.situations_cumul (
  uid text primary key,
  recours boolean not null default false,
  date_limite date,
  source_url text not null,
  source_nom text,
  -- L'un ou l'autre : un recours en cours n'a pas encore de date limite.
  constraint situations_cumul_recours_ou_date check (recours <> (date_limite is not null))
);

alter table public.situations_cumul enable row level security;
