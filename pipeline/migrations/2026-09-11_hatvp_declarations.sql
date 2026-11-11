-- État de la déclaration d'intérêts de chaque parlementaire, repris de l'index
-- open data de la Haute Autorité pour la transparence de la vie publique.
--
-- Une ligne = un parlementaire en exercice, et l'état de sa déclaration la plus
-- récente. Pas d'historique : la HATVP publie les déclarations successives, mais
-- la fiche n'en montre qu'une, la dernière, et renvoie vers hatvp.fr pour le reste.
--
-- Pourquoi une table plutôt que des colonnes sur `acteurs` : l'état de la
-- déclaration doit pouvoir exister alors qu'aucun élément n'est affiché.
-- « Déclaration déposée, aucun intérêt déclaré » et « on ne sait pas » sont deux
-- phrases différentes, et c'est `statut_publication` qui les sépare.
--
-- Pourquoi pas `acteurs.uri_hatvp` pour le lien : cette colonne vient de l'open
-- data de l'Assemblée, qui ne la renseigne que pour les députés (575 sur 577, 0
-- sénateur sur 348), et l'import nocturne y réécrit NULL à chaque passage. Y
-- déverser les sénateurs serait effacé la nuit suivante. `url_dossier` ci-dessous
-- est la même information, complète pour les deux chambres.
--
-- Alimentée par `import_hatvp.py`, reconstruite à chaque passage.

create table if not exists public.hatvp_declarations (
  -- uid de `acteurs`. Résolu par clé, jamais par nom : `url_dossier` contre
  -- `acteurs.uri_hatvp` pour les députés, `id_origine` (le matricule Sénat)
  -- contre `acteurs.matricule_senat` pour les sénateurs. Couverture 923/925.
  uid                 text primary key,
  -- dia | diam. Les déclarations de patrimoine (dsp, dspm, dspfm) ne sont jamais
  -- importées : leur publication est pénalement sanctionnée pour un parlementaire.
  type_document       text not null,
  -- « Livrée » quand la déclaration est consultable. Les autres valeurs sont des
  -- états d'attente (« Déclaration déposée - publication à venir », « En cours »),
  -- que la fiche affiche telles quelles : une attente est une information.
  statut_publication  text not null,
  date_depot          date,
  date_publication    date,
  -- Page nominative sur hatvp.fr, servie comme crédit de source sur la fiche.
  url_dossier         text,
  -- Nom du PDF officiel de la déclaration, sous /livraison/dossiers/.
  nom_fichier         text,
  -- Nom du XML de cette déclaration, sous /livraison/dossiers/. C'est lui que
  -- `import_hatvp.py` va chercher pour remplir `transparence_elements`, et le
  -- seul moyen d'éviter le fichier fusionné de 87 Mo, qui se télécharge en
  -- quinze minutes et s'est déjà terminé tronqué sans lever d'erreur.
  open_data           text,
  -- Jour où l'index de la HATVP a été lu. Sert au diagnostic, pas à l'affichage :
  -- la note de fraîcheur de la section porte la date de dépôt de la déclaration,
  -- qui est ce que le lecteur peut vérifier sur hatvp.fr.
  date_donnee         date not null,
  -- Jour où le XML de cette déclaration a été lu et ses éléments écrits. NULL
  -- tant qu'elle n'a jamais été lue, ce qui est la condition de relecture.
  --
  -- Sans cette colonne, un import interrompu au milieu des 777 téléchargements
  -- laisse un trou définitif : la déclaration est en table, sa ligne n'a pas
  -- changé, donc aucun passage suivant ne la relit, et la fiche de l'élu reste
  -- vide sans que rien ne le signale. C'est arrivé au premier import.
  date_lecture        date
);

-- Pas d'index sur `uid` : la clé primaire en crée déjà un, et la seule requête de
-- la table est `where uid = ?`. Un second index sur la même colonne se maintient à
-- chaque écriture sans jamais servir.

-- Même posture que les autres tables de données publiques du projet : RLS activé
-- sans policy, la lecture passant par la clé de service côté serveur.
alter table public.hatvp_declarations enable row level security;
