-- Le classement en cours de « Ce qui me concerne », une ligne par (élément, profil) :
-- ce que la page lit, sans avoir à démêler les versions de prompt ni la certitude.
--
-- - Par élément, la ligne de Claude Haiku 5.5 la plus récente. Pendant un
--   reclassement (nouveau prompt), un élément garde son ancien classement tant que
--   le nouveau n'est pas arrivé : la page ne se vide jamais. Les lignes d'une version
--   dépassée sont ensuite purgées par `classer_articles.py`, une fois la nouvelle
--   complète.
-- - Les profils annoncés « possible » ne sont pas montrés : 57 % seulement en étaient
--   justes à la revue du 2026-10-16, contre 87 % pour « certain » et « probable ».
--   Ils restent dans `impacts`.
-- - Un amendement sans aucun profil n'y figure pas : son résumé, montré dans le tiroir
--   d'un article, se lit dans `impacts`.
--
-- `security_invoker` : la vue applique les droits de qui la lit, comme les tables
-- qu'elle lit (RLS sans policy, lecture par la clé de service côté serveur).

create or replace view public.impacts_courants with (security_invoker = true) as
with derniers as (
  select distinct on (element_type, element_id)
         element_type, element_id, dossier_uid, impacts, resume_fr, resume_en
  from public.impacts
  where modele = 'claude-haiku-5-5'
  order by element_type, element_id, created_at desc
)
select d.element_type, d.element_id, d.dossier_uid,
       i ->> 'profil'    as profil,
       i ->> 'phrase_fr' as phrase_fr,
       i ->> 'phrase_en' as phrase_en,
       i ->> 'passage'   as passage,
       i ->> 'certitude' as certitude,
       d.resume_fr, d.resume_en
from derniers d
cross join lateral jsonb_array_elements(d.impacts) as i
where i ->> 'certitude' in ('certain', 'probable');
