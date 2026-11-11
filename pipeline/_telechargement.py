"""Téléchargement des gros dumps, avec reprise là où la connexion a lâché.

Les sources officielles publient des archives de plusieurs centaines de mégaoctets, et
sur cette durée la connexion lâche régulièrement en plein transfert : `requests` remonte
alors un `ChunkedEncodingError(IncompleteRead)` et la tentative est perdue.

Constaté le 2026-09-06 sur l'archive des amendements de l'Assemblée (296 Mo) : trois
coupures dans la journée, à 15 Mo, 2,8 Mo et 15 Mo, chacune faisant échouer tout
l'import nocturne. Or le cron télécharge plus gros encore, `cri.zip` du Sénat pesant
519 Mo.

Quatre idées, et une seule implémentation partagée parce qu'il y en avait quatre
divergentes avant :

1. **Reprendre plutôt que recommencer.** Les serveurs de l'Assemblée et du Sénat
   annoncent `Accept-Ranges: bytes`, on ne redemande donc que les octets manquants.
2. **Compter les essais sans progrès, pas les essais.** Un budget fixe ne suffit pas
   quand la coupure tombe tôt : cinq essais sur un fichier qui casse tous les 3 Mo ne
   rapportent que 15 Mo. Tout octet gagné remet le budget à neuf, et ce qui arrête la
   boucle est l'absence de progression.
3. **Vérifier que les octets recollés viennent du même fichier.** Une reprise se fait
   sous `If-Range`, et l'assemblage final est confronté à la taille annoncée. Sans ça,
   une source qui republie entre deux tentatives fait coller la fin du nouveau fichier
   à la tête de l'ancien : une archive plausible au contenu faux, exactement la panne
   que ce module existe pour éviter. Le Sénat republie deux fois par jour, et
   `sync_senat` réessaie exprès sur vingt minutes à cheval sur sa régénération.
4. **Ne réessayer que ce qui vaut d'être réessayé.** Une coupure, un délai dépassé ou
   un 5xx méritent de la patience. Un 404 n'en mérite aucune : les URL des dumps
   portent le numéro de législature en dur, et le jour où il changera, mieux vaut
   échouer en quelques secondes qu'après huit minutes de sommeil par fichier.
5. **Borner la durée totale, pas seulement chaque essai.** Le `timeout` de `requests`
   mesure un silence entre deux lectures, pas une durée : un serveur qui se tait
   coûte ce délai à chaque essai. Voir `DUREE_MAX_TELECHARGEMENT`.

Aucune dépendance à la base ici, volontairement : un script n'ayant besoin que de
télécharger doit pouvoir démarrer sans configuration Postgres.
"""

from __future__ import annotations

import re
import time

import requests

ESSAIS_MAX = 60  # plafond global, pour borner la durée du job
ATTENTE_APRES_PROGRES = 2  # la connexion vient de marcher, inutile d'attendre

# Patience face à un serveur qui accepte le `Range` puis ne délivre rien. Constaté le
# 2026-09-07 sur l'archive des amendements (run 34073577020) : reprise correcte à
# 26 Mo, puis trois `IncompleteRead(0 bytes read)` d'affilée. Trois essais espacés de
# 10, 30 et 60 secondes ne laissaient que cent secondes au serveur pour se remettre,
# alors qu'un run trois heures plus tôt avait téléchargé les 283 Mo sans broncher.
# Cinq essais jusqu'à cinq minutes portent l'attente à environ huit minutes, pour un
# job qui en a cent vingt.
#
# Arithmétique à ne pas perdre de vue : N essais stériles ménagent N-1 intervalles.
# `ATTENTES_STERILES` doit donc compter exactement `STERILES_MAX - 1` entrées, sinon la
# dernière est inatteignable. Total de patience ici : 10+30+60+120+300, soit 8 min 40.
#
# Cette patience reste soumise à `DUREE_MAX_TELECHARGEMENT` : une attente qui ne tient
# plus dans le budget restant fait abandonner l'appel. Les dernières attentes ne sont
# donc atteintes que si la série stérile commence tôt dans le téléchargement.
STERILES_MAX = 6  # essais consécutifs sans un octet de plus
ATTENTES_STERILES = (10, 30, 60, 120, 300)
# Le dépassement de `DUREE_MAX_TELECHARGEMENT` ne se contrôle qu'entre deux morceaux, et
# urllib3 ne rend un morceau qu'une fois rempli : à 1 Ko/s, un morceau d'un mégaoctet
# aurait laissé filer dix-sept minutes au-delà de la borne. 64 Ko le ramènent à une.
TAILLE_MORCEAU = 64 * 1024

assert len(ATTENTES_STERILES) == STERILES_MAX - 1, "un délai serait inatteignable"

# Durée maximale d'un appel à `telecharger`, reprises et attentes comprises. Le
# 2026-10-12 (run 38290506278), l'Assemblée a laissé l'archive des amendements muette
# à répétition : chaque silence pouvait durer les 600 secondes du `timeout` de
# l'appelant avant de lever, la progression intermittente remettait le budget d'essais
# stériles à neuf, et l'étape a atteint sa borne de 45 minutes dans `nightly.py`. Le job
# a ensuite été tué avant les huit étapes suivantes. Quinze minutes, c'est près du
# double du plus long téléchargement observé (`cri.zip` du Sénat, 520 Mo en 7 à
# 8 minutes, le 2026-10-11 comme le 2026-10-12) : une source en panne échoue sans
# priver les autres.
DUREE_MAX_TELECHARGEMENT = 15 * 60

# Silence toléré entre deux lectures, valeur par défaut du `timeout` de `telecharger`.
# Toutes les archives du cron sont des fichiers statiques : le 2026-10-13, les sept
# plus grosses de l'Assemblée et du Sénat rendaient leur premier octet en moins d'une
# seconde et demie, et toutes annonçaient `Accept-Ranges: bytes`. Deux minutes sans un
# octet signalent donc une connexion morte, et lever ne coûte qu'une reprise sous
# `Range`. Les 600 à 3 600 secondes d'avant faisaient au contraire durer chaque silence,
# au point qu'un seul pouvait consumer tout `DUREE_MAX_TELECHARGEMENT` sans reprise.
SILENCE_MAX = 120

# Attentes avant chaque nouvel essai de `recuperer`, donc deux reprises après le premier
# échec. Courtes, parce que ces ressources se redemandent en quelques secondes et que
# `transparence-an` enchaîne des dizaines de pages : au pire, une page vraiment en panne
# coûte 35 secondes de plus, et deux délais d'attente réseau de plus, avant d'échouer.
ATTENTES_RECUPERER = (5, 30)

# `Content-Range: bytes 26-295/296` — seul le dernier nombre est la taille totale.
_CONTENT_RANGE = re.compile(r"bytes\s+\d+-\d+/(\d+)")

# Erreurs de transport, par nature passagères. `Timeout` couvre les délais de connexion
# comme de lecture, `ConnectionError` couvre la coupure en plein transfert.
_TRANSITOIRES = (
    requests.exceptions.ChunkedEncodingError,
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
)


class TelechargementIncomplet(requests.exceptions.RequestException):
    """Le corps assemblé ne fait pas la taille que la source annonçait."""


class TelechargementTropLong(requests.exceptions.RequestException):
    """`DUREE_MAX_TELECHARGEMENT` est dépassée. N'est jamais réessayée : sans `response`
    et hors des erreurs transitoires, `_vaut_un_reessai` la rend telle quelle."""


def _vaut_un_reessai(e: Exception) -> bool:
    """Un 404 ou un 403 ne s'arrangera pas en dormant ; un 503 peut-être."""
    if isinstance(e, _TRANSITOIRES) or isinstance(e, TelechargementIncomplet):
        return True
    reponse = getattr(e, "response", None)
    if reponse is None:
        return False
    return reponse.status_code >= 500 or reponse.status_code == 429


def _validateur(reponse: requests.Response) -> str | None:
    """Étiquette de version d'une ressource, à renvoyer en `If-Range`."""
    return reponse.headers.get("ETag") or reponse.headers.get("Last-Modified")


def recuperer(
    url: str,
    *,
    timeout: int,
    entetes: dict[str, str] | None = None,
    attentes: tuple[int, ...] = ATTENTES_RECUPERER,
) -> bytes:
    """GET d'une ressource légère, avec contrôle de la taille annoncée et reprises.

    `telecharger` vise les archives de plusieurs centaines de mégaoctets et leur
    reprise sous `If-Range` ; ici il s'agit d'une page HTML, d'un index CSV ou d'un PDF
    de quelques mégaoctets, qu'on redemande en entier. Ce qui manque à un `requests.get`
    nu est le contrôle de taille : le 2026-09-11, `liste.csv` de la HATVP est revenu en
    HTTP 200 avec 2 727 802 octets sur les 3 447 738 annoncés, sans lever quoi que ce
    soit. Un index tronqué se lit parfaitement et fait disparaître en silence tout ce
    qui suit la coupure.

    Les reprises existent parce qu'une étape en échec gèle la date de fraîcheur du site
    entier jusqu'à la prochaine nuit complète (D-127) : le 2026-10-07, un seul 500 de
    l'Assemblée sur la première page des dons (run 37647904853) a fait échouer
    `transparence-an`, alors que la même page répondait normalement peu après. Seules
    les erreurs passagères sont reprises, selon `_vaut_un_reessai` ; un 404 échoue
    tout de suite.

    `attentes=()` supprime les reprises. C'est le choix d'un appelant qui boucle sur
    des centaines de ressources dont chaque échec est déjà rattrapé la nuit suivante
    (`import_hatvp`, une déclaration par XML) : sans ça, une source qui répond vite en
    503 coûterait 35 secondes par ressource et pousserait l'étape vers sa borne de
    45 minutes, transformant un trou signalé en étape en échec.
    """
    for attente in attentes:
        try:
            return _recuperer_une_fois(url, timeout=timeout, entetes=entetes)
        except requests.RequestException as e:
            if not _vaut_un_reessai(e):
                raise
            print(f"   ⚠️  {url} : {type(e).__name__}, nouvel essai dans {attente}s")
            time.sleep(attente)
    return _recuperer_une_fois(url, timeout=timeout, entetes=entetes)


def _recuperer_une_fois(url: str, *, timeout: int, entetes: dict[str, str] | None) -> bytes:
    """Un essai de `recuperer`, qui lève sur un statut d'erreur ou un corps tronqué."""
    reponse = requests.get(url, timeout=timeout, headers=entetes or {})
    reponse.raise_for_status()

    # `Content-Length` compte les octets du transport. Si la source a compressé, il ne
    # décrit plus le corps décompressé que rend `.content`, et la comparaison ferait
    # échouer un téléchargement parfait : on ne contrôle que le cas non compressé.
    encodage = reponse.headers.get("Content-Encoding", "").strip().lower()
    annoncee = reponse.headers.get("Content-Length")
    if encodage in ("", "identity") and annoncee and annoncee.isdigit():
        if len(reponse.content) != int(annoncee):
            raise TelechargementIncomplet(
                f"{len(reponse.content)} octets reçus pour {annoncee} annoncés sur {url}"
            )
    return reponse.content


def telecharger(
    url: str,
    *,
    timeout: float = SILENCE_MAX,
    duree_max: float = DUREE_MAX_TELECHARGEMENT,
) -> bytes:
    """Télécharge une ressource entière en mémoire, en reprenant après une coupure.

    Ne juge pas de la plausibilité du contenu : c'est l'affaire de l'appelant, dont les
    délais d'attente n'ont rien à voir. `sync_senat` doit par exemple espacer ses essais
    de dix minutes pour laisser au Sénat le temps de finir de régénérer son dump, là où
    la reprise réseau ci-dessous se compte en secondes. Le budget `duree_max` vaut donc
    pour un appel, pas pour l'ensemble des essais de l'appelant.

    `timeout` est le silence toléré entre deux lectures ; `duree_max` borne l'appel
    entier et lève `TelechargementTropLong` au-delà. Le corps est réassemblé en
    mémoire : les appelants ont besoin de l'archive complète, et `zipfile` lit son
    index en fin de fichier.
    """
    recu = bytearray()
    steriles = 0
    derniere: Exception | None = None
    validateur: str | None = None  # version de la ressource, pour le `If-Range`
    total: int | None = None  # taille annoncée par la source
    debut = time.monotonic()

    def restant() -> float:
        return duree_max - (time.monotonic() - debut)

    def trop_long() -> TelechargementTropLong:
        # La durée écoulée, pas `duree_max` : l'abandon peut tomber avant la borne,
        # quand l'attente prévue avant la reprise suivante ne tient plus dans le budget.
        cause = f", dernière erreur : {type(derniere).__name__}" if derniere else ""
        ecoule = (time.monotonic() - debut) / 60
        return TelechargementTropLong(
            f"abandon au bout de {ecoule:.0f} min (borne : {duree_max / 60:.0f}) sur "
            f"{url} ({len(recu) / 1024 / 1024:.1f} Mo reçus{cause})"
        )

    for _ in range(ESSAIS_MAX):
        avant = len(recu)
        try:
            if restant() <= 0:
                raise trop_long()
            # Un silence ne doit pas pouvoir déborder du budget : le délai de lecture
            # de cet essai ne dépasse jamais ce qu'il en reste.
            delai = min(timeout, max(restant(), 1))
            entetes = {}
            if avant:
                entetes["Range"] = f"bytes={avant}-"
                if validateur:
                    # Le serveur ne servira un 206 que si la ressource n'a pas bougé.
                    entetes["If-Range"] = validateur

            with requests.get(url, timeout=delai, stream=True, headers=entetes) as reponse:
                reponse.raise_for_status()

                if reponse.status_code == 206:
                    trouve = _CONTENT_RANGE.search(reponse.headers.get("Content-Range", ""))
                    if trouve:
                        total = int(trouve.group(1))
                else:
                    # Un 200 en réponse à un `Range` signale soit un serveur qui
                    # l'ignore, soit une ressource qui a changé : dans les deux cas le
                    # corps repart de zéro et concaténer donnerait une archive
                    # corrompue. On repart aussi du bon pied pour le compte de progrès,
                    # sans quoi un téléchargement relancé qui avance vraiment serait
                    # jugé stérile face à l'ancien maximum.
                    if avant:
                        recu.clear()
                        avant = 0
                        steriles = 0
                    validateur = _validateur(reponse)
                    annoncee = reponse.headers.get("Content-Length")
                    total = int(annoncee) if annoncee and annoncee.isdigit() else None

                for morceau in reponse.iter_content(chunk_size=TAILLE_MORCEAU):
                    recu.extend(morceau)
                    # Un transfert qui avance au compte-gouttes ne se tait jamais assez
                    # longtemps pour que `delai` le coupe. Le contrôle ne tombe qu'entre
                    # deux morceaux, d'où leur taille modeste. Un corps déjà complet ne
                    # se jette pas pour quelques secondes de retard sur la borne.
                    if restant() <= 0 and (total is None or len(recu) < total):
                        raise trop_long()

                # Sur un 200, urllib3 compare déjà le corps au `Content-Length` et lève
                # de lui-même. Ce contrôle sert au cas de la reprise : sur un 206, il
                # ne voit que la portion restante, et rien ne vérifierait que le
                # recollage fait bien la taille totale annoncée en `Content-Range`.
                if total is not None and len(recu) != total:
                    raise TelechargementIncomplet(
                        f"{len(recu)} octets assemblés pour {total} annoncés"
                    )
                return bytes(recu)
        except requests.RequestException as e:
            if not _vaut_un_reessai(e):
                raise
            derniere = e

        if len(recu) > avant:
            steriles = 0
            attente = ATTENTE_APRES_PROGRES
        else:
            steriles += 1
            if steriles >= STERILES_MAX:
                raise derniere
            attente = ATTENTES_STERILES[steriles - 1]

        # Dormir pour se réveiller hors budget ne servirait à rien.
        if attente >= restant():
            raise trop_long() from derniere

        print(
            f"   ⚠️  Téléchargement interrompu à {len(recu) / 1024 / 1024:.1f} Mo "
            f"({type(derniere).__name__}) — reprise dans {attente}s"
        )
        time.sleep(attente)

    raise derniere or RuntimeError(f"{ESSAIS_MAX} essais épuisés sur {url}")
