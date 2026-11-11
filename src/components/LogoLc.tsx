// Le logo de LoiClair : l'élément « Lc » d'un tableau périodique, case droite à
// contour épais. Deux dessins tirés du kit de logo : `compact`, la case et « Lc »
// seuls (lettres vectorisées en IBM Plex Sans Bold, sans dépendance de police), pour
// l'en-tête et les petites tailles ; `complet`, avec 348 (les sénateurs), 577 (les
// députés) et le nom, pour les grandes tailles (pied de page, 404). Le `complet` est
// allégé par rapport au kit, voir son rendu.
//
// Dessiné en `currentColor` : la couleur vient du parent, en général `var(--logo)`.
// Toujours décoratif (`aria-hidden`) : dans l'en-tête, le lien qui le porte dit
// « LoiClair » en texte ; ailleurs (pied de page, 404), il illustre.

const COMPACT = "M-25.79 21V-20.88H-16.67V12.9H-0.71V21ZM16.25 21.72Q12.71 21.72 9.95 20.55Q7.19 19.38 5.33 17.25Q3.47 15.12 2.51 12.06Q1.55 9 1.55 5.22Q1.55 1.44 2.51 -1.59Q3.47 -4.62 5.33 -6.78Q7.19 -8.94 9.95 -10.08Q12.71 -11.22 16.25 -11.22Q21.05 -11.22 24.26 -9.06Q27.47 -6.9 28.85 -3L21.65 0.12Q21.23 -1.68 19.91 -2.94Q18.59 -4.2 16.25 -4.2Q13.55 -4.2 12.17 -2.43Q10.79 -0.66 10.79 2.34V8.22Q10.79 11.22 12.17 12.96Q13.55 14.7 16.25 14.7Q18.65 14.7 20.06 13.41Q21.47 12.12 22.13 10.02L29.03 13.02Q27.47 17.52 24.2 19.62Q20.93 21.72 16.25 21.72Z"

// Les chiffres 348 et 577, puis le nom ; « Lc » est du texte (voir `LogoLc`).
const COMPLET = [
  "M-49.55 -56.99Q-48.44 -56.99 -47.91 -57.45Q-47.39 -57.92 -47.39 -58.65V-58.77Q-47.39 -59.59 -47.9 -60.02Q-48.41 -60.45 -49.27 -60.45Q-50.12 -60.45 -50.72 -60.07Q-51.31 -59.69 -51.72 -59.01L-53 -60.12Q-52.73 -60.51 -52.39 -60.86Q-52.05 -61.22 -51.59 -61.48Q-51.13 -61.75 -50.55 -61.91Q-49.97 -62.07 -49.22 -62.07Q-48.39 -62.07 -47.68 -61.87Q-46.96 -61.66 -46.45 -61.26Q-45.94 -60.86 -45.65 -60.29Q-45.36 -59.72 -45.36 -59.01Q-45.36 -58.45 -45.54 -57.99Q-45.72 -57.53 -46.04 -57.18Q-46.35 -56.83 -46.77 -56.61Q-47.18 -56.39 -47.64 -56.29V-56.2Q-47.13 -56.1 -46.68 -55.87Q-46.23 -55.64 -45.89 -55.28Q-45.55 -54.91 -45.36 -54.41Q-45.16 -53.91 -45.16 -53.26Q-45.16 -52.48 -45.47 -51.84Q-45.77 -51.21 -46.32 -50.75Q-46.88 -50.29 -47.66 -50.04Q-48.44 -49.8 -49.39 -49.8Q-50.23 -49.8 -50.86 -49.97Q-51.48 -50.15 -51.97 -50.45Q-52.45 -50.75 -52.82 -51.13Q-53.18 -51.51 -53.46 -51.92L-52.05 -53.03Q-51.82 -52.67 -51.58 -52.37Q-51.33 -52.07 -51.02 -51.86Q-50.7 -51.65 -50.3 -51.53Q-49.9 -51.41 -49.39 -51.41Q-48.3 -51.41 -47.73 -51.93Q-47.15 -52.45 -47.15 -53.37V-53.48Q-47.15 -54.4 -47.76 -54.88Q-48.37 -55.36 -49.49 -55.36H-50.75V-56.99ZM-37.4 -50V-52.31H-42.91V-53.96L-38.09 -61.87H-35.58V-53.83H-33.96V-52.31H-35.58V-50ZM-41.27 -53.83H-37.4V-60.12H-37.52ZM-27.9 -49.8Q-28.94 -49.8 -29.73 -50.06Q-30.52 -50.32 -31.05 -50.78Q-31.59 -51.24 -31.87 -51.87Q-32.15 -52.5 -32.15 -53.23Q-32.15 -54.42 -31.5 -55.14Q-30.84 -55.87 -29.77 -56.15V-56.29Q-30.69 -56.61 -31.24 -57.31Q-31.79 -58.01 -31.79 -59.03Q-31.79 -59.71 -31.53 -60.27Q-31.27 -60.83 -30.77 -61.23Q-30.28 -61.63 -29.55 -61.85Q-28.82 -62.07 -27.9 -62.07Q-26.98 -62.07 -26.25 -61.85Q-25.52 -61.63 -25.03 -61.23Q-24.53 -60.83 -24.27 -60.27Q-24.01 -59.71 -24.01 -59.03Q-24.01 -58.01 -24.56 -57.31Q-25.11 -56.61 -26.03 -56.29V-56.15Q-24.96 -55.87 -24.3 -55.14Q-23.65 -54.42 -23.65 -53.23Q-23.65 -52.5 -23.93 -51.87Q-24.21 -51.24 -24.75 -50.78Q-25.28 -50.32 -26.07 -50.06Q-26.86 -49.8 -27.9 -49.8ZM-27.9 -51.34Q-26.83 -51.34 -26.24 -51.84Q-25.66 -52.33 -25.66 -53.21V-53.55Q-25.66 -54.44 -26.24 -54.93Q-26.83 -55.42 -27.9 -55.42Q-28.97 -55.42 -29.56 -54.93Q-30.14 -54.44 -30.14 -53.55V-53.21Q-30.14 -52.33 -29.56 -51.84Q-28.97 -51.34 -27.9 -51.34ZM-27.9 -56.9Q-26.91 -56.9 -26.4 -57.33Q-25.88 -57.75 -25.88 -58.57V-58.86Q-25.88 -59.67 -26.4 -60.1Q-26.91 -60.52 -27.9 -60.52Q-28.89 -60.52 -29.4 -60.1Q-29.92 -59.67 -29.92 -58.86V-58.57Q-29.92 -57.75 -29.4 -57.33Q-28.89 -56.9 -27.9 -56.9Z",
  "M31.44 -60.2H26.17L25.86 -56H25.98Q26.18 -56.36 26.4 -56.64Q26.62 -56.92 26.91 -57.12Q27.2 -57.33 27.58 -57.44Q27.95 -57.55 28.46 -57.55Q29.23 -57.55 29.88 -57.29Q30.53 -57.04 31.02 -56.56Q31.5 -56.09 31.78 -55.4Q32.05 -54.71 32.05 -53.84Q32.05 -52.96 31.77 -52.21Q31.49 -51.46 30.94 -50.93Q30.4 -50.39 29.61 -50.09Q28.82 -49.8 27.81 -49.8Q27.02 -49.8 26.4 -49.97Q25.79 -50.15 25.32 -50.45Q24.86 -50.75 24.51 -51.13Q24.16 -51.51 23.89 -51.92L25.28 -53.03Q25.5 -52.67 25.74 -52.38Q25.98 -52.09 26.28 -51.87Q26.59 -51.65 26.97 -51.53Q27.36 -51.41 27.85 -51.41Q28.9 -51.41 29.47 -51.99Q30.04 -52.57 30.04 -53.59V-53.79Q30.04 -54.81 29.47 -55.39Q28.9 -55.97 27.85 -55.97Q27.08 -55.97 26.62 -55.68Q26.17 -55.39 25.84 -55.03L24.26 -55.25L24.7 -61.87H31.44ZM36.21 -50 40.51 -60.28H36.02V-58.09H34.37V-61.87H42.41V-60.2L38.23 -50ZM46.71 -50 51.01 -60.28H46.52V-58.09H44.87V-61.87H52.91V-60.2L48.73 -50Z",
  "M-52.62 62V50.83H-50.82V60.4H-46.27V62ZM-41.18 62.19Q-42.04 62.19 -42.76 61.89Q-43.47 61.58 -43.96 61.02Q-44.46 60.45 -44.73 59.64Q-45 58.83 -45 57.84Q-45 56.85 -44.73 56.04Q-44.46 55.23 -43.96 54.66Q-43.47 54.1 -42.76 53.79Q-42.04 53.49 -41.18 53.49Q-40.32 53.49 -39.6 53.79Q-38.89 54.1 -38.4 54.66Q-37.9 55.23 -37.63 56.04Q-37.36 56.85 -37.36 57.84Q-37.36 58.83 -37.63 59.64Q-37.9 60.45 -38.4 61.02Q-38.89 61.58 -39.6 61.89Q-40.32 62.19 -41.18 62.19ZM-41.18 60.75Q-40.28 60.75 -39.74 60.2Q-39.2 59.65 -39.2 58.54V57.14Q-39.2 56.03 -39.74 55.48Q-40.28 54.93 -41.18 54.93Q-42.08 54.93 -42.62 55.48Q-43.16 56.03 -43.16 57.14V58.54Q-43.16 59.65 -42.62 60.2Q-42.08 60.75 -41.18 60.75ZM-34.44 52.19Q-34.98 52.19 -35.23 51.94Q-35.48 51.68 -35.48 51.28V51.01Q-35.48 50.61 -35.23 50.35Q-34.98 50.1 -34.44 50.1Q-33.9 50.1 -33.66 50.35Q-33.42 50.61 -33.42 51.01V51.28Q-33.42 51.68 -33.66 51.94Q-33.9 52.19 -34.44 52.19ZM-35.32 53.68H-33.58V62H-35.32ZM-26.66 62.19Q-28.85 62.19 -30.1 60.71Q-31.35 59.23 -31.35 56.42Q-31.35 55.01 -31.03 53.94Q-30.71 52.86 -30.1 52.13Q-29.49 51.39 -28.62 51.02Q-27.75 50.64 -26.66 50.64Q-25.2 50.64 -24.22 51.28Q-23.24 51.92 -22.68 53.17L-24.2 54Q-24.48 53.2 -25.08 52.73Q-25.68 52.26 -26.66 52.26Q-27.96 52.26 -28.69 53.14Q-29.43 54.02 -29.43 55.57V57.26Q-29.43 58.82 -28.69 59.7Q-27.96 60.58 -26.66 60.58Q-25.65 60.58 -25.02 60.06Q-24.39 59.54 -24.08 58.72L-22.63 59.6Q-23.19 60.82 -24.2 61.5Q-25.2 62.19 -26.66 62.19ZM-18.96 62Q-19.86 62 -20.3 61.54Q-20.74 61.09 -20.74 60.27V50.16H-18.99V60.58H-17.84V62ZM-9.98 62Q-10.67 62 -11.04 61.61Q-11.4 61.22 -11.48 60.61H-11.56Q-11.8 61.39 -12.44 61.79Q-13.08 62.19 -14 62.19Q-15.29 62.19 -15.99 61.52Q-16.68 60.85 -16.68 59.71Q-16.68 58.46 -15.78 57.84Q-14.88 57.22 -13.13 57.22H-11.63V56.51Q-11.63 55.74 -12.04 55.33Q-12.46 54.91 -13.34 54.91Q-14.08 54.91 -14.54 55.23Q-15 55.55 -15.32 56.05L-16.36 55.1Q-15.95 54.4 -15.2 53.94Q-14.44 53.49 -13.23 53.49Q-11.61 53.49 -10.75 54.24Q-9.88 54.99 -9.88 56.4V60.58H-9V62ZM-13.5 60.86Q-12.68 60.86 -12.16 60.5Q-11.63 60.14 -11.63 59.54V58.34H-13.1Q-14.91 58.34 -14.91 59.46V59.74Q-14.91 60.3 -14.53 60.58Q-14.16 60.86 -13.5 60.86ZM-6.31 52.19Q-6.86 52.19 -7.1 51.94Q-7.35 51.68 -7.35 51.28V51.01Q-7.35 50.61 -7.1 50.35Q-6.86 50.1 -6.31 50.1Q-5.77 50.1 -5.53 50.35Q-5.29 50.61 -5.29 51.01V51.28Q-5.29 51.68 -5.53 51.94Q-5.77 52.19 -6.31 52.19ZM-7.19 53.68H-5.45V62H-7.19ZM-2.85 62V53.68H-1.11V55.28H-1.03Q-0.85 54.64 -0.29 54.16Q0.27 53.68 1.26 53.68H1.72V55.36H1.04Q0 55.36 -0.56 55.7Q-1.11 56.03 -1.11 56.69V62Z"
]

interface LogoLcProps {
  variante?: "compact" | "complet"
  /** Hauteur : des pixels, ou une longueur CSS (un `clamp()` pour une taille
   *  fluide). La largeur suit le rapport du dessin. */
  taille: number | string
  style?: React.CSSProperties
}

/**
 * Hauteur et largeur du SVG pour un viewBox de `largeur` × `hauteur`. En pixels,
 * des attributs ; une longueur CSS ne s'écrit pas dans un attribut, elle passe donc
 * en style, et `aspectRatio` (tiré du viewBox, pour ne pas le recopier chez
 * l'appelant) recalcule la largeur.
 */
function dimensions(taille: number | string, largeur: number, hauteur: number) {
  return typeof taille === "number"
    ? { attributs: { height: taille, width: (taille * largeur) / hauteur }, style: {} }
    : { attributs: {}, style: { height: taille, width: "auto", aspectRatio: `${largeur} / ${hauteur}` } }
}

export default function LogoLc({ variante = "compact", taille, style }: LogoLcProps) {
  if (variante === "complet") {
    const d = dimensions(taille, 150, 170)
    // Case de 140 × 160, plus haute que large comme une case du tableau. Allégée à la
    // demande d'Alex, qui la trouvait trop grasse dans le pied de page : trait de 6
    // au lieu des 9 du kit, et « Lc » en Plex SemiBold au lieu du tracé Bold, 20 %
    // plus petit que dans le kit pour laisser respirer les chiffres et le nom. Du
    // texte et non un tracé, donc la police du site doit être chargée : ce dessin ne
    // convient pas à une image générée hors du navigateur.
    return (
      <svg viewBox="-75 -85 150 170" {...d.attributs} aria-hidden="true" focusable="false" style={{ display: "block", flexShrink: 0, ...d.style, ...style }}>
        <rect x={-70} y={-80} width={140} height={160} fill="none" stroke="currentColor" strokeWidth={6} />
        <g fill="currentColor">
          {COMPLET.map((d, i) => <path key={i} d={d} />)}
          {/* Hauteur de capitale de 52,4 unités (0,698 em en Plex, à 75), 80 % des
              65,6 du tracé du kit. Ligne de base à 25,8 : le centre de « Lc » reste à
              -0,4, entre les chiffres (bas à -49,8) et le nom (haut vers 50), avec
              environ 23 unités d'espace de chaque côté. Calé sur le « L » de
              LoiClair (`x` à -58,7), il paraissait collé au bord gauche : Alex l'a
              voulu un peu plus à droite, d'où 7 unités de décalage, réglées à l'œil
              (le centrage serait à -36,8, pour une boîte de 73,6 de large). */}
          <text x={-51.7} y={25.8} style={{ fontFamily: "var(--font-ibm-plex-sans), sans-serif", fontWeight: 600, fontSize: 75, letterSpacing: -1.6 }}>
            Lc
          </text>
        </g>
      </svg>
    )
  }
  const d = dimensions(taille, 108, 108)
  return (
    <svg viewBox="-54 -54 108 108" {...d.attributs} aria-hidden="true" focusable="false" style={{ display: "block", flexShrink: 0, ...d.style, ...style }}>
      <rect x={-50} y={-50} width={100} height={100} fill="none" stroke="currentColor" strokeWidth={8} />
      <path fill="currentColor" d={COMPACT} />
    </svg>
  )
}
