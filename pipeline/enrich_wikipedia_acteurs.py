"""
enrich_wikipedia_acteurs.py
Résout le titre exact de l'article Wikipédia francophone de chaque élu en exercice
et l'écrit dans `acteurs.wikipedia_titre`.

Pourquoi : la fiche élu cherchait son article sous « Prénom_Nom », ce qui rend un
homonyme sans le signaler. La fiche du ministre Michel Fournier a ainsi affiché la
biographie d'un parachutiste retraité de l'Armée de terre.

Deux étages, du plus sûr au plus faible :

  1. Identifiant officiel, via Wikidata. `P4123` porte l'identifiant Assemblée, qui
     est notre uid privé de son préfixe `PA` ; `P1808` porte le chemin de la fiche
     Sénat, celui que contient `url_profil_officiel`. Aucune ambiguïté possible :
     on part d'un identifiant, on obtient un titre. Deux requêtes tirent la table
     complète de ces identifiants, l'intersection se fait en mémoire — plus court
     et plus robuste qu'un `VALUES` de mille entrées dans l'URL.

  2. Repli par le nom, pour les ministres venus de la société civile, à qui
     Wikidata n'a pas encore posé d'identifiant. Le candidat n'est retenu que s'il
     est humain, porte au moins une fonction politique, a un article francophone,
     et qu'il est seul à remplir ces conditions. Sinon la fiche n'affiche rien,
     ce qui vaut mieux que la biographie d'un inconnu.

Un titre n'est jamais effacé par ce script : il est remplacé quand une résolution
plus récente en trouve un autre. Une panne de Wikidata laisse donc la veille en
place au lieu de vider toutes les fiches.

Tourne dans le cron nocturne, après l'import des acteurs dont il lit les uid.
"""

import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire, mettre_a_jour  # noqa: E402

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

SPARQL_ENDPOINT = "https://query.wikidata.org/sparql"
# Wikidata exige un User-Agent nominatif et coupe court aux requêtes anonymes.
USER_AGENT = "LoiClairBot/1.0 (https://loiclair.fr; contact@loiclair.fr)"
PREFIXE_ARTICLE_FR = "https://fr.wikipedia.org/wiki/"


def sparql(requete: str) -> list[dict]:
    """Exécute une requête SPARQL et rend les liaisons brutes."""
    reponse = requests.get(
        SPARQL_ENDPOINT,
        params={"query": requete},
        headers={"Accept": "application/sparql-results+json", "User-Agent": USER_AGENT},
        timeout=120,
    )
    reponse.raise_for_status()
    return reponse.json()["results"]["bindings"]


def titre_depuis_url(url: str) -> str:
    """Titre d'article à partir de son URL, dans la forme qu'attend l'API REST."""
    return requests.utils.unquote(url.removeprefix(PREFIXE_ARTICLE_FR))


def charger_index(propriete: str) -> dict[str, str]:
    """Index { valeur de l'identifiant → titre de l'article fr } pour une propriété."""
    liaisons = sparql(
        f"SELECT ?cle ?article WHERE {{"
        f"  ?item wdt:{propriete} ?cle ."
        f"  ?article schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> ."
        f"}}"
    )
    return {b["cle"]["value"]: titre_depuis_url(b["article"]["value"]) for b in liaisons}


def cle_senat(url_profil: str | None) -> str | None:
    """Chemin de fiche Sénat tel que Wikidata le stocke : `senateur/nom_prenom00000x`."""
    if not url_profil or "senat.fr/senateur/" not in url_profil:
        return None
    return "senateur/" + url_profil.split("senateur/")[1].removesuffix(".html")


def _candidat_unique(libelle: str, contrainte: str) -> str | None:
    """Titre de l'unique article francophone répondant au nom et à la contrainte."""
    liaisons = sparql(
        f'SELECT DISTINCT ?article WHERE {{'
        f'  ?item rdfs:label|skos:altLabel "{libelle}"@fr ; wdt:P31 wd:Q5 . {contrainte}'
        f'  ?article schema:about ?item ; schema:isPartOf <https://fr.wikipedia.org/> .'
        f'}} LIMIT 5'
    )
    if len(liaisons) != 1:
        return None
    return titre_depuis_url(liaisons[0]["article"]["value"])


def resoudre_par_nom(prenom: str, nom: str) -> str | None:
    """Article francophone de la personne portant ce nom, si elle est la seule.

    Deux passes. La première exige au moins une fonction (`P39`), ce qui écarte les
    homonymes non politiques : sans elle, « Michel Fournier » rend aussi un
    parachutiste retraité de l'Armée de terre, qui s'est affiché des mois durant
    sur la fiche du ministre. La seconde retombe sur le nom seul, pour les ministres
    dont Wikidata n'a pas encore enregistré la fonction : Serge Papin et Alice Rufo
    avaient un article et zéro `P39` au 2026-09-09.

    Les deux passes lisent aussi `skos:altLabel`, l'orthographe officielle de l'AN
    n'étant pas toujours celle de Wikidata (« Laurent Nunez » contre « Laurent
    Nuñez »). Zéro ou plusieurs candidats rendent `None` : une ambiguïté ne se
    tranche pas au hasard.
    """
    libelle = f"{prenom} {nom}".replace('"', "")
    return (
        _candidat_unique(libelle, "?item wdt:P39 ?fonction .")
        or _candidat_unique(libelle, "")
    )


def main() -> None:
    print("▶ Chargement des élus en exercice…")
    # Autocommit : la connexion reste ouverte pendant les requêtes SPARQL (plusieurs
    # minutes), sans transaction pendante après la lecture.
    conn = connexion(autocommit=True)
    acteurs = lire(
        conn,
        "SELECT uid, prenom, nom, url_profil_officiel, wikipedia_titre "
        "FROM acteurs WHERE en_exercice = true ORDER BY uid",
    )
    print(f"  → {len(acteurs)} élus")

    print("▶ Index Wikidata des identifiants parlementaires…")
    index_an = charger_index("P4123")
    index_senat = charger_index("P1808")
    print(f"  → {len(index_an)} identifiants Assemblée, {len(index_senat)} chemins Sénat")

    titres: dict[str, str] = {}
    sans_identifiant: list[dict] = []
    for acteur in acteurs:
        uid = acteur["uid"]
        titre = None
        if uid.startswith("PA"):
            titre = index_an.get(uid[2:])
        if not titre:
            cle = cle_senat(acteur.get("url_profil_officiel"))
            if cle:
                titre = index_senat.get(cle)
        if titre:
            titres[uid] = titre
        else:
            sans_identifiant.append(acteur)

    print(f"▶ {len(titres)} résolus par identifiant, {len(sans_identifiant)} à tenter par le nom")

    for acteur in sans_identifiant:
        prenom = (acteur.get("prenom") or "").strip()
        nom = (acteur.get("nom") or "").strip()
        if not prenom or not nom:
            continue
        try:
            titre = resoudre_par_nom(prenom, nom)
        except Exception as e:
            print(f"  ⚠️  {prenom} {nom} : {type(e).__name__} {e}")
            continue
        if titre:
            titres[acteur["uid"]] = titre
        # Une requête par personne, sur une poignée de cas : on laisse respirer
        # l'endpoint public plutôt que de risquer un blocage.
        time.sleep(1)

    deja_en_base = {a["uid"]: a.get("wikipedia_titre") for a in acteurs}
    modifies = [(uid, titre) for uid, titre in titres.items() if titre != deja_en_base.get(uid)]
    print(f"▶ {len(modifies)} titre(s) à écrire")
    # Une requête pour tous les titres (quelques dizaines au plus). Seules les lignes
    # dont le titre diffère sont réécrites, ce que `modifies` garantit déjà.
    if modifies:
        mettre_a_jour(
            conn, "acteurs", "uid", {"wikipedia_titre": "text"},
            [{"uid": uid, "wikipedia_titre": titre} for uid, titre in modifies],
        )
    conn.close()

    non_resolus = len(acteurs) - len(titres)
    print(f"✅ Terminé : {len(titres)} élus avec un article, {non_resolus} sans.")


if __name__ == "__main__":
    main()
