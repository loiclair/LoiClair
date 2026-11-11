-- Migration : ajoute une colonne `embedding_int8` (bytea) à dossiers_legislatifs.
-- Stocke la version quantifiée (int8, SCALE=127) de la colonne `embedding` pour
-- réduire le trafic de ~15 MB à ~1 MB par fetch de /api/search-index/dossiers.
ALTER TABLE public.dossiers_legislatifs
  ADD COLUMN IF NOT EXISTS embedding_int8 bytea;
