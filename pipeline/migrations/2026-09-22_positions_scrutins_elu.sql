-- 2026-09-22 : `positions_scrutins_elu`, la position d'un élu sur chaque scrutin
--
-- POURQUOI. La fiche d'élu lisait les 536 scrutins *avec* leur `votes_nominatifs`
-- complet, soit la liste nominative des ~570 sièges de chaque scrutin, pour n'en
-- garder que la position d'un seul élu et jeter le reste en JS. Le 21 septembre 2026,
-- une vague d'environ 850 fiches en une heure a saturé la base : 12 404 requêtes en
-- erreur 522 contre 848 réussies, et plus de la moitié du trafic de la
-- journée pour les 23 lectures qui ont abouti.
--
-- Le dépliage se fait donc côté Postgres : la fonction ne rend que les scrutins où
-- l'élu figure, avec le seau qui le porte. Mesuré le 2026-09-22 sur PA1008, celui qui
-- figure dans le plus de scrutins, 294 sur 536 : 136 592 octets au lieu de
-- 3 211 217, soit 23 fois moins. C'est la taille non compressée qui compte, le
-- compteur de trafic de l'ancien hébergeur mesurant avant gzip.
--
-- `jsonb_exists(kv.value, p_uid)` et non `kv.value ? p_uid` : les deux sont la même
-- opération, mais un point d'interrogation se fait relire comme un paramètre par
-- certains clients SQL, et le fichier doit rester collable tel quel dans l'éditeur.
--
-- `stable` : aucune écriture, et le même appel rend le même résultat dans une
-- transaction, ce qui autorise le planificateur à ne l'évaluer qu'une fois.
-- `security invoker` : la fonction s'exécute avec les droits de l'appelant, donc les
-- policies RLS de `scrutins` continuent de s'appliquer. Même motif que les vues du
-- 2026-08-30.
--
-- ORDRE D'APPLICATION : avant le déploiement du code qui l'appelle. Purement
-- additif, aucun objet existant n'est touché.
--
-- CONTRÔLES APRÈS :
--   - un élu très actif rend le même nombre de lignes que le comptage nominatif :
--       SELECT count(*) FROM positions_scrutins_elu('PA1008');  -- 294 au 2026-09-22
--   - un uid inconnu rend zéro ligne, sans erreur :
--       SELECT count(*) FROM positions_scrutins_elu('PA000000');  -- 0
--   - `anon` et `authenticated` n'ont pas le droit de l'exécuter :
--       SELECT proacl FROM pg_proc WHERE proname = 'positions_scrutins_elu';

create or replace function public.positions_scrutins_elu(p_uid text)
returns table (
  uid text,
  titre text,
  date_scrutin timestamp,
  sort_code text,
  sort_libelle text,
  type_vote_code text,
  type_vote_libelle text,
  synthese_pour int,
  synthese_contre int,
  synthese_abstentions int,
  -- Guillemets obligatoires : `position` est un mot-clé SQL (l'opérateur
  -- `position(x in y)`), et Postgres refuse la déclaration sans eux. Le nom rendu
  -- à l'ancienne API reste `position`, en minuscules, comme l'attend la fiche.
  "position" text
)
language sql
stable
security invoker
as $$
  select s.uid,
         s.titre,
         s.date_scrutin,
         s.sort_code,
         s.sort_libelle,
         s.type_vote_code,
         s.type_vote_libelle,
         s.synthese_pour,
         s.synthese_contre,
         s.synthese_abstentions,
         kv.key
  from public.scrutins s
  cross join lateral jsonb_each(s.votes_nominatifs) kv
  where s.votes_nominatifs is not null
    and jsonb_exists(kv.value, p_uid)
  -- C'est l'ordre dans lequel la fiche affiche la liste de votes, telle quelle : le
  -- composant client ne retrie rien. `date_scrutin` décroissant comme la lecture
  -- qu'on remplace, donc les nuls en tête.
  --
  -- `uid` départage, ce que l'ancienne lecture ne faisait pas. Les scrutins d'une
  -- même journée portent tous minuit pile (9 le 21 juillet 2026) : leur ordre
  -- relatif dépendait du plan d'exécution, et deux rendus successifs de la même
  -- fiche pouvaient les présenter différemment. Croissant, c'est l'ordre que la
  -- production affiche aujourd'hui.
  order by s.date_scrutin desc, s.uid
$$;

-- Le site lit la base avec la clé `service_role` ; personne d'autre n'a besoin
-- d'exécuter la fonction. Même convention que le 2026-07-05.
revoke execute on function public.positions_scrutins_elu(text) from public, anon, authenticated;
grant execute on function public.positions_scrutins_elu(text) to service_role;
