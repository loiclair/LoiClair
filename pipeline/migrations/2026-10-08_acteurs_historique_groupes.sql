-- 2026-10-08 : `acteurs.historique_groupes`, les groupes d'un élu dans le temps
--
-- POURQUOI. `acteurs.groupe` ne garde que le groupe en cours. Une proposition de loi
-- rangée par ce seul champ tombait dans le groupe d'aujourd'hui de son auteur, ou dans
-- aucun quand l'auteur n'a plus de groupe : 396 propositions de la 17ᵉ législature
-- étaient sans groupe le 2026-10-08 (sénateurs renouvelés dont l'AMO a clos le groupe
-- sans publier le nouveau, auteurs partis, auteurs devenus ministres). L'historique
-- permet de ranger chaque texte dans le groupe de son auteur le jour du dépôt.
--
-- LE FORMAT. Liste triée de `{"debut": "YYYY-MM-DD", "fin": "YYYY-MM-DD" | null,
-- "groupe": "<uid d'organe>"}`, bornes incluses, `fin` à null pour une appartenance en
-- cours. Seuls les mandats `GP` (Assemblée) et `GROUPESENAT` (Sénat) y entrent, clos
-- compris. Null pour un acteur sans aucun de ces mandats.
--
-- QUI ÉCRIT, QUI LIT. Écrite chaque nuit par `import_acteurs_organes_cloud.py`, depuis
-- l'AMO30 seul (l'AMO20, importé après lui, ne connaît que les groupes récents et
-- effacerait les anciens : voir `URL_AMO30`). Lue par `import_dossiers_cloud.py`. Le
-- site ne la lit pas.
--
-- LES DÉPENDANCES. Ajout de colonne seulement : `activite_elus_mv`, seule vue sur
-- `acteurs`, nomme ses colonnes et n'est pas touchée.

alter table public.acteurs add column if not exists historique_groupes jsonb;

comment on column public.acteurs.historique_groupes is
  'Groupes politiques de l''acteur dans le temps : liste triée de {debut, fin, groupe}, '
  'dates ISO au jour, bornes incluses, fin null si en cours, groupe = uid d''organe GP '
  'ou GROUPESENAT. Écrite par import_acteurs_organes_cloud.py depuis l''AMO30 seul, lue par '
  'import_dossiers_cloud.py pour ranger une proposition dans le groupe de son auteur '
  'au jour du dépôt.';
