-- Les amendements adoptés d'un dossier, un par ligne, pour le bloc « Amendements
-- adoptés » de la section « Sources et acteurs » de la fiche dossier.
--
-- Seuls les adoptés sont gardés : le bloc dit qui a modifié le texte, et un rejeté
-- ne l'a pas modifié. Les compteurs `nb_amendements_*` de `dossiers_legislatifs` et
-- `acteurs` restent la seule source des totaux (déposés compris) : cette table ne
-- les remplace pas, et rien ne doit les recalculer à partir d'elle.
--
-- Alimentée par `import_amendements.py`, pendant le même parcours que les
-- compteurs : la table est réconciliée en entier à chaque passe (insertion,
-- mise à jour des lignes changées, suppression des disparues).

create table if not exists public.amendements (
  -- uid de l'Assemblée tel quel (« AMANR5L17PO59048B0884P0D1N000031 »), ou « SN »
  -- suivi de `amd.id` du dump ameli du Sénat.
  uid             text primary key,
  dossier_uid     text not null references public.dossiers_legislatifs (uid) on delete cascade,
  chambre         text not null check (chambre in ('AN', 'SN')),
  -- Adopté en séance publique ou en commission. AN : `prefixeOrganeExamen` vaut
  -- « AN » en séance. Sénat : `txt_ameli.txttyp`, S (séance) ou C (commission).
  lieu            text not null check (lieu in ('seance', 'commission')),
  -- Numéro tel que la chambre l'affiche (« CF31 », « I-1475 », « COM-6 »), sans la
  -- mention de rectification.
  numero          text not null,
  -- Article visé, en forme courte (« Art. 2 », « Après art. 4 », « État B »).
  article         text,
  -- parlementaire : un député ou un sénateur, premier signataire ;
  -- rapporteur : le rapporteur, à l'Assemblée (`typeAuteur`) comme au Sénat
  --   (amendement de commission qui nomme un sénateur) ;
  -- commission : amendement de commission du Sénat sans sénateur nommé ;
  -- gouvernement.
  auteur_type     text not null check (auteur_type in ('parlementaire', 'rapporteur', 'commission', 'gouvernement')),
  -- `acteurs.uid` de l'élu quand il est résolu. Pas de clé étrangère : certains
  -- auteurs de l'Assemblée n'ont pas de ligne dans `acteurs`.
  auteur_uid      text,
  -- Nom de la commission, ou « Prénom NOM » d'un sénateur que `acteurs` ne connaît
  -- pas. NULL pour un auteur résolu et pour le Gouvernement.
  auteur_libelle  text,
  -- Sert à trier, jamais affichée comme telle. AN : date du sort. Sénat : date de
  -- dépôt, le dump ameli ne publiant pas la date du sort.
  date_amendement date,
  -- Page officielle de l'amendement.
  url             text not null
);

create index if not exists idx_amendements_dossier on public.amendements (dossier_uid);

-- Même posture que les autres tables de données publiques du projet : RLS activé
-- sans policy, la lecture passant par la clé de service côté serveur.
alter table public.amendements enable row level security;
