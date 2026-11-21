-- 2026-11-20 : dossier législatif d'un scrutin sur amendement (LOI-83)
--
-- POURQUOI. La page Textes trouve un texte par ses amendements, et un scrutin sur un
-- amendement absent de `amendements` (16e législature, amendement non retrouvé) n'y
-- existe que par ce vote, qui mène à la page officielle. Le dump des scrutins de l'Assemblée ne dit pas de quel
-- dossier relève un vote sur amendement ; `import_amendements.py` le déduit du dump
-- des amendements (`_votes_amendements.dossier_du_vote`) et l'écrit ici.
--
-- Écrite par `import_amendements.py` seul, jamais par `import_scrutins_cloud.py`, qui
-- écrit `scrutins` par liste de colonnes explicite et ne la touche donc pas.
--   - `dossier_uid` : `dossiers_legislatifs.uid`. NULL tant qu'aucune règle sûre ne
--     relie le vote. Un lien posé ne s'efface ni ne change : le dump des amendements
--     perd ceux des textes anciens, et la règle ne retrouverait plus ce qu'elle a
--     trouvé. Sans clé étrangère, comme `amendements.auteur_uid` : un import ne doit
--     pas échouer sur un dossier pas encore importé.
--
-- Une colonne nullable sans valeur par défaut ne réécrit pas la table.

ALTER TABLE scrutins ADD COLUMN IF NOT EXISTS dossier_uid text;

CREATE INDEX IF NOT EXISTS idx_scrutins_dossier_uid ON scrutins (dossier_uid);
