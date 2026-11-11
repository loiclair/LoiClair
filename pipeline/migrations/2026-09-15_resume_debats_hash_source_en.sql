-- 2026-09-15 : une empreinte du compte rendu par langue pour le résumé des débats
--
-- Additive, à appliquer avant le déploiement : le code en ligne ne lit pas la
-- nouvelle colonne.
--
-- POURQUOI. `resume_debats_hash_source` était partagée par le résumé français et
-- le résumé anglais, alors que chacun a son texte et sa version. Quand une séance
-- s'ajoute, le premier lecteur qui régénère une langue y écrit la nouvelle
-- empreinte ; le résumé de l'autre langue, fait sur l'ancien compte rendu, passe
-- alors le contrôle du cache et reste servi comme à jour jusqu'à l'import suivant.
-- Le cas était rare tant qu'aucun résumé ne se faisait pendant un débat ; il
-- devient quotidien depuis que le résumé suit le débat.
--
-- `resume_debats_hash_source` reste la colonne du français. Aucune reprise des
-- lignes existantes : un résumé anglais sans empreinte est regénéré à sa
-- prochaine lecture, ce que la nouvelle version de prompt impose déjà.

alter table public.dossiers_legislatifs
  add column if not exists resume_debats_hash_source_en text;
