"""Rapprochement d'un dossier de motion de censure avec son scrutin (`type_vote_code = 'MOC'`).

La source AN omet parfois l'acte de vote d'un dossier de motion : au 2026-09-14, les
deux motions votées le 2025-10-16 (DLR5L17N52918, LFI, et DLR5L17N52919, RN) n'avaient
aucun acte `AN21-MOTION-VOTE`, alors que leurs deux scrutins étaient en base. Leur
dossier restait « Déposé - pas encore voté » et leur vote n'apparaissait nulle part.

Module partagé par deux scripts qui doivent appliquer exactement la même règle :
`import_dossiers_cloud.py` en déduit le statut du dossier, et
`import_actes_legislatifs_cloud.py` reconstitue l'acte de vote manquant. Deux règles
qui divergeraient afficheraient « Rejeté » sans vote dans le parcours, ou l'inverse.
"""

from __future__ import annotations

import re
import unicodedata

# Préfixe d'un dossier consacré à une motion ou à un engagement de responsabilité (49.3).
# Les motions déposées pendant une lecture (ANNLEC, CMP, ANLDEF) ne sont pas traitées :
# le titre de leur dossier est celui du texte, il ne nomme aucun signataire.
CODE_DEPOT_MOTION = "AN21-MOTION"
SUFFIXE_VOTE_MOTION = "-MOTION-VOTE"

_RE_CIVILITE = re.compile(r"^(?:mmes|mme|mlle|mm\.?|m\.)\s+", re.IGNORECASE)


def est_motion_sans_vote(codes_actes: list[str]) -> bool:
    """Vrai si le dossier porte une seule motion et aucun acte de vote de motion.

    `codes_actes` : les `codeActe` de tous les actes du dossier, sous-actes compris.
    Une seule motion est exigée parce que le signataire se lit dans le titre du dossier :
    un 49.3 visé par deux motions a un titre qui n'en nomme aucune.
    """
    return (
        codes_actes.count(CODE_DEPOT_MOTION) == 1
        and not any(c.endswith(SUFFIXE_VOTE_MOTION) for c in codes_actes)
    )


def premier_signataire(titre: str | None) -> str | None:
    """Nom du premier signataire d'une motion, normalisé pour la comparaison.

    Le dossier et le scrutin nomment les signataires différemment (« Mme Marine Le Pen,
    M. Éric Ciotti et 56 de leurs collègues » contre « … et 56 députés. », parfois sans
    civilité, parfois avec une coquille de casse comme « CIotti ») : seul le premier nom,
    sans civilité, accent ni casse, est commun aux deux.
    """
    if not titre:
        return None
    m = re.search(r"\bpar\s+(.+)", titre)
    if not m:
        return None
    premier = re.split(r",|\s+et\s+", m.group(1), maxsplit=1)[0].strip()
    premier = _RE_CIVILITE.sub("", premier)
    sans_accent = unicodedata.normalize("NFKD", premier).encode("ascii", "ignore").decode()
    nom = " ".join(re.findall(r"[a-z]+", sans_accent.lower()))
    return nom or None


def trouver_scrutin_motion(
    titre_dossier: str | None,
    seances: set[str],
    scrutins_moc: list[dict],
) -> dict | None:
    """Scrutin MOC d'un dossier de motion, ou None au moindre doute.

    `seances` : les `reunionRef` des actes du dossier. `scrutins_moc` : lignes de
    `scrutins` avec au moins `seance_ref` et `titre`.

    Même séance ET même premier signataire, et un seul candidat. La séance seule ne
    suffit pas : deux motions se votent souvent le même jour (LFI et RN le 2025-10-16).
    Un même premier signataire pour deux motions de la même séance (Mme Panot, deux
    fois le 2025-02-05) ne se départage pas : mieux vaut aucun vote qu'un faux.
    """
    signataire = premier_signataire(titre_dossier)
    if not signataire or not seances:
        return None
    candidats = [
        s for s in scrutins_moc
        if s.get("seance_ref") in seances and premier_signataire(s.get("titre")) == signataire
    ]
    return candidats[0] if len(candidats) == 1 else None


def motion_adoptee(scrutin: dict) -> bool | None:
    """True si le scrutin a adopté la motion, False s'il l'a rejetée, None si le sort est illisible."""
    sort = (scrutin.get("sort_code") or "").lower()
    if sort.startswith("adopt"):
        return True
    if sort.startswith("rejet"):
        return False
    return None
