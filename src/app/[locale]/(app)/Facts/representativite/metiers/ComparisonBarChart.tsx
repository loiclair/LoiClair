'use client';

import { useLocale } from 'next-intl';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Legend } from 'recharts';
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

interface Row {
  groupe: string;
  serie1: number;
  serie2: number;
}

interface Props {
  data: Row[];
  title: string;
  description: string;
  serie1Label: string;
  serie2Label: string;
  serie1Color: string;
  serie2Color: string;
  note?: string;
  labelWidth?: number;
  labelMaxChars?: number;
}

export function ComparisonBarChart({
  data,
  title,
  description,
  serie1Label,
  serie2Label,
  serie1Color,
  serie2Color,
  note,
  labelWidth = 220,
  labelMaxChars = 30,
}: Props) {
  // Les données sont déjà des pourcentages (42,3 et non 0,423), d'où le /100 :
  // le style `percent` place lui-même l'espace fine avant le signe en français
  // et la colle en anglais, ce qu'une chaîne écrite à la main ne peut pas faire.
  const locale = useLocale();
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });

  const chartConfig: ChartConfig = {
    serie1: { label: serie1Label, color: serie1Color },
    serie2: { label: serie2Label, color: serie2Color },
  };

  const chartHeight = Math.max(260, data.length * 64);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-2">
        <ChartContainer config={chartConfig} style={{ height: chartHeight }} className="w-full">
          <BarChart
            layout="vertical"
            data={data}
            margin={{ left: 0, right: 24, top: 4, bottom: 4 }}
            barCategoryGap="22%"
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" />
            <YAxis
              dataKey="groupe"
              type="category"
              tickLine={false}
              axisLine={false}
              width={labelWidth}
              fontSize={12}
              interval={0}
              tickFormatter={(v: string) =>
                v.length > labelMaxChars ? v.slice(0, labelMaxChars - 1) + '…' : v
              }
            />
            <XAxis
              type="number"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              tickFormatter={(v: number) => `${v}\u202f%`}
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="w-[240px]"
                  labelKey="groupe"
                  formatter={(value, name) => {
                    const label = name === 'serie1' ? serie1Label : serie2Label;
                    return (
                      <span>
                        <span className="text-muted-foreground">{label}</span>{' '}
                        <span className="font-mono font-medium tabular-nums">
                          {pourcent.format(Number(value) / 100)}
                        </span>
                      </span>
                    );
                  }}
                />
              }
            />
            <Legend
              verticalAlign="top"
              height={28}
              iconType="square"
              wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
              formatter={(v) => (v === 'serie1' ? serie1Label : serie2Label)}
            />
            <Bar dataKey="serie1" fill={serie1Color} radius={3} />
            <Bar dataKey="serie2" fill={serie2Color} radius={3} />
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
