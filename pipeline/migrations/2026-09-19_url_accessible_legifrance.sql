-- 2026-09-19 : réparer les textes Légifrance marqués « lien mort », supprimer un consolidé fantôme
--
-- À appliquer à la main. Aucune structure ne
-- change : deux corrections de données, indépendantes du déploiement du code.
--
-- ── 1. `url_accessible` des textes Légifrance ────────────────────────────────
--
-- Légifrance répond 403 au HEAD du vérificateur d'URL nocturne (anti-bot), qui en
-- conclut « lien mort » et pose `url_accessible = false`. 158 textes sont dans ce
-- cas alors que leur `contenu_legifrance` est en base, donc lisible sur le site : la
-- fiche dossier les écartait de la sélection du texte par défaut, et la loi
-- promulguée d'un dossier ouvrait sur un avis du Sénat.
--
-- `import_textes_cloud.py:verifier_urls_textes` cesse dans le même geste de tester
-- les textes dont le contenu est déjà importé : sans ce filtre, la nuit suivante
-- reposerait `false` sur les 158 lignes réparées ici.
--
-- ── 2. `LOI2011301-VC` ───────────────────────────────────────────────────────
--
-- La loi n° 2011-301 autorise l'approbation d'un accord international : Légifrance
-- ne la range pas dans le fond consolidé (LODA). La ligne a donc été créée sans date
-- ni contenu, et la passe de synchronisation ne peut pas la réparer puisqu'elle saute
-- les consolidées sans date cible. Elle s'affichait comme « Version consolidée » dans
-- le menu des versions du dossier DLR5L13N26487, sans rien derrière.
--
-- Vérifié avant suppression, le 2026-09-19 : aucune ligne d'`actes_legislatifs` ne cite
-- cet uid, ni dans `textes_associes` ni dans `texte_adopte` (0 et 0).
--
-- `import_legifrance_cloud.py` n'insère plus de ligne quand Légifrance ne rend pas de
-- date : le texte reste candidat et sera recréé si Légifrance le consolide un jour.

update public.textes
   set url_accessible = true
 where provenance = 'Légifrance'
   and contenu_legifrance is not null
   and url_accessible is not true;

delete from public.textes
 where uid = 'LOI2011301-VC';
