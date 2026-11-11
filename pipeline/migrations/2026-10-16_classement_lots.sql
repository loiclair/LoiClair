-- Les lots de classement envoyés à l'API Message Batches d'Anthropic, pour « Ce qui me
-- concerne ». Un lot rend ses résultats en moins de 24 h : l'étape de nuit qui l'envoie
-- n'est plus là pour les lire, c'est la nuit suivante qui les récupère. Cette table
-- garde donc, d'une nuit à l'autre, les lots en attente et les éléments qu'ils
-- contiennent (pour ne pas renvoyer un élément déjà en route).
--
-- Écrite et lue par `classer_articles.py --lots` seul. Aucune page ne la lit.

create table if not exists public.classement_lots (
  -- Identifiant rendu par l'API (« msgbatch_… »).
  id             text primary key,
  modele         text not null,
  prompt_version text not null,
  -- `cle_lot` des éléments envoyés (empreinte de l'élément et de son entrée) : un
  -- élément déjà dans un lot en attente n'est pas renvoyé.
  cles           jsonb not null,
  nb_requetes    int not null,
  -- 'en_cours' jusqu'à la récupération des résultats, puis 'recupere'.
  statut         text not null default 'en_cours' check (statut in ('en_cours', 'recupere')),
  ecrits         int,
  echecs         int,
  cree_le        timestamptz not null default now(),
  recupere_le    timestamptz
);

-- La lecture de chaque nuit ne porte que sur les lots en attente.
create index if not exists idx_classement_lots_en_cours on public.classement_lots (cree_le)
  where statut = 'en_cours';

-- Même posture que les autres tables de données : RLS sans policy, accès par la clé
-- de service et la connexion directe des scripts.
alter table public.classement_lots enable row level security;
