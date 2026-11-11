-- 2026-10-15 : un sénateur en exercice ne compte pas ses prises de parole à l'Assemblée
--
-- POURQUOI. Le cas inverse de `2026-10-15_prises_parole_deputes_senat.sql`, que son
-- en-tête laissait à part. Neuf sénateurs élus le 1er octobre 2026 étaient députés
-- jusqu'à la veille, et `recalc_nb_prises_parole()` leur comptait toutes leurs
-- interventions à l'Assemblée depuis le 2024-07-18 (jusqu'à 75 le 2026-10-15). La
-- méthodologie de /Activite promet le mandat actuel : un élu qui change de chambre
-- repart de zéro. Les dix autres indicateurs et les jours actifs suivent la même règle
-- depuis le même jour (import des élus, des amendements, des questions, des scrutins,
-- `sync_senat.py`, et `2026-10-15_activite_mandat_chambre_actuelle.sql`).
--
-- Les élus qui ne siègent plus gardent toujours les deux chambres, comme dans la
-- migration précédente.
--
-- À appliquer à la main, puis
-- `select public.recalc_nb_prises_parole();`. Aucun ordre à respecter avec le code :
-- la fonction est aussi rappelée en fin de chaque import des débats.
--
-- Le reste de la fonction est identique à `2026-10-15_prises_parole_deputes_senat.sql`
-- (comparée à `pg_get_functiondef` en base le 2026-10-15 : égale).
CREATE OR REPLACE FUNCTION public.recalc_nb_prises_parole()
 RETURNS void
 LANGUAGE plpgsql
 SET statement_timeout TO '60s'
AS $function$
BEGIN
  UPDATE acteurs SET nb_prises_parole = 0 WHERE nb_prises_parole > 0;

  UPDATE acteurs a SET nb_prises_parole = sub.cnt
  FROM (
    SELECT i.acteur_uid, count(*) AS cnt
    FROM debat_interventions i
    JOIN debat_seances s ON s.uid = i.seance_uid
    JOIN acteurs e ON e.uid = i.acteur_uid
    WHERE i.acteur_uid IS NOT NULL
      AND coalesce(i.role_debat, '') <> 'president'
      AND coalesce(i.orateur_qualite, '') NOT IN ('président de séance', 'didascalie')
      -- Intervention faite comme membre du Gouvernement : voir l'en-tête de la
      -- migration du 2026-09-15. Les motifs sont ancrés au début, « rapporteur » ou
      -- « président de la commission » ne commençant par aucun d'eux. `secrétaire d`
      -- seul est une qualité tronquée à l'apostrophe dans les comptes rendus du Sénat
      -- en base (« secrétaire d'État », Olivier Dussopt en 2019).
      AND NOT (
        coalesce(i.orateur_qualite, '') ILIKE 'ministre%'
        OR coalesce(i.orateur_qualite, '') ILIKE 'premier ministre%'
        OR coalesce(i.orateur_qualite, '') ILIKE 'première ministre%'
        OR coalesce(i.orateur_qualite, '') ILIKE 'garde des sceaux%'
        OR coalesce(i.orateur_qualite, '') ILIKE 'secrétaire d%tat%'
        OR coalesce(i.orateur_qualite, '') = 'secrétaire d'
      )
      AND i.nb_mots > 20
      -- Fenêtre du mandat en cours, chambre par chambre : dernière élection sénatoriale
      -- pour le Sénat, ouverture de la 17ᵉ législature pour l'Assemblée.
      AND (s.chambre <> 'SEN' OR s.date_seance >= DATE '2023-10-02')
      AND (s.chambre <> 'AN' OR s.date_seance >= DATE '2024-07-18')
      -- Élu en exercice : les seules interventions de sa chambre actuelle (voir
      -- l'en-tête de cette migration et de la précédente).
      AND NOT (s.chambre = 'SEN' AND coalesce(e.est_depute_actuel, false))
      AND NOT (s.chambre = 'AN' AND coalesce(e.est_senateur_actuel, false))
    GROUP BY i.acteur_uid
  ) sub
  WHERE a.uid = sub.acteur_uid;
END;
$function$;
