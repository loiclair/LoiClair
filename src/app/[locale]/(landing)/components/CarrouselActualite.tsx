"use client"

import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

/**
 * Rangée défilante des cartes de « Les lois dans l'actualité » (`ActualiteLois`), sans
 * bibliothèque (D-012) : un défilement horizontal natif, calé carte par carte
 * (`scroll-snap`), et deux flèches au-dessus. Environ trois cartes visibles au bureau,
 * un peu plus d'une au téléphone, où l'on fait glisser du doigt.
 *
 * Client pour les flèches : elles font défiler d'une largeur de rangée et s'éteignent
 * aux deux bouts, ou toutes deux quand toutes les cartes tiennent à l'écran. Les cartes, elles, sont rendues au serveur et passées en `children`.
 * Les libellés des flèches arrivent en props (`precedent`, `suivant`).
 */

// Largeur d'une carte : un tiers de la rangée, gouttières comprises, mais jamais moins
// de 16,5 rem. Au bureau, trois cartes ; à 390 px, une carte et le bord de la suivante,
// qui montre qu'il y en a d'autres. En `clamp` dans le style : Safari lit mal les
// largeurs responsives de Tailwind (ARCHITECTURE.md §Pièges).
const LARGEUR_CARTE = "clamp(16.5rem, calc((100% - 2rem) / 3), 100%)"

export function CarrouselActualite({ children, precedent, suivant }: { children: ReactNode; precedent: string; suivant: string }) {
  const rangee = useRef<HTMLUListElement>(null)
  const [debut, setDebut] = useState(true)
  const [fin, setFin] = useState(false)

  // Les flèches suivent la position du défilement, qu'il vienne d'elles, du doigt ou
  // du clavier (une carte qui prend le focus défile jusqu'à l'écran).
  const lirePosition = useCallback(() => {
    const el = rangee.current
    if (!el) return
    setDebut(el.scrollLeft <= 4)
    setFin(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = rangee.current
    if (!el) return
    lirePosition()
    el.addEventListener("scroll", lirePosition, { passive: true })
    window.addEventListener("resize", lirePosition)
    return () => {
      el.removeEventListener("scroll", lirePosition)
      window.removeEventListener("resize", lirePosition)
    }
  }, [lirePosition])

  const defiler = (sens: 1 | -1) => {
    const el = rangee.current
    if (el) el.scrollBy({ left: sens * el.clientWidth, behavior: "smooth" })
  }

  const fleche = (sens: 1 | -1, eteinte: boolean) => {
    const Icone = sens === 1 ? ChevronRight : ChevronLeft
    return (
      <button
        type="button"
        onClick={() => defiler(sens)}
        disabled={eteinte}
        aria-label={sens === 1 ? suivant : precedent}
        className="flex items-center justify-center rounded-full border bg-card"
        style={{ width: 36, height: 36, opacity: eteinte ? 0.35 : 1, cursor: eteinte ? "default" : "pointer" }}
      >
        <Icone aria-hidden style={{ width: 18, height: 18 }} />
      </button>
    )
  }

  return (
    <div>
      {/* Toujours rendues, même quand tout tient à l'écran (elles sont alors éteintes) :
        masquées après la mesure, elles faisaient remonter les cartes d'une rangée au
        chargement. */}
      <div className="flex justify-end" style={{ gap: 8, marginTop: "1.25rem" }}>
        {fleche(-1, debut)}
        {fleche(1, fin)}
      </div>
      <ul
        ref={rangee}
        style={{
          display: "flex",
          gap: "1rem",
          marginTop: "1rem",
          overflowX: "auto",
          scrollSnapType: "x mandatory",
          scrollbarWidth: "none",
          // Un peu d'air sous les cartes, pour leur bordure au survol et l'anneau de focus.
          paddingBottom: 4,
        }}
      >
        {Children.map(children, (enfant) => (
          <li style={{ display: "flex", flex: `0 0 ${LARGEUR_CARTE}`, minWidth: 0, scrollSnapAlign: "start" }}>{enfant}</li>
        ))}
      </ul>
    </div>
  )
}
