-- 2026-04-25 — Filtre par mandat actuel pour les métriques rattachables
--
-- Contexte : le RPC get_activite_elus() comptait des dossiers/textes/rapports
-- antérieurs au mandat actuel des élus, ce qui avantageait les sortants réélus
-- (ex: 68 rapports antérieurs à oct 2023 attribués à des sénateurs actuels).
--
-- Décision : filtrer par date_depot du dossier/texte selon sa chambre :
--   - Texte/dossier AN  : date_depot >= 2024-07-18 (début 17e législature)
--   - Texte/dossier SN  : date_depot >= 2023-10-02 (dernière élection sénatoriale)
-- Cohérent avec les bornes déjà appliquées sur questions, prises de parole
-- et présences en commission.
--
-- Pour les dossiers initiés : la chambre est déterminée par celle de l'initiateur
-- (active_acteurs.chambre). Pour les textes (cosignes/rapporteur) : par textes.chambre.

CREATE OR REPLACE FUNCTION public.get_activite_elus()
 RETURNS TABLE(uid text, prenom text, nom text, groupe text, chambre text,
   taux_participation_votes_finaux numeric, nb_dossiers_inities bigint,
   nb_textes_cosignes bigint, nb_rapporteur bigint,
   nb_amendements_auteur integer, nb_amendements_cosignataire integer,
   nb_questions_orales integer, nb_questions_ecrites integer,
   nb_prises_parole integer, nb_commission_presences integer)
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
    a.nb_prises_parole,
    a.nb_commission_presences
  FROM acteurs a
  WHERE (a.est_depute_actuel = true OR a.est_senateur_actuel = true)
    AND (a.est_ministre_actuel IS NULL OR a.est_ministre_actuel = false)
),
dossiers_count AS (
  SELECT dl.initiateur_acteur_ref AS uid, COUNT(*) AS cnt
  FROM dossiers_legislatifs dl
  INNER JOIN active_acteurs aa ON aa.uid = dl.initiateur_acteur_ref
  WHERE (
    (aa.chambre = 'AN' AND dl.date_depot >= DATE '2024-07-18')
    OR
    (aa.chambre = 'SN' AND dl.date_depot >= DATE '2023-10-02')
  )
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
      AND (
        (t.chambre = 'Sénat' AND t.date_depot >= DATE '2023-10-02')
        OR (t.chambre <> 'Sénat' AND t.date_depot >= DATE '2024-07-18')
      )
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
      AND (
        (t.chambre = 'Sénat' AND t.date_depot >= DATE '2023-10-02')
        OR (t.chambre <> 'Sénat' AND t.date_depot >= DATE '2024-07-18')
      )
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
  aa.nb_prises_parole,
  aa.nb_commission_presences
FROM active_acteurs aa
LEFT JOIN dossiers_count   dc ON dc.uid   = aa.uid
LEFT JOIN cosigned_count   cc ON cc.a_uid = aa.uid
LEFT JOIN rapporteur_count rc ON rc.a_uid = aa.uid
ORDER BY aa.nom, aa.prenom;
$function$;
