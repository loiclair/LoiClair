"use client"

import { Children, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react"

/**
 * Rangée défilante des cartes de « Les lois dans l'actualité » (`ActualiteLois`), sans
 * bibliothèque (D-012) : un défilement horizontal natif, calé carte par carte
 * (`scroll-snap`), le titre et deux flèches au-dessus, une rangée de points dessous. Environ trois
 * cartes visibles au bureau, un peu plus d'une au téléphone, où l'on fait glisser du doigt.
 *
 * Elle avance seule d'une carte toutes les `INTERVALLE` ms et revient au début après la
 * dernière (demande d'Alex après l'essai du 2026-11-22). Elle s'arrête tant que le
 * pointeur la survole, que le doigt la touche ou que le focus clavier est dedans, et ne
 * bouge jamais pour qui demande moins d'animations (`prefers-reduced-motion`). Un bouton, à
 * gauche des flèches, l'arrête ou le relance : la règle d'accessibilité WCAG 2.2.2 demande
 * un moyen explicite de figer un contenu qui bouge seul plus de 5 s.
 *
 * Sous 768 px, ni bouton ni flèches (`.carrousel-controles`, masqués en CSS pour que le
 * rendu serveur soit déjà juste) et donc pas de défilement seul, faute de bouton pour
 * l'arrêter : le doigt fait glisser les cartes, les points disent où l'on en est (choix
 * d'Alex du 2026-11-23).
 *
 * Un point par position possible : avec dix cartes et trois visibles, huit positions, la
 * dernière montrant les trois dernières cartes. Le point actif s'allonge ; un clic y
 * mène. Les cartes sont rendues au serveur et passées en `children`, les libellés en
 * props (`precedent`, `suivant`, et `point`, où `{n}` reçoit le numéro de la position).
 */

// Largeur d'une carte : un tiers de la rangée, gouttières comprises, mais jamais moins
// de 16,5 rem. Au bureau, trois cartes ; à 390 px, une carte et le bord de la suivante,
// qui montre qu'il y en a d'autres. En `clamp` dans le style : Safari lit mal les
// largeurs responsives de Tailwind (ARCHITECTURE.md §Pièges).
const LARGEUR_CARTE = "clamp(16.5rem, calc((100% - 2rem) / 3), 100%)"
const GOUTTIERE = 16
const INTERVALLE = 5000
const MOINS_ANIMATIONS = "(prefers-reduced-motion: reduce)"
// Même seuil que `.carrousel-controles` dans `globals.css` : sous lui, pas de bouton,
// donc pas de défilement seul.
const ECRAN_ETROIT = "(max-width: 767px)"
// L'une ou l'autre condition fige la rangée.
const RANGEE_FIGEE = `${MOINS_ANIMATIONS}, ${ECRAN_ETROIT}`

/** Suit les deux conditions qui figent la rangée (moins d'animations, écran étroit). */
function abonnerRangeeFigee(rappel: () => void) {
  const requete = window.matchMedia(RANGEE_FIGEE)
  requete.addEventListener("change", rappel)
  return () => requete.removeEventListener("change", rappel)
}

export function CarrouselActualite({
  children,
  entete,
  precedent,
  suivant,
  point,
  arreter,
  reprendre,
}: {
  children: ReactNode
  /** Le titre de la section, posé à gauche sur la ligne des flèches. */
  entete: ReactNode
  precedent: string
  suivant: string
  point: string
  /** Libellés du bouton du défilement seul, selon qu'il tourne ou non. */
  arreter: string
  reprendre: string
}) {
  const rangee = useRef<HTMLUListElement>(null)
  const [positions, setPositions] = useState(1)
  const [active, setActive] = useState(0)
  // Ce qui suspend le défilement seul : survol, toucher, focus. Une ref et non un état :
  // le changer ne doit rien redessiner.
  const pause = useRef({ survol: false, toucher: false, focus: false })
  // L'arrêt demandé par le lecteur, lui, redessine : il change l'icône du bouton.
  const [arrete, setArrete] = useState(false)
  // Faux pour qui demande moins d'animations ou sur un écran étroit : rien ne défile, le
  // bouton s'éteint (ou n'est pas montré). Vrai au rendu serveur, qui ne connaît ni la
  // préférence ni la largeur ; la minuterie ne part de toute façon que dans le navigateur.
  const mouvement = !useSyncExternalStore(
    abonnerRangeeFigee,
    () => window.matchMedia(RANGEE_FIGEE).matches,
    () => false,
  )

  // Largeur d'un pas (une carte et sa gouttière), nombre de positions et position
  // courante, relus à chaque défilement, qu'il vienne des flèches, des points, du
  // défilement seul, du doigt ou du clavier.
  const mesurer = useCallback(() => {
    const el = rangee.current
    const carte = el?.firstElementChild as HTMLElement | null
    if (!el || !carte) return
    const pas = carte.offsetWidth + GOUTTIERE
    // Les cartes vues en entier : une carte coupée au bord droit doit rester à atteindre,
    // sinon la flèche s'éteint et le défilement seul repart avant de la montrer.
    const visibles = Math.max(1, Math.floor((el.clientWidth + GOUTTIERE + 1) / pas))
    const total = Math.max(1, el.children.length - visibles + 1)
    setPositions(total)
    // Au bout de la rangée, la dernière position, même si le dernier pas est plus court
    // qu'une carte (le navigateur arrête le défilement au bord).
    const auBout = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4
    setActive(auBout ? total - 1 : Math.min(total - 1, Math.round(el.scrollLeft / pas)))
  }, [])

  useEffect(() => {
    const el = rangee.current
    if (!el) return
    mesurer()
    el.addEventListener("scroll", mesurer, { passive: true })
    window.addEventListener("resize", mesurer)
    return () => {
      el.removeEventListener("scroll", mesurer)
      window.removeEventListener("resize", mesurer)
    }
  }, [mesurer])

  const aller = useCallback((position: number) => {
    const el = rangee.current
    const carte = el?.firstElementChild as HTMLElement | null
    if (!el || !carte) return
    el.scrollTo({ left: position * (carte.offsetWidth + GOUTTIERE), behavior: "smooth" })
  }, [])

  // Le défilement seul : une carte de plus à chaque tour, retour au début après la
  // dernière position. Rien quand tout tient à l'écran.
  useEffect(() => {
    if (!mouvement || arrete || positions <= 1) return
    const minuterie = window.setInterval(() => {
      const { survol, toucher, focus } = pause.current
      if (survol || toucher || focus || document.hidden) return
      aller(active + 1 >= positions ? 0 : active + 1)
    }, INTERVALLE)
    return () => window.clearInterval(minuterie)
  }, [active, positions, aller, arrete, mouvement])

  const fleche = (sens: 1 | -1) => {
    const Icone = sens === 1 ? ChevronRight : ChevronLeft
    const eteinte = sens === 1 ? active >= positions - 1 : active <= 0
    return (
      <button
        type="button"
        onClick={() => aller(active + sens)}
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
    <div
      // Le survol d'une souris seulement : un toucher émule aussi `mouseenter`, sans
      // jamais de `mouseleave`, et arrêtait le défilement pour de bon au téléphone.
      onPointerEnter={(e) => { if (e.pointerType === "mouse") pause.current.survol = true }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") pause.current.survol = false }}
      onTouchStart={() => (pause.current.toucher = true)}
      // Après un geste, le défilement seul reprend au tour suivant de la minuterie.
      onTouchEnd={() => (pause.current.toucher = false)}
      onTouchCancel={() => (pause.current.toucher = false)}
      // Le focus du clavier seulement : un clic de souris sur une flèche laisse le focus
      // sur le bouton, et le défilement resterait arrêté jusqu'à un clic ailleurs.
      onFocusCapture={(e) => (pause.current.focus = (e.target as HTMLElement).matches(":focus-visible"))}
      onBlurCapture={() => (pause.current.focus = false)}
    >
      {/* Le titre à gauche, les flèches à droite. Les flèches sont toujours rendues, même
        quand tout tient à l'écran (elles sont alors éteintes) : masquées après la mesure,
        elles faisaient remonter les cartes d'une rangée au chargement. */}
      {/* Le texte prend toute la largeur libre ; sous 768 px, les boutons sont masqués
        (`.carrousel-controles`). Entre 768 px et une largeur où tout tient sur une ligne,
        ils passent sous le texte, calés à droite, plutôt que de le serrer en colonne. */}
      <div className="flex flex-wrap items-center justify-between" style={{ gap: "0.75rem 1.5rem" }}>
        <div style={{ minWidth: 0, flex: "1 1 20rem" }}>{entete}</div>
        <div className="carrousel-controles flex" style={{ gap: 8, flex: "none", marginLeft: "auto" }}>
          <button
            type="button"
            onClick={() => setArrete((a) => !a)}
            disabled={!mouvement || positions <= 1}
            aria-label={arrete || !mouvement ? reprendre : arreter}
            aria-pressed={arrete}
            className="flex items-center justify-center rounded-full border bg-card"
            style={{ width: 36, height: 36, opacity: !mouvement || positions <= 1 ? 0.35 : 1, cursor: "pointer" }}
          >
            {arrete || !mouvement ? <Play aria-hidden style={{ width: 15, height: 15 }} /> : <Pause aria-hidden style={{ width: 15, height: 15 }} />}
          </button>
          {fleche(-1)}
          {fleche(1)}
        </div>
      </div>
      <ul
        ref={rangee}
        style={{
          display: "flex",
          gap: GOUTTIERE,
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
      {/* La rangée de points garde sa hauteur avant la mesure, et quand tout tient à
        l'écran : apparue après coup, elle poussait vers le bas tout ce qui la suit. */}
      <div className="flex justify-center" style={{ gap: 6, marginTop: "1rem", minHeight: 24 }}>
        {positions > 1 &&
          Array.from({ length: positions }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => aller(i)}
              aria-label={point.replace("{n}", String(i + 1))}
              aria-current={i === active ? "true" : undefined}
              // Une zone de clic de 24 px autour d'un point de 8 : un point seul serait
              // trop petit pour un doigt.
              className="flex items-center justify-center"
              style={{ width: i === active ? 32 : 24, height: 24, padding: 0, cursor: "pointer" }}
            >
              <span
                style={{
                  display: "block",
                  width: i === active ? 20 : 8,
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: i === active ? "var(--primary)" : "color-mix(in srgb, var(--muted-foreground) 35%, transparent)",
                  transition: "width 0.2s ease, background-color 0.2s ease",
                }}
              />
            </button>
          ))}
      </div>
    </div>
  )
}
