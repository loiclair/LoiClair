-- Mandats locaux des parlementaires, importés du Répertoire national des élus.
--
-- L'open data de l'Assemblée ne publie aucun mandat local : ses 29 types de
-- mandats sont tous internes au monde parlementaire. Le dump du Sénat en a,
-- mais pour les seuls sénateurs, et il ne clôture pas les mandats non
-- renouvelés. Le RNE couvre les deux chambres et suit les scrutins locaux.
--
-- Une ligne = un mandat local en cours. La table est reconstruite à chaque
-- millésime par `import_rne.py` ; elle ne garde pas d'historique, le RNE
-- n'en publiant pas.

create table if not exists public.mandats_locaux (
  -- uid de `acteurs`, résolu par nom + prénom + date de naissance à l'import :
  -- le RNE n'a évidemment pas les identifiants de l'Assemblée.
  uid                  text not null,
  -- municipal | departemental | regional | arrondissement | assemblee | communautaire
  type                 text not null,
  collectivite         text not null,
  -- « Maire », « 1er adjoint au Maire », « Président du conseil communautaire »…
  -- NULL pour un simple conseiller, c'est-à-dire l'immense majorité.
  fonction             text,
  date_debut           date,
  date_debut_fonction  date,
  -- Millésime du RNE, affiché sous la section de la fiche élu. La qualité de
  -- parlementaire vient du sync nocturne, le mandat local d'un fichier
  -- trimestriel : sans cette date, on juxtaposerait deux instantanés
  -- d'époques différentes sans le dire.
  date_donnee          date not null,
  -- Code INSEE de la collectivité, quand le registre en publie un. Il sert de
  -- clé de jointure avec l'API Géo pour la population.
  code_collectivite    text,
  -- Population municipale, renseignée pour les seuls mandats communaux :
  -- LO 141 ne compte le siège municipal qu'à partir de 1 000 habitants, et sans
  -- ce chiffre on compterait comme cumul un siège de conseil de village.
  population           integer,
  primary key (uid, type, collectivite)
);

create index if not exists idx_mandats_locaux_uid on public.mandats_locaux (uid);

-- Même posture que les autres tables de données publiques du projet : RLS
-- activé sans policy, la lecture passant par la clé de service côté serveur.
alter table public.mandats_locaux enable row level security;
