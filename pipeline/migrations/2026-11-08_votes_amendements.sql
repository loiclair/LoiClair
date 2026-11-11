-- Les votes par scrutin public sur un amendement adopté, avec les noms, pour la page
-- `/Amendements/[uid]`.
--
-- POURQUOI UNE TABLE À PART. `scrutins.votes_nominatifs` décide de huit lectures (fiche
-- élu, sitemap, MCP, quiz…), et le taux de participation du Sénat se calcule sur les
-- lignes de `scrutins` : y ranger ces votes les ferait compter partout. La migration
-- `2026-11-07_retrait_votes_senat_amendements.sql` en a justement retiré 11 pour cette
-- raison. Rien ne doit donc recalculer une participation à partir de cette table.
--
-- Alimentée par `import_scrutins_cloud.py` (Assemblée) et `sync_senat.py` (Sénat), à
-- travers `_votes_amendements.py`. Additive : aucune autre table n'est touchée.

create table if not exists public.votes_amendements (
  -- Même forme que `scrutins.uid` : « VTANR5L17V123 », « VTSNR2024V45 ».
  uid               text primary key,
  chambre           text not null check (chambre in ('AN', 'SN')),
  date_scrutin      date,
  -- Intitulé officiel du vote.
  titre             text,
  pour              integer,
  contre            integer,
  abstentions       integer,
  votants           integer,
  non_votants       integer,
  suffrages_requis  integer,
  -- Mêmes formes que les colonnes homonymes de `scrutins` :
  -- { pour, contre, abstentions, nonVotants, institutionnels, absents } → liste d'uids,
  -- et { uid d'élu → uid du groupe du jour }.
  votes_nominatifs  jsonb,
  groupes_votants   jsonb,
  -- Une entrée par groupe, avec les colonnes de `scrutins_groupes_positions` :
  -- { groupe_uid, position_majoritaire, nb_pour, nb_contre, nb_abstentions, nb_membres }.
  positions_groupes jsonb,
  -- Amendements couverts : plusieurs quand le vote porte sur des amendements identiques.
  -- Vide quand le rapprochement n'a rien trouvé de sûr : mieux vaut pas de vote qu'un
  -- faux vote.
  amendement_uids   text[] not null default '{}'
);

create index if not exists idx_votes_amendements_uids
  on public.votes_amendements using gin (amendement_uids);

-- Même posture que `amendements` : RLS activé sans policy, la lecture passant par la
-- connexion serveur.
alter table public.votes_amendements enable row level security;
