-- Retire la fonction de recherche de « Ce qui me concerne » (créée par
-- `2026-10-16_ce_qui_me_concerne_page.sql`), devenue sans appelant.
--
-- La recherche se fait désormais dans le navigateur, sur le contenu de tous les
-- dossiers chargé en blocs fixes (`/api/ce-qui-me-concerne/tout`) : envoyer les mots
-- tapés au serveur contredisait la promesse du site, qui ne reçoit rien qui dise ce
-- que le lecteur cherche (D-243, comme la recherche de /dossiers-legislatifs, D-020).
-- La vue `impacts_profils_dossiers`, créée par la même migration, reste : l'index de
-- la page la lit.

drop function if exists public.chercher_ce_qui_me_concerne(text[], boolean);
