-- 2026-10-23 : `impacts_empreinte`, la version des impacts de l'index de recherche
--
-- POURQUOI. La liste des textes (`/api/search-index/dossiers`) annonce la version
-- du morceau des impacts (`/api/search-index/dossiers/impacts`), pour que le
-- navigateur ne le retélécharge que s'il a changé. Elle la calculait en relisant
-- toute la vue `impacts_courants`, 3,3 Mo bruts (8 441 lignes le 2026-10-23), pour
-- n'en garder qu'une empreinte de 16 caractères. Le compteur de trafic de l'ancien hébergeur
-- mesure avant gzip : ces 3,3 Mo se payaient en entier à chaque régénération. La
-- fonction calcule l'empreinte côté Postgres et ne rend que 32 caractères.
--
-- Les deux routes prennent leur version ici, pour tomber sur la même. Elle porte sur
-- les colonnes que la route sert (`dossier_uid`, phrases, résumés), dans l'ordre où
-- elle les lit : elle change quand le contenu servi change. Un changement de profil
-- qui laisse les phrases identiques la change aussi, ce qui coûte au pire un
-- téléchargement inutile. chr(31) et chr(30) séparent champs et lignes : aucun
-- texte ne les contient, deux contenus différents ne se confondent donc pas.
--
-- `stable` : aucune écriture. `security invoker` : la vue applique les droits de
-- l'appelant, comme `positions_scrutins_elu` (2026-09-22).
--
-- ORDRE D'APPLICATION : avant le déploiement du code qui l'appelle. Purement
-- additif, aucun objet existant n'est touché.
--
-- CONTRÔLES APRÈS :
--   - deux appels de suite rendent la même valeur :
--       SELECT impacts_empreinte();
--   - `anon` et `authenticated` n'ont pas le droit de l'exécuter :
--       SELECT proacl FROM pg_proc WHERE proname = 'impacts_empreinte';

create or replace function public.impacts_empreinte()
returns text
language sql
stable
security invoker
as $$
  select md5(coalesce(string_agg(
           concat_ws(chr(31), dossier_uid,
                     coalesce(phrase_fr, ''), coalesce(phrase_en, ''),
                     coalesce(resume_fr, ''), coalesce(resume_en, '')),
           chr(30)
           order by dossier_uid, element_type, element_id, profil), ''))
  from public.impacts_courants;
$$;

revoke execute on function public.impacts_empreinte() from public, anon, authenticated;
grant execute on function public.impacts_empreinte() to service_role;
