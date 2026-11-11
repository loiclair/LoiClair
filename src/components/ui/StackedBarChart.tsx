'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis, LabelList } from 'recharts';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
} from '@/components/ui/chart';
import { useRef, useState, useEffect } from 'react';

export interface StackedBarItem {
  label: string;
  adoptes: number;
  nonAdoptes: number;
  total: number;
}

function CustomTooltip({
  active,
  payload,
  color,
  locale,
  tooltipDeposes,
  tooltipAdoptes,
}: {
  active?: boolean;
  payload?: { name: string; value: number; fill: string }[];
  color: string;
  locale: string;
  tooltipDeposes: string;
  tooltipAdoptes: string;
}) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  const adoptes = payload.find((p) => p.name === 'adoptes')?.value ?? 0;
  // Le style `percent` place lui-même l'espace avant le signe en français et la
  // colle en anglais : une chaîne « {n} % » écrite à la main serait fautive dans
  // l'une des deux langues.
  const taux = new Intl.NumberFormat(locale, { style: 'percent' }).format(total > 0 ? adoptes / total : 0);
  return (
    <div className="rounded-lg border bg-background px-3 py-2 text-xs shadow-sm space-y-0.5">
      <p className="font-semibold text-foreground">{payload[0] && (payload[0] as unknown as { payload: { label: string } }).payload.label}</p>
      <p><span className="text-muted-foreground">{tooltipDeposes}</span><span className="font-medium">{total.toLocaleString(locale)}</span></p>
      <p><span className="text-muted-foreground">{tooltipAdoptes}</span><span className="font-medium" style={{ color }}>{adoptes.toLocaleString(locale)} ({taux})</span></p>
    </div>
  );
}

interface Props {
  data: StackedBarItem[];
  title: string;
  description: string;
  color: string;
  /** Locale de rendu : formate les nombres et le taux du tooltip. */
  locale: string;
  /** Libellés de la légende et du tooltip, ponctuation comprise. */
  labelAdoptes: string;
  labelNonAdoptes: string;
  tooltipDeposes: string;
  tooltipAdoptes: string;
  note?: string;
  labelWidth?: number;
  labelMaxChars?: number;
}

export function StackedBarChart({
  data,
  title,
  description,
  color,
  locale,
  labelAdoptes,
  labelNonAdoptes,
  tooltipDeposes,
  tooltipAdoptes,
  note,
  labelWidth = 270,
  labelMaxChars = 34,
}: Props) {
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

  const truncate = (v: string): string => {
    if (v.length <= effectiveMaxChars) return v;
    return v.slice(0, effectiveMaxChars - 1) + '…';
  };

  const renderTick = (props: { x?: string | number; y?: string | number; payload?: { value: string } }) => {
    const { x = 0, y = 0, payload } = props;
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
        {truncate(payload?.value ?? '')}
      </text>
    );
  };

  const chartConfig: ChartConfig = {
    adoptes: { label: labelAdoptes, color },
    nonAdoptes: { label: labelNonAdoptes, color: '#e5e7eb' },
  };

  const chartHeight = Math.max(160, data.length * 48);

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
            margin={{ left: 0, right: 60, top: 4, bottom: 4 }}
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <YAxis
              dataKey="label"
              type="category"
              tickLine={false}
              axisLine={false}
              width={effectiveLabelWidth}
              interval={0}
              tick={renderTick}
            />
            <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} />
            <ChartTooltip
              content={
                <CustomTooltip
                  color={color}
                  locale={locale}
                  tooltipDeposes={tooltipDeposes}
                  tooltipAdoptes={tooltipAdoptes}
                />
              }
            />
            {/* Adoptés (premier segment — coloré) */}
            <Bar dataKey="adoptes" stackId="a" fill={color} radius={[3, 0, 0, 3]}>
              <LabelList
                dataKey="adoptes"
                content={(props) => {
                  const { x = 0, y = 0, width = 0, height = 0, value } = props as { x?: number; y?: number; width?: number; height?: number; value?: number };
                  if (!value) return null;
                  return (
                    <text
                      x={(x as number) + (width as number) + 5}
                      y={(y as number) + (height as number) / 2}
                      dy={4}
                      textAnchor="start"
                      fontSize={10}
                      fontWeight={600}
                      fill={color}
                    >
                      {(value as number).toLocaleString(locale)}
                    </text>
                  );
                }}
              />
            </Bar>
            {/* Non adoptés (deuxième segment — gris) */}
            <Bar dataKey="nonAdoptes" stackId="a" fill="#e5e7eb" radius={[0, 3, 3, 0]}>
              <LabelList
                dataKey="nonAdoptes"
                content={(props) => {
                  const { x = 0, y = 0, width = 0, height = 0, value } = props as { x?: number; y?: number; width?: number; height?: number; value?: number };
                  if (value == null) return null;
                  return (
                    <text
                      x={(x as number) + (width as number) + 5}
                      y={(y as number) + (height as number) / 2}
                      dy={4}
                      textAnchor="start"
                      fontSize={10}
                      fontWeight={600}
                      fill="#6b7280"
                    >
                      {(value as number).toLocaleString(locale)}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
        {/* Légende */}
        <div className="flex gap-6 mt-4 text-[0.7rem] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-5 rounded shrink-0" style={{ backgroundColor: color }} />
            <span>{labelAdoptes}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-5 rounded shrink-0 bg-gray-200" />
            <span>{labelNonAdoptes}</span>
          </div>
        </div>
      </CardContent>
      {note && (
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{note}</p>
        </div>
      )}
    </Card>
  );
}
