-- 2026-09-09 — Le rapport de contrôle devient une métrique à part

-- La métrique « rapporteur » mélangeait deux travaux que rien ne rapproche : rapporter
-- un texte de loi, et produire un rapport d'information ou d'enquête. Pire, elle ne les
-- mélangeait qu'à l'Assemblée : côté Sénat, les rapports de contrôle n'existaient pas en
-- base, nos lignes `textes` venant de l'open data de l'Assemblée, qui ne publie que ce
-- qui touche un de ses dossiers. Un sénateur qui produisait six rapports d'information
-- n'en tirait rien, un député était crédité comme s'il avait rapporté six textes de loi.
--
-- Deux compteurs séparés, donc, et le même poids pour les deux : un poids inégal ferait
-- payer la séparation aux 82 députés dont tout le travail de rapport est du contrôle.
-- Le partage se fait sur la **procédure du dossier**, jamais sur le type du texte, parce
-- qu'à l'Assemblée un rapport de commission d'enquête est typé « Rapport » comme un
-- rapport législatif. Le filtre de type accepte en plus « Avis », sans quoi les 164
-- charges de rapporteur pour avis resteraient invisibles.
--
-- Les onze poids sont réécrits en même temps : les quatre fonctions du mandat pèsent
-- désormais 2,5 points chacune, soit 25 % du score, pour un total inchangé de 10 points.
-- Deux conséquences assumées : « dossier initié » passe de 20 % à 12,5 %, et les deux
-- lignes de rapport pèsent ensemble 35 % contre 20 % pour la ligne unique d'avant. La
-- seconde est inévitable dès lors qu'on sépare sans pénaliser : pour qu'un élu qui n'a
-- qu'un type de rapport garde son poids d'avant, chaque ligne doit valoir à peu près ce
-- que valait la ligne unique.
--
-- Le reste de la vue est identique à `2026-09-05_activite_presidents_chambre_hors_classement.sql`.

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
    a.periodes_mandat_assemblee,
    -- Président de l'Assemblée ou du Sénat : reconnu par sa fonction, jamais par son
    -- nom. Le mandat `BUREAU` porte `codeQualite = 'Président'` pour le seul président
    -- de l'Assemblée ; les autres membres du Bureau y siègent sous une qualité
    -- différente. `dateFin IS NULL` retient le titulaire du moment.
    (
      EXISTS (
        SELECT 1 FROM jsonb_array_elements(a.mandats) m
        WHERE m->>'typeOrgane' = 'BUREAU'
          AND m->'infosQualite'->>'codeQualite' = 'Président'
          AND m->>'dateFin' IS NULL
      )
      OR a.periodes_president_senat IS NOT NULL
    ) AS est_president_chambre
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
-- Un texte compte une fois par cosignataire. Le UNION dédoublonne le cas où un élu
-- figurerait à la fois dans les signataires et dans les cosignataires du même texte ;
-- deux versions successives d'un même dossier restent deux cosignatures.
cosigned_count AS (
  SELECT exp.a_uid, COUNT(*) AS cnt
  FROM (
    SELECT unnest(t.cosignataires_refs) AS a_uid, t.uid AS texte_uid, t.dossier_ref
    FROM textes t
    WHERE t.cosignataires_refs IS NOT NULL
      AND (
        (t.chambre = 'Sénat' AND t.date_depot >= DATE '2023-10-02')
        OR (t.chambre <> 'Sénat' AND t.date_depot >= DATE '2024-07-18')
      )
    UNION
    SELECT unnest(t.auteurs_refs) AS a_uid, t.uid AS texte_uid, t.dossier_ref
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
-- Tous les rapports portés par un élu, chacun étiqueté selon la procédure de son
-- dossier. C'est la procédure qui sépare les deux familles, jamais le type du texte :
-- à l'Assemblée, un rapport de commission d'enquête est typé « Rapport » comme un
-- rapport législatif, et 17 rapports d'information le sont aussi.
--
-- Le filtre de type accepte « Avis » en plus de « rapport » : un rapporteur pour avis
-- signe un document de type Avis, et ces 164 charges resteraient invisibles sinon.
rapports_portes AS (
  SELECT exp.a_uid,
         exp.dossier_ref,
         d.procedure_libelle IN (
           'Rapport d''information sans mission',
           'Mission d''information',
           'Commission d''enquête',
           'Pétitions'
         ) AS est_controle
  FROM (
    SELECT unnest(t.rapporteurs_refs) AS a_uid, t.dossier_ref
    FROM textes t
    WHERE t.rapporteurs_refs IS NOT NULL
      AND (t.type_libelle ILIKE '%rapport%' OR t.type_libelle = 'Avis')
      AND t.denomination NOT ILIKE 'Annexe%'
      AND (
        (t.chambre = 'Sénat' AND t.date_depot >= DATE '2023-10-02')
        OR (t.chambre <> 'Sénat' AND t.date_depot >= DATE '2024-07-18')
      )
  ) exp
  INNER JOIN active_acteurs aa ON aa.uid = exp.a_uid
  INNER JOIN dossiers_legislatifs d ON d.uid = exp.dossier_ref
),
rapporteur_count AS (
  SELECT rp.a_uid, COUNT(DISTINCT rp.dossier_ref) AS cnt
  FROM rapports_portes rp
  WHERE NOT rp.est_controle
  GROUP BY rp.a_uid
),
rapport_controle_count AS (
  SELECT rp.a_uid, COUNT(DISTINCT rp.dossier_ref) AS cnt
  FROM rapports_portes rp
  WHERE rp.est_controle
  GROUP BY rp.a_uid
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
    COALESCE(rcc.cnt, 0)::bigint           AS nb_rapports_controle,
    aa.nb_amendements_auteur,
    aa.nb_amendements_cosignataire,
    aa.nb_questions_orales,
    aa.nb_questions_ecrites,
    aa.nb_prises_parole,
    aa.nb_commission_presences,
    aa.date_debut_mandat,
    aa.est_president_chambre,
    -- Union des périodes, jamais leur somme : deux mandats SENAT qui se recouvrent
    -- décrivent le même siège, pas deux fois plus de jours de mandat. `range_agg`
    -- rend un multirange déjà fusionné, `unnest` en mesure chaque morceau.
    COALESCE(
      (
        SELECT SUM(upper(r) - lower(r))::int
        FROM unnest((
          SELECT range_agg(daterange(
            GREATEST(
              (p->>'debut')::date,
              CASE aa.chambre WHEN 'AN' THEN DATE '2024-07-18' ELSE DATE '2023-10-02' END
            ),
            LEAST(COALESCE((p->>'fin')::date, CURRENT_DATE), CURRENT_DATE),
            '[)'
          ))
          FROM jsonb_array_elements(aa.periodes_mandat_assemblee) p
        )) AS r
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
  LEFT JOIN rapport_controle_count rcc ON rcc.a_uid = aa.uid
),
taux AS (
  SELECT
    b.*,
    b.nb_dossiers_inities::numeric         / NULLIF(b.jours_actifs, 0) AS taux_doss,
    b.nb_textes_cosignes::numeric          / NULLIF(b.jours_actifs, 0) AS taux_cosign,
    b.nb_rapporteur::numeric               / NULLIF(b.jours_actifs, 0) AS taux_rapp,
    b.nb_rapports_controle::numeric        / NULLIF(b.jours_actifs, 0) AS taux_rapp_ctrl,
    b.nb_amendements_auteur::numeric       / NULLIF(b.jours_actifs, 0) AS taux_amend_auteur,
    b.nb_amendements_cosignataire::numeric / NULLIF(b.jours_actifs, 0) AS taux_amend_cosign,
    b.nb_questions_orales::numeric         / NULLIF(b.jours_actifs, 0) AS taux_quest_o,
    b.nb_questions_ecrites::numeric        / NULLIF(b.jours_actifs, 0) AS taux_quest_e,
    b.nb_prises_parole::numeric            / NULLIF(b.jours_actifs, 0) AS taux_prises_parole,
    b.nb_commission_presences::numeric     / NULLIF(b.jours_actifs, 0) AS taux_comm_pres
  FROM brut b
),
-- `eligible` définit la population qui reçoit un score **et** celle qui sert de
-- référence aux centiles : en sortir, c'est sortir des deux à la fois.
eligible AS (
  SELECT * FROM taux WHERE jours_actifs >= 180 AND NOT est_president_chambre
),
-- Le centile est celui du milieu du bloc d'ex-aequo, pas de son sommet : voir
-- l'en-tête de cette migration.
--
-- Deux métriques peuvent être « non applicables » plutôt que nulles : la
-- participation aux votes pour le Président du Sénat, la présence en commission
-- pour un élu qui n'y siège pas. Ces élus doivent sortir de la **fenêtre**, pas
-- seulement recevoir un NULL en sortie : dans la fenêtre, ils occupent la
-- dernière place et augmentent le centile de tous les autres.
centiles_part AS (
  SELECT
    e.uid,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY e.taux_participation_votes_finaux) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY e.taux_participation_votes_finaux)) / 2) * 100 + 0.5)::int AS cp_part
  FROM eligible e
  WHERE e.taux_participation_votes_finaux IS NOT NULL
),
centiles_comm AS (
  SELECT
    e.uid,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY e.taux_comm_pres) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY e.taux_comm_pres)) / 2) * 100 + 0.5)::int AS cp_comm_pres
  FROM eligible e
  WHERE e.nb_commission_presences IS NOT NULL
),
centiles AS (
  SELECT
    e.uid,
    cp.cp_part,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_doss, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_doss, 0))) / 2)         * 100 + 0.5)::int AS cp_doss,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_cosign, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_cosign, 0))) / 2)       * 100 + 0.5)::int AS cp_cosign,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_rapp, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_rapp, 0))) / 2)         * 100 + 0.5)::int AS cp_rapp,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_rapp_ctrl, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_rapp_ctrl, 0))) / 2)         * 100 + 0.5)::int AS cp_rapp_ctrl,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_amend_auteur, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_amend_auteur, 0))) / 2) * 100 + 0.5)::int AS cp_amend_auteur,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_amend_cosign, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_amend_cosign, 0))) / 2) * 100 + 0.5)::int AS cp_amend_cosign,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_quest_o, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_quest_o, 0))) / 2)      * 100 + 0.5)::int AS cp_quest_o,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_quest_e, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_quest_e, 0))) / 2)      * 100 + 0.5)::int AS cp_quest_e,
    FLOOR(((PERCENT_RANK() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_prises_parole, 0)) + CUME_DIST() OVER (PARTITION BY e.chambre ORDER BY COALESCE(e.taux_prises_parole, 0))) / 2) * 100 + 0.5)::int AS cp_prises_parole,
    cc.cp_comm_pres
  FROM eligible e
  LEFT JOIN centiles_part cp ON cp.uid = e.uid
  LEFT JOIN centiles_comm cc ON cc.uid = e.uid
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
    t.nb_rapports_controle,
    t.nb_amendements_auteur,
    t.nb_amendements_cosignataire,
    t.nb_questions_orales,
    t.nb_questions_ecrites,
    t.nb_prises_parole,
    t.nb_commission_presences,
    t.date_debut_mandat,
    t.jours_actifs,
    t.est_president_chambre,
    c.cp_part,
    c.cp_doss,
    c.cp_cosign,
    c.cp_rapp,
    c.cp_rapp_ctrl,
    c.cp_amend_auteur,
    c.cp_amend_cosign,
    c.cp_quest_o,
    c.cp_quest_e,
    c.cp_prises_parole,
    c.cp_comm_pres,
    -- Le LEFT JOIN sur `centiles` rendrait déjà NULL partout pour un président, donc
    -- un score NULL par somme de poids vide. La condition est écrite quand même :
    -- l'absence de score est une règle, pas un effet de bord de la jointure.
    CASE WHEN t.jours_actifs < 180 OR t.est_president_chambre THEN NULL
    ELSE (
      SELECT ROUND((SUM(v * w) / NULLIF(SUM(w), 0))::numeric, 1)
      -- Poids strictement alignés sur `src/lib/activite-weights.ts` : si l'un change,
      -- l'autre change dans le même geste. Quatre fonctions à 2,5 points, soit 25 %
      -- du score chacune, pour un total de 10 points.
      FROM (VALUES
        -- Légiférer
        (c.cp_doss,           1.25::numeric),
        (c.cp_amend_auteur,   0.75::numeric),
        (c.cp_cosign,         0.3::numeric),
        (c.cp_amend_cosign,   0.2::numeric),
        -- Délibérer
        (c.cp_part,           1.75::numeric),
        (c.cp_prises_parole,  0.75::numeric),
        -- Contrôler
        (c.cp_rapp_ctrl,      1.75::numeric),
        (c.cp_quest_o,        0.5::numeric),
        (c.cp_quest_e,        0.25::numeric),
        -- Examiner les textes
        (c.cp_rapp,           1.75::numeric),
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
  s.nb_rapports_controle,
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
  s.cp_rapp_ctrl,
  s.cp_amend_auteur,
  s.cp_amend_cosign,
  s.cp_quest_o,
  s.cp_quest_e,
  s.cp_prises_parole,
  s.cp_comm_pres,
  s.score,
  s.date_debut_mandat,
  s.jours_actifs,
  s.est_president_chambre,
  CASE WHEN s.score IS NULL THEN NULL
       -- RANK et non DENSE_RANK (D-029) : les ex-aequo partagent leur rang mais
       -- consomment les numéros suivants, pour que « #N / total » se lise avec le
       -- même dénominateur des deux côtés de la barre oblique.
       ELSE RANK() OVER (PARTITION BY s.chambre ORDER BY s.score DESC NULLS LAST)::int
  END AS rang_chambre
FROM scored s
ORDER BY s.nom, s.prenom;

CREATE UNIQUE INDEX activite_elus_mv_uid_idx ON public.activite_elus_mv (uid);

CREATE INDEX activite_elus_mv_chambre_score_idx
  ON public.activite_elus_mv (chambre, score DESC NULLS LAST);
