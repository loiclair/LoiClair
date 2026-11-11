// src/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/amendements-carte.ts
// Ce que la carte « Amendements adoptés par auteur » montre sans rien charger. Lu par
// `page.tsx`, qui n'envoie que cette part, et par `ModificationsSection`, qui décide
// quand proposer le panneau. Module sans `'use client'` ni dépendance serveur : une
// constante importée d'un fichier client arrive côté serveur sous forme de référence,
// pas de valeur.

// Dix auteurs : la colonne du graphique, à côté sur ordinateur, en compte une
// vingtaine de lignes, et trois laissaient la colonne des adoptés presque vide.
export const AUTEURS_VISIBLES = 10;
export const AMENDEMENTS_VISIBLES = 10;

/** Les auteurs de la carte, chacun avec les amendements que sa ligne déplie. L'ordre
 *  et le champ `nb` (total de l'auteur) viennent de `amendementsAdoptes`. */
export function carteAmendements<T extends { amendements: unknown[] }>(auteurs: T[]): T[] {
  return auteurs.slice(0, AUTEURS_VISIBLES).map((a) => ({
    ...a,
    amendements: a.amendements.slice(0, AMENDEMENTS_VISIBLES),
  }));
}
