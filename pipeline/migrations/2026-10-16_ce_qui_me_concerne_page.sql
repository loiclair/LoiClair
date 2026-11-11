-- Ce que lit la page « Ce qui me concerne » en plus de `impacts_courants`.
--
-- Le navigateur reçoit, pour chaque dossier, la liste de tous les profils qu'il
-- concerne, et filtre lui-même selon les profils cochés : le serveur ne voit jamais
-- ce que le lecteur a coché (choix d'Alex du 2026-10-16, qui permet les profils
-- sensibles comme le handicap ou la maladie sans traiter de donnée de santé).

-- Les couples (dossier, profil), sans le texte des phrases : l'index de la page.
create or replace view public.impacts_profils_dossiers with (security_invoker = true) as
select distinct dossier_uid, profil from public.impacts_courants;

-- Recherche de la page : les dossiers dont le titre, ou la phrase (le résumé pour un
-- amendement) d'une ligne, contient chacun des mots, accents et casse ignorés. Les
-- mots arrivent déjà découpés par le client. Sans profil en entrée, pour la même
-- raison que l'index : la recherche ne dit rien de ce que le lecteur a coché.
create or replace function public.chercher_ce_qui_me_concerne(mots text[], en boolean)
returns setof text
language sql stable security invoker set search_path = public, extensions
as $$
  select distinct ic.dossier_uid
  from impacts_courants ic
  join dossiers_legislatifs d on d.uid = ic.dossier_uid
  where (
    select bool_and(
      unaccent(lower(coalesce(d.titre, '') || ' '
        || coalesce(case when en then coalesce(ic.phrase_en, ic.resume_en) else coalesce(ic.phrase_fr, ic.resume_fr) end, '')))
      like '%' || unaccent(lower(m)) || '%')
    from unnest(mots) as m
  )
$$;
