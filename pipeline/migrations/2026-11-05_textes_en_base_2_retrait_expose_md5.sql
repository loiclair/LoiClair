-- 2026-11-05 : le texte des débats et l'exposé des amendements reviennent en base (2/2)
--
-- POURQUOI. Seconde moitié de `2026-11-05_textes_en_base.sql` : une fois `expose` rempli
-- et vérifié, `expose_md5` n'est plus qu'un doublon de `md5(expose)` qu'il faudrait tenir
-- d'accord à chaque écriture. Le code n'y touche plus : l'empreinte de classement
-- (`classer_articles.py`, `charger_elements`) et la comparaison de l'import
-- (`import_amendements.py`, `_ecrire_textes`) calculent `md5(expose)` en SQL. Ce serait du
-- code mort. `texte` redevient NOT NULL comme avant le 2026-10-14.
--
-- À NE PAS APPLIQUER AVANT :
--   - le remplissage et sa vérification (`remplir_textes_depuis_storage.py --verifier`,
--     0 ligne sans texte, 0 exposé manquant) : `expose_md5` est la preuve qu'`expose` est
--     le bon texte, il est perdu avec cette migration ;
--   - le nouveau code d'import, qui écrit `texte` à chaque ligne : sans lui, NOT NULL
--     refuserait chaque nouvelle ligne.
--
-- AUCUNE EMPREINTE NE CHANGE. `md5(coalesce(expose, ''))` est ce que
-- `classer_articles.py` calculait avant le 2026-10-29, et ce que
-- `coalesce(expose_md5, md5(''))` rendait depuis : aucun amendement n'est reclassé.
-- Le contrôle de cette égalité est la vérification du remplissage (étape 3 de la
-- première migration), faite avant le nouveau code : après lui, l'import réécrit `expose`
-- sans toucher `expose_md5`, qui se périme ligne par ligne et ne prouve plus rien.
--
-- VERROU. `set not null` lit toute la table sous verrou exclusif (457 066 lignes) ;
-- l'import de la nuit n'y écrit pas pendant ce temps. `drop column` ne réécrit rien.

begin;
-- Contrôle de dernière minute : refuse d'avancer si une ligne sans texte subsiste.
do $$
begin
  if exists (select 1 from public.debat_interventions where texte is null) then
    raise exception 'debat_interventions.texte contient encore des NULL : remplissage incomplet';
  end if;
  if exists (select 1 from public.amendements where expose_md5 is not null and expose is null) then
    raise exception 'amendements.expose manque pour des lignes qui ont un expose_md5 : remplissage incomplet';
  end if;
end
$$;

alter table public.debat_interventions alter column texte set not null;
alter table public.amendements drop column expose_md5;
commit;
