-- Retire 11 scrutins du Sénat importés à tort comme votes finaux : des votes sur un
-- amendement ou sur un article, retenus parce que leur intitulé contenait « ensemble »
-- (« à l'article unique constituant l'ensemble », « l'ensemble des membres du groupe »,
-- « sur l'ensemble du territoire »). `import_scrutins_senat` ne les retient plus
-- (`_est_vote_sur_ensemble` de sync_senat.py), mais n'efface jamais un scrutin : sans
-- cette migration, ils resteraient comptés dans la participation des sénateurs.
--
-- Liste relevée le 2026-11-07 en comparant les deux règles sur le dump `dosleg.zip` :
-- ces 11 votes, et aucun autre, sortent. Aucune table n'a de clé étrangère vers
-- `scrutins` ; ce qui cite un scrutin se nettoie ici à la main : positions de groupe,
-- et `vote_refs` des actes (un tableau vidé repasse à NULL, comme l'écrit l'import AN).
-- `quiz_affinite_scrutins` n'en cite aucun. Les compteurs de participation (`acteurs`,
-- `organes`) et le score d'activité se recalculent au run de nuit suivant.
--
-- Appliquée le 2026-11-07. Elle ne tient qu'avec le nouveau sync_senat.py sur `main`,
-- que lit le cron : avec l'ancienne règle, la nuit suivante réimporte les 11 scrutins,
-- leurs positions et leurs `vote_refs`, sans rien signaler.
--
-- Un acte de décision recréé par sync_senat.py (`-VOTE-RECONSTITUE`) dont tous les
-- scrutins sortent est supprimé ici, comme le ferait le run suivant (aucun au
-- 2026-11-07 : le seul recréé touché, DSNPJL2023N0299, garde son vrai vote) : sans quoi il
-- garderait jusque-là sa conclusion, et import_dossiers_cloud.py, qui passe avant
-- sync_senat.py, pourrait encore lire un « rejeté » tiré d'un vote d'amendement
-- (`dossiers_rejetes_au_senat` de `_statuts.py`).

begin;

create temporary table votes_retires (uid text primary key) on commit drop;
insert into votes_retires (uid) values
  ('VTSNR2023V1'), ('VTSNR2023V134'), ('VTSNR2023V135'), ('VTSNR2025V318'),
  ('VTSNR2026V2'), ('VTSNR2026V3'), ('VTSNR2026V4'), ('VTSNR2026V5'),
  ('VTSNR2026V6'), ('VTSNR2026V7'), ('VTSNR2026V8');

-- Codes de `CODES_ACTE_DEC_SENAT` : les votes de motion de censure portent le même
-- suffixe et appartiennent à import_actes_legislatifs_cloud.py.
delete from public.actes_legislatifs a
 where a.uid like '%-VOTE-RECONSTITUE'
   and a.code_acte in ('SN1-DEBATS-DEC', 'SN2-DEBATS-DEC', 'CMP-DEBATS-SN-DEC',
                       'SNNLEC-DEBATS-DEC', 'SNDEF-DEBATS-DEC')
   and a.vote_refs && array(select uid from votes_retires)
   and a.vote_refs <@ array(select uid from votes_retires);

update public.actes_legislatifs a
   set vote_refs = nullif(
         array(select r from unnest(a.vote_refs) as r where r not in (select uid from votes_retires)),
         '{}'::text[])
 where a.vote_refs && array(select uid from votes_retires);

delete from public.scrutins_groupes_positions
 where scrutin_uid in (select uid from votes_retires);

delete from public.scrutins
 where chambre = 'Sénat' and uid in (select uid from votes_retires);

commit;
