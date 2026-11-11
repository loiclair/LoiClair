"""
select_quiz_scrutins.py
Sélectionne les 20 scrutins de l'Assemblée nationale utilisés par le quiz
d'affinité politique et les persiste dans `quiz_affinite_scrutins`.

Les scrutins de SCRUTINS_INCONTOURNABLES entrent d'abord, choisis à la main
pour que les grands débats du pays figurent toujours dans le quiz ; l'algorithme
complète jusqu'à 20.

Sélection en 2 phases (cf. DECISIONS.md) :
1. Glouton : à chaque tour, choisit le scrutin candidat qui couvre le plus
   de grands sujets (SUJETS_IMPOSES, des thèmes AN de
   dossiers_legislatifs.themes) encore absents de la sélection ; à égalité,
   un scrutin solennel passe devant un scrutin ordinaire ; à égalité encore,
   celui qui différencie le plus de paires parmi les 11 groupes politiques
   actifs de l'AN encore sous-couvertes (< K fois).
2. Raffinement local : le glouton est myope (un scrutin choisi tôt peut
   devenir redondant si un choix ultérieur couvre les mêmes paires
   autrement) — on teste, pour chaque scrutin retenu, un remplacement qui
   améliore la couverture totale, jusqu'à convergence.

Un même dossier législatif n'est jamais réutilisé, et un scrutin où tous les
groupes actifs ayant pris position ont voté pareil n'est pas un candidat : il
ne sépare personne. Le nombre de thèmes d'un dossier n'écarte rien : la fiche
courte en donne trois au plus, et un texte à trois thèmes reste une question
lisible.

La méthode est publiée sur la page du quiz d'affinité (bloc « Comment les
questions sont choisies ») : toute règle changée ici se reporte dans ce texte.

Exécuté mensuellement (workflow séparé select-quiz-scrutins-monthly.yml),
indépendamment du cron nightly. La sélection ne retient que des dossiers
ayant déjà un search_summary (filtré à la lecture, jamais de dépendance
d'ordonnancement avec generate_search_summaries.py).

Connexion directe à Postgres par `_db.connexion` : lecture ET écriture avec la même
connexion.

Prérequis : variables libpq `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE` dans l'environnement ou `.env.local`.
"""

import sys
from itertools import combinations
from pathlib import Path
from dotenv import load_dotenv
import psycopg
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _alertes import envoyer_alerte_best_effort  # noqa: E402
from _db import connexion  # noqa: E402

load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env.local")



# Ouverte ici et non dans le `with` plus bas : une base injoignable ou une variable
# manquante doit prévenir par email avant de sortir. Le message d'erreur de psycopg
# nomme l'hôte.
try:
    conn = connexion(autocommit=True)
except (psycopg.Error, RuntimeError) as e:
    print(f"❌ Connexion à la base impossible : {e}", file=sys.stderr)
    envoyer_alerte_best_effort(
        "⚠️ LoiClair — Sélection des scrutins du quiz en échec",
        f"<p>Connexion à la base impossible ({type(e).__name__}) : le run mensuel de "
        "sélection des scrutins du quiz d'affinité n'a pas pu démarrer.</p>",
    )
    sys.exit(1)

# Nombre minimal de scrutins devant différencier chaque paire de groupes
# (robustesse), et longueur fixe du quiz.
K = 3
TARGET_LEN = 20
# Un scrutin n'est un candidat crédible que si une majorité substantielle
# des groupes actifs a pris position dessus (évite les scrutins de
# procédure où seuls quelques groupes votent).
MIN_GROUPES_AVEC_POSITION = 8
# Grands sujets que la sélection doit couvrir, choisis dans la liste fermée
# des 27 thèmes des dossiers (D-240 : aucun thème maison hors de cette liste).
# Avant, la cible était l'union des thèmes de tous les candidats :
# la sélection en production au 2026-09-14 contenait un traité avec la
# Communauté des Caraïbes, mais ni retraites, ni budget de l'État, ni fin de vie.
# Correspondances constatées en base au 2026-09-14, quand les thèmes venaient
# encore de mots-clés du titre : immigration et sécurité sous « Police et
# sécurité », les retraites sous « Travail », le climat sous « Environnement ».
# Le dossier « Fin de vie » (DLR5L17N51670) n'avait alors aucun thème. Les
# thèmes sont depuis le 2026-10-16 choisis par le modèle des fiches courtes,
# qui lit le texte : ces correspondances sont à revérifier en base.
SUJETS_IMPOSES = {
    "Police et sécurité",
    "Travail",
    "Budget",
    "Économie et finances, fiscalité",
    "Questions sociales et santé",
    "Environnement",
    "Énergie",
    "Justice",
    "Éducation",
    "Agriculture et pêche",
    "Logement et urbanisme",
    "Défense",
}
# Scrutins toujours retenus, choisis à la main par Alex le 2026-09-15. Les
# thèmes ne suffisent pas à garantir les grands débats du pays : le dossier
# « Fin de vie » n'avait alors aucun thème, l'immigration n'en est pas un (D-240), et le
# seul vote sur les retraites est un scrutin ordinaire qui perd face aux
# solennels. La liste est publiée avec la méthode sur la page du quiz, et se
# met à jour à la main quand un grand vote arrive.
SCRUTINS_INCONTOURNABLES = [
    "VTANR5L17V8280",  # Aide à mourir, lecture définitive (2026-07-15)
    "VTANR5L17V7405",  # Sécurité, rétention administrative et attentats, CMP (2026-06-16)
    "VTANR5L17V217",   # Abrogation de la réforme des retraites (2024-10-31)
    "VTANR5L17V4241",  # Première partie du budget 2026 (2025-11-21)
    "VTANR5L17V4758",  # Budget de la Sécurité sociale 2026, lecture définitive (2025-12-16)
    "VTANR5L17V1473",  # Narcotrafic, CMP (2025-04-29)
    "VTANR5L17V8427",  # Loi d'urgence agricole, CMP (2026-07-20)
]
# Code AN d'un scrutin public solennel, annoncé à l'avance. Mesuré le
# 2026-09-14 sur les scrutins AN à votes nominatifs : 530 votants en médiane
# pour un solennel (364 au minimum), 143 pour un scrutin ordinaire (23 au
# minimum). La position d'un groupe y repose donc sur presque tous ses membres.
CODE_SCRUTIN_SOLENNEL = "SPS"

print("⏳ Sélection des scrutins du quiz d'affinité…")
with conn:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT uid FROM organes WHERE code_type = 'GP' AND date_fin IS NULL "
            "AND uid <> 'PO840056' ORDER BY uid"
        )
        groupes_actifs = [row[0] for row in cur.fetchall()]
        print(f"🔍 {len(groupes_actifs)} groupes actifs (Non inscrit exclu)")

        # Les synthèses ne décident rien : elles sont imprimées avec la sélection
        # finale, pour qu'un désaccord réel se lise dans le log du run mensuel
        # sans aller en base.
        cur.execute(
            "SELECT uid, titre, date_scrutin, type_vote_code, "
            "synthese_pour, synthese_contre, synthese_abstentions FROM scrutins "
            "WHERE chambre = 'Assemblée Nationale' AND votes_nominatifs IS NOT NULL"
        )
        titres, dates, solennels, syntheses = {}, {}, set(), {}
        for uid, titre, date_scrutin, type_vote_code, pour, contre, abstentions in cur.fetchall():
            titres[uid] = titre
            dates[uid] = date_scrutin
            if type_vote_code == CODE_SCRUTIN_SOLENNEL:
                solennels.add(uid)
            syntheses[uid] = (pour, contre, abstentions)
        print(f"🔍 {len(titres)} scrutins AN avec votes nominatifs")

        cur.execute(
            "SELECT scrutin_uid, groupe_uid, position_majoritaire "
            "FROM scrutins_groupes_positions WHERE chambre = 'AN'"
        )
        by_scrutin = {}
        for scrutin_uid, groupe_uid, position in cur.fetchall():
            by_scrutin.setdefault(scrutin_uid, {})[groupe_uid] = position

        cur.execute(
            "SELECT dossier_uid, unnest(vote_refs) AS scrutin_uid "
            "FROM actes_legislatifs WHERE vote_refs IS NOT NULL"
        )
        dossiers_by_scrutin = {}
        for dossier_uid, scrutin_uid in cur.fetchall():
            dossiers_by_scrutin.setdefault(scrutin_uid, set()).add(dossier_uid)

        cur.execute("SELECT uid, themes FROM dossiers_legislatifs WHERE search_summary IS NOT NULL")
        dossiers_avec_resume = {}
        for uid, themes in cur.fetchall():
            dossiers_avec_resume[uid] = themes or []

    # Ne garde que les scrutins AN avec assez de positions, mappés à un seul
    # dossier (la carte du quiz affiche ses thèmes et renvoie à sa fiche : il faut
    # savoir lequel), et dont ce dossier a déjà sa fiche courte. Seuls les thèmes
    # de cette fiche servent ici (couverture des SUJETS_IMPOSES, affichage sur la
    # carte) ; son résumé n'est pas affiché dans le quiz (D-176).
    candidats = {}
    dossiers_du_candidat = {}
    themes_du_candidat = {}
    for uid in titres:
        # Exclut les motions de rejet préalable : voter "pour" y rejette le
        # texte, une logique inversée par rapport aux autres scrutins du
        # quiz qui perturbe la compréhension du résultat.
        if (titres[uid] or "").strip().lower().startswith("la motion de rejet préalable"):
            continue
        positions = (by_scrutin.get(uid) or {})
        if len(positions) < MIN_GROUPES_AVEC_POSITION:
            continue
        # Sans désaccord entre groupes actifs, la question ne rapproche
        # l'utilisateur d'aucun groupe plutôt que d'un autre. Les non-inscrits
        # sont ignorés : leur « position » n'est pas celle d'un groupe.
        # Constaté dans la sélection en production au 2026-09-14 : un traité avec la
        # Communauté des Caraïbes (8 groupes sur 8 pour) et un texte sur les
        # rapatriés d'Indochine (11 sur 11 pour).
        if len({positions[g] for g in groupes_actifs if g in positions}) < 2:
            continue
        dossiers = dossiers_by_scrutin.get(uid, set())
        if len(dossiers) != 1 or not dossiers.issubset(dossiers_avec_resume):
            continue
        (dossier_uid,) = dossiers
        candidats[uid] = positions
        dossiers_du_candidat[uid] = dossiers
        themes_du_candidat[uid] = set(dossiers_avec_resume[dossier_uid])

    # Les incontournables passent outre l'exigence d'un résumé, qui sert à
    # trier l'offre automatique, pas à écarter un grand débat choisi à
    # la main. Ils gardent les exigences sans lesquelles la question ne marche
    # pas : assez de groupes positionnés, un désaccord, un seul dossier pour le
    # lien vers sa fiche. Un incontournable qui ne les remplit plus (seuil de
    # 10 % de QZ-02, dossier fusionné) est signalé plutôt qu'imposé.
    incontournables_retenus = []
    incontournables_ecartes = []
    for uid in SCRUTINS_INCONTOURNABLES:
        positions = by_scrutin.get(uid) or {}
        dossiers = dossiers_by_scrutin.get(uid, set())
        if (
            uid not in titres
            or len(positions) < MIN_GROUPES_AVEC_POSITION
            or len({positions[g] for g in groupes_actifs if g in positions}) < 2
            or len(dossiers) != 1
        ):
            incontournables_ecartes.append(uid)
            continue
        (dossier_uid,) = dossiers
        candidats[uid] = positions
        dossiers_du_candidat[uid] = dossiers
        themes_du_candidat[uid] = set(dossiers_avec_resume.get(dossier_uid) or [])
        incontournables_retenus.append(uid)
    if incontournables_ecartes:
        print(f"⚠️ Incontournables inéligibles : {', '.join(incontournables_ecartes)}", file=sys.stderr)
        envoyer_alerte_best_effort(
            "⚠️ LoiClair : quiz d'affinité, scrutin incontournable écarté",
            f"<p>Scrutins imposés qui ne remplissent plus les conditions : "
            f"{', '.join(incontournables_ecartes)}. La sélection a été écrite sans eux.</p>",
        )
    print(
        f"🔍 {len(candidats)} scrutins candidats (positions + désaccord + résumé dossier), "
        f"dont {len(solennels & candidats.keys())} solennels"
    )

    all_pairs = list(combinations(groupes_actifs, 2))

    def pairs_differentiees(positions):
        return {
            (a, b)
            for a, b in all_pairs
            if a in positions and b in positions and positions[a] != positions[b]
        }

    paires_par_candidat = {uid: pairs_differentiees(positions) for uid, positions in candidats.items()}

    def couverture(selection):
        """(nb sujets imposés couverts, nb solennels, nb paires différenciées ≥K).

        Plus haut = meilleur, comparé dans cet ordre. Le nombre de solennels
        figure ici et pas seulement dans le glouton : sans lui, le raffinement
        remplacerait un solennel par un scrutin ordinaire qui gagne une paire,
        et déferait la préférence du glouton."""
        themes_couverts = set().union(*(themes_du_candidat[u] for u in selection)) if selection else set()
        pair_counts = {p: 0 for p in all_pairs}
        for uid in selection:
            for p in paires_par_candidat[uid]:
                pair_counts[p] += 1
        nb_paires_ok = sum(1 for c in pair_counts.values() if c >= K)
        nb_solennels = sum(1 for u in selection if u in solennels)
        return len(themes_couverts & SUJETS_IMPOSES), nb_solennels, nb_paires_ok

    # Phase 1 : sélection gloutonne. À chaque tour, le candidat qui couvre le
    # plus de sujets imposés encore absents ; à égalité, un solennel avant un
    # ordinaire ; à égalité encore, celui qui différencie le plus de paires de
    # groupes encore sous-couvertes (< K fois).
    selected = list(incontournables_retenus)
    used_dossiers = set().union(*(dossiers_du_candidat[u] for u in selected)) if selected else set()
    while len(selected) < TARGET_LEN:
        pair_counts = {p: 0 for p in all_pairs}
        for uid in selected:
            for p in paires_par_candidat[uid]:
                pair_counts[p] += 1
        themes_couverts = set().union(*(themes_du_candidat[u] for u in selected)) if selected else set()
        sujets_manquants = SUJETS_IMPOSES - themes_couverts
        paires_manquantes = {p for p, c in pair_counts.items() if c < K} or set(all_pairs)

        best_uid, best_score = None, (-1, -1, -1)
        for uid, positions in candidats.items():
            if uid in selected or dossiers_du_candidat[uid] & used_dossiers:
                continue
            sujet_gain = len(themes_du_candidat[uid] & sujets_manquants)
            pair_gain = len(paires_par_candidat[uid] & paires_manquantes)
            score = (sujet_gain, int(uid in solennels), pair_gain)
            if score > best_score:
                best_uid, best_score = uid, score

        if best_uid is None or best_score <= (0, 0, 0):
            break
        selected.append(best_uid)
        used_dossiers |= dossiers_du_candidat[best_uid]

    nb_sujets, _, _ = couverture(selected)
    print(f"🔍 Sélection gloutonne : {len(selected)} scrutins, {nb_sujets}/{len(SUJETS_IMPOSES)} sujets imposés couverts")

    # Phase 2 : raffinement local. Le glouton est myope : un scrutin choisi tôt
    # peut devenir redondant si un choix ultérieur couvre les mêmes paires
    # autrement. On cherche, à chaque passe, le meilleur remplacement isolé
    # qui améliore la couverture totale, jusqu'à convergence (plafonné par
    # sécurité).
    for _ in range(50):
        score_actuel = couverture(selected)
        amelioration = None
        for i, uid_sortant in enumerate(selected):
            # Un incontournable ne se remplace jamais, même par un scrutin qui
            # couvrirait mieux les paires de groupes.
            if uid_sortant in incontournables_retenus:
                continue
            reste = selected[:i] + selected[i + 1 :]
            dossiers_restants = set().union(*(dossiers_du_candidat[u] for u in reste)) if reste else set()
            for uid_entrant in candidats:
                if uid_entrant in reste or uid_entrant == uid_sortant:
                    continue
                if dossiers_du_candidat[uid_entrant] & dossiers_restants:
                    continue
                score_test = couverture(reste + [uid_entrant])
                if score_test > score_actuel:
                    amelioration = (i, uid_entrant, score_test)
                    score_actuel = score_test
        if amelioration is None:
            break
        i, uid_entrant, _ = amelioration
        selected = selected[:i] + [uid_entrant] + selected[i + 1 :]

    nb_sujets, nb_solennels, nb_paires_ok = couverture(selected)
    print(
        f"🔍 {len(selected)} scrutins sélectionnés — "
        f"{nb_sujets}/{len(SUJETS_IMPOSES)} sujets imposés couverts, "
        f"{nb_solennels} solennels, "
        f"{nb_paires_ok}/{len(all_pairs)} paires couvertes ≥{K}x"
    )

    # Un sujet imposé passe avant tout autre critère : il ne manque donc que si
    # aucun candidat ne le porte, ou si son seul candidat partage un dossier
    # déjà retenu. Bloquer l'écriture n'y changerait rien et
    # laisserait en place une sélection plus ancienne, donc on écrit quand même
    # et on prévient, la page du quiz promettant cette couverture.
    sujets_absents = SUJETS_IMPOSES - set().union(*(themes_du_candidat[u] for u in selected)) if selected else SUJETS_IMPOSES
    if sujets_absents and len(selected) == TARGET_LEN:
        print(f"⚠️ Sujets imposés sans scrutin éligible : {', '.join(sorted(sujets_absents))}", file=sys.stderr)
        envoyer_alerte_best_effort(
            "⚠️ LoiClair : quiz d'affinité, sujets non couverts",
            f"<p>Aucun scrutin éligible pour : {', '.join(sorted(sujets_absents))}. "
            "La sélection a été écrite sans eux.</p>",
        )

    if len(selected) != TARGET_LEN:
        print(
            f"❌ Sélection incomplète : {len(selected)}/{TARGET_LEN} scrutins trouvés. "
            "Table non modifiée.",
            file=sys.stderr,
        )
        envoyer_alerte_best_effort(
            "⚠️ LoiClair — Sélection des scrutins du quiz en échec",
            f"<p>Seulement {len(selected)}/{TARGET_LEN} scrutins candidats "
            "trouvés pour le quiz d'affinité — la table quiz_affinite_scrutins "
            "n'a pas été modifiée, l'ancienne sélection reste active.</p>",
        )
        sys.exit(1)

    # Ordre final = ordre chronologique du scrutin (pas l'ordre de sélection
    # gloutonne, qui n'a pas de sens narratif pour l'utilisateur du quiz).
    selected.sort(key=lambda uid: dates[uid])

    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute("TRUNCATE public.quiz_affinite_scrutins")
            for rang, uid in enumerate(selected, start=1):
                (dossier_principal,) = dossiers_du_candidat[uid]
                cur.execute(
                    "INSERT INTO public.quiz_affinite_scrutins "
                    "(scrutin_uid, dossier_uid, rang) VALUES (%s, %s, %s)",
                    (uid, dossier_principal, rang),
                )

    print("\n--- Scrutins retenus ---")
    for rang, uid in enumerate(selected, start=1):
        pour, contre, abstentions = syntheses[uid]
        type_vote = "solennel" if uid in solennels else "ordinaire"
        print(
            f"{rang}. [{dates[uid]}] ({type_vote} ; {pour} pour, {contre} contre, "
            f"{abstentions} abst.) {titres[uid]}"
        )

    print(f"\n✅ {len(selected)} scrutins du quiz d'affinité écrits en base")
