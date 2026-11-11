-- 2026-09-20 : `nom_search` et `prenom_search` deviennent des colonnes générées
--
-- ORDRE D'APPLICATION : une seule transaction, à n'importe quel moment. La table ne
-- compte que 3 123 lignes, le verrou exclusif dure quelques dizaines de millisecondes.
-- Postgres ne sait pas convertir une colonne ordinaire en colonne générée : il faut
-- donc la retirer puis la recréer, ce qui la déplace en fin de table. Aucun `SELECT *`
-- ne lit `acteurs` dans le dépôt, la position n'a donc pas d'effet.
--
-- CONTRÔLES APRÈS :
--   - les deux colonnes sont générées :
--       SELECT column_name, is_generated FROM information_schema.columns
--       WHERE table_name = 'acteurs' AND column_name IN ('nom_search','prenom_search');
--   - les valeurs sont bien celles de l'expression de génération (doit rendre 0
--     sur les deux colonnes). La comparaison porte sur `translate`, et non sur
--     `lower(nom)` seul : sans lui le contrôle rend 281, c'est-à-dire le nombre
--     de noms accentués, et un opérateur en conclurait que la colonne est
--     corrompue alors qu'elle fait exactement son travail.
--       SELECT count(*) FROM acteurs
--       WHERE nom_search IS DISTINCT FROM lower(translate(nom,
--         'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿÇçÑñ',
--         'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuYyyCcNn'));
--       (puis la même requête sur prenom_search / prenom)
--   - un nom accentué se cherche sans accent :
--       SELECT nom, nom_search FROM acteurs WHERE nom_search = 'oudea-castera';
--   - les index de la table sont ceux d'avant. `DROP COLUMN` emporte en silence
--     tout index qui portait sur la colonne, et rien ne le signale : la
--     recherche redeviendrait un balayage séquentiel sans qu'une erreur
--     apparaisse. Au 2026-09-20 la table n'en porte aucun sur ces deux colonnes,
--     donc la liste doit être identique avant et après.
--       SELECT indexname FROM pg_indexes WHERE tablename = 'acteurs' ORDER BY 1;
--
-- POURQUOI. Les deux colonnes existaient, étaient remplies à 100 %, et n'étaient
-- écrites par personne : ni un script de `pipeline/`, ni une migration, ni une
-- expression de génération. Le prochain élu importé y aurait donc eu NULL, et serait
-- devenu invisible de toute recherche qui s'appuie dessus, sans erreur ni log. Le
-- serveur MCP est le premier lecteur de ces colonnes : les figer en générées est ce
-- qui rend ce lecteur sûr, au lieu d'ajouter un troisième endroit à tenir à jour.
--
-- POURQUOI `translate` ET NON `unaccent`. `unaccent()` n'est pas marquée IMMUTABLE,
-- parce qu'elle dépend d'un dictionnaire installé côté serveur : Postgres refuse de
-- s'en servir dans une colonne générée. `lower()` et `translate()` le sont, et la
-- table de caractères ci-dessous couvre les diacritiques du français, plus les
-- quelques caractères espagnols et portugais que portent des noms de parlementaires.
-- L'expression a été comparée au contenu existant avant d'écrire cette migration :
-- 0 divergence sur 3 123 lignes, pour `nom` comme pour `prenom`.

BEGIN;

ALTER TABLE public.acteurs DROP COLUMN nom_search;
ALTER TABLE public.acteurs DROP COLUMN prenom_search;

ALTER TABLE public.acteurs
  ADD COLUMN nom_search text
  GENERATED ALWAYS AS (
    lower(translate(
      nom,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿÇçÑñ',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuYyyCcNn'
    ))
  ) STORED;

ALTER TABLE public.acteurs
  ADD COLUMN prenom_search text
  GENERATED ALWAYS AS (
    lower(translate(
      prenom,
      'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿÇçÑñ',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOOooooooUUUUuuuuYyyCcNn'
    ))
  ) STORED;

COMMIT;
