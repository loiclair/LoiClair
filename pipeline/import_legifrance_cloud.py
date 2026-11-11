"""
import_legifrance_cloud.py
Récupère le texte complet des lois promulguées depuis l'API Légifrance (PISTE)
et stocke le contenu en base (colonne contenu_legifrance de la table textes).

Deux passes :
1. JORF : récupère le texte original publié au Journal Officiel (via getJoWithNor)
2. Version consolidée : crée une entrée séparée avec l'URL de la version en vigueur (via recherche LODA)

Prérequis :
- Variables d'environnement LEGIFRANCE_CLIENT_ID et LEGIFRANCE_CLIENT_SECRET dans .env.local
- Variables PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD (connexion Postgres, voir `_db.py`)
  dans .env.local
"""

import os
import re
import time
import json
import sys
import requests
from pathlib import Path
from dotenv import load_dotenv
import psycopg
from tqdm import tqdm

# `python3 -P` n'ajoute pas le dossier du script au chemin de recherche des modules.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire  # noqa: E402

# ── Configuration ──────────────────────────────────────────────────────────────

# Charger les variables d'environnement depuis .env.local (projet parent)
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

LEGIFRANCE_CLIENT_ID = os.getenv("LEGIFRANCE_CLIENT_ID")
LEGIFRANCE_CLIENT_SECRET = os.getenv("LEGIFRANCE_CLIENT_SECRET")

if not LEGIFRANCE_CLIENT_ID or not LEGIFRANCE_CLIENT_SECRET:
    raise ValueError("LEGIFRANCE_CLIENT_ID ou LEGIFRANCE_CLIENT_SECRET manquant dans .env.local")

# Une connexion par processus, ouverte au premier usage et rouverte si elle tombe : le
# script alterne appels PISTE (0,5 à 1 s chacun) et écritures, sur plusieurs minutes.
# Autocommit : chaque écriture est validée seule, pour qu'une interruption garde tout
# ce qui est déjà fait.
_conn: psycopg.Connection | None = None


def _connexion() -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed or _conn.broken:
        _conn = connexion(autocommit=True)
    return _conn


def ecrire(requete: str, params: list) -> None:
    """Exécute une écriture, validée aussitôt. Lève `psycopg.Error` en cas d'échec.

    Une écriture à la fois et non par lot, voulu : chacune suit un appel PISTE d'au moins
    0,5 s qui rythme déjà la boucle, la passe suivante relit ce que celle-ci vient
    d'écrire, et un lot gardé en mémoire perdrait des textes déjà récupérés si le
    passage s'interrompait. Le volume nocturne est de quelques lignes.
    """
    with _connexion().cursor() as cur:
        cur.execute(requete, params)


OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token"
API_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app"

# Pause entre chaque appel API (en secondes) — quota : 2 req/s par endpoint
RATE_LIMIT_PAUSE = 0.6

# Posée le lundi par `nightly.py` (ou à la main). La recherche de la dernière version
# de chaque loi consolidée ne tourne que ce jour-là : sur neuf nuits observées, une
# seule des 148 lois avait changé, pour environ quatre minutes d'appels par nuit.
VERIF_COMPLETE = bool(os.getenv("VERIF_COMPLETE"))

# Intervalle minimal entre deux appels de la synchronisation des lois consolidées. Il
# remplace une pause fixe de 0,6 s ajoutée après chaque appel, alors qu'un appel prend
# déjà environ 0,9 s : la pause ne protégeait du quota de rien et coûtait 89 s par nuit.
INTERVALLE_MIN_APPELS = 0.5
_dernier_appel = 0.0


def espacer_appels() -> None:
    """Attend ce qu'il faut pour que deux appels PISTE soient espacés d'au moins 0,5 s."""
    global _dernier_appel
    attente = INTERVALLE_MIN_APPELS - (time.monotonic() - _dernier_appel)
    if attente > 0:
        time.sleep(attente)
    _dernier_appel = time.monotonic()


# ── Authentification OAuth 2.0 ────────────────────────────────────────────────

def get_access_token() -> str:
    """Obtient un token d'accès via OAuth 2.0 Client Credentials."""
    response = requests.post(
        OAUTH_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": LEGIFRANCE_CLIENT_ID,
            "client_secret": LEGIFRANCE_CLIENT_SECRET,
            "scope": "openid",
        },
        timeout=30,
    )
    response.raise_for_status()
    token = response.json().get("access_token")
    if not token:
        raise ValueError(f"Pas de access_token dans la réponse OAuth : {response.json()}")
    return token


# ── Appels API Légifrance ─────────────────────────────────────────────────────

def fetch_jorf_by_nor(nor: str, token: str) -> dict | None:
    """Récupère un texte JORF via son numéro NOR."""
    response = requests.post(
        f"{API_BASE}/consult/getJoWithNor",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"nor": nor},
        timeout=30,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def fetch_jorf_by_id(jorftext_id: str, token: str) -> dict | None:
    """Récupère un texte JORF via son identifiant JORFTEXT (fallback)."""
    response = requests.post(
        f"{API_BASE}/consult/jorf",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"id": jorftext_id},
        timeout=30,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def fetch_loda_consolidee(jorftext_id: str, date: str, token: str) -> dict | None:
    """Récupère le texte consolidé LODA à une date donnée (via consult/lawDecree)."""
    response = requests.post(
        f"{API_BASE}/consult/lawDecree",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"textId": jorftext_id, "date": date},
        timeout=30,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def fetch_loda_latest_date(nor: str, token: str) -> str | None:
    """Récupère la date de la dernière version consolidée via recherche LODA par NOR.
    Retourne une date ISO (YYYY-MM-DD) ou None."""
    if not nor:
        return None
    response = requests.post(
        f"{API_BASE}/search",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "recherche": {
                "champs": [{"typeChamp": "NOR", "criteres": [{"typeRecherche": "EXACTE", "valeur": nor, "operateur": "ET"}], "operateur": "ET"}],
                "filtres": [{"facette": "TEXT_LEGAL_STATUS", "valeurs": ["VIGUEUR"]}],
                "pageNumber": 1,
                "pageSize": 10,
                "typePagination": "DEFAUT",
            },
            "fond": "LODA_DATE",
        },
        timeout=30,
    )
    if response.status_code != 200:
        return None
    latest = None
    for r in (response.json().get("results") or []):
        for t in (r.get("titles") or []):
            m = re.search(r"(\d{2})-(\d{2})-(\d{4})$", t.get("id") or "")
            if m:
                iso = f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
                if not latest or iso > latest:
                    latest = iso
    return latest


def build_loda_url(jorf_url: str) -> str | None:
    """Construit l'URL de la version consolidée depuis l'URL JORF.
    Ex: /jorf/id/JORFTEXT000051586300 → /loda/id/JORFTEXT000051586300"""
    if not jorf_url:
        return None
    jorftext_id = re.search(r"(JORFTEXT\d+)", jorf_url)
    if not jorftext_id:
        return None
    return f"https://www.legifrance.gouv.fr/loda/id/{jorftext_id.group(1)}"


# ── Extraction du texte ───────────────────────────────────────────────────────

def extract_jorftext_id(url: str | None) -> str | None:
    """Extrait un identifiant JORFTEXT depuis une URL Légifrance (nouveau format).

    `url` vient d'une ligne lue en base, où `lien_texte` peut valoir NULL : le
    rattrapage de `fetch_loi_textes_sans_contenu` va justement chercher ces lignes.
    Sans ce garde, `re.search(None)` lève : le 2026-10-20, un délai dépassé sur le
    NOR a mené là et arrêté tout le script. Même garde que `build_loda_url`."""
    if not url:
        return None
    match = re.search(r"(JORFTEXT\d+)", url)
    return match.group(1) if match else None


def extract_text_content(jorf_data: dict) -> str | None:
    """
    Extrait le contenu textuel depuis la réponse JSON de l'API Légifrance.
    Structure API : { articles: [...], sections: [{ articles: [...], sections: [...] }] }
    Les articles ont un champ "content" (HTML) et "num" (numéro d'article).
    """
    if not jorf_data:
        return None

    parts = []

    # Titre de la loi
    title = jorf_data.get("title")
    if title:
        parts.append(title)

    # Visa (préambule)
    visa = jorf_data.get("visa")
    if visa:
        parts.append(_clean_html(visa))

    # Articles au niveau racine (ex: article liminaire)
    for article in (jorf_data.get("articles") or []):
        _append_article(article, parts)

    # Articles dans les sections (récursif)
    for section in (jorf_data.get("sections") or []):
        _extract_section(section, parts)

    # Signataires
    signers = jorf_data.get("signers")
    if signers:
        parts.append(_clean_html(signers))

    if len(parts) <= 1:  # Seulement le titre ou rien
        return None

    return "\n\n".join(parts).strip()


def extract_canonical_url(jorf_data: dict) -> str | None:
    """Extrait l'URL canonique Légifrance depuis la réponse API."""
    cid = jorf_data.get("cid")
    if cid and isinstance(cid, str) and cid.startswith("JORFTEXT"):
        return f"https://www.legifrance.gouv.fr/jorf/id/{cid}"
    return None


def _extract_section(section: dict, parts: list):
    """Extrait récursivement les articles d'une section et de ses sous-sections."""
    title = section.get("title")
    if title:
        parts.append(f"--- {title} ---")

    for article in (section.get("articles") or []):
        _append_article(article, parts)

    for sub_section in (section.get("sections") or []):
        _extract_section(sub_section, parts)


def _append_article(article: dict, parts: list):
    """Ajoute un article nettoyé à la liste des parties."""
    content = article.get("content", "")
    if not content:
        return
    num = article.get("num", "")
    clean = _clean_html(content)
    if num:
        parts.append(f"Article {num}\n{clean}")
    else:
        parts.append(clean)


def _clean_html(text: str) -> str:
    """Nettoie les balises HTML basiques d'un texte."""
    # Retirer les balises HTML
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    # Décoder les entités HTML courantes
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    text = text.replace("&quot;", '"').replace("&#39;", "'").replace("&nbsp;", " ")
    # Normaliser les espaces
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ── Base : récupération et mise à jour ───────────────────────────────────────

def fetch_loi_textes_sans_contenu() -> list:
    """Récupère les textes LOI originaux sans contenu OU sans lien_texte."""
    # Deux groupes en une requête : d'abord les textes sans contenu (enrichissement
    # complet), puis ceux qui ont un contenu mais pas de lien_texte (rattrapage de l'URL
    # seule). Les deux groupes sont disjoints, `contenu_legifrance IS NOT NULL` les
    # séparant ; le tri les range dans cet ordre, l'uid départageant dans chaque groupe.
    return lire(
        _connexion(),
        """
        SELECT uid, lien_texte, num_notice, denomination
        FROM textes
        WHERE type_code = 'LOI'
          AND is_version_consolidee = false
          AND (contenu_legifrance IS NULL OR lien_texte IS NULL)
        ORDER BY (contenu_legifrance IS NOT NULL), uid
        """,
    )


def fetch_loi_textes_pour_consolidee() -> list:
    """Récupère les textes LOI originaux enrichis (avec contenu_legifrance) pour créer les versions consolidées."""
    return lire(
        _connexion(),
        """
        SELECT uid, num_notice, denomination, dossier_ref, lien_texte, date_publication
        FROM textes
        WHERE type_code = 'LOI'
          AND is_version_consolidee = false
          AND contenu_legifrance IS NOT NULL
        ORDER BY uid
        """,
    )


def fetch_existing_vc_uids() -> set:
    """Récupère les UIDs des versions consolidées existantes."""
    return {
        row["uid"]
        for row in lire(_connexion(), "SELECT uid FROM textes WHERE is_version_consolidee = true")
    }


def fetch_num_notices(base_uids: list[str]) -> dict[str, str]:
    """NOR des lois originales `base_uids`, par uid. Une loi sans NOR est absente."""
    if not base_uids:
        return {}
    lignes = lire(
        _connexion(),
        "SELECT uid, num_notice FROM textes WHERE uid = ANY(%s) AND num_notice IS NOT NULL AND num_notice <> ''",
        (base_uids,),
    )
    return {row["uid"]: row["num_notice"] for row in lignes}


def update_texte(uid: str, contenu: str, new_lien: str | None = None):
    """Met à jour le contenu Légifrance (et optionnellement le lien) d'un texte."""
    affectations = ["contenu_legifrance = %s"]
    params = [contenu]
    if new_lien:
        affectations += ["lien_texte = %s", "url_accessible = true"]
        params.append(new_lien)
    try:
        ecrire(f"UPDATE textes SET {', '.join(affectations)} WHERE uid = %s", [*params, uid])
    except psycopg.Error as e:
        tqdm.write(f"  Erreur update base pour {uid}: {e}")


# ── Script principal ──────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("IMPORT LÉGIFRANCE — Récupération des textes promulgués")
    print("=" * 60)

    # 1. Authentification OAuth
    print("\n1. Authentification OAuth...")
    try:
        token = get_access_token()
        print("   Token obtenu.")
    except Exception as e:
        print(f"   ERREUR authentification : {e}")
        return

    # ── Passe 1 : Enrichissement JORF (texte original) ──────────────────────

    print("\n2. Chargement des textes LOI sans contenu JORF...")
    textes = fetch_loi_textes_sans_contenu()
    print(f"   {len(textes)} texte(s) LOI à traiter.")

    success_jorf = 0
    skip_jorf = 0

    if textes:
        print("\n3. Récupération des textes JORF depuis l'API Légifrance...\n")

        for texte in tqdm(textes, desc="Textes JORF"):
            uid = texte["uid"]
            nor = texte.get("num_notice")
            lien = texte.get("lien_texte")

            # Essai 1 : par NOR (approche principale)
            jorf_data = None
            if nor:
                try:
                    jorf_data = fetch_jorf_by_nor(nor, token)
                except requests.exceptions.HTTPError as e:
                    if e.response is not None and e.response.status_code == 401:
                        tqdm.write(f"  Token expiré, renouvellement...")
                        token = get_access_token()
                        try:
                            jorf_data = fetch_jorf_by_nor(nor, token)
                        except Exception as e2:
                            tqdm.write(f"  Erreur API pour {uid} (NOR={nor}): {e2}")
                    else:
                        tqdm.write(f"  Erreur API pour {uid} (NOR={nor}): {e}")
                except Exception as e:
                    tqdm.write(f"  Erreur API pour {uid} (NOR={nor}): {e}")

            # Essai 2 : par JORFTEXT ID (si présent dans l'URL)
            if not jorf_data:
                jorftext_id = extract_jorftext_id(lien)
                if jorftext_id:
                    try:
                        jorf_data = fetch_jorf_by_id(jorftext_id, token)
                    except Exception as e:
                        tqdm.write(f"  Erreur API fallback pour {uid} (ID={jorftext_id}): {e}")

            # Extraction du contenu textuel
            if jorf_data:
                contenu = extract_text_content(jorf_data)
                if contenu and len(contenu) > 100:
                    canonical_url = extract_canonical_url(jorf_data)
                    update_texte(uid, contenu, new_lien=canonical_url)
                    success_jorf += 1
                else:
                    tqdm.write(f"  Contenu trop court ou vide pour {uid} (NOR={nor})")
                    skip_jorf += 1
            else:
                tqdm.write(f"  Aucun résultat API pour {uid} (NOR={nor})")
                skip_jorf += 1

            time.sleep(RATE_LIMIT_PAUSE)

        print(f"\n   JORF : {success_jorf} enrichi(s), {skip_jorf} ignoré(s)")
    else:
        print("   Aucun texte JORF à traiter.")

    # ── Passe 2 : Versions consolidées ──────────────────────────────────────

    print("\n4. Création des versions consolidées...")
    textes_pour_vc = fetch_loi_textes_pour_consolidee()
    existing_vc = fetch_existing_vc_uids()

    # Filtrer : ne garder que ceux sans version consolidée existante
    textes_a_traiter = [t for t in textes_pour_vc if f"{t['uid']}-VC" not in existing_vc]
    print(f"   {len(textes_a_traiter)} version(s) consolidée(s) à créer ({len(existing_vc)} déjà existante(s)).")

    success_vc = 0
    skip_vc = 0

    if textes_a_traiter:
        print()

        for texte in textes_a_traiter:
            uid = texte["uid"]
            lien_original = texte.get("lien_texte") or ""
            dossier_ref = texte.get("dossier_ref")
            denomination = texte.get("denomination") or ""
            nor = texte.get("num_notice") or ""

            loda_url = build_loda_url(lien_original)
            if not loda_url:
                tqdm.write(f"  Pas de JORFTEXT dans lien_texte pour {uid}, skip")
                skip_vc += 1
                continue

            vc_uid = f"{uid}-VC"
            vc_denomination = f"Version consolidée — {denomination}" if denomination else "Version consolidée"

            # Récupérer la date de dernière modification via recherche LODA
            latest_date = None
            try:
                latest_date = fetch_loda_latest_date(nor, token)
            except Exception as e:
                tqdm.write(f"  Erreur recherche LODA pour {vc_uid}: {e}")
            time.sleep(RATE_LIMIT_PAUSE)

            # Sans date, la loi n'est pas dans le fond LODA : c'est le cas des lois
            # qui autorisent l'approbation d'un accord international, que Légifrance
            # ne consolide pas. Insérer quand même produit une ligne morte à vie —
            # ni date, ni contenu — que la passe 3 ne peut pas réparer (elle saute
            # les VC sans `target_date`), et que la fiche dossier propose malgré tout
            # comme version de référence. Ne rien écrire la laisse hors d'`existing_vc`,
            # donc réessayée chaque nuit si Légifrance la publie un jour.
            if not latest_date:
                tqdm.write(f"  Pas de date LODA pour {vc_uid} (loi absente du fond consolidé), skip")
                skip_vc += 1
                continue

            row = {
                "uid": vc_uid,
                "dossier_ref": dossier_ref,
                "type_code": "LOI",
                "denomination": vc_denomination,
                "lien_texte": loda_url,
                "url_accessible": True,
                "is_version_consolidee": True,
                "provenance": "Légifrance",
                "date_publication": f"{latest_date} 00:00:00",
            }

            try:
                # Colonnes écrites en dur ci-dessus, jamais tirées d'une donnée.
                ecrire(
                    f"INSERT INTO textes ({', '.join(row)}) VALUES ({', '.join(['%s'] * len(row))})",
                    list(row.values()),
                )
                success_vc += 1
            except psycopg.Error as e:
                tqdm.write(f"  Erreur insert VC pour {vc_uid}: {e}")
                skip_vc += 1

        # Rattrapage : mettre à jour la date des VC existantes sans date
        existing_vc_sans_date = lire(
            _connexion(),
            "SELECT uid, lien_texte FROM textes "
            "WHERE is_version_consolidee = true AND date_publication IS NULL ORDER BY uid",
        )

        if existing_vc_sans_date:
            print(f"   + {len(existing_vc_sans_date)} VC existante(s) sans date à enrichir.")
            # Construire un mapping VC uid → NOR depuis la loi originale
            vc_base_uids = [r["uid"].replace("-VC", "") for r in existing_vc_sans_date]
            nor_map = fetch_num_notices(vc_base_uids)

            enriched_dates = 0
            for vc_row in existing_vc_sans_date:
                vc_uid = vc_row["uid"]
                base_uid = vc_uid.replace("-VC", "")
                nor = nor_map.get(base_uid)
                if not nor:
                    continue
                try:
                    latest_date = fetch_loda_latest_date(nor, token)
                    if latest_date:
                        ecrire(
                            "UPDATE textes SET date_publication = %s WHERE uid = %s",
                            [f"{latest_date} 00:00:00", vc_uid],
                        )
                        enriched_dates += 1
                except Exception as e:
                    tqdm.write(f"  Erreur date VC {vc_uid}: {e}")
                time.sleep(RATE_LIMIT_PAUSE)

            if enriched_dates:
                print(f"   VC enrichies (date) : {enriched_dates}")

        print(f"\n   Consolidées : {success_vc} créée(s), {skip_vc} ignorée(s)")
    else:
        print("   Aucune version consolidée à créer.")

    # ── Passe 3 : Synchronisation du contenu des VC ─────────────────────────
    # Les VC peuvent être modifiées au fil du temps (modifications de loi).
    # Pour chaque VC : on demande la date de la dernière version à Légifrance ;
    # si plus récente que celle stockée, ou si contenu manquant, on re-fetch.
    #
    # Chaque nuit, seules les VC sans contenu passent. Le lundi (`VERIF_COMPLETE`), toutes
    # passent, pour rattraper les lois modifiées dans la semaine.

    print("\n5. Synchronisation du contenu des versions consolidées...")
    # `contenu_legifrance` n'est pas lu ici : on ne veut savoir que s'il est vide.
    # La seconde requête répond à la question en ne renvoyant que des uid.
    all_vcs = lire(
        _connexion(),
        "SELECT uid, lien_texte, date_publication, num_notice FROM textes "
        "WHERE is_version_consolidee = true ORDER BY uid",
    )

    vc_sans_contenu = {
        r["uid"]
        for r in lire(
            _connexion(),
            "SELECT uid FROM textes WHERE is_version_consolidee = true "
            "AND (contenu_legifrance IS NULL OR contenu_legifrance = '')",
        )
    }
    if not VERIF_COMPLETE:
        all_vcs = [vc for vc in all_vcs if vc["uid"] in vc_sans_contenu]

    # Mapping VC uid → NOR via la loi originale (les VC n'ont pas num_notice)
    base_uids = [vc["uid"].replace("-VC", "") for vc in all_vcs]
    nor_map = fetch_num_notices(base_uids)

    print(f"   {len(all_vcs)} VC à vérifier.")
    updated_vc = 0
    unchanged_vc = 0
    skip_vc_sync = 0

    if all_vcs:
        for vc in tqdm(all_vcs, desc="VC sync"):
            vc_uid = vc["uid"]
            base_uid = vc_uid.replace("-VC", "")
            jorftext_id = extract_jorftext_id(vc.get("lien_texte") or "")
            if not jorftext_id:
                skip_vc_sync += 1
                continue

            current_date = (vc.get("date_publication") or "")[:10]
            contenu_manquant = vc_uid in vc_sans_contenu
            nor = nor_map.get(base_uid)

            # Date la plus récente côté Légifrance
            latest_date = None
            try:
                if nor:
                    espacer_appels()
                    latest_date = fetch_loda_latest_date(nor, token)
            except requests.exceptions.HTTPError as e:
                if e.response is not None and e.response.status_code == 401:
                    token = get_access_token()
                    try:
                        latest_date = fetch_loda_latest_date(nor, token)
                    except Exception:
                        pass
            except Exception:
                pass

            target_date = latest_date or current_date
            needs_refresh = (
                contenu_manquant
                or (latest_date and latest_date != current_date)
            )

            if not needs_refresh or not target_date:
                unchanged_vc += 1
                continue

            data = None
            try:
                espacer_appels()
                data = fetch_loda_consolidee(jorftext_id, target_date, token)
            except requests.exceptions.HTTPError as e:
                if e.response is not None and e.response.status_code == 401:
                    token = get_access_token()
                    try:
                        data = fetch_loda_consolidee(jorftext_id, target_date, token)
                    except Exception as e2:
                        tqdm.write(f"  Erreur lawDecree {vc_uid}: {e2}")
                else:
                    tqdm.write(f"  Erreur lawDecree {vc_uid}: {e}")
            except Exception as e:
                tqdm.write(f"  Erreur lawDecree {vc_uid}: {e}")

            if data:
                contenu = extract_text_content(data)
                if contenu and len(contenu) > 100:
                    update_data = {"contenu_legifrance": contenu}
                    if latest_date and latest_date != current_date:
                        update_data["date_publication"] = f"{latest_date} 00:00:00"
                    try:
                        # Colonnes posées ci-dessus, jamais tirées d'une donnée.
                        ecrire(
                            f"UPDATE textes SET {', '.join(f'{c} = %s' for c in update_data)} WHERE uid = %s",
                            [*update_data.values(), vc_uid],
                        )
                        updated_vc += 1
                    except psycopg.Error as e:
                        tqdm.write(f"  Erreur update VC {vc_uid}: {e}")
                        skip_vc_sync += 1
                else:
                    skip_vc_sync += 1
            else:
                skip_vc_sync += 1

        print(f"   VC : {updated_vc} mise(s) à jour, {unchanged_vc} inchangée(s), {skip_vc_sync} ignorée(s)")

    # ── Résumé final ────────────────────────────────────────────────────────

    print("\n" + "=" * 60)
    print(f"RÉSULTAT JORF : {success_jorf} enrichi(s), {skip_jorf} ignoré(s)")
    print(f"RÉSULTAT CONSOLIDÉES : {success_vc} créée(s), {skip_vc} ignorée(s)")
    print(f"RÉSULTAT VC SYNC : {updated_vc} mise(s) à jour, {unchanged_vc} inchangée(s), {skip_vc_sync} ignorée(s)")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    finally:
        if _conn is not None:
            _conn.close()
