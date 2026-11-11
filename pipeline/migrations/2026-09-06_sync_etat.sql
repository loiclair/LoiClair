-- 2026-09-06 — La fraîcheur affichée vient du pipeline, plus de la couleur du run
--
-- À appliquer à la main avant le déploiement :
-- sans cette table, `LastUpdateBadge` ne trouve rien et disparaît du pied de page.
--
-- Objet : une ligne unique (`cle = 'nightly'`) portant l'horodatage de la dernière nuit
-- où les dix-huit étapes du cron sont passées. Écrite par `bilan_nightly.py`, lue par
-- `src/components/LastUpdateBadge.tsx`.
--
-- Pourquoi : le badge interrogeait l'API GitHub et demandait le dernier run
-- `status=success`. Vert veut dire « le processus est sorti en 0 », pas « le travail a
-- été fait » : pendant trois semaines le badge a affiché des dates rassurantes alors
-- que le dump sénateurs arrivait vide et que deux étapes mouraient en silence. La date
-- doit donc être posée par le pipeline lui-même, une fois son travail terminé.
--
-- Volume attendu : 1 ligne, pour toujours.

create table if not exists public.sync_etat (
  cle text primary key,
  derniere_reussite timestamptz not null,
  run_id bigint,
  updated_at timestamptz not null default now()
);

alter table public.sync_etat enable row level security;

-- Lecture publique : la date s'affiche dans le pied de page, sur toutes les pages.
-- L'écriture reste au service_role, utilisé par le cron.
drop policy if exists "sync_etat lecture publique" on public.sync_etat;
create policy "sync_etat lecture publique"
  on public.sync_etat for select
  using (true);

-- Amorçage indispensable. `getDerniereSynchro` fait un `.maybeSingle()`, qui rend
-- `null` sans erreur sur une table vide, et `LastUpdateBadge` ne s'affiche pas quand la
-- date est nulle : sans cette ligne, le badge disparaît du pied de page de tout le site
-- entre le déploiement et la première nuit entièrement réussie. La valeur reprise est
-- celle du dernier run vert de l'ancien mécanisme, pour que l'affichage soit continu.
insert into public.sync_etat (cle, derniere_reussite, run_id)
values ('nightly', '2026-09-05T07:22:17Z', 33949785685)
on conflict (cle) do nothing;
