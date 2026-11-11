"""
generate_circonscriptions_mapping.py
====================================

One-shot : génère public/data/circonscriptions.json — mapping CP → circonscription
législative (métropole + DROM-COM).

Sources data.gouv.fr (Min. Intérieur 2024 + La Poste) :
  1. Liste des candidats 1er tour législatives 2024
     → (Code département, Nom candidat) → Code circonscription
  2. Résultats par bureau de vote 1er tour législatives 2024 (~100 MB)
     → (Code département, Code commune INSEE) × Nom candidat panneau 1
  3. Base officielle des codes postaux (La Poste)
     → CP → Code commune INSEE

Algorithme :
  • candidates.csv : pour chaque circo, capture le candidat panneau 1 → map
    (dept, panneau_1, candidat_nom) → circo. (Le panneau 1 est unique par circo.)
  • bureau-de-vote.csv : pour chaque BV, on connaît (dept, commune INSEE,
    candidat panneau 1). On recouple → on obtient (dept, commune) → circo.
  • Une commune INSEE peut être dans plusieurs circos (Paris, Marseille…) :
    on conserve toutes les circos rencontrées en SET.
  • La Poste : (CP, INSEE) → on génère 1 ligne par circo possible.

Format de sortie aligné sur la base (acteurs.num_departement / num_circo) :
  - dept : str ("75", "06", "2A", "977"…)
  - circo : str ("1", "2", "10"…)

Usage :
    python "pipeline/generate_circonscriptions_mapping.py"

Le fichier généré (~3 MB JSON, ~700 KB gzipped) est lu côté serveur uniquement.
À ré-exécuter manuellement après chaque redécoupage électoral (~tous les 10 ans).
"""

from __future__ import annotations

import csv
import io
import json
import ssl
import sys
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path

# Les certificats Python sur macOS sont parfois manquants ; on désactive la
# vérification (sources publiques data.gouv.fr / La Poste, données non-sensibles).
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE

# Sources data.gouv.fr — URLs vérifiées 2026-05
URL_CANDIDATS = (
    "https://static.data.gouv.fr/resources/"
    "elections-legislatives-des-30-juin-et-7-juillet-2024-liste-des-candidats-du-1er-tour/"
    "20240628-172440/legislatives-2024-candidatures-france-entiere-tour-1-2024-06-28.csv"
)

URL_BUREAUX_VOTE = (
    "https://static.data.gouv.fr/resources/"
    "elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/"
    "20240710-171445/resultats-definitifs-par-bureau-de-vote.csv"
)

URL_CODES_POSTAUX = (
    "https://datanova.laposte.fr/data-fair/api/v1/datasets/laposte-hexasmal/raw"
)

OUT_PATH = Path(__file__).parent.parent / "public" / "data" / "circonscriptions.json"


def fetch_text(url: str, encoding: str = "utf-8") -> str:
    print(f"  → download {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "loiclair-mapping/1.0"})
    with urllib.request.urlopen(req, timeout=300, context=SSL_CTX) as resp:
        raw = resp.read()
    print(f"    → {len(raw):,} octets reçus")
    # Auto-detect encoding : essaie UTF-8 puis tombe sur Latin-1 si invalide.
    if encoding == "auto":
        try:
            raw.decode("utf-8")
            encoding = "utf-8"
        except UnicodeDecodeError:
            encoding = "latin-1"
    try:
        return raw.decode(encoding, errors="strict")
    except UnicodeDecodeError:
        # Fallback : remplace les caractères invalides
        return raw.decode(encoding, errors="replace")


def normalize_dept(code: str) -> str:
    code = (code or "").strip().upper()
    if not code:
        return ""
    if len(code) == 1 and code.isdigit():
        return "0" + code
    return code


def normalize_circo(value: str) -> str:
    value = (value or "").strip().lstrip("0")
    return value or "0"


def parse_csv(text: str) -> list[dict[str, str]]:
    sample = text[:4096]
    sep = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=sep)
    return list(reader)


def main() -> int:
    print("\n=== Génération CP → circonscription (legislatives 2024) ===\n")

    # ── Étape 1 : candidats → (dept, candidat_nom_norm) → circo ──────────
    print("[1/4] Candidats 1er tour…")
    candidats_text = fetch_text(URL_CANDIDATS, encoding="auto")
    candidats_rows = parse_csv(candidats_text)
    print(f"    → {len(candidats_rows)} candidats")

    # On indexe : (dept, panneau_num, candidate_name) → circo. Le numéro de
    # panneau seul ne suffit pas (il est commun à toutes les circos) ; mais
    # combiné au nom de famille du candidat, l'identification est unique.
    # On indexe par dept_raw (format Min. Intérieur, ex "1", "10", "2A", "ZA")
    # car bureau-de-vote.csv utilise le même format.
    candidat_to_circo: dict[tuple[str, str], str] = {}
    for r in candidats_rows:
        dept_raw = (r.get("Code département", "") or "").strip().upper()
        circo_raw = (r.get("Code circonscription", "") or "").strip()
        # "101" → dept 1, circo 1 ; "7510" → dept 75, circo 10 ; "ZA01" → dept ZA, circo 1
        if circo_raw and circo_raw[-2:].isdigit():
            circo = normalize_circo(circo_raw[-2:])
        else:
            continue
        nom = (r.get("Nom du candidat", "") or "").strip().upper()
        if not dept_raw or not nom:
            continue
        candidat_to_circo[(dept_raw, nom)] = circo
    print(f"    → {len(candidat_to_circo)} clés (dept, nom_candidat) indexées")

    # ── Étape 2 : bureaux de vote → (dept, commune) → set(circo) ─────────
    print("\n[2/4] Bureaux de vote (~37 MB)…")
    bv_text = fetch_text(URL_BUREAUX_VOTE, encoding="auto")
    bv_rows = parse_csv(bv_text)
    print(f"    → {len(bv_rows)} bureaux de vote")

    # Codes ZA-ZX du Min. Intérieur → codes INSEE DROM/COM
    DOM_MAP = {"ZA": "971", "ZB": "972", "ZC": "973", "ZD": "974",
               "ZM": "976", "ZS": "975", "ZN": "988", "ZP": "987",
               "ZW": "986", "ZX": "977"}

    # Big cities split en arrondissements administratifs : la Poste utilise
    # les INSEE des arrondissements (75101…), mais le Min. Intérieur n'utilise
    # que l'INSEE de la commune-mère (75056). On dérive l'arrondissement
    # depuis le Code BV (1xx = 1er arr., 2xx = 2e arr., etc.).
    BIG_CITY_PREFIX = {
        "75056": "751",   # Paris → 75101..75120
        "13055": "132",   # Marseille → 13201..13216
        "69123": "693",   # Lyon → 69381..69389
    }

    commune_to_circos: dict[tuple[str, str], set[str]] = defaultdict(set)
    matched = 0
    unmatched = 0
    for r in bv_rows:
        dept_raw = (r.get("Code département", "") or "").strip().upper()
        insee_raw = (r.get("Code commune", "") or "").strip()
        bv = (r.get("Code BV", "") or "").strip()
        if not dept_raw or not insee_raw:
            continue
        if dept_raw == "ZZ":  # Français de l'étranger : non pertinent
            continue

        # Normalise dept au format INSEE
        if dept_raw in DOM_MAP:
            dept = DOM_MAP[dept_raw]
        elif dept_raw in ("2A", "2B"):
            dept = dept_raw
        elif dept_raw.isdigit():
            dept = dept_raw.zfill(2)
        else:
            dept = dept_raw

        # Normalise insee : zfill à 5 chars si tout-numérique (Min. Intérieur
        # strippe parfois le leading zero du préfixe dept).
        if insee_raw.isdigit():
            insee = insee_raw.zfill(5)
        else:
            insee = insee_raw

        # Dérive l'arrondissement pour Paris/Marseille/Lyon (BV "1xx"/"2xx"…)
        if insee in BIG_CITY_PREFIX:
            arr = None
            if bv.isdigit() and len(bv) >= 3:
                arr = int(bv[:-2]) if len(bv) >= 3 else None
            elif bv.isdigit() and len(bv) == 2:
                arr = int(bv[:1])
            if arr and arr > 0:
                if insee == "75056":
                    insee = f"75{arr+100:03d}"  # 1→75101, 20→75120
                elif insee == "13055":
                    insee = f"13{arr+200:03d}"  # 1→13201, 16→13216
                elif insee == "69123":
                    insee = f"69{arr+380:03d}"  # 1→69381, 9→69389

        # On essaye plusieurs panneaux pour augmenter la robustesse face aux
        # noms tronqués/typos. Dès qu'un match propre, on stocke le circo.
        found = None
        for n in (1, 2, 3, 4, 5):
            nom = (r.get(f"Nom candidat {n}", "") or "").strip().upper()
            if not nom:
                continue
            circo = candidat_to_circo.get((dept_raw, nom))
            if circo:
                found = circo
                break
        if found is None:
            unmatched += 1
            continue

        commune_to_circos[(dept, insee)].add(found)
        matched += 1

    print(f"    → {matched:,} bureaux matchés, {unmatched:,} non matchés ({100*unmatched/(matched+unmatched):.1f}%)")
    print(f"    → {len(commune_to_circos):,} couples (dept, commune INSEE) uniques")
    multi = sum(1 for v in commune_to_circos.values() if len(v) > 1)
    print(f"    → dont {multi:,} communes dans plusieurs circos (Paris, Marseille, Lyon…)")

    # ── Étape 3 : codes postaux La Poste → CP → INSEE ────────────────────
    print("\n[3/4] Codes postaux La Poste…")
    cp_text = fetch_text(URL_CODES_POSTAUX, encoding="latin-1")
    # Header La Poste commence par '#Code_commune_INSEE' — on retire le '#'
    if cp_text.startswith("#"):
        cp_text = cp_text[1:]
    cp_rows = parse_csv(cp_text)
    print(f"    → {len(cp_rows)} entrées CP")

    # ── Étape 4 : LEFT JOIN CP × commune × circo ─────────────────────────
    print("\n[4/4] LEFT JOIN CP × commune × circo…")
    seen: set[tuple[str, str, str]] = set()  # déduplication (cp, insee, circo)
    communes_out: list[dict[str, str]] = []
    skipped = 0
    for r in cp_rows:
        cp = (r.get("Code_postal") or "").strip()
        insee = (r.get("Code_commune_INSEE") or "").strip()
        libelle = (r.get("Nom_de_la_commune") or "").strip()
        if not cp or not insee or len(cp) != 5 or not cp.isdigit():
            continue

        # Dérive le code département depuis l'INSEE commune
        # Métropole : 2 premiers chars sont le dept (sauf 2A/2B Corse)
        # DROM : 3 premiers chars sont le dept (97x, 98x)
        if insee.startswith("2A") or insee.startswith("2B"):
            dept = insee[:2]
        elif insee.startswith(("97", "98")):
            dept = insee[:3]
        else:
            dept = insee[:2]

        circos = commune_to_circos.get((dept, insee))
        if not circos:
            skipped += 1
            continue

        for circo in sorted(circos, key=lambda c: int(c) if c.isdigit() else 99):
            key = (cp, insee, circo)
            if key in seen:
                continue
            seen.add(key)
            communes_out.append({
                "cp": cp,
                "insee": insee,
                "libelle": libelle.title(),
                "dept": dept,
                "circo": circo,
            })

    communes_out.sort(key=lambda c: (c["cp"], c["insee"], c["circo"]))
    print(f"    → {len(communes_out):,} entrées finales, {skipped:,} sans circo trouvé")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": date.today().isoformat(),
        "source": {
            "candidats": URL_CANDIDATS,
            "bureaux_vote": URL_BUREAUX_VOTE,
            "codes_postaux": URL_CODES_POSTAUX,
        },
        "communes": communes_out,
    }
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print(f"\n✅ Écrit : {OUT_PATH} ({size_mb:.1f} MB)\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
