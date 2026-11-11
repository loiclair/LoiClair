-- Retire `acteurs.nb_amendements_adoptes`, ni écrite ni lue depuis le 2026-10-25 : elle
-- gardait la valeur figée de la dernière nuit, auteur et cosignataire mêlés, et se serait
-- lue comme une donnée vivante. Le compte par élu vit dans `amendements_par_sort`.
--
-- `dossiers_legislatifs.nb_amendements_adoptes`, homonyme, reste : le site la lit.
-- Pas de `cascade` : un objet qui dépendrait de la colonne doit faire échouer le retrait.

alter table public.acteurs drop column nb_amendements_adoptes;
