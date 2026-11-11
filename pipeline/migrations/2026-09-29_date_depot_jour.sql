-- 2026-09-29 : `dossiers_legislatifs.date_depot` devient un jour civil (`date`)
--
-- POURQUOI. La colonne était un `timestamptz` rempli de deux façons : les dossiers de
-- l'Assemblée à minuit heure de Paris (donc 22 h ou 23 h UTC la veille), ceux du Sénat
-- à minuit UTC. Tout lecteur qui en tirait le jour en UTC affichait la veille pour
-- l'Assemblée : frise « Dépôt » de la page loi, fiche d'élu, et 68 dépôts du 1ᵉʳ du
-- mois rangés dans le mois précédent par `dossiers_cohorte_par_mois`. Pire, la borne
-- `>= DATE '2024-07-18'` comparait un horodatage à minuit UTC : les dépôts AN du
-- 18 juillet 2024 (22 h UTC le 17) sortaient de la 17ᵉ législature, et de la vingtaine
-- de calculs qui la bornent. Un dépôt est un jour, pas un instant : il se stocke en
-- `date`, et la question du fuseau disparaît pour tous les lecteurs.
--
-- LA CONVERSION. `(date_depot at time zone 'Europe/Paris')::date` rend le bon jour pour
-- les deux populations : minuit Paris est le jour même par construction, et minuit UTC
-- tombe à 1 h ou 2 h à Paris, le même jour. Vérifié en base le 2026-09-29 avant
-- l'application.
--
-- LES DÉPENDANCES. `ALTER COLUMN ... TYPE` refuse de s'exécuter tant qu'une vue lit la
-- colonne : les trois qui la lisent (`activite_elus_mv`, `dossiers_cohorte_par_mois`,
-- `dossiers_cohorte_par_groupe`) tombent puis se recréent dans la même transaction.
-- Aucune fonction SQL ne la lit. L'index `idx_dossiers_date_depot` est reconstruit
-- par l'`ALTER` lui-même.
--   - `dossiers_cohorte_par_groupe` revient à l'identique ;
--   - `dossiers_cohorte_par_mois` perd son `at time zone 'UTC'`, qui n'a plus de sens
--     sur un jour : le mois de dépôt devient celui du jour de Paris ;
--   - `activite_elus_mv` revient à l'identique de
--     `2026-09-15_activite_poids_vote_commission.sql` (définition comparée à
--     `pg_get_viewdef` en base le 2026-09-29 : égale). Ses bornes
--     `>= DATE '2024-07-18'` deviennent justes d'elles-mêmes. Reconstruire la vue
--     change la date de la méthode affichée sur /Activite (`ACTIVITE_METHODE_MAJ`).
--
-- Les droits reviennent seuls : les privilèges par défaut du schéma `public` accordent
-- la lecture à `anon` et `authenticated` sur tout objet créé par `postgres`.
--
-- ORDRE D'APPLICATION : à n'importe quel moment hors du cron nocturne, avant ou après
-- le déploiement du code. Le code en ligne reste juste sur une colonne `date` : il la
-- filtre, la trie et la formate comme une chaîne ISO `YYYY-MM-DD`. L'import AN écrit
-- désormais un jour (`import_dossiers_cloud.py`). L'ancien, s'il tournait encore une
-- nuit, resterait juste : Postgres lit `2024-07-18T00:00:00+02:00` comme le jour écrit,
-- `2024-07-18`, sans convertir le fuseau (vérifié en base le 2026-09-29).
--
-- CONTRÔLES APRÈS :
--   - la cohorte compte les dépôts AN du 18 juillet 2024 (3 314 au lieu de 3 312) :
--       SELECT (SELECT sum(nb) FROM dossiers_cohorte_par_mois)   AS par_mois,
--              (SELECT sum(nb) FROM dossiers_cohorte_par_groupe) AS par_groupe,
--              (SELECT count(*) FROM dossiers_legislatifs
--                WHERE date_depot >= DATE '2024-07-18')          AS reference;
--   - la vue d'activité a gardé ses lignes (925), son propriétaire et ses deux index :
--       SELECT count(*) FROM activite_elus_mv;
--       SELECT indexdef FROM pg_indexes WHERE tablename = 'activite_elus_mv';
--   - `REFRESH MATERIALIZED VIEW CONCURRENTLY public.activite_elus_mv;` passe.

BEGIN;

SET LOCAL statement_timeout = 0;

DROP MATERIALIZED VIEW public.activite_elus_mv;
DROP VIEW public.dossiers_cohorte_par_mois;
DROP VIEW public.dossiers_cohorte_par_groupe;

ALTER TABLE public.dossiers_legislatifs
  ALTER COLUMN date_depot TYPE date
  USING (date_depot AT TIME ZONE 'Europe/Paris')::date;

-- Ventilation par mois : voir `2026-09-22_vues_cohorte_depots.sql` pour ses lecteurs
-- et la raison des deux vues. Le mois est désormais celui du jour de dépôt, sans
-- conversion.
CREATE VIEW public.dossiers_cohorte_par_mois
WITH (security_invoker = true) AS
  SELECT d.procedure_libelle,
         d.statut_final,
         to_char(d.date_depot, 'YYYY-MM')        AS mois_depot,
         to_char(d.date_promulgation, 'YYYY-MM') AS mois_promulgation,
         count(*)                                AS nb
  FROM public.dossiers_legislatifs d
  WHERE d.date_depot >= DATE '2024-07-18'
  GROUP BY 1, 2, 3, 4;

-- Ventilation par groupe initiateur, identique à `2026-09-22_vues_cohorte_depots.sql`.
CREATE VIEW public.dossiers_cohorte_par_groupe
WITH (security_invoker = true) AS
  SELECT d.procedure_libelle,
         d.statut_final,
         d.initiateur_groupe_uid,
         d.initiateur_groupe_libelle,
         count(*) AS nb
  FROM public.dossiers_legislatifs d
  WHERE d.date_depot >= DATE '2024-07-18'
  GROUP BY 1, 2, 3, 4;

-- `activite_elus_mv`, recopiée de `2026-09-15_activite_poids_vote_commission.sql`
-- sans aucun changement.
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
    ) AS est_president_chambre,
    -- Président d'un groupe politique, à l'Assemblée (`GP`) comme au Sénat
    -- (`GROUPESENAT`) : même lecture que pour la présidence de chambre, par la
    -- fonction et jamais par le nom. Vérifié au 2026-09-15 : 11 présidents à
    -- l'Assemblée, 7 au Sénat, les membres du bureau d'un groupe y siégeant sous une
    -- autre qualité. Un `mandats` NULL rend `false`, pas NULL.
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(a.mandats) m
      WHERE m->>'typeOrgane' IN ('GP', 'GROUPESENAT')
        AND m->'infosQualite'->>'codeQualite' = 'Président'
        AND m->>'dateFin' IS NULL
    ) AS est_president_groupe
  FROM acteurs a
  WHERE (a.est_depute_actuel = true OR a.est_senateur_actuel = true)
    AND (a.est_ministre_actuel IS NULL OR a.est_ministre_actuel = false)
),
-- Dossiers du Gouvernement : ceux qui portent un projet de loi (`PRJL`) ou une
-- déclaration du Gouvernement (`DECL`), la même règle que D-152 dans
-- `import_dossiers_cloud.py`. Un élu qui les a signés l'a fait comme ministre : ce
-- travail ne se crédite ni en initiative ni en cosignature. Vérifié au 2026-09-15 :
-- aucun de ces dossiers ne porte aussi une proposition de loi (`PION`, `PNRE`).
dossiers_gouvernement AS (
  SELECT dl.uid
  FROM dossiers_legislatifs dl
  WHERE EXISTS (
    SELECT 1 FROM unnest(dl.textes_associes_refs) r
    WHERE r LIKE 'PRJL%' OR r LIKE 'DECL%'
  )
),
-- Un couple (élu, dossier) par acte d'initiative : l'initiateur déclaré du dossier, et
-- les auteurs du texte de dépôt initial. Le UNION dédoublonne le cas courant où les deux
-- désignent la même personne.
initiateurs AS (
  SELECT dl.initiateur_acteur_ref AS acteur_uid, dl.uid AS dossier_uid, dl.date_depot
  FROM dossiers_legislatifs dl
  WHERE dl.initiateur_acteur_ref IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM dossiers_gouvernement g WHERE g.uid = dl.uid)
  UNION
  SELECT unnest(t.auteurs_refs) AS acteur_uid, t.dossier_ref AS dossier_uid, dl.date_depot
  FROM textes t
  INNER JOIN dossiers_legislatifs dl ON dl.uid = t.dossier_ref
  WHERE t.auteurs_refs IS NOT NULL
    AND t.depot_code = 'INITDEP'
    -- Haute Cour : l'article 68 impose la signature d'un dixième des membres, et la
    -- source les liste tous comme initiateurs. Seul le premier signataire compte.
    AND dl.procedure_libelle <> 'Responsabilité pénale du président de la république'
    AND NOT EXISTS (SELECT 1 FROM dossiers_gouvernement g WHERE g.uid = dl.uid)
),
dossiers_count AS (
  SELECT i.acteur_uid AS uid, COUNT(DISTINCT i.dossier_uid) AS cnt
  FROM initiateurs i
  INNER JOIN active_acteurs aa ON aa.uid = i.acteur_uid
  WHERE (
    (aa.chambre = 'AN' AND i.date_depot >= DATE '2024-07-18')
    OR
    (aa.chambre = 'SN' AND i.date_depot >= DATE '2023-10-02')
  )
  GROUP BY i.acteur_uid
),
-- Ce qu'un élu a initié ne compte pas une seconde fois en cosignature.
initiated_pairs AS (
  SELECT i.acteur_uid, i.dossier_uid
  FROM initiateurs i
  WHERE i.acteur_uid IN (SELECT uid FROM active_acteurs)
),
-- Un texte compte une fois par cosignataire. Le UNION dédoublonne le cas où un élu
-- figurerait à la fois dans les signataires et dans les cosignataires du même texte ;
-- deux versions successives d'un même dossier restent deux cosignatures.
--
-- Les textes d'un dossier du Gouvernement sortent aussi d'ici. Sans ce filtre, les
-- retirer de `initiateurs` les faisait basculer en cosignature, puisque
-- `initiated_pairs` ne les écartait plus : mesuré au 2026-09-15, 18 textes pour
-- Barnier (projets de loi, études d'impact, accords) et 7 pour Attal. Seule
-- exception, les motions de censure déposées contre un 49.3 : rangées dans le dossier
-- de la déclaration du Gouvernement, elles sont bien un acte de parlementaire.
cosigned_count AS (
  SELECT exp.a_uid, COUNT(*) AS cnt
  FROM (
    SELECT unnest(t.cosignataires_refs) AS a_uid, t.uid AS texte_uid, t.dossier_ref, t.depot_code
    FROM textes t
    WHERE t.cosignataires_refs IS NOT NULL
      AND (
        (t.chambre = 'Sénat' AND t.date_depot >= DATE '2023-10-02')
        OR (t.chambre <> 'Sénat' AND t.date_depot >= DATE '2024-07-18')
      )
    UNION
    SELECT unnest(t.auteurs_refs) AS a_uid, t.uid AS texte_uid, t.dossier_ref, t.depot_code
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
    AND (
      exp.depot_code = 'MOTION49-3'
      OR NOT EXISTS (SELECT 1 FROM dossiers_gouvernement g WHERE g.uid = exp.dossier_ref)
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
    aa.est_president_groupe,
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
          -- Une période close avant la borne de la chambre donnerait un intervalle
          -- dont le début dépasse la fin : Postgres lève (22000) et tout le
          -- refresh échoue. L'import écarte déjà ce cas (député ancien sénateur),
          -- la vue ne doit pas en dépendre.
          WHERE LEAST(COALESCE((p->>'fin')::date, CURRENT_DATE), CURRENT_DATE)
            > CASE aa.chambre WHEN 'AN' THEN DATE '2024-07-18' ELSE DATE '2023-10-02' END
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
-- référence aux centiles : en sortir, c'est sortir des deux à la fois. Un président
-- de groupe en sort comme un président de chambre : resté dans la file, il y
-- occuperait les dernières places sur les métriques que sa fonction remplace, et
-- gonflerait le centile des autres.
eligible AS (
  SELECT * FROM taux
  WHERE jours_actifs >= 180 AND NOT est_president_chambre AND NOT est_president_groupe
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
    t.est_president_groupe,
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
    CASE WHEN t.jours_actifs < 180 OR t.est_president_chambre OR t.est_president_groupe THEN NULL
    ELSE (
      SELECT ROUND((SUM(v * w) / NULLIF(SUM(w), 0))::numeric, 1)
      -- Poids strictement alignés sur `src/lib/activite-weights.ts` : si l'un change,
      -- l'autre change dans le même geste. Total de 10 points, réparti selon
      -- l'investissement que demande chaque acte : Légiférer 2,5 (25 %), Délibérer 2,0
      -- (20 %), Contrôler 2,5 (25 %), Examiner les textes 3,0 (30 %).
      FROM (VALUES
        -- Légiférer
        (c.cp_doss,           1.25::numeric),
        (c.cp_amend_auteur,   0.75::numeric),
        (c.cp_cosign,         0.3::numeric),
        (c.cp_amend_cosign,   0.2::numeric),
        -- Délibérer
        (c.cp_part,           1.25::numeric),
        (c.cp_prises_parole,  0.75::numeric),
        -- Contrôler
        (c.cp_rapp_ctrl,      1.75::numeric),
        (c.cp_quest_o,        0.5::numeric),
        (c.cp_quest_e,        0.25::numeric),
        -- Examiner les textes
        (c.cp_rapp,           1.75::numeric),
        (c.cp_comm_pres,      1.25::numeric)
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
  s.est_president_groupe,
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

COMMIT;
