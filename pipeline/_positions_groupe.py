"""Position d'un groupe sur un scrutin, et groupe d'un élu à une date donnée.

Fonctions pures, partagées par `import_scrutins_cloud.py` (Assemblée),
`sync_senat.py` (Sénat) et `import_dossiers_cloud.py` (groupe de l'auteur d'une
proposition au jour du dépôt, règle que `sync_senat.py` applique aussi à ses
résolutions). `import_amendements.py` y lit en plus la table des codes de groupe
d'ameli, et `import_acteurs_organes_cloud.py` la couleur de chaque groupe du Sénat. Elles vivent à part pour deux raisons : une même règle
doit valoir dans tous ces imports, et leur logique se contrôle ainsi sans base. Ce
module n'importe rien du projet.
"""

from __future__ import annotations

def position_de_groupe(pour: int, contre: int, abstentions: int) -> str | None:
    """Position d'un groupe déduite de son décompte, ou None s'il n'en a pas.

    La position est l'option qui a le plus de voix dès qu'un membre a voté, l'abstention
    comprise (un groupe dont les seules voix sont des abstentions s'abstient). Deux cas
    restent sans position : personne n'a voté, ou deux options arrivent en tête à
    égalité. Départager par un ordre fixe (pour, puis contre, puis abstention, ce que
    fait l'Assemblée) attribuait au groupe un « pour » qu'autant de ses votants avaient
    refusé.

    Le champ `positionMajoritaire` de l'Assemblée n'est pas repris (D-269) : il contredit
    le décompte du même enregistrement dans environ 3 % des cas (3 163 lignes dans le dump
    de la 17ᵉ législature, mesuré le 2026-10-23), et sur 3 115 de ces lignes il désigne
    l'option arrivée deuxième. Il vaut aussi « pour » quand personne n'a voté. Le
    Sénat, lui, ne publie aucune position de groupe. Aucun seuil de votants ne
    s'applique : celui de 10 % retiré le 2026-10-23 privait de position 506 lignes des
    votes finaux de l'Assemblée dont le décompte en donnait une.
    """
    if pour + contre + abstentions == 0:
        return None
    meilleur = max(pour, contre, abstentions)
    en_tete = [
        position
        for position, nombre in (("pour", pour), ("contre", contre), ("abstention", abstentions))
        if nombre == meilleur
    ]
    return en_tete[0] if len(en_tete) == 1 else None


# Code de groupe politique du Sénat (`memgrppol.grppolcod`) vers l'uid de l'organe
# que l'open data de l'Assemblée donne au même groupe, seul uid connu de nos tables
# (`acteurs.groupe`, `organes`). Vérifié le 2026-09-14, puis le 2026-10-15 après
# l'ajout d'UNT : les 348 sénateurs en exercice ont un seul groupe ouvert dans
# l'historique du Sénat, et son code donne ici exactement leur `acteurs.groupe`.
# Les codes du Sénat sont historiques : `UMP` désigne Les Républicains, `LREM` le
# RDPI, `CRC` le groupe CRCE - Kanaky. `AUCUN` (« sénateurs n'appartenant à aucun
# groupe », quelques jours après une élection ou entre deux groupes) n'y figure
# volontairement pas : ce n'est pas un groupe, un vote émis sous ce code n'est
# attribué à personne. `NI` est la réunion administrative des non-inscrits.
GROUPES_SENAT_VERS_ORGANE = {
    "UMP": "PO286005",   # Les Républicains
    "SOC": "PO77710",    # Socialiste, Écologiste et Républicain
    "UC": "PO309463",    # Union Centriste
    "LREM": "PO732421",  # Rassemblement des démocrates, progressistes et indépendants
    "RTLI": "PO741019",  # Les Indépendants - République et Territoires
    "CRC": "PO77707",    # Communiste Républicain Citoyen et Écologiste - Kanaky
    "RDSE": "PO77714",   # Rassemblement Démocratique et Social Européen
    "GEST": "PO776990",  # Écologiste - Solidarité et Territoires
    "NI": "PO77708",     # Non inscrits
    "UNT": "PO886356",   # Union Nationale pour les Territoires (créé le 2026-10-05)
}
CODES_SENAT_SANS_GROUPE = {"AUCUN"}

# Couleur officielle de chaque groupe du Sénat, par code `grppolcod`. L'open data du
# Sénat n'en publie aucune (`export_sens.zip`, table `grppol`) : ces valeurs sont celles
# du dessin de l'hémicycle de la page « Groupes politiques » de senat.fr
# (`/vos-senateurs/groupes-politiques.html`), relevées le 2026-11-03, sous les mêmes codes
# qu'ici. Un nouveau groupe s'y ajoute à la main, comme dans `GROUPES_SENAT_VERS_ORGANE`.
# `import_acteurs_organes_cloud.py` les écrit dans `organes.couleur_associee` quand
# l'open data de l'Assemblée, qui publie ces organes, n'y met pas de couleur. Pas de `NI` : senat.fr leur donne du noir,
# invisible en thème sombre, et les non-inscrits ne forment pas un groupe (D-313) ; ils
# gardent le gris de repli, comme ceux de l'Assemblée.
COULEURS_GROUPES_SENAT = {
    "UMP": "#2E70D1",
    "UC": "#7ACCEA",
    "SOC": "#FB6F99",
    "CRC": "#D90001",
    "RDSE": "#814A97",
    "LREM": "#F1B608",
    "GEST": "#5CB88D",
    "RTLI": "#C7DDE2",
    "UNT": "#173680",
}


# Code de groupe du dump ameli (`grppol_ameli.cod`, que `amdsen.grpid` désigne pour
# chaque signataire d'un amendement) vers le même uid d'organe. Ameli a ses propres
# codes, différents de ceux de `memgrppol` : `REPUBLICAINS` et non `UMP`, `LaREM` et
# non `LREM`, `CRCE` pour le groupe CRCE - Kanaky. Lue par `import_amendements.py`
# pour la répartition par groupe des amendements d'un dossier.
#
# Vérifié le 2026-10-25 : sur les amendements déposés depuis le 2026-10-06 par des
# sénateurs en exercice, chaque code courant donne exactement leur `acteurs.groupe`
# (UCI 94 sur 94, REPUBLICAINS 218 sur 218, etc.). Les codes anciens ne servent qu'aux
# dossiers des législatures passées, et sont rattachés à l'organe qui a porté le
# groupe sans interruption : `organes` donne à PO286005 un début en 2002 (UMP puis
# Les Républicains), à PO309463 en 1995 (UCR, UDI-UC, UC puis UCI), à PO77707 en 1992
# (CRC, CRC-SPG, CRCE puis CRCE - Kanaky), à PO77710 en 1980. `ECOLO`, le groupe
# écologiste de 2012 à 2017, n'y figure pas : GEST n'est pas son successeur (créé en
# 2020, PO776990), et aucun organe ne le porte. Un code absent de cette table est
# compté « sans groupe connu », et l'import le signale.
GROUPES_AMELI_VERS_ORGANE = {
    "REPUBLICAINS": "PO286005",
    "UMP": "PO286005",
    "SOC": "PO77710",
    "SOC-OLD": "PO77710",
    "SOC20150610": "PO77710",
    "SOC-EELVr": "PO77710",
    "UC": "PO309463",
    "UCI": "PO309463",    # Union Centriste et Indépendants, nouveau nom d'UC en 2026
    "UDI-UC": "PO309463",
    "UCR": "PO309463",
    "LaREM": "PO732421",  # RDPI
    "RTLI": "PO741019",
    "CRCE": "PO77707",    # CRCE - Kanaky
    "CRCE20231003": "PO77707",
    "CRC": "PO77707",
    "CRC-SPG": "PO77707",
    "RDSE": "PO77714",
    "GEST": "PO776990",
    "NI": "PO77708",
    "UNT": "PO886356",
}
CODES_AMELI_SANS_ORGANE = {"ECOLO"}


# Groupes de l'Assemblée renommés en cours de législature : l'open data donne alors un
# nouvel uid au même groupe. Les données anciennes (scrutins, appartenances closes)
# portent l'ancien, les récentes le nouveau ; cette table les cumule sous l'uid actif.
# Elle sert aux scrutins (`import_scrutins_cloud.py`), au groupe de l'auteur d'un
# amendement (`import_amendements.py`) et à l'écriture de
# `acteurs.historique_groupes` (`historique_des_groupes` de
# `import_acteurs_organes_cloud.py`), d'où sa place ici. L'historique ne portant que
# des uid actifs, ses lecteurs (`groupe_au_depot`, `src/lib/groupe-au-jour.ts`) ne
# l'appliquent pas : un renommage ne s'ajoute qu'ici, mais les lignes déjà écrites
# gardent l'ancien uid jusqu'au prochain import de l'AMO30, sauté quand son ZIP n'a pas
# changé. Les réécrire tout de suite, comme `migrations/2026-10-14_historique_groupes_alias.sql`.
#
# Format : { "uid_ancien": "uid_actif" }
GROUPE_ALIAS: dict[str, str] = {
    "PO847173": "PO872880",  # UDR → UDDPLR (renommé le 5 sept. 2025)
}


def groupe_au_jour(appartenances: list[tuple[str, str | None, str]], jour: str) -> str | None:
    """Groupe auquel appartenait un élu le jour `jour` (« YYYY-MM-DD »).

    Rend le troisième élément du tuple retenu, quel qu'il soit : un code du Sénat
    (`sync_senat.py`, qui lit l'historique du Sénat) ou un uid d'organe
    (`groupe_au_depot`, qui lit `acteurs.historique_groupes`).

    `appartenances` : liste de (debut, fin, groupe) d'un seul élu, dates ISO,
    `fin` à None pour une appartenance en cours, bornes incluses (le Sénat écrit
    la sortie la veille de l'entrée suivante : SOC jusqu'au 2026-07-19, RDSE dès
    le 2026-07-20). Un début manquant vaut « depuis toujours » : 1 064 des
    appartenances de l'export ODSEN_HISTOGROUPES du 2026-09-14 n'en ont pas.

    Si deux appartenances couvrent le même jour, la plus récente l'emporte : l'ordre
    du dump ne doit pas décider. Celles du Sénat ne se chevauchent plus depuis 2023 ;
    l'historique de l'AMO30 compte au 2026-10-08 125 passages d'un groupe à l'autre
    où sortie et entrée tombent le même jour, et 16 chevauchements plus longs, le
    dernier achevé le 2024-09-27.
    """
    retenu = None
    for debut, fin, code in appartenances:
        if (debut or "") <= jour and (fin is None or jour <= fin):
            if retenu is None or (debut or "") > (retenu[0] or ""):
                retenu = (debut, fin, code)
    return retenu[2] if retenu else None


def groupe_au_depot(historique: list[dict] | None, jour: str | None) -> str | None:
    """Uid du groupe d'un auteur le jour du dépôt d'un texte.

    `historique` : la valeur brute de `acteurs.historique_groupes` (liste de
    {debut, fin, groupe}, ou None), dont les uid sont déjà les uid actifs : l'alias
    est appliqué à l'écriture (`historique_des_groupes`). La règle unique des
    propositions de l'Assemblée (`import_dossiers_cloud.py`) et des résolutions du
    Sénat (`sync_senat.py`) : aucun repli sur le groupe actuel, None sans historique,
    sans date ou sans groupe ce jour-là. `import_scrutins_cloud.py` l'applique aussi
    aux absents d'un scrutin, que la source ne range dans aucun groupe.
    """
    if not historique or not jour:
        return None
    return groupe_au_jour([(h.get("debut"), h.get("fin"), h["groupe"]) for h in historique], jour)
