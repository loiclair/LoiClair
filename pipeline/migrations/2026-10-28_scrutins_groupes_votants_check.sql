-- 2026-10-28 : `groupes_votants` accompagne toujours `votes_nominatifs`
--
-- POURQUOI. Le volet de détail d'un vote (`/api/scrutin-votes`) range chaque nom sous le
-- groupe que lui donne `groupes_votants` (D-278). Un script qui écrirait la liste
-- nominative sans cette colonne ferait afficher tous les votants en « Groupe non
-- renseigné », sans erreur ni alerte. La contrainte fait échouer cette écriture.
--
-- SÛRE. Mesuré le 2026-10-28 : 0 scrutin où une seule des deux colonnes est renseignée.
-- Les deux imports qui écrivent la liste nominative (`import_scrutins_cloud.py`,
-- `sync_senat.py`) écrivent les deux colonnes dans le même payload.

alter table public.scrutins
  add constraint scrutins_groupes_votants_avec_votes
  check ((votes_nominatifs is null) = (groupes_votants is null));
