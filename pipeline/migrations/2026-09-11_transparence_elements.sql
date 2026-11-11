-- Les faits de transparence affichés sur la fiche d'un élu : intérêts déclarés,
-- cadeaux et invitations, voyages financés par des tiers, déports pour conflit
-- d'intérêts.
--
-- Une ligne = un fait déclaré à afficher, jamais une déclaration entière. Ce
-- qu'on modélise ici est la ligne rendue à l'écran, pas la structure de la source.
-- C'est ce qui permet une table unique là où les six sources n'ont rien en commun :
-- une activité professionnelle de la HATVP et une invitation au registre de
-- l'Assemblée produisent la même ligne (une date, un intitulé, un tiers, une
-- valeur, un détail, un lien). Le projet a déjà ce précédent avec `MandatAffiche`,
-- qui unifie un jsonb de l'Assemblée et six CSV du RNE sous un seul type de ligne.
--
-- ⚠️ RIEN N'EST JAMAIS AGRÉGÉ NI COMPARÉ. `valeur_texte` mélange par construction
-- un montant de cadeau, une durée de voyage et un pourcentage de capital : aucun
-- `sum()`, `avg()` ni classement ne doit exister dessus, ni en SQL ni dans `src/`.
-- Pas de « député le plus doté ». C'est la seule contrainte qui rend une table
-- générique sûre, et elle découle de la ligne éditoriale : on affiche le fait
-- déclaré, on n'en tire pas de conclusion.
--
-- Alimentée par `import_hatvp.py`, `import_transparence_an.py` et
-- `import_transparence_senat.py`. Chaque script ne réconcilie que ses propres
-- valeurs de `source` : trois scripts, trois cadences, aucun ne peut effacer le
-- travail d'un autre.

create table if not exists public.transparence_elements (
  -- Registre d'origine : hatvp | an_dons | an_voyages | an_deports
  --                    | senat_cadeaux | senat_deports
  -- Sert au pipeline (périmètre de réconciliation), jamais au rendu.
  source          text not null,
  -- Identifiant de la source quand elle en publie un : `data-document-id` de
  -- l'Assemblée (« DDONANR5L17PA719372DV00781 »), qui porte l'uid du député.
  -- Sinon, une empreinte déterministe du contenu. Conséquence assumée : une ligne
  -- corrigée dans un PDF du Sénat produit une clé neuve et l'ancienne part à la
  -- réconciliation, ce qui est le comportement voulu.
  identifiant     text not null,
  uid             text not null,
  -- Bloc d'affichage, et clé de traduction stable (jamais un libellé traduit) :
  -- interet_activite | interet_conseil | interet_participation | interet_direction
  -- | interet_benevolat | interet_conjoint | interet_observation
  -- | cadeau | voyage | deport
  categorie       text not null,
  date_element    date,
  -- Le fait lui-même : « Invitation Roland Garros », un employeur, une société,
  -- le texte visé par un déport.
  intitule        text not null,
  -- Qui donne, qui finance, qui emploie. NULL quand la source n'en nomme pas.
  tiers           text,
  -- « Supérieur à 150 euros », « 4 jours », « 150 parts ». Texte, jamais un
  -- numérique : voir l'avertissement en tête de fichier.
  valeur_texte    text,
  -- Descriptif long, motif d'un déport cité verbatim, fonction exercée.
  detail          text,
  -- Lien profond vers le registre ou la déclaration d'origine. Sert d'attribution
  -- autant que de navigation : chaque ligne renvoie à qui l'a publiée.
  url_source      text,
  date_donnee     date not null,
  primary key (source, identifiant)
);

create index if not exists idx_transparence_uid on public.transparence_elements (uid);

-- Même posture que les autres tables de données publiques du projet : RLS activé
-- sans policy, la lecture passant par la clé de service côté serveur.
alter table public.transparence_elements enable row level security;
