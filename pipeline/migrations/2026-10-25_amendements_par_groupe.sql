-- Répartition par groupe des amendements d'un dossier, pour le graphique de la
-- section « Modifications du texte » de la fiche dossier.
--
-- Une ligne par (chambre, groupe) et non une table : quelques lignes par dossier,
-- écrites par `import_amendements.py` dans la même transaction que les compteurs
-- `nb_amendements_deposes` et `nb_amendements_adoptes`, dont elles sont le détail
-- (la somme des `deposes` égale le premier, celle des `adoptes` le second). Lue par
-- la fiche dossier et par `/Facts/amendements` (graphiques par groupe, environ
-- 100 Ko pour les lois promulguées), qui sélectionnent leurs colonnes par nom :
-- aucune liste ne paie ce jsonb.
--
-- Forme : [{ "chambre": "AN" | "SN",
--            "type": "groupe" | "gouvernement" | "commission" | "non_publie" | "sans_groupe",
--            "groupe": "PO845413" | null,   -- uid d'organe, seulement pour "groupe"
--            "deposes": 410, "adoptes": 18 }]
-- Le groupe est celui de l'auteur au jour du dépôt, tel que chaque chambre le publie
-- avec l'amendement (pas son groupe d'aujourd'hui). NULL pour un dossier sans
-- amendement compté.

alter table public.dossiers_legislatifs
  add column if not exists amendements_par_groupe jsonb;
