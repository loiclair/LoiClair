'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { QuizRankingEntry, QuizUserAnswers } from '@/lib/quiz-affinite';
import { stockageLocal } from '@/lib/stockage-navigateur';

export const STORAGE_KEY = 'loiclair-quiz-affinite';

export type QuizRanking = QuizRankingEntry;

export type QuizResult = {
  ranking: QuizRanking[];
  answers: QuizUserAnswers;
  completedAt: string;
  /** Empreinte du set de scrutins utilisé (cf. computeQuestionSetFingerprint) —
   * absente sur les résultats sauvegardés avant ce champ, traitée comme
   * périmée dans ce cas. */
  questionSetFingerprint?: string;
};

// Cache module-level pour stabiliser les références : useSyncExternalStore
// re-render dès que la référence retournée change. On parse une seule fois par
// changement réel (raw string différent) et on réutilise le même objet sinon.
let cachedRaw: string | null = null;
let cachedValue: QuizResult | null = null;

function read(): QuizResult | null {
  if (typeof window === 'undefined') return null;
  const raw = stockageLocal.lire(STORAGE_KEY);
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  if (!raw) {
    cachedValue = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as QuizResult;
    cachedValue = parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    cachedValue = null;
  }
  return cachedValue;
}

function write(value: QuizResult | null) {
  if (typeof window === 'undefined') return;
  if (value === null) {
    stockageLocal.effacer(STORAGE_KEY);
    cachedRaw = null;
    cachedValue = null;
  } else {
    const serialized = JSON.stringify(value);
    stockageLocal.ecrire(STORAGE_KEY, serialized);
    cachedRaw = serialized;
    cachedValue = value;
  }
  window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY }));
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

export type UseQuizResultsReturn = {
  data: QuizResult | null;
  setResult: (ranking: QuizRanking[], answers: QuizUserAnswers, questionSetFingerprint: string) => void;
  clear: () => void;
};

export function useQuizResults(): UseQuizResultsReturn {
  const data = useSyncExternalStore(subscribe, read, () => null);

  const setResult = useCallback(
    (ranking: QuizRanking[], answers: QuizUserAnswers, questionSetFingerprint: string) => {
      write({ ranking, answers, questionSetFingerprint, completedAt: new Date().toISOString() });
    },
    [],
  );

  const clear = useCallback(() => {
    write(null);
  }, []);

  return { data, setResult, clear };
}
