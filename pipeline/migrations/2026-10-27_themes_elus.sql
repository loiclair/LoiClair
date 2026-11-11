-- 2026-10-27 : « Ses sujets de prédilection », les trois thèmes où un élu est le plus
-- présent par rapport à sa chambre, pour la section « Son activité » de la fiche élu.
--
-- POURQUOI UN ÉCART ET NON UN DÉCOMPTE. Compter l'activité d'un élu par thème rend
-- l'ordre du jour, pas ses sujets : « Questions sociales et santé » arrivait premier
-- chez 447 élus sur 922. La vue compare donc le profil de l'élu à la moyenne de sa
-- chambre, et garde les trois thèmes les plus sur-représentés.
--
-- LA MÉTHODE.
--   1. Six sources, bornées au mandat en cours comme le score (D-239), avec la même
--      `debut_fenetre` que `activite_elus_mv` :
--        - dossiers déposés : les règles de `initiateurs` du score (initiateur déclaré
--          et auteurs du texte de dépôt, ni dossier du Gouvernement, ni signataires
--          de la Haute Cour), dépôt du dossier depuis `debut_fenetre` ;
--        - rapports : les règles de `rapports_portes` (rapport ou avis, hors annexes),
--          bornés sur la date et non sur la chambre, pour garder les rapports qu'un
--          organe commun publie côté Assemblée ;
--        - amendements déposés (`dossier_amendements_elus`), de la chambre actuelle.
--          La table n'a pas de date, et celle du Sénat remonte à 2011 : un couple
--          (élu, dossier) n'y compte que si le dossier a un acte depuis
--          `debut_fenetre`. Approximation : un vieil amendement sur un dossier
--          encore examiné pendant le mandat passe ce filtre ;
--        - prises de parole : les filtres de `dossier_orateurs`, relus dans
--          `debat_interventions` pour la date de séance (le Sénat remonte à 2011) ;
--        - présences en commission (`dossier_presences_elus`, Assemblée seule). Sans
--          borne de date : les réunions de l'Assemblée commencent le 2024-07-20 ;
--        - questions écrites et orales, de la chambre actuelle, depuis
--          `debut_fenetre`.
--      Un élément est un dossier par source (un dossier aux 40 amendements de l'élu
--      compte une fois en amendements), ou une question. Un dossier porte ses 1 à 3
--      thèmes (D-240), une question le thème de sa rubrique.
--      Les votes sont exclus, tous les élus votant les mêmes scrutins, comme les
--      cosignatures, trop nombreuses pour l'effort qu'elles demandent.
--   2. Poids égal par source : la part d'un thème est la moyenne, sur les sources que
--      l'élu a, de sa part dans chaque source. Un élu aux 900 amendements et aux 10
--      questions n'est pas résumé par ses seuls amendements.
--   3. Écart = part de l'élu ÷ part moyenne de sa chambre, moyenne qui compte à zéro
--      les élus absents du thème.
--   4. Plancher : un thème ne sort qu'avec au moins 5 éléments, toutes sources
--      confondues. Un même dossier compte une fois par source : un élu qui le dépose,
--      le rapporte, l'amende, en parle et siège sur lui atteint le plancher à lui seul.
--   5. Rangs 1 à 3 par écart décroissant, le nom du thème départageant les ex æquo.
-- Mesuré le 2026-10-27 : 840 élus en exercice ont au moins un thème (563 députés,
-- 277 sénateurs). Les députés devenus sénateurs le 1er octobre 2026 n'en ont pas
-- encore : leur activité de député ne compte plus, et celle du Sénat reste sous le
-- plancher.
--
-- Les anciens élus n'ont pas de ligne : on ne compare pas un élu à une chambre où il
-- ne siège plus.
--
-- À appliquer à la main.
-- `CREATE MATERIALIZED VIEW` remplit la vue ; `refresh_activite_scores.py` la
-- rafraîchit chaque nuit, après `activite_elus_mv`.
-- Les droits de lecture reviennent seuls : les privilèges par défaut du schéma
-- `public` accordent la lecture à `anon` et `authenticated` sur tout objet créé par
-- `postgres`.
--
-- CONTRÔLES APRÈS :
--   SELECT chambre, count(DISTINCT uid), count(*) FROM themes_elus_mv GROUP BY 1;
--   SELECT rang, theme FROM themes_elus_mv WHERE uid = 'PA721750' ORDER BY rang;
--     (Céline Calvez : Culture, Union européenne, Entreprises ; sa proposition de loi
--     sur le sport, déposée en 2021, est hors de son mandat en cours)
--   REFRESH MATERIALIZED VIEW CONCURRENTLY public.themes_elus_mv;

BEGIN;

SET LOCAL statement_timeout = 0;

-- Rubrique d'une question, écrite ou orale → l'un des 27 thèmes des dossiers.
-- Le Sénat range déjà ses questions dans ces thèmes, à trois rubriques près.
-- L'Assemblée a ses propres rubriques : la table a été contrôlée le 2026-10-27 par le
-- ministère interrogé et les mots des titres, appris sur les questions du Sénat. Six
-- rubriques ont été déplacées à la lecture de leurs titres : `impôts locaux` (taxe
-- foncière), `frontaliers` (fiscalité) vers l'économie ; `Mutualité sociale agricole`
-- vers l'agriculture, son ministère de tutelle ; `gens du voyage` (occupations
-- illégales) vers la police ; `propriété` (squats, expulsions) vers le logement ;
-- `examens, concours et diplômes`, aux deux tiers sur le permis de conduire, vers
-- les transports.
-- `administration` est absente à dessein : elle mêle MaPrimeRénov', le RGPD, l'INPI
-- et Interpol, et tout thème qu'on lui donnerait serait faux pour la plupart de ses
-- questions. Une rubrique absente de la table sort du calcul, comme les rubriques de
-- procédure du Sénat (« Question de rappel »).
CREATE TABLE IF NOT EXISTS public.questions_rubriques_themes (
  rubrique text PRIMARY KEY,
  theme    text NOT NULL
);

-- Même posture que les autres tables de données publiques : RLS activé sans policy.
-- La vue, qui appartient à `postgres`, la lit quand même.
ALTER TABLE public.questions_rubriques_themes ENABLE ROW LEVEL SECURITY;

INSERT INTO public.questions_rubriques_themes (rubrique, theme) VALUES
  -- Affaires étrangères et coopération
  ('Affaires étrangères et coopération', 'Affaires étrangères et coopération'),
  ('action humanitaire', 'Affaires étrangères et coopération'),
  ('ambassades et consulats', 'Affaires étrangères et coopération'),
  ('Français de l''étranger', 'Affaires étrangères et coopération'),
  ('organisations internationales', 'Affaires étrangères et coopération'),
  ('politique extérieure', 'Affaires étrangères et coopération'),
  ('réfugiés et apatrides', 'Affaires étrangères et coopération'),
  -- Agriculture et pêche
  ('Agriculture et pêche', 'Agriculture et pêche'),
  ('agriculture', 'Agriculture et pêche'),
  ('agroalimentaire', 'Agriculture et pêche'),
  ('animaux', 'Agriculture et pêche'),
  ('aquaculture et pêche professionnelle', 'Agriculture et pêche'),
  ('bois et forêts', 'Agriculture et pêche'),
  ('Mutualité sociale agricole', 'Agriculture et pêche'),
  ('élevage', 'Agriculture et pêche'),
  -- Anciens combattants
  ('Anciens combattants', 'Anciens combattants'),
  ('anciens combattants et victimes de guerre', 'Anciens combattants'),
  -- Budget
  ('Budget', 'Budget'),
  ('finances publiques', 'Budget'),
  -- Collectivités territoriales
  ('Collectivités territoriales', 'Collectivités territoriales'),
  ('Aménagement du territoire', 'Collectivités territoriales'),
  ('aménagement du territoire', 'Collectivités territoriales'),
  ('collectivités territoriales', 'Collectivités territoriales'),
  ('communes', 'Collectivités territoriales'),
  ('départements', 'Collectivités territoriales'),
  ('intercommunalité', 'Collectivités territoriales'),
  ('montagne', 'Collectivités territoriales'),
  ('ruralité', 'Collectivités territoriales'),
  ('régions', 'Collectivités territoriales'),
  ('voirie', 'Collectivités territoriales'),
  -- Culture
  ('Culture', 'Culture'),
  ('architecture', 'Culture'),
  ('archives et bibliothèques', 'Culture'),
  ('arts et spectacles', 'Culture'),
  ('audiovisuel et communication', 'Culture'),
  ('culture', 'Culture'),
  ('enseignements artistiques', 'Culture'),
  ('langue française', 'Culture'),
  ('patrimoine culturel', 'Culture'),
  ('presse et livres', 'Culture'),
  ('propriété intellectuelle', 'Culture'),
  -- Défense
  ('Défense', 'Défense'),
  ('défense', 'Défense'),
  -- Entreprises
  ('Entreprises', 'Entreprises'),
  ('bâtiment et travaux publics', 'Entreprises'),
  ('chambres consulaires', 'Entreprises'),
  ('commerce et artisanat', 'Entreprises'),
  ('entreprises', 'Entreprises'),
  ('hôtellerie et restauration', 'Entreprises'),
  ('industrie', 'Entreprises'),
  ('matières premières', 'Entreprises'),
  ('PME, commerce et artisanat', 'Entreprises'),
  ('postes', 'Entreprises'),
  ('professions libérales', 'Entreprises'),
  ('services', 'Entreprises'),
  ('sociétés', 'Entreprises'),
  ('tourisme et loisirs', 'Entreprises'),
  ('travailleurs indépendants et autoentrepreneurs', 'Entreprises'),
  ('économie sociale et solidaire', 'Entreprises'),
  -- Environnement
  ('Environnement', 'Environnement'),
  ('biodiversité', 'Environnement'),
  ('catastrophes naturelles', 'Environnement'),
  ('chasse et pêche', 'Environnement'),
  ('climat', 'Environnement'),
  ('cours d''eau, étangs et lacs', 'Environnement'),
  ('déchets', 'Environnement'),
  ('développement durable', 'Environnement'),
  ('eau et assainissement', 'Environnement'),
  ('environnement', 'Environnement'),
  ('mer et littoral', 'Environnement'),
  ('mines et carrières', 'Environnement'),
  ('nuisances', 'Environnement'),
  ('pollution', 'Environnement'),
  ('produits dangereux', 'Environnement'),
  -- Famille
  ('Famille', 'Famille'),
  ('démographie', 'Famille'),
  ('enfants', 'Famille'),
  ('famille', 'Famille'),
  ('jeunes', 'Famille'),
  ('prestations familiales', 'Famille'),
  -- Fonction publique
  ('Fonction publique', 'Fonction publique'),
  ('fonction publique de l''État', 'Fonction publique'),
  ('fonction publique hospitalière', 'Fonction publique'),
  ('fonction publique territoriale', 'Fonction publique'),
  ('fonctionnaires et agents publics', 'Fonction publique'),
  ('services publics', 'Fonction publique'),
  -- Justice
  ('Justice', 'Justice'),
  ('aide aux victimes', 'Justice'),
  ('crimes, délits et contraventions', 'Justice'),
  ('discriminations', 'Justice'),
  ('droit pénal', 'Justice'),
  ('droits fondamentaux', 'Justice'),
  ('déchéances et incapacités', 'Justice'),
  ('harcèlement', 'Justice'),
  ('justice', 'Justice'),
  ('lieux de privation de liberté', 'Justice'),
  ('professions judiciaires et juridiques', 'Justice'),
  ('état civil', 'Justice'),
  -- Logement et urbanisme
  ('Logement et urbanisme', 'Logement et urbanisme'),
  ('baux', 'Logement et urbanisme'),
  ('copropriété', 'Logement et urbanisme'),
  ('logement', 'Logement et urbanisme'),
  ('logement : aides et prêts', 'Logement et urbanisme'),
  ('professions et activités immobilières', 'Logement et urbanisme'),
  ('propriété', 'Logement et urbanisme'),
  ('urbanisme', 'Logement et urbanisme'),
  -- Outre-mer
  ('Outre-mer', 'Outre-mer'),
  ('outre-mer', 'Outre-mer'),
  -- Police et sécurité
  ('Police et sécurité', 'Police et sécurité'),
  ('armes', 'Police et sécurité'),
  ('drogue', 'Police et sécurité'),
  ('gendarmerie', 'Police et sécurité'),
  ('gens du voyage', 'Police et sécurité'),
  ('immigration', 'Police et sécurité'),
  ('nationalité', 'Police et sécurité'),
  ('ordre public', 'Police et sécurité'),
  ('papiers d''identité', 'Police et sécurité'),
  ('police', 'Police et sécurité'),
  ('sectes et sociétés secrètes', 'Police et sécurité'),
  ('sécurité des biens et des personnes', 'Police et sécurité'),
  ('terrorisme', 'Police et sécurité'),
  ('étrangers', 'Police et sécurité'),
  -- Pouvoirs publics et Constitution
  ('Pouvoirs publics et Constitution', 'Pouvoirs publics et Constitution'),
  ('associations et fondations', 'Pouvoirs publics et Constitution'),
  ('cérémonies publiques et fêtes légales', 'Pouvoirs publics et Constitution'),
  ('décorations, insignes et emblèmes', 'Pouvoirs publics et Constitution'),
  ('Gouvernement', 'Pouvoirs publics et Constitution'),
  ('heure légale', 'Pouvoirs publics et Constitution'),
  ('laïcité', 'Pouvoirs publics et Constitution'),
  ('lois', 'Pouvoirs publics et Constitution'),
  ('ministères et secrétariats d''État', 'Pouvoirs publics et Constitution'),
  ('Parlement', 'Pouvoirs publics et Constitution'),
  ('partis et mouvements politiques', 'Pouvoirs publics et Constitution'),
  ('religions et cultes', 'Pouvoirs publics et Constitution'),
  ('élections et référendums', 'Pouvoirs publics et Constitution'),
  ('élus', 'Pouvoirs publics et Constitution'),
  ('État', 'Pouvoirs publics et Constitution'),
  -- Questions sociales et santé
  ('Questions sociales et santé', 'Questions sociales et santé'),
  ('alcools et boissons alcoolisées', 'Questions sociales et santé'),
  ('bioéthique', 'Questions sociales et santé'),
  ('contraception', 'Questions sociales et santé'),
  ('dépendance', 'Questions sociales et santé'),
  ('femmes', 'Questions sociales et santé'),
  ('fin de vie et soins palliatifs', 'Questions sociales et santé'),
  ('handicapés', 'Questions sociales et santé'),
  ('institutions sociales et médico sociales', 'Questions sociales et santé'),
  ('interruption volontaire de grossesse', 'Questions sociales et santé'),
  ('maladies', 'Questions sociales et santé'),
  ('mort et décès', 'Questions sociales et santé'),
  ('médecine', 'Questions sociales et santé'),
  ('médecines alternatives', 'Questions sociales et santé'),
  ('pauvreté', 'Questions sociales et santé'),
  ('personnes handicapées', 'Questions sociales et santé'),
  ('personnes âgées', 'Questions sociales et santé'),
  ('pharmacie et médicaments', 'Questions sociales et santé'),
  ('politique sociale', 'Questions sociales et santé'),
  ('professions de santé', 'Questions sociales et santé'),
  ('professions et activités sociales', 'Questions sociales et santé'),
  ('sang et organes humains', 'Questions sociales et santé'),
  ('santé', 'Questions sociales et santé'),
  ('services à la personne', 'Questions sociales et santé'),
  ('Société', 'Questions sociales et santé'),
  ('égalité des sexes et parité', 'Questions sociales et santé'),
  ('établissements de santé', 'Questions sociales et santé'),
  -- Recherche, sciences et techniques
  ('Recherche, sciences et techniques', 'Recherche, sciences et techniques'),
  ('enseignement supérieur', 'Recherche, sciences et techniques'),
  ('espace et politique spatiale', 'Recherche, sciences et techniques'),
  ('grandes écoles', 'Recherche, sciences et techniques'),
  ('Internet', 'Recherche, sciences et techniques'),
  ('nouvelles technologies', 'Recherche, sciences et techniques'),
  ('numérique', 'Recherche, sciences et techniques'),
  ('recherche et innovation', 'Recherche, sciences et techniques'),
  ('télécommunications', 'Recherche, sciences et techniques'),
  -- Sports
  ('Sports', 'Sports'),
  ('sports', 'Sports'),
  ('éducation physique et sportive', 'Sports'),
  -- Sécurité sociale
  ('Sécurité sociale', 'Sécurité sociale'),
  ('assurance complémentaire', 'Sécurité sociale'),
  ('assurance invalidité décès', 'Sécurité sociale'),
  ('assurance maladie maternité', 'Sécurité sociale'),
  ('retraites : fonctionnaires civils et militaires', 'Sécurité sociale'),
  ('retraites : généralités', 'Sécurité sociale'),
  ('retraites : régime agricole', 'Sécurité sociale'),
  ('retraites : régime général', 'Sécurité sociale'),
  ('retraites : régimes autonomes et spéciaux', 'Sécurité sociale'),
  ('sécurité sociale', 'Sécurité sociale'),
  -- Traités et conventions
  ('Traités et conventions', 'Traités et conventions'),
  ('traités et conventions', 'Traités et conventions'),
  -- Transports
  ('Transports', 'Transports'),
  ('automobiles', 'Transports'),
  ('cycles et motocycles', 'Transports'),
  ('examens, concours et diplômes', 'Transports'),
  ('sécurité routière', 'Transports'),
  ('taxis', 'Transports'),
  ('transports', 'Transports'),
  ('transports aériens', 'Transports'),
  ('transports ferroviaires', 'Transports'),
  ('transports par eau', 'Transports'),
  ('transports routiers', 'Transports'),
  ('transports urbains', 'Transports'),
  -- Travail
  ('Travail', 'Travail'),
  ('accidents du travail et maladies professionnelles', 'Travail'),
  ('chômage', 'Travail'),
  ('emploi et activité', 'Travail'),
  ('formation professionnelle et apprentissage', 'Travail'),
  ('syndicats', 'Travail'),
  ('travail', 'Travail'),
  -- Union européenne
  ('Union européenne', 'Union européenne'),
  -- Économie et finances, fiscalité
  ('Économie et finances, fiscalité', 'Économie et finances, fiscalité'),
  ('assurances', 'Économie et finances, fiscalité'),
  ('banques et établissements financiers', 'Économie et finances, fiscalité'),
  ('commerce extérieur', 'Économie et finances, fiscalité'),
  ('consommation', 'Économie et finances, fiscalité'),
  ('contributions indirectes', 'Économie et finances, fiscalité'),
  ('donations et successions', 'Économie et finances, fiscalité'),
  ('frontaliers', 'Économie et finances, fiscalité'),
  ('impôt de solidarité sur la fortune', 'Économie et finances, fiscalité'),
  ('impôt sur la fortune immobilière', 'Économie et finances, fiscalité'),
  ('impôt sur le revenu', 'Économie et finances, fiscalité'),
  ('impôt sur les sociétés', 'Économie et finances, fiscalité'),
  ('impôts et taxes', 'Économie et finances, fiscalité'),
  ('impôts locaux', 'Économie et finances, fiscalité'),
  ('jeux et paris', 'Économie et finances, fiscalité'),
  ('marchés financiers', 'Économie et finances, fiscalité'),
  ('marchés publics', 'Économie et finances, fiscalité'),
  ('moyens de paiement', 'Économie et finances, fiscalité'),
  ('politique économique', 'Économie et finances, fiscalité'),
  ('pouvoir d''achat', 'Économie et finances, fiscalité'),
  ('publicité', 'Économie et finances, fiscalité'),
  ('taxe sur la valeur ajoutée', 'Économie et finances, fiscalité'),
  ('ventes et commerce électronique', 'Économie et finances, fiscalité'),
  -- Éducation
  ('Éducation', 'Éducation'),
  ('enseignement', 'Éducation'),
  ('enseignement agricole', 'Éducation'),
  ('enseignement maternel et primaire', 'Éducation'),
  ('enseignement privé', 'Éducation'),
  ('enseignement secondaire', 'Éducation'),
  ('enseignement technique et professionnel', 'Éducation'),
  -- Énergie
  ('Énergie', 'Énergie'),
  ('énergie et carburants', 'Énergie')
ON CONFLICT (rubrique) DO UPDATE SET theme = EXCLUDED.theme;

DROP MATERIALIZED VIEW IF EXISTS public.themes_elus_mv;

CREATE MATERIALIZED VIEW public.themes_elus_mv AS
-- Population et fenêtre recopiées d'`active_acteurs` dans `activite_elus_mv` : élus en
-- exercice hors ministres, mandat compté depuis `debut_fenetre`.
WITH elus AS (
  SELECT a.uid,
         CASE WHEN a.est_depute_actuel THEN 'AN' ELSE 'SN' END AS chambre,
         GREATEST(
           CASE WHEN a.est_depute_actuel THEN DATE '2024-07-18' ELSE DATE '2023-10-02' END,
           COALESCE(
             (SELECT min((p->>'debut')::date) FROM jsonb_array_elements(a.periodes_mandat_assemblee) p),
             a.date_debut_mandat
           )
         ) AS debut_fenetre
  FROM public.acteurs a
  WHERE (a.est_depute_actuel OR a.est_senateur_actuel)
    AND a.est_ministre_actuel IS NOT TRUE
),
-- Même règle que `dossiers_gouvernement` du score (D-152).
dossiers_gouvernement AS (
  SELECT dl.uid
  FROM public.dossiers_legislatifs dl
  WHERE EXISTS (
    SELECT 1 FROM unnest(dl.textes_associes_refs) r
    WHERE r LIKE 'PRJL%' OR r LIKE 'DECL%'
  )
),
-- (élu, source, dossier), chacune déjà bornée au mandat en cours de l'élu.
activite_dossiers AS (
  -- Dépôts : `initiateurs` du score.
  SELECT x.uid, 'depot' AS source, x.dossier_uid
  FROM (
    SELECT dl.initiateur_acteur_ref AS uid, dl.uid AS dossier_uid, dl.date_depot
    FROM public.dossiers_legislatifs dl
    WHERE dl.initiateur_acteur_ref IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM dossiers_gouvernement g WHERE g.uid = dl.uid)
    UNION
    SELECT unnest(t.auteurs_refs), t.dossier_ref, dl.date_depot
    FROM public.textes t
    JOIN public.dossiers_legislatifs dl ON dl.uid = t.dossier_ref
    WHERE t.auteurs_refs IS NOT NULL
      AND t.depot_code = 'INITDEP'
      AND dl.procedure_libelle <> 'Responsabilité pénale du président de la république'
      AND NOT EXISTS (SELECT 1 FROM dossiers_gouvernement g WHERE g.uid = dl.uid)
  ) x
  JOIN elus e ON e.uid = x.uid
  WHERE x.date_depot >= e.debut_fenetre
  UNION ALL
  -- Rapports : `rapports_portes` du score, législatifs et de contrôle confondus.
  SELECT x.uid, 'rapport', x.dossier_uid
  FROM (
    SELECT unnest(t.rapporteurs_refs) AS uid, t.dossier_ref AS dossier_uid, t.date_depot
    FROM public.textes t
    WHERE t.rapporteurs_refs IS NOT NULL
      AND t.dossier_ref IS NOT NULL
      AND (t.type_libelle ILIKE '%rapport%' OR t.type_libelle = 'Avis')
      AND t.denomination NOT ILIKE 'Annexe%'
  ) x
  JOIN elus e ON e.uid = x.uid
  WHERE x.date_depot >= e.debut_fenetre
  UNION ALL
  SELECT x.acteur_uid, 'amendement', x.dossier_uid
  FROM public.dossier_amendements_elus x
  JOIN elus e ON e.uid = x.acteur_uid AND e.chambre = x.chambre
  WHERE EXISTS (
    SELECT 1 FROM public.actes_legislatifs al
    WHERE al.dossier_uid = x.dossier_uid AND al.date_acte >= e.debut_fenetre
  )
  UNION ALL
  -- Prises de parole : filtres de `dossier_orateurs` (2026-10-26_elus_actifs_dossier.sql).
  SELECT DISTINCT i.acteur_uid, 'parole', i.dossier_uid
  FROM public.debat_interventions i
  JOIN public.debat_seances s ON s.uid = i.seance_uid
  JOIN elus e
    ON e.uid = i.acteur_uid
   AND e.chambre = CASE WHEN i.seance_uid LIKE 'SEN:%' THEN 'SN' ELSE 'AN' END
  WHERE i.dossier_uid IS NOT NULL
    AND s.date_seance >= e.debut_fenetre
    AND coalesce(i.role_debat, '') <> 'president'
    AND coalesce(i.orateur_qualite, '') NOT IN ('président de séance', 'didascalie')
    AND NOT (
      coalesce(i.orateur_qualite, '') ILIKE 'ministre%'
      OR coalesce(i.orateur_qualite, '') ILIKE 'premier ministre%'
      OR coalesce(i.orateur_qualite, '') ILIKE 'première ministre%'
      OR coalesce(i.orateur_qualite, '') ILIKE 'garde des sceaux%'
      OR coalesce(i.orateur_qualite, '') ILIKE 'secrétaire d%tat%'
      OR coalesce(i.orateur_qualite, '') = 'secrétaire d'
    )
    AND i.nb_mots > 20
  UNION ALL
  SELECT x.acteur_uid, 'commission', x.dossier_uid
  FROM public.dossier_presences_elus x
  JOIN elus e ON e.uid = x.acteur_uid AND e.chambre = 'AN'
),
-- Un élément = (élu, source, objet, thème), compté une fois.
elements AS (
  SELECT DISTINCT e.uid, e.chambre, a.source, a.dossier_uid AS objet, th.theme
  FROM activite_dossiers a
  JOIN elus e ON e.uid = a.uid
  JOIN public.dossiers_legislatifs d ON d.uid = a.dossier_uid
  CROSS JOIN LATERAL unnest(d.themes) AS th(theme)
  UNION ALL
  SELECT e.uid, e.chambre, 'question', q.uid, r.theme
  FROM public.questions q
  JOIN elus e
    ON e.uid = q.uid_auteur
   AND e.chambre = CASE q.chambre WHEN 'AN' THEN 'AN' WHEN 'SENAT' THEN 'SN' END
  JOIN public.questions_rubriques_themes r ON r.rubrique = q.rubrique
  WHERE q.date_jo >= e.debut_fenetre
),
comptes AS (
  SELECT uid, chambre, source, theme, count(*) AS n
  FROM elements
  GROUP BY 1, 2, 3, 4
),
par_source AS (
  SELECT c.*,
         sum(n) OVER (PARTITION BY uid, source) AS total_source
  FROM comptes c
),
nb_sources AS (
  SELECT uid, count(DISTINCT source) AS nb FROM comptes GROUP BY uid
),
-- Part d'un thème dans l'activité de l'élu, chaque source pesant autant.
profils AS (
  SELECT p.uid, p.chambre, p.theme,
         sum(p.n::double precision / p.total_source) / max(s.nb) AS part,
         sum(p.n) AS nb_elements
  FROM par_source p
  JOIN nb_sources s USING (uid)
  GROUP BY 1, 2, 3
),
-- Moyenne de la chambre : somme des parts ÷ nombre d'élus de la chambre qui ont une
-- activité, ce qui compte à zéro ceux qui n'ont rien sur le thème.
population AS (
  SELECT chambre, count(DISTINCT uid) AS nb_elus FROM profils GROUP BY 1
),
moyennes AS (
  SELECT p.chambre, p.theme, sum(p.part) / max(n.nb_elus) AS part_moyenne
  FROM profils p
  JOIN population n USING (chambre)
  GROUP BY 1, 2
),
classes AS (
  SELECT p.uid, p.chambre, p.theme,
         row_number() OVER (
           PARTITION BY p.uid
           ORDER BY p.part / m.part_moyenne DESC, p.theme COLLATE "C"
         ) AS rang
  FROM profils p
  JOIN moyennes m USING (chambre, theme)
  WHERE p.nb_elements >= 5
)
SELECT uid, chambre, rang::int AS rang, theme
FROM classes
WHERE rang <= 3;

-- Unique pour `REFRESH … CONCURRENTLY`, et lu par la fiche (`uid = …`).
CREATE UNIQUE INDEX themes_elus_mv_uid_rang ON public.themes_elus_mv (uid, rang);

COMMIT;
