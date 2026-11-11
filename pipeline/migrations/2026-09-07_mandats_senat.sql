-- Mandats internes au Sénat, importés du dump `export_sens.zip`.
--
-- Pourquoi une table et pas un enrichissement du jsonb `acteurs.mandats` :
-- `import_acteurs_organes_cloud.py` réécrit `mandats` en bloc à chaque passage
-- (l. 690), donc tout ajout y serait effacé au premier rerun isolé. La source
-- n'est d'ailleurs pas la même : le jsonb vient de l'open data de l'Assemblée,
-- qui décrit les sénateurs pour ses propres besoins et ne détaille pas les
-- structures internes du Sénat. Un sénateur y porte 5,4 mandats en moyenne, un
-- député 23,3 — l'écart n'est pas un écart de mandats, c'est un écart de source.
--
-- Une ligne = un mandat interne **en cours**. La table est reconstruite à chaque
-- exécution de `sync_senat.py` ; elle ne garde pas d'historique, la fiche élu
-- n'affichant que les mandats ouverts.
--
-- Trois filtres, tous nécessaires, tous mesurés sur le dump du 2026-09-06 :
--   1. `temvalcod = 'ACTIF'` sur le mandat, ET date de fin nulle OU future.
--      Filtrer sur la seule date de fin nulle rend zéro ligne : les 30 539
--      lignes de `memgrpsen` en portent toutes une, les actives portant une
--      date *future* (2 763 au 2026-10-01).
--   2. `temvalcod = 'ACTIF'` sur l'**organe** aussi. 683 lignes `memcom`
--      marquées ACTIF pointent vers des organes morts : mission « Uberisation »
--      close en 2021, commission d'enquête Lubrizol de 2019, des CMP de 2009.
--      C'est le seul garde-fou contre les mandats terminés.
--   3. La pseudo-commission `NEANT`, au libellé vide, est écartée : elle marque
--      le président du Sénat, qui n'appartient à aucune commission. C'est sa
--      seule ligne, il n'apparaît donc pas ici — 347 sénateurs sur 348, et
--      c'est le résultat attendu, pas un trou.

create table if not exists public.mandats_senat (
  -- uid de `acteurs`, résolu via `acteurs.matricule_senat`, la colonne que
  -- l'étape « Enrichissement coordonnées sénateurs » du même script écrit.
  -- Même voie que `import_presences_senat`, et non le rapprochement par nom :
  -- le matricule est une clé, un nom est un pari.
  uid          text not null,
  -- GA | GE | COMSENAT | COMSPSENAT | MISINFOCOM | COMENQSENAT | DELEGSENAT |
  -- ORGEXTPARL. Ce sont les codes `typeOrgane` de l'open data de l'Assemblée,
  -- pas une nomenclature maison : `TYPES_MANDAT`
  -- (src/app/[locale]/(app)/les-elus/[uid]/page.tsx) les traduit déjà en clés
  -- i18n et en rang d'affichage. Un code inventé ici retomberait sur « autre »
  -- et sortirait du tri. `COMENQSENAT` est la seule exception, et la fiche élu
  -- le déclare : l'Assemblée n'a pas de code de commission d'enquête.
  --
  -- Les quatre natures de commission viennent de `com.typorgcod`, que le dump
  -- renseigne sur les 105 organes vivants. L'import les a d'abord toutes écrites
  -- `COMSENAT`, ce qui affichait « Commission permanente » sur 310 lignes qui
  -- n'en étaient pas.
  type         text not null,
  -- Libellé de l'organe tel que le Sénat l'écrit : `evelib` pour les groupes,
  -- les commissions et les délégations, `evelil` pour les organismes
  -- extraparlementaires, dont `evelib` est vide sur les 447 lignes. Seule
  -- retouche, sur les commissions : le préfixe de nature (« MI », « CE »,
  -- « CS ») est retiré, la colonne `type` le portant désormais.
  libelle      text not null,
  -- Président, Vice-Présidente, Secrétaire, Rapporteure, Membre suppléant…
  -- Accordée en genre via `sen.senfem` : la nomenclature du Sénat publie les
  -- deux formes, et 112 des 348 sénateurs sont des sénatrices.
  -- NULL pour un simple membre, soit 71 % des lignes : la pastille de type dit
  -- déjà « Commission », « Membre » n'y ajouterait rien. Même règle que
  -- `mandats_locaux.fonction` et que `qualiteSignificative()` côté front.
  qualite      text,
  -- Date d'entrée dans l'organe. Le dump l'écrit « 2023-10-01 00:00:00 » ;
  -- l'import tronque aux dix premiers caractères.
  date_debut   date,
  -- Clé naturelle, sur le modèle de `mandats_locaux (uid, type, collectivite)`.
  -- Le libellé plutôt que le code d'organe : un organe renommé produit une
  -- nouvelle clé et l'ancienne part à la réconciliation, ce qui est le
  -- comportement voulu — la fiche doit afficher le nom d'aujourd'hui.
  primary key (uid, type, libelle)
);

create index if not exists idx_mandats_senat_uid on public.mandats_senat (uid);

-- Même posture que les autres tables de données publiques du projet : RLS
-- activé sans policy, la lecture passant par la clé de service côté serveur.
alter table public.mandats_senat enable row level security;
