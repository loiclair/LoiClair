-- 2026-09-15 : extractions d'arguments des débats gardées par séance
--
-- Additive, à appliquer avant le déploiement : le code en ligne ne lit ni la table
-- ni la nouvelle colonne de la vue.
--
-- POURQUOI. Le résumé des débats se fait en deux temps : une extraction des
-- arguments, qui lit tout le compte rendu et coûte l'essentiel, puis une synthèse
-- qui ne lit que ces extractions. Jusqu'ici une seule empreinte de version
-- couvrait les deux, et rien de l'extraction n'était gardé : retoucher le prompt
-- de synthèse faisait relire tout le compte rendu, dans chaque langue, et une
-- seule séance ajoutée à un débat faisait relire toutes les précédentes.
--
-- `debat_extractions` garde une extraction par partie de séance, sous la clé
-- `sha256(version d'extraction + titre du dossier + texte de la partie)` que
-- calcule `api/resume-debats`. Une ligne n'est jamais écrasée : une version de
-- prompt qui revient (un revert) retrouve ses extractions sans rien repayer.
-- L'extraction est faite en français et sert aux deux langues.
--
-- RLS activée sans policy, comme `debat_interventions` et `debat_seances` :
-- seule la clé serveur y lit et y écrit.

create table if not exists public.debat_extractions (
  cle text primary key,
  dossier_uid text not null,
  seance_uid text not null,
  partie smallint not null,
  version_extraction text not null,
  extraction text not null,
  created_at timestamptz not null default now()
);

create index if not exists debat_extractions_dossier_uid_idx
  on public.debat_extractions (dossier_uid);

alter table public.debat_extractions enable row level security;

-- `derniere_seance` alimente la mention « jusqu'au X » sous le résumé, qui suit
-- désormais le débat pendant qu'il a lieu. Ajoutée en dernière colonne : un
-- `create or replace view` refuse de déplacer ou renommer les colonnes existantes.

create or replace view public.dossiers_debats_stats
with (security_invoker = true) as
  select i.dossier_uid,
         count(*) as nb_interventions,
         count(distinct s.uid) filter (where s.chambre = 'AN')  as nb_seances_an,
         count(distinct s.uid) filter (where s.chambre = 'SEN') as nb_seances_sen,
         max(s.date_seance) as derniere_seance
  from public.debat_interventions i
  join public.debat_seances s on s.uid = i.seance_uid
  where i.dossier_uid is not null
  group by i.dossier_uid;
