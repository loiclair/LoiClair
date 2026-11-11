// Matrice d'accord entre groupes politiques, en demi-matrice : seule la partie sous
// la diagonale est dessinée, puisque l'accord de A avec B est celui de B avec A.
// Chaque case porte son pourcentage écrit en clair (l'infobulle SVG ne s'ouvre pas
// au toucher, donc sans lui le chiffre restait introuvable sur téléphone) et une
// couleur divergente autour de la moyenne observée. Seul appelant : /Facts/alliances.
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export type MatrixGroupe = {
  uid: string;
  libelle: string;
  libelleAbrege: string;
  color: string;
};

export type MatrixHeatmapProps = {
  title: string;
  description?: string;
  note: string;
  groupes: MatrixGroupe[];
  /** Clé = `${uidA}|${uidB}` avec uidA < uidB (lexico). */
  values: Map<string, { accord: number; nb: number }>;
  threshold: number;
  /** Couleur du pôle « haut » (accord élevé). */
  colorHigh: string;
  /** Couleur du pôle « bas » (désaccord élevé), toute couleur CSS, variable comprise.
   *  Par défaut un bleu froid. */
  colorLow?: string;
  /** Couleur du chiffre sur une case saturée du pôle bas. Blanc par défaut ; à passer
   *  en variable CSS quand `colorLow` en est une dont la variante sombre est claire. */
  textOnLow?: string;
  /** Fonction de formatage du tooltip SVG natif. */
  formatTooltip: (a: string, b: string, accord: number, count: number) => string;
  belowThresholdLabel: string;
  /** Locale de rendu : formate les deux bornes de la jauge. */
  locale: string;
};

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Intensité d'une case, de 0 (blanc, au point neutre `mid`) à 1 (couleur pleine,
 * à `span` points du neutre). Sert à la fois au fond et au choix de la couleur du chiffre.
 */
function intensite(accord: number, mid: number, span: number): number {
  return Math.min(1, Math.abs(accord - mid) / span);
}

/**
 * Échelle divergente autour d'un point neutre `mid` :
 *   accord <= mid  → interpole entre colorLow (loin) et blanc (mid)
 *   accord >= mid  → interpole entre blanc (mid) et colorHigh (loin)
 * `span` est l'écart (en points) qui atteint la couleur pleine.
 * Le mélange est confié au navigateur (`color-mix`) et non calculé ici : une couleur
 * peut être une variable CSS qui change avec le thème (`colorLow` de /Facts/alliances),
 * dont le serveur ne connaît pas la valeur. En sRGB, le résultat est le même que
 * l'interpolation linéaire des composantes qu'il remplace.
 */
function divergingColor(
  accord: number,
  mid: number,
  span: number,
  colorLow: string,
  colorHigh: string
): string {
  const loin = accord >= mid ? colorHigh : colorLow;
  const t = intensite(accord, mid, span);
  return `color-mix(in srgb, ${loin} ${(t * 100).toFixed(1)}%, white)`;
}

// Chiffre foncé fixe, et non `--foreground` : les cases restent claires dans les deux
// thèmes (mélange vers le blanc), un chiffre clair y serait illisible en mode sombre.
const TEXTE_SUR_CLAIR = '#1f2937';
// Au-delà de cette intensité, le chiffre passe au blanc (pôle haut) ou à `textOnLow`.
// Calculé pour #be185d et #1e40af mélangés au blanc : le blanc et le gris foncé donnent
// le même contraste vers 0,72 pour le rose et 0,66 pour le bleu (environ 3,8:1) ;
// en dessous le foncé l'emporte.
const SEUIL_TEXTE_CLAIR = 0.7;
// Chiffre sur une case saturée du pôle haut : `colorHigh` est une couleur fixe et
// foncée chez le seul appelant, le blanc y reste lisible dans les deux thèmes.
const TEXTE_SUR_HAUT = '#ffffff';

export function MatrixHeatmap({
  title,
  description,
  note,
  groupes,
  values,
  threshold,
  colorHigh,
  colorLow = '#1e40af',
  textOnLow = '#ffffff',
  formatTooltip,
  belowThresholdLabel,
  locale,
}: MatrixHeatmapProps) {
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent' });

  // Demi-matrice sans diagonale : lignes = groupes 1..n-1, colonnes = groupes 0..n-2.
  // Chaque ligne commence donc à la colonne 0, contre son libellé, et la dernière
  // ligne est pleine, ce qui permet de poser les libellés de colonnes juste dessous.
  const n = groupes.length;
  const cotes = n - 1;
  const TOP = 4;
  const GAUGE_H = 10;
  const GAUGE_GAP = 12;

  const truncate = (s: string, max: number) =>
    s.length > max ? `${s.slice(0, max - 1)}…` : s;

  // Point neutre et amplitude calculés à partir des données (hors sous-seuil).
  const obs: number[] = [];
  for (const [, v] of values) {
    if (v.nb >= threshold) obs.push(v.accord);
  }
  const mid = obs.length > 0 ? obs.reduce((a, b) => a + b, 0) / obs.length : 50;
  const minObs = obs.length > 0 ? Math.min(...obs) : 0;
  const maxObs = obs.length > 0 ? Math.max(...obs) : 100;
  const span = Math.max(mid - minObs, maxObs - mid, 1);

  /**
   * Dessine la matrice. `abrege` sert sous 640 px : les sigles des groupes (« RN »,
   * « LFI-NFP ») et des cases de 24 px font tenir les deux matrices dans l'écran
   * d'un téléphone de 390 px, où les noms complets obligeaient à défiler de côté.
   * Le nom complet reste dans l'infobulle de chaque libellé.
   */
  const dessiner = (abrege: boolean) => {
    const CELL = abrege ? 24 : 26;
    // Sans marge à droite en version abrégée : la matrice du Sénat (« Les
    // Indépendants », 16 caractères) tient alors au pixel près à 390 px.
    const RIGHT = abrege ? 0 : 8;
    const nom = (g: MatrixGroupe) =>
      abrege ? g.libelleAbrege : truncate(g.libelle, 22);
    // 6,5 px par caractère de 11 px : mesuré dans Chrome, de 5,8 (« LFI-NFP ») à
    // 7,5 (« HOR », capitales) ; les sigles en capitales sont les plus courts. Les
    // libellés inclinés à 70° occupent sin(70°) ≈ 0,94 de leur longueur en hauteur.
    const plusLong = Math.max(...groupes.map((g) => nom(g).length));
    const LEFT = abrege ? Math.ceil(plusLong * 6.5) + 12 : 160;
    const BOTTOM_LABELS = abrege ? Math.ceil(plusLong * 6.5 * 0.94) + 12 : 135;
    const width = LEFT + cotes * CELL + RIGHT;
    const gridBottom = TOP + cotes * CELL;
    const gaugeY = gridBottom + BOTTOM_LABELS + GAUGE_GAP;
    const height = gaugeY + GAUGE_H + 22;
    // Les deux versions sont dans la page : chacune son dégradé.
    const gaugeId = `gauge-${groupes[0]?.uid ?? 'na'}-${n}-${abrege ? 'a' : 'c'}`;

    return (
      <svg
        role="img"
        aria-label={title}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ display: 'block' }}
      >
        <defs>
          <linearGradient id={gaugeId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style={{ stopColor: colorLow }} />
            <stop
              offset={`${((mid - minObs) / (maxObs - minObs || 1)) * 100}%`}
              stopColor="#ffffff"
            />
            <stop offset="100%" stopColor={colorHigh} />
          </linearGradient>
        </defs>

        {/* Libellés de lignes (groupes 1..n-1), tronqués si trop longs */}
        {groupes.slice(1).map((g, r) => {
          const cy = TOP + r * CELL + CELL / 2 + 3;
          return (
            <text
              key={`left-${g.uid}`}
              x={LEFT - 8}
              y={cy}
              textAnchor="end"
              fontSize={11}
              fill="var(--foreground)"
              style={{ fontFamily: 'inherit' }}
            >
              <title>{g.libelle}</title>
              {nom(g)}
            </text>
          );
        })}

        {/* Libellés de colonnes (groupes 0..n-2) sous la dernière ligne, inclinés :
            ancrés par la fin, ils descendent vers la gauche depuis leur colonne. */}
        {groupes.slice(0, -1).map((g, c) => {
          const cx = LEFT + c * CELL + CELL / 2;
          return (
            <g
              key={`bottom-${g.uid}`}
              transform={`translate(${cx + 3}, ${gridBottom + 6}) rotate(-70)`}
            >
              <text
                x={0}
                y={0}
                textAnchor="end"
                fontSize={11}
                fill="var(--foreground)"
                style={{ fontFamily: 'inherit' }}
              >
                <title>{g.libelle}</title>
                {nom(g)}
              </text>
            </g>
          );
        })}

        {/* Cases : ligne i (1..n-1), colonne j (0..i-1) */}
        {groupes.map((ga, i) =>
          groupes.slice(0, i).map((gb, j) => {
            const x = LEFT + j * CELL;
            const y = TOP + (i - 1) * CELL;
            const v = values.get(pairKey(ga.uid, gb.uid));
            let fill: string;
            let title: string;
            let chiffre: { texte: string; couleur: string } | null = null;
            if (!v || v.nb < threshold) {
              fill = '#e5e7eb';
              title = `${ga.libelle} vs ${gb.libelle} — ${belowThresholdLabel}`;
            } else {
              const arrondi = Math.round(v.accord);
              fill = divergingColor(v.accord, mid, span, colorLow, colorHigh);
              title = formatTooltip(ga.libelle, gb.libelle, arrondi, v.nb);
              const sature = intensite(v.accord, mid, span) >= SEUIL_TEXTE_CLAIR;
              chiffre = {
                // Sans « % » : trois chiffres tiennent dans la case, quatre signes non.
                // La note sous la matrice dit l'unité.
                texte: String(arrondi),
                couleur: !sature
                  ? TEXTE_SUR_CLAIR
                  : v.accord >= mid
                    ? TEXTE_SUR_HAUT
                    : textOnLow,
              };
            }
            return (
              <g key={`cell-${i}-${j}`}>
                <title>{title}</title>
                <rect
                  x={x + 1}
                  y={y + 1}
                  width={CELL - 2}
                  height={CELL - 2}
                  // En style et non en attribut : `fill` porte un color-mix, qu'un
                  // attribut de présentation n'est pas garanti de lire partout.
                  style={{ fill }}
                  stroke="rgba(255,255,255,0.8)"
                  strokeWidth={1}
                />
                {chiffre && (
                  <text
                    x={x + CELL / 2}
                    // Centrage vertical par décalage et non `dominant-baseline`,
                    // dont Safari ne suit pas toutes les valeurs.
                    y={y + CELL / 2 + 3.5}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    style={{
                      fill: chiffre.couleur,
                      fontFamily: 'inherit',
                      fontVariantNumeric: 'tabular-nums',
                      pointerEvents: 'none',
                    }}
                  >
                    {chiffre.texte}
                  </text>
                )}
              </g>
            );
          })
        )}

        {/* Jauge, sous les libellés de colonnes, alignée sur la largeur des cases */}
        {(() => {
          const gaugeX = LEFT;
          const gaugeW = cotes * CELL;
          return (
            <g>
              <rect
                x={gaugeX}
                y={gaugeY}
                width={gaugeW}
                height={GAUGE_H}
                fill={`url(#${gaugeId})`}
                rx={2}
              />
              <text
                x={gaugeX}
                y={gaugeY + GAUGE_H + 14}
                textAnchor="start"
                fontSize={11}
                fill="var(--muted-foreground)"
                style={{ fontFamily: 'inherit' }}
              >
                {pourcent.format(Math.round(minObs) / 100)}
              </text>
              <text
                x={gaugeX + gaugeW}
                y={gaugeY + GAUGE_H + 14}
                textAnchor="end"
                fontSize={11}
                fill="var(--muted-foreground)"
                style={{ fontFamily: 'inherit' }}
              >
                {pourcent.format(Math.round(maxObs) / 100)}
              </text>
            </g>
          );
        })()}
      </svg>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div
          className="-mx-6 px-6"
          style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
        >
          {/* `display` par classe : deux versions, une seule affichée à la fois. */}
          <div className="sm:hidden">{dessiner(true)}</div>
          <div className="max-sm:hidden">{dessiner(false)}</div>
        </div>
      </CardContent>
      <div className="border-t px-6 py-4">
        <p className="text-sm text-foreground/70 leading-relaxed">{note}</p>
      </div>
    </Card>
  );
}
