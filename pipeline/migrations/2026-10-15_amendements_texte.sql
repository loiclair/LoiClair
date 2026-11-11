-- Le texte des amendements adoptés, pour le classement des articles par profil de
-- lecteur (« Ce qui me concerne ») : l'IA lit ce que l'amendement change et
-- pourquoi, en plus de l'article qu'il vise.
--
-- Texte brut, pas le HTML de la source : un paragraphe par ligne, un tableau rendu
-- une rangée par ligne avec ses cellules séparées par « | ». Les mouvements de
-- crédits des lois de finances de l'Assemblée, publiés en données et non en HTML,
-- sont rendus en lignes de texte. Écrites par `import_amendements.py`.
--
-- Mesuré le 2026-10-15 : environ 46 Mo de texte brut pour les adoptés en base, soit
-- environ 30 Mo une fois compressé par Postgres. Seule `/api/ce-qui-me-concerne/element`
-- lit `dispositif`, à la demande ; la fiche dossier sélectionne ses colonnes par nom.

alter table public.amendements
  -- Ce que l'amendement change dans le texte. NULL si la source n'en publie pas.
  add column if not exists dispositif text,
  -- L'exposé des motifs (« objet » au Sénat). NULL si la source n'en publie pas.
  add column if not exists expose     text;
