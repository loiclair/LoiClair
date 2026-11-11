-- 2026-09-05 — Les présidents des deux chambres sortent du classement
--
-- Présider une chambre interdit presque tout ce que le score mesure : on ne dépose
-- plus d'amendement, on ne pose plus de question, on ne cosigne plus, et présider
-- une séance n'est pas compté comme y intervenir. Le score le lisait comme de
-- l'inactivité. Mesuré au 2026-09-05 : Larcher 25,2 (#334 sur 343 sénateurs),
-- Braun-Pivet 43,4 (#355 sur 554 députés), l'un au centile 1 sur les prises de
-- parole, tous deux au centile 0-3 sur amendements, questions et cosignatures.
--
-- Ils sortent donc du CTE `eligible`, ce qui les prive de centiles, de score et de
-- rang, **et** les retire des fenêtres qui produisent le centile des autres. C'est
-- le principe déjà posé le 2026-08-31 pour `cp_part` et `cp_comm_pres` : laisser
-- dans la file quelqu'un dont la fonction interdit la métrique le colle en dernière
-- place et gonfle le centile de tout le monde. Effet mesuré à effectif comparable :
-- 214 scores sur 553 bougent à l'Assemblée, 178 sur 342 au Sénat, jamais de plus de
-- 0,3 point ; les rangs se déplacent de 0,8 place en moyenne, 6 au maximum ; le top 3
-- des deux chambres est inchangé, et la moyenne de chambre reste à 50,0.
--
-- La détection ne porte aucun nom en dur : elle suivra le prochain changement de
-- président sans intervention. Côté Assemblée, le mandat au `BUREAU` avec la qualité
-- `Président` (les vice-présidents, questeurs et secrétaires siègent au même organe
-- sous une autre qualité). Côté Sénat, `periodes_president_senat`, déjà alimentée par
-- `sync_senat.py` pour neutraliser le taux de participation aux votes. Vérifié au
-- 2026-09-05 : la clause rend exactement deux personnes.
--
-- La colonne `est_president_chambre` est exposée parce que l'interface doit dire
-- *pourquoi* la ligne n'est pas classée : sans elle, le badge « Non classé » servirait
-- son seul motif existant, « mandat de moins de 6 mois », qui serait faux ici.
--
-- Le reste de la vue est identique à `2026-08-31_centile_midrank.sql`.

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
