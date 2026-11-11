-- 2026-09-09 : une colonne de version par langue, pour les deux caches de résumé
--
-- À appliquer à la main AVANT le déploiement.
-- Le dégât si l'ordre est inversé n'est pas cosmétique : `resume-ia/page.tsx` demande
-- `resume_ia_prompt_version_en` dans son SELECT, l'ancienne API rend un 400, le `|| []`
-- avale le null, et la fiche dossier se rend avec ZÉRO texte : pas de sélecteur, pas
-- de résumé, pas de section Textes, et rien dans les logs. La page ne casse pas, elle
-- se vide.
--
-- Objet : `textes.resume_ia_prompt_version_en` et
-- `dossiers_legislatifs.resume_debats_prompt_version_en`, jumelles des colonnes
-- existantes, réservées à la locale anglaise.
--
-- Pourquoi : les deux caches stockent le texte anglais dans une colonne à part
-- (`resume_ia_en`, `resume_debats_ia_en`) mais partageaient UNE seule colonne de
-- version, alors que les hashs français et anglais sont différents par construction
-- (les prompts ne sont pas les mêmes chaînes). Les deux caches ne pouvaient donc
-- jamais être valides en même temps sur une même ligne : consulter un dossier en
-- anglais posait le hash anglais, ce qui invalidait le résumé français, dont la
-- régénération reposait le hash français, et ainsi de suite. Mesuré le 2026-09-09 :
-- sur 20 résumés anglais stockés, 1 seul était encore considéré valide.
--
-- Additive et sans défaut : le code en place ignore ces colonnes, la migration peut
-- donc être appliquée avant le déploiement sans rien casser. Les lignes existantes
-- naissent à NULL, donc leur cache anglais sera régénéré à la prochaine visite.
--
-- Volume attendu : 2 colonnes, aucune ligne écrite.

alter table public.textes
  add column if not exists resume_ia_prompt_version_en text;

alter table public.dossiers_legislatifs
  add column if not exists resume_debats_prompt_version_en text;
