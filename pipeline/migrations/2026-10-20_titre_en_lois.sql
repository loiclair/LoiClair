-- Titre anglais des lois publiées du baromètre d'application, traduit par Claude Haiku
-- 5.5 depuis le titre Légifrance (« LOI n° 2022-299 du 2 mars 2022… »), comme celui
-- des dossiers (`2026-10-19_titre_en.sql`). Affiché sur /en par /Facts/delais,
-- /Facts/taux-application et Month (`src/lib/titre-dossier.ts`).
--
-- Écrites par `traduire_titres.py` seul. `import_application_lois.py` fait un upsert
-- sur `jorftext_id` dont le payload ne les contient pas : il n'y touche donc pas.
--
-- Deux colonnes nullables sans valeur par défaut : Postgres les ajoute sans réécrire
-- la table.

alter table public.application_lois
  add column if not exists titre_en text,
  -- md5(titre + version du prompt) : un titre ou un prompt modifié relance la traduction.
  add column if not exists titre_en_empreinte text;
