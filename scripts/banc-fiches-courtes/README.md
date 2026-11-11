# Banc d'essai de la fiche courte des dossiers

Ce dossier a choisi le modèle et les consignes de la fiche courte de chaque dossier : un résumé de 100 à 150 mots (lu tel quel dans la newsletter, indexé par la recherche) et 1 à 3 thèmes pris dans une liste fermée de 27. La fiche est écrite chaque nuit par `pipeline/generate_search_summaries.py`, avec le prompt `src/lib/prompts/search-summary.json`. Le résultat est publié sur [/documentation/choix-modele-ia](https://loiclair.fr/documentation/choix-modele-ia), section « Fiche courte des dossiers ».

Il est distinct de `scripts/banc-modeles/`, qui mesure le résumé de loi.

## Ce qui a été mesuré (octobre 2026)

Deux jeux de 20 dossiers, tirés au hasard par type de procédure (propositions et projets de loi, résolutions, rapports d'information, Sénat et Assemblée, textes courts et longs, un dossier sans texte) :

- **réglage** (`resultats/dossiers-reglage.json`) : les consignes y ont été réécrites en dix versions (`prompts/v1.json` à `prompts/v10.json`) ;
- **frais** (`resultats/dossiers-frais.json`) : jamais vu pendant le réglage, il sert à la mesure finale.

Deux juges, chacun à sa place :

- **Haiku contre Luna** : `mistral-large-4`, via Mammouth. Une troisième famille, ni OpenAI (Luna) ni Anthropic (Haiku), comme le veut la règle de `scripts/banc-modeles/` : un juge ne note jamais sa propre famille contre une autre.
- **Haiku contre Haiku** (choisir entre deux versions du prompt) : `claude-opus-5-5`. Les deux fiches sont de la même famille, le biais s'annule.

Chaque paire est jugée à l'aveugle, l'ordre des deux fiches tiré au hasard, sur l'exactitude, la complétude, la neutralité, la clarté et le choix des thèmes.

## Ce qui en est sorti

| Étape | Résultat |
|---|---|
| v1, lecture et mesures automatiques (jeu de réglage) | Haiku débordait (129 mots en moyenne, 13 fiches sur 20 au-delà de 120), finissait souvent par « n'est pas adopté à ce jour », écrivait des mesures au présent et nommait un auteur |
| v2 à v5 | Phrase finale, auteurs nommés, présent au lieu du conditionnel : réglés. Mais v5, trop courte (70 à 100 mots), perdait en complétude : face à Luna (consignes v1, jeu frais, Mistral), Luna préférée 12 fois, Haiku 5 |
| v6 à v8 | Toutes les mesures, chacune en peu de mots ; puis une règle contre les rapprochements que le texte ne fait pas (« soit » entre deux chiffres indépendants, soldes qui ne portent pas sur les mêmes comptes). v8 bat v6, 20 contre 16, avec 1 erreur grave contre 6 |
| v8, réflexion `medium` contre `low` (Opus) | Aucun gain net (`medium` préférée 18 fois, `low` 17), pour 30 % de coût en plus : `low` reste |
| v10 contre v8 (Opus) | v10 (100 à 140 mots, jamais plus de 150) l'emporte 25 contre 10 |
| **v10, Haiku contre Luna avec le même prompt (jeu frais, Mistral)** | **Haiku 9, Luna 7, 1 égalité.** Exactitude 9,2 contre 8,9, complétude 8,2 contre 7,8. Coût pour 1 000 fiches : 1,58 $ contre 0,49 $ |

L'essentiel du progrès vient des consignes, qui ont aussi amélioré Luna (préférée 4 fois sur 18 face à Haiku v10 avec ses consignes v1, 7 fois sur 17 avec les v10). Les chiffres affichés sur le site sont recopiés dans `src/lib/evaluation-fiches-courtes.ts` depuis `resultats/juge-final.json`.

## Fichiers

- `banc.py` : tirage des dossiers, appels aux deux modèles, page de lecture côte à côte (`resultats/banc.html`, non versionnée).
- `generer.py` : les fiches d'une version du prompt sur un jeu, avec des mesures automatiques (longueur, phrase finale sur l'adoption, auteur nommé, « vise à », chiffres absents du texte source, nombre de thèmes, coût).
- `juge.py` : le jugement à l'aveugle de deux jeux de fiches.
- `prompts/` : les dix versions des consignes. Celles de `v10.json` sont celles de la prod ; les réglages d'appel de la prod (plafond de jetons, pas de température, schéma sans `maxItems` que l'API Claude refuse) vivent dans `src/lib/prompts/search-summary.json`.
- `resultats/` : les dossiers et leur texte source (15 000 premiers caractères), les fiches et les jugements publiés.

## Relancer

Depuis la racine du dépôt, avec les variables `PG*` (port 5432), `MAMMOUTH_API_KEY` et `ANTHROPIC_API_KEY_DOSSIER_SUMMARIES` dans `.env.local`, et les dépendances de `pipeline/requirements.txt` :

```bash
python3 -P scripts/banc-fiches-courtes/generer.py prompts/v10.json haiku-v10 --frais
python3 -P scripts/banc-fiches-courtes/generer.py prompts/v10.json luna-v10 --frais --luna
python3 -P scripts/banc-fiches-courtes/juge.py resultats/dossiers-frais.json \
    resultats/fiches-frais-luna-v10.json luna-v10 resultats/fiches-frais-haiku-v10.json haiku-v10 \
    resultats/juge-final.json
```

Tout reprend là où ça s'est arrêté : une fiche ou un jugement déjà écrit n'est ni redemandé ni refacturé. Les fichiers versionnés étant complets, ces trois commandes rejouent les chiffres publiés sans aucun appel payant. Pour une nouvelle mesure, écrire sous d'autres noms.

## Coût

Haiku et Opus passent sur la clé Anthropic. Luna et le juge passent par Mammouth, et `juge.py` s'arrête avant que la dépense Mammouth totale du banc, relue dans `resultats/`, ne dépasse 0,95 $ : le banc d'octobre 2026 a dépensé 0,94 $ chez Mammouth. Un jugement coûte environ 1 centime avec Mistral, 5 avec Grok, écarté pour cette raison.

## Limites

Petits échantillons (17 paires jugées pour la mesure finale) et un seul juge pour la comparaison entre familles : le résultat dit que les deux modèles se valent sur cette tâche, pas que l'un surpasse nettement l'autre. Le juge a pénalisé une fiche vide sur une résolution réduite à sa page de titre, alors que c'est la consigne : les erreurs relevées se relisent avant de conclure. La grille du juge (`juge.py`) décrit encore un résumé de 80 à 120 mots, la consigne des premières versions, alors que la v10 en demande 100 à 150 ; la longueur n'entrait pas dans la note, et la grille reste telle qu'elle a servi.
