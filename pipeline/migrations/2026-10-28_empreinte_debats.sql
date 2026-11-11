-- 2026-10-28 : `empreinte_debats`, l'empreinte légère des débats d'un dossier
--
-- POURQUOI. `/api/resume-debats` est appelée à chaque affichage de la carte des
-- arguments. Pour savoir si sa synthèse en cache est encore à jour, elle relisait
-- toutes les interventions du dossier, l'historique des groupes de leurs orateurs et
-- les fichiers de texte des séances, puis comparait l'empreinte du verbatim
-- (`resume_debats_hash_source`). Mesuré le 2026-10-28 sur le PLF 2026
-- (DLR5L17N52428) : 5,1 Mo bruts de l'ancienne API et 7,3 Mo de fichiers par vue,
-- pour constater presque toujours que rien n'avait changé. Le forfait de trafic de l'époque est de
-- 5 Go par mois.
--
-- La fonction calcule côté Postgres une empreinte de tout ce que la route lit en base
-- pour bâtir le verbatim, et ne rend que 32 caractères. La route la compare à celle
-- qu'elle a rangée avec la synthèse (`resume_debats_empreinte`, ou `_en`) et ne relit
-- le débat que si elles diffèrent.
--
-- CE QUI EST COUVERT, pour chaque intervention du dossier :
--   - l'intervention : `seance_uid, ordre, orateur_nom, orateur_qualite, acteur_uid` ;
--   - sa séance : `texte_hash` (le fichier du texte, renommé à chaque correction),
--     `date_seance`, `chambre` ;
--   - son orateur : `nom, prenom, historique_groupes` (le groupe du jour de la séance) ;
--   - les groupes de cet historique : `libelle, libelle_abrege`, l'étiquette des
--     en-têtes. Un groupe que l'AMO publie quelques jours après l'avoir attribué fait
--     passer ses orateurs de « sans groupe connu » à son nom : l'empreinte bouge.
-- Des agrégats séparés plutôt qu'une jointure par intervention : l'historique d'un
-- orateur n'est haché qu'une fois, et non sur chacune de ses prises de parole.
-- Mesuré le 2026-10-28 sur le PLF 2026 à 15 402 interventions : 380 ms à froid
-- contre 1,3 s pour la jointure, environ 50 ms à chaud ; à 37 107 interventions,
-- 380 ms à chaud, surtout passées à trier les interventions. chr(29),
-- chr(30) séparent parties et lignes, et `row(...)::text` distingue NULL d'une
-- chaîne vide : deux contenus différents ne se confondent pas.
--
-- CE QUI NE L'EST PAS : le code qui met le verbatim en forme. La route mêle à
-- l'empreinte sa constante `VERSION_EMPREINTE_DEBATS`, à incrémenter quand ce code
-- change, et seule la production range une empreinte.
--
-- `stable` : aucune écriture. `security invoker`, comme `impacts_empreinte`
-- (2026-10-23) : les droits de l'appelant s'appliquent.
--
-- ORDRE D'APPLICATION : avant le déploiement du code qui l'appelle. La route lit les
-- deux colonnes dans son premier `select` : sans elles, elle rend 500 à chaque
-- appel. Purement additif, aucun objet existant n'est touché.
--
-- CONTRÔLES APRÈS :
--   - deux appels de suite rendent la même valeur :
--       SELECT empreinte_debats('DLR5L17N52428');
--   - `anon` et `authenticated` n'ont pas le droit de l'exécuter :
--       SELECT proacl FROM pg_proc WHERE proname = 'empreinte_debats';

alter table public.dossiers_legislatifs
  add column if not exists resume_debats_empreinte text,
  add column if not exists resume_debats_empreinte_en text;

comment on column public.dossiers_legislatifs.resume_debats_empreinte is
  'Empreinte légère des débats (VERSION_EMPREINTE_DEBATS:empreinte_debats(uid)) sur laquelle '
  'resume_debats_ia a été vérifiée ou faite. Écrite et lue par /api/resume-debats : '
  'identique, la synthèse est servie sans relire le débat. Null : à recalculer.';
comment on column public.dossiers_legislatifs.resume_debats_empreinte_en is
  'Même rôle que resume_debats_empreinte, pour resume_debats_ia_en.';

create or replace function public.empreinte_debats(p_dossier text)
returns text
language sql
stable
security invoker
as $$
  with i as (
    select seance_uid, ordre, orateur_nom, orateur_qualite, acteur_uid
    from public.debat_interventions
    where dossier_uid = p_dossier
  )
  select md5(
    coalesce((select string_agg(row(seance_uid, ordre, orateur_nom, orateur_qualite, acteur_uid)::text,
                                chr(30) order by seance_uid, ordre)
              from i), '')
    || chr(29) ||
    coalesce((select string_agg(row(s.uid, s.texte_hash, s.date_seance, s.chambre)::text,
                                chr(30) order by s.uid)
              from public.debat_seances s
              where s.uid in (select seance_uid from i)), '')
    || chr(29) ||
    coalesce((select string_agg(row(a.uid, a.nom, a.prenom, a.historique_groupes)::text,
                                chr(30) order by a.uid)
              from public.acteurs a
              where a.uid in (select acteur_uid from i)), '')
    || chr(29) ||
    coalesce((select string_agg(row(o.uid, o.libelle, o.libelle_abrege)::text,
                                chr(30) order by o.uid)
              from public.organes o
              where o.uid in (select h ->> 'groupe'
                              from public.acteurs a,
                                   jsonb_array_elements(coalesce(a.historique_groupes, '[]'::jsonb)) h
                              where a.uid in (select acteur_uid from i))), ''));
$$;

revoke execute on function public.empreinte_debats(text) from public, anon, authenticated;
grant execute on function public.empreinte_debats(text) to service_role;
