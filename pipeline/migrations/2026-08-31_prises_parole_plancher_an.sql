-- 2026-08-31 — `recalc_nb_prises_parole()` : plancher de date explicite côté AN
--
-- La fonction ne bornait que le Sénat. Côté Assemblée, la fenêtre du compteur n'était
-- juste que par accident : `debat_seances` ne contient aucune séance AN antérieure au
-- 9 octobre 2024, faute de source plus ancienne. Le jour où des comptes rendus de la
-- 16ᵉ législature entreraient en base, les députés réélus verraient leurs interventions
-- d'avant juillet 2024 comptées dans un dénominateur (`jours_actifs`) qui démarre à
-- l'ouverture de la 17ᵉ, et rien ne le signalerait.
--
-- Zéro ligne modifiée au moment de l'écriture : c'est une ceinture de sécurité, pas une
-- correction. Le reste de la fonction est inchangé, y compris le `SET statement_timeout`
-- de D-036 (le rôle pipeline plafonne à 8 s, le recalcul en prend ~13).

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
    WHERE i.acteur_uid IS NOT NULL
      AND coalesce(i.role_debat, '') <> 'president'
      AND coalesce(i.orateur_qualite, '') NOT IN ('président de séance', 'didascalie')
      AND array_length(string_to_array(trim(i.texte), ' '), 1) > 20
      -- Fenêtre du mandat en cours, chambre par chambre : dernière élection sénatoriale
      -- pour le Sénat, ouverture de la 17ᵉ législature pour l'Assemblée.
      AND (s.chambre <> 'SEN' OR s.date_seance >= DATE '2023-10-02')
      AND (s.chambre <> 'AN' OR s.date_seance >= DATE '2024-07-18')
    GROUP BY i.acteur_uid
  ) sub
  WHERE a.uid = sub.acteur_uid;
END;
$function$;
