-- 2026-09-09 : les résumés du Conseil constitutionnel ont enfin une version de prompt
--
-- À appliquer à la main AVANT le déploiement.
-- Additive et sans défaut : le code en place ignore la colonne, rien ne casse.
--
-- Objet : `actes_legislatifs.resume_cc_prompt_version`, jumelle de
-- `textes.resume_ia_prompt_version`, écrite par `import_cc_decisions.py`.
--
-- Pourquoi : le script ne retraitait que les lignes à `resume_cc IS NULL`. Changer
-- le prompt ne régénérait donc rien, jamais, et rien ne le signalait. C'est le seul
-- des quatre pipelines IA qui n'avait aucun moyen de savoir qu'un résumé était périmé.
--
-- Le piège de la sélection qui va avec, côté Python : un `neq` de l'ancienne API ne matche
-- jamais un NULL, et la colonne naît à NULL sur les 44 lignes existantes. Il faut donc
-- trois branches (`resume_cc.is.null`, `resume_cc_prompt_version.is.null`,
-- `resume_cc_prompt_version.neq.<version>`), sans quoi les lignes déjà résumées ne
-- seraient jamais reprises et le correctif serait un no-op silencieux.
--
-- Volume attendu : 1 colonne, puis 44 lignes estampillées.

alter table public.actes_legislatifs
  add column if not exists resume_cc_prompt_version text;

-- Les 44 lignes existantes sont estampillées, pas régénérées : elles sont déjà en JSON
-- à la forme du schéma, produites par le prompt qui reste en place. Poser la version
-- courante dessus est une affirmation vraie.
--
-- Cet UPDATE n'est pas facultatif et ne peut pas attendre : `import_cc_decisions.py`
-- reprend désormais toute ligne dont la version est NULL. Sans lui, le premier passage
-- du cron nocturne rescrape et régénère les 44 décisions.
--
-- La valeur est figée ici parce qu'elle est vérifiable : c'est l'empreinte du fichier
-- `src/lib/prompts/cc-decision.json` au moment de la migration, que TypeScript
-- (`PROMPT_VERSION_CC`) et Python (`PROMPT_VERSION`) recalculent tous deux à chaque
-- lancement. Si le prompt change avant que cette migration ne soit jouée, les lignes
-- porteront une version périmée et seront régénérées à la nuit suivante, ce qui est
-- le comportement voulu.
update public.actes_legislatifs
   set resume_cc_prompt_version = '08ed6a77'
 where code_acte = 'CC-CONCLUSION'
   and resume_cc is not null
   and resume_cc_prompt_version is null;
