-- 2026-10-29 : l'index d'unicité d'articles_presse porte sur l'empreinte de l'url
--
-- POURQUOI. `idx_articles_presse_unique_url` sur `(dossier_uid, url)` pesait 17 Mo
-- (28 292 lignes, url de 326 octets en moyenne, presque toutes des redirections
-- news.google.com) dans une base gratuite plafonnée à 500 Mo. L'index sur
-- `(dossier_uid, md5(url))` garantit la même unicité pour environ un dixième de la
-- place : deux url différentes au md5 identique sont un risque négligeable ici.
--
-- QUI ÉCRIT. `pipeline/import_articles_presse.py` (`ecrire_articles`), en
-- `INSERT … ON CONFLICT (dossier_uid, md5(url))` : l'ancienne API ne sait pas viser un index
-- sur une expression. `check_articles_presse.py` met à jour par `id`, sans dépendre de
-- l'index.
--
-- EN DEUX TEMPS, à lancer hors transaction (`CONCURRENTLY` ne bloque pas les
-- écritures, mais refuse un bloc transactionnel) :
-- 1. créer le nouvel index, puis pousser le script qui le vise ;
-- 2. retirer l'ancien, une fois plus aucune version de l'import ne vise
--    `on_conflict=dossier_uid,url`.

-- 1.
create unique index concurrently if not exists idx_articles_presse_dossier_url_md5
  on public.articles_presse (dossier_uid, md5(url));

-- 2. À lancer seul, jamais avec le 1 : seulement une fois le nouvel import poussé, et
--    après avoir vérifié que le nouvel index est valide (`pg_index.indisvalid`), une
--    création concurrently interrompue le laissant invalide sans erreur.
drop index concurrently if exists public.idx_articles_presse_unique_url;
