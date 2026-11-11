-- 2026-06-15 — Suppression des colonnes d'embedding de dossiers_legislatifs
--
-- La recherche sémantique a été retirée (D-088) : plus aucun code
-- de src/ ni de pipeline/ ne lit ces colonnes. Le drop avait déjà été passé
-- à la main sur la base ; ce fichier ne fait que le consigner, pour que le dossier
-- migrations/ reflète le schéma réel. Sans effet sur une base à jour.
--
-- `embedding`      : colonne pgvector, vecteur du modèle e5-base lu par
--                    parse_pgvector() dans generate_search_summaries.py.
-- `embedding_int8` : version quantifiée ajoutée le 2026-04-22 pour faire tomber
--                    le trafic de /api/search-index/dossiers de ~15 MB à ~1 MB.
--
-- L'extension `vector` reste installée alors que plus aucune colonne ne l'utilise.
-- Elle n'est pas supprimée ici : un DROP EXTENSION est irréversible sans réindexation
-- et ne coûte rien tant qu'il dort.

ALTER TABLE public.dossiers_legislatifs
  DROP COLUMN IF EXISTS embedding_int8,
  DROP COLUMN IF EXISTS embedding;
