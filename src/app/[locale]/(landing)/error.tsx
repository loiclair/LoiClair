"use client"

// L'accueil reprend la page d'erreur des autres pages. Sans elle, une erreur de
// l'accueil (une lecture en base : l'actualité, le dernier vote, le taux de
// `ChiffresSection`) remontait jusqu'à
// `app/global-error.tsx` et perdait l'en-tête et le pied de page.
export { default } from "../(app)/error"
