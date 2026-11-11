-- 2026-09-22 : la cohorte de dépôt de la 17ᵉ législature, agrégée côté Postgres
--
-- POURQUOI. `getTauxPromulgation` rapatriait les 3 312 dossiers déposés depuis le
-- 18 juillet 2024, sept colonnes chacun, pour n'en tirer qu'une dizaine de compteurs
-- et trois graphiques : quatre pages de l'ancienne API et 901 518 octets par appel, 28 Mo sur
-- la journée du 21 septembre 2026. Même anti-pattern que les vues de valeurs
-- distinctes du 2026-08-29 et les stats de débats du 2026-08-30, même remède.
--
-- DEUX VUES ET NON UNE. Les consommateurs ne croisent jamais le groupe initiateur
-- avec un mois : la page /Facts/taux-promulgation ventile par mois *ou* par groupe,
-- jamais les deux à la fois. Les croiser dans une seule vue donnerait 1 135 lignes
-- et 264 Ko ; les séparer en donne 437 + 194, soit 103 139 octets mesurés le
-- 2026-09-22. Neuf fois moins qu'avant, contre trois fois et demie pour la vue unique.
--
-- LES RÈGLES MÉTIER RESTENT EN JAVASCRIPT. Les vues ne savent pas ce qu'est un texte
-- « promulgable » ni une loi « promulguée » : elles rendent `procedure_libelle` et
-- `statut_final` bruts, et `facts-queries.ts` leur applique `PROCEDURES_PROMULGABLES`
-- et son test de statut, exactement comme avant. C'est ce qui empêche deux
-- définitions de diverger entre le SQL et le TypeScript.
--
-- LA DATE DE DÉBUT EST EN DUR. `DATE '2024-07-18'` est le jumeau SQL de
-- `LEGISLATURE_17_START` (`src/lib/facts-shared.ts`), comme dans les vues d'activité
-- depuis le 2026-04-29. Le filtre ne peut pas remonter côté JavaScript : la borne
-- tombe au milieu du mois, et filtrer sur `mois_depot >= '2024-07'` ferait entrer les
-- 20 dossiers déposés du 1ᵉʳ au 17 juillet 2024, qui relèvent de la 16ᵉ législature.
--
-- LE MOIS EST CALCULÉ EN UTC. `date_depot` est un `timestamptz`, et 2 912 dépôts sur
-- 3 312 portent une heure autre que minuit. Le JavaScript qu'on remplace faisait
-- `new Date(...).getMonth()`, donc le mois du fuseau du serveur de rendu : UTC sur
-- l'ancien hébergeur. `at time zone 'UTC'` reproduit ce découpage. Conséquence à connaître pour
-- une comparaison locale : un `next dev` lancé à Seattle rangeait jusqu'ici 24
-- dossiers dans le mois précédent, il donnera désormais les mêmes mois que la prod.
-- `date_promulgation` est un `timestamp` nu à minuit pile : rien à convertir.
--
-- `security_invoker` : les vues s'évaluent avec les droits de l'appelant, donc les
-- policies RLS de `dossiers_legislatifs` continuent de s'appliquer.
--
-- ORDRE D'APPLICATION : avant le déploiement du code qui les lit. Purement additif.
--
-- CONTRÔLES APRÈS :
--   - les deux vues comptent la même cohorte, et c'est bien celle d'avant (3 312) :
--       SELECT (SELECT sum(nb) FROM dossiers_cohorte_par_mois)   AS par_mois,
--              (SELECT sum(nb) FROM dossiers_cohorte_par_groupe) AS par_groupe,
--              (SELECT count(*) FROM dossiers_legislatifs
--                WHERE date_depot >= DATE '2024-07-18')          AS reference;
--   - le nombre de lignes reste très loin du plafond de 3 000 lignes de l'ancienne API :
--       SELECT count(*) FROM dossiers_cohorte_par_mois;    -- 437 au 2026-09-22
--       SELECT count(*) FROM dossiers_cohorte_par_groupe;  -- 194 au 2026-09-22

-- Ventilation par mois. Lue par `getTauxPromulgation` pour tous ses compteurs, par
-- la courbe des dépôts et celle des promulgations de /Facts/taux-promulgation, et par
-- la série des 24 derniers mois de /etat-des-lieux.
create or replace view public.dossiers_cohorte_par_mois
with (security_invoker = true) as
  select d.procedure_libelle,
         d.statut_final,
         to_char(d.date_depot at time zone 'UTC', 'YYYY-MM') as mois_depot,
         to_char(d.date_promulgation, 'YYYY-MM')             as mois_promulgation,
         count(*)                                            as nb
  from public.dossiers_legislatifs d
  where d.date_depot >= DATE '2024-07-18'
  group by 1, 2, 3, 4;

-- Ventilation par groupe initiateur. Lue par les deux graphiques en barres de
-- /Facts/taux-promulgation : les textes déposés par groupe, et les lois promulguées
-- par groupe. Le libellé voyage avec l'uid parce que c'est lui que la barre affiche,
-- y compris pour les dossiers dont le groupe n'a pas d'uid.
create or replace view public.dossiers_cohorte_par_groupe
with (security_invoker = true) as
  select d.procedure_libelle,
         d.statut_final,
         d.initiateur_groupe_uid,
         d.initiateur_groupe_libelle,
         count(*) as nb
  from public.dossiers_legislatifs d
  where d.date_depot >= DATE '2024-07-18'
  group by 1, 2, 3, 4;
