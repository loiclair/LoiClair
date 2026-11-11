'use client';

// Barres horizontales par groupe (ou par catégorie) des pages /Facts, de /Activite
// et du résultat du quiz d'affinité : une barre par ligne de `data`, à la couleur du groupe quand la ligne
// porte un `fill`, le chiffre écrit dans la barre si elle est assez large.

import { useRef, useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, XAxis, YAxis } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { getReadableTextColor } from '@/lib/groupe-colors';

type GroupeBarChartRow = { groupe: string; value: number; fill?: string };

interface GroupeBarChartProps<T extends GroupeBarChartRow> {
  /**
   * Un `fill` optionnel par ligne permet d'avoir une couleur par barre
   * (ex. couleur officielle du groupe politique). En son absence, la
   * couleur globale `color` est utilisée. Des champs additionnels sont
   * acceptés (ex. `matched`/`total`) et accessibles dans `renderValueLabel`.
   */
  data: T[];
  title: string;
  description: string;
  color: string;
  valueLabel: string;
  link?: string;
  note?: string;
  labelWidth?: number;
  labelMaxChars?: number;
  /** Domaine personnalisé de l'axe X. Par défaut [0, auto] (Recharts). */
  xDomain?: [number, number];
  /** Texte de label personnalisé par barre. Par défaut, la valeur formatée dans la locale courante. */
  renderValueLabel?: (row: T) => string;
  /** Hauteur allouée par barre, en px. Par défaut 40. */
  rowHeight?: number;
  /** Hauteur minimale du graphique, en px. Par défaut 200. */
  minHeight?: number;
  /** Anime la croissance des barres à l'affichage. Par défaut true. */
  animate?: boolean;
}

export function GroupeBarChart<T extends GroupeBarChartRow>({
  data,
  title,
  description,
  color,
  valueLabel,
  link,
  note,
  labelWidth = 180,
  labelMaxChars = 28,
  xDomain,
  renderValueLabel,
  rowHeight = 40,
  minHeight = 200,
  animate = true,
}: GroupeBarChartProps<T>) {
  // `useLocale` plutôt qu'une prop : le composant a treize appelants, et ce qui
  // varie ici n'est pas du vocabulaire mais le format des nombres.
  const locale = useLocale();

  const chartConfig: ChartConfig = {
    value: { label: valueLabel, color },
  };

  // Hauteur dynamique : `rowHeight` px par barre + marges
  const chartHeight = Math.max(minHeight, data.length * rowHeight);

  // Largeur responsive : mesure le container réel pour adapter labelWidth
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

  // Cap à 42 % du container. Sur mobile (340 px) → ~143 px. Desktop → inchangé.
  const effectiveLabelWidth = Math.min(labelWidth, Math.round(containerWidth * 0.42));
  const effectiveMaxChars =
    effectiveLabelWidth < labelWidth
      ? Math.round(labelMaxChars * (effectiveLabelWidth / labelWidth))
      : labelMaxChars;

  // Troncature qui préserve le suffixe « (n) » même quand le nom est coupé
  const truncate = (v: string): string => {
    if (v.length <= effectiveMaxChars) return v;
    const match = v.match(/^(.*?)\s*(\([^)]+\))\s*$/);
    if (match) {
      const [, name, counter] = match;
      const budget = effectiveMaxChars - counter.length - 2; // « … » + espace
      if (budget <= 0) return v.slice(0, effectiveMaxChars - 1) + '…';
      return name.slice(0, budget).trimEnd() + '… ' + counter;
    }
    return v.slice(0, effectiveMaxChars - 1) + '…';
  };

  // Tick custom : un seul `<text>` SVG, jamais wrappé. Recharts ferait
  // sinon du multi-ligne sur les labels longs via son composant `<Text>`.
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
        <ChartContainer config={chartConfig} style={{ height: chartHeight }} className="w-full">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ left: 0, right: 40, top: 4, bottom: 4 }}
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
              domain={xDomain ?? [0, 'auto']}
              allowDataOverflow={!!xDomain}
            />
            <ChartTooltip
              content={<ChartTooltipContent className="w-[220px]" labelKey="groupe" />}
            />
            <Bar dataKey="value" fill={color} radius={3} isAnimationActive={animate}>
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.fill ?? color} />
              ))}
              <LabelList
                dataKey="value"
                content={(props) => {
                  const { x = 0, y = 0, width = 0, height = 0, value, index } = props as {
                    x?: number; y?: number; width?: number; height?: number; value?: number; index?: number;
                  };
                  if (value === undefined) return null;
                  const row = index !== undefined ? data[index] : undefined;
                  const formatted = renderValueLabel && row
                    ? renderValueLabel(row)
                    : (value as number).toLocaleString(locale);
                  // Threshold: if the bar is wide enough to fit the label + padding,
                  // render it inside; otherwise render it outside (colored).
                  const inside = (width as number) > 64;
                  // Dans la barre, noir ou blanc selon sa couleur : en blanc fixe, le
                  // chiffre disparaissait sur les groupes à couleur claire. Une couleur
                  // qui n'est pas un hexadécimal à six chiffres (`getReadableTextColor`
                  // n'en lit pas d'autre) garde le blanc.
                  const fond = row?.fill ?? color;
                  const encre = /^#[0-9a-f]{6}$/i.test(fond) ? getReadableTextColor(fond) : '#fff';
                  return (
                    <text
                      x={inside ? (x as number) + (width as number) - 8 : (x as number) + (width as number) + 8}
                      y={(y as number) + (height as number) / 2}
                      dy={4}
                      textAnchor={inside ? 'end' : 'start'}
                      fontSize={11}
                      fontWeight={600}
                      fill={inside ? encre : color}
                    >
                      {formatted}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </CardContent>
      {note && (
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{note}</p>
        </div>
      )}
      {link && (
        <CardFooter className="border-t pt-3">
          <Link href={link} className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors">
            Comment c&apos;est calculé →
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}
