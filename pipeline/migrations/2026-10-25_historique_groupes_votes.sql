-- 2026-10-25 : le volet de détail d'un vote lit aussi `acteurs.historique_groupes`
--
-- POURQUOI. `/api/scrutin-votes` rangeait chaque nom du volet sous `acteurs.groupe`, le
-- groupe actuel : un député élu sénateur depuis apparaissait sous un groupe du Sénat
-- dans un vote de l'Assemblée, et un élu qui avait changé de groupe gonflait le
-- décompte du nouveau. La route range désormais chaque nom sous le groupe que cette
-- colonne lui donne le jour du scrutin (`groupeAuJour`, `src/lib/groupe-au-jour.ts`,
-- D-278). Un agent qui changerait le format de la colonne en croyant ne toucher qu'aux
-- imports casserait aussi le volet.
--
-- CETTE MIGRATION ne change que le commentaire de la colonne. Aucune donnée touchée.
--
-- QUI ÉCRIT, QUI LIT. Écrite par `import_acteurs_organes_cloud.py` (AMO30 seul). Lue
-- par `import_dossiers_cloud.py`, `sync_senat.py` (groupe au dépôt, D-209),
-- `/api/resume-debats` et la page de séance (groupe au jour de la séance, D-278), et
-- `/api/scrutin-votes` (groupe au jour du vote, D-278).

comment on column public.acteurs.historique_groupes is
  'Groupes politiques de l''acteur dans le temps : liste triée de {debut, fin, groupe}, '
  'dates ISO au jour, bornes incluses, fin null si en cours, groupe = uid d''organe GP '
  'ou GROUPESENAT, toujours l''uid actif (GROUPE_ALIAS appliqué à l''écriture : un lecteur '
  'n''a pas d''alias à connaître). Écrite par import_acteurs_organes_cloud.py depuis l''AMO30 '
  'seul. Lue par import_dossiers_cloud.py et sync_senat.py (groupe d''un texte au jour du '
  'dépôt, D-209), par src/lib/groupe-au-jour.ts pour /api/resume-debats et la page de séance '
  '(groupe d''un orateur au jour de la séance, D-278), et pour /api/scrutin-votes (groupe '
  'd''un élu au jour du vote, D-278).';
