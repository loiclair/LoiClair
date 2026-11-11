-- Vues de valeurs distinctes pour le glossaire et les filtres de /dossiers-legislatifs.
--
-- Ces deux pages rapatriaient des tables entieres (27 301 lignes pour
-- actes_legislatifs, 8 124 pour textes) uniquement pour en extraire une vingtaine
-- de valeurs distinctes. Au-dela du gaspillage, la reponse etait tronquee par le
-- plafond "Max rows" de l'ancienne API : une valeur qui n'apparait qu'au-dela de la
-- 3000e ligne etait absente du glossaire et des filtres, sans aucune erreur.
--
-- security_invoker : la vue s'evalue avec les droits de l'appelant, donc les
-- policies RLS des tables sources continuent de s'appliquer normalement.

create or replace view public.dossiers_statuts_distincts
with (security_invoker = true) as
  select distinct statut_final
  from public.dossiers_legislatifs
  where statut_final is not null;

create or replace view public.dossiers_procedures_distinctes
with (security_invoker = true) as
  select distinct procedure_libelle
  from public.dossiers_legislatifs
  where procedure_libelle is not null;

create or replace view public.dossiers_groupes_distincts
with (security_invoker = true) as
  select distinct initiateur_groupe_libelle
  from public.dossiers_legislatifs
  where initiateur_groupe_libelle is not null;

-- themes est un text[] : une ligne par theme, pas un tableau a aplatir cote JS.
create or replace view public.dossiers_themes_distincts
with (security_invoker = true) as
  select distinct unnest(themes) as theme
  from public.dossiers_legislatifs
  where themes is not null;

create or replace view public.actes_libelles_distincts
with (security_invoker = true) as
  select distinct libelle_acte
  from public.actes_legislatifs
  where libelle_acte is not null;

create or replace view public.textes_provenances_distinctes
with (security_invoker = true) as
  select distinct provenance
  from public.textes
  where provenance is not null;
