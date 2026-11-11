"""Verdict du cron nocturne : alerte par email, ou date de fraîcheur en base.

C'est l'étape qui suit `nightly.py` dans le workflow `sync-data-nightly.yml`, et la seule
qui peut le faire échouer. L'orchestrateur lance les imports un par un, dépose le code
de sortie et la durée de chacun dans `$RUNNER_TEMP/nightly/etat`, et sort toujours en 0.
Le bilan tourne dans une étape à part (`if: always()`) pour survivre à un job tué par
son `timeout-minutes` : les étapes qui n'ont rien déposé comptent alors comme échouées.

Deux raisons à cette centralisation :

1. Le 2026-09-06, une coupure réseau sur les amendements a annulé les huit étapes
   suivantes, dont la presse et le score d'activité qui n'en dépendaient pas. Laisser
   chaque étape aller au bout suppose que quelqu'un rende le verdict à la fin.
2. Le badge du site lisait la couleur du workflow GitHub, c'est-à-dire « le processus
   est sorti en 0 », pas « le travail a été fait ». Il a affiché des dates rassurantes
   pendant trois semaines sur des données sénateurs gelées. La date écrite ici n'est
   posée que si toutes les étapes sont passées, et jamais après une relance partielle
   (D-082) : une relance répare des données, elle ne prouve pas que la nuit entière est
   à jour. La liste des étapes attendues vient de `nightly.ETAPES` par import, jamais
   d'un nombre écrit ici : il y en a eu dix-huit, puis vingt-et-une.

Volontairement sans dépendance à `_sync_cache` : ce module ne se connecte à la base
qu'au moment d'écrire la date de fraîcheur, donc une configuration manquante lève là,
après le bilan imprimé, et non à l'import avant toute alerte. `_db` n'ouvre rien à
l'import, il peut être importé sans risque.

Exécuter avec : python bilan_nightly.py (après `nightly.py`, même `RUNNER_TEMP`,
même `ETAPES`).
"""

from __future__ import annotations

import html
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import envoyer_alerte, lire_anomalies  # noqa: E402
from _db import connexion  # noqa: E402
from nightly import dossier_etat, etapes_demandees  # noqa: E402

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# Clé de la ligne unique de `sync_etat` lue par `src/components/LastUpdateBadge.tsx`.
CLE_ETAT = "nightly"

# Étapes dont les compteurs alimentent `activite_elus_mv` : les relancer sans
# `score-activite` laisserait le score calculé sur les valeurs de la veille.
ALIMENTENT_LE_SCORE = {"acteurs", "amendements", "questions", "reunions-an", "senat", "debats"}

# `dossiers`, `textes` et `actes` lisent le même fichier de l'Assemblée, qui peut être
# republié entre deux lancements. Relancer `textes` seul lirait une version plus récente
# que celle des dossiers en base, et ses textes rattachés à un dossier inconnu seraient
# rejetés (constaté le 2026-09-15, à 28 s d'écart entre deux étapes du même run).
LISENT_LES_DOSSIERS = {"textes", "actes"}

# L'empreinte des débats pré-calculée par `cache-debats` lit les interventions et les
# groupes de leurs orateurs : relancer l'une de ces étapes sans lui la laisserait sur
# l'état de la veille.
ALIMENTENT_LE_CACHE_DEBATS = {"acteurs", "senat", "debats"}

# Motifs des lignes qui portent l'erreur dans les journaux des scripts. Ils impriment
# tous des marqueurs distinctifs, c'est ce qui rend l'extrait lisible sans embarquer
# des milliers de lignes de barres de progression.
MOTIF_ERREUR = re.compile(r"❌|🔥|Traceback|Error|Erreur|error:", re.IGNORECASE)

LIGNES_FIN = 15  # lignes de queue jointes à l'extrait, pour le contexte
LIGNES_MAX = 40  # plafond par étape, un traceback complet suffit


def lire_etat(dossier: Path) -> tuple[dict[str, int], dict[str, int]]:
    """Retourne ({id: code de sortie}, {id: durée en secondes}), dans l'ordre d'exécution.

    Chaque ligne s'écrit `<id> <code> <durée>`. Une étape lancée deux fois écrirait deux
    lignes ; la dernière gagne, c'est celle qui reflète l'état final.

    Un fichier absent n'est pas une erreur : l'orchestrateur est mort avant la fin de sa
    première étape. Toutes les étapes attendues comptent alors comme jamais exécutées,
    et l'email part, ce qui est le but.
    """
    fichier = dossier / "etat"
    codes: dict[str, int] = {}
    durees: dict[str, int] = {}
    if not fichier.exists():
        return codes, durees
    for ligne in fichier.read_text(encoding="utf-8").splitlines():
        morceaux = ligne.split()
        if len(morceaux) != 3:
            continue
        codes[morceaux[0]] = int(morceaux[1])
        durees[morceaux[0]] = int(morceaux[2])
    return codes, durees


def commande_de_relance(echecs: dict[str, int]) -> str:
    """Commande `gh` qui relance les seules étapes tombées, prête à copier.

    Ajoute `score-activite` quand une étape qui alimente les compteurs est relancée, et
    `dossiers` quand `textes` ou `actes` l'est, `cache-debats` quand `acteurs`, `senat` ou
    `debats` l'est. Garde l'ordre de `nightly.ETAPES` :
    l'orchestrateur le suit de toute façon, mais une commande écrite dans le même ordre
    que le bilan se relit mieux.
    """
    voulues = set(echecs)
    if voulues & ALIMENTENT_LE_SCORE:
        voulues.add("score-activite")
    if voulues & LISENT_LES_DOSSIERS:
        voulues.add("dossiers")
    if voulues & ALIMENTENT_LE_CACHE_DEBATS:
        voulues.add("cache-debats")
    ordre = [e for e in etapes_demandees("") if e in voulues]
    return f"gh workflow run sync-data-nightly.yml -f etapes={','.join(ordre)}"


def extraire_erreurs(dossier: Path, etape: str) -> list[str]:
    """Lignes d'un journal susceptibles d'expliquer l'échec."""
    journal = dossier / f"{etape}.log"
    if not journal.exists():
        return ["(journal absent)"]

    # `splitlines()` découpe aussi sur les retours chariot, donc chaque réécriture d'une
    # barre tqdm devient une ligne : un seul import en produit des milliers. `%|` est la
    # signature de ces barres et n'apparaît dans aucun message des scripts.
    lignes = [
        ligne
        for ligne in journal.read_text(encoding="utf-8", errors="replace").splitlines()
        if "%|" not in ligne
    ]

    # Les DERNIÈRES correspondances, pas les premières. `MOTIF_ERREUR` attrape aussi des
    # lignes anodines (« Scrutins en erreur : 0 », un ❌ par séance dans les débats) : en
    # gardant le début, un import qui rate cinq cents séances remplissait le plafond de
    # ses cinq cents premiers avertissements et jetait la trace d'appel, qui arrive en
    # fin de journal. L'email ne disait alors rien de la panne.
    correspondances = [ligne for ligne in lignes if MOTIF_ERREUR.search(ligne)]
    retenues = correspondances[-LIGNES_MAX:] + lignes[-LIGNES_FIN:]

    # Dédoublonne en gardant l'ordre : une ligne d'erreur est souvent aussi dans la queue.
    vues: set[str] = set()
    uniques = []
    for ligne in retenues:
        ligne = ligne.strip()
        if ligne and ligne not in vues:
            vues.add(ligne)
            uniques.append(ligne)
    return uniques or ["(aucune ligne d'erreur identifiée)"]


_STYLE_PRE = (
    "background:#f6f6f6;padding:12px;border-radius:6px;"
    "font-size:12px;overflow-x:auto;white-space:pre-wrap"
)


def composer_email(
    echecs: dict[str, int], anomalies: list[str], dossier: Path, lien_run: str,
    partiel: bool,
) -> str:
    blocs = []
    if echecs:
        blocs.append(
            f"<p>{'La relance partielle' if partiel else 'Le cron nocturne'} a terminé avec "
            f"<strong>{len(echecs)} étape(s) en échec</strong>.</p>"
        )
        blocs.append(
            "<p>Pour ne relancer qu'elles (ou « Run workflow » sur GitHub, champ "
            "« etapes ») :</p>"
            f'<pre style="{_STYLE_PRE}">{html.escape(commande_de_relance(echecs))}</pre>'
        )
    if anomalies:
        blocs.append(
            f"<p><strong>{len(anomalies)} anomalie(s)</strong> signalée(s) : des données "
            "que le pipeline ne sait pas lire, et qui reviendront à l'identique tant que "
            "le code ne change pas.</p>"
        )
    blocs.append(f'<p><a href="{lien_run}">Voir le run complet sur GitHub</a></p>')

    for etape, code in echecs.items():
        extrait = "\n".join(extraire_erreurs(dossier, etape))
        blocs.append(
            f"<h3>{html.escape(etape)} (code {code})</h3>"
            f'<pre style="{_STYLE_PRE}">{html.escape(extrait)}</pre>'
        )

    if anomalies:
        blocs.append(
            "<h3>Anomalies</h3>"
            f'<pre style="{_STYLE_PRE}">{html.escape(chr(10).join(anomalies))}</pre>'
        )

    if echecs or partiel:
        blocs.append(
            "<p style=\"color:#666;font-size:12px\">La date de fraîcheur affichée sur le "
            "site n'a pas été mise à jour : elle reste celle de la dernière nuit "
            "entièrement réussie. Une relance partielle répare les données, mais seul un "
            "run complet réussi fait avancer la date.</p>"
        )
    else:
        blocs.append(
            "<p style=\"color:#666;font-size:12px\">La date de fraîcheur a bien été mise "
            "à jour : toutes les étapes ont abouti, le site est à jour à ces anomalies "
            "près.</p>"
        )
    return "\n".join(blocs)


def ecrire_date_fraicheur(run_id: str | None) -> None:
    """Pose la date de la dernière nuit entièrement réussie (ligne `nightly` de `sync_etat`).

    Une connexion ouverte pour cet unique upsert : le bilan ne touche la base qu'ici.
    """
    maintenant = datetime.now(timezone.utc)
    with connexion() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO sync_etat (cle, derniere_reussite, run_id, updated_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (cle) DO UPDATE SET
              derniere_reussite = excluded.derniere_reussite,
              run_id = excluded.run_id,
              updated_at = excluded.updated_at
            """,
            (CLE_ETAT, maintenant, int(run_id) if run_id and run_id.isdigit() else None, maintenant),
        )


def main() -> int:
    dossier = dossier_etat()
    depot = os.getenv("GITHUB_REPOSITORY", "loiclair/LoiClair")
    run_id = os.getenv("GITHUB_RUN_ID")
    lien_run = f"https://github.com/{depot}/actions/runs/{run_id}" if run_id else "(run local)"

    # Même sélection que l'orchestrateur, lue dans la même variable. Un id inconnu y a
    # déjà arrêté l'orchestrateur avant la première étape : on le redit et on sort.
    try:
        attendues = etapes_demandees()
    except ValueError as e:
        print(f"❌ {e}")
        return 1
    partiel = len(attendues) < len(etapes_demandees(""))

    etat, durees = lire_etat(dossier)
    echecs = {etape: code for etape, code in etat.items() if code != 0}

    # Une étape qui n'a rien déposé n'a pas tourné : job tué par `timeout-minutes`,
    # annulé, ou orchestrateur mort en route. Elle compte comme un échec, sinon un run
    # amputé passerait pour une nuit entièrement réussie.
    manquantes = [e for e in attendues if e not in etat]
    for etape in manquantes:
        echecs[etape] = -1

    anomalies = lire_anomalies()

    total = len(etat) + len(manquantes)
    titre = "RELANCE PARTIELLE" if partiel else "BILAN DE LA NUIT"
    print("=" * 60)
    print(f"   {titre} — {total - len(echecs)}/{total} étapes passées")
    print("=" * 60)
    # La durée de chaque étape s'affiche ici parce que l'interface GitHub ne la montre
    # plus : toutes les étapes tiennent dans le seul pas `nightly.py`.
    for etape, code in etat.items():
        print(
            f"   {'✅' if code == 0 else '❌'} {etape:<20} {durees.get(etape, 0):>5} s"
            + ("" if code == 0 else f"  (code {code})")
        )
    for etape in manquantes:
        print(f"   ❌ {etape:<20}     -    (jamais exécutée)")
    print(f"   {'total':<23} {sum(durees.values()):>5} s")
    for ligne in anomalies:
        print(f"   ⚠️  anomalie : {ligne}")

    # La date n'avance que si toutes les étapes d'un run complet ont abouti. Les
    # anomalies ne l'en empêchent pas : elles disent qu'un enregistrement est illisible,
    # pas que le site est en retard, et geler la date pour ça la rendrait fausse dans
    # l'autre sens. Une relance partielle ne la fait jamais avancer (D-082).
    if partiel and not echecs:
        print("\n✅ Relance réussie. Date de fraîcheur inchangée : seul un run complet la fait avancer.")
    elif not echecs:
        ecrire_date_fraicheur(run_id)
        print("\n✅ Toutes les étapes sont passées, date de fraîcheur mise à jour.")

    if not echecs and not anomalies:
        return 0

    if echecs:
        sujet = (
            f"[LoiClair] {'Relance partielle' if partiel else 'Cron nocturne'} : "
            f"{len(echecs)} étape(s) en échec"
        )
    else:
        sujet = f"[LoiClair] Cron nocturne : {len(anomalies)} anomalie(s) à corriger"

    try:
        envoyer_alerte(sujet, composer_email(echecs, anomalies, dossier, lien_run, partiel))
        print(f"\n📧 Alerte envoyée : {sujet}")
    except Exception as e:
        # On ne masque pas l'échec initial derrière celui de l'email : le job tombe en
        # rouge dans les deux cas.
        print(f"\n⚠️  Alerte NON envoyée ({type(e).__name__}: {e})")

    if echecs:
        print(f"\n❌ Étapes en échec : {', '.join(echecs)}")
        print(f"   Relance : {commande_de_relance(echecs)}")
    # Sortie en 1 même sans étape en échec : le job rouge signale qu'il y a à faire.
    # La couleur du run et la fraîcheur des données sont deux questions distinctes,
    # c'est tout l'objet de ce travail.
    return 1


if __name__ == "__main__":
    sys.exit(main())
