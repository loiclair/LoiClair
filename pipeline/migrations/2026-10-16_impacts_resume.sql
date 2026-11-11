-- Le résumé d'un amendement passe dans la table `impacts`, écrit par le même appel que
-- son classement (`classer_articles.py`). Un amendement fait en général une seule
-- chose : une seule phrase, lue par tous, au lieu d'une phrase par profil plus une
-- phrase neutre venue d'un second passage (`amendement_resumes`, retirée ici), qui
-- disaient la même chose avec deux tournures. NULL pour un article, dont chaque
-- profil garde sa phrase dans `impacts`.

alter table public.impacts
  add column if not exists resume_fr text,
  add column if not exists resume_en text;

drop table if exists public.amendement_resumes;
