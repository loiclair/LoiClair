-- Migration : suppression de l'index GIN full-text inutilisé sur debat_interventions.
-- Créé le 2026-04-15 "au cas où", jamais référencé par le code applicatif (aucun
-- usage de to_tsquery / textSearch / @@ dans src/ ou pipeline/). Libère 70 MB.
DROP INDEX IF EXISTS public.idx_debat_interventions_texte_tsv;
