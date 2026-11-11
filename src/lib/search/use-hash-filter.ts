'use client';

// Filtres des listes (dossiers, élus) gardés dans le hash de l'URL : un lien
// partagé rouvre la liste filtrée, et le fragment n'est jamais envoyé au
// serveur (D-021). Les écritures passent par `replaceState` puis un
// `hashchange` synthétique, que `replaceState` n'émet pas de lui-même.

import { useCallback, useMemo, useSyncExternalStore } from 'react';

/**
 * Valeurs d'un filtre à plusieurs choix (`#statut=promulguee,appliquee`), dans
 * l'ordre du hash. Aucun slug des filtres en hash ne contient de virgule (slugs
 * `a_z_0_9_`, noms de départements) : elle peut servir de séparateur.
 */
export function lireListe(v: string | null): string[] {
  return (v ?? '').split(',').filter(Boolean);
}

/** Inverse de `lireListe` : chaîne vide quand rien n'est coché, ce qui retire la clé. */
export function ecrireListe(slugs: readonly string[]): string {
  return slugs.join(',');
}

/** Chaîne du hash, la virgule des listes laissée en clair : `URLSearchParams`
 *  l'encode en `%2C`, illisible dans un lien partagé. Les deux se relisent pareil. */
function versHash(params: URLSearchParams): string {
  const qs = params.toString().replace(/%2C/gi, ',');
  return qs ? `#${qs}` : '';
}

export function readHashParams(): URLSearchParams {
  if (typeof window === 'undefined') return new URLSearchParams();
  const hash = window.location.hash;
  if (!hash || hash.length < 2) return new URLSearchParams();
  return new URLSearchParams(hash.slice(1));
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function writeHashParam(key: string, value: string) {
  if (typeof window === 'undefined') return;
  const params = readHashParams();
  // Retirée puis remise, la clé passe en fin de hash même si elle y était déjà :
  // l'ordre du hash est celui des filtres posés, dont l'état vide propose de
  // retirer le dernier. `set` seul la laisserait à sa place d'origine.
  params.delete(key);
  if (value) params.set(key, value);
  const url = `${window.location.pathname}${window.location.search}${versHash(params)}`;
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function writeHashParams(updates: Record<string, string>) {
  if (typeof window === 'undefined') return;
  const params = readHashParams();
  // Même règle d'ordre que `writeHashParam` : une clé réécrite passe en fin de
  // hash, sans quoi l'état vide proposerait de retirer un filtre plus ancien.
  for (const [key, value] of Object.entries(updates)) {
    params.delete(key);
    if (value) params.set(key, value);
  }
  const url = `${window.location.pathname}${window.location.search}${versHash(params)}`;
  window.history.replaceState(null, '', url);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

/**
 * Tous les paramètres du hash, pour qui suit un nombre variable de clés (la rangée
 * de filtres) ou leur ordre (le dernier filtre posé). L'instantané est la chaîne
 * brute : `useSyncExternalStore` compare par identité, un objet neuf à chaque
 * lecture ferait boucler le rendu.
 */
export function useHashParams(): URLSearchParams {
  const brut = useSyncExternalStore(
    subscribe,
    () => readHashParams().toString(),
    () => ''
  );
  return useMemo(() => new URLSearchParams(brut), [brut]);
}

export function useHashFilter(key: string): [string, (v: string) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readHashParams().get(key) ?? '',
    () => ''
  );
  const set = useCallback((v: string) => writeHashParam(key, v), [key]);
  return [value, set];
}
