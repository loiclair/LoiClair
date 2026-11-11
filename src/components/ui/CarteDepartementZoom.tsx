import type { Prefecture } from '@/lib/prefectures';

/**
 * Zoom sur un département seul, à côté de la carte de France de la fiche élu :
 * le contour, un aplat léger de la couleur du groupe, et un point sur la
 * préfecture avec son nom, comme la fiche sénateur du Sénat.
 *
 * Attend le `d` du tracé tel qu'il est dans `public/departements.svg`, sans son
 * `transform`, et l'emprise de ce tracé (`getBBox()`, même repère) ; la
 * préfecture vient de `PREFECTURES`, calculée dans ce même repère. Appelé par
 * `EluProfileClient`, qui extrait tracé et emprise de la carte déjà chargée.
 */

export interface Emprise {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  trace: string;
  emprise: Emprise;
  prefecture: Prefecture;
  couleur: string;
  ariaLabel: string;
}

// Proportions rapportées au côté du cadre carré, pour que le texte et le point
// gardent la même taille à l'écran quel que soit le département : le zoom a
// toujours la même largeur, seule l'échelle du viewBox change.
const MARGE = 0.1;
// 0,05 du côté : environ 13 px sur les 260 px de la colonne du zoom, la taille
// des sous-titres de la section.
const POLICE = 0.05;
// Largeur moyenne d'un caractère en em, volontairement large : le nom est
// estimé sans être mesuré, ce qui évite un second rendu après mesure, et une
// surestimation ne coûte qu'un peu de vide, une sous-estimation couperait le nom.
// Mesurée sur les 102 noms : 0,62 au plus en IBM Plex Sans, 0,70 dans la
// police système qui la remplace tant qu'elle n'est pas chargée.
const CHASSE = 0.72;

type Boite = [number, number, number, number]; // x0, y0, x1, y1

const union = (a: Boite, b: Boite): Boite => [
  Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]),
];
const aire = (b: Boite) => (b[2] - b[0]) * (b[3] - b[1]);

export default function CarteDepartementZoom({ trace, emprise, prefecture, couleur, ariaLabel }: Props) {
  const cote = Math.max(emprise.width, emprise.height) * (1 + 2 * MARGE);
  const cx = emprise.x + emprise.width / 2;
  const cy = emprise.y + emprise.height / 2;
  const cadre: Boite = [cx - cote / 2, cy - cote / 2, cx + cote / 2, cy + cote / 2];

  const f = cote * POLICE;
  const rayon = f * 0.3;
  const ecart = rayon + f * 0.35;
  const largeur = prefecture.nom.length * CHASSE * f;
  const { x: px, y: py } = prefecture;

  // Quatre places pour le nom autour du point ; on garde celle qui agrandit le
  // moins le cadre (à égalité, l'ordre du tableau : droite d'abord, comme le
  // Sénat). Dessous et dessus, le nom glisse horizontalement pour rester dans
  // le cadre plutôt que de l'élargir.
  const glisse = Math.min(Math.max(px, cadre[0] + largeur / 2), cadre[2] - largeur / 2);
  const places = [
    { x: px + ecart, y: py, ancre: 'start', boite: [px + ecart, py - f * 0.6, px + ecart + largeur, py + f * 0.6] },
    { x: px - ecart, y: py, ancre: 'end', boite: [px - ecart - largeur, py - f * 0.6, px - ecart, py + f * 0.6] },
    { x: glisse, y: py + ecart + f * 0.5, ancre: 'middle', boite: [glisse - largeur / 2, py + ecart, glisse + largeur / 2, py + ecart + f * 1.1] },
    { x: glisse, y: py - ecart - f * 0.5, ancre: 'middle', boite: [glisse - largeur / 2, py - ecart - f * 1.1, glisse + largeur / 2, py - ecart] },
  ] as const;
  const place = places.reduce((best, p) =>
    aire(union(cadre, p.boite as Boite)) < aire(union(cadre, best.boite as Boite)) ? p : best);
  const [x0, y0, x1, y1] = union(cadre, place.boite as Boite);

  return (
    <svg
      viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`}
      role="img"
      aria-label={ariaLabel}
      style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
    >
      <path
        d={trace}
        fill={couleur}
        fillOpacity={0.18}
        stroke="var(--muted-foreground)"
        strokeWidth={1}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={px} cy={py} r={rayon} fill="var(--foreground)" />
      <text
        x={place.x}
        y={place.y}
        textAnchor={place.ancre}
        // Centre le nom verticalement sur le point (vérifié dans Safari iOS).
        dy="0.35em"
        fill="var(--foreground)"
        // Halo de la couleur de la carte : le nom reste lisible là où il
        // chevauche le contour ou l'aplat.
        stroke="var(--card)"
        strokeWidth={f * 0.3}
        strokeLinejoin="round"
        paintOrder="stroke"
        style={{ fontSize: f, fontWeight: 500 }}
      >
        {prefecture.nom}
      </text>
    </svg>
  );
}
