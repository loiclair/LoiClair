-- 2026-11-05 : adresse du texte telle que le dump de l'Assemblée la donne
--
-- POURQUOI. `textes.lien_texte` est parfois réparé après l'import : PDF de secours
-- d'un texte de l'Assemblée dont la page opendata ne répond pas
-- (`verifier_urls_textes`), adresse corrigée d'un texte du Sénat
-- (`sync_senat.fix_textes_urls`). L'ancien cache d'empreintes n'envoyait pas un texte
-- inchangé dans le dump, et la réparation tenait. Depuis que la base compare
-- elle-même (D-331), l'import réécrivait chaque nuit l'adresse du dump par-dessus la
-- réparation, que le vérificateur refaisait la même nuit.
--
-- `lien_texte_source` garde la dernière adresse donnée par le dump : `import_textes_cloud.py`
-- ne réécrit `lien_texte` que quand elle change, comme le faisait le cache. Écrite
-- par cet import seul, lue par lui seul.
--
-- Remplie ici avec le lien actuel, pour que la première nuit ne réécrive pas les
-- 9 600 textes. Un lien déjà réparé y entre à la place de l'adresse du dump : la
-- première nuit le remplace une fois par celle du dump, le vérificateur le répare, et
-- c'est fini.

ALTER TABLE textes ADD COLUMN IF NOT EXISTS lien_texte_source text;

UPDATE textes SET lien_texte_source = lien_texte
WHERE lien_texte_source IS NULL AND lien_texte IS NOT NULL;
