// Résultats du banc d'essai de la fiche courte des dossiers (résumé et thèmes,
// écrits par `pipeline/generate_search_summaries.py`), affichés dans la section
// « Fiche courte des dossiers » de /documentation/choix-modele-ia.
//
// Recopiés à la main depuis scripts/banc-fiches-courtes/resultats/ : les préférences
// et les notes de juge-final.json, le coût moyen par appel des deux fichiers de
// fiches (facture Mammouth pour Luna, tarif public Anthropic pour Haiku). Contrairement
// à `evaluation-modeles.ts`, aucun script ne les régénère : le banc ne se relance pas,
// et ces chiffres restent ceux de `dateMesure` même si le prompt change ensuite.

export const EVALUATION_FICHES_COURTES = {
  dateMesure: '2026-10-15',
  retenu: 'claude-haiku-5-5',
  compare: 'gpt-6-luna',
  juge: 'mistral-large-4',
  // Versions des consignes écrites sur le jeu de réglage, avant la mesure finale.
  versionsInstructions: 10,
  // Paires de fiches jugées : 20 dossiers neufs, moins ceux dont aucune des deux
  // fiches n'a de résumé (pas de texte lisible).
  pairesJugees: 17,
  preferences: { retenu: 9, compare: 7, egalite: 1 },
  // Notes moyennes sur 10 du juge, mêmes instructions pour les deux modèles.
  notes: {
    retenu: { exactitude: 9.24, completude: 8.18, neutralite: 9.47, clarte: 8.88, themes: 8.65 },
    compare: { exactitude: 8.88, completude: 7.82, neutralite: 9.47, clarte: 8.71, themes: 8.65 },
  },
  // Dollars pour 1 000 fiches.
  coutPour1000: { retenu: 1.58, compare: 0.49 },
} as const;
