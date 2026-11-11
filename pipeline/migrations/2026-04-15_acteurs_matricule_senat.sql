-- Migration : colonne `matricule_senat` sur `acteurs`
-- Peuplée par `sync_senat.py` via le dump `dosleg.zip` (table `auteur.autmat`).
-- Utilisée par `debats/import_debats.py` pour lier `cri:intervenant mat="…"` → `acteurs.uid`.
--
-- Cible : les ~348 sénateurs actifs mappés par (NOM, PRENOM) normalisés.

alter table public.acteurs
  add column if not exists matricule_senat text;

create index if not exists idx_acteurs_matricule_senat
  on public.acteurs (matricule_senat)
  where matricule_senat is not null;
