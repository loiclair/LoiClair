// Les quatre textes de `app/global-error.tsx`, en français et en anglais, hors du
// catalogue `messages/*.json`. Ce composant tourne hors du fournisseur de traductions
// et doit lire ses textes par import direct ; importer les catalogues y mettait leurs
// 900 Ko dans un fichier que Next charge sur chaque page, mesuré au build du
// 2026-10-28. Les deux langues se modifient ensemble, comme dans le catalogue.

export const TEXTES_GLOBAL_ERROR = {
  fr: {
    titre: "LoiClair n'a pas pu afficher cette page.",
    sousTitre: "Une erreur inattendue est survenue. Réessayez, ou revenez à l'accueil.",
    reessayer: "Réessayer",
    accueil: "Accueil",
  },
  en: {
    titre: "LoiClair could not display this page.",
    sousTitre: "An unexpected error occurred. Try again, or go back to the home page.",
    reessayer: "Retry",
    accueil: "Home",
  },
} as const
