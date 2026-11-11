// src/lib/search/use-hash-query.ts
// Hook : lit/écrit #q=... dans l'URL. Les fragments ne sont jamais envoyés au
// serveur → le texte de recherche reste toujours côté client (journaux du serveur inclus).

'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { readHashParams, writeHashParam } from './use-hash-filter';

function readHashQuery(): string {
  return readHashParams().get('q') ?? '';
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function writeHashQuery(q: string) {
  writeHashParam('q', q);
}

export function useHashQuery(): [string, (q: string) => void] {
  const query = useSyncExternalStore(
    subscribe,
    readHashQuery,
    () => ''
  );

  const set = useCallback((q: string) => {
    writeHashQuery(q);
  }, []);

  return [query, set];
}
