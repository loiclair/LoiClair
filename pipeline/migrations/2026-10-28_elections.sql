-- 2026-10-28 : l'élection qui a donné son siège à chaque parlementaire, pour le bloc
-- en tête de la carte « Mandats » de la fiche élu (D-298, D-289).
--
-- Trois élections générales seulement : législatives 2024, sénatoriales 2023 et 2026.
-- Source : fichiers du ministère de l'Intérieur sur data.gouv.fr. Rien d'antérieur, ni
-- les partielles, publiées dans des fichiers séparés au format variable (D-289).
--
-- Deux tables, deux rythmes. `election_resultats` est écrite à la main, une fois par
-- élection (`import_elections.py --resultats`) : les résultats d'un scrutin passé ne
-- changent plus. `election_elus` est recalculée chaque nuit (`import_elections.py`
-- sans argument, étape `elections` de `nightly.py`), parce qu'elle dépend de qui siège :
-- un suppléant qui entre, un suivant de liste qui remplace un sénateur devenu ministre.
--
-- À appliquer à la main. Les tables restent vides jusqu'au
-- premier `import_elections.py --resultats`, puis au premier passage sans argument ;
-- d'ici là, la fiche n'affiche aucun bloc élection.

-- Résultats d'une circonscription (législatives) ou d'un département (sénatoriales).
create table if not exists public.election_resultats (
  -- `LEG2024`, `SEN2023` ou `SEN2026`. Un préfixe par chambre : la fiche filtre sur
  -- `LEG%` ou `SEN%` pour retrouver l'élection de la chambre où siège l'élu.
  election        text not null check (election in ('LEG2024', 'SEN2023', 'SEN2026')),
  -- Législatives : code du département tel que l'écrit le ministère, puis numéro de
  -- circonscription sur deux chiffres (`01-01`, `2A-02`, `ZZ-11`, `971-04`).
  -- Sénatoriales : le code du département seul (`33`, `ZZ` pour les Français établis
  -- hors de France).
  circonscription text not null,
  -- Libellé lisible, repris du fichier (« Ain, 1ère circonscription », « Gironde »).
  -- Pour la relecture en base : la fiche dit déjà la circonscription sous le mandat.
  libelle         text not null,
  -- `majoritaire` : candidats individuels, un ou deux tours. `liste` : scrutin
  -- proportionnel des départements à trois sièges ou plus, un seul tour.
  mode            text not null check (mode in ('majoritaire', 'liste')),
  -- Sièges à pourvoir dans la circonscription (1 aux législatives).
  sieges          integer not null check (sieges > 0),
  -- Jour du dernier tour : celui où le siège s'est décidé.
  date_scrutin    date not null,
  -- Les tours, lus par la fiche :
  -- [{numero, inscrits, votants, exprimes, blancs, nuls,
  --   entrees: [{cle, nom, prenom, sexe, nuance, voix, elu, sieges, intitule}]}]
  -- Une entrée est un candidat (`nom`, `prenom`, `sexe` F/M, `intitule` nul) ou une
  -- liste (`intitule` = libellé officiel, `sieges` obtenus, `nom`/`prenom`/`sexe` nuls).
  -- `cle` est fabriquée par l'import, identique d'un tour à l'autre, unique dans la
  -- circonscription : c'est par elle que la fiche retrouve son élu. Voix seules, aucun
  -- pourcentage : la fiche les calcule sur `exprimes`, dans le format de la langue.
  tours           jsonb not null check (jsonb_typeof(tours) = 'array'),
  -- Les élus, à plat, lus par la passe de nuit pour le rattachement :
  -- [{nom, prenom, sexe, cle}] en majoritaire, [{nom, prenom, sexe, liste_id}] en liste.
  -- Noms tels que le ministère les écrit, corrections de `corrections_elections.json`
  -- appliquées.
  elus            jsonb not null check (jsonb_typeof(elus) = 'array'),
  -- Mode liste seulement : tous les candidats de toutes les listes,
  -- [{liste_id, ordre, nom, prenom}]. Sert à reconnaître un suivant de liste ; jamais
  -- lu par la fiche, ce qui garde légère la ligne qu'elle charge (Paris, Nord).
  colistiers      jsonb check (colistiers is null or jsonb_typeof(colistiers) = 'array'),
  -- Le fichier de résultats d'où vient la ligne.
  source_url      text not null,
  -- Date de publication du fichier par le ministère.
  date_donnee     date not null,
  primary key (election, circonscription),
  constraint election_resultats_colistiers_liste check ((mode = 'liste') = (colistiers is not null))
);

-- Le rattachement d'un parlementaire à son élection. Une ligne par élu et par élection :
-- un député de 2024 devenu sénateur en 2026 en a deux, et la fiche choisit celle de sa
-- chambre. Réconciliée en entier chaque nuit par `import_elections.py`.
create table if not exists public.election_elus (
  -- `acteurs.uid`. Pas de clé étrangère, comme `dossier_amendements_elus` : la table se
  -- réconcilie sur elle-même, et la page n'y lit que la ligne de la fiche ouverte.
  uid             text not null,
  election        text not null,
  circonscription text not null,
  -- `elu` : a gagné le siège à cette élection, résultats affichés.
  -- `suppleant` : député devenu titulaire en remplaçant le vainqueur (D-289).
  -- `suivant_liste` : sénateur entré en cours de mandat depuis sa liste (D-289).
  -- `partielle` : député élu lors d'une partielle, non importée (D-289).
  nature          text not null check (nature in ('elu', 'suppleant', 'suivant_liste', 'partielle')),
  -- Élu au scrutin majoritaire : la `cle` de son entrée dans `tours`.
  cle             text,
  -- Élu au scrutin de liste : la `cle` de l'entrée de sa liste dans `tours`.
  liste_id        text,
  -- Suppléant : le vainqueur de 2024 qu'il remplace, nom affiché tel quel, et son uid
  -- quand le vainqueur a une ligne dans `election_elus` (lien vers sa fiche).
  remplace_nom    text,
  remplace_uid    text,
  -- Partielle : le jour du scrutin, lu dans `dateDebut` du mandat.
  date_partielle  date,
  primary key (uid, election),
  -- Cascade : une élection réimportée qui perd une circonscription emporte ses
  -- rattachements, que la passe de nuit suivante recalcule.
  foreign key (election, circonscription)
    references public.election_resultats (election, circonscription) on delete cascade,
  constraint election_elus_nature check (
    case nature
      when 'elu' then (cle is null) <> (liste_id is null)
        and remplace_nom is null and remplace_uid is null and date_partielle is null
      when 'suppleant' then remplace_nom is not null
        and cle is null and liste_id is null and date_partielle is null
      when 'suivant_liste' then cle is null and liste_id is null
        and remplace_nom is null and remplace_uid is null and date_partielle is null
      when 'partielle' then date_partielle is not null
        and cle is null and liste_id is null and remplace_nom is null and remplace_uid is null
    end
  )
);

-- La clé étrangère, pour la cascade : sans index, chaque suppression dans
-- `election_resultats` parcourrait toute la table.
create index if not exists idx_election_elus_resultat
  on public.election_elus (election, circonscription);

-- Même posture que les autres tables de données publiques du projet : RLS activé
-- sans policy, la lecture passant par la clé de service côté serveur.
alter table public.election_resultats enable row level security;
alter table public.election_elus enable row level security;
