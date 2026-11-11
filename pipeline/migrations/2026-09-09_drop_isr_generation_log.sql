-- 2026-09-09 : l'instrumentation ISR est retirée, sa table part avec elle
--
-- À appliquer à la main APRÈS le déploiement
-- qui vide `middleware.ts` de son insert. Dans l'autre ordre, les quelques minutes
-- entre les deux produisent des inserts en erreur (rattrapés par le `.catch()`, donc
-- invisibles, mais autant les éviter).
--
-- Objet : `public.isr_generation_log`, 6 224 lignes au moment du drop, alimentée par
-- `middleware.ts` depuis le 2026-05-28. Aucune vue, aucun cron, aucun script Python
-- n'en dépend : elle n'était lue qu'à la main, en SQL.
--
-- Pourquoi : elle a servi à identifier les robots derrière les pics d'écritures ISR,
-- et ses deux conclusions sont figées dans D-307 (fiches en `Disallow`) et D-095
-- (`prefetch={false}` sur les liens vers les fiches). L'enquête est close, la table
-- ne répond plus à aucune question ouverte.

DROP TABLE IF EXISTS public.isr_generation_log;
