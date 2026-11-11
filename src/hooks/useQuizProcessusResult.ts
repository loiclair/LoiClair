'use client';

import { useCallback, useSyncExternalStore } from 'react';
import type { QuizProcessusAnswerRecord, QuizProcessusScore } from '@/lib/quiz-processus';
import { stockageLocal } from '@/lib/stockage-navigateur';

// `-v2` depuis que les réponses sont enregistrées par indices et non plus en
// texte : un enregistrement v1 relu avec le nouveau schéma afficherait une
// mauvaise réponse plausible, ce qui est pire qu'un résultat perdu. Le changement
// de clé le fait simplement disparaître, comme le fait déjà la péremption du
// pool de questions.
export const STORAGE_KEY = 'loiclair-quiz-processus-v2';

export type QuizProcessusResult = QuizProcessusScore & {
  answers: QuizProcessusAnswerRecord[];
  completedAt: string;
  /** Empreinte du pool de questions (cf. QUIZ_PROCESSUS_POOL_FINGERPRINT) —
   * absente sur les résultats sauvegardés avant ce champ, traitée comme
   * périmée dans ce cas. */
  questionSetFingerprint?: string;
};

// Cache module-level pour stabiliser les références : useSyncExternalStore
// re-render dès que la référence retournée change. On parse une seule fois par
// changement réel (raw string différent) et on réutilise le même objet sinon.
let cachedRaw: string | null = null;
let cachedValue: QuizProcessusResult | null = null;

function read(): QuizProcessusResult | null {
  if (typeof window === 'undefined') return null;
  const raw = stockageLocal.lire(STORAGE_KEY);
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  if (!raw) {
    cachedValue = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as QuizProcessusResult;
    cachedValue = parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    cachedValue = null;
  }
  return cachedValue;
}

function write(value: QuizProcessusResult | null) {
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

export type UseQuizProcessusResultReturn = {
  data: QuizProcessusResult | null;
  setResult: (score: QuizProcessusScore, answers: QuizProcessusAnswerRecord[], questionSetFingerprint: string) => void;
  clear: () => void;
};

export function useQuizProcessusResult(): UseQuizProcessusResultReturn {
  const data = useSyncExternalStore(subscribe, read, () => null);

  const setResult = useCallback(
    (score: QuizProcessusScore, answers: QuizProcessusAnswerRecord[], questionSetFingerprint: string) => {
      write({ ...score, answers, questionSetFingerprint, completedAt: new Date().toISOString() });
    },
    [],
  );

  const clear = useCallback(() => {
    write(null);
  }, []);

  return { data, setResult, clear };
}
