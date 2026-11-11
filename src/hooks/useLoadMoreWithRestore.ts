'use client';

import { useEffect, useLayoutEffect, useState } from 'react';
import { stockageSession } from '@/lib/stockage-navigateur';

const SCROLL_SAVE_DEBOUNCE_MS = 200;

type SavedState = { count: number; scrollY: number };

function readSaved(key: string): SavedState | null {
  if (typeof window === 'undefined') return null;
  // Le `try` ne couvre plus l'accès au stockage (`stockageSession` ne lève jamais,
  // voir D-151) mais le `JSON.parse` d'une valeur corrompue, qui lève encore.
  try {
    const raw = stockageSession.lire(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      count: typeof data?.count === 'number' ? data.count : 0,
      scrollY: typeof data?.scrollY === 'number' ? data.scrollY : 0,
    };
  } catch {
    return null;
  }
}

type Options = { initial?: number; pageSize?: number };

export function useLoadMoreWithRestore(
  storageKey: string,
  filtersKey: string,
  opts: Options = {},
) {
  const initial = opts.initial ?? 50;
  const pageSize = opts.pageSize ?? 50;

  const [count, setCount] = useState<number>(() => {
    const saved = readSaved(storageKey);
    return saved && saved.count > initial ? saved.count : initial;
  });
  const [prevFiltersKey, setPrevFiltersKey] = useState<string | null>(null);

  if (prevFiltersKey === null) {
    setPrevFiltersKey(filtersKey);
  } else if (prevFiltersKey !== filtersKey) {
    setPrevFiltersKey(filtersKey);
    setCount(initial);
  }

  // useLayoutEffect (not useEffect): scroll must run before paint so the user
  // never sees the page at top before snapping to the saved position.
  useLayoutEffect(() => {
    const saved = readSaved(storageKey);
    if (saved && saved.scrollY > 0) {
      window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const save = () => {
      stockageSession.ecrire(storageKey, JSON.stringify({ count, scrollY: window.scrollY }));
    };
    save();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(save, SCROLL_SAVE_DEBOUNCE_MS);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (timeout) clearTimeout(timeout);
      window.removeEventListener('scroll', onScroll);
      save();
    };
  }, [count, storageKey]);

  const loadMore = () => setCount((c) => c + pageSize);

  return { count, loadMore, pageSize };
}
