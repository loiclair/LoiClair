"""Rattachement d'un signet du Sénat à un dossier en base.

Le signet (`pjl25-801`) nomme un dossier sur senat.fr ; nos dossiers le portent dans
`lien_senat`. Appelé par `sync_senat.py` (scrutins, avis et rapports) et par
`debats/import_debats.py` (séances), pour qu'un même signet range tout sous le même
dossier.

L'Assemblée donne parfois le même lien Sénat à deux dossiers (au 2026-11-05 :
`pjl25-801`, `pjl24-869`, `ppl25-170`). Le dernier uid l'emportait, et tombait juste
par chance. Le choix se fait désormais d'après la date de ce qu'on rattache.
"""
from __future__ import annotations

import re

import psycopg

from _db import lire

Candidats = list[tuple[str, list[str]]]


def normaliser(signet: str) -> str:
    """Forme de comparaison d'un signet : sans espaces autour, en minuscules."""
    return signet.strip().lower()


def charger_signets(pg: psycopg.Connection) -> dict[str, Candidats]:
    """{signet: [(dossier_uid, dates AAAA-MM-JJ de dépôt de ses textes au Sénat)]}.

    Trié par uid, pour que le dernier recours de `choisir_dossier` soit stable d'une
    exécution à l'autre.
    """
    rows = lire(
        pg,
        """
        SELECT d.uid, d.lien_senat,
               coalesce(array_agg(t.date_depot::date ORDER BY t.date_depot)
                        FILTER (WHERE t.date_depot IS NOT NULL), '{}') AS depots_senat
          FROM dossiers_legislatifs d
          LEFT JOIN textes t ON t.dossier_ref = d.uid AND t.chambre = 'Sénat'
         WHERE d.lien_senat IS NOT NULL AND d.lien_senat <> ''
         GROUP BY d.uid, d.lien_senat
         ORDER BY d.uid
        """,
    )
    signets: dict[str, Candidats] = {}
    for r in rows:
        # Forme du lien : http://www.senat.fr/dossier-legislatif/{signet}.html
        m = re.search(r"/dossier-legislatif/([^/.]+)", r.get("lien_senat") or "")
        if m:
            signets.setdefault(normaliser(m.group(1)), []).append((r["uid"], r["depots_senat"]))
    return signets


def choisir_dossier(candidats: Candidats, date: str | None) -> str:
    """Dossier d'un signet pour un événement du Sénat daté `date` (AAAA-MM-JJ…).

    Quand deux dossiers partagent le signet, le bon est celui dont le Sénat examinait
    un texte à cette date : celui qui a le dépôt au Sénat le plus récent qui ne soit
    pas postérieur à l'événement. Constaté sur les trois cas du 2026-11-05 : le doublon
    est soit un dépôt à l'Assemblée sans aucun texte au Sénat (logement, ArcelorMittal),
    soit un ancien projet dont le Sénat a repris le signet pour le suivant (Corse,
    textes de 2025 contre ceux de 2026). Sans date ni dépôt antérieur, le dossier au
    dépôt le plus récent, puis le dernier uid.
    """
    if len(candidats) == 1:
        return candidats[0][0]
    jour = (date or "")[:10]

    def cle(c: tuple[str, list[str]]) -> tuple[str, str, str]:
        uid, depots = c
        avant = [d for d in depots if jour and d <= jour]
        return (max(avant, default=""), max(depots, default=""), uid)

    return max(candidats, key=cle)[0]


def dossier_du_signet(signets: dict[str, Candidats], signet: str | None,
                      date: str | None) -> str | None:
    """Dossier en base d'un signet à une date, ou None si le signet n'y est pas."""
    candidats = signets.get(normaliser(signet)) if signet else None
    return choisir_dossier(candidats, date) if candidats else None
