-- 2026-11-09 : les périodes de député de la 17e législature, pour tous les élus
--
-- POURQUOI. `periodes_mandat_assemblee` ne garde que la chambre actuelle de l'élu : un
-- député élu sénateur n'y a plus que ses périodes de sénateur, et un élu qui ne siège plus
-- y mêle celles des deux chambres. Cette colonne ne dit donc pas qui siégeait à l'Assemblée
-- un jour donné, ce que `import_scrutins_cloud.py` doit savoir pour nommer les députés que
-- la source d'un scrutin ne cite pas. `periodes_mandat_assemblee` reste telle quelle : le
-- score d'activité la lit.
--
-- SÛRE. Une colonne vide de plus, que rien ne lit avant le déploiement du script.
--
-- ORDRE. À appliquer AVANT que les deux scripts atteignent `main`, d'où le cron les lance :
-- sans la colonne, l'import des acteurs et celui des scrutins échouent. Puis remplir la
-- colonne en appelant `importer_acteurs_organes_from_zip` : son `__main__` saute un ZIP
-- inchangé, et `import_scrutins_cloud.py` refuse de tourner tant qu'elle est vide.

alter table public.acteurs add column if not exists periodes_depute_17 jsonb;

comment on column public.acteurs.periodes_depute_17 is
  'Périodes effectives de député de la 17e législature, [{debut, fin}], fin à null si en cours. '
  'Écrite par import_acteurs_organes_cloud.py pour tout élu qui en a eu une, quelle que soit sa '
  'chambre actuelle. Lue par import_scrutins_cloud.py.';
