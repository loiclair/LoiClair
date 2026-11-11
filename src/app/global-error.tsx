"use client"

import { usePathname } from "next/navigation"
import { TEXTES_GLOBAL_ERROR } from "@/i18n/textes-global-error"

// Dernier filet : s'affiche quand la mise en page d'une langue elle-même plante, là
// où les `error.tsx` des groupes ne peuvent rien puisqu'ils vivent dessous. Elle
// remplace alors toute la page, `<html>` compris, et tourne hors du fournisseur de
// traductions et du thème : la langue se déduit du chemin, les textes viennent
// de `textes-global-error.ts` (pas du catalogue, voir ce fichier), l'accueil se rejoint par un `<a>` et la mise en
// forme tient dans la page, la feuille de style du site n'étant pas garantie ici.
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  const pathname = usePathname() ?? ""
  const locale = pathname === "/en" || pathname.startsWith("/en/") ? "en" : "fr"
  const t = TEXTES_GLOBAL_ERROR[locale]

  return (
    <html lang={locale}>
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", color: "#1c1917", background: "#fff" }}>
        <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", textAlign: "center" }}>
          <div style={{ maxWidth: "32rem" }}>
            <h1 style={{ fontSize: "1.75rem", lineHeight: 1.2, margin: "0 0 1rem" }}>{t.titre}</h1>
            <p style={{ color: "#57534e", lineHeight: 1.6, margin: "0 0 1.5rem" }}>{t.sousTitre}</p>
            <div style={{ display: "flex", gap: "1rem", justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={retry}
                style={{ font: "inherit", padding: "0.6rem 1.25rem", borderRadius: "999px", border: "none", background: "#0e7490", color: "#fff", cursor: "pointer" }}
              >
                {t.reessayer}
              </button>
              <a href={`/${locale}`} style={{ color: "#0e7490" }}>{t.accueil}</a>
            </div>
          </div>
        </main>
      </body>
    </html>
  )
}
