-- 2026-10-13 : bucket Storage `sync-cache`, nouveau domicile du cache d'empreintes
--
-- POURQUOI. La table `sync_row_hashes` pesait 53 Mo (200 000 empreintes et leurs
-- index) sur une base gratuite plafonnée à 500 Mo, qui en comptait 465. Le site ne la
-- lisait jamais : seuls les imports de la nuit s'en servent pour ne pas réécrire une
-- ligne inchangée. Le Storage a son propre quota (1 Go), séparé de celui de la base.
--
-- LE FORMAT. Un dossier par table, `hashes/<table>/`, qui contient la version
-- courante : un dictionnaire `{clé de ligne: sha256}` compressé, nommé par sa propre
-- empreinte et jamais réécrit (le CDN de Storage servirait l'ancien contenu). Voir
-- `RowHashCache` dans `_sync_cache.py`.
--
-- PRIVÉ. Aucune politique d'accès : seule la clé de service des imports y lit et y
-- écrit.
--
-- LA TABLE. `sync_row_hashes` a été supprimée après une nuit d'import réussie sur les
-- fichiers, par `2026-10-14_drop_sync_row_hashes.sql`.

insert into storage.buckets (id, name, public)
values ('sync-cache', 'sync-cache', false)
on conflict (id) do nothing;
