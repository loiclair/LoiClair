'use client';

import { useLocale } from 'next-intl';
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
  LabelList,
} from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from '@/components/ui/chart';

export interface ScatterPoint {
  groupe: string;
  /** Abréviation affichée dans la bulle, ex. « EPR », « RN ». */
  abbr: string;
  /** Axe X : taille du groupe (nb de membres) */
  taille: number;
  /** Axe Y : valeur à comparer (ex. lois promulguées) */
  valeur: number;
  /** Taille de la bulle : ex. textes initiés */
  poids: number;
  /** Couleur officielle du groupe */
  color: string;
}

interface Props {
  data: ScatterPoint[];
  title: string;
  description: string;
  xLabel: string;
  yLabel: string;
  poidsLabel: string;
  note?: string;
}

export function GroupeScatterChart({
  data,
  title,
  description,
  xLabel,
  yLabel,
  poidsLabel,
  note,
}: Props) {
  // `useLocale` plutôt qu'une prop : ce qui varie ici n'est pas du vocabulaire
  // (les trois libellés arrivent déjà traduits) mais le format des nombres et
  // l'espace avant le deux-points, que le français demande et l'anglais non.
  const locale = useLocale();
  const separateur = locale === 'en' ? ': ' : ' : ';
  const chartConfig: ChartConfig = {
    valeur: { label: yLabel, color: '#7c3aed' },
  };

  // Diagonale de référence : y = (moyenne valeur / moyenne taille) × x
  // Un point au-dessus de la diagonale = le groupe performe au-delà de sa taille.
  const totalValeur = data.reduce((s, d) => s + d.valeur, 0);
  const totalTaille = data.reduce((s, d) => s + d.taille, 0);
  const ratio = totalTaille > 0 ? totalValeur / totalTaille : 0;
  const maxTaille = Math.max(...data.map((d) => d.taille), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <ChartContainer config={chartConfig} className="aspect-auto h-[360px] w-full">
          <ScatterChart margin={{ top: 20, right: 30, bottom: 30, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="taille"
              name={xLabel}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              label={{ value: xLabel, position: 'insideBottom', offset: -10, fontSize: 12, fill: 'currentColor', className: 'fill-muted-foreground' }}
            />
            <YAxis
              type="number"
              dataKey="valeur"
              name={yLabel}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              label={{ value: yLabel, angle: -90, position: 'insideLeft', offset: 10, fontSize: 12, fill: 'currentColor', className: 'fill-muted-foreground' }}
            />
            <ZAxis
              type="number"
              dataKey="poids"
              range={[120, 900]}
              name={poidsLabel}
            />
            <ReferenceLine
              segment={[
                { x: 0, y: 0 },
                { x: maxTaille, y: maxTaille * ratio },
              ]}
              stroke="currentColor"
              strokeDasharray="4 4"
              className="stroke-muted-foreground/50"
              ifOverflow="extendDomain"
            />
            <ChartTooltip
              cursor={{ strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload || !payload.length) return null;
                const p = payload[0].payload as ScatterPoint;
                return (
                  <div className="rounded-lg border bg-background p-2 shadow-sm text-xs">
                    <div className="font-semibold mb-1">{p.groupe}</div>
                    <div className="tabular-nums text-muted-foreground">
                      {xLabel}{separateur}<span className="text-foreground font-medium">{p.taille.toLocaleString(locale)}</span>
                    </div>
                    <div className="tabular-nums text-muted-foreground">
                      {yLabel}{separateur}<span className="text-foreground font-medium">{p.valeur.toLocaleString(locale)}</span>
                    </div>
                    <div className="tabular-nums text-muted-foreground">
                      {poidsLabel}{separateur}<span className="text-foreground font-medium">{p.poids.toLocaleString(locale)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <Scatter data={data} fillOpacity={0.75} stroke="#fff" strokeWidth={1}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.color} />
              ))}
              {/* Abréviation du groupe centrée dans la bulle.
                   Double rendu avec stroke blanc (halo) + fill noir pour
                   rester lisible quelle que soit la couleur de fond. */}
              <LabelList
                dataKey="abbr"
                content={(props) => {
                  const { x = 0, y = 0, value } = props as {
                    x?: number; y?: number; value?: string;
                  };
                  if (!value) return null;
                  return (
                    <text
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={10}
                      fontWeight={700}
                      stroke="#fff"
                      strokeWidth={3}
                      paintOrder="stroke"
                      fill="#111"
                      style={{ pointerEvents: 'none' }}
                    >
                      {value}
                    </text>
                  );
                }}
              />
            </Scatter>
          </ScatterChart>
        </ChartContainer>
      </CardContent>
      {note && (
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{note}</p>
        </div>
      )}
    </Card>
  );
}
