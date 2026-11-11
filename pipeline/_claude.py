"""Client Anthropic, tarif de Claude Haiku 5.5 et lecture d'une réponse, partagés.

Appelé par `classer_articles.py` (« Ce qui me concerne ») et `traduire_titres.py`
(titres anglais). Un module à part, et non un import de `classer_articles` : celui-ci
s'arrête au chargement quand ses définitions de profils divergent de la page, et la
traduction des titres tombait avec lui (constaté le 2026-10-20).

L'appelant charge `.env.local` avant d'importer ce module : la clé
`ANTHROPIC_API_KEY_DOSSIER_SUMMARIES` est lue à l'import.
"""

from __future__ import annotations

import json
import os

import anthropic

claude = anthropic.Anthropic(api_key=(os.getenv("ANTHROPIC_API_KEY_DOSSIER_SUMMARIES") or "").strip(),
                             max_retries=4, timeout=600)

# Tarifs de Claude Haiku 5.5 en dollars par million de jetons ; au-delà de 100 000
# jetons d'entrée, la requête entière passe au second tarif. Un lot paie la moitié de
# chaque tarif, et une lecture du cache 10 % du tarif d'entrée.
TARIF = {"entree": 0.10, "sortie": 0.50}
TARIF_LONG = {"entree": 0.50, "sortie": 2.50}
SEUIL_LONG = 100_000
REMISE_LOT = 0.5


class ReponseInutilisable(Exception):
    """Réponse inutilisable (tronquée, refusée, hors schéma) : rien n'est écrit."""


def cout(usage, remise: float = 1.0) -> float:
    """Coût d'une réponse en dollars, cache compris."""
    lu = getattr(usage, "cache_read_input_tokens", 0) or 0
    ecrit = getattr(usage, "cache_creation_input_tokens", 0) or 0
    entree = usage.input_tokens + lu + ecrit
    tarif = TARIF_LONG if entree > SEUIL_LONG else TARIF
    total = (usage.input_tokens * tarif["entree"] + ecrit * tarif["entree"] * 1.25 + lu * tarif["entree"] * 0.1
             + usage.output_tokens * tarif["sortie"]) / 1e6
    return round(total * remise, 8)


def lire_reponse(message) -> dict:
    """Le JSON d'une réponse, ou `ReponseInutilisable` si elle est coupée ou refusée."""
    if message.stop_reason != "end_turn":
        raise ReponseInutilisable(f"stop_reason={message.stop_reason}")
    return json.loads(next(b.text for b in message.content if b.type == "text"))
