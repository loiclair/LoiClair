// Constantes légales du Parlement français (Code électoral, art. L.O. 119 et 274).
// Source unique de vérité pour 577 / 348 / 925 — JAMAIS hardcoder ailleurs.
//
// Ce fichier n'importe pas la base (`db.ts`) pour être utilisable côté client.
// Pour les comptes réels (lus depuis la DB), voir `parliament-counts.ts` (server).

export const LEGAL_AN = 577;
export const LEGAL_SN = 348;
export const LEGAL_TOTAL = LEGAL_AN + LEGAL_SN;

export type ParliamentCounts = {
  an: number;
  sn: number;
  total: number;
};
