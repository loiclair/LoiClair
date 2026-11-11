'use client';

// Histogramme d'un compte par mois, pour les pages Facts `taux-promulgation` et
// `taux-application`. Libellés reçus en props, comme les autres
// composants de `ui/`. Le mois arrive sous la forme « janv.-2025 » : l'axe n'en garde
// que le mois, l'infobulle les deux.

import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts';
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

interface MonthlyDossiersChartProps {
  data: { month: string; dossiers: number }[];
  title: string;
  description: string;
  tooltipLabel: string;
  note?: string;
}

export function MonthlyDossiersChart({
  data,
  title,
  description,
  tooltipLabel,
  note,
}: MonthlyDossiersChartProps) {
  const chartConfig: ChartConfig = {
    dossiers: {
      label: tooltipLabel,
      color: "var(--chart-1)",
    },
  } satisfies ChartConfig;

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch border-b !p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>

      <CardContent className="px-2 pt-6 sm:p-6">
        <ChartContainer
          config={chartConfig}
          className="aspect-auto h-[150px] w-full"
        >
          <BarChart
            accessibilityLayer
            data={data}
            margin={{ left: 12, right: 12 }}
          >
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="month"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              fontSize={12}
              tickFormatter={(value) => value.split('-')[0]}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[160px]"
                  labelFormatter={(value) => {
                    const [shortMonth, year] = String(value ?? '').split('-');
                    return `${shortMonth} ${year || ''}`;
                  }}
                />
              }
            />
            <Bar
              dataKey="dossiers"
              fill="var(--color-dossiers)"
              radius={2}
            />
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
