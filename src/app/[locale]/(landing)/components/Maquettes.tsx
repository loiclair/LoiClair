import type { CSSProperties, ReactNode } from "react"
import { ArrowRight, LockKeyhole } from "lucide-react"
import { RiSparkling2Fill } from "react-icons/ri"

import { Link } from "@/i18n/navigation"

/**
 * Pièces communes des maquettes de la landing : la surface qui porte une maquette,
 * la carte blanche posée dessus, la ligne grise qui figure du texte, le badge IA, et la
 * mise en page des six sections numérotées (sur-titre, texte d'un côté, maquette de
 * l'autre). Utilisées par `PourVousSection`, `LoiEnClair`, `SectionsBenefices`,
 * `Confiance`, `ActualiteLois`, `FaqAccueil` et `SectionsBand`.
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
 * Carte blanche posée sur une `Surface`, comme une page du site en miniature.
 * `bordure` colore son filet : doré pour une carte écrite par une IA, comme sur la fiche.
 */
export function Carte({ children, bordure }: { children: ReactNode; bordure?: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${bordure ?? "var(--border)"}`,
        backgroundColor: "var(--card)",
        // Marge latérale réduite sur mobile, où deux cartes partagent parfois une rangée :
        // à 18 px, un badge IA touchait le bord de la sienne.
        padding: "14px clamp(12px, 3vw, 18px)",
        boxShadow: "0 16px 32px -24px rgba(28, 25, 23, 0.25)",
      }}
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
 * Sur-titre d'une section : son numéro en gris, puis son nom en petites capitales de la
 * couleur primaire (« 01 Pour vous »). Lu par `SectionIllustree` et par `Confiance`.
 */
export function SurTitre({ numero, libelle }: { numero: number; libelle: string }) {
  return (
    <p
      className="flex items-center"
      style={{ gap: "0.6rem", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--primary)" }}
    >
      <span className="text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
        {String(numero).padStart(2, "0")}
      </span>
      {libelle}
    </p>
  )
}

/**
 * Section illustrée et numérotée : sur-titre (`numero`, `surTitre`), titre et texte d'un
 * côté, la maquette de l'autre, à partir de `lg`. `inverse` met la maquette à gauche,
 * pour alterner d'une section à la suivante. En dessous de `lg`, le texte passe toujours
 * au-dessus de la maquette.
 */
export function SectionIllustree({
  numero,
  surTitre,
  texte,
  visuel,
  inverse = false,
}: {
  numero: number
  surTitre: string
  texte: ReactNode
  visuel: ReactNode
  inverse?: boolean
}) {
  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: "clamp(3rem, 6vw, 5rem)" }}>
      <div
        className="grid grid-cols-1 lg:grid-cols-2 lg:items-center"
        style={{ gap: "2.5rem clamp(2.5rem, 5vw, 5rem)" }}
      >
        <div className={inverse ? "lg:order-2" : undefined} style={{ minWidth: 0 }}>
          <SurTitre numero={numero} libelle={surTitre} />
          <div style={{ marginTop: "0.75rem" }}>{texte}</div>
        </div>
        <div className={inverse ? "lg:order-1" : undefined} style={{ minWidth: 0 }}>
          {visuel}
        </div>
      </div>
    </section>
  )
}

/**
 * Colonne de texte d'une section illustrée : titre, paragraphe, ligne au cadenas
 * facultative (`garde`, ce qui reste sur l'appareil du lecteur), puis un ou deux liens.
 */
export function TexteSection({
  titre,
  texte,
  garde,
  liens,
}: {
  titre: string
  texte: string
  garde?: string
  liens: { libelle: string; href: string }[]
}) {
  return (
    <>
      <h2 className="text-balance" style={STYLE_TITRE_SECTION}>
        {titre}
      </h2>
      <p className="text-muted-foreground" style={{ marginTop: "1rem", maxWidth: "34rem", fontSize: "1.0625rem", lineHeight: 1.65 }}>
        {texte}
      </p>
      {garde && (
        <p className="flex items-start text-muted-foreground" style={{ gap: "0.5rem", marginTop: "1rem", maxWidth: "34rem", fontSize: "0.875rem", lineHeight: 1.55 }}>
          <LockKeyhole aria-hidden style={{ width: 16, height: 16, flex: "none", marginTop: "0.15rem", color: "var(--primary)" }} />
          {garde}
        </p>
      )}
      <div className="flex flex-wrap" style={{ gap: "0.5rem 1.75rem", marginTop: "1.25rem" }}>
        {liens.map(({ libelle, href }) => (
          <Link
            key={href}
            href={href}
            className="inline-flex items-center hover:underline"
            style={{ gap: 6, fontSize: "0.9375rem", fontWeight: 600, color: "var(--primary)" }}
          >
            {libelle}
            <ArrowRight aria-hidden style={{ width: 16, height: 16 }} />
          </Link>
        ))}
      </div>
    </>
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
