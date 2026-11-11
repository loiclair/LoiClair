-- Ce que LoiClair a constaté sur une ligne du Répertoire national des élus, quand le
-- registre est en retard sur la réalité ou se trompe. Le RNE ne paraît que tous les
-- trois mois environ : au 23 octobre 2026, 19 des 71 situations que
-- /Facts/cumul-des-mandats nommait d'après la version d'août étaient terminées, en
-- partie ou en entier, ou fausses.
--
-- La ligne du registre reste telle quelle, et ces colonnes disent à côté ce qui a
-- changé et d'où on le tient : la page, la fiche élu et le serveur MCP montrent les
-- deux, la donnée officielle et sa correction sourcée.
--
-- Écrites par `import_rne.py` seul, d'après `pipeline/corrections_rne.json` :
-- à chaque import, une ligne absente du fichier repasse à NULL. Lues par
-- `enVigueur` (`src/lib/mandats-locaux.ts`).
--
-- Quatre colonnes nullables sans valeur par défaut : Postgres les ajoute sans
-- réécrire la table, et le site en ligne, qui ne les lit pas encore, n'en voit rien.

alter table public.mandats_locaux
  -- fonction_quittee : la fonction de direction est quittée, le siège reste.
  -- mandat_quitte : le siège lui-même est quitté.
  -- fonction_jamais_exercee : le registre prête une fonction que l'élu n'a pas eue.
  add column if not exists verif_effet text
    constraint mandats_locaux_verif_effet_check
    check (verif_effet in ('fonction_quittee', 'mandat_quitte', 'fonction_jamais_exercee')),
  -- Date du changement d'après la source. NULL quand aucune source ne la donne :
  -- l'écran dit alors « constaté le » avec la date de la dernière vérification.
  add column if not exists verif_date date,
  add column if not exists verif_source_url text,
  add column if not exists verif_source_nom text;
