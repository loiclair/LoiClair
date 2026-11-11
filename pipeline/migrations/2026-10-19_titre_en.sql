-- Titre anglais de chaque dossier, traduit par Claude Haiku 5.5 depuis le titre
-- officiel français. Le site l'affiche sur /en, avec le badge IA et le titre officiel
-- en dessous (`src/lib/titre-dossier.ts`) ; le français ne le lit jamais.
--
-- Écrites par `traduire_titres.py` seul. Les imports (`import_dossiers_cloud.py`,
-- `sync_senat.py`) ne les mettent pas dans leur payload et n'y touchent donc pas,
-- comme pour `themes`.
--
-- Deux colonnes nullables sans valeur par défaut : Postgres les ajoute sans réécrire
-- la table.

alter table public.dossiers_legislatifs
  add column if not exists titre_en text,
  -- md5(titre + version du prompt). Un titre renommé ou un prompt retouché ne
  -- correspond plus à l'empreinte : le titre repart en traduction la nuit suivante.
  add column if not exists titre_en_empreinte text;
