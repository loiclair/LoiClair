// Nuage de points « qualité selon le prix », rendu côté serveur en SVG nu : aucun
// JavaScript envoyé au navigateur. Appelé par /documentation/choix-modele-ia avec les
// résultats du banc d'essai des modèles.
//
// Le prix est en échelle logarithmique : les modèles comparés vont de moins d'un
// dollar à plus de cent pour 1 000 résumés, et une échelle linéaire écraserait
// tous les petits modèles contre l'axe.
//
// Chaque point porte un numéro, et non le nom du modèle : les noms se chevauchent
// dès que deux modèles sont proches, surtout sur mobile. Le tableau placé sous le
// graphique reprend les mêmes numéros et sert de légende.
//
// Un point peut être remplacé par le logo de son fournisseur, sur un disque de la
// couleur du fond pour rester lisible au-dessus du quadrillage.
//
// Le quart en haut à gauche est teinté : c'est là que se trouvent les modèles
// qui écrivent bien pour pas cher, donc là que se fait le choix.
//
// Couleurs en variables CSS (`var(--primary)`…) plutôt qu'en classes : elles
// suivent le thème sombre, et Tailwind v4 est peu fiable sur Safari pour ce qui
// est visuellement critique.

import type { IconType } from 'react-icons';

export type PointScoreCout = {
  numero: number;
  nom: string;
  score: number;
  /** Coût pour 1 000 résumés, en dollars. */
  cout: number;
  /** Sur la frontière qualité-prix : aucun modèle n'est à la fois meilleur et moins cher. */
  frontiere: boolean;
  /** Le modèle retenu par le site, mis en avant. */
  retenu: boolean;
  /** Logo du fournisseur, dessiné à la place du point. */
  Logo?: IconType;
};

// Côté du logo qui remplace le point, en unités du viewBox.
const TAILLE_LOGO = 13;

const W = 420;
const H = 280;
const MARGE = { gauche: 34, droite: 12, haut: 12, bas: 40 };

export function ScoreCoutChart({
  points, libelleAxeX, libelleAxeY, titre, formatCout, formatScore,
}: {
  points: PointScoreCout[];
  libelleAxeX: string;
  libelleAxeY: string;
  /** Description du graphique pour les lecteurs d'écran. */
  titre: string;
  /** Formate un montant en dollars dans la langue de la page. */
  formatCout: (dollars: number) => string;
  /** Formate une note sur 10 dans la langue de la page. */
  formatScore: (note: number) => string;
}) {
  const x0 = Math.floor(Math.log10(Math.min(...points.map((p) => p.cout))));
  const x1 = Math.ceil(Math.log10(Math.max(...points.map((p) => p.cout))));
  const y0 = Math.floor(Math.min(...points.map((p) => p.score)) - 0.5);
  const px = (c: number) => MARGE.gauche + ((Math.log10(c) - x0) / (x1 - x0)) * (W - MARGE.gauche - MARGE.droite);
  const py = (s: number) => MARGE.haut + ((10 - s) / (10 - y0)) * (H - MARGE.haut - MARGE.bas);

  const decades = Array.from({ length: x1 - x0 + 1 }, (_, i) => 10 ** (x0 + i));
  const notes = Array.from({ length: 10 - y0 + 1 }, (_, i) => y0 + i);
  const frontiere = points.filter((p) => p.frontiere).sort((a, b) => a.cout - b.cout);

  // Chaque numéro prend la première place libre autour de son point : à droite,
  // à gauche, au-dessus, en dessous. Une place est libre si elle ne recouvre ni
  // un autre point ni un numéro déjà placé. Les points sont traités du meilleur
  // score au moins bon, pour que la frontière garde les places les plus lisibles.
  const PLACES = [[15, 0], [-15, 0], [0, -14], [0, 15]] as const;
  const centres = new Map<number, { x: number; y: number }>();
  const demiPoint = TAILLE_LOGO / 2;
  const occupes: { x: number; y: number; demiL: number; demiH: number }[] = points.map((q) => ({ x: px(q.cout), y: py(q.score), demiL: demiPoint, demiH: demiPoint }));
  for (const p of [...points].sort((a, b) => b.score - a.score)) {
    const x = px(p.cout);
    const y = py(p.score);
    const demiL = String(p.numero).length * 3.5 + 1;
    const libre = (cx: number, cy: number) => occupes.every((o, i) =>
      (points[i] === p && o.demiL === demiPoint) // son propre point ne gêne pas
      || Math.abs(o.x - cx) >= o.demiL + demiL || Math.abs(o.y - cy) >= o.demiH + 6);
    const [dx, dy] = PLACES.find(([ddx, ddy]) => libre(x + ddx, y + ddy)) ?? PLACES[0];
    centres.set(p.numero, { x: x + dx, y: y + dy });
    occupes.push({ x: x + dx, y: y + dy, demiL, demiH: 6 });
  }

  // Zone « bon et pas cher » : le quart en haut à gauche, coupé au milieu de chaque
  // axe (milieu de l'échelle logarithmique pour le prix). Un repère visuel, pas un
  // seuil de la méthode : il suit l'étendue des modèles mesurés.
  const zoneDroite = px(10 ** ((x0 + x1) / 2));
  const zoneBas = py((10 + y0) / 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={titre} style={{ width: '100%', maxWidth: '600px', height: 'auto', display: 'block' }}>
      <rect
        x={MARGE.gauche}
        y={MARGE.haut}
        width={zoneDroite - MARGE.gauche}
        height={zoneBas - MARGE.haut}
        style={{ fill: 'color-mix(in srgb, var(--primary) 8%, transparent)' }}
      />
      {decades.map((c, i) => (
        <g key={c}>
          <line x1={px(c)} x2={px(c)} y1={MARGE.haut} y2={H - MARGE.bas} style={{ stroke: 'var(--border)' }} />
          {/* La dernière graduation s'aligne à droite, sinon elle sort du cadre. */}
          <text x={px(c)} y={H - MARGE.bas + 14} textAnchor={i === decades.length - 1 ? 'end' : 'middle'} style={{ fill: 'var(--muted-foreground)', fontSize: '10px' }}>
            {formatCout(c)}
          </text>
        </g>
      ))}
      {notes.map((s) => (
        <g key={s}>
          <line x1={MARGE.gauche} x2={W - MARGE.droite} y1={py(s)} y2={py(s)} style={{ stroke: 'var(--border)' }} />
          <text x={MARGE.gauche - 6} y={py(s) + 3.5} textAnchor="end" style={{ fill: 'var(--muted-foreground)', fontSize: '10px' }}>
            {s}
          </text>
        </g>
      ))}
      <text x={(W + MARGE.gauche - MARGE.droite) / 2} y={H - 6} textAnchor="middle" style={{ fill: 'var(--muted-foreground)', fontSize: '10px' }}>
        {libelleAxeX}
      </text>
      <text x={10} y={MARGE.haut + (H - MARGE.haut - MARGE.bas) / 2} textAnchor="middle" transform={`rotate(-90 10 ${MARGE.haut + (H - MARGE.haut - MARGE.bas) / 2})`} style={{ fill: 'var(--muted-foreground)', fontSize: '10px' }}>
        {libelleAxeY}
      </text>

      <polyline
        points={frontiere.map((p) => `${px(p.cout)},${py(p.score)}`).join(' ')}
        style={{ fill: 'none', stroke: 'var(--primary)', strokeWidth: 1.5 }}
      />

      {points.map((p) => {
        const x = px(p.cout);
        const y = py(p.score);
        const centre = centres.get(p.numero) ?? { x: x + 15, y };
        const couleur = p.frontiere ? 'var(--primary)' : 'var(--muted-foreground)';
        return (
          <g key={p.numero}>
            <title>{`${p.numero}. ${p.nom}, ${formatScore(p.score)}/10, ${formatCout(p.cout)}`}</title>
            {p.retenu && <circle cx={x} cy={y} r={p.Logo ? 10 : 8} style={{ fill: 'none', stroke: 'var(--primary)', strokeWidth: 1.5 }} />}
            {p.Logo ? (
              <>
                <circle cx={x} cy={y} r={demiPoint + 1} style={{ fill: 'var(--background)' }} />
                <p.Logo x={x - demiPoint} y={y - demiPoint} size={TAILLE_LOGO} style={{ color: couleur }} aria-hidden />
              </>
            ) : (
              <circle cx={x} cy={y} r={p.frontiere ? 4.5 : 3.5} style={{ fill: couleur }} />
            )}
            <text
              x={centre.x}
              y={centre.y + 3.5}
              textAnchor="middle"
              style={{ fill: p.frontiere ? 'var(--foreground)' : 'var(--muted-foreground)', fontSize: '11px', fontWeight: p.frontiere ? 600 : 400 }}
            >
              {p.numero}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
