-- Version anglaise du résumé IA d'une décision du Conseil constitutionnel et de la
-- liste de ses censures. Le même appel que la version française les écrit
-- (`import_cc_decisions.py`, prompt `src/lib/prompts/cc-decision.json`) : les deux
-- langues racontent donc la même lecture de la décision. La fiche du dossier les lit
-- sur /en, et retombe sur le français quand elles manquent.
--
-- `articles_censures_en` a la forme de `articles_censures` : [{texte, objet, raison}].
-- Deux colonnes nullables sans valeur par défaut : Postgres les ajoute sans réécrire
-- la table.
--
-- ORDRE D'APPLICATION : avant le déploiement du code qui les lit. La fiche du dossier
-- les demande à l'ancienne API dans la lecture des actes, qui lève sur une colonne
-- inconnue : sans elles, toutes les fiches tombent en erreur. `import_cc_decisions.py`
-- les écrit aussi, et sans elles chaque mise à jour de la nuit échouerait.

alter table public.actes_legislatifs
  add column if not exists resume_cc_en text,
  add column if not exists articles_censures_en jsonb;
