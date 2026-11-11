-- 2026-04-26 — Vue matérialisée du score d'activité des parlementaires
--
-- Contexte : le score d'activité (Facts/activite, fiche élu, landing) était
-- recalculé en JS à chaque revalidation Next.js (200 lignes dupliquées sur 3
-- fichiers). Les données ne changent qu'une fois par nuit (cron sync) ; on
-- matérialise donc le calcul complet (centiles + score + rang) côté Postgres.
--
-- Notes de fidélité avec l'implémentation JS d'origine
-- (cf. src/lib/activite-score.ts) :
--   1. toCentileRanks(values) côté JS = count(x ≤ v) / n × 100, arrondi.
--      Équivalent SQL = ROUND(CUME_DIST() * 100). Pour matcher la règle JS
--      "round half up" de Math.round on utilise FLOOR(x + 0.5).
--   2. Les NULL sont remplacés par 0 dans la distribution (extract() côté JS),
--      puis le centile cp_part est nullifié si la métrique brute IS NULL
--      (Président du Sénat sur taux_participation, élu sans commission sur
--      nb_commission_presences). On reproduit en COALESCE(x, 0) dans le
--      ORDER BY de CUME_DIST puis NULL si la valeur d'origine IS NULL.
--   3. computeScore = moyenne arithmétique des centiles non-NULL, arrondie.
--      Équivalent SQL = FLOOR(AVG(v) + 0.5) sur unnest filtré IS NOT NULL.

-- ── Vue matérialisée ─────────────────────────────────────────────────────
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
    aa.nb_commission_presences
  FROM active_acteurs aa
  LEFT JOIN dossiers_count   dc ON dc.uid   = aa.uid
  LEFT JOIN cosigned_count   cc ON cc.a_uid = aa.uid
  LEFT JOIN rapporteur_count rc ON rc.a_uid = aa.uid
),
centiles AS (
  SELECT
    b.*,
    -- cp_part : centile sur participation, NULL si la métrique brute est NULL
    CASE WHEN b.taux_participation_votes_finaux IS NULL THEN NULL
         ELSE FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.taux_participation_votes_finaux, 0)) * 100 + 0.5)::int
    END AS cp_part,
    FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_dossiers_inities, 0))         * 100 + 0.5)::int AS cp_doss,
    FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_textes_cosignes, 0))          * 100 + 0.5)::int AS cp_cosign,
    FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_rapporteur, 0))               * 100 + 0.5)::int AS cp_rapp,
    FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_amendements_auteur, 0))       * 100 + 0.5)::int AS cp_amend_auteur,
    FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_amendements_cosignataire, 0)) * 100 + 0.5)::int AS cp_amend_cosign,
    FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_questions_orales, 0))         * 100 + 0.5)::int AS cp_quest_o,
    FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_questions_ecrites, 0))        * 100 + 0.5)::int AS cp_quest_e,
    FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_prises_parole, 0))            * 100 + 0.5)::int AS cp_prises_parole,
    -- cp_comm_pres : NULL si l'élu n'a pas de commission
    CASE WHEN b.nb_commission_presences IS NULL THEN NULL
         ELSE FLOOR(CUME_DIST() OVER (PARTITION BY b.chambre ORDER BY COALESCE(b.nb_commission_presences, 0)) * 100 + 0.5)::int
    END AS cp_comm_pres
  FROM brut b
),
scored AS (
  SELECT
    c.*,
    COALESCE((
      SELECT FLOOR(AVG(v)::numeric + 0.5)::int
      FROM unnest(ARRAY[
        c.cp_part, c.cp_doss, c.cp_cosign, c.cp_rapp,
        c.cp_amend_auteur, c.cp_amend_cosign,
        c.cp_quest_o, c.cp_quest_e, c.cp_prises_parole, c.cp_comm_pres
      ]) AS v
      WHERE v IS NOT NULL
    ), 0) AS score
  FROM centiles c
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
  DENSE_RANK() OVER (PARTITION BY s.chambre ORDER BY s.score DESC)::int AS rang_chambre
FROM scored s
ORDER BY s.nom, s.prenom;

-- Index unique (requis pour REFRESH CONCURRENTLY)
CREATE UNIQUE INDEX activite_elus_mv_uid_idx ON public.activite_elus_mv (uid);

-- Index secondaire pour les tris principaux par chambre + score
CREATE INDEX activite_elus_mv_chambre_score_idx
  ON public.activite_elus_mv (chambre, score DESC);

-- ── RPC de rafraîchissement ──────────────────────────────────────────────
-- Appelé en fin de cron nightly via refresh_activite_scores.py.
CREATE OR REPLACE FUNCTION public.refresh_activite_elus_mv()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.activite_elus_mv;
END;
$function$;
