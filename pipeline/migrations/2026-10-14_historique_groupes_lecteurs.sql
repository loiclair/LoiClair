-- 2026-10-14 : le site lit aussi `acteurs.historique_groupes`
--
-- POURQUOI. Le commentaire posé par `2026-10-08_acteurs_historique_groupes.sql` disait
-- « le site ne la lit pas ». `/api/resume-debats` la lit désormais, par
-- `src/lib/groupe-au-jour.ts`, pour écrire dans l'en-tête de chaque intervention le
-- groupe de l'orateur au jour de la séance (D-233) : un agent qui changerait le format
-- de la colonne en croyant ne toucher qu'aux imports casserait la synthèse des débats.
--
-- CETTE MIGRATION ne change que le commentaire de la colonne. Aucune donnée touchée.
--
-- QUI ÉCRIT, QUI LIT. Écrite par `import_acteurs_organes_cloud.py` (AMO30 seul). Lue
-- par `import_dossiers_cloud.py`, `sync_senat.py` (groupe au dépôt, D-209) et
-- `/api/resume-debats` (groupe au jour de la séance, D-233).

comment on column public.acteurs.historique_groupes is
  'Groupes politiques de l''acteur dans le temps : liste triée de {debut, fin, groupe}, '
  'dates ISO au jour, bornes incluses, fin null si en cours, groupe = uid d''organe GP '
  'ou GROUPESENAT. Écrite par import_acteurs_organes_cloud.py depuis l''AMO30 seul. Lue par '
  'import_dossiers_cloud.py et sync_senat.py (groupe d''un texte au jour du dépôt, D-209), '
  'et par /api/resume-debats via src/lib/groupe-au-jour.ts (groupe d''un orateur au jour de la séance, D-233).';
