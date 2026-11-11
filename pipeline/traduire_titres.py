# traduire_titres.py
# Traduit en anglais le titre de chaque dossier législatif (`dossiers_legislatifs.titre`),
# de chaque loi publiée (`application_lois.titre`) et de chaque scrutin affiché
# (`scrutins.titre`, voir `CIBLES`), et l'écrit dans `titre_en`, que le site affiche
# sur /en (`src/lib/titre-dossier.ts`).
#
# Claude Haiku 5.5 en appel direct, 40 titres par requête : tout le stock coûte quelques
# centimes, et un titre déposé dans la journée est traduit la nuit même. Les lots
# (moitié prix) obligeraient à tenir l'état d'une soumission d'une nuit à l'autre pour
# une économie de l'ordre du centime. Lancé chaque nuit par `nightly.py` (étape
# `traduire-titres`), et à la main :
#   python3 -P traduire_titres.py               # traduit tout ce qui manque ou a changé
#   python3 -P traduire_titres.py --limite 40   # au plus 40 titres (essai)
#   python3 -P traduire_titres.py --verifier    # compte les titres non traduits, n'appelle pas l'IA
#
# `titre_en_empreinte` vaut md5(titre + version du prompt). Un titre renommé par
# l'Assemblée ou le Sénat, ou un prompt retouché, change l'empreinte et relance la
# traduction ; tout le reste est sauté sans appel.

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import anthropic
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")
from _claude import ReponseInutilisable, claude, cout, lire_reponse  # noqa: E402
from _db import connexion, mettre_a_jour  # noqa: E402

# Chemin dérivé de __file__, comme `classer_articles.py` : la page
# /documentation/prompts-ia affiche le même fichier.
_PROMPT = json.loads((Path(__file__).resolve().parent.parent / "src" / "lib" / "prompts" / "titres-en.json")
                     .read_text(encoding="utf-8"))
MODELE = _PROMPT["modele"]
SYSTEM = _PROMPT["system"]
MAX_TOKENS = _PROMPT["maxOutputTokens"]
EFFORT = _PROMPT["reasoningEffort"]

SCHEMA = {
    "type": "object",
    "properties": {
        "traductions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"uid": {"type": "string"}, "titre_en": {"type": "string"}},
                "required": ["uid", "titre_en"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["traductions"],
    "additionalProperties": False,
}

# Tout ce que le modèle reçoit, modèle compris : changer de modèle doit retraduire,
# puisque c'est le texte affiché qui change.
PROMPT_VERSION = hashlib.sha256(json.dumps(
    [MODELE, SYSTEM, _PROMPT["userTemplate"], SCHEMA, MAX_TOKENS, EFFORT], sort_keys=True, ensure_ascii=False,
).encode()).hexdigest()[:12]

# 40 titres par requête : le modèle voit plusieurs titres à la fois, ce qui garde le
# glossaire appliqué de façon cohérente, et la réponse (environ 2 000 jetons) reste
# loin de `maxOutputTokens`.
PAR_REQUETE = 40
FILS = 4
# Lignes de `titre_en` écrites par requête : environ 150 Ko de JSON, très en dessous du
# mégaoctet que vise la règle des écritures par lots.
ECRITURE_PAR_PAQUET = 500


def empreinte(titre: str) -> str:
    return hashlib.md5((titre + PROMPT_VERSION).encode("utf-8")).hexdigest()


def message_utilisateur(titres: list[dict]) -> str:
    return _PROMPT["userTemplate"].format(titres=json.dumps(
        [{"uid": t["uid"], "titre": t["titre"]} for t in titres], ensure_ascii=False, indent=0))


def meme_initiale(original: str, traduction: str) -> str:
    """La traduction, première lettre à la casse de celle du titre français.

    Fait ici et non par le prompt : au banc du 2026-10-20, la consigne seule rendait
    « child poverty » pour « La pauvreté infantile » ou « government bill » en tête,
    recopié du glossaire, d'un essai à l'autre. Les 165 titres à minuscule initiale sont
    des suites d'intitulé (« sur les débris spatiaux ») et doivent la garder.
    """
    # Seulement sur une lettre : un titre qui s'ouvre sur « , un chiffre ou une
    # parenthèse n'a pas de casse, et `isupper()` y rend faux, ce qui mettrait en
    # minuscule une traduction que le modèle a ouverte sans guillemet.
    if not original or not traduction or not original[0].isalpha():
        return traduction
    premiere = traduction[0].upper() if original[0].isupper() else traduction[0].lower()
    return premiere + traduction[1:]


def traduire_groupe(titres: list[dict]) -> tuple[dict[str, str], float]:
    """Traduit un groupe de titres : ({uid: titre anglais}, coût en dollars).

    Un uid absent de la réponse, inconnu du groupe ou rendu vide est simplement
    écarté : sans empreinte écrite, il repart la nuit suivante. Une réponse coupée ou
    refusée lève `ReponseInutilisable`, que l'appelant compte.
    """
    reponse = claude.messages.create(
        model=MODELE,
        max_tokens=MAX_TOKENS,
        system=[{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": message_utilisateur(titres)}],
        output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
    )
    prix = cout(reponse.usage)
    originaux = {t["uid"]: t["titre"] for t in titres}
    rendus = {}
    for tr in lire_reponse(reponse)["traductions"]:
        texte = " ".join((tr.get("titre_en") or "").split())
        if tr.get("uid") in originaux and texte:
            rendus[tr["uid"]] = meme_initiale(originaux[tr["uid"]].lstrip(), texte)
    return rendus, prix


# Les tables traduites : (table, clé, nom affiché). Les dossiers, et les lois publiées
# que liste le baromètre d'application des lois (`import_application_lois.py`), dont le
# titre Légifrance (« LOI n° 2022-299 du 2 mars 2022… ») s'affiche sur /Facts/delais,
# /Facts/taux-application et Month. Même prompt pour les deux : au banc du 2026-10-20,
# il traduisait déjà les titres de lois sans retouche (`scripts/banc-titres-en`).
# Les trois tables portent `titre`, `titre_en` et `titre_en_empreinte`. `table`, `cle` et
# `filtre` sont écrits ici en dur et entrent tels quels dans le SQL.
#
# Le baromètre liste toutes les lois depuis 2002 (2 060 au 2026-10-20), mais le site
# n'affiche que celles rattachées à un dossier en base (148) : les pages et Month lisent
# `application_lois` par son `dossier_uid`. Le filtre écarte les autres, que rien ne lit
# et qu'une retouche du prompt aurait sinon fait retraduire. Une première passe sans lui
# en a traduit la plupart le 2026-10-20 : ces traductions restent en base, inertes.
#
# Même raison pour les scrutins : 9 145 en base, 555 affichés au 2026-10-20. La fiche
# d'élu et le quiz ne lisent que ceux qui ont une liste nominative ; la fiche du dossier
# et Month, ceux qu'un acte cite dans `vote_refs`. Même prompt que les dossiers, avec
# trois consignes propres aux scrutins, dont garder l'article de tête (« the whole of… ») :
# sans elle, une passe du 2026-10-20 avait rendu 44 titres sur 555 sans lui
# (`scripts/banc-titres-en/README.md`).
CIBLES = [
    ("dossiers_legislatifs", "uid", "dossiers", "TRUE"),
    ("application_lois", "jorftext_id", "lois",
     "EXISTS (SELECT 1 FROM dossiers_legislatifs d WHERE d.uid = application_lois.dossier_uid)"),
    ("scrutins", "uid", "scrutins",
     "(votes_nominatifs IS NOT NULL OR uid IN (SELECT unnest(vote_refs) FROM actes_legislatifs))"),
]


def a_traduire(cur, table: str, cle: str, filtre: str) -> list[dict]:
    """Les lignes dont l'empreinte en base ne correspond plus au titre et au prompt.

    La clé de la table passe sous le nom `uid`, celui que reçoit le modèle.
    """
    cur.execute(f"SELECT {cle}, titre, titre_en_empreinte FROM {table} "
                f"WHERE titre IS NOT NULL AND titre <> '' AND {filtre} ORDER BY {cle}")
    return [{"uid": uid, "titre": titre} for uid, titre, emp in cur.fetchall() if emp != empreinte(titre)]


def traduire_table(conn, table: str, cle: str, nom: str, filtre: str, limite: int | None) -> tuple[int, int, int]:
    """Traduit et écrit les titres d'une table : (titres envoyés, groupes, groupes en échec)."""
    with conn.cursor() as cur:
        restants = a_traduire(cur, table, cle, filtre)
    print(f"{nom} : {len(restants)} titre(s) à traduire")
    if limite is not None:
        restants = restants[:limite]
    groupes = [restants[i:i + PAR_REQUETE] for i in range(0, len(restants), PAR_REQUETE)]
    lignes, total, echecs = [], 0.0, 0
    with ThreadPoolExecutor(max_workers=FILS) as pool:
        futurs = {pool.submit(traduire_groupe, g): g for g in groupes}
        for n, f in enumerate(as_completed(futurs), 1):
            groupe = futurs[f]
            try:
                rendus, prix = f.result()
            # `StopIteration` : réponse sans bloc de texte (`lire_reponse`), comme le
            # rattrape `classer_articles.py`. Non rattrapée, elle arrêtait la table et
            # perdait les groupes déjà payés, écrits seulement à la fin.
            except (ReponseInutilisable, anthropic.APIError, json.JSONDecodeError, StopIteration) as e:
                echecs += 1
                print(f"  ✗ groupe {groupe[0]['uid']}… ({len(groupe)} titres) : {e}")
                continue
            total += prix
            lignes += [{cle: t["uid"], "titre_en": rendus[t["uid"]], "titre_en_empreinte": empreinte(t["titre"])}
                       for t in groupe if t["uid"] in rendus]
            print(f"  {nom}, groupe {n}/{len(groupes)} : {len(rendus)}/{len(groupe)} traduits")
    ecrites = 0
    for i in range(0, len(lignes), ECRITURE_PAR_PAQUET):
        ecrites += mettre_a_jour(conn, table, cle, {"titre_en": "text", "titre_en_empreinte": "text"},
                                 lignes[i:i + ECRITURE_PAR_PAQUET])
    envoyes = sum(len(g) for g in groupes)
    print(f"{nom} : {len(lignes)}/{envoyes} titres traduits, {ecrites} ligne(s) écrite(s), "
          f"{envoyes - len(lignes)} à reprendre la nuit prochaine (dont {echecs} groupe(s) en échec), "
          f"coût {total:.4f} $")
    return envoyes, len(groupes), echecs


def traduire(limite: int | None) -> int:
    """Traduit toutes les cibles ; rend 1 quand une table n'a vu réussir aucun groupe.

    Autocommit, comme `classer_articles.py --lots` : sans lui, la première lecture ouvre
    une transaction implicite, chaque `conn.transaction()` de `mettre_a_jour` n'est plus
    qu'un point de sauvegarde, et rien n'est validé avant la fin des deux tables. Une
    panne pendant la seconde perdait alors les traductions déjà payées de la première.

    Le code de sortie : des groupes en échec çà et là repartent la nuit suivante sans
    bruit, mais une table dont tous les groupes échouent (crédits épuisés, clé révoquée)
    doit marquer l'étape en échec dans le bilan de `nightly.py`, qui ne lit que lui.
    """
    print(f"Prompt {PROMPT_VERSION}")
    tout_en_echec = False
    with connexion(autocommit=True) as conn:
        for table, cle, nom, filtre in CIBLES:
            # `--limite` borne le total de l'essai, toutes tables confondues.
            envoyes, groupes, echecs = traduire_table(conn, table, cle, nom, filtre, limite)
            tout_en_echec = tout_en_echec or (groupes > 0 and echecs == groupes)
            if limite is not None:
                limite = max(limite - envoyes, 0)
    return 1 if tout_en_echec else 0


def verifier() -> None:
    with connexion() as conn, conn.cursor() as cur:
        for table, cle, nom, filtre in CIBLES:
            restants = a_traduire(cur, table, cle, filtre)
            # Même périmètre que `a_traduire` : un titre vide n'est jamais traduit, et
            # le compter ici empêchait le total d'être atteint.
            cur.execute(f"SELECT count(*), count(titre_en) FROM {table} "
                        f"WHERE titre IS NOT NULL AND titre <> '' AND {filtre}")
            tous, traduits = cur.fetchone()
            print(f"Prompt {PROMPT_VERSION}, {nom} : {traduits}/{tous} ont un titre anglais, "
                  f"{len(restants)} à traduire ou retraduire")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limite", type=int, help="nombre maximal de titres traduits (essai)")
    parser.add_argument("--verifier", action="store_true", help="compter les titres non traduits, sans appel")
    args = parser.parse_args()
    if args.verifier:
        verifier()
    else:
        sys.exit(traduire(args.limite))


if __name__ == "__main__":
    main()
