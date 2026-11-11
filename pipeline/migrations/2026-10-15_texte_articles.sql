-- Les articles d'une version de texte, un par ligne, pour « Ce qui me concerne » : l'IA classe chaque article selon les profils de lecteur qu'il touche.
--
-- Écrite par `decouper_textes.py`, lue par la page `/ce-qui-me-concerne` et par
-- `/api/ce-qui-me-concerne/element`.

create table if not exists public.texte_articles (
  -- La version découpée (texte initial, texte de CMP ou loi publiée).
  texte_uid   text not null references public.textes (uid) on delete cascade,
  -- Recopié du texte pour filtrer par dossier sans jointure.
  dossier_uid text not null references public.dossiers_legislatifs (uid) on delete cascade,
  -- Rang dans la version, à partir de 1 ; l'ordre de la loi pour une loi publiée.
  ordre       int  not null,
  -- Forme courte commune avec `amendements.article` : « Art. 12 bis », « Art. 1er »,
  -- « Art. liminaire », « Art. unique », ou « État B » pour un état annexé au budget.
  numero      text not null,
  -- Texte brut de l'article, un alinéa par ligne, sans son exposé des motifs.
  contenu     text not null,
  -- md5 du contenu : dit à `decouper_textes.py` si une ligne a changé, et dira au
  -- classement si un article déjà classé doit l'être à nouveau.
  empreinte   text not null,
  primary key (texte_uid, ordre)
);

create index if not exists idx_texte_articles_dossier on public.texte_articles (dossier_uid);

-- Même posture que les autres tables de données : RLS sans policy, lecture par la
-- clé de service côté serveur.
alter table public.texte_articles enable row level security;
