-- 2026-10-29 : `dossier_debats_cache`, pré-calcul par dossier des deux lectures lourdes
-- de la fiche dossier sur les débats
--
-- POURQUOI. Deux lectures parcourent chacune toutes les interventions d'un dossier
-- (38 131 lignes pour le PLF 2026, DLR5L17N52428) : la vue `dossier_orateurs` (section
-- « Les plus actifs dans ce dossier », `elus-actifs.ts`) et `empreinte_debats(uid)`
-- (`/api/resume-debats`). Mesurées le 2026-10-29, elles prennent 160 à 500 ms de calcul
-- pur, dont cinq `ILIKE` sur une soixantaine de millisecondes pour la seule vue. Seules,
-- elles tiennent. Sous charge, plusieurs fiches en même temps, deux lectures de ce
-- poids peuvent dépasser le délai de 8 s du rôle `authenticator` (voir le bas du
-- fichier), et la requête est coupée.
--
-- Les débats ne changent qu'à l'import de nuit (`debats.import_debats`), les groupes
-- des orateurs qu'à celui des acteurs : le résultat est donc le même toute la journée.
-- Il est calculé une fois par l'étape `cache-debats` de `nightly.py`
-- (`refresh_dossier_debats_cache.py`), juste après `debats`, et lu en une ligne.
--
-- FORME. Une table à une ligne par dossier plutôt qu'une vue matérialisée : une vue
-- matérialisée se rafraîchit en entier, 521 dossiers à chaque fois, alors que la table
-- n'écrit que les lignes dont la valeur change (`IS DISTINCT FROM`). Les orateurs
-- tiennent dans un jsonb de la ligne, et non dans une table fille : la fiche les lit
-- toujours tous, jamais un seul, et une ligne évite une seconde requête. Taille
-- mesurée le 2026-10-29 : 1,3 Mo de jsonb brut pour 16 046 orateurs sur 521 dossiers,
-- soit environ 1,5 Mo avec les empreintes (la base est à 412 Mo sur 500).
--
-- EXACTEMENT LE MÊME RÉSULTAT. `dossier_debats_calculer()` reprend la vue
-- `dossier_orateurs` telle quelle (le jsonb en est l'agrégat) et reproduit
-- `empreinte_debats` en un seul passage sur toute la table, au lieu d'un appel par
-- dossier. Les deux étant écrites en deux endroits, la preuve d'égalité sur les 521
-- dossiers est dans le message du commit ; toute modification de `empreinte_debats`
-- ou de la vue doit être reportée ici, sinon la fiche servirait une empreinte qui
-- ne correspond plus à ce que la route recalcule en repli.
--
-- LIGNE ABSENTE = REPLI. Un dossier sans ligne (nouveau, ou dont les débats ne sont
-- pas encore passés dans l'étape de nuit) est lu par le chemin d'avant : la vue et la
-- fonction. Un dossier sans aucune intervention n'a jamais de ligne, il n'a rien à
-- calculer et son repli est instantané.
--
-- PÉREMPTION. Une ligne vieille d'une nuit reste juste entre deux imports. Si l'import
-- des débats échoue, le pré-calcul reprend l'état d'avant et reste cohérent avec lui.
-- Une empreinte plus ancienne que le débat est le sens sûr : la route range l'ancienne
-- à côté de la synthèse. Le débat n'est cependant relu qu'à la première vue qui suit
-- le prochain passage de `cache-debats` : jusqu'à 24 h après l'import, plus par nuit
-- ratée de l'étape. Une synthèse refaite entre-temps est rangée avec l'ancienne
-- empreinte et revérifiée ensuite sans appel IA (le hash de la source tranche), d'où
-- un sens sûr (même raisonnement que l'ordre de lecture dans `/api/resume-debats`).
--
-- ORDRE D'APPLICATION : appliquer la migration avant de pousser ce code sur `main`
-- (la synchro de nuit part de `main`, pas de `production`). Sans elle, la lecture
-- échoue et le code retombe sur le repli, en journalisant une erreur à chaque fiche,
-- et l'étape `cache-debats` échoue. Le premier remplissage est à la fin du fichier.
-- Purement additif.
--
-- CONTRÔLES APRÈS :
--   SELECT count(*), pg_size_pretty(pg_total_relation_size('public.dossier_debats_cache'))
--   FROM public.dossier_debats_cache;     -- 521 lignes environ, quelques Mo
--   SELECT (SELECT count(*) FROM public.dossier_debats_calculer() c
--           JOIN public.dossier_debats_cache t USING (dossier_uid)
--           WHERE c.empreinte = t.empreinte AND c.orateurs = t.orateurs) AS identiques;

create table if not exists public.dossier_debats_cache (
  dossier_uid text primary key references public.dossiers_legislatifs (uid) on delete cascade,
  -- [{"chambre": "AN", "acteur_uid": "PA…", "nb_interventions": 12}, …], trié par
  -- chambre puis acteur_uid, comme la lecture de `dossier_orateurs`.
  orateurs    jsonb not null,
  -- md5 brut de `empreinte_debats(dossier_uid)`, sans le préfixe de version que la
  -- route y ajoute (VERSION_EMPREINTE_DEBATS).
  empreinte   text not null,
  calcule_le  timestamptz not null default now()
);

comment on table public.dossier_debats_cache is
  'Pré-calcul nocturne par dossier : orateurs (= vue dossier_orateurs) et empreinte des '
  'débats (= empreinte_debats). Écrit par refresh_dossier_debats_cache.py, lu par '
  'elus-actifs.ts et /api/resume-debats ; une ligne absente se lit par le calcul d''origine.';

-- Même posture que les autres tables de données publiques : RLS activé sans policy, la
-- lecture passant par la clé de service côté serveur.
alter table public.dossier_debats_cache enable row level security;

-- Une ligne par dossier ayant des interventions : (dossier_uid, orateurs, empreinte).
-- Les cinq agrégats de `empreinte_debats` sont refaits ici pour tous les dossiers d'un
-- coup, dans le même ordre de tri, avec les mêmes séparateurs (chr(29) entre parties,
-- chr(30) entre lignes) : l'octet doit rester identique.
create or replace function public.dossier_debats_calculer()
returns table (dossier_uid text, orateurs jsonb, empreinte text)
language sql
stable
security invoker
as $$
  with i as (
    select di.dossier_uid, di.seance_uid, di.ordre, di.orateur_nom, di.orateur_qualite, di.acteur_uid
    from public.debat_interventions di
    where di.dossier_uid is not null
  ),
  c_interventions as (
    select i.dossier_uid,
           string_agg(row(i.seance_uid, i.ordre, i.orateur_nom, i.orateur_qualite, i.acteur_uid)::text,
                      chr(30) order by i.seance_uid, i.ordre) as s
    from i group by 1
  ),
  c_seances as (
    select x.dossier_uid,
           string_agg(row(s.uid, s.texte_hash, s.date_seance, s.chambre)::text,
                      chr(30) order by s.uid) as s
    from (select distinct i.dossier_uid, i.seance_uid from i) x
    join public.debat_seances s on s.uid = x.seance_uid
    group by 1
  ),
  orateurs_acteurs as (
    select distinct i.dossier_uid, i.acteur_uid from i where i.acteur_uid is not null
  ),
  c_acteurs as (
    select x.dossier_uid,
           string_agg(row(a.uid, a.nom, a.prenom, a.historique_groupes)::text,
                      chr(30) order by a.uid) as s
    from orateurs_acteurs x
    join public.acteurs a on a.uid = x.acteur_uid
    group by 1
  ),
  c_groupes as (
    select g.dossier_uid,
           string_agg(row(o.uid, o.libelle, o.libelle_abrege)::text,
                      chr(30) order by o.uid) as s
    from (
      select distinct x.dossier_uid, h ->> 'groupe' as groupe
      from orateurs_acteurs x
      join public.acteurs a on a.uid = x.acteur_uid,
           jsonb_array_elements(coalesce(a.historique_groupes, '[]'::jsonb)) h
    ) g
    join public.organes o on o.uid = g.groupe
    group by 1
  ),
  c_parole as (
    select d.dossier_uid,
           jsonb_agg(jsonb_build_object('chambre', d.chambre,
                                        'acteur_uid', d.acteur_uid,
                                        'nb_interventions', d.nb_interventions)
                     order by d.chambre, d.acteur_uid) as orateurs
    from public.dossier_orateurs d
    group by 1
  )
  select it.dossier_uid::text,
         coalesce(p.orateurs, '[]'::jsonb),
         md5(coalesce(it.s, '')
             || chr(29) || coalesce(se.s, '')
             || chr(29) || coalesce(ac.s, '')
             || chr(29) || coalesce(og.s, ''))
  from c_interventions it
  left join c_seances se on se.dossier_uid = it.dossier_uid
  left join c_acteurs ac on ac.dossier_uid = it.dossier_uid
  left join c_groupes og on og.dossier_uid = it.dossier_uid
  left join c_parole p on p.dossier_uid = it.dossier_uid;
$$;

revoke execute on function public.dossier_debats_calculer() from public, anon, authenticated;
grant execute on function public.dossier_debats_calculer() to service_role;

-- Premier remplissage. Les nuits suivantes, `refresh_dossier_debats_cache.py` prend le
-- relais et ne réécrit que les lignes changées.
insert into public.dossier_debats_cache (dossier_uid, orateurs, empreinte)
  select dossier_uid, orateurs, empreinte from public.dossier_debats_calculer()
  on conflict (dossier_uid) do nothing;

-- FILET (à appliquer séparément, pas dans cette migration) : le site lit avec la clé
-- `service_role`, qui entre par `authenticator`. `service_role` n'a pas de délai propre
-- et hérite donc des 8 s d'`authenticator` ; `anon` (3 s) et `authenticated` (8 s) ont
-- leur propre réglage et ne sont pas touchés.
--   ALTER ROLE authenticator SET statement_timeout = '30s';
--   NOTIFY pgrst, 'reload config';
