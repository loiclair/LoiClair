"use client"

// Voile flouté plein écran, posé pendant une attente qui bloque la lecture.
//
// Rendu seul : il ne décide jamais de son apparition. Trois appelants aujourd'hui,
// avec trois déclencheurs sans rapport — `NavigationOverlay` pour une navigation
// lente vers une fiche, `MonthFeedClient` pour un saut de mois du fil, qui n'est
// pas une navigation du tout mais un Server Action, et `CeQuiMeConcerneClient`
// tant que les profils gardés dans le navigateur ne sont pas lus (rendu serveur
// et hydratation). Ce qu'ils partagent est
// exactement ce qui est ici : la structure en deux couches, le z-index et les
// classes d'animation.

import { Loader2 } from "lucide-react"

export default function VoileFlou({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      style={{
        position: "fixed",
        inset: 0,
        // Au-dessus de TopNav (z-index 50) : le voile couvre toute la page,
        // et bloque au passage un second clic pendant l'attente.
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Deux couches séparées, jamais d'opacité sur leur parent : un ancêtre à
          `opacity < 1` créerait un groupe d'empilement, et le `backdrop-filter`
          ne flouterait plus la page mais ce groupe vide. Voir globals.css. */}
      <div
        className="nav-overlay-flou"
        style={{
          position: "absolute",
          inset: 0,
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
      />
      <div
        className="nav-overlay-voile"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "var(--background)",
          opacity: 0.55,
        }}
      />
      <Loader2
        style={{
          position: "relative",
          width: 28,
          height: 28,
          color: "var(--muted-foreground)",
          animation: "spin 1s linear infinite",
        }}
      />
    </div>
  )
}
