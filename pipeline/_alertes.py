"""Envoi des alertes ops par email, via Resend.

Module partagé plutôt que copie locale : la fonction existait en double, à l'identique,
dans `generate_search_summaries.py` et `select_quiz_scrutins.py`.

Aucune dépendance à `_sync_cache` ni à `_db` ici, volontairement : une alerte doit
pouvoir partir même quand la base est injoignable ou la configuration incomplète, c'est
justement un des cas où elle est utile.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import requests

EXPEDITEUR = "LoiClair System <newsletter@loiclair.fr>"
DESTINATAIRE = "contact@loiclair.fr"
TIMEOUT = 15
ESSAIS = 3


def _fichier_anomalies() -> Path:
    dossier = Path(os.getenv("RUNNER_TEMP", "/tmp")) / "nightly"
    dossier.mkdir(parents=True, exist_ok=True)
    return dossier / "anomalies"


def signaler_anomalie(source: str, message: str) -> None:
    """Signale une panne durable, sans faire échouer l'appelant.

    Deux gravités coexistent dans le cron, parce que deux pannes très différentes s'y
    produisent.

    Une panne **passagère** (une écriture en base perdue, une exception sur un import
    entier) mérite un réessai : l'appelant sort en 1, son cache HTTP n'est pas confirmé,
    la date de fraîcheur n'avance pas, et la nuit suivante retente.

    Une panne **durable** est d'une autre nature : un enregistrement de la source qu'on
    ne sait pas lire échouera à l'identique chaque nuit jusqu'à ce que le code change.
    C'est le cas du projet de loi de finances pour 2027, absent du site pendant des
    semaines. La traiter comme un blocage ferait retélécharger 200 Mo tous les soirs
    pour rien, et gèlerait la date affichée alors que le site est à jour à un
    enregistrement près. Elle passe donc par ici : l'email part chaque nuit jusqu'à
    correction, le cache avance, la date reste juste.

    Best-effort par construction : ne jamais interrompre un import pour un signalement
    qui n'a pas pu s'écrire.
    """
    ligne = f"{source}\t{message}".replace("\n", " ")
    print(f"   ⚠️  Anomalie signalée : {ligne}")
    try:
        with _fichier_anomalies().open("a", encoding="utf-8") as f:
            f.write(ligne + "\n")
    except OSError as e:
        print(f"   ⚠️  Anomalie non enregistrée : {e}")


def lire_anomalies() -> list[str]:
    """Anomalies déposées par les étapes de la nuit, pour le bilan."""
    fichier = _fichier_anomalies()
    if not fichier.exists():
        return []
    return [l for l in fichier.read_text(encoding="utf-8").splitlines() if l.strip()]


def envoyer_alerte(sujet: str, html: str) -> None:
    """Envoie une alerte et lève si elle n'est pas partie.

    L'ancienne version avalait tout : pas de clé, une exception réseau, et surtout un
    4xx de Resend, qui passait inaperçu puisque le code HTTP n'était jamais regardé.
    Surveiller des pannes silencieuses avec un outil capable d'échouer en silence ne
    protège de rien, d'où le `raise_for_status()` et la remontée à l'appelant.

    Les appelants qui ne doivent pas s'interrompre pour un email raté utilisent
    `envoyer_alerte_best_effort`.
    """
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        raise RuntimeError("RESEND_API_KEY manquant — alerte email non envoyée.")

    # Trois essais sur une panne de Resend (5xx, 429) ou du réseau : le 2026-09-16, un
    # 520 isolé a fait perdre l'alerte d'un run en échec. Un autre 4xx (clé refusée,
    # adresse invalide) ne passera pas mieux au deuxième essai et lève tout de suite.
    for essai in range(1, ESSAIS + 1):
        try:
            reponse = requests.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "from": EXPEDITEUR,
                    "to": DESTINATAIRE,
                    "subject": sujet,
                    "html": html,
                },
                timeout=TIMEOUT,
            )
            if reponse.status_code < 500 and reponse.status_code != 429:
                reponse.raise_for_status()
                return
            erreur: Exception = requests.HTTPError(f"{reponse.status_code} de Resend")
        except requests.RequestException as e:
            if isinstance(e, requests.HTTPError):
                raise
            erreur = e
        if essai == ESSAIS:
            raise erreur
        print(f"  ⚠️  Envoi de l'alerte : {erreur}, nouvel essai dans {5 * essai} s")
        time.sleep(5 * essai)


def envoyer_alerte_best_effort(sujet: str, html: str) -> None:
    """Variante qui journalise au lieu de lever.

    Pour les scripts dont l'alerte accompagne un `sys.exit(1)` déjà décidé : l'échec de
    l'email ne doit pas masquer l'erreur qu'on cherchait à signaler.
    """
    try:
        envoyer_alerte(sujet, html)
    except Exception as e:
        print(f"  ⚠️  Échec envoi alerte email : {e}")
