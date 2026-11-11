'use client';

// src/hooks/useEcranMobile.ts
// L'écran fait-il moins de 768 px de large ?
//
// Sert aux volets (`Sheet`) qui montent du bas sur téléphone et arrivent par la
// droite au-delà : le volet des votes d'un scrutin (`ScrutinVotesSheet`) et les
// panneaux de la fiche dossier (`Panneau` de `SourcesSection`, repris par
// `ModificationsSection`), dont une carte peut
// monter cinq à la fois. Chacun posait sa propre media query, son état et son
// effet ; ici, une seule media query sert tous les appelants.

import { useSyncExternalStore } from 'react';

// Même seuil que les menus de filtres (`ui/FilterBar`), qui basculent en volet bas
// au même 767 px.
const REQUETE = '(max-width: 767px)';

let mql: MediaQueryList | null = null;
const abonnes = new Set<() => void>();

function abonner(rappel: () => void) {
  if (!mql) {
    mql = window.matchMedia(REQUETE);
    mql.addEventListener('change', () => abonnes.forEach((f) => f()));
  }
  abonnes.add(rappel);
  return () => { abonnes.delete(rappel); };
}

/** Vrai sous 768 px. Faux côté serveur, qui ne connaît pas l'écran : le rendu
 *  hydraté se corrige au premier passage client, comme avec l'ancien effet. */
export function useEcranMobile(): boolean {
  return useSyncExternalStore(
    abonner,
    () => (mql ?? window.matchMedia(REQUETE)).matches,
    () => false,
  );
}
