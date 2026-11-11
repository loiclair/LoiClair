"""Utilitaires partagés entre les parsers AN (Syseron) et Sénat (CRI).

- `clean_text` : réduit un fragment XML/HTML en texte brut tout en conservant
  les didascalies entre parenthèses (ex: « (Applaudissements sur les bancs…) »).
- `extract_num_notice_an` : extrait le(s) numéro(s) de texte à partir de
  l'attribut `valeur` d'un `<point code_grammaire="TITRE_TEXTE_DISCUSSION">`.
- `norm_ws` : normalise les espaces multiples.
"""

from __future__ import annotations

import html
import re
import unicodedata
from typing import Iterable


# Regex extraction numéro de texte AN
# Exemples :
#   " (n[[o]] 864)"         → ["864"]
#   " (n[[os]] 613, 704)"   → ["613", "704"]
#   " (nos 613, 704)"       → ["613", "704"]
#   " (n° 864)"             → ["864"]
_RE_NUM_AN = re.compile(
    r"n\s*\[?\[?\s*o[s]?\s*\]?\]?\s*[\u00b0]?\s*([\d,\s]+)",
    re.IGNORECASE,
)

_RE_NUM_AN_FALLBACK = re.compile(r"n[\u00b0\s]*([\d,\s]+)", re.IGNORECASE)

# Caractères de contrôle à supprimer sauf retours à la ligne
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

# Espaces multiples → espace unique (préserve \n)
_WS_RE = re.compile(r"[ \t\u00a0\u2009\u202f]+")
_MULTINL_RE = re.compile(r"\n{3,}")


def norm_ws(s: str) -> str:
    if not s:
        return ""
    s = _CTRL_RE.sub("", s)
    s = _WS_RE.sub(" ", s)
    s = _MULTINL_RE.sub("\n\n", s)
    return s.strip()


def clean_text(s: str | None) -> str:
    """Décode les entités HTML et normalise les espaces. Préserve les didascalies."""
    if not s:
        return ""
    s = html.unescape(s)
    return norm_ws(s)


def extract_num_notice_an(valeur: str | None) -> list[str]:
    """Extrait les numéros de texte depuis l'attribut `valeur` d'un titre AN.

    Retourne une liste : un dossier peut être discuté conjointement avec d'autres
    (discussion commune → plusieurs num_notice). Renvoie [] si non extractible.
    """
    if not valeur:
        return []
    m = _RE_NUM_AN.search(valeur)
    if not m:
        m = _RE_NUM_AN_FALLBACK.search(valeur)
    if not m:
        return []
    raw = m.group(1)
    nums = [n.strip().lstrip("0") or "0" for n in re.split(r"[,\s]+", raw) if n.strip()]
    # Filtre : on ne garde que les entiers (évite les "1er", "2e", etc. qui peuvent traîner)
    return [n for n in nums if n.isdigit()]


def strip_xmlns(tag: str) -> str:
    """Retourne le local-name d'un tag ElementTree `{ns}tag` → `tag`."""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def collapse_whitespace(parts: Iterable[str]) -> str:
    return norm_ws(" ".join(p for p in parts if p))


def slugify_signet(v: str) -> str:
    """Normalise un signet Sénat (ex: 'ppl25-321') : minuscules, sans espace."""
    if not v:
        return ""
    v = v.strip().lower()
    v = unicodedata.normalize("NFKD", v).encode("ascii", "ignore").decode("ascii")
    return v
