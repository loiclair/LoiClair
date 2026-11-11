"""Lecture des références de vote des actes législatifs de l'Assemblée.

Partagé par import_dossiers_cloud.py (colonne `votes_refs` du dossier) et
import_actes_legislatifs_cloud.py (colonne `vote_refs` de chaque acte). Chacun avait sa
copie, et elles lisaient la source différemment : les dossiers ne lisaient que
`voteRefs`, les actes `voteRefs` puis `voteRef`. À la prochaine forme inattendue de la
source, l'une se serait corrigée sans l'autre. Au 2026-10-29, les deux lectures donnaient
le même résultat sur les 10 931 dossiers du dump.

Porte aussi le suffixe d'uid des actes de vote que nos scripts recréent quand la source
n'a pas l'acte (`SUFFIXE_UID_VOTE_RECONSTITUE`), partagé par les deux scripts qui les
écrivent (import_actes_legislatifs_cloud.py, sync_senat.py) et par `_statuts.py`, qui
les lit.
"""

# Suffixe d'uid des actes de vote recréés par nos scripts : vote d'une motion de censure
# (import_actes_legislatifs_cloud.py) et décision du Sénat sans acte AN (sync_senat.py).
# Il ne peut pas entrer en collision avec un uid AN (`L17-VD229883`) et désigne ces
# lignes sans ambiguïté, pour les retrouver et les supprimer le jour où la source publie
# le vrai acte. `_statuts.py` s'en sert pour reconnaître les rejets du Sénat recréés.
SUFFIXE_UID_VOTE_RECONSTITUE = "-VOTE-RECONSTITUE"


def ajouter_refs(ref, result_set: set) -> None:
    """Ajoute une référence, ou chacune d'une liste, à `result_set`.

    La source AN écrit un seul vote comme `{"voteRef": "V…"}` mais plusieurs comme
    `{"voteRef": ["V…", "V…"]}`. Ajoutée telle quelle, la liste faisait échouer tout le
    dossier dans un import et retirait tous les votes de l'acte dans l'autre : le
    PLFSS 2027 (DLR5L17N54951, acte L17-VD234494DEC) le 2026-10-23, premier cas observé.

    Sert aussi aux références de textes de l'import des dossiers (`refTexteAssocie`).
    Une valeur null ou une chaîne vide est ignorée : null faisait lever le `sorted()`
    de l'appelant, et une chaîne vide rendait `vote_refs` non nul, ce qui soustrayait
    l'acte à l'enrichissement par séance.
    """
    if isinstance(ref, list):
        result_set.update(r for r in ref if isinstance(r, str) and r)
    elif isinstance(ref, str) and ref:
        result_set.add(ref)


def extraire_vote_refs(actes) -> list[str]:
    """Références de vote d'un acte (dict) ou d'une liste d'actes, sous-actes compris.

    Lit `voteRefs`, puis `voteRef` posé directement sur l'acte (forme jamais vue dans le
    dump au 2026-10-29, gardée de l'ancienne lecture des actes). La valeur peut être une
    chaîne, une liste, ou un dict `{"voteRef": …}`. Rend une liste triée sans doublon :
    l'ordre d'un `set` change d'une exécution à l'autre, et changeait l'empreinte de la
    ligne, donc la réécrivait chaque nuit sans qu'aucune valeur ne bouge.
    """
    refs: set[str] = set()
    _parcourir(actes, refs)
    return sorted(refs)


def _parcourir(actes, refs: set[str]) -> None:
    """Descend dans l'arbre `actesLegislatifs.acteLegislatif` (dict seul ou liste)."""
    if isinstance(actes, list):
        for acte in actes:
            _parcourir(acte, refs)
        return
    if not isinstance(actes, dict):
        return
    brut = actes.get("voteRefs") or actes.get("voteRef")
    if isinstance(brut, dict):
        ajouter_refs(brut.get("voteRef"), refs)
    elif isinstance(brut, list):
        for item in brut:
            ajouter_refs(item.get("voteRef") if isinstance(item, dict) else item, refs)
    else:
        ajouter_refs(brut, refs)
    sous = actes.get("actesLegislatifs")
    if isinstance(sous, dict):
        _parcourir(sous.get("acteLegislatif"), refs)
