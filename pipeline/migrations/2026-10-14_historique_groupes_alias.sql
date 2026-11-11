-- 2026-10-14 : `acteurs.historique_groupes` ne porte plus que des uid de groupe actifs
--
-- POURQUOI. Un groupe renommé (UDR `PO847173` devenu UDDPLR `PO872880` le 5 sept. 2025)
-- garde dans l'open data son ancien uid sur les appartenances anciennes. Chaque lecteur
-- de la colonne appliquait `GROUPE_ALIAS` : `groupe_au_depot` et les libellés de
-- `import_dossiers_cloud.py` en Python, `groupeAuJour` dans le site, avec une copie de
-- la table en TypeScript qu'un renommage oublié aurait fait diverger. L'alias est
-- désormais appliqué une seule fois, à l'écriture, par `historique_des_groupes` de
-- `import_acteurs_organes_cloud.py`, et aucun lecteur ne le connaît plus.
--
-- CETTE MIGRATION réécrit une fois les lignes déjà en base, sans attendre le prochain
-- passage de l'AMO30, sauté quand son ZIP n'a pas changé : un lecteur sans alias y
-- lirait sinon l'ancien uid. 16 lignes au 2026-10-14. La liste est retriée comme le
-- fait le Python (`debut`, puis `fin` ou « 9999 », puis `groupe`), en collation "C"
-- pour comparer octet par octet comme `sorted()`, afin que l'import suivant écrive
-- exactement le même contenu.
--
-- QUI ÉCRIT, QUI LIT. Écrite par `import_acteurs_organes_cloud.py` (AMO30 seul). Lue
-- par `import_dossiers_cloud.py`, `sync_senat.py` (D-209) et `src/lib/groupe-au-jour.ts`
-- (`/api/resume-debats` et la page de séance, D-233).

update public.acteurs a
   set historique_groupes = (
     select jsonb_agg(
              jsonb_set(e, '{groupe}', to_jsonb(case when e->>'groupe' = 'PO847173' then 'PO872880' else e->>'groupe' end))
              order by coalesce(e->>'debut', '') collate "C",
                       coalesce(e->>'fin', '9999') collate "C",
                       (case when e->>'groupe' = 'PO847173' then 'PO872880' else e->>'groupe' end) collate "C"
            )
       from jsonb_array_elements(a.historique_groupes) e
   )
 where a.historique_groupes::text like '%"PO847173"%';

comment on column public.acteurs.historique_groupes is
  'Groupes politiques de l''acteur dans le temps : liste triée de {debut, fin, groupe}, '
  'dates ISO au jour, bornes incluses, fin null si en cours, groupe = uid d''organe GP '
  'ou GROUPESENAT, toujours l''uid actif (GROUPE_ALIAS appliqué à l''écriture : un lecteur '
  'n''a pas d''alias à connaître). Écrite par import_acteurs_organes_cloud.py depuis l''AMO30 '
  'seul. Lue par import_dossiers_cloud.py et sync_senat.py (groupe d''un texte au jour du '
  'dépôt, D-209), et par src/lib/groupe-au-jour.ts pour /api/resume-debats et la page de '
  'séance (groupe d''un orateur au jour de la séance, D-233).';
