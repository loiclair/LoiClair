# Banc d'essai des modèles IA

Ce dossier mesure quel modèle écrit les meilleurs résumés de loi pour son prix. C'est lui qui a désigné le modèle actuel du site, et ses résultats sont publiés sur [/documentation/choix-modele-ia](https://loiclair.fr/documentation/choix-modele-ia).

## Les trois étapes

Lancées depuis la racine du dépôt, avec `MAMMOUTH_API_KEY` et les variables de connexion `PG*` (voir le `README.md` du dépôt) dans `.env.local`.

1. `node scripts/banc-modeles/banc.mjs <plafond en $>` : chaque candidat résume les textes choisis, avec le prompt et les paramètres de la prod. Résultat dans `resultats/resumes.json`.
2. `node scripts/banc-modeles/jury.mjs <plafond en $>` : un jury d'IA note chaque résumé à l'aveugle selon `grille.md`, sans jamais noter sa propre famille de modèles. Résultat dans `resultats/notes.json`.
3. `python3 scripts/banc-modeles/classement.py` : recale les correcteurs sur la même échelle, calcule les scores et la frontière qualité-prix, et écrit `src/lib/evaluation-modeles.ts`, que la page publique affiche.

Les deux premières étapes reprennent là où elles se sont arrêtées : rien de ce qui est déjà produit n'est redemandé ni refacturé. Chacune s'arrête avant de dépasser son plafond de dépense.

## Changer le banc

- Les textes, les candidats et le jury se règlent dans le bloc « Configuration » en tête de chaque script.
- Un nouveau candidat ou un nouveau texte ne coûte que ce qui manque.
- Changer le prompt de prod ou la grille rend les résultats existants caducs. Les trois scripts le détectent par empreinte et refusent de mélanger : `banc.mjs` ne complète pas un `resumes.json` écrit sous d'autres consignes, `jury.mjs` ne complète pas des notes données avec une autre grille, et `classement.py` refuse de tourner si `grille.md` n'est plus celle du jury. La page renvoie vers la grille par un lien figé sur un commit (`page.tsx` de `/documentation/choix-modele-ia`) : un nouveau banc noté avec une autre grille demande de changer ce lien. Archiver alors les fichiers de `resultats/` dans un sous-dossier, ou les supprimer, et tout relancer. Les sous-dossiers archivent des mesures passées, chacun avec son README : ils restent.
- `resultats/` n'est pas versionné (environ 1 Mo par banc). Le résumé chiffré, lui, l'est dans `src/lib/evaluation-modeles.ts`.

## Coût indicatif

Le banc de septembre 2026 (10 textes, 15 candidats, jury de 4) a coûté environ 7 $, dont plus d'un tiers pour gpt-6-astra et Claude Opus. Les textes longs (plus de 500 000 caractères) n'y sont pas : un seul, lu par tous les candidats et le jury, coûterait autant que tout le reste.
