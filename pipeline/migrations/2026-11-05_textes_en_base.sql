-- 2026-11-05 : le texte des débats et l'exposé des amendements reviennent en base (1/2)
--
-- POURQUOI. L'ancien stockage de fichiers disparaît avec la bascule vers le VPS (D-325). Deux contenus
-- y vivaient, sortis de la base pour tenir sous le plafond de 500 Mo d'un projet gratuit
-- (migrations du 2026-10-13, 2026-10-14 et 2026-10-29) :
--   - le texte des interventions des débats, bucket public `debats`, un fichier JSON par
--     séance, `seances/<texte_hash>.json` = `{ordre: texte}` ;
--   - l'exposé des motifs des amendements, bucket public `amendements`, un fichier JSON
--     par dossier, `exposes/<dossier_uid>/<empreinte>.json` = `{uid: exposé}`.
-- Le VPS n'a pas ce plafond : le texte revient là où il était avant, dans deux colonnes
-- `text`. Le site, lui, n'a plus de CDN de fichiers à tenir à jour.
--
-- CETTE MIGRATION est additive : deux colonnes nullables, sans valeur par défaut, donc
-- sans réécriture de table. Elle ne retire rien (le retrait est la seconde moitié,
-- `2026-11-05_textes_en_base_2_retrait_expose_md5.sql`).
--
-- NULLABLE. `debat_interventions.texte` était NOT NULL jusqu'au 2026-10-14. Il revient
-- nullable parce que les 457 066 lignes existantes n'ont pas encore leur texte ; la
-- seconde migration remet NOT NULL une fois le remplissage vérifié.
--
-- CE QUI RESTE, ET POURQUOI.
-- - `debat_seances.texte_hash` reste. Il ne désigne plus un fichier, mais il sert à
--   détecter qu'un texte a changé sans le lire : `empreinte_debats` et
--   `dossier_debats_calculer` le hachent à la place de ~100 Mo de texte, l'import le
--   compare pour sauter les séances inchangées (`_uids_a_ecrire`), et le site le lit
--   encore. Le retirer imposerait de réécrire ces deux fonctions et de recalculer toutes
--   les empreintes (donc tous les résumés de débats), pour économiser une colonne de 64
--   caractères par séance (973 lignes).
-- - `debat_interventions.nb_mots` reste : `recalc_nb_prises_parole()` le lit, écrit par
--   l'import. Le recalculer depuis `texte` changerait une fonction sans rien gagner.
-- - `amendements.expose_md5` reste jusqu'à la seconde migration : c'est la preuve du
--   remplissage (`remplir_textes_depuis_storage.py` n'écrit un exposé que si son md5 est
--   celui-là, et la vérification compare les deux). Une fois `expose` vérifié, il ne sert
--   plus à rien : l'empreinte de classement (`classer_articles.py`) et la comparaison de
--   l'import sont calculées par `md5(expose)` en SQL, la même valeur.
--
-- QUI ÉCRIT, QUI LIT.
-- - `debat_interventions.texte` : écrit par `pipeline/debats/import_debats.py`
--   (`_ecrire_groupe`) ; lu par `src/lib/debats-texte.ts` (page de séance, fiche élu,
--   `/api/resume-debats`).
-- - `amendements.expose` : écrit par `pipeline/import_amendements.py`
--   (`_ecrire_textes`) ; lu par `pipeline/classer_articles.py` (`completer`).
-- - Les deux sont remplis une fois par `script python/remplir_textes_depuis_storage.py`.
--
-- ORDRE D'APPLICATION (répétition sur le VPS, puis bascule). Récit de la bascule, plus
-- rejouable : `remplir_textes_depuis_storage.py` et le contrôle « texte NULL » de
-- `_uids_a_ecrire` ont quitté le dépôt depuis.
-- 1. Cette migration, avant tout autre geste : le nouveau code écrit ces colonnes.
-- 2. `python3 -P "script python/remplir_textes_depuis_storage.py"` : lit les deux buckets
--    (l'ancien projet doit donc encore porter ce stockage) et écrit dans la base visée.
-- 3. `... --verifier` : doit rendre 0 ligne sans texte, 0 exposé manquant, 0 md5 qui
--    diffère. Sinon ne pas continuer.
-- 4. Le nouveau code (imports, `classer_articles.py`, site). Avant l'étape 2 il rendrait
--    la séance « à écrire » à chaque passage (texte NULL) ; après, l'import ne réécrit rien.
-- 5. La seconde migration, après le premier passage de l'import sur la nouvelle base.

alter table public.debat_interventions add column if not exists texte text;
alter table public.amendements add column if not exists expose text;

comment on column public.debat_interventions.texte is
  'Texte de l''intervention, tel que parsé. Écrit par debats/import_debats.py, lu par src/lib/debats-texte.ts. A vécu dans Storage (debats/seances/<texte_hash>.json) du 2026-10-13 au 2026-11-05.';
comment on column public.amendements.expose is
  'Exposé des motifs en texte brut (NULL sans exposé). Écrit par import_amendements.py, lu par classer_articles.py. A vécu dans Storage (amendements/exposes/) du 2026-10-29 au 2026-11-05.';
comment on column public.debat_seances.texte_hash is
  'sha256 du JSON canonique {ordre: texte} des interventions de la séance (fichier_texte_seance de import_debats.py). Sert de témoin de changement du texte : import, empreinte_debats, dossier_debats_calculer. Nommait le fichier Storage debats/seances/<texte_hash>.json.';
