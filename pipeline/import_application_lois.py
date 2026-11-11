"""
import_application_lois.py
Importe les données d'application des lois depuis le baromètre de l'Assemblée Nationale.

Phase 1 : CSV baromètre AN → table application_lois (stats par loi)
Phase 2 : API Légifrance → tables textes + actes_legislatifs (contenu des décrets)
Phase 6 : Création d'actes synthétiques d'application (application directe / complète)

Usage : python import_application_lois.py
"""

import os
import sys
import csv
import io
import re
import time
import psycopg
import requests
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict
from dotenv import load_dotenv

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, lire  # noqa: E402
from _sync_cache import upsert_si_change  # noqa: E402
from _statuts import dossiers_appliques, verifier_statuts  # noqa: E402

# ── Configuration ─────────────────────────────────────────────────────────────

# Plus de client propre à ce script : les lectures passent par `_db` (connexion directe)
# et les écritures par `_sync_cache` (`upsert_si_change`), qui lisent leurs variables.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")

# Légifrance API (optionnel — si absent, on skip l'import des décrets)
LEGIFRANCE_CLIENT_ID = os.getenv("LEGIFRANCE_CLIENT_ID")
LEGIFRANCE_CLIENT_SECRET = os.getenv("LEGIFRANCE_CLIENT_SECRET")
OAUTH_URL = "https://oauth.piste.gouv.fr/api/oauth/token"
API_BASE = "https://api.piste.gouv.fr/dila/legifrance/lf-engine-app"
RATE_LIMIT_PAUSE = 0.6

CSV_LOIS_URL = "https://barometre.assemblee-nationale.fr/barometre_application_lois_assemblee.csv"
CSV_MESURES_URL = "https://barometre.assemblee-nationale.fr/barometre_application_mesures_assemblee.csv"


# ── Téléchargement des CSV ────────────────────────────────────────────────────

def download_csv(url: str) -> list[dict]:
    """Télécharge un CSV et retourne une liste de dictionnaires."""
    print(f"  Téléchargement : {url.split('/')[-1]}...")
    response = requests.get(url, timeout=60)
    response.raise_for_status()

    # Détecter l'encodage (UTF-8 ou latin-1)
    text = response.content.decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(text), delimiter=";")
    rows = list(reader)
    print(f"  → {len(rows)} lignes lues")
    return rows


# ── Calcul des délais depuis le CSV mesures ───────────────────────────────────

def compute_delays(mesures_rows: list[dict]) -> dict:
    """
    Calcule les délais d'application par loi (JORFTEXT).
    Retourne {jorftext_id: {moyen, min, max}} en jours.
    """
    delays_by_law: dict[str, list[int]] = defaultdict(list)

    for row in mesures_rows:
        jorftext = row.get("Identifiant loi", "").strip()
        delai_str = row.get("Délai d'application (en jours)", "").strip()
        etat = row.get("État", "").strip().lower()

        # On ne compte que les mesures appliquées avec un délai valide
        if not jorftext or not delai_str or etat != "appliqué":
            continue

        try:
            delai = int(delai_str)
            if delai >= 0:
                delays_by_law[jorftext].append(delai)
        except ValueError:
            continue

    result = {}
    for jorftext, delays in delays_by_law.items():
        result[jorftext] = {
            "moyen": round(sum(delays) / len(delays)),
            "min": min(delays),
            "max": max(delays),
        }

    print(f"  → Délais calculés pour {len(result)} lois")
    return result


# ── Lookup dossier_uid ────────────────────────────────────────────────────────

def build_dossier_lookup(conn) -> tuple[dict, dict]:
    """
    Construit deux tables de lookup pour matcher CSV → dossier_uid :
    1. uid_lookup : {uid: uid} — match direct par Identifiant Assemblée
    2. jorftext_lookup : {JORFTEXT_ID: dossier_ref} — match via textes.lien_texte
    """
    # 1. Tous les UIDs de dossiers
    print("  Chargement des dossiers depuis la base...")
    uid_set = {row["uid"] for row in lire(conn, "select uid from dossiers_legislatifs")}

    print(f"  → {len(uid_set)} dossiers en base")

    # 2. Textes LOI avec lien_texte contenant JORFTEXT → dossier_ref
    # Trié sur la clé primaire : deux textes qui citeraient le même JORFTEXT donnent
    # toujours le même gagnant (le dernier), au lieu de celui que le plan de requête sert.
    print("  Chargement des textes LOI depuis la base...")
    jorftext_lookup = {}
    for row in lire(
        conn,
        "select lien_texte, dossier_ref from textes"
        " where type_code = 'LOI' and lien_texte is not null order by uid",
    ):
        lien = row.get("lien_texte", "") or ""
        dossier_ref = row.get("dossier_ref", "")
        # Extraire le JORFTEXT ID de l'URL
        match = re.search(r"(JORFTEXT\d+)", lien)
        if match and dossier_ref:
            jorftext_lookup[match.group(1)] = dossier_ref

    print(f"  → {len(jorftext_lookup)} liens JORFTEXT → dossier trouvés")

    return uid_set, jorftext_lookup


# ── Calcul du statut ──────────────────────────────────────────────────────────

def compute_statut(row: dict) -> str:
    """Détermine le statut d'application d'une loi à partir des données CSV."""
    if row.get("Loi d'application directe", "").strip().lower() == "oui":
        return "application_directe"

    if row.get("Loi autorisant la ratification d'accords internationaux", "").strip().lower() == "oui":
        return "sans_objet"

    nb_attendues = parse_int(row.get("Nombre de mesures à appliquer", "0"))
    nb_appliquees = parse_int(row.get("Nombre de mesures appliquées", "0"))

    if nb_attendues == 0:
        return "sans_objet"

    if nb_appliquees >= nb_attendues:
        return "appliquee"
    elif nb_appliquees > 0:
        return "partiellement_appliquee"
    else:
        return "non_appliquee"


def parse_int(val: str) -> int:
    """Parse un entier depuis le CSV, retourne 0 si invalide."""
    try:
        return int(val.strip())
    except (ValueError, AttributeError):
        return 0


def parse_float(val: str) -> float:
    """Parse un float depuis le CSV (gère la virgule française)."""
    try:
        return float(val.strip().replace(",", "."))
    except (ValueError, AttributeError):
        return 0.0


def parse_date(val: str):
    """Parse une date DD/MM/YYYY ou YYYY-MM-DD."""
    val = val.strip()
    if not val:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(val, fmt).date().isoformat()
        except ValueError:
            continue
    return None


# ── Auth Légifrance ───────────────────────────────────────────────────────────

def get_legifrance_token() -> str | None:
    """Authentification OAuth2 Légifrance. Retourne le token ou None si clés absentes."""
    if not LEGIFRANCE_CLIENT_ID or not LEGIFRANCE_CLIENT_SECRET:
        return None
    resp = requests.post(OAUTH_URL, data={
        "grant_type": "client_credentials",
        "client_id": LEGIFRANCE_CLIENT_ID,
        "client_secret": LEGIFRANCE_CLIENT_SECRET,
        "scope": "openid",
    })
    resp.raise_for_status()
    return resp.json()["access_token"]


# ── Import des décrets ───────────────────────────────────────────────────────

def extract_decrets_from_mesures(mesures_rows: list[dict], loi_dossier_map: dict) -> dict[str, set[str]]:
    """
    Extrait les JORFTEXT uniques des décrets depuis le CSV mesures.
    Ne garde que les décrets dont la loi est matchée avec un dossier.
    Un même décret peut appliquer plusieurs lois → plusieurs dossiers.
    Retourne {decret_jorftext: set(dossier_uids)}
    """
    decret_to_dossiers: dict[str, set[str]] = defaultdict(set)
    for row in mesures_rows:
        loi_jorftext = row.get("Identifiant loi", "").strip()
        decret_jorftext = row.get("Identifiant décret", "").strip()
        if not decret_jorftext or not loi_jorftext:
            continue
        if loi_jorftext in loi_dossier_map:
            decret_to_dossiers[decret_jorftext].add(loi_dossier_map[loi_jorftext])
    return decret_to_dossiers


def get_existing_decrets(conn) -> set:
    """Retourne les UIDs des décrets déjà en base."""
    return {row["uid"] for row in lire(conn, "select uid from textes where type_code = 'DECRET'")}


def get_existing_decret_actes(conn) -> set[tuple[str, str]]:
    """Retourne les couples (texte_adopte, dossier_uid) des actes DECAPP-PUB existants."""
    return {
        (row["texte_adopte"], row["dossier_uid"])
        for row in lire(
            conn,
            "select texte_adopte, dossier_uid from actes_legislatifs"
            " where code_acte = 'DECAPP-PUB' and texte_adopte is not null",
        )
    }


def extract_articles_html(data: dict) -> str:
    """Extrait le contenu HTML de tous les articles d'un texte JORF."""
    parts = []

    def _collect(sections):
        for s in sections:
            for a in (s.get("articles") or []):
                num = a.get("num", "")
                content = a.get("content", "")
                if content:
                    parts.append(f"<h3>{num}</h3>\n{content}")
            _collect(s.get("sections") or [])

    _collect(data.get("sections") or [])
    for a in (data.get("articles") or []):
        num = a.get("num", "")
        content = a.get("content", "")
        if content:
            parts.append(f"<h3>{num}</h3>\n{content}")

    return "\n".join(parts)


def import_decrets(
    conn,
    mesures_rows: list[dict],
    loi_dossier_map: dict,
):
    """Phase 5 : importer le contenu des décrets via l'API Légifrance.

    Un même décret peut appliquer plusieurs lois (et donc plusieurs dossiers).
    - Texte : 1 seul enregistrement par décret (dossier_ref = premier dossier)
    - Actes : 1 DECAPP-PUB par couple (décret, dossier)

    Les textes partent un par un, au rythme de l'API Légifrance (un appel et 0,6 s de
    pause chacun). Les actes, eux, s'accumulent et partent en deux requêtes à la fin
    (étapes parentes d'abord), puisque rien de plus à attendre : un plantage en cours de
    route les laisserait à créer, et le passage suivant les retrouve (`actes_to_create`
    ne garde que les couples absents de la base).
    """
    print("\n5. Import des décrets d'application...")

    # 5a. Auth
    token = get_legifrance_token()
    if not token:
        print("  ⚠ Clés Légifrance absentes — import des décrets ignoré")
        return
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # 5b. Extraire les décrets uniques (1 décret → N dossiers)
    decret_to_dossiers = extract_decrets_from_mesures(mesures_rows, loi_dossier_map)
    total_pairs = sum(len(ds) for ds in decret_to_dossiers.values())
    multi = sum(1 for ds in decret_to_dossiers.values() if len(ds) > 1)
    print(f"  → {len(decret_to_dossiers)} décrets uniques, {total_pairs} couples (décret, dossier)")
    print(f"  → {multi} décrets appliquent plusieurs lois")

    # 5c. Charger l'existant : textes et actes séparément
    existing_textes = get_existing_decrets(conn)
    existing_actes = get_existing_decret_actes(conn)
    print(f"  → {len(existing_textes)} textes décrets en base, {len(existing_actes)} actes DECAPP-PUB en base")

    # Déterminer le travail à faire
    textes_to_fetch = set()  # JORFTEXT IDs dont le texte n'existe pas encore
    actes_to_create: dict[str, set[str]] = defaultdict(set)  # jorftext → dossiers manquants

    for jorftext_id, dossier_uids in decret_to_dossiers.items():
        texte_uid = f"DECRET_{jorftext_id}"
        if texte_uid not in existing_textes:
            textes_to_fetch.add(jorftext_id)
        for dossier_uid in dossier_uids:
            if (texte_uid, dossier_uid) not in existing_actes:
                actes_to_create[jorftext_id].add(dossier_uid)

    print(f"  → {len(textes_to_fetch)} textes à récupérer via API")
    print(f"  → {sum(len(ds) for ds in actes_to_create.values())} actes à créer")

    if not textes_to_fetch and not actes_to_create:
        print("  Rien à importer.")
        return

    # 5d. Cache des métadonnées API (pour les décrets dont on a besoin d'actes mais pas de texte)
    # On stocke title, date_parution pour créer les actes même si le texte existait déjà
    api_cache: dict[str, dict] = {}
    # Titre et date des décrets déjà en base dont il manque des actes : une seule lecture,
    # au lieu d'une par décret dans la boucle ci-dessous.
    deja_en_base = [
        f"DECRET_{j}" for j in sorted(set(actes_to_create) - textes_to_fetch)
    ]
    meta_en_base = {
        r["uid"]: {"title": r["titre_principal"], "date_parution": r["date_publication"]}
        for r in lire(
            conn,
            "select uid, titre_principal, date_publication from textes where uid = ANY(%s)",
            (deja_en_base,),
        )
    } if deja_en_base else {}

    # 5e. Récupérer les textes manquants via API et les insérer
    stats = {"textes_ok": 0, "actes_ok": 0, "api_errors": 0, "db_errors": 0}
    # Étapes parentes et actes à écrire, dans l'ordre où la boucle les construit. Les
    # étapes sont dédoublonnées par uid (une par dossier, partagée par ses décrets).
    etapes_a_ecrire: dict[str, dict] = {}
    actes_a_ecrire: list[dict] = []

    all_jorftext_ids = textes_to_fetch | set(actes_to_create.keys())
    for i, jorftext_id in enumerate(sorted(all_jorftext_ids)):
        texte_uid = f"DECRET_{jorftext_id}"
        need_api = jorftext_id in textes_to_fetch

        # Appel API seulement si le texte n'existe pas encore
        if need_api:
            try:
                resp = requests.post(
                    f"{API_BASE}/consult/jorf",
                    headers=headers,
                    json={"textCid": jorftext_id},
                )
                if resp.status_code != 200:
                    print(f"  API erreur {jorftext_id}: {resp.status_code}")
                    stats["api_errors"] += 1
                    time.sleep(RATE_LIMIT_PAUSE)
                    continue
            except Exception as e:
                print(f"  API exception {jorftext_id}: {e}")
                stats["api_errors"] += 1
                time.sleep(RATE_LIMIT_PAUSE)
                continue

            data = resp.json()
            title = data.get("title", "")
            nor = data.get("nor", "")
            contenu = extract_articles_html(data)

            decret_num_match = re.search(r"(Décret\s+n°\s*[\d\-]+)", title)
            denomination = decret_num_match.group(1) if decret_num_match else f"Décret ({nor})"

            date_parution = None
            if data.get("dateParution"):
                date_parution = datetime.fromtimestamp(
                    data["dateParution"] / 1000, tz=timezone.utc
                ).strftime("%Y-%m-%d %H:%M:%S")

            api_cache[jorftext_id] = {"title": title, "date_parution": date_parution}

            # Insérer le texte (dossier_ref = premier dossier par ordre alphabétique)
            dossier_ref = sorted(decret_to_dossiers[jorftext_id])[0]
            texte_payload = {
                "uid": texte_uid,
                "type_code": "DECRET",
                "type_libelle": "Décret d'application",
                "titre_principal": title,
                "date_publication": date_parution,
                "lien_texte": f"https://www.legifrance.gouv.fr/jorf/id/{jorftext_id}",
                "contenu_legifrance": contenu,
                "dossier_ref": dossier_ref,
                "legislature": 17,
                "provenance": "Légifrance",
                "denomination": denomination,
                "num_notice": nor,
                "url_accessible": True,
            }
            # La base n'écrit que si le texte a changé ; une ligne perdue est déjà
            # journalisée par `upsert_si_change`.
            _, perdues = upsert_si_change("textes", [texte_payload], "uid")
            if perdues:
                stats["db_errors"] += 1
            else:
                stats["textes_ok"] += 1

            time.sleep(RATE_LIMIT_PAUSE)

        # 5f. Créer les actes manquants pour chaque dossier
        if jorftext_id not in actes_to_create:
            continue

        # Récupérer les métadonnées (depuis API cache ou depuis la DB)
        meta = api_cache.get(jorftext_id)
        if not meta:
            # Le texte existait déjà : titre et date lus plus haut en base (repli vide
            # si, entre-temps, il a disparu).
            meta = meta_en_base.get(texte_uid) or {"title": "", "date_parution": None}

        for dossier_uid in sorted(actes_to_create[jorftext_id]):
            num_dossier_match = re.search(r"N(\d+)$", dossier_uid)
            num_dossier = num_dossier_match.group(1) if num_dossier_match else dossier_uid

            # Étape parente (une seule par dossier)
            etape_uid = f"L17-DECAPP-{num_dossier}"
            if etape_uid not in etapes_a_ecrire:
                etapes_a_ecrire[etape_uid] = {
                    "uid": etape_uid,
                    "dossier_uid": dossier_uid,
                    "code_acte": "DECAPP",
                    "libelle_acte": "Décrets d'application",
                    "type_acte": "Etape_Type",
                }

            # Acte du décret pour ce dossier
            acte_uid = f"L17-DECAPP-{jorftext_id}"
            actes_a_ecrire.append({
                "uid": acte_uid,
                "dossier_uid": dossier_uid,
                "code_acte": "DECAPP-PUB",
                "libelle_acte": "Publication d'un décret d'application",
                "type_acte": "PublicationDecret_Type",
                "date_acte": meta["date_parution"],
                "parent_uid": etape_uid,
                "texte_adopte": texte_uid,
                "titre_loi": meta["title"],
            })

        if (i + 1) % 10 == 0:
            print(f"  ... {i + 1}/{len(all_jorftext_ids)} décrets traités")

    # 5g. Étapes parentes, puis actes. Une ligne perdue est déjà journalisée par
    # `upsert_si_change` ; un acte perdu compte comme une erreur DB, une étape perdue non
    # (l'acte part quand même, comme avant).
    if etapes_a_ecrire:
        upsert_si_change("actes_legislatifs", list(etapes_a_ecrire.values()), "uid,dossier_uid")
    if actes_a_ecrire:
        _, perdus = upsert_si_change("actes_legislatifs", actes_a_ecrire, "uid,dossier_uid")
        stats["actes_ok"] += len(actes_a_ecrire) - len(perdus)
        stats["db_errors"] += len(perdus)

    print(f"  Textes insérés  : {stats['textes_ok']}")
    print(f"  Actes insérés   : {stats['actes_ok']}")
    print(f"  Erreurs API     : {stats['api_errors']}")
    print(f"  Erreurs DB      : {stats['db_errors']}")


# ── Actes synthétiques d'application ─────────────────────────────────────────

def insert_application_actes(conn):
    """
    Phase 6 : Crée des actes synthétiques dans actes_legislatifs pour signaler
    les jalons d'application des lois :
    - AN-APPLI-DIRECTE  : loi d'application directe
    - AN-APPLI-COMPLETE : loi entièrement appliquée (via décrets)
    """
    print("\n6. Création des actes d'application...")

    # 6a. Récupérer toutes les lois avec un dossier_uid
    rows = lire(
        conn,
        "select dossier_uid, application_directe, statut_application, date_publication"
        " from application_lois where dossier_uid is not null",
    )

    print(f"  → {len(rows)} lois avec dossier_uid trouvées")

    # 6b. Pré-charger les dates max des DECAPP-PUB par dossier (une seule requête, agrégée
    # par la base : seule la plus récente date de chaque dossier appliqué est utile)
    appliquee_uids = [r["dossier_uid"] for r in rows
                      if r.get("statut_application") == "appliquee" and not r.get("application_directe")]
    decapp_max_dates: dict[str, str] = {}
    if appliquee_uids:
        decapp_max_dates = {
            d["dossier_uid"]: d["date_max"]
            for d in lire(
                conn,
                "select dossier_uid, max(date_acte) as date_max from actes_legislatifs"
                " where code_acte = 'DECAPP-PUB' and date_acte is not null"
                " and dossier_uid = ANY(%s) group by dossier_uid",
                (appliquee_uids,),
            )
        }
        print(f"  → Dates max DECAPP-PUB trouvées pour {len(decapp_max_dates)} dossiers")

    # 6c. Construire les actes à insérer
    actes = []
    for row in rows:
        dossier_uid = row["dossier_uid"]
        num_dossier_match = re.search(r"N(\d+)$", dossier_uid)
        num_dossier = num_dossier_match.group(1) if num_dossier_match else dossier_uid

        if row.get("application_directe"):
            actes.append({
                "uid": f"L17-APPLI-DIRECTE-{num_dossier}",
                "dossier_uid": dossier_uid,
                "code_acte": "AN-APPLI-DIRECTE",
                "libelle_acte": "Loi d'application directe",
                "date_acte": row.get("date_publication"),
                "type_acte": "Application_Type",
            })
        elif row.get("statut_application") == "appliquee":
            date_acte = decapp_max_dates.get(dossier_uid) or row.get("date_publication")
            actes.append({
                "uid": f"L17-APPLI-COMPLETE-{num_dossier}",
                "dossier_uid": dossier_uid,
                "code_acte": "AN-APPLI-COMPLETE",
                "libelle_acte": "Application complète de la loi",
                "date_acte": date_acte,
                "type_acte": "Application_Type",
            })

    print(f"  → {len(actes)} actes candidats (directe + complète)")

    # 6d. Tous les actes partent, la base n'écrit que les nouveaux ou modifiés
    ecrites, perdus = upsert_si_change("actes_legislatifs", actes, "uid,dossier_uid") if actes else (0, [])

    print(f"  Actes insérés     : {ecrites}")
    print(f"  Inchangés         : {len(actes) - ecrites - len(perdus)}")
    print(f"  Erreurs DB        : {len(perdus)}")


# ── Import principal ──────────────────────────────────────────────────────────

def passer_en_appliquee(conn) -> int:
    """Passe à « Appliquée » les dossiers « Promulguée » qui portent un acte
    d'application (`dossiers_appliques`). Rend le nombre de lignes passées.
    Appelée par `main`, étape 7, après la création des actes synthétiques.
    """
    updated = 0
    try:
        appli_uids = sorted(dossiers_appliques(conn))

        if appli_uids:
            # Une seule requête : `= ANY(…)` n'a pas la limite d'adresse de l'ancien
            # `in.(…)`, qui obligeait à découper par lots de 200. La condition sur
            # `statut_final` reste dans la requête : un dossier déjà passé à un autre
            # statut n'est pas touché.
            with conn.transaction(), conn.cursor() as cur:
                cur.execute(
                    "UPDATE dossiers_legislatifs SET statut_final = 'Appliquée'"
                    " WHERE uid = ANY(%s) AND statut_final = 'Promulguée'",
                    (appli_uids,),
                )
                updated = cur.rowcount
            print(f"  → {len(appli_uids)} dossiers éligibles, {updated} passés à « Appliquée »")
        else:
            print("  → Aucun dossier à mettre à jour")
    except Exception as e:
        print(f"  Erreur lors de la mise à jour statut_final: {e}")
    return updated


def main():
    print("=" * 60)
    print("IMPORT APPLICATION DES LOIS — Baromètre AN")
    print("=" * 60)

    # 1. Télécharger les CSV
    print("\n1. Téléchargement des CSV...")
    lois_rows = download_csv(CSV_LOIS_URL)
    mesures_rows = download_csv(CSV_MESURES_URL)

    # 2. Calculer les délais depuis le CSV mesures
    print("\n2. Calcul des délais d'application...")
    delays = compute_delays(mesures_rows)

    # 3. Construire les lookups dossier
    print("\n3. Construction des lookups dossier...")
    # Autocommit : la connexion reste ouverte pendant les appels à l'API Légifrance (des
    # minutes), et une transaction ouverte par la première lecture y resterait « idle in
    # transaction ». Les écritures passent par la connexion de `_sync_cache`.
    conn = connexion(autocommit=True)
    uid_set, jorftext_lookup = build_dossier_lookup(conn)

    # 4. Traiter chaque loi
    print("\n4. Traitement des lois...")

    stats = {
        "total": 0,
        "matched": 0,
        "unmatched": 0,
        "upserted": 0,
        "skipped_unchanged": 0,
        "errors": 0,
    }
    # Une ligne par loi, écrites ensemble après la boucle. Indexées par JORFTEXT : un
    # doublon dans le CSV garde sa dernière ligne, comme l'écriture une à une d'avant,
    # et ne fait pas échouer le lot (« cannot affect row a second time »).
    records: dict[str, dict] = {}
    # Mapping JORFTEXT loi → dossier_uid (pour la phase 5)
    loi_dossier_map = {}

    for row in lois_rows:
        stats["total"] += 1
        jorftext = row.get("Identifiant Légifrance de la loi", "").strip()
        if not jorftext:
            continue

        # Chercher le dossier_uid
        an_id = row.get("Identifiant Assemblée du dossier législatif", "").strip()
        dossier_uid = None

        # Match 1 : ID Assemblée direct
        if an_id and an_id in uid_set:
            dossier_uid = an_id
        # Match 2 : via JORFTEXT → textes → dossier_ref
        elif jorftext in jorftext_lookup:
            ref = jorftext_lookup[jorftext]
            if ref in uid_set:
                dossier_uid = ref

        if dossier_uid:
            stats["matched"] += 1
            loi_dossier_map[jorftext] = dossier_uid
        else:
            stats["unmatched"] += 1

        # Données CSV
        nb_attendues = parse_int(row.get("Nombre de mesures à appliquer", "0"))
        nb_appliquees = parse_int(row.get("Nombre de mesures appliquées", "0"))
        taux = parse_float(row.get("Taux d'application des mesures", "0"))
        legislature = parse_int(row.get("Législature", "0")) or None

        # Délais depuis CSV mesures
        law_delays = delays.get(jorftext, {})

        record = {
            "jorftext_id": jorftext,
            "dossier_uid": dossier_uid,
            "titre": row.get("Titre de la loi", "").strip() or None,
            "legislature": legislature,
            "date_publication": parse_date(row.get("Date de publication de la loi", "")),
            "application_directe": row.get("Loi d'application directe", "").strip().lower() == "oui",
            "sans_echeancier": row.get("Loi sans échéancier", "").strip().lower() == "oui",
            "ratification_accord": row.get("Loi autorisant la ratification d'accords internationaux", "").strip().lower() == "oui",
            "habilitation_ordonnances": row.get("Loi d'habilitation (ordonnances)", "").strip().lower() == "oui",
            "ratification_ordonnances": row.get("Loi de ratification (ordonnances)", "").strip().lower() == "oui",
            "nb_mesures_attendues": nb_attendues,
            "nb_mesures_appliquees": nb_appliquees,
            "taux_application": taux,
            "delai_moyen_jours": law_delays.get("moyen"),
            "delai_min_jours": law_delays.get("min"),
            "delai_max_jours": law_delays.get("max"),
            "statut_application": compute_statut(row),
            "derniere_maj": datetime.now(tz=timezone.utc).isoformat(),
        }

        records[jorftext] = record

    # `derniere_maj` vaut l'heure du run par construction : comparée, elle ferait réécrire
    # toutes les lignes chaque nuit. Hors de la comparaison, elle n'est réécrite que
    # quand une autre colonne de la ligne change, comme avec l'ancien cache d'empreintes.
    ecrites, perdues = upsert_si_change(
        "application_lois", list(records.values()), "jorftext_id",
        sans_comparer=("derniere_maj",), cle="jorftext_id",
    )
    stats["upserted"] = ecrites
    stats["errors"] = len(perdues)
    stats["skipped_unchanged"] = len(records) - ecrites - len(perdues)

    # 5. Import des décrets d'application via API Légifrance
    import_decrets(conn, mesures_rows, loi_dossier_map)

    # 6. Création des actes synthétiques d'application
    insert_application_actes(conn)

    # 7. Mise à jour statut_final → "Appliquée" pour les lois appliquées
    print("\n7. Mise à jour statut_final → Appliquée...")
    # Hors du `try` de `passer_en_appliquee`, qui avalerait l'erreur : un libellé retiré du site
    # doit arrêter le script (voir `_statuts.py`).
    verifier_statuts([{"uid": "application des lois", "statut_final": "Appliquée"}])
    passer_en_appliquee(conn)

    # 8. Résumé
    print(f"\n{'=' * 60}")
    print("RÉSUMÉ")
    print(f"{'=' * 60}")
    print(f"  Total lois dans le CSV  : {stats['total']}")
    print(f"  Matchées avec dossier   : {stats['matched']}")
    print(f"  Non matchées (pas en DB): {stats['unmatched']}")
    print(f"  Upsertées               : {stats['upserted']}")
    print(f"  Inchangées (skip)       : {stats['skipped_unchanged']}")
    print(f"  Erreurs                  : {stats['errors']}")

    print("\nDistribution par statut :")
    try:
        par_statut = {
            r["statut_application"]: r["n"]
            for r in lire(conn, "select statut_application, count(*) as n from application_lois group by 1")
        }
        for statut in ["appliquee", "partiellement_appliquee", "non_appliquee",
                        "application_directe", "sans_objet", "inconnu"]:
            print(f"  {statut}: {par_statut.get(statut, 0)}")
    except psycopg.Error:
        pass
    conn.close()


if __name__ == "__main__":
    main()
