-- Migration : présences en commission (10ᵉ métrique du score d'activité)
-- À appliquer à la main avant le déploiement.
--
-- Ajoute :
--   • Table commission_reunions (1 ligne par réunion AN ou Sénat avec feuille de présence)
--   • Table commission_presences (1 ligne par participant nominatif, statut present/excuse)
--   • Colonne acteurs.nb_commission_presences (nullable : null = pas de commission,
--     ne pénalise pas le score — cohérent avec taux_participation_votes_finaux)
--   • RPC get_activite_elus mise à jour pour exposer nb_commission_presences

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Tables
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.commission_reunions (
  uid           text PRIMARY KEY,                         -- "AN:RUANR5L17S2025IDC453385" | "SEN:42175"
  chambre       text NOT NULL CHECK (chambre IN ('AN','SEN')),
  organe_ref    text,                                     -- PO… (AN) | comcod (Sénat)
  date_reunion  date NOT NULL,
  type_reunion  text,                                     -- "COM_PERMANENTE", "COM_ENQUETE", … (Sénat) ou null (AN)
  url_source    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commission_reunions_chambre_date
  ON public.commission_reunions (chambre, date_reunion DESC);
CREATE INDEX IF NOT EXISTS idx_commission_reunions_organe
  ON public.commission_reunions (organe_ref);

CREATE TABLE IF NOT EXISTS public.commission_presences (
  reunion_uid   text NOT NULL REFERENCES public.commission_reunions(uid) ON DELETE CASCADE,
  acteur_uid    text NOT NULL REFERENCES public.acteurs(uid) ON DELETE CASCADE,
  statut        text NOT NULL CHECK (statut IN ('present','excuse')),
  PRIMARY KEY (reunion_uid, acteur_uid)
);

CREATE INDEX IF NOT EXISTS idx_commission_presences_acteur
  ON public.commission_presences (acteur_uid, statut);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Compteur agrégé sur acteurs (nullable)
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.acteurs
  ADD COLUMN IF NOT EXISTS nb_commission_presences integer;

-- Peuplement initial (à relancer après chaque import)
UPDATE acteurs a SET nb_commission_presences = sub.cnt
FROM (
  SELECT acteur_uid, COUNT(*) AS cnt
  FROM commission_presences
  WHERE statut = 'present'
  GROUP BY acteur_uid
) sub
WHERE a.uid = sub.acteur_uid;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RPC get_activite_elus
--
-- Modifications par rapport à la version précédente :
--   • RETURN TABLE : ajouter  nb_commission_presences  integer
--   • active_acteurs CTE : ajouter  a.nb_commission_presences
--   • SELECT final : ajouter  aa.nb_commission_presences
-- ────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_activite_elus();

CREATE OR REPLACE FUNCTION public.get_activite_elus()
 RETURNS TABLE(uid text, prenom text, nom text, groupe text, chambre text, taux_participation_votes_finaux numeric, nb_dossiers_inities bigint, nb_textes_cosignes bigint, nb_rapporteur bigint, nb_amendements_auteur integer, nb_amendements_cosignataire integer, nb_questions_orales integer, nb_questions_ecrites integer, nb_prises_parole integer, nb_commission_presences integer)
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
  aa.nb_prises_parole,
  aa.nb_commission_presences
FROM active_acteurs aa
LEFT JOIN dossiers_count   dc ON dc.uid   = aa.uid
LEFT JOIN cosigned_count   cc ON cc.a_uid = aa.uid
LEFT JOIN rapporteur_count rc ON rc.a_uid = aa.uid
ORDER BY aa.nom, aa.prenom;
$function$;
