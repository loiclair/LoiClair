-- 2026-09-09 — Titre de l'article Wikipédia d'un élu, résolu par identifiant
--
-- La fiche élu affiche le résumé Wikipédia de la personne. Il était cherché au
-- rendu avec « Prénom_Nom » comme titre d'article, ce qui donnait n'importe qui
-- en cas d'homonyme : la fiche du ministre Michel Fournier affichait la biographie
-- d'un parachutiste retraité de l'Armée de terre.
--
-- La colonne porte désormais le titre exact, résolu une fois par nuit par
-- `enrich_wikipedia_acteurs.py` à partir des identifiants officiels que Wikidata
-- tient à jour (P4123 pour l'Assemblée, P1808 pour le Sénat). Couverture mesurée
-- au 2026-09-09 : 577 députés sur 577, 348 sénateurs sur 348.
--
-- NULL veut dire « aucun article français trouvé sans ambiguïté » : la fiche
-- n'affiche alors pas de biographie, ce qui vaut mieux que celle d'un inconnu.

ALTER TABLE public.acteurs
  ADD COLUMN IF NOT EXISTS wikipedia_titre text;

COMMENT ON COLUMN public.acteurs.wikipedia_titre IS
  'Titre exact de l''article Wikipédia francophone, résolu par identifiant Wikidata. NULL si non résolu.';
