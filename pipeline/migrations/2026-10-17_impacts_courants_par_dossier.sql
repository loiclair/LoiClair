-- `impacts_courants` filtrable par dossier : même contenu que la version du
-- 2026-10-16, que cette définition remplace.
--
-- La page lit la vue pour une dizaine de dossiers à la fois (`assemblerDossiers`).
-- Dédoublonnée par (élément) seulement, elle relisait tout `impacts` à chaque appel
-- avant d'appliquer le filtre : Postgres ne descend un filtre sous un DISTINCT ON
-- que s'il porte sur une colonne de sa clé. Un élément appartient à un seul
-- dossier, mettre `dossier_uid` en tête de la clé ne change donc aucune ligne, et
-- le filtre passe par `idx_impacts_dossier` : 8 ms au lieu de 43 à 118 ms pour 10
-- dossiers (mesuré le 2026-10-17, 16 900 lignes).
--
-- Le reste ne change pas :
-- - par élément, la ligne de Claude Haiku 5.5 la plus récente ; pendant un
--   reclassement, un élément garde son ancien classement tant que le nouveau n'est
--   pas arrivé, puis `classer_articles.py` purge la version dépassée ;
-- - les profils « possible » ne sont pas montrés ; « certain » et « probable »
--   l'étaient, justes à 73 % à la revue à l'aveugle du 2026-10-17 (89 % pour
--   « certain » seul), d'où la mention bêta de la page ;
-- - un amendement sans aucun profil n'y figure pas ;
-- - `security_invoker` : la vue applique les droits de qui la lit.

create or replace view public.impacts_courants with (security_invoker = true) as
with derniers as (
  select distinct on (dossier_uid, element_type, element_id)
         element_type, element_id, dossier_uid, impacts, resume_fr, resume_en
  from public.impacts
  where modele = 'claude-haiku-5-5'
  order by dossier_uid, element_type, element_id, created_at desc
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
