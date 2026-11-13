"""Orchestrateur du cron de données : lance les imports dans l'ordre, un par un.

Appelé par `.github/workflows/sync-data-nightly.yml`, dont c'est l'étape de travail. Le
verdict (email, date de fraîcheur) est rendu ensuite par `bilan_nightly.py`, dans une
étape séparée du workflow : si ce job-ci est tué par `timeout-minutes`, le bilan tourne
quand même et compte comme échouées les étapes qui n'ont rien déposé.

Il remplace vingt étapes YAML identiques (une par script, chacune avec son
`continue-on-error` et son appel à `etape.sh`). La liste des étapes vit ici, dans
`ETAPES`, et nulle part ailleurs : le bilan la lit par import.

Pour chaque étape :
- la sortie s'affiche dans un bloc repliable `::group::` de l'interface GitHub, et
  s'archive dans `$RUNNER_TEMP/nightly/<id>.log`, que le bilan cite dans l'email ;
- son code de sortie et sa durée s'ajoutent à `$RUNNER_TEMP/nightly/etat` ;
- un échec n'arrête pas les suivantes : le 2026-09-06, une coupure réseau sur les
  amendements avait annulé huit étapes qui n'en dépendaient pas.

Usage :
    python nightly.py                          # toutes les étapes
    python nightly.py --etapes senat,questions # relance des seules étapes nommées
    python nightly.py --verif-complete         # vérifications hebdomadaires forcées

Les deux options se lisent aussi dans `ETAPES` et `VERIF_COMPLETE`, que le workflow
remplit depuis le formulaire « Run workflow ».
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

RACINE = Path(__file__).resolve().parent

# (id, arguments passés à l'interpréteur Python). L'id nomme le journal et la ligne
# d'état, et l'email d'alerte le cite tel quel : il doit rester stable.
#
# L'ordre porte des dépendances :
# - `wikipedia`, `hatvp`, `transparence-an` et `transparence-senat` rattachent leurs
#   lignes aux acteurs que `acteurs` vient d'écrire ;
# - `debats` lit `num_notice` (écrit par `textes`) et `lien_senat` (écrit par
#   `senat`). Si l'une des deux tombe, elle importe simplement moins de séances ;
# - `cache-debats` calcule sur les interventions écrites par `debats` et sur les groupes
#   écrits par `acteurs` et `senat`. S'il échoue après `debats`, la fiche et la
#   route lisent les lignes de la veille (orateurs et synthèse des débats en retard de
#   24 h par nuit ratée, l'alerte du bilan le signale) ; le calcul d'origine ne sert
#   qu'aux dossiers sans ligne ;
# - `score-activite` recalcule sur les compteurs écrits par `amendements`,
#   `questions`, `reunions-an`, `senat` et `debats`. Si l'un d'eux a échoué, le score
#   repart des valeurs de la veille ;
# - `traduire-titres` traduit les titres que `dossiers` et `senat` viennent d'écrire ;
#   ceux des lois, écrits par `application-lois` plus bas, la nuit suivante ;
# - `search-summaries` résume les textes que les étapes précédentes ont importés ;
# - `decouper-textes` lit les dossiers, les textes et la loi Légifrance écrits par
#   `dossiers`, `textes`, `legifrance` et `application-lois` (statut « Appliquée ») ;
#   `classer-impacts` classe ses articles et les amendements écrits par `amendements`.
# - `exposes` lit le premier texte déposé de chaque dossier dans les textes écrits par
#   `textes` et `senat` (adresse et page accessible), pour les dossiers écrits par
#   `dossiers`. Un dépôt du jour a son exposé la nuit même, s'il est déjà en ligne.
# - `elections` rattache à leur élection les parlementaires que `acteurs` et `senat`
#   viennent d'écrire : un suppléant ou un suivant de liste entré dans la journée a sa
#   ligne la nuit même.
ETAPES: list[tuple[str, list[str]]] = [
    ("acteurs", ["import_acteurs_organes_cloud.py"]),
    ("wikipedia", ["enrich_wikipedia_acteurs.py"]),
    ("dossiers", ["import_dossiers_cloud.py"]),
    ("textes", ["import_textes_cloud.py"]),
    ("actes", ["import_actes_legislatifs_cloud.py"]),
    ("scrutins", ["import_scrutins_cloud.py"]),
    ("reunions-an", ["import_reunions_an.py"]),
    ("senat", ["sync_senat.py"]),
    ("elections", ["import_elections.py"]),
    # Après `dossiers` et `senat`, les deux qui écrivent `titre` : un dossier déposé ou
    # renommé dans la journée a son titre anglais la nuit même. Traduit aussi les titres
    # des lois de `application_lois`, que `application-lois` écrit plus bas : une loi
    # nouvelle attend donc la nuit suivante.
    ("traduire-titres", ["traduire_titres.py"]),
    ("amendements", ["import_amendements.py"]),
    ("questions", ["import_questions.py"]),
    ("debats", ["-m", "debats.import_debats"]),
    # Pré-calcule orateurs et empreinte des débats de chaque dossier, que la fiche lit en
    # une ligne. Après `debats`, et donc après `acteurs` et `senat` dont les groupes
    # entrent dans l'empreinte.
    ("cache-debats", ["refresh_dossier_debats_cache.py"]),
    ("legifrance", ["import_legifrance_cloud.py"]),
    ("application-lois", ["import_application_lois.py"]),
    # 40 pages au plus (environ 2 minutes, l'Assemblée exigeant 2,5 s entre deux) : une
    # nuit ordinaire en lit moins de dix, le reste attend la nuit suivante.
    ("decouper-textes", ["decouper_textes.py", "--limite", "40"]),
    # Exposé des motifs du premier texte déposé. 40 pages au plus, comme ci-dessus : une
    # nuit ordinaire n'a que les dépôts du jour, et la passe initiale s'est faite à la main.
    ("exposes", ["importer_exposes.py", "--limite", "40"]),
    # Récupère les lots rendus depuis la veille, puis envoie les éléments nouveaux : un
    # texte déposé apparaît sur « Ce qui me concerne » une à deux nuits après.
    ("classer-impacts", ["classer_articles.py", "--lots", "--plafond", "2000"]),
    ("presse", ["import_articles_presse.py"]),
    ("hatvp", ["import_hatvp.py"]),
    ("transparence-an", ["import_transparence_an.py"]),
    ("transparence-senat", ["import_transparence_senat.py"]),
    ("score-activite", ["refresh_activite_scores.py"]),
    ("cc-decisions", ["import_cc_decisions.py"]),
    # 250 fiches au plus (~35 minutes à ~8 s la fiche), sous la coupure de 45 minutes :
    # une nuit qui en apporte davantage, ou un rattrapage inachevé, finit les nuits suivantes.
    ("search-summaries", ["generate_search_summaries.py", "--limit", "250"]),
]

# Jour des vérifications hebdomadaires (lundi, `isoweekday() == 1`). Les scripts ne
# connaissent pas ce jour : ils lisent seulement `VERIF_COMPLETE`, posé ici.
JOUR_VERIFICATION = 1

# Durée maximale d'une étape, en secondes. Au-delà, elle est arrêtée et comptée en échec
# (code -9 au bilan), pour qu'un téléchargement bloqué ne prive pas les suivantes de leur
# passage. 45 minutes laissent passer les plus longues observées : `sync_senat.py` peut
# attendre 20 minutes le vrai dump des sénateurs, et `generate_search_summaries.py` a
# duré 43 minutes le 2026-09-13 en rattrapant 297 résumés ; il est désormais plafonné
# à 250 fiches par nuit et les écrit une par une.
DUREE_MAX_ETAPE = 45 * 60


def dossier_etat() -> Path:
    """Dossier des journaux et du fichier d'état, partagé avec `bilan_nightly.py`."""
    return Path(os.getenv("RUNNER_TEMP", "/tmp")) / "nightly"


def etapes_demandees(liste: str | None = None) -> list[str]:
    """Ids à lancer, dans l'ordre de `ETAPES`.

    `liste` vaut `"senat,questions"`, ou vide pour tout lancer. Sans argument, elle se
    lit dans `ETAPES`, ce qui permet au bilan de retrouver la même sélection que
    l'orchestrateur. Un id inconnu lève avant que quoi que ce soit ne tourne : une
    faute de frappe ne doit pas donner une relance vide qui passerait pour réussie.
    """
    if liste is None:
        liste = os.getenv("ETAPES", "")
    tous = [id_ for id_, _ in ETAPES]
    voulus = {morceau.strip() for morceau in liste.split(",") if morceau.strip()}
    if not voulus:
        return tous
    inconnus = sorted(voulus - set(tous))
    if inconnus:
        raise ValueError(
            f"Étape(s) inconnue(s) : {', '.join(inconnus)}. Connues : {', '.join(tous)}"
        )
    return [id_ for id_ in tous if id_ in voulus]


def lancer(id_: str, arguments: list[str], dossier: Path, env: dict[str, str]) -> tuple[int, float]:
    """Exécute une étape, recopie sa sortie à l'écran et dans son journal.

    La sortie est lue par blocs et non par lignes : les barres tqdm se réécrivent avec
    des retours chariot, sans saut de ligne, et une lecture ligne à ligne les
    retiendrait jusqu'à la fin de la barre. Le journal s'écrit en binaire pour ne pas
    couper un caractère accentué à cheval sur deux blocs ; le bilan le relit en
    `errors="replace"`.

    Un minuteur tue le sous-processus au bout de `DUREE_MAX_ETAPE` : la lecture de sa
    sortie se termine alors d'elle-même, le tube étant fermé.
    """
    print(f"::group::{id_}", flush=True)
    debut = time.monotonic()
    with (dossier / f"{id_}.log").open("wb") as journal:
        processus = subprocess.Popen(
            [sys.executable, *arguments],
            cwd=RACINE,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        assert processus.stdout is not None
        minuteur = threading.Timer(DUREE_MAX_ETAPE, processus.kill)
        minuteur.start()
        try:
            while bloc := processus.stdout.read1(65536):
                sys.stdout.buffer.write(bloc)
                sys.stdout.flush()
                journal.write(bloc)
            code = processus.wait()
        finally:
            minuteur.cancel()
        if code == -9:
            message = f"\n❌ Étape arrêtée au bout de {DUREE_MAX_ETAPE // 60} minutes.\n"
            print(message, flush=True)
            journal.write(message.encode("utf-8"))
    duree = time.monotonic() - debut
    print("::endgroup::", flush=True)
    return code, duree


def main() -> int:
    """Lance les étapes demandées une à une et dépose leur verdict pour le bilan.

    Rend 2 sur un id d'étape inconnu, avant toute exécution ; 0 dans tous les autres
    cas, y compris quand une étape échoue.
    """
    parser = argparse.ArgumentParser(description="Lance les imports du cron de données.")
    parser.add_argument("--etapes", default=os.getenv("ETAPES", ""),
                        help="Ids séparés par des virgules. Vide : toutes les étapes.")
    parser.add_argument("--verif-complete", action="store_true",
                        default=bool(os.getenv("VERIF_COMPLETE")),
                        help="Force les vérifications hebdomadaires, quel que soit le jour.")
    args = parser.parse_args()

    try:
        ids = etapes_demandees(args.etapes)
    except ValueError as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2

    dossier = dossier_etat()
    dossier.mkdir(parents=True, exist_ok=True)
    # Sur GitHub, `RUNNER_TEMP` est vidé à chaque job. En local, le dossier retombe sur
    # `/tmp/nightly` et garde les lignes du lancement précédent : une étape morte cette
    # fois-ci y paraîtrait réussie, et le bilan pourrait inscrire la date de fraîcheur
    # en base sur la foi d'un ancien run. On repart donc d'un état vide.
    for fichier in ("etat", "anomalies"):
        (dossier / fichier).unlink(missing_ok=True)

    env = dict(os.environ)
    # Le bilan relit `ETAPES` pour savoir quelles étapes attendre : on la pose même
    # quand la sélection vient de la ligne de commande.
    env["ETAPES"] = args.etapes
    verif = args.verif_complete or datetime.now(timezone.utc).isoweekday() == JOUR_VERIFICATION
    if verif:
        env["VERIF_COMPLETE"] = "1"
    else:
        env.pop("VERIF_COMPLETE", None)
    # Sans ça, les `print` des scripts restent en mémoire tampon et arrivent par paquets
    # dans le journal, avec des horodatages faux.
    env["PYTHONUNBUFFERED"] = "1"

    print(f"▶ {len(ids)} étape(s) : {', '.join(ids)}")
    print(f"▶ Vérifications hebdomadaires : {'oui' if verif else 'non'}\n", flush=True)

    commandes = dict(ETAPES)
    for id_ in ids:
        code, duree = lancer(id_, commandes[id_], dossier, env)
        with (dossier / "etat").open("a", encoding="utf-8") as etat:
            etat.write(f"{id_} {code} {duree:.0f}\n")
        print(f"{'✅' if code == 0 else '❌'} {id_} ({duree:.0f} s)", flush=True)

    # Le verdict appartient au bilan : l'orchestrateur sort en 0 même si une étape a
    # échoué, pour que la couleur du job ne raconte qu'une seule chose.
    return 0


if __name__ == "__main__":
    sys.exit(main())
