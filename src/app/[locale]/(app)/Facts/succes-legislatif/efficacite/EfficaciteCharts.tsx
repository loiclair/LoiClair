'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, XAxis, YAxis } from 'recharts';
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

export interface GroupeEfficaciteSerialized {
  key: string;
  libelle: string;
  libelleAbrege: string;
  color: string;
  chambre: 'AN' | 'SN' | 'GOUV';
  /** Non-inscrits (D-313) : une barre, rangée après les groupes, hors des moyennes. */
  nonInscrit: boolean;
  totalAn: number;
  totalSn: number;
  totalPromulgables: number;
  adoptesAn: number;
  adoptesSn: number;
  promulges: number;
}

type Filter = 'AN' | 'SN' | 'ALL';

const COLOR = '#ca8a04';
const COLOR_AN = '#f59e0b'; // amber-500 — adoption AN (étape la plus permissive)
const COLOR_SN = '#b45309'; // amber-700 — adoption Sénat
const COLOR_PROMULG = '#451a03'; // amber-950 — promulgation (aboutissement)
const MIN_TEXTES = 10;

interface Props {
  stats: GroupeEfficaciteSerialized[];
  /** Textes éligibles dont l'auteur n'a pas de groupe en base : absents du graphique, annoncés dans sa légende */
  sansGroupe: number;
}

interface Row {
  groupe: string;
  nonInscrit: boolean;
  adoptionAN: number | null;
  adoptionSN: number | null;
  promulgation: number | null;
  adoptesAn: number;
  totalAn: number;
  adoptesSn: number;
  totalSn: number;
  promulges: number;
  totalPromulgables: number;
}

export function EfficaciteCharts({ stats, sansGroupe }: Props) {
  const t = useTranslations('answerSuccesLegislatifEfficacite');
  // Le style `percent` pose l'espace avant le signe en français et le colle en
  // anglais ; les valeurs arrivant déjà en pourcentage, elles se divisent par 100.
  const locale = useLocale();
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const [filter, setFilter] = useState<Filter>('ALL');

  // Le Gouvernement est toujours visible (point de comparaison).
  const rows: Row[] = useMemo(() => {
    const filtered =
      filter === 'ALL' ? stats : stats.filter((s) => s.chambre === filter || s.chambre === 'GOUV');

    const pct = (num: number, den: number) =>
      den >= MIN_TEXTES ? Math.round((num / den) * 1000) / 10 : null;

    return filtered
      .filter((s) => s.totalAn >= MIN_TEXTES)
      .map((s) => ({
        groupe: s.libelle,
        nonInscrit: s.nonInscrit,
        adoptionAN: pct(s.adoptesAn, s.totalAn),
        adoptionSN: pct(s.adoptesSn, s.totalSn),
        promulgation: pct(s.promulges, s.totalPromulgables),
        adoptesAn: s.adoptesAn,
        totalAn: s.totalAn,
        adoptesSn: s.adoptesSn,
        totalSn: s.totalSn,
        promulges: s.promulges,
        totalPromulgables: s.totalPromulgables,
      }))
      .sort((a, b) => Number(a.nonInscrit) - Number(b.nonInscrit) || (b.adoptionAN ?? -1) - (a.adoptionAN ?? -1));
  }, [stats, filter]);

  const filterButtons: { key: Filter; label: string }[] = [
    { key: 'ALL', label: t('filterAll') },
    { key: 'AN', label: t('filterAN') },
    { key: 'SN', label: t('filterSN') },
  ];

  const pillBtn = (active: boolean, onClick: () => void, label: string, key: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
      style={{
        backgroundColor: active ? COLOR : 'transparent',
        color: active ? '#fff' : 'var(--muted-foreground)',
        borderColor: active ? COLOR : 'var(--border)',
      }}
    >
      {label}
    </button>
  );

  const chartConfig: ChartConfig = {
    adoptionAN: { label: t('chartAdoptionANLabel'), color: COLOR_AN },
    adoptionSN: { label: t('chartAdoptionSNLabel'), color: COLOR_SN },
    promulgation: { label: t('chartPromulgationLabel'), color: COLOR_PROMULG },
  };

  // 3 barres par groupe : prévoir ~72px par groupe + marges
  const chartHeight = Math.max(240, rows.length * 72 + 40);

  // Largeur responsive du label Y : cap à 50 % du container (mobile-friendly)
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
  const yAxisWidth = Math.min(280, Math.max(120, Math.round(containerWidth * 0.5)));
  const yAxisMaxChars = Math.max(12, Math.round(yAxisWidth / 7.5));
  const truncate = (v: string) => (v.length > yAxisMaxChars ? v.slice(0, yAxisMaxChars - 1) + '…' : v);
  const renderYTick = (props: { x?: string | number; y?: string | number; payload?: { value?: string } }) => {
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

  const labelRenderer = (fill: string, props: unknown) => {
    const p = props as { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown };
    const x = Number(p.x ?? 0);
    const y = Number(p.y ?? 0);
    const width = Number(p.width ?? 0);
    const height = Number(p.height ?? 0);
    const value = p.value;
    if (value === null || value === undefined) return null;
    const formatted = pourcent.format((value as number) / 100);
    const inside = width > 56;
    return (
      <text
        x={inside ? x + width - 6 : x + width + 6}
        y={y + height / 2}
        dy={3}
        textAnchor={inside ? 'end' : 'start'}
        fontSize={10}
        fontWeight={600}
        fill={inside ? '#fff' : fill}
      >
        {formatted}
      </text>
    );
  };

  return (
    <>
      {/* ② EN CHIFFRES */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-6" style={{ color: COLOR }}>
        {t('sectionInNumbers')}
      </h2>

      {/* Filtre chambre d'origine */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">
          {t('filterLabel')}
        </span>
        {filterButtons.map(({ key, label }) =>
          pillBtn(filter === key, () => setFilter(key), label, `f-${key}`),
        )}
      </div>

      <Card className="mb-16">
        <CardHeader>
          <CardTitle>{t('combinedChartTitle')}</CardTitle>
          <CardDescription>{t('combinedChartDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="px-2" ref={cardRef}>
          <ChartContainer config={chartConfig} style={{ height: chartHeight }} className="w-full">
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ left: 0, right: 50, top: 8, bottom: 8 }}
              barCategoryGap={14}
              barGap={2}
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <YAxis
                dataKey="groupe"
                type="category"
                tickLine={false}
                axisLine={false}
                width={yAxisWidth}
                interval={0}
                tick={renderYTick}
              />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                domain={[0, 50]}
                allowDataOverflow
                tickFormatter={(v) => pourcent.format(Number(v) / 100)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    className="w-[260px]"
                    labelKey="groupe"
                    formatter={(value, name, item) => {
                      const row = item?.payload as Row;
                      const pct = value as number;
                      let frac = '';
                      if (name === 'adoptionAN') frac = `${row.adoptesAn}/${row.totalAn}`;
                      else if (name === 'adoptionSN') frac = `${row.adoptesSn}/${row.totalSn}`;
                      else if (name === 'promulgation') frac = `${row.promulges}/${row.totalPromulgables}`;
                      return (
                        <div className="flex w-full justify-between gap-2">
                          <span className="text-muted-foreground">
                            {chartConfig[name as keyof typeof chartConfig]?.label as string}
                          </span>
                          <span className="font-mono font-medium tabular-nums">
                            {pourcent.format(pct / 100)} <span className="text-muted-foreground">({frac})</span>
                          </span>
                        </div>
                      );
                    }}
                  />
                }
              />
              <Legend
                verticalAlign="top"
                height={28}
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: '12px' }}
                formatter={(value) =>
                  chartConfig[value as keyof typeof chartConfig]?.label as string
                }
              />
              <Bar dataKey="adoptionAN" fill={COLOR_AN} radius={3} barSize={16}>
                <LabelList dataKey="adoptionAN" content={(p) => labelRenderer(COLOR_AN, p)} />
              </Bar>
              <Bar dataKey="adoptionSN" fill={COLOR_SN} radius={3} barSize={16}>
                <LabelList dataKey="adoptionSN" content={(p) => labelRenderer(COLOR_SN, p)} />
              </Bar>
              <Bar dataKey="promulgation" fill={COLOR_PROMULG} radius={3} barSize={16}>
                <LabelList dataKey="promulgation" content={(p) => labelRenderer(COLOR_PROMULG, p)} />
              </Bar>
            </BarChart>
          </ChartContainer>
        </CardContent>
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">
            {sansGroupe > 0
              ? `${t('combinedChartNote')} ${t('combinedChartSansGroupeNote', { count: sansGroupe })}`
              : t('combinedChartNote')}
          </p>
        </div>
      </Card>
    </>
  );
}
