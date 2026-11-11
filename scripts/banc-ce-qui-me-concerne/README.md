# Banc d'essai de « Ce qui me concerne »

Ce dossier a réécrit la consigne qui rattache chaque article de loi et chaque amendement adopté aux profils de lecteur qu'il concerne (locataire, retraité, agriculteur…). Le classement est fait par `pipeline/classer_articles.py`, avec le prompt `src/lib/prompts/ce-qui-me-concerne.json`. Le résultat est publié sur [/documentation/choix-modele-ia](https://loiclair.fr/documentation/choix-modele-ia), section « Ce qui me concerne », et ses chiffres sont recopiés dans `src/lib/evaluation-ce-qui-me-concerne.ts`.

## Ce qui a été mesuré (17 octobre 2026)

150 articles et amendements réels (`resultats/banc/elements.json`), coupés en deux :

- **développement** (100) : les 71 éléments d'une première revue à l'aveugle (`resultats/revue-2026-10-17/`, 73 % de rattachements justes), plus des éléments tirés pour couvrir chaque profil au moins une fois ;
- **test** (50) : jamais regardé pendant le réglage, il sert à la mesure finale.

Un rattachement compte s'il est affiché sur le site, donc de certitude « certain » ou « probable ». Il est **juste** quand les juges disent le profil concerné ; la **justesse** est la part de rattachements affichés justes, le **rappel** la part des profils concernés que le modèle affiche.

Deux jurys, chacun à sa place :

- **Le chiffre publié** vient de trois juges d'autres familles que les modèles comparés, via Mammouth : `deepseek-v4-pro`, `gemini-3.8-flash`, `mistral-medium-3-5`, à la majorité, avec la consigne de juge de la première revue, figée (`resultats/jugements/mammouth/consigne_2026-10-17.txt`) pour que le chiffre final se compare aux 73 %.
- **Les tours de réglage** ont été jugés par un jury moins cher, à la majorité de trois : Claude Sonnet 5.5 et Claude Haiku 5.5 (effort élevé, en lots) et GPT-6 Luna, avec une consigne de juge fixe (`juge/consigne.md` et `juge/regles_r12.md`), indépendante de la consigne candidate.

Avant de choisir la règle de majorité, un membre de l'équipe a départagé 16 cas où les trois premiers juges n'étaient pas d'accord (`resultats/calibrage/`) : il a rejoint la majorité chaque fois. Aucun juge seul n'a dépassé 85 % d'accord avec la majorité des autres ; les trois juges ne s'accordent entre eux qu'environ quatre fois sur cinq.

## Ce qui en est sorti

La consigne a été réécrite en dix versions (`candidats/v1.json` à `v10.json`, `v0bis` étant celle d'origine), une famille d'erreurs à la fois : mesure qui vaut pour tout le monde, situation prêtée au lecteur, effet indirect, secteur confondu avec ses entreprises, profils définis par un dispositif précis. Chaque version a été classée deux fois par Haiku (`vN` et `vN_b`), le bruit d'une passe à l'autre atteignant 5 points, et gardée seulement si la justesse montait sans perdre plus de 5 points de rappel. Le tableau complet est dans `resultats/versions.md`.

| Mesure | Avant (v0) | Après (v7) | GPT-6 Luna, consigne v7 |
|---|---|---|---|
| Justesse, développement (jury de réglage, moyenne de 2 passes) | 70 % | 91 % | |
| **Justesse, test (3 juges Mammouth)** | **72 %** | **84 %** | **79 %** |
| dont « certain » / « probable » | 93 % / 57 % | 95 % / 77 % | 80 % / 75 % |
| Rappel, test | 73 % | 72 % | 64 % |
| Phrases fidèles, test | 79 % | 88 % | 79 % |

v6 égalait v7 en justesse sur le développement (91 %) et v8 la dépassait (92 %), mais en perdant 6 à 7 points de rappel : écartées. Seul le texte `system` a changé entre v0 et v7 ; catalogue, schéma, gabarit et réglages sont ceux de la prod.

Un juge note mieux son propre modèle : dans le jury de réglage, GPT-6 Luna jugeait justes 100 % de ses propres rattachements sur le test, contre 76 % de ceux de Haiku, quand Sonnet et Haiku donnaient 86 % à Haiku (`par_juge.py`). D'où le chiffre publié tiré de juges d'autres familles.

## Fichiers

- `commun.py` : chemins, client Mammouth, registre des dépenses, et le module de classement de production, importé tel quel.
- `banc.py` : tirage des 150 éléments, leur texte et leurs passages sources, lus en base.
- `divises.py`, `page_calibrage.py`, `accord.py` : les cas où les juges se divisent, la page de calibrage humain, l'accord d'un juge avec la majorité et avec le calibrage.
- `classer.py`, `classer_luna.py` : une consigne candidate classée par Haiku en direct (même système, schéma et recalage des passages que la prod), ou par GPT-6 Luna via Mammouth.
- `juge_claude.py` : le jury de réglage. Un jugement est rangé sous l'empreinte de ce qu'il juge : un classement inchangé n'est jamais rejugé ni refacturé.
- `mammouth.py` : les trois juges du chiffre publié.
- `mesure.py`, `moyenne.py` : justesse, rappel et fidélité, par certitude, thème et famille d'élément ; la ligne de `versions.md`.
- `iterer.sh`, `deux.sh`, `luna_6b.sh` : un tour de réglage, en double, et la comparaison avec Luna.
- `chiffres_page.py`, `par_juge.py` : les chiffres publiés et le biais du juge.
- `resultats/` : le banc, le calibrage, les classements et les jugements de v0, v0bis, v7, v7_b et luna_v7, ceux qui fondent les chiffres publiés. Les classements des autres versions n'y sont pas, leurs chiffres restent dans `versions.md`.

## Relancer

Depuis ce dossier, avec les variables `PG*` (port 5432), `MAMMOUTH_API_KEY` et `ANTHROPIC_API_KEY_DOSSIER_SUMMARIES` dans le `.env.local` du dépôt, et les dépendances de `pipeline/requirements.txt` plus `openai` :

```bash
python3 chiffres_page.py                     # chiffres du test, 3 juges Mammouth
python3 par_juge.py                          # biais du jury de réglage
python3 mesure.py v7 dev panel               # une passe de réglage
```

Les fichiers versionnés étant complets pour ces versions, ces commandes rejouent les chiffres publiés sans aucun appel payant. Pour une nouvelle consigne, l'écrire sous un autre nom dans `candidats/` et lancer `sh deux.sh <nom>`. Le jury de réglage lit `candidats/` et `classements/` du moment : changer `juge/` change toutes les empreintes, donc rejuge tout.

## Coût

Le banc a dépensé environ 13 $ de crédits Anthropic (Haiku classe, Sonnet et Haiku jugent en lots, un essai d'Opus comme juge) et 3,80 $ chez Mammouth (2,53 $ pour les trois juges sur v0, v7 et luna_v7, le reste pour Luna, juge et classement). Chaque script s'arrête avant de dépasser son budget, relu dans `resultats/depenses.jsonl` ou dans les jugements déjà écrits. La passe complète de la prod avec la v7 a coûté 4,37 $ en lots pour 14 078 éléments.

## Limites

50 éléments de test et des juges qui sont eux-mêmes des IA, en désaccord une fois sur cinq : l'écart entre v0 et v7, ou entre Haiku et Luna, est net, le chiffre exact l'est moins. Le progrès est moindre sur le test (12 points) que sur le développement (21 points) : une partie des gains tenait aux éléments de réglage. La consigne ne dit pas encore si `particulier_employeur` fait partie de « tout employeur ».
