-- 2026-11-05 : un paragraphe ne compte qu'une prise de parole
--
-- POURQUOI. `parse_an.py` écrit un paragraphe une fois par numéro de texte discuté. Dans
-- une discussion commune de deux dossiers, il garde donc une ligne par dossier, et chaque
-- fiche de dossier a raison de le montrer. Mais `recalc_nb_prises_parole()` compte des
-- lignes, pas des paragraphes : 1 920 lignes de plus de 20 mots comptaient double au
-- 2026-11-05, sur 247 élus, dont 950 entre deux dossiers. L'import retire désormais les
-- 970 autres, rattachées deux fois au même dossier (`map_nums_to_dossiers`).
--
-- La ligne écartée est celle qui suit, dans la séance, une ligne du même orateur au même
-- texte. Trois `ordre` en arrière et non un seul : l'import laisse un trou quand il retire
-- une ligne, et aucun paragraphe de la base ne porte plus de trois numéros de texte
-- (relevé le 2026-11-05 : 2 278 lignes à un `ordre` d'écart, aucune à deux ou trois). À
-- quatre et cinq, ce sont des phrases répétées, qui comptent chacune. La sous-requête suit
-- l'index unique `(seance_uid, ordre)` : 2,3 s sur la table entière, loin des 60 s permises.
--
-- Change le score : `ACTIVITE_METHODE_MAJ` passe au 2026-11-05 dans le même commit.
--
-- À appliquer puis `select public.recalc_nb_prises_parole();`. Aucun ordre à respecter
-- avec le code : la fonction est aussi rappelée en fin de chaque import des débats.
--
-- Le reste de la fonction est identique à `2026-10-15_prises_parole_senateurs_an.sql`
-- (comparée à `pg_get_functiondef` en base le 2026-11-05 : égale).
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
      -- Un paragraphe rattaché à plusieurs textes ne compte qu'une fois (en-tête).
      AND NOT EXISTS (
        SELECT 1 FROM debat_interventions p
        WHERE p.seance_uid = i.seance_uid
          AND p.ordre BETWEEN i.ordre - 3 AND i.ordre - 1
          AND p.acteur_uid = i.acteur_uid
          AND p.texte = i.texte
      )
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
