import type { CSSProperties, ReactNode } from "react"
import { RiSparkling2Fill } from "react-icons/ri"

/**
 * Pièces communes des maquettes de la landing : la surface qui porte une maquette,
 * la carte blanche posée dessus, la ligne grise qui figure du texte, le badge IA, et la
 * mise en page « texte d'un côté, maquette de l'autre » des sections illustrées. Utilisées par `LoiEnClair`,
 * `PourVousSection`, `MethodeCard`, `ReglesBand`, `NEstPas` et `SectionsBand`.
 *
 * Les maquettes ne montrent jamais de texte ou de chiffre inventé qui se lirait comme
 * un fait : du texte, elles ne gardent que des lignes grises, et les seuls nombres
 * affichés viennent du helper de l'article qu'ils illustrent (D-014).
 *
 * Dimensions en style inline : les tailles numériques de Tailwind v4 sortent en
 * `calc(var(--spacing) * N)`, que Safari ne résout pas.
 */

/** Fond doux et coins larges, sur lequel se pose une maquette, à la manière de Reachable. */
export function Surface({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="landing-surface"
      style={{ borderRadius: 28, padding: "clamp(1.25rem, 3vw, 2.25rem)", ...style }}
    >
      {children}
    </div>
  )
}

/**
 * Carte blanche posée sur une `Surface`, comme une page du site en miniature. Avec
 * `rang` (0 à 3), elle est mise en valeur à son tour dans le cycle d'un chemin de
 * `MethodeCard` (`.landing-actif-N`, voir globals.css) ; `bordure`, quand elle est
 * donnée, colore aussi son liseré de mise en valeur. Utilisée par `MethodeCard` et
 * `ReglesBand`.
 */
export function Carte({ children, bordure, rang }: { children: ReactNode; bordure?: string; rang?: number }) {
  return (
    <div
      className={rang === undefined ? undefined : `landing-actif-${rang}`}
      style={{
        "--anneau": bordure ? "rgba(212, 165, 74, 0.75)" : "rgba(6, 182, 212, 0.55)",
        borderRadius: 14,
        border: `1px solid ${bordure ?? "var(--border)"}`,
        backgroundColor: "var(--card)",
        // Marge latérale réduite sur mobile, où deux cartes partagent parfois une rangée :
        // à 18 px, le badge « Paramètres publiés » touchait le bord de la sienne.
        padding: "14px clamp(12px, 3vw, 18px)",
        boxShadow: "0 16px 32px -24px rgba(28, 25, 23, 0.25)",
      } as CSSProperties}
    >
      {children}
    </div>
  )
}

/**
 * Une ligne de texte figurée. `largeur` en pourcentage de la colonne. `classe` ajoute
 * un effet de `globals.css`, comme le reflet d'un traitement en cours.
 */
export function Ligne({
  largeur,
  hauteur = 8,
  style,
  classe,
}: {
  largeur: number
  hauteur?: number
  style?: CSSProperties
  classe?: string
}) {
  return (
    <span
      aria-hidden
      className={classe ? `landing-ligne ${classe}` : "landing-ligne"}
      style={{ display: "block", width: `${largeur}%`, height: hauteur, borderRadius: 999, ...style }}
    />
  )
}

/**
 * Section illustrée : un titre et son texte d'un côté, la maquette de l'autre, à
 * partir de `lg`. `inverse` met la maquette à gauche, pour alterner d'une section à
 * la suivante. En dessous de `lg`, le texte passe toujours au-dessus de la maquette.
 */
export function SectionIllustree({
  texte,
  visuel,
  inverse = false,
  id,
}: {
  texte: ReactNode
  visuel: ReactNode
  inverse?: boolean
  id?: string
}) {
  return (
    <section id={id} className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: "clamp(3rem, 6vw, 5rem)" }}>
      <div
        className="grid grid-cols-1 lg:grid-cols-2 lg:items-center"
        style={{ gap: "2.5rem clamp(2.5rem, 5vw, 5rem)" }}
      >
        <div className={inverse ? "lg:order-2" : undefined}>{texte}</div>
        <div className={inverse ? "lg:order-1" : undefined}>{visuel}</div>
      </div>
    </section>
  )
}

/**
 * Badge IA des maquettes, doré et appuyé (`.landing-badge-ia`) : il porte le libellé
 * et l'étincelle du vrai badge de la fiche (`resumeIA.aiBadge`, `AIBadge`), le libellé
 * passé par l'appelant en `libelle`.
 * Il passe à la ligne sur un écran étroit : insécable, il débordait de la carte à 375 px.
 */
export function BadgeIA({ libelle }: { libelle: string }) {
  return (
    <span
      className="landing-badge-ia inline-flex items-center"
      style={{ gap: 5, maxWidth: "100%", fontSize: 11, lineHeight: 1.35, fontWeight: 600, padding: "3px 10px", borderRadius: 999 }}
    >
      <RiSparkling2Fill aria-hidden size={13} style={{ flex: "none" }} />
      {libelle}
    </span>
  )
}

/** Titre de section des pages illustrées : même taille partout sur la landing. */
export const STYLE_TITRE_SECTION: CSSProperties = {
  fontSize: "clamp(1.6rem, 2.6vw, 2.25rem)",
  fontWeight: 700,
  lineHeight: 1.1,
  letterSpacing: "-0.03em",
}
