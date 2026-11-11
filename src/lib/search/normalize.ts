// src/lib/search/normalize.ts
// Normalisation FR : lowercase + décomposition NFD + suppression des diacritiques.
// Appliquée aux termes de l'index ET aux requêtes pour que « écologie » matche « ecologie ».

export function normalizeFr(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`]/g, "'");
}

export const FR_STOPWORDS: ReadonlySet<string> = new Set([
  'le',
  'la',
  'les',
  'de',
  'du',
  'des',
  'un',
  'une',
  'a',
  'à',
  'et',
  'ou',
  'en',
  'au',
  'aux',
  'sur',
  'par',
  'pour',
  'dans',
  "l'",
  "d'",
  "s'",
  'ce',
  'cette',
  'ces',
  'se',
  'sa',
  'son',
  'ses',
  'qui',
  'que',
  'quoi',
  'dont',
  'est',
  'sont',
  'pas',
  'ne',
]);

// Mots vides anglais, pour l'index des dossiers seul (`processTermDossiers`) : il cherche
// aussi dans le titre traduit (`titre_en`), et la recherche exige chaque mot
// (`combineWith: 'AND'`) ; sans eux, « the » écarterait tous les dossiers dont le titre
// n'est pas encore traduit. Pas dans `processTerm` : la recherche d'élus cherche par
// préfixe, et « And » (André) ou « The » (Thévenot) n'y trouveraient plus rien.
// (« a » est déjà dans `FR_STOPWORDS`.)
const EN_STOPWORDS: ReadonlySet<string> = new Set(['the', 'of', 'and', 'to', 'on', 'for', 'in']);

export function processTerm(term: string): string | null {
  const n = normalizeFr(term).replace(/[^\p{L}\p{N}']/gu, '');
  if (!n) return null;
  if (FR_STOPWORDS.has(n)) return null;
  return n;
}

export function processTermDossiers(term: string): string | null {
  const n = processTerm(term);
  return n && EN_STOPWORDS.has(n) ? null : n;
}
