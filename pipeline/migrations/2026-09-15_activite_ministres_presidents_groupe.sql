-- 2026-09-15 : le travail de ministre sort du score, les présidents de groupe du classement
--
-- ORDRE D'APPLICATION (jour de la release, après la fin du cron du jour). Le fichier
-- exécute les trois étapes dans cet ordre s'il est appliqué d'un bloc :
--   1. `recalc_nb_prises_parole()` redéfinie ;
--   2. `SELECT public.recalc_nb_prises_parole();` : la vue lit `acteurs.nb_prises_parole`,
--      le compteur doit donc être recalculé avant qu'elle ne soit construite ;
--   3. DROP puis CREATE de `activite_elus_mv` et de ses deux index.
-- Appliqué en plusieurs fois, chaque morceau reprend le `SET LOCAL` ci-dessous, qui ne
-- vaut que pour sa transaction.
--
-- CONTRÔLES APRÈS :
--   - propriétaire `postgres` :
--       SELECT pg_get_userbyid(relowner) FROM pg_class WHERE relname = 'activite_elus_mv';
--   - lecture pour `anon` et `authenticated` (privilèges par défaut du schéma) :
--       SELECT relacl FROM pg_class WHERE relname = 'activite_elus_mv';
--   - les deux index, dont l'index unique qu'exige le refresh nocturne :
--       SELECT indexdef FROM pg_indexes WHERE tablename = 'activite_elus_mv';
--   - `REFRESH MATERIALIZED VIEW CONCURRENTLY public.activite_elus_mv;` passe.
--
-- LE TRAVAIL DE MINISTRE. Un ancien ministre redevenu député ou sénateur gardait en
-- « dossiers initiés » les projets de loi de son gouvernement, et en « prises de
-- parole » ses interventions au banc du Gouvernement. Barnier comptait ainsi 15
-- dossiers initiés, dont 14 venus de son gouvernement, et Borne 22 prises de
-- parole, toutes faites comme ministre. Deux filtres :
--   - un dossier qui porte un texte `PRJL` ou `DECL` (règle de D-152) ne crédite
--     personne, ni en initiative ni en cosignature, sauf les motions de censure ;
--   - une intervention dont la qualité d'orateur est ministérielle ne compte pas.
--     Relevé au 2026-09-15 : 107 valeurs distinctes (83 à l'Assemblée, 26 au Sénat,
--     deux en commun), toutes captées par des motifs ancrés en début de chaîne, et
--     5 498 interventions de plus de 20 mots retirées du compte. Aucune qualité de
--     rapporteur, de président de commission ou de suppléant ne commence par l'un
--     d'eux. Au Sénat, aucune intervention ministérielle ne porte d'`acteur_uid` à
--     cette date : le filtre n'y change rien, il y est écrit pour le jour où ça
--     changerait.
--
-- LES PRÉSIDENTS DE GROUPE. Leur travail d'organisation et d'alignement du groupe
-- n'entre dans aucun compteur, et le score les lisait comme peu actifs (Le Pen 21,4,
-- Marseille 23,3). Ils sortent du classement comme les présidents de chambre
-- (2026-09-05) : ni centile, ni score, ni rang, et hors de la file qui produit le
-- centile des autres. La colonne `est_president_groupe` est exposée pour que
-- l'interface dise pourquoi la ligne n'est pas classée. Limite constatée au
-- 2026-09-15 : aucun sénateur du groupe RDPI en exercice ne porte la qualité de
-- président dans `mandats`, le groupe n'a donc pas de président repéré ici.
--
-- EFFET MESURÉ au 2026-09-15, nouvelle requête et ancienne recalculées le même jour :
-- 925 lignes des deux côtés. 18 élus sortent du classement (11 députés, 7 sénateurs),
-- 542 députés et 335 sénateurs restent classés. Les scores bougent de 0,16 point en
-- moyenne ; pour les élus dont aucun compteur ne change, jamais plus de 0,6 point ni
-- de 13 places. Les plus touchés sont d'anciens ministres : Ferracci 23,7 → 16,8
-- (100 prises de parole → 1), Barnier 37,3 → 31,9 (15 dossiers initiés → 1),
-- Borne 19,9 → 16,5. Le trio de tête des deux chambres et la moyenne de 50,0 ne
-- bougent pas. Durées : ~4,3 s pour la sélection de la fonction, ~3 s pour la vue.
--
-- Le reste de la vue est identique à `2026-09-09_dossiers_inities_tous_auteurs.sql`, et
-- le reste de la fonction à `2026-08-31_prises_parole_plancher_an.sql`.

SET LOCAL statement_timeout = 0;

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
      -- Intervention faite comme membre du Gouvernement : voir l'en-tête. Les motifs
      -- sont ancrés au début, « rapporteur » ou « président de la commission » ne
      -- commençant par aucun d'eux. `secrétaire d` seul est une qualité tronquée à
      -- l'apostrophe dans les comptes rendus du Sénat en base (« secrétaire d'État »,
      -- Olivier Dussopt en 2019).
      AND NOT (
        coalesce(i.orateur_qualite, '') ILIKE 'ministre%'
        OR coalesce(i.orateur_qualite, '') ILIKE 'premier ministre%'
        OR coalesce(i.orateur_qualite, '') ILIKE 'première ministre%'
        OR coalesce(i.orateur_qualite, '') ILIKE 'garde des sceaux%'
        OR coalesce(i.orateur_qualite, '') ILIKE 'secrétaire d%tat%'
        OR coalesce(i.orateur_qualite, '') = 'secrétaire d'
      )
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

SELECT public.recalc_nb_prises_parole();

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
