-- 2026-10-14 : suppression de la table `sync_row_hashes`
--
-- POURQUOI. Le cache d'empreintes des imports vit depuis le 2026-10-13 dans le bucket
-- privé `sync-cache` (voir `2026-10-13_sync_cache_storage.sql` et `RowHashCache` dans
-- `_sync_cache.py`). La table ne recevait plus rien depuis la bascule, aucune vue ni
-- fonction ne la lisait, et elle occupait 53 Mo d'une base gratuite plafonnée à 500.
--
-- QUAND. Après la nuit du 2026-10-14 : 20 étapes réussies, aucun avertissement du
-- cache d'empreintes dans le journal.
--
-- SI LES FICHIERS DU BUCKET SE PERDENT, rien à restaurer : chaque import réécrit
-- toutes ses lignes une fois, puis le cache se reconstruit. Un fichier présent mais
-- illisible, lui, ne se reconstruit pas seul : `RowHashCache.flush` refuse de
-- l'écraser, et toute la table se réécrit chaque nuit jusqu'à ce qu'on le supprime
-- du dossier `hashes/<table>/`.

drop table if exists sync_row_hashes;
