-- 2026-10-29 : l'exposé des amendements passe dans Storage, la base n'en garde que le md5
--
-- POURQUOI. `amendements.expose` occupait 25 Mo sur disque d'une base gratuite
-- plafonnée à 500 Mo (482 le 2026-10-28), pour un texte que le site n'affiche pas
-- encore et que seul `classer_articles.py` lisait. Le texte part dans le bucket
-- public `amendements`, un fichier JSON par dossier,
-- `exposes/<dossier_uid>/<empreinte>.json` (voir `script python/_exposes.py`, retiré depuis). Ce sont
-- des documents parlementaires publics, d'où un bucket public, comme `debats`.
--
-- QUI ÉCRIT, QUI LIT. Écrit par `pipeline/import_amendements.py`
-- (`ecrire_exposes`, puis `expose_md5` dans `_ecrire_textes`). Lu par
-- `pipeline/classer_articles.py` : `expose_md5` pour l'empreinte de chaque
-- amendement, le fichier pour le texte envoyé au modèle.
--
-- EN DEUX TEMPS.
-- 1. Le bucket, avant que les fichiers ne soient écrits depuis la base et relus.
-- 2. Une fois les fichiers vérifiés : `expose` est remplacé par son md5 et renommé
--    `expose_md5`, en un seul `ALTER`. `md5(NULL)` reste NULL, et
--    `coalesce(expose_md5, md5(''))` rend exactement l'ancien `md5(coalesce(expose, ''))`
--    de `classer_articles.py` : aucune empreinte de classement ne change. Un `USING`
--    qui n'est pas un simple renommage fait réécrire la table, ce qui rend la place sur
--    disque en une passe (un `DROP COLUMN` seul ne libère rien sans `VACUUM FULL`). La
--    réécriture verrouille la table quelques secondes, lectures comprises.

-- 1.
insert into storage.buckets (id, name, public)
values ('amendements', 'amendements', true)
on conflict (id) do nothing;

-- 2.
begin;
alter table public.amendements alter column expose type text using md5(expose);
alter table public.amendements rename column expose to expose_md5;
comment on column public.amendements.expose_md5 is
  'md5 de l''exposé des motifs (NULL sans exposé). Le texte est dans Storage, amendements/exposes/<dossier_uid>/<empreinte>.json.';
commit;
