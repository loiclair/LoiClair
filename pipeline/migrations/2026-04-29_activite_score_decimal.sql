-- 2026-04-29 — Score composite à 1 décimale (au lieu de l'entier)
--
-- Seul le bloc de calcul du score final change dans la CTE `scored` :
--   FLOOR((SUM(v * w) / SUM(w))::numeric + 0.5)::int   (avant)
--   ROUND((SUM(v * w) / NULLIF(SUM(w), 0))::numeric, 1) (après)
--
-- Les centiles individuels (cp_*) restent des entiers 1–100.
-- La colonne `score` passe de int à numeric, ce qui est transparent
-- côté TypeScript (retourné comme float JavaScript).
-- DENSE_RANK sur le score décimal réduit naturellement les ex-æquo.

DROP MATERIALIZED VIEW IF EXISTS public.activite_elus_mv;

CREATE MATERIALIZED VIEW public.activite_elus_mv AS
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
    a.nb_commission_presences,
    a.date_debut_mandat,
    a.periodes_mandat_assemblee
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
),
brut AS (
  SELECT
    aa.uid,
    aa.prenom,
    aa.nom,
    aa.groupe,
    aa.chambre,
    aa.taux_participation_votes_finaux,
    COALESCE(dc.cnt, 0)::bigint            AS nb_dossiers_inities,
    COALESCE(cc.cnt, 0)::bigint            AS nb_textes_cosignes,
    COALESCE(rc.cnt, 0)::bigint            AS nb_rapporteur,
    aa.nb_amendements_auteur,
    aa.nb_amendements_cosignataire,
    aa.nb_questions_orales,
    aa.nb_questions_ecrites,
    aa.nb_prises_parole,
    aa.nb_commission_presences,
    aa.date_debut_mandat,
    COALESCE(
      (
        SELECT SUM(GREATEST(0,
          (LEAST(COALESCE((p->>'fin')::date, CURRENT_DATE), CURRENT_DATE)
           - GREATEST(
               (p->>'debut')::date,
               CASE aa.chambre WHEN 'AN' THEN DATE '2024-07-18' ELSE DATE '2023-10-02' END
             ))::int
        ))
        FROM jsonb_array_elements(aa.periodes_mandat_assemblee) p
      ),
      GREATEST(0, (CURRENT_DATE - GREATEST(
        aa.date_debut_mandat,
        CASE aa.chambre WHEN 'AN' THEN DATE '2024-07-18' ELSE DATE '2023-10-02' END
      ))::int)
    )::int AS jours_actifs
  FROM active_acteurs aa
  LEFT JOIN dossiers_count   dc ON dc.uid   = aa.uid
  LEFT JOIN cosigned_count   cc ON cc.a_uid = aa.uid
  LEFT JOIN rapporteur_count rc ON rc.a_uid = aa.uid
),
taux AS (
  SELECT
    b.*,
    b.nb_dossiers_inities::numeric         / NULLIF(b.jours_actifs, 0) AS taux_doss,
    b.nb_textes_cosignes::numeric          / NULLIF(b.jours_actifs, 0) AS taux_cosign,
    b.nb_rapporteur::numeric               / NULLIF(b.jours_actifs, 0) AS taux_rapp,
    b.nb_amendements_auteur::numeric       / NULLIF(b.jours_actifs, 0) AS taux_amend_auteur,
    b.nb_amendements_cosignataire::numeric / NULLIF(b.jours_actifs, 0) AS taux_amend_cosign,
    b.nb_questions_orales::numeric         / NULLIF(b.jours_actifs, 0) AS taux_quest_o,
    b.nb_questions_ecrites::numeric        / NULLIF(b.jours_actifs, 0) AS taux_quest_e,
    b.nb_prises_parole::numeric            / NULLIF(b.jours_actifs, 0) AS taux_prises_parole,
    b.nb_commission_presences::numeric     / NULLIF(b.jours_actifs, 0) AS taux_comm_pres
  FROM brut b
),
eligible AS (
  SELECT * FROM taux WHERE jours_actifs >= 180
),
centiles AS (
  SELECT
    e.uid,
    CASE WHEN e.taux_participation_votes_finaux IS NULL THEN NULL
         ELSE FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_participation_votes_finaux, 0)) * 100 + 0.5)::int
    END AS cp_part,
    FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_doss, 0))         * 100 + 0.5)::int AS cp_doss,
    FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_cosign, 0))       * 100 + 0.5)::int AS cp_cosign,
    FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_rapp, 0))         * 100 + 0.5)::int AS cp_rapp,
    FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_amend_auteur, 0)) * 100 + 0.5)::int AS cp_amend_auteur,
    FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_amend_cosign, 0)) * 100 + 0.5)::int AS cp_amend_cosign,
    FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_quest_o, 0))      * 100 + 0.5)::int AS cp_quest_o,
    FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_quest_e, 0))      * 100 + 0.5)::int AS cp_quest_e,
    FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_prises_parole, 0)) * 100 + 0.5)::int AS cp_prises_parole,
    CASE WHEN e.nb_commission_presences IS NULL THEN NULL
         ELSE FLOOR(CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_comm_pres, 0)) * 100 + 0.5)::int
    END AS cp_comm_pres
  FROM eligible e
),
scored AS (
  SELECT
    t.uid,
    t.prenom,
    t.nom,
    t.groupe,
    t.chambre,
    t.taux_participation_votes_finaux,
    t.nb_dossiers_inities,
    t.nb_textes_cosignes,
    t.nb_rapporteur,
    t.nb_amendements_auteur,
    t.nb_amendements_cosignataire,
    t.nb_questions_orales,
    t.nb_questions_ecrites,
    t.nb_prises_parole,
    t.nb_commission_presences,
    t.date_debut_mandat,
    t.jours_actifs,
    c.cp_part,
    c.cp_doss,
    c.cp_cosign,
    c.cp_rapp,
    c.cp_amend_auteur,
    c.cp_amend_cosign,
    c.cp_quest_o,
    c.cp_quest_e,
    c.cp_prises_parole,
    c.cp_comm_pres,
    CASE WHEN t.jours_actifs < 180 THEN NULL
    ELSE (
      SELECT ROUND((SUM(v * w) / NULLIF(SUM(w), 0))::numeric, 1)
      FROM (VALUES
        (c.cp_part,           2.0::numeric),
        (c.cp_doss,           2.0::numeric),
        (c.cp_cosign,         0.5::numeric),
        (c.cp_rapp,           2.0::numeric),
        (c.cp_amend_auteur,   1.0::numeric),
        (c.cp_amend_cosign,   0.25::numeric),
        (c.cp_quest_o,        0.5::numeric),
        (c.cp_quest_e,        0.25::numeric),
        (c.cp_prises_parole,  0.75::numeric),
        (c.cp_comm_pres,      0.75::numeric)
      ) AS pondere(v, w)
      WHERE v IS NOT NULL
    )
    END AS score
  FROM taux t
  LEFT JOIN centiles c ON c.uid = t.uid
)
SELECT
  s.uid,
  s.prenom,
  s.nom,
  s.groupe,
  s.chambre,
  s.taux_participation_votes_finaux,
  s.nb_dossiers_inities,
  s.nb_textes_cosignes,
  s.nb_rapporteur,
  s.nb_amendements_auteur,
  s.nb_amendements_cosignataire,
  s.nb_questions_orales,
  s.nb_questions_ecrites,
  s.nb_prises_parole,
  s.nb_commission_presences,
  s.cp_part,
  s.cp_doss,
  s.cp_cosign,
  s.cp_rapp,
  s.cp_amend_auteur,
  s.cp_amend_cosign,
  s.cp_quest_o,
  s.cp_quest_e,
  s.cp_prises_parole,
  s.cp_comm_pres,
  s.score,
  s.date_debut_mandat,
  s.jours_actifs,
  CASE WHEN s.score IS NULL THEN NULL
       ELSE DENSE_RANK() OVER (PARTITION BY s.chambre ORDER BY s.score DESC NULLS LAST)::int
  END AS rang_chambre
FROM scored s
ORDER BY s.nom, s.prenom;

CREATE UNIQUE INDEX activite_elus_mv_uid_idx ON public.activite_elus_mv (uid);

CREATE INDEX activite_elus_mv_chambre_score_idx
  ON public.activite_elus_mv (chambre, score DESC NULLS LAST);
