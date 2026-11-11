import type { CSSProperties } from "react"

/**
 * Une case d'élément, à la manière d'un tableau périodique : numéro en haut à
 * gauche, symbole, nom en bas. Les rubriques du site en portent une
 * (`lib/elements.ts`), chacune de sa couleur ; le logo Lc, qui suit la même
 * anatomie, a son propre dessin (`LogoLc`).
 *
 * Trois tailles. `md` montre les trois, à 72 px par défaut ou au côté `cote`
 * (64 px dans l'en-tête des rubriques), tout le contenu suivant la proportion.
 * `sm` (40 px) et `titre` montrent le symbole seul : le numéro et le nom n'y sont
 * plus lisibles. `titre` se mesure en `em` : la case prend la taille de la police
 * de son parent, ou du `fontSize` passé en `style` (28 px sur les cartes de
 * l'accueil, 28 px aussi dans le menu mobile). Fond de couleur, texte blanc. Coins
 * droits partout, comme la case du logo.
 *
 * Décorative (`aria-hidden`) : elle est toujours posée à côté d'un titre ou d'un
 * lien qui dit déjà le nom. Libellés et couleur en props, comme tout `ui/`. Tailles
 * et positions en style en ligne, Tailwind v4 les rendant mal sur Safari
 * (`ARCHITECTURE.md` §Pièges Tailwind v4 sur Safari).
 */
export function Element({
  numero,
  symbole,
  nom,
  couleur,
  taille = "md",
  cote: coteMd = 72,
  style,
}: {
  numero: number
  symbole: string
  /** Couleur CSS de l'élément, `couleurElement(cle)`. Elle porte du texte blanc. */
  couleur: string
  /** Côté de la case `md`, en pixels. Sans effet sur les autres tailles. */
  cote?: number
  style?: CSSProperties
} & (
  // Le nom n'est demandé qu'à la taille qui l'affiche : les autres appelants n'ont
  // pas à traduire un libellé que la case ne montrerait pas.
  | { taille?: "md"; nom: string }
  | { taille: "sm" | "titre"; nom?: never }
)) {
  const md = taille === "md"
  // Toutes les mesures de la case `md` sont celles d'une case de 72 px, à l'échelle.
  const k = coteMd / 72
  const cote = md ? `${coteMd}px` : taille === "sm" ? "40px" : "1em"

  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: md ? "flex-start" : "center",
        flexShrink: 0,
        width: cote,
        height: cote,
        boxSizing: "border-box",
        backgroundColor: couleur,
        color: "#ffffff",
        padding: md ? `0 ${7 * k}px` : 0,
        lineHeight: 1,
        // Le nom, en position absolue, hérite sinon de l'alignement du parent : il
        // sortait centré dans la carte centrée de la newsletter.
        textAlign: "left",
        // Posée dans un titre, la case hériterait sinon de son interlettrage serré.
        letterSpacing: "normal",
        ...style,
      }}
    >
      {md && (
        <span style={{ position: "absolute", top: 6 * k, left: 7 * k, fontSize: 10 * k, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
          {numero}
        </span>
      )}
      {/* En `titre`, la moitié de la police du titre, donc la moitié de la case. */}
      <span style={{ fontSize: md ? 27 * k : taille === "sm" ? 17 : "0.48em", fontWeight: 700, letterSpacing: "-0.03em" }}>
        {symbole}
      </span>
      {md && (
        <span
          style={{
            position: "absolute",
            left: 7 * k,
            right: 5 * k,
            bottom: 4 * k,
            fontSize: 8.5 * k,
            fontWeight: 500,
            // Interligne de 1 hérité de la case : l'accent de « État » sortait de la
            // boîte, et `overflow: hidden` le coupait.
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {nom}
        </span>
      )}
    </span>
  )
}
