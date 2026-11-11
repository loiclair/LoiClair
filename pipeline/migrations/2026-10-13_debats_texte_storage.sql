-- 2026-10-13 : le texte des débats passe dans Storage (première moitié)
--
-- POURQUOI. `debat_interventions.texte` pesait environ 100 Mo d'une base gratuite
-- plafonnée à 500, et faisait les deux tiers de sa croissance. Le texte part dans le
-- bucket public `debats`, un fichier JSON par séance, `seances/<texte_hash>.json`, qui
-- associe chaque `ordre` à son texte. Ce sont des comptes rendus officiels, d'où un
-- bucket public.
--
-- CETTE MIGRATION ajoute seulement ce qu'il faut pour écrire et lire les fichiers :
-- - `debat_seances.texte_hash` : sha256 du fichier de la séance. Le site le lit dans la
--   même requête que les lignes, ce qui garantit qu'elles vont avec ce fichier-là. Un
--   fichier n'est jamais réécrit sous le même nom (le CDN de Storage servirait l'ancien
--   contenu) : une séance corrigée en reçoit un nouveau, et l'ancien est supprimé par
--   l'import suivant (le lendemain sur le cron), quand plus aucune page en cours de
--   génération ne peut le lire.
-- - `debat_interventions.nb_mots` : nombre de mots du texte, au sens de
--   `array_length(string_to_array(trim(texte), ' '), 1)`, que lira
--   `recalc_nb_prises_parole()` une fois `texte` retiré. L'import le remplit pour les
--   séances qu'il écrit ; les autres lignes sont remplies par la seconde migration,
--   juste avant le retrait de `texte`.
--
-- `texte` reste en place et continue d'être écrit tant que le site en ligne le lit. Il
-- est retiré par une seconde migration, après la mise en production des lecteurs.
--
-- QUI ÉCRIT, QUI LIT. Écrit par `pipeline/debats/import_debats.py`. Lu par
-- `src/lib/debats-texte.ts` : page de séance, fiche élu, `/api/resume-debats`.

alter table public.debat_seances add column if not exists texte_hash text;
alter table public.debat_interventions add column if not exists nb_mots integer;

comment on column public.debat_seances.texte_hash is
  'sha256 du fichier Storage debats/seances/<texte_hash>.json qui porte le texte des interventions de la séance.';
comment on column public.debat_interventions.nb_mots is
  'array_length(string_to_array(trim(texte), '' ''), 1) : lu par recalc_nb_prises_parole().';

insert into storage.buckets (id, name, public)
values ('debats', 'debats', true)
on conflict (id) do nothing;
