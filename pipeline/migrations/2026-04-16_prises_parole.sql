-- Migration : compteur `nb_prises_parole` sur `acteurs` + mise à jour RPC `get_activite_elus`
-- À appliquer à la main avant le déploiement.
--
-- Objet : ajouter une 9e métrique au score d'activité — le nombre de prises de parole
--          en hémicycle contenant plus de 20 mots (hors présidence de séance et didascalies).
-- Couverture : 95 % des députés et 69 % des sénateurs ont au moins 1 intervention éligible.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Colonne sur `acteurs`
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.acteurs
  ADD COLUMN IF NOT EXISTS nb_prises_parole integer NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Peuplement depuis `debat_interventions`
-- ────────────────────────────────────────────────────────────────────────────
UPDATE acteurs a SET nb_prises_parole = sub.cnt
FROM (
  SELECT acteur_uid, count(*) AS cnt
  FROM debat_interventions
  WHERE acteur_uid IS NOT NULL
    AND coalesce(role_debat, '') <> 'president'
    AND coalesce(orateur_qualite, '') NOT IN ('président de séance', 'didascalie')
    AND array_length(string_to_array(trim(texte), ' '), 1) > 20
  GROUP BY acteur_uid
) sub
WHERE a.uid = sub.acteur_uid;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RPC `get_activite_elus`
--
-- Modifications par rapport à la version précédente :
--   • RETURN TABLE : ajouter  nb_prises_parole  integer
--   • active_acteurs CTE : ajouter  a.nb_prises_parole
--   • SELECT final : ajouter  aa.nb_prises_parole
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_activite_elus();

CREATE OR REPLACE FUNCTION public.get_activite_elus()
 RETURNS TABLE(uid text, prenom text, nom text, groupe text, chambre text, taux_participation_votes_finaux numeric, nb_dossiers_inities bigint, nb_textes_cosignes bigint, nb_rapporteur bigint, nb_amendements_auteur integer, nb_amendements_cosignataire integer, nb_questions_orales integer, nb_questions_ecrites integer, nb_prises_parole integer)
 LANGUAGE sql
 STABLE
AS $function$
WITH active_acteurs AS (
  SELECT
    a.uid,
    a.prenom,
    a.nom,
    a.groupe,
    CASE WHEN a.est_depute_actuel THEN 'AN' ELSE 'SN' END AS chambre,
    a.taux_participation_votes_finaux,
    a.nb_amendements_auteur,
    a.nb_amendements_cosignataire,
    a.nb_questions_orales,
    a.nb_questions_ecrites,
    a.nb_prises_parole
  FROM acteurs a
  WHERE (a.est_depute_actuel = true OR a.est_senateur_actuel = true)
    AND (a.est_ministre_actuel IS NULL OR a.est_ministre_actuel = false)
),
dossiers_count AS (
  SELECT dl.initiateur_acteur_ref AS uid, COUNT(*) AS cnt
  FROM dossiers_legislatifs dl
  WHERE dl.initiateur_acteur_ref IN (SELECT uid FROM active_acteurs)
  GROUP BY dl.initiateur_acteur_ref
),
initiated_pairs AS (
  SELECT dl.initiateur_acteur_ref AS acteur_uid, dl.uid AS dossier_uid
  FROM dossiers_legislatifs dl
  WHERE dl.initiateur_acteur_ref IN (SELECT uid FROM active_acteurs)
),
cosigned_count AS (
  SELECT exp.a_uid, COUNT(*) AS cnt
  FROM (
    SELECT unnest(t.auteurs_refs) AS a_uid, t.dossier_ref
    FROM textes t
    WHERE t.auteurs_refs IS NOT NULL
  ) exp
  INNER JOIN active_acteurs aa ON aa.uid = exp.a_uid
  WHERE NOT EXISTS (
    SELECT 1 FROM initiated_pairs ip
    WHERE ip.acteur_uid = exp.a_uid
      AND ip.dossier_uid = exp.dossier_ref
  )
  GROUP BY exp.a_uid
),
rapporteur_count AS (
  SELECT exp.a_uid, COUNT(DISTINCT exp.dossier_ref) AS cnt
  FROM (
    SELECT unnest(t.rapporteurs_refs) AS a_uid, t.dossier_ref
    FROM textes t
    WHERE t.rapporteurs_refs IS NOT NULL
      AND t.type_libelle ILIKE '%rapport%'
      AND t.denomination NOT ILIKE 'Annexe%'
  ) exp
  INNER JOIN active_acteurs aa ON aa.uid = exp.a_uid
  GROUP BY exp.a_uid
)
SELECT
  aa.uid,
  aa.prenom,
  aa.nom,
  aa.groupe,
  aa.chambre,
  aa.taux_participation_votes_finaux,
  COALESCE(dc.cnt, 0)::bigint,
  COALESCE(cc.cnt, 0)::bigint,
  COALESCE(rc.cnt, 0)::bigint,
  aa.nb_amendements_auteur,
  aa.nb_amendements_cosignataire,
  aa.nb_questions_orales,
  aa.nb_questions_ecrites,
  aa.nb_prises_parole
FROM active_acteurs aa
LEFT JOIN dossiers_count   dc ON dc.uid   = aa.uid
LEFT JOIN cosigned_count   cc ON cc.a_uid = aa.uid
LEFT JOIN rapporteur_count rc ON rc.a_uid = aa.uid
ORDER BY aa.nom, aa.prenom;
$function$;
