import "./globals.css"

// Racine sans `<html>` ni `<body>` : la langue n'est connue que sous `[locale]`, dont
// la mise en page les pose avec le bon `lang` (modèle documenté de next-intl). Les
// pages rendues hors de `[locale]` portent les leurs : `not-found.tsx` et
// `global-error.tsx` à côté de ce fichier. `app/page.tsx` n'en a pas besoin, il
// redirige avant tout rendu.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children
}
