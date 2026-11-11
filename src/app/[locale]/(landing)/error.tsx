"use client"

// L'accueil reprend la page d'erreur des autres pages. Sans elle, une erreur de
// l'accueil (le taux de `MethodeChiffres` lu en base) remontait jusqu'à
// `app/global-error.tsx` et perdait l'en-tête et le pied de page.
export { default } from "../(app)/error"
