"""Colonnes d'`acteurs` que le Sénat seul écrit pour ses élus en exercice.

`sync_senat.py` (étape des coordonnées) les tient à jour depuis le dump du Sénat, et
`import_acteurs_organes_cloud.py` les retire du payload d'un sénateur en exercice.
Sans ce retrait, l'import de l'Assemblée les réécrivait plus tôt dans la nuit avec ses
propres valeurs : le 2026-10-25, 33 sénateurs recevaient ainsi l'adresse
`@assemblee-nationale.fr` de leur ancien mandat de député, jusqu'au passage du Sénat,
et jusqu'à la nuit suivante quand `sync_senat.py` échouait. La liste vit ici pour que
les deux scripts ne puissent pas diverger : une colonne ajoutée d'un seul côté
rouvrirait la fenêtre sans que rien ne le signale. Ce module n'importe rien du projet.
"""

COLONNES_COORDONNEES_SENAT = (
    "place_hemicycle",
    "departement_election",
    "email",
    "libelle_profession",
    "cat_soc_pro",
    "fam_soc_pro",
    "twitter_url",
    "linkedin_url",
    "instagram_url",
    "facebook_url",
    "profil_url",
    "adresse_circonscription",
)
