-- Migration : recalcul automatique de `nb_prises_parole` à chaque sync nocturne.
--
-- Problème corrigé :
--   1. La migration du 16 avril 2026 calculait `nb_prises_parole` une seule fois
--      (one-shot). Les interventions importées ensuite n'étaient pas comptées.
--   2. Aucun filtre temporel : pour les sénateurs, des interventions des mandats
--      antérieurs (2017-2020, 2014-2017, etc.) étaient mélangées avec celles du
--      mandat actuel — comparaison faussée entre élus.
--
-- Solution :
--   - Fonction PL/pgSQL `recalc_nb_prises_parole()` qui réinitialise puis recompte.
--   - Filtre Sénat : on ne compte que les interventions à partir du 2023-10-02
--     (prise de fonction des sénateurs élus le 24-09-2023, série 1). Même date
--     que la métrique `nb_commission_presences` pour cohérence inter-scores.
--   - Filtre AN : aucun (la 17e législature a démarré le 9 octobre 2024 et toutes
--     les interventions AN dans la base sont postérieures).
--
-- À exécuter : depuis le pipeline `pipeline/debats/import_debats.py`
-- (appel `sb.rpc('recalc_nb_prises_parole').execute()` à la fin de `main()`).

-- Le scan complet de `debat_interventions` (~205k lignes) avec calcul de longueur
-- de chaque texte met ~7-13s. On override le statement_timeout (8s pour le rôle
-- du pipeline) au niveau de la fonction.

CREATE OR REPLACE FUNCTION public.recalc_nb_prises_parole()
RETURNS void
LANGUAGE plpgsql
SET statement_timeout TO '60s'
AS $$
BEGIN
  UPDATE acteurs SET nb_prises_parole = 0 WHERE nb_prises_parole > 0;

  UPDATE acteurs a SET nb_prises_parole = sub.cnt
  FROM (
    SELECT i.acteur_uid, count(*) AS cnt
    FROM debat_interventions i
    JOIN debat_seances s ON s.uid = i.seance_uid
    WHERE i.acteur_uid IS NOT NULL
      AND coalesce(i.role_debat, '') <> 'president'
      AND coalesce(i.orateur_qualite, '') NOT IN ('président de séance', 'didascalie')
      AND array_length(string_to_array(trim(i.texte), ' '), 1) > 20
      AND (s.chambre <> 'SEN' OR s.date_seance >= DATE '2023-10-02')
    GROUP BY i.acteur_uid
  ) sub
  WHERE a.uid = sub.acteur_uid;
END;
$$;
