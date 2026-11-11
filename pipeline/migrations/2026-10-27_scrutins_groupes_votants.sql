-- 2026-10-27 : le groupe du jour de chaque votant, écrit par l'import du scrutin
--
-- POURQUOI. Le volet de détail d'un vote (`/api/scrutin-votes`) rangeait chaque nom
-- d'après `acteurs.historique_groupes` (AMO), alors que le décompte de chaque groupe
-- vient du scrutin lui-même (`groupe_ref` à l'Assemblée, `memgrppol` au Sénat). Quand
-- les deux divergent, par exemple un groupe que l'AMO publie avec quelques jours de
-- retard après le renouvellement du Sénat, un votant tombait dans « Groupe non
-- renseigné » ou se voyait marqué « contre son groupe » à tort. La route lisait aussi
-- l'historique complet de chaque élu (environ 577 jsonb par ouverture) pour n'en garder
-- qu'une valeur.
--
-- CETTE MIGRATION ajoute une colonne nullable, sans donnée : les imports la remplissent
-- à leur passage suivant, pour chaque scrutin qui a une liste nominative.
--
-- QUI ÉCRIT, QUI LIT. Écrite par `import_scrutins_cloud.py` (groupe_ref de la source ;
-- absents, que la source ne cite pas, par l'historique AMO au jour du vote) et
-- `sync_senat.py` (`organe_du_jour`, lu dans `memgrppol`). Lue par `/api/scrutin-votes`.

alter table public.scrutins add column if not exists groupes_votants jsonb;

comment on column public.scrutins.groupes_votants is
  'Groupe de chaque élu de votes_nominatifs le jour du scrutin : {uid acteur: uid d''organe '
  'actif, ou null hors de tout groupe connu}. Mêmes clés que votes_nominatifs, rempli en même '
  'temps. Assemblée : groupe_ref de la source (GROUPE_ALIAS appliqué), absents par '
  'acteurs.historique_groupes au jour du vote, import_scrutins_cloud.py. Sénat : memgrppol au '
  'jour du vote, sync_senat.py. Lue par /api/scrutin-votes (D-278).';

-- Le commentaire d'historique_groupes nommait /api/scrutin-votes parmi ses lecteurs :
-- la route lit désormais groupes_votants, et import_scrutins_cloud.py y prend le
-- groupe des absents.
comment on column public.acteurs.historique_groupes is
  'Groupes politiques de l''acteur dans le temps : liste triée de {debut, fin, groupe}, '
  'dates ISO au jour, bornes incluses, fin null si en cours, groupe = uid d''organe GP '
  'ou GROUPESENAT, toujours l''uid actif (GROUPE_ALIAS appliqué à l''écriture : un lecteur '
  'n''a pas d''alias à connaître). Écrite par import_acteurs_organes_cloud.py depuis l''AMO30 '
  'seul. Lue par import_dossiers_cloud.py et sync_senat.py (groupe d''un texte au jour du '
  'dépôt, D-209), par import_scrutins_cloud.py (groupe d''un absent au jour du vote, écrit '
  'dans scrutins.groupes_votants), par src/lib/groupe-au-jour.ts pour /api/resume-debats '
  'et la page de séance (groupe d''un orateur au jour de la séance, D-278), et par '
  'dernierGroupe (src/lib/ancien-elu.ts), via src/lib/groupe-ancien-elu.ts et la fiche '
  'élu (dernier groupe d''un ancien élu).';
