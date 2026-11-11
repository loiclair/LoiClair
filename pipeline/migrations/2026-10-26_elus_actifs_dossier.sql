-- 2026-10-26 : les élus les plus actifs sur un texte, pour la section « Les plus
-- actifs dans ce dossier » de la fiche dossier.
--
-- Trois mesures, lues par chambre : prises de parole en séance, amendements déposés,
-- présences en commission. La page les fond en un score par centiles, chambre par
-- chambre (`elusActifs` de `resume-ia/page.tsx`) ; la base ne livre que les nombres
-- bruts par élu. La troisième n'existe
-- qu'à l'Assemblée : le Sénat ne relie qu'environ 200 vraies réunions de commission à
-- un texte, trop peu pour une liste qui ne mente pas par omission.
--
-- Rien ici ne touche au score d'activité ni aux compteurs `nb_*` d'`acteurs` : ces
-- objets en sont des vues par texte, sans borne de mandat. Sur un texte, tout ce qui a
-- été dit, déposé ou siégé compte, y compris par un élu qui a changé de chambre.
--
-- À appliquer à la main. Les deux tables se
-- remplissent au prochain passage de `import_amendements.py` et de
-- `import_reunions_an.py` ; d'ici là, la section n'affiche que les prises de parole et
-- les réunions des commissions à texte unique.

-- Amendements déposés par un élu sur un dossier, auteur principal seul : les
-- cosignatures ne comptent pas, comme dans le bloc « Amendements adoptés » (D-235).
-- Alimentée par `import_amendements.py`, réconciliée en entier à chaque passe.
create table if not exists public.dossier_amendements_elus (
  dossier_uid text not null references public.dossiers_legislatifs (uid) on delete cascade,
  -- Chambre de dépôt : AN (archive de la 17ᵉ législature) ou SN (dump ameli, sans
  -- borne de date).
  chambre     text not null check (chambre in ('AN', 'SN')),
  -- `acteurs.uid`. Pas de clé étrangère : certains auteurs de l'Assemblée n'ont pas de
  -- ligne dans `acteurs`, et la page les écarte à la lecture.
  acteur_uid  text not null,
  nb_deposes  integer not null check (nb_deposes > 0),
  primary key (dossier_uid, chambre, acteur_uid)
);

-- Réunion de commission de l'Assemblée et dossier qu'elle examine, lu dans l'ordre du
-- jour de l'agenda (`pointsODJ.pointODJ[].dossiersLegislatifsRefs`). Une réunion peut
-- examiner plusieurs dossiers. Alimentée par `import_reunions_an.py`.
create table if not exists public.commission_reunions_dossiers (
  reunion_uid text not null references public.commission_reunions (uid) on delete cascade,
  dossier_uid text not null references public.dossiers_legislatifs (uid) on delete cascade,
  primary key (reunion_uid, dossier_uid)
);

create index if not exists idx_commission_reunions_dossiers_dossier
  on public.commission_reunions_dossiers (dossier_uid);

-- Lu par la seconde source de `dossier_presences_elus` : retrouver les réunions d'une
-- commission à texte unique.
create index if not exists idx_commission_reunions_organe
  on public.commission_reunions (organe_ref);

-- Même posture que les autres tables de données publiques du projet : RLS activé
-- sans policy, la lecture passant par la clé de service côté serveur.
alter table public.dossier_amendements_elus enable row level security;
alter table public.commission_reunions_dossiers enable row level security;

-- Prises de parole d'un élu en séance sur un dossier, chambre par chambre.
-- Mêmes filtres que `recalc_nb_prises_parole()` (2026-10-15_prises_parole_senateurs_an.sql) :
-- plus de 20 mots, ni présidence de séance ni didascalie, ni intervention faite comme
-- membre du Gouvernement. Les rapporteurs restent comptés. Ni borne de date ni règle de
-- chambre actuelle : ce sont des filtres du score, pas du texte.
-- La chambre se lit dans le préfixe de `seance_uid` (`AN:` ou `SEN:`), ce qui évite la
-- jointure sur `debat_seances`.
create or replace view public.dossier_orateurs
with (security_invoker = true) as
select
  i.dossier_uid,
  case when i.seance_uid like 'SEN:%' then 'SN' else 'AN' end as chambre,
  i.acteur_uid,
  count(*)::int as nb_interventions
from public.debat_interventions i
where i.dossier_uid is not null
  and i.acteur_uid is not null
  and coalesce(i.role_debat, '') <> 'president'
  and coalesce(i.orateur_qualite, '') not in ('président de séance', 'didascalie')
  and not (
    coalesce(i.orateur_qualite, '') ilike 'ministre%'
    or coalesce(i.orateur_qualite, '') ilike 'premier ministre%'
    or coalesce(i.orateur_qualite, '') ilike 'première ministre%'
    or coalesce(i.orateur_qualite, '') ilike 'garde des sceaux%'
    or coalesce(i.orateur_qualite, '') ilike 'secrétaire d%tat%'
    or coalesce(i.orateur_qualite, '') = 'secrétaire d'
  )
  and i.nb_mots > 20
group by 1, 2, 3;

-- Réunions de commission de l'Assemblée où un député était présent, par dossier.
-- Deux sources de réunions, réunies par UNION (une réunion n'est comptée qu'une fois) :
--   1. l'ordre du jour de l'agenda (`commission_reunions_dossiers`) ;
--   2. les réunions d'une commission qui ne sert qu'un dossier dans
--      `actes_legislatifs`. Mesuré le 2026-10-26 : 79 organes et 992 réunions, des
--      commissions d'enquête (802), des CMP (54), des commissions spéciales (51), une
--      mission d'information (52) et un organe absent d'`organes` (33) ; les commissions permanentes servent toutes plusieurs
--      dossiers et n'entrent jamais par là.
-- La seconde source est écrite en NOT EXISTS sur la ligne d'acte, et non en
-- GROUP BY … HAVING : le filtre `dossier_uid = …` de la page descend ainsi jusqu'à
-- `idx_actes_dossier_uid`, au lieu d'agréger toute la table à chaque lecture.
--
-- Les sénateurs d'une CMP sont écartés : l'agenda de l'Assemblée les liste aussi (544
-- présences sur 1 059 au 2026-10-26), et la section ne compare jamais un député à un
-- sénateur. Ils sont reconnus comme `import_reunions_an.py` les reconnaît, matricule du
-- Sénat sans mandat de député en cours, mais seulement dans une CMP : hors CMP, ce
-- critère attraperait les neuf députés devenus sénateurs le 1er octobre 2026, dont les
-- présences en commission permanente datent de leur mandat de député.
create or replace view public.dossier_presences_elus
with (security_invoker = true) as
with reunions as (
  select rd.reunion_uid, rd.dossier_uid
  from public.commission_reunions_dossiers rd
  union
  select r.uid, a.dossier_uid
  from public.actes_legislatifs a
  join public.commission_reunions r
    on r.organe_ref = a.organe_ref and r.chambre = 'AN'
  where a.organe_ref is not null
    and not exists (
      select 1 from public.actes_legislatifs b
      where b.organe_ref = a.organe_ref and b.dossier_uid <> a.dossier_uid
    )
)
select x.dossier_uid, p.acteur_uid, count(*)::int as nb_reunions
from reunions x
join public.commission_presences p
  on p.reunion_uid = x.reunion_uid and p.statut = 'present'
join public.commission_reunions r on r.uid = x.reunion_uid
left join public.acteurs e on e.uid = p.acteur_uid
-- `organes` en EXISTS et non en jointure : jointe, la table (10 861 lignes) était
-- balayée en entier à chaque lecture, 430 ms sur 438 au premier essai.
where not (
  e.matricule_senat is not null
  and not coalesce(e.est_depute_actuel, false)
  and exists (
    select 1 from public.organes g
    where g.uid = r.organe_ref and g.code_type = 'CMP'
  )
)
group by 1, 2;
