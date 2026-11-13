-- 2026-11-11 : exposé des motifs du texte déposé, sur la ligne du dossier
--
-- POURQUOI. LoiClair gardait l'exposé des amendements (`amendements.expose`), pas
-- celui des lois : `decouper_textes.py` l'écarte, puisqu'il ne garde que la version
-- qui fait foi. L'exposé est le plaidoyer de l'auteur ; il servira plus tard à un
-- résumé à la demande et à une section de la fiche du dossier. Seul le texte déposé
-- en porte un : un texte de commission, adopté ou transmis n'en a pas.
--
-- Trois colonnes sur `dossiers_legislatifs` plutôt qu'une table : un exposé par
-- dossier, celui du premier texte déposé. Les imports de nuit écrivent cette table
-- par liste de colonnes explicite et n'en suppriment aucune ligne, et aucune requête
-- ne la lit en entier (`select *`) : le texte ne pèse que sur qui le demande.
--
-- Écrites par `importer_exposes.py` seul.
--   - `expose` : le texte. NULL tant qu'aucun n'a été trouvé : tout texte déposé en a
--     un, son absence veut dire que la chambre ne l'a pas encore publié.
--   - `expose_texte_uid` : le texte (`textes.uid`) d'où il vient, pour le lien vers
--     la source. Sans clé étrangère, comme `amendements.auteur_uid`.
--   - `expose_lu_le` : date de lecture, renseignée avec l'exposé. NULL : à lire ; un
--     dossier lu n'est relu que si son premier texte déposé change.
--
-- Des colonnes nullables sans valeur par défaut ne réécrivent pas la table.

ALTER TABLE dossiers_legislatifs
  ADD COLUMN IF NOT EXISTS expose text,
  ADD COLUMN IF NOT EXISTS expose_texte_uid text,
  ADD COLUMN IF NOT EXISTS expose_lu_le timestamptz;
