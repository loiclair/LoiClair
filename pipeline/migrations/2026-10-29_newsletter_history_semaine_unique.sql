-- 2026-10-29 : une seule lettre archivée comme envoyée par semaine
--
-- POURQUOI. `POST /api/newsletter/send` lit `newsletter_history` avant de générer
-- la lettre et rend `already_sent` si la semaine y est déjà (`skipped = false`).
-- Deux lancements simultanés passent pourtant tous les deux cette lecture. Cet
-- index fait échouer l'archivage du second : la route le signale alors par
-- l'alerte « Newsletter envoyée mais non archivée », au lieu de laisser deux lignes
-- pour une même semaine, et un re-run suivant est arrêté par la garde.
--
-- PARTIEL sur `skipped = false`, la condition même de la garde : une ligne de
-- semaine sautée ne doit pas empêcher d'archiver l'envoi réel de cette semaine.
--
-- Table de quelques dizaines de lignes : création ordinaire, dans une transaction.
-- Vérifier avant qu'aucune semaine n'a deux lignes envoyées, sinon la création
-- échoue :
--   SELECT week_start, count(*) FROM newsletter_history
--   WHERE skipped = false GROUP BY week_start HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_history_semaine_envoyee_unique
  ON newsletter_history (week_start)
  WHERE skipped = false;
