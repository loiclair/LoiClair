# Banc d'essai des titres anglais des dossiers

Ce dossier a mis au point le prompt qui traduit en anglais le titre officiel de chaque dossier législatif, de chaque loi publiée et de chaque scrutin affiché (`src/lib/prompts/titres-en.json`). La traduction est écrite chaque nuit dans `dossiers_legislatifs.titre_en`, `application_lois.titre_en` et `scrutins.titre_en` par `pipeline/traduire_titres.py`, et affichée sur la version anglaise du site. Le résultat est publié sur [/documentation/choix-modele-ia](https://loiclair.fr/en/documentation/choix-modele-ia#titres-anglais).

Les deux scripts appellent `traduire_groupe` du script de production : même prompt, même schéma, même modèle. Ils n'écrivent rien en base.

## Ce qui a été mesuré (octobre 2026)

- **Réglage** sur 30 titres (`resultats/echantillon.json`) : tirés par type de procédure, plus des cas durs (titre de 543 caractères, minuscule initiale, sigles, outre-mer, référence de loi). Relus par l'équipe, côte à côte avec le titre français, sur la page que produit `banc.py`. Les versions successives du prompt sont dans `resultats/traductions-<version>.json`.
- **Contrôle** sur 90 titres jamais vus pendant le réglage : 40, puis 50 (`controle.py`), relus par Claude.
- **Réflexion** comparée sur ces 80 titres (50 du contrôle et 30 du réglage) : au réglage `low`, environ un titre sur huit enfreignait une consigne (type de texte ajouté devant un titre, information ajoutée, « Government » perdu) ; au réglage `medium`, deux ou trois, sur des points de style. `medium` a été retenu (`resultats/*-8bf3a640fcde-medium.json`).
- **Titres de lois** : le même prompt, essayé sur 30 titres Légifrance (`resultats/lois-30.json`), les traduisait déjà bien (« Law No. 2022-299 of 2 March 2022 to combat school bullying ») ; il n'a pas été retouché, ce qui a évité de retraduire les dossiers.
- **Titres de scrutins** : sur 29 titres tirés par forme (amendements, motions de censure et de rejet, parties du budget, CMP, article unique : `resultats/scrutins-30.json`), le prompt des dossiers traduisait bien. Mais la passe sur les 555 scrutins affichés a rendu un groupe entier de 40 titres sans article de tête (« whole of the government bill… »), et 4 ailleurs. Trois consignes ont été ajoutées (garder l'article, motion de rejet préalable, noms de groupes en français), vérifiées sur les 29 titres, ces 40 et les 12 motions de rejet (`resultats/scrutins-30-<version>.json`). Le prompt changeant de version, les dossiers ont été retraduits : sur leurs 30 titres de réglage, 22 changent de formulation, sans perte de qualité à la relecture.
- **Relecture du corpus entier** (4 553 titres, le 2026-10-20, par six relectures Claude en parallèle, défauts recomptés ensuite par script) : peu de contresens, mais récurrents (« Dénoncer l'accord » rendu « Denounce » 6 fois, « dérogatoire » rendu « derogatory »), un infinitif passé au gérondif dans 74 titres sur 1 663, un nom d'action devenu impératif ou gérondif dans 35 sur 96, « visant à » rendu « aimed at » 18 fois, et beaucoup de variantes pour un même terme (« en application de » : under 91, pursuant to 84 ; « déposé » : tabled 64, filed 8, submitted 8). Le prompt a reçu une règle sur les faux amis, des règles de forme et une quinzaine d'entrées de glossaire, vérifiées sur 97 titres fautifs (`resultats/corpus-cas-<version>.json`) puis sur les 30 titres de réglage.

La casse de la première lettre ne dépend pas du prompt : `traduire_titres.py` la recale sur celle du titre français, la consigne seule variant d'un essai à l'autre.

Coût : quelques dixièmes de centime par passe de banc ; la première traduction des 3 850 dossiers a coûté 0,35 $, celle des 2 060 lois du baromètre 0,22 $ (avant que le script ne se limite aux 148 lois rattachées à un dossier, les seules affichées).

## Fichiers

- `banc.py` : tirage des 30 titres, traduction, page de relecture `resultats/relecture-<version>.html` (non versionnée).
- `controle.py` : 50 titres jamais vus, traduits avec la réflexion du prompt et une autre, pour les comparer.
- `resultats/depenses.jsonl` : le registre des dépenses de `banc.py`.
