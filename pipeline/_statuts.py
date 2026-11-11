"""Contrôle des valeurs de `statut_final` avant leur envoi en base.

Le site ne connaît que les libellés de `STATUT_MAP` (`src/lib/statut.ts`). Une autre
valeur s'affiche brute, dans toutes les langues, sans que rien ne le signale : `en_cours`
a touché 143 dossiers jusqu'au 2026-10-09. Les libellés sont lus dans le fichier du site
plutôt que recopiés ici, pour qu'il n'y ait qu'une liste à tenir. Le cron nocturne
extrait le dépôt entier : le fichier y est présent.

Appelé avant l'écriture par import_dossiers_cloud.py (chaque lot), sync_senat.py
(rapports et résolutions du Sénat) et import_application_lois.py (« Appliquée »).

Porte aussi la seule définition d'une loi appliquée (`dossiers_appliques`), lue par
import_dossiers_cloud.py et import_application_lois.py, et celle d'un texte mort au
Sénat faute d'acte publié par l'Assemblée (`dossiers_rejetes_au_senat`), lue par
import_dossiers_cloud.py.
"""

import re
from pathlib import Path

from _db import lire
from _refs_an import SUFFIXE_UID_VOTE_RECONSTITUE

_STATUT_TS = Path(__file__).resolve().parent.parent / "src" / "lib" / "statut.ts"
_statuts_connus: frozenset[str] | None = None


def statuts_connus() -> frozenset[str]:
    """Libellés français de `STATUT_MAP`, lus une fois par exécution.

    Lève si le bloc n'est plus trouvé : un contrôle qui ne lirait aucun libellé
    refuserait tout, ou, mal corrigé, laisserait tout passer.
    """
    global _statuts_connus
    if _statuts_connus is None:
        source = _STATUT_TS.read_text(encoding="utf-8")
        # Fin du bloc : la première accolade en début de ligne, `};` comme `} as const;`.
        # Une ligne par libellé, `clé: "libellé",` : un commentaire qui citerait un
        # libellé entre guillemets n'est pas lu comme tel.
        bloc = re.search(r"export const STATUT_MAP\b[^{]*\{(.*?)\n\}", source, re.S)
        libelles = (
            frozenset(re.findall(r'^\s*\w+\s*:\s*"([^"]+)"\s*,?\s*$', bloc.group(1), re.M))
            if bloc else frozenset()
        )
        if not libelles:
            raise RuntimeError(f"STATUT_MAP introuvable ou vide dans {_STATUT_TS}")
        _statuts_connus = libelles
    return _statuts_connus


def verifier_statuts(payloads: list[dict]) -> None:
    """Lève avant l'écriture si un `statut_final` du lot est inconnu du site.

    Arrêter l'import plutôt qu'écarter le dossier (choix d'Alex, 2026-10-29) : l'échec
    de l'étape fait sonner l'alerte du nocturne, alors qu'un dossier écarté resterait
    figé à son ancien statut sans que personne ne lise le journal. Un nouveau statut
    légitime s'ajoute d'abord à `STATUT_MAP`, avec ses traductions.
    """
    connus = statuts_connus()
    inconnus = sorted(
        {(p.get("statut_final"), p.get("uid")) for p in payloads if p.get("statut_final") not in connus},
        key=str,
    )
    if inconnus:
        raise ValueError(
            "statut_final inconnu du site (STATUT_MAP de src/lib/statut.ts) : "
            + ", ".join(f"{s!r} ({u})" for s, u in inconnus[:10])
            + (f" et {len(inconnus) - 10} autres" if len(inconnus) > 10 else "")
        )


# Actes synthétiques qu'`import_application_lois.py` crée pour une loi appliquée
# (application directe, ou tous ses décrets pris). Leur présence fait d'un dossier
# « Promulguée » un dossier « Appliquée ».
CODES_ACTE_APPLIQUEE = ("AN-APPLI-DIRECTE", "AN-APPLI-COMPLETE")


def dossiers_appliques(conn) -> set[str]:
    """Uid des dossiers portant un acte de `CODES_ACTE_APPLIQUEE`.

    Seule définition de « loi appliquée » côté pipelines. Lue par
    `import_application_lois.py` (qui passe ces dossiers à « Appliquée ») et par
    `import_dossiers_cloud.py` (qui, sinon, les repassait à « Promulguée » à chaque
    réécriture, jusqu'au passage suivant de l'autre script). `conn` : connexion
    psycopg (`_db.connexion`), ouverte par l'appelant.
    """
    lignes = lire(
        conn,
        "SELECT DISTINCT dossier_uid FROM actes_legislatifs "
        "WHERE code_acte = ANY(%s) AND dossier_uid IS NOT NULL",
        (list(CODES_ACTE_APPLIQUEE),),
    )
    return {r["dossier_uid"] for r in lignes}


def dossiers_rejetes_au_senat(conn) -> set[str]:
    """Uid des dossiers dont le Sénat a rejeté le texte en 1re lecture, d'après un acte
    `SN1-DEBATS-DEC` que sync_senat.py a recréé.

    Une proposition de loi née au Sénat et rejetée par lui ne va jamais à l'Assemblée :
    son dossier s'arrête dans le dump à `SN1-COM-FOND-*`, et la source le laisse
    « Déposé - pas encore voté » pour toujours. Le texte est mort : il vaut « Rejeté »,
    comme les dossiers que `import_lois_senat` crée (`etaloicod` 03), et c'est ce
    statut qui ferme la frise du site. Seul le vrai acte de l'Assemblée, s'il arrive,
    remplace le recréé ; le statut redevient alors celui que la source lui donne.

    Lue par import_dossiers_cloud.py, seul à écrire le statut : sync_senat.py tourne
    après lui dans le nocturne, donc un rejet s'affiche la nuit suivante. Une dizaine
    de lignes. `conn` : connexion psycopg (`_db.connexion`), ouverte par l'appelant.
    """
    lignes = lire(
        conn,
        "SELECT dossier_uid FROM actes_legislatifs "
        "WHERE code_acte = 'SN1-DEBATS-DEC' AND statut_conclusion = 'rejeté' "
        "AND uid LIKE %s",
        (f"%{SUFFIXE_UID_VOTE_RECONSTITUE}",),
    )
    return {r["dossier_uid"] for r in lignes if r.get("dossier_uid")}
