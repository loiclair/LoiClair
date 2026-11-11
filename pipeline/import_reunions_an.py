# import_reunions_an.py
# Importe les réunions de commission de l'AN (17e législature) et les présences
# nominatives associées dans la base.
#
# Source : https://data.assemblee-nationale.fr/static/openData/repository/17/vp/reunions/Agenda.json.zip
# Tables peuplées :
#   • commission_reunions   (1 ligne par réunion confirmée avec feuille de présence)
#   • commission_presences  (1 ligne par participant nominatif, statut present/excuse)
#   • commission_reunions_dossiers (réunion ↔ dossier examiné, lu dans l'ordre du jour)
#
# À la fin, recalcule acteurs.nb_commission_presences (count(*) par acteur, statut='present').
#
# Filtre strict (validé empiriquement à >99% de pureté dans le POC) :
#   - @xsi:type == "reunionCommission_type"
#   - cycleDeVie.etat == "Confirmé"
#   - participants.participantsInternes non-null
#
# Exécuter avec : python import_reunions_an.py

import io
import json
import sys
import zipfile
from pathlib import Path

import requests
from dotenv import load_dotenv
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _db import connexion, mettre_a_jour  # noqa: E402
from _sync_cache import (
    NotModified,
    confirmer_import,
    download_zip_if_modified,
    upsert_si_change,
)

# ===================================================================
# Configuration
# ===================================================================

URL_AGENDA = "https://data.assemblee-nationale.fr/static/openData/repository/17/vp/reunions/Agenda.json.zip"

# Mapping de la valeur "presence" du JSON AN vers notre enum statut
PRESENCE_TO_STATUT = {
    "présent": "present",
    "excusé": "excuse",
}

# ===================================================================
# Écritures en base
# ===================================================================

# Plus de client propre à ce script : les écritures passent par `_sync_cache`
# (`upsert_si_change`) et `_db` (connexion directe), qui lisent leurs propres variables.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")


# ===================================================================
# Helpers
# ===================================================================

def upsert_batch(table: str, rows: list, conflict: str) -> tuple[int, list[dict]]:
    """Upsert de `rows`, et rend `(lignes écrites, lignes perdues)`.

    La base n'écrit que les lignes nouvelles ou changées (`upsert_si_change`), et le
    découpage en lots d'environ 1 Mo est le sien. Un lot rejeté ne perd que ses lignes
    fautives, et une coupure réseau est rejouée.

    La colonne citée dans le journal d'une ligne perdue est la dernière de `conflict` :
    `uid` pour les réunions, `acteur_uid` pour les présences, qui n'ont pas d'`uid` et
    s'afficheraient sinon « None ».
    """
    cle = conflict.split(",")[-1]
    return upsert_si_change(table, rows, conflict, cle=cle, journal=tqdm.write)


def normalize_participants(pi_node) -> list[dict]:
    """Renvoie toujours une liste de dicts (gère single dict / liste / null)."""
    if not pi_node:
        return []
    inner = pi_node.get("participantInterne") if isinstance(pi_node, dict) else None
    if inner is None:
        return []
    if isinstance(inner, dict):
        return [inner]
    if isinstance(inner, list):
        return [p for p in inner if isinstance(p, dict)]
    return []


def extract_date(timestamp: str | None) -> str | None:
    """Extrait la date (YYYY-MM-DD) depuis un timestamp ISO."""
    if not timestamp or not isinstance(timestamp, str):
        return None
    return timestamp[:10] if len(timestamp) >= 10 else None


# ===================================================================
# Pipeline principal
# ===================================================================

def importer_reunions(zip_ref: zipfile.ZipFile) -> int:
    """Importe les réunions et présences du ZIP agenda.

    Retourne le nombre de lignes perdues en écriture. L'appelant s'en sert pour ne
    pas confirmer le cache HTTP sur un import partiel : la source serait marquée
    « vue » alors qu'une partie n'a pas été écrite, et la nuit suivante répondrait
    « inchangé, rien à faire ».

    Toutes les réunions et présences du ZIP partent à chaque passe : la base écarte
    elle-même celles qui n'ont pas changé.
    """
    json_files = [
        f for f in zip_ref.namelist()
        if f.endswith(".json") and "reunion/" in f
    ]
    print(f"\n{len(json_files)} fichiers reunion/*.json dans le ZIP\n")

    reunions_payloads: list[dict] = []
    presences_payloads: list[dict] = []
    # Compteur acteur → nb présences sur l'ensemble parsé : _update_compteur_acteurs
    # recompte à chaque run.
    presences_counts: dict[str, int] = {}
    # Réunion retenue → dossiers de son ordre du jour (ensemble vide compris), pour
    # `_ecrire_liens_dossiers`, dont la réconciliation compare elle-même à la base.
    liens: dict[str, set[str]] = {}
    skipped_type = 0
    skipped_etat = 0
    skipped_no_participants = 0
    skipped_invalid_date = 0

    for file_name in tqdm(json_files, desc="Parsing réunions", unit="fichier"):
        try:
            with zip_ref.open(file_name) as f:
                data = json.load(f)
        except Exception as e:
            tqdm.write(f"❌ Erreur lecture {file_name}: {e}")
            continue

        r = data.get("reunion") or {}
        if r.get("@xsi:type") != "reunionCommission_type":
            skipped_type += 1
            continue
        if (r.get("cycleDeVie") or {}).get("etat") != "Confirmé":
            skipped_etat += 1
            continue

        participants_section = r.get("participants") or {}
        participants = normalize_participants(participants_section.get("participantsInternes"))
        if not participants:
            skipped_no_participants += 1
            continue

        reunion_uid_raw = r.get("uid")
        if not reunion_uid_raw:
            continue
        date_reunion = extract_date(r.get("timeStampDebut"))
        if not date_reunion:
            skipped_invalid_date += 1
            continue

        reunion_uid = f"AN:{reunion_uid_raw}"
        organe_ref = r.get("organeReuniRef")
        liens[reunion_uid] = dossiers_de_l_odj(r)

        reunion_payload = {
            "uid": reunion_uid,
            "chambre": "AN",
            "organe_ref": organe_ref,
            "date_reunion": date_reunion,
            "type_reunion": None,
            "url_source": None,
        }
        reunions_payloads.append(reunion_payload)

        seen_acteurs: set[str] = set()
        for p in participants:
            acteur_ref = p.get("acteurRef")
            presence_raw = (p.get("presence") or "").strip().lower()
            statut = PRESENCE_TO_STATUT.get(presence_raw)
            if not acteur_ref or not statut:
                continue
            if acteur_ref in seen_acteurs:
                continue
            seen_acteurs.add(acteur_ref)
            presence_payload = {
                "reunion_uid": reunion_uid,
                "acteur_uid": acteur_ref,
                "statut": statut,
            }
            if statut == "present":
                presences_counts[acteur_ref] = presences_counts.get(acteur_ref, 0) + 1
            presences_payloads.append(presence_payload)

    print(f"\n   Réunions retenues            : {len(reunions_payloads)}")
    print(f"   Présences retenues           : {len(presences_payloads)}")
    print(f"   Skip — mauvais type          : {skipped_type}")
    print(f"   Skip — etat ≠ Confirmé       : {skipped_etat}")
    print(f"   Skip — sans participants     : {skipped_no_participants}")
    print(f"   Skip — date invalide         : {skipped_invalid_date}")

    perdues: list[dict] = []
    if reunions_payloads:
        print("\n📤 Upload réunions vers la base …")
        ecrites, perdues_reunions = upsert_batch("commission_reunions", reunions_payloads, conflict="uid")
        print(f"   {ecrites} réunion(s) écrite(s) (nouvelles ou changées)")
        perdues += perdues_reunions

    if presences_payloads:
        print("\n📤 Upload présences vers la base …")
        ecrites, perdues_presences = upsert_batch(
            "commission_presences", presences_payloads, conflict="reunion_uid,acteur_uid"
        )
        print(f"   {ecrites} présence(s) écrite(s) (nouvelles ou changées)")
        perdues += perdues_presences

    print("\n🔄 Recalcul acteurs.nb_commission_presences (députés)")
    _update_compteur_acteurs(presences_counts)

    print("\n🔗 Réunions ↔ dossiers (commission_reunions_dossiers)")
    _ecrire_liens_dossiers(liens)
    return len(perdues)


def dossiers_de_l_odj(reunion: dict) -> set[str]:
    """Dossiers législatifs examinés par une réunion, lus dans son ordre du jour.

    `ODJ.pointsODJ.pointODJ` est un objet seul, une liste ou absent, et
    `dossiersLegislatifsRefs.dossierRef` une chaîne ou une liste : le JSON de
    l'Assemblée réduit toute liste d'un élément à son élément. Au 2026-10-26, 1 051
    des 3 499 réunions retenues nomment au moins un dossier, 463 dossiers en tout.
    """
    points = (((reunion.get("ODJ") or {}).get("pointsODJ") or {}).get("pointODJ"))
    if isinstance(points, dict):
        points = [points]
    dossiers: set[str] = set()
    for point in points if isinstance(points, list) else []:
        refs = ((point or {}).get("dossiersLegislatifsRefs") or {}).get("dossierRef")
        for ref in refs if isinstance(refs, list) else [refs]:
            if isinstance(ref, str) and ref.strip():
                dossiers.add(ref.strip())
    return dossiers


# Le lien n'a que deux colonnes : 1 000 lignes tiennent dans une requête courte.
TAILLE_LOT_LIENS = 1000


def _ecrire_liens_dossiers(liens: dict[str, set[str]]) -> None:
    """Réconcilie `commission_reunions_dossiers` avec l'ordre du jour du ZIP.

    Lue par la vue `dossier_presences_elus`, qui en tire les présences d'un député sur
    un texte. Seules les réunions du ZIP sont réconciliées : leurs liens absents de la
    base sont ajoutés, ceux que l'ordre du jour ne nomme plus sont retirés. Une réunion
    absente du ZIP garde ses liens, comme elle garde ses présences.

    Deux filtres, tous deux imposés par les clés étrangères : le dossier doit exister
    dans `dossiers_legislatifs` (l'agenda nomme aussi des dossiers que la base ne
    connaît pas), et la réunion dans `commission_reunions` (une réunion perdue en
    écriture plus haut n'y est pas). Une lecture par filtre, une requête par lot :
    jamais une requête par réunion. Une erreur lève, et le script sort en 1 sans
    confirmer le cache HTTP.
    """
    tous_dossiers = sorted({d for ds in liens.values() for d in ds})
    with connexion() as conn:
        connus = {u for (u,) in conn.execute(
            "select uid from dossiers_legislatifs where uid = any(%s)", (tous_dossiers,))}
        en_base_reunions = {u for (u,) in conn.execute(
            "select uid from commission_reunions where uid = any(%s)", (sorted(liens),))}
        existants = set(conn.execute(
            "select reunion_uid, dossier_uid from commission_reunions_dossiers"
            " where reunion_uid = any(%s)", (sorted(liens),)).fetchall())

    voulus = {
        (r, d) for r, ds in liens.items() if r in en_base_reunions
        for d in ds if d in connus
    }
    a_ajouter = sorted(voulus - existants)
    a_retirer = sorted(existants - voulus)
    ignores = len(set(tous_dossiers) - connus)

    for paires, sql in (
        (a_ajouter, "insert into commission_reunions_dossiers (reunion_uid, dossier_uid)"
                    " select * from unnest(%s::text[], %s::text[]) on conflict do nothing"),
        (a_retirer, "delete from commission_reunions_dossiers t"
                    " using unnest(%s::text[], %s::text[]) as v(r, d)"
                    " where t.reunion_uid = v.r and t.dossier_uid = v.d"),
    ):
        for i in range(0, len(paires), TAILLE_LOT_LIENS):
            lot = paires[i : i + TAILLE_LOT_LIENS]
            with connexion() as conn, conn.transaction():
                conn.execute(sql, ([r for r, _ in lot], [d for _, d in lot]))

    print(f"   {len(voulus)} liens voulus ({len({r for r, _ in voulus})} réunions, "
          f"{len({d for _, d in voulus})} dossiers) : {len(a_ajouter)} ajouté(s), "
          f"{len(a_retirer)} retiré(s)"
          + (f" ; {ignores} dossier(s) de l'agenda inconnus de la base" if ignores else ""))


def _update_compteur_acteurs(counts: dict[str, int]) -> None:
    """Écrit acteurs.nb_commission_presences en une requête, remise à zéro comprise.

    La remise à zéro ne touche que les compteurs **non nuls** de députés en exercice
    absents du comptage : un `null` veut dire « pas de commission » (D-033) et sort du
    score, un zéro veut dire « siège mais n'y va pas ». Les confondre changerait le
    score des présidents de l'Assemblée et de certains présidents de groupe.
    `_db.mettre_a_jour` laisse les NULL en place pour cette raison.

    Sans elle, un député qui disparaît de la feuille de présence garderait indéfiniment sa
    vieille valeur. Même patron que `recalc_nb_prises_parole()` (D-036). Une erreur
    lève : le script sort alors en 1 sans confirmer le cache HTTP.

    Les élus que `sync_senat.py` compte sont écartés : tout acteur qui porte un matricule
    du Sénat sans être député en exercice (sénateurs en exercice, et anciens sénateurs
    que le Sénat compte encore). L'agenda de l'Assemblée liste les sénateurs dans les
    commissions mixtes paritaires, et 234 d'entre eux y figuraient le 2026-09-30 : ce
    script écrivait alors leur compteur avec le décompte de l'Assemblée, que
    `sync_senat.py` remplaçait par le sien une étape plus loin. Chaque nuit, deux
    écritures inutiles, et entre les deux un chiffre faux sur leur fiche.
    """
    with connexion() as conn:
        senateurs = {
            uid for (uid,) in conn.execute(
                "select uid from acteurs"
                " where matricule_senat is not null and not coalesce(est_depute_actuel, false)"
            )
        }
        lignes = [
            {"uid": uid, "nb_commission_presences": cnt}
            for uid, cnt in sorted(counts.items())
            if uid not in senateurs
        ]
        n = mettre_a_jour(
            conn, "acteurs", "uid", {"nb_commission_presences": "int"}, lignes,
            remise_a_zero="t.est_depute_actuel",
        )
    print(f"   Acteurs avec au moins 1 présence : {len(counts)}, {n} ligne(s) modifiée(s)")


# ===================================================================
# Main
# ===================================================================

if __name__ == "__main__":
    print("=" * 60)
    print("   IMPORT RÉUNIONS DE COMMISSION AN")
    print("=" * 60)
    try:
        zip_ref = download_zip_if_modified(URL_AGENDA)
    except NotModified:
        print(f"ZIP inchangé pour {URL_AGENDA} — on passe.\n")
        sys.exit(0)
    erreurs = importer_reunions(zip_ref)
    print("\n✅ Import terminé.")

    # Le cache ne se confirme que sur un import complet : autrement la source passe
    # pour « vue » et les présences perdues ne seraient jamais retentées.
    if erreurs:
        print(f"❌ {erreurs} ligne(s) de réunions ou de présences perdues en écriture.")
        sys.exit(1)

    confirmer_import(URL_AGENDA)
