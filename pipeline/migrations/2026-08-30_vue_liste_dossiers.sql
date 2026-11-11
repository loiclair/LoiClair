-- Metadonnees de ligne pour la liste /dossiers-legislatifs, agregees cote Postgres.
--
-- La liste affiche desormais la reference officielle du texte (« AN n° 3113 »),
-- sa derniere activite parlementaire et l'acte correspondant. Ces trois valeurs
-- vivent dans deux tables volumineuses : 27 301 lignes dans actes_legislatifs,
-- 8 124 dans textes. Les rapatrier pour agreger en JS, c'est l'anti-pattern deja
-- corrige le 2026-08-29 et le 2026-08-30 : au-dela du gaspillage, la reponse est
-- tronquee par le plafond « Max rows » de l'ancienne API (3 000), sans aucune erreur.
--
-- has_texte entre dans la meme vue parce qu'il se calcule sur la meme table.
-- L'endpoint /api/search-index/dossiers le derivait d'une pagination complete de
-- textes, soit une dizaine d'allers-retours HTTP par regeneration de l'index,
-- pour un simple booleen par dossier.
--
-- security_invoker : la vue s'evalue avec les droits de l'appelant, donc les
-- policies RLS des tables sources continuent de s'appliquer normalement.
--
-- Attention, la vue rend 3 055 lignes, soit plus que le plafond « Max rows ».
-- Sa lecture passait donc par une pagination complete, jamais par un .limit().
--
-- Pour rejouer ce fichier apres avoir change le TYPE d'une colonne, il faut un
-- « drop view public.dossiers_liste_meta; » d'abord : create or replace refuse de
-- changer le type d'une colonne existante (erreur 42P16).

create or replace view public.dossiers_liste_meta
with (security_invoker = true) as
  with derniere as (
    -- Le filtre sur date_acte n'est pas une precaution : 12 819 des 27 301 actes
    -- n'ont pas de date, et ils touchent les 3 055 dossiers. En DESC, Postgres
    -- classe les NULL en tete, donc sans ce filtre chaque dossier remonte un acte
    -- sans date et derniere_activite sort entierement vide, sans la moindre erreur.
    -- Un acte non date ne peut de toute facon pas etre la derniere activite.
    --
    -- Deux criteres departagent les actes du meme jour, dans cet ordre.
    --
    -- 1. Le rang par etape, mais seulement au-dela du vote. Une loi d'application
    --    directe porte PROM-PUB et AN-APPLI-DIRECTE a la meme date : sans ce rang
    --    c'est la promulgation qui remonte, alors que le statut du dossier dit deja
    --    « Appliquee », et la liste affiche donc deux etats contradictoires sur la
    --    meme ligne. 67 dossiers etaient dans ce cas precis, 85 changent de dernier
    --    acte en tout, decrets et decisions du Conseil compris. Le rang s'arrete la :
    --    dans la navette, deux actes du meme jour sont deux faces d'un meme evenement (l'AN
    --    vote, le texte arrive au Senat) et departager par l'etape ferait gagner un
    --    depot sur un vote, ce qui apprend moins au lecteur.
    -- 2. (parent_uid is not null) desc fait gagner l'acte feuille sur l'acte racine.
    --    Sans ce critere on remonte « 1ere lecture (1ere assemblee saisie) » la ou la
    --    feuille dit « Travaux des commissions » : c'est la meme date, mais le niveau
    --    fin est le seul qui apprenne quelque chose au lecteur.
    select distinct on (a.dossier_uid)
           a.dossier_uid, a.date_acte, a.code_acte
    from public.actes_legislatifs a
    where a.date_acte is not null
    order by a.dossier_uid, a.date_acte desc,
             case when a.code_acte like 'AN-APPLI-%' then 3
                  when a.code_acte like 'DECAPP-%'   then 2
                  when a.code_acte like 'PROM-%'     then 1
                  else 0 end desc,
             (a.parent_uid is not null) desc, a.uid
  ),
  numero as (
    -- Le numero de reference est celui du texte de premier depot (depot_code
    -- 'INITDEP'), avec repli sur n'importe quel texte numerote du dossier : pour un
    -- rapport d'information, qui n'a pas de depot d'initiative, le numero du
    -- rapport est justement la bonne reference. 2 782 dossiers par le premier
    -- depot, 231 par le repli, 42 sans aucun numero : 21 missions d'information,
    -- 20 engagements de responsabilite et une commission d'enquete, qui n'ont pas
    -- de texte numerote du tout.
    --
    -- « desc nulls last » n'est pas cosmetique : en DESC, Postgres place les NULL
    -- en tete, et un depot_code NULL ferait gagner le mauvais texte. La couverture
    -- par premier depot tombe alors de 2 782 a 2 476, en silence.
    select distinct on (t.dossier_ref)
           t.dossier_ref, t.num_notice, t.chambre
    from public.textes t
    where t.num_notice is not null
    order by t.dossier_ref, (t.depot_code = 'INITDEP') desc nulls last,
             t.date_depot nulls last, t.uid
  ),
  avec_texte as (
    select distinct t.dossier_ref
    from public.textes t
    where t.dossier_ref is not null
      and (t.url_accessible or t.contenu_legifrance is not null)
  )
  select d.uid,
         -- Cast en date : l'heure n'est jamais affichee, et la sortie JSON s'en
         -- trouve raccourcie de moitie sur les 3 055 lignes.
         der.date_acte::date as derniere_activite,
         der.code_acte as dernier_acte_code,
         n.num_notice,
         n.chambre,
         (av.dossier_ref is not null) as has_texte
  from public.dossiers_legislatifs d
  left join derniere   der on der.dossier_uid = d.uid
  left join numero     n   on n.dossier_ref   = d.uid
  left join avec_texte av  on av.dossier_ref  = d.uid;
