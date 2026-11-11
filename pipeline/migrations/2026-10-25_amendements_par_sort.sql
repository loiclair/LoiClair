-- Sort des amendements déposés par chaque élu, pour la section « Amendements »
-- de la fiche élu, et index qui lui permet de lister ses amendements adoptés.
--
-- Une colonne et non une table de tous les amendements : seul le texte des adoptés
-- est gardé (table `amendements`), les autres ne se comptent qu'en nombres. Écrite par
-- `import_amendements.py` dans la même transaction que `nb_amendements_auteur`, dont
-- elle est le détail : même population (amendements dont l'élu est l'auteur, dans un
-- dossier connu, bornés au mandat en cours), donc la somme des huit valeurs égale ce
-- compteur. Lue par la seule fiche élu, qui sélectionne ses colonnes par nom : aucune
-- liste d'élus ne paie ce jsonb.
--
-- Forme : { "adopte": 21, "rejete": 60, "tombe": 9, "non_soutenu": 4, "retire": 6,
--           "irrecevable": 18, "en_attente": 4, "autre": 0 }
-- Les huit clés sont toujours présentes. NULL pour un élu sans amendement compté.

alter table public.acteurs
  add column if not exists amendements_par_sort jsonb;

-- La fiche élu lit les adoptés d'un auteur : sans index, un parcours de toute la table
-- (27 677 lignes au 2026-10-25, texte compris) à chaque fiche.
create index if not exists idx_amendements_auteur on public.amendements (auteur_uid);
