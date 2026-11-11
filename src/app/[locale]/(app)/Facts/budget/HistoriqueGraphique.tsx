'use client';

/**
 * Six ans de dépenses d'une chambre en un seul graphique : la dépense en trait
 * plein, les recettes en pointillé, et entre les deux l'excédent ou le déficit
 * en zone teintée. Partagé par les chapitres de « Budget des chambres »
 * (/Facts/budget/assemblee-nationale, /Facts/budget/senat). La page serveur
 * passe les montants bruts, leurs textes déjà formatés et l'événement de
 * l'année déjà traduit ; seuls les repères d'axe se formatent ici.
 *
 * Des courbes et non des barres : un excédent ou un déficit pèse 0,07 à 6,5 % de
 * la dépense, et une barre doit partir de zéro, ce qui l'écrasait à 1 ou 2 px
 * côté Sénat. Une courbe peut partir du bas des valeurs sans tromper.
 */

import { useLocale } from 'next-intl';
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from 'recharts';
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart';
import { COLOR } from './BlocsBudget';

export interface AnneeBudget {
  annee: number;
  depense: number;
  /** Recettes moins dépenses : négatif pour un déficit. */
  solde: number;
  /** Dépense de l'année, déjà formatée. */
  depenseTexte: string;
  /** Recettes de l'année (dépense + solde), déjà formatées. */
  recettesTexte: string;
  /** « excédent de … » ou « déficit de … », déjà traduit. */
  soldeTexte: string;
  /** Ce qui a marqué l'année, déjà traduit, ou null. */
  evenement: string | null;
}

/**
 * Rouge du déficit, passé au validateur de la skill `dataviz` contre le
 * #64748b de la série : séparation daltonienne ΔE 15,1, contraste au-dessus de
 * 3:1 sur le fond clair (#ffffff) comme sur le fond sombre (#181513).
 */
const DEFICIT = '#dc2626';

/** Teinte des zones, reprise telle quelle par leurs carrés de légende. */
const OPACITE_ZONE = 0.3;

const CONFIG = {} satisfies ChartConfig;

/** Un point du tracé : une année, ou un croisement des deux courbes entre deux années. */
interface Point {
  x: number;
  depense: number;
  recettes: number;
  zoneDeficit: [number, number];
  zoneExcedent: [number, number];
}

function point(x: number, depense: number, recettes: number): Point {
  // Une zone vide garde ses deux bornes égales sur la courbe des dépenses, pour
  // que Recharts la referme proprement au lieu de la tirer jusqu'à zéro.
  return {
    x,
    depense,
    recettes,
    zoneDeficit: depense > recettes ? [recettes, depense] : [depense, depense],
    zoneExcedent: recettes > depense ? [depense, recettes] : [depense, depense],
  };
}

/**
 * Les points des années, plus un point à chaque croisement des deux courbes :
 * sans lui, la zone d'un déficit déborderait en triangle sur l'année
 * d'excédent voisine, la couleur changeant d'une année à l'autre et non à
 * l'endroit où les courbes se coupent.
 */
function tracer(annees: AnneeBudget[]): Point[] {
  const points: Point[] = [];
  annees.forEach((a, i) => {
    points.push(point(a.annee, a.depense, a.depense + a.solde));
    const b = annees[i + 1];
    if (!b || Math.sign(a.solde) * Math.sign(b.solde) >= 0) return;
    const t = a.solde / (a.solde - b.solde);
    const v = a.depense + t * (b.depense - a.depense);
    points.push(point(a.annee + t * (b.annee - a.annee), v, v));
  });
  return points;
}

/**
 * Repères d'axe ronds (1, 2, 2,5 ou 5 fois une puissance de dix), sur quatre
 * intervalles environ, encadrant toutes les valeurs. Recharts, laissé seul
 * avec un axe qui ne part pas de zéro, tombait sur des montants comme 517 M€.
 * Trois intervalles donnaient au Sénat un pas de 20 M€ et un vide en haut.
 */
function reperes(valeurs: number[]): number[] {
  const bas = Math.min(...valeurs);
  const haut = Math.max(...valeurs);
  const brut = (haut - bas) / 4;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) ?? 10 * puissance;
  const debut = Math.floor(bas / pas) * pas;
  const fin = Math.ceil(haut / pas) * pas;
  const liste: number[] = [];
  for (let v = debut; v <= fin + pas / 2; v += pas) liste.push(v);
  return liste;
}

/** Une entrée de légende : un bout de trait (plein ou pointillé) ou un carré de zone. */
function Cle({ libelle, trait, zone }: { libelle: string; trait?: 'plein' | 'pointille'; zone?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {trait ? (
        <svg width="18" height="8" aria-hidden="true" className="shrink-0">
          <line x1="0" y1="4" x2="18" y2="4" stroke={COLOR} strokeWidth="2" strokeDasharray={trait === 'pointille' ? '4 3' : undefined} />
        </svg>
      ) : (
        <span aria-hidden="true" className="shrink-0" style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: zone, opacity: OPACITE_ZONE }} />
      )}
      {libelle}
    </span>
  );
}

export function HistoriqueGraphique({
  annees,
  libelleDepenses,
  libelleRecettes,
  libelleDeficit,
  libelleExcedent,
}: {
  annees: AnneeBudget[];
  libelleDepenses: string;
  libelleRecettes: string;
  libelleDeficit: string;
  libelleExcedent: string;
}) {
  const locale = useLocale();
  // Une décimale permise : un pas de 2,5 fois une puissance de dix tombe sur
  // des repères comme 322,5 M€, qu'un arrondi à l'unité afficherait 323 M€.
  const repere = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 });
  // L'espace avant le deux-points, que le français demande (insécable, pour ne
  // pas laisser le signe seul en début de ligne) et l'anglais non.
  const separateur = locale === 'en' ? ': ' : ' : ';

  const points = tracer(annees);
  const ticks = reperes(points.flatMap((p) => [p.depense, p.recettes]));
  const millesimes = annees.map((a) => a.annee);

  return (
    <div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mb-4">
        <Cle libelle={libelleDepenses} trait="plein" />
        <Cle libelle={libelleRecettes} trait="pointille" />
        <Cle libelle={libelleDeficit} zone={DEFICIT} />
        <Cle libelle={libelleExcedent} zone={COLOR} />
      </div>

      <ChartContainer config={CONFIG} className="aspect-auto w-full" style={{ height: 230 }}>
        <ComposedChart accessibilityLayer data={points} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          {/* Axe numérique et non par catégorie, pour placer les croisements
              entre deux années ; `String` évite le séparateur de milliers
              qu'un format de nombre mettrait dans « 2 020 ». */}
          <XAxis
            type="number"
            dataKey="x"
            domain={[millesimes[0], millesimes[millesimes.length - 1]]}
            ticks={millesimes}
            tickFormatter={(v: number) => String(v)}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            fontSize={12}
            padding={{ left: 12, right: 12 }}
          />
          <YAxis
            width={56}
            domain={[ticks[0], ticks[ticks.length - 1]]}
            ticks={ticks}
            tickLine={false}
            axisLine={false}
            fontSize={11}
            tickFormatter={(v: number) => repere.format(v)}
          />
          <ChartTooltip
            cursor={{ strokeDasharray: '3 3' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              // Un croisement entre deux années renvoie à l'année la plus proche.
              const x = Math.round((payload[0].payload as Point).x);
              const a = annees.find((annee) => annee.annee === x);
              if (!a) return null;
              return (
                <div className="rounded-lg border bg-background p-2 shadow-sm text-xs" style={{ maxWidth: 220 }}>
                  <p className="font-semibold tabular-nums">{a.annee}</p>
                  {a.evenement && <p className="text-muted-foreground mb-1">{a.evenement}</p>}
                  <p className="tabular-nums">{libelleDepenses}{separateur}<span className="font-medium">{a.depenseTexte}</span></p>
                  <p className="tabular-nums">{libelleRecettes}{separateur}<span className="font-medium">{a.recettesTexte}</span></p>
                  {/* Le texte commence par une minuscule pour suivre une virgule
                      dans la liste du lecteur d'écran ; seul sur sa ligne ici,
                      il prend une capitale. */}
                  <p className="tabular-nums font-medium first-letter:uppercase" style={{ color: a.solde < 0 ? DEFICIT : undefined }}>
                    {a.soldeTexte}
                  </p>
                </div>
              );
            }}
          />
          <Area type="linear" dataKey="zoneDeficit" stroke="none" fill={DEFICIT} fillOpacity={OPACITE_ZONE} isAnimationActive={false} activeDot={false} />
          <Area type="linear" dataKey="zoneExcedent" stroke="none" fill={COLOR} fillOpacity={OPACITE_ZONE} isAnimationActive={false} activeDot={false} />
          <Line
            type="linear"
            dataKey="recettes"
            stroke={COLOR}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Line
            type="linear"
            dataKey="depense"
            stroke={COLOR}
            strokeWidth={2}
            // Un point par année seulement, pas sur les croisements.
            dot={(p: { cx?: number; cy?: number; payload?: Point; index?: number }) =>
              p.payload && Number.isInteger(p.payload.x) ? (
                <circle key={p.index} cx={p.cx} cy={p.cy} r={3.5} fill={COLOR} />
              ) : (
                <g key={p.index} />
              )
            }
            activeDot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ChartContainer>

      {/* Les mêmes chiffres en texte, pour un lecteur d'écran : l'événement de
          l'année ne se lit sinon qu'au survol. */}
      <ul className="sr-only">
        {annees.map((a) => (
          <li key={a.annee}>
            {a.annee}{a.evenement ? ` (${a.evenement})` : ''}, {libelleDepenses} {a.depenseTexte}, {libelleRecettes} {a.recettesTexte}, {a.soldeTexte}
          </li>
        ))}
      </ul>
    </div>
  );
}
