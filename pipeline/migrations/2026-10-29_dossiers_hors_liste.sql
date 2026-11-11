-- 2026-10-29 : dossiers comptés dans le score mais absents de la liste des textes
--
-- POURQUOI. `import_lois_senat` (sync_senat.py) crée 214 dossiers de loi du Sénat
-- d'octobre 2023 à juillet 2024 que l'open data de l'Assemblée ne publie pas. Ils
-- doivent compter dans le score d'activité des sénateurs, qui couvre cette période,
-- mais la liste des textes ne montre que la législature en cours (choix d'Alex,
-- 2026-10-29). `legislature` ne pouvait pas servir de critère : il ne filtre rien
-- aujourd'hui, et 156 dossiers de l'Assemblée d'anciennes législatures, encore actifs
-- pendant la 17ᵉ, sont listés à bon droit.
--
-- Lu par la liste et ses compteurs (`/api/search-index/dossiers`), ses « plus
-- consultés », la recherche globale (`lib/search/dossier-resumes.ts`), le MCP
-- (`chercher_loi`, `actualite`), le fil du mois (`getMonthActes`), les lois
-- promulguées des pages Facts (`getLoisPromulguees`), et par les traitements de nuit
-- qui écartent ces dossiers (résumés IA, découpage et classement des articles,
-- presse). Le sitemap les écarte aussi. La fiche du dossier reste ouverte par son
-- adresse, et la fiche d'un élu garde ses liens.
--
-- Valeur par défaut constante : l'ajout ne réécrit pas la table (Postgres 11 et plus).

ALTER TABLE dossiers_legislatifs
  ADD COLUMN IF NOT EXISTS hors_liste boolean NOT NULL DEFAULT false;
