'use client';

import { useLocale } from 'next-intl';
import { Pie, PieChart, Cell, Label, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

const DEFAULT_COLORS = [
  '#0d9488', '#0891b2', '#2563eb', '#7c3aed',
  '#db2777', '#d97706', '#16a34a', '#0f766e',
  '#0e7490', '#4f46e5', '#b45309', '#be185d',
];

interface Props {
  data: { name: string; size: number }[];
  title: string;
  description: string;
  tooltipLabel: string;
  note?: string;
  colors?: string[];
  /** Position de la légende sur desktop (md+). Sur mobile, toujours en dessous. */
  legendPosition?: 'bottom' | 'right';
}

export function DonutChart({ data, title, description, tooltipLabel, note, colors, legendPosition = 'bottom' }: Props) {
  // `percent` place l'espace avant le signe en français et le colle en anglais ;
  // `toLocaleString()` sans argument suivait la langue du navigateur, pas celle
  // de la page.
  const locale = useLocale();
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  // La légende, plus serrée, arrondit à l'entier comme elle le faisait déjà.
  const pourcentEntier = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });

  const COLORS = colors ?? DEFAULT_COLORS;
  const total = data.reduce((sum, d) => sum + d.size, 0);
  const sideBySide = legendPosition === 'right';

  return (
    <Card className="h-full flex flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col">
        <div className={sideBySide
          ? 'flex flex-col md:flex-row items-center md:items-center gap-6 md:gap-10'
          : 'flex flex-col items-center gap-4'}>
          {/* Donut */}
          <div className="shrink-0" style={{ width: 240, height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <RechartsTooltip
                  cursor={false}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const item = payload[0].payload as { name: string; size: number };
                      const part = total > 0 ? item.size / total : 0;
                      return (
                        <div className="bg-background border border-border rounded-lg p-3 shadow-sm text-sm">
                          <p className="font-semibold">{item.name}</p>
                          <p>{item.size.toLocaleString(locale)} {tooltipLabel.toLowerCase()} ({pourcent.format(part)})</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Pie
                  data={data}
                  dataKey="size"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={65}
                  outerRadius={110}
                  strokeWidth={2}
                  // Le trait sépare les secteurs dans la couleur de la `Card` qui porte
                  // l'anneau. `--background`, plus foncé que la carte en sombre, les
                  // cernait d'un liseré noir (essayé le 2026-10-28). Jusque-là le trait
                  // était écrit `hsl(var(--background))`, invalide : il ne s'affichait pas.
                  stroke="var(--card)"
                  paddingAngle={1.5}
                >
                  {data.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                        return (
                          <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                            <tspan x={viewBox.cx} y={(viewBox.cy || 0) - 6} className="fill-foreground text-2xl font-bold">
                              {total.toLocaleString(locale)}
                            </tspan>
                            <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 14} className="fill-muted-foreground" style={{ fontSize: 11 }}>
                              {tooltipLabel}
                            </tspan>
                          </text>
                        );
                      }
                      return null;
                    }}
                  />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Légende */}
          <div className={sideBySide
            ? 'flex flex-col gap-2.5 w-full md:flex-1 md:max-w-none max-w-xs md:mt-0 mt-2'
            : 'flex flex-col gap-2.5 w-full max-w-xs mt-2'}>
            {data.map((d, i) => {
              const part = total > 0 ? d.size / total : 0;
              return (
                <div key={d.name} className="flex items-center gap-2.5 text-sm">
                  <span
                    className="w-2.5 h-2.5 rounded-[3px] shrink-0"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  <span className="text-foreground/80 truncate flex-1">{d.name}</span>
                  <span className="tabular-nums text-muted-foreground whitespace-nowrap">
                    {d.size.toLocaleString(locale)} / {total.toLocaleString(locale)}
                  </span>
                  <span className="tabular-nums font-semibold text-foreground whitespace-nowrap w-10 text-right">
                    {pourcentEntier.format(part)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
      {note && (
        <div className="border-t px-6 py-4 mt-auto">
          <p className="text-sm text-foreground/70 leading-relaxed">{note}</p>
        </div>
      )}
    </Card>
  );
}
