-- 2026-10-14 : retrait de `debat_interventions.texte` (seconde moitié)
--
-- POURQUOI. Depuis la migration du 2026-10-13 et la release v1.12.0, le texte des
-- débats vit dans le bucket Storage `debats`, un fichier par séance, et le site ne lit
-- plus que là. La colonne `texte` n'était plus qu'un doublon de 100 Mo, sur une base
-- plafonnée à 500, réécrit chaque nuit par l'import.
--
-- ORDRE D'APPLICATION. Quatre parties, appliquées en deux temps, jamais d'un bloc :
--   (a), (b), (c) avant de pousser l'import qui n'envoie plus `texte` : la colonne
--       étant NOT NULL, la base refuserait chacune de ses lignes ;
--   (d) seulement après qu'un vrai passage du cron a écrit des lignes sans `texte`,
--       avec leur `nb_mots`, et que leurs pages de séance s'affichent. C'est le seul
--       geste irréversible : avant lui, l'ancien import peut encore reprendre.
--
-- (b) NE PASSE PAS EN UNE REQUÊTE. Un UPDATE écrit une nouvelle version de chaque
-- ligne et garde l'ancienne jusqu'au VACUUM : sur 246 738 lignes d'un coup, la table
-- grossirait d'autant, au risque de franchir le plafond. Il a été passé par lots de
-- 20 000 `id`, avec un `VACUUM debat_interventions` entre deux pour que chaque lot
-- réutilise la place libérée par le précédent. La requête de (b) ci-dessous est celle
-- d'un lot, sans ses bornes d'`id`.
--
-- (d) VERROUILLE LA TABLE. `VACUUM FULL` la reconstruit à côté de l'ancienne (19 s
-- mesurées) : une page de séance régénérée pendant ce temps échoue, et Next garde la
-- précédente. Pendant ce temps, la base porte les deux copies (≈ 80 Mo de plus) ;
-- L'ancien hébergeur ne mesure la taille qu'une fois par jour, mais si la base passe en lecture
-- seule : `set default_transaction_read_only = 'off'`, elle est alors sous le plafond.
--
-- QUI ÉCRIT, QUI LIT. `nb_mots` est écrit par `pipeline/debats/import_debats.py`
-- (`nb_mots()`, même formule que ci-dessous) et lu par `recalc_nb_prises_parole()`,
-- appelée par l'import en fin de passe. Le texte est lu par `src/lib/debats-texte.ts`.

-- (a) L'import corrigé n'envoie plus `texte`.
alter table public.debat_interventions alter column texte drop not null;

-- (b) Remplissage de `nb_mots` sur les lignes écrites avant le 2026-10-13. Un lot :
--   update public.debat_interventions
--      set nb_mots = array_length(string_to_array(trim(texte), ' '), 1)
--    where nb_mots is null and texte is not null and id >= <début> and id < <début + 20000>;
--   vacuum public.debat_interventions;
-- Contrôle : 0 ligne où
--   texte is not null
--   and nb_mots is distinct from array_length(string_to_array(trim(texte), ' '), 1)
-- Sans `texte is not null`, chaque ligne écrite par l'import corrigé (texte NULL,
-- nb_mots rempli) compterait comme un écart.
update public.debat_interventions
   set nb_mots = array_length(string_to_array(trim(texte), ' '), 1)
 where nb_mots is null and texte is not null;

-- (c) Le décompte lit `nb_mots` au lieu de recalculer depuis `texte`. Contrôle passé :
-- décompte ancien et nouveau identiques pour chaque élu, 0 `nb_prises_parole` modifié.
-- Le reste de la fonction est identique à `2026-09-15_activite_ministres_presidents_groupe.sql`.
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
    GROUP BY i.acteur_uid
  ) sub
  WHERE a.uid = sub.acteur_uid;
END;
$function$;

-- (d) Après le cron de preuve uniquement (voir l'en-tête). Appliqué le 2026-10-15
-- vers 05 h UTC (le 14 au soir, heure de Seattle), après une relance de l'étape `debats` qui a réécrit 4 séances (1 197 lignes sans
-- `texte`, toutes avec `nb_mots`) : base 422 → 277 Mo, table 228 → 82 Mo, VACUUM FULL
-- en 19 s.
alter table public.debat_interventions drop column if exists texte;

comment on column public.debat_interventions.nb_mots is
  'Nombre de mots du texte de l''intervention, calculé par l''import (nb_mots() de import_debats.py) : lu par recalc_nb_prises_parole().';

-- À exécuter seul, dans une exécution à part : Postgres refuse un VACUUM à l'intérieur
-- d'un bloc de transaction, et plusieurs instructions envoyées ensemble en forment un
-- (« VACUUM cannot run inside a transaction block »). Collé avec les lignes du dessus,
-- il ferait échouer tout le bloc (d).
vacuum full public.debat_interventions;
