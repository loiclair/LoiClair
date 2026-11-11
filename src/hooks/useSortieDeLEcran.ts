'use client';

// src/hooks/useSortieDeLEcran.ts
// Un élément est-il passé au-dessus du bord haut de la fenêtre ?
//
// Sert aux barres de navigation interne des pages (onglets de section d'une
// fiche, barre de mois du fil) : aucune ne colle, elles défilent avec la page, et
// c'est leur sortie qui fait apparaître `BoutonRemonter`. Les deux appelants
// posaient la même mesure de deux façons, dont une sans écouteur de
// redimensionnement.

import { useEffect, useState, type RefObject } from 'react';

/**
 * Rend `true` quand le bas de `ref` est passé au-dessus du bord haut.
 *
 * La mesure passe par un `requestAnimationFrame` : `scroll` part à chaque image
 * pendant un défilement, et un `setState` par événement rendrait le composant
 * autant de fois. `resize` compte aussi : une rotation d'écran ou une section
 * repliée plus haut peut ramener la barre en vue sans qu'aucun défilement ne se
 * produise.
 */
export function useSortieDeLEcran(ref: RefObject<HTMLElement | null>): boolean {
  const [sortie, setSortie] = useState(false);

  useEffect(() => {
    let frame = 0;
    const mesurer = () => {
      frame = 0;
      const bas = ref.current?.getBoundingClientRect().bottom;
      setSortie(bas !== undefined && bas < 0);
    };
    const planifier = () => { if (!frame) frame = requestAnimationFrame(mesurer); };
    frame = requestAnimationFrame(mesurer);
    window.addEventListener('scroll', planifier, { passive: true });
    window.addEventListener('resize', planifier);
    return () => {
      window.removeEventListener('scroll', planifier);
      window.removeEventListener('resize', planifier);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);

  return sortie;
}
