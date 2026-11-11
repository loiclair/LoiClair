-- 2026-10-15 : un député en exercice ne compte pas ses prises de parole au Sénat
--
-- POURQUOI. `recalc_nb_prises_parole()` additionne les deux chambres, chacune dans sa
-- fenêtre. Or `/Activite#methodologie` promet que toutes les métriques sont calculées
-- sur le mandat actuel de l'élu. Depuis que `import_acteurs_organes_cloud.py` remplit
-- `matricule_senat` pour les anciens sénateurs, les interventions au Sénat des députés
-- qui y ont siégé depuis le 2023-10-02 se relient à leur fiche : 2 députés le
-- 2026-10-15, dont le compteur passait de 28 à 78 et de 22 à 25. Cette migration les
-- ramène à leur seul mandat de député. Même règle que pour `nb_commission_presences`,
-- que `sync_senat.py` n'écrit plus pour un député en exercice.
--
-- LE CAS INVERSE N'EST PAS TRAITÉ ICI. Les sénateurs élus en 2026 qui étaient députés
-- (9 le 2026-10-15) gardent leurs interventions à l'Assemblée. Les retirer seules ne
-- corrigerait rien : leurs dix autres indicateurs et leurs jours actifs viennent aussi
-- de leur mandat de député. Leur correction, sur les onze indicateurs d'un bloc, est
-- une tâche à part.
--
-- Les élus qui ne siègent plus (anciens parlementaires, ministres) gardent les deux
-- chambres : ils ne sont pas dans le score, et leur fiche montre ce qu'ils ont dit.
--
-- À appliquer à la main, puis
-- `select public.recalc_nb_prises_parole();`. Aucun ordre à respecter avec le code :
-- la fonction est aussi rappelée en fin de chaque import des débats.
--
-- Le reste de la fonction est identique à `2026-10-14_debats_retrait_texte.sql`.
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
      -- Député en exercice : pas ses interventions au Sénat (voir l'en-tête).
      AND NOT (s.chambre = 'SEN' AND coalesce(e.est_depute_actuel, false))
    GROUP BY i.acteur_uid
  ) sub
  WHERE a.uid = sub.acteur_uid;
END;
$function$;
