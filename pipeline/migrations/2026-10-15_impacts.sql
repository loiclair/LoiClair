-- Le classement d'un article (ou d'un amendement adopté) selon les profils de lecteur
-- qu'il concerne, pour « Ce qui me concerne ». Une ligne par élément, modèle et
-- version du prompt : un prompt corrigé ne doit pas écraser l'ancien résultat avant
-- que le nouveau soit complet.
--
-- Écrite par `classer_articles.py`, lue par la page `/ce-qui-me-concerne`.

create table if not exists public.impacts (
  -- article : `element_id` vaut « <texte_uid>#<ordre> », clé de `texte_articles` ;
  -- amendement : `element_id` est `amendements.uid`, pour un amendement adopté qui
  -- crée un article (« Après art. 4 ») ou ne vise aucun article de la version classée.
  element_type   text not null check (element_type in ('article', 'amendement')),
  element_id     text not null,
  dossier_uid    text not null references public.dossiers_legislatifs (uid) on delete cascade,
  -- Identifiant du modèle tel qu'envoyé à l'API (« gpt-6-luna », « claude-haiku-5-5 »).
  modele         text not null,
  -- Empreinte du prompt (fichier `src/lib/prompts/ce-qui-me-concerne.json` et schéma).
  prompt_version text not null,
  -- md5 du message envoyé : dit si l'élément a changé depuis son classement.
  empreinte_entree text not null,
  -- [{profil, phrase_fr, phrase_en, passage, certitude}], vide si aucun profil.
  impacts        jsonb not null,
  jetons_entree  int,
  jetons_sortie  int,
  cout_usd       numeric,
  duree_ms       int,
  created_at     timestamptz not null default now(),
  primary key (element_type, element_id, modele, prompt_version)
);

create index if not exists idx_impacts_dossier on public.impacts (dossier_uid);

alter table public.impacts enable row level security;
