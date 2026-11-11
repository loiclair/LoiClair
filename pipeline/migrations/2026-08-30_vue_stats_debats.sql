-- Statistiques de debats par dossier, agregees cote Postgres.
--
-- La fiche resume-ia rapatriait jusqu'a 15 402 lignes de debat_interventions pour
-- n'en tirer que trois chiffres : le nombre d'interventions et le nombre de seances
-- par chambre. Au-dela du gaspillage, la reponse etait tronquee par le plafond
-- "Max rows" de l'ancienne API (3 000) : le compte de seances d'un gros dossier etait
-- sous-estime, sans aucune erreur. Meme anti-pattern que les vues de valeurs
-- distinctes du 2026-08-29, meme remede.
--
-- security_invoker : la vue s'evalue avec les droits de l'appelant, donc les
-- policies RLS des tables sources continuent de s'appliquer normalement.

create or replace view public.dossiers_debats_stats
with (security_invoker = true) as
  select i.dossier_uid,
         count(*) as nb_interventions,
         count(distinct s.uid) filter (where s.chambre = 'AN')  as nb_seances_an,
         count(distinct s.uid) filter (where s.chambre = 'SEN') as nb_seances_sen
  from public.debat_interventions i
  join public.debat_seances s on s.uid = i.seance_uid
  where i.dossier_uid is not null
  group by i.dossier_uid;

-- Meme agregation, un cran plus fin : une ligne par couple (dossier, seance).
-- C'est ce que lit l'index des seances de /debats, qui affiche pour chaque seance
-- sa date, sa chambre et son nombre d'interventions. Sans elle, l'index devrait
-- relire les interventions du dossier pour les compter en JS, donc retomber dans
-- la troncature qu'on corrige ici. 1 208 lignes au total, 52 seances au maximum
-- pour un meme dossier : la lecture reste tres loin du plafond.

create or replace view public.dossiers_seances_stats
with (security_invoker = true) as
  select i.dossier_uid,
         s.uid as seance_uid,
         s.chambre,
         s.date_seance,
         s.titre,
         s.url_source,
         count(*) as nb_interventions
  from public.debat_interventions i
  join public.debat_seances s on s.uid = i.seance_uid
  where i.dossier_uid is not null
  group by i.dossier_uid, s.uid, s.chambre, s.date_seance, s.titre, s.url_source;
