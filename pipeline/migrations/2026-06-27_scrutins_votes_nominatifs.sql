-- Ajoute la colonne votes nominatifs sur scrutins.
-- Remplie uniquement pour is_vote_final OR is_scrutin_important (~479 lignes).
-- NULL par défaut pour les ~7 465 scrutins non ciblés.
ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS votes_nominatifs jsonb;
