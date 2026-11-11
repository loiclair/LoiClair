'use client';

// Les profils de « Ce qui me concerne », gardés dans le navigateur comme « Mes élus »
// (`useMesElus`), et le catalogue qui les range par thème. Lus par la page « Ce qui me
// concerne », qui les fait choisir, et par la fiche d'un texte, qui montre ce que le
// texte change pour eux. Ils ne quittent jamais le navigateur (D-243) : aucune requête
// ne les porte.

import { useCallback, useSyncExternalStore } from 'react';
import { stockageLocal } from '@/lib/stockage-navigateur';
import { PROFILS } from '@/lib/profils';

// Le catalogue et son ordre vivent dans `lib/profils.ts`, que le serveur peut lire ;
// réexportés ici pour que les composants n'importent qu'un module.
export { PROFILS, THEMES, ORDRE_PROFILS, type Theme } from '@/lib/profils';

const VALIDES = new Set(PROFILS);
const CLE = 'loiclair-mes-profils';

// Même mécanique que `useMesElus` : la référence rendue ne change que si la valeur
// stockée change, sinon `useSyncExternalStore` re-rendrait sans fin.
let brutEnCache: string | null = null;
let valeurEnCache: string[] = [];
const VIDE: string[] = [];
// Repli quand le stockage refuse d'écrire (Safari réglé sur « bloquer tous les
// cookies », voir `stockage-navigateur.ts`) : sans lui, `lire` rendait toujours une
// liste vide et aucun profil ne se cochait. Les profils tiennent alors le temps de la
// visite.
let enMemoire: string | null = null;

/** Les profils gardés, à la lecture du moment : pour un geste qui doit partir de
 *  l'état du stockage et non du dernier rendu. */
export function lire(): string[] {
  const brut = enMemoire ?? stockageLocal.lire(CLE);
  if (brut === brutEnCache) return valeurEnCache;
  brutEnCache = brut;
  try {
    const v = brut ? JSON.parse(brut) : [];
    valeurEnCache = Array.isArray(v) ? v.filter((x): x is string => VALIDES.has(x)) : [];
  } catch {
    valeurEnCache = [];
  }
  return valeurEnCache;
}

function abonner(rappel: () => void) {
  window.addEventListener('storage', rappel);
  return () => window.removeEventListener('storage', rappel);
}

/** Les profils gardés dans le navigateur, et de quoi les remplacer. Le rendu serveur
 *  et le premier rendu du navigateur voient une liste vide : les profils n'arrivent
 *  qu'après l'hydratation. */
export function useMesProfils(): [string[], (suivants: string[]) => void] {
  const profils = useSyncExternalStore(abonner, lire, () => VIDE);
  const ecrire = useCallback((suivants: string[]) => {
    const brut = JSON.stringify(suivants);
    enMemoire = stockageLocal.ecrire(CLE, brut) ? null : brut;
    window.dispatchEvent(new StorageEvent('storage', { key: CLE }));
  }, []);
  return [profils, ecrire];
}
