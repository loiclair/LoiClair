'use client';

// Barres horizontales empilées, une ligne par groupe politique, sur un axe 0 à 100.
// Deux appelants : la page métiers (part de chaque famille professionnelle, en %)
// et `/Activite` (points apportés par chaque fonction au score, `unite="points"`).
// Les libellés arrivent en props, les valeurs sont déjà calculées côté serveur.

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from 'recharts';
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
  ChartTooltipContent,
} from '@/components/ui/chart';

export type StackSegment = { key: string; label: string; color: string };

export type StackRow = { groupe: string } & Record<string, string | number>;

interface Props {
  data: StackRow[];
  segments: StackSegment[];
  title: string;
  description: string;
  note?: string;
  labelWidth?: number;
  labelMaxChars?: number;
  /**
   * `pourcent` (défaut) : les valeurs sont des parts sur 100, affichées avec « % ».
   * `points` : des points de score sur 100, affichés sans unité, à une décimale.
   */
  unite?: 'pourcent' | 'points';
}

export function StackedFamsByGroupChart({
  data,
  segments,
  title,
  description,
  note,
  labelWidth = 200,
  labelMaxChars = 28,
  unite = 'pourcent',
}: Props) {
  // En pourcentage, les données valent 42,3 et non 0,423, d'où le /100 : le style
  // `percent` place lui-même l'espace fine avant le signe en français et la colle
  // en anglais, ce qu'une chaîne écrite à la main ne peut pas faire.
  const locale = useLocale();
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const points = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const formatValeur = (v: number) => (unite === 'points' ? points.format(v) : pourcent.format(v / 100));
  const formatTick = (v: number) => (unite === 'points' ? String(v) : `${v} %`);

  const chartConfig: ChartConfig = Object.fromEntries(
    segments.map((s) => [s.key, { label: s.label, color: s.color }])
  );

  const chartHeight = Math.max(300, data.length * 44 + 80);

  // Même garde que `GroupeBarChart` : la largeur des libellés est plafonnée à 42 %
  // de la carte mesurée. Sans elle, 220 px de libellés sur une carte de 340 px
  // (mobile) ne laissaient qu'une centaine de pixels aux barres.
  const cardRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.offsetWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveLabelWidth = Math.min(labelWidth, Math.round(containerWidth * 0.42));
  const effectiveMaxChars =
    effectiveLabelWidth < labelWidth
      ? Math.round(labelMaxChars * (effectiveLabelWidth / labelWidth))
      : labelMaxChars;

  // Troncature qui préserve le suffixe « (n) » pour ne jamais perdre la
  // taille du groupe, même quand le nom est trop long.
  const truncate = (v: string): string => {
    if (v.length <= effectiveMaxChars) return v;
    const match = v.match(/^(.*?)\s*(\([^)]+\))\s*$/);
    if (match) {
      const [, name, counter] = match;
      const budget = effectiveMaxChars - counter.length - 2;
      if (budget <= 0) return v.slice(0, effectiveMaxChars - 1) + '…';
      return name.slice(0, budget).trimEnd() + '… ' + counter;
    }
    return v.slice(0, effectiveMaxChars - 1) + '…';
  };

  // Tick custom : un seul <text> SVG, jamais wrappé. Recharts utilise sinon
  // son composant <Text> qui casse les labels longs en plusieurs lignes.
  const renderTick = (props: {
    x?: string | number;
    y?: string | number;
    payload?: { value: string };
  }) => {
    const { x = 0, y = 0, payload } = props;
    const label = truncate(payload?.value ?? '');
    return (
      <text
        x={x}
        y={y}
        dy={4}
        textAnchor="end"
        fontSize={12}
        fill="currentColor"
        className="fill-muted-foreground"
      >
        {label}
      </text>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2" ref={cardRef}>
        <ChartContainer
          config={chartConfig}
          style={{ height: chartHeight }}
          className="w-full"
        >
          <BarChart
            layout="vertical"
            data={data}
            margin={{ left: 0, right: 16, top: 12, bottom: 4 }}
            barCategoryGap="22%"
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <YAxis
              dataKey="groupe"
              type="category"
              tickLine={false}
              axisLine={false}
              width={effectiveLabelWidth}
              interval={0}
              tick={renderTick}
            />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              allowDataOverflow
              tickFormatter={formatTick}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[260px]"
                  labelKey="groupe"
                  formatter={(value, name) => {
                    const seg = segments.find((s) => s.key === name);
                    return (
                      <span>
                        <span className="text-muted-foreground">
                          {seg?.label ?? String(name)}
                        </span>{' '}
                        <span className="font-mono font-medium tabular-nums">
                          {formatValeur(Number(value))}
                        </span>
                      </span>
                    );
                  }}
                />
              }
            />
            <Legend
              verticalAlign="top"
              align="center"
              iconType="square"
              height={56}
              wrapperStyle={{ fontSize: 11, paddingBottom: 12, lineHeight: '20px' }}
              formatter={(v) =>
                segments.find((s) => s.key === v)?.label ?? String(v)
              }
            />
            {segments.map((s) => (
              <Bar key={s.key} dataKey={s.key} stackId="fams" fill={s.color} />
            ))}
          </BarChart>
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
