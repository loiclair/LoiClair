'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface BoxPlotRow {
  label: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  count: number;
  /** Libellé de l'unité du compte, ex. "députés", "dossiers" */
  countLabel?: string;
}

interface Props {
  data: BoxPlotRow[];
  title: string;
  description: string;
  unit: string;
  locale: string;
  color?: string;
  note?: string;
  /** Libellé par défaut du compte si la ligne n'en précise pas (ex. "dossiers", "lois") */
  countLabel?: string;
  /** Domaine personnalisé de l'axe partagé. Par défaut [0, max arrondi à la centaine]. */
  domain?: [number, number];
  /** Quand true, chaque ligne utilise sa propre échelle [0, max de la ligne]. */
  independentScales?: boolean;
}

export function BoxPlotChart({ data, title, description, unit, locale, color = '#b45309', note, countLabel = 'dossiers', domain, independentScales = false }: Props) {
  const t = useTranslations('common');
  const globalDomain = domain ?? [
    0,
    Math.ceil(Math.max(...data.map((d) => d.max), 1) / 100) * 100,
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-8">
          {data.map((row, i) => {
            const [axisMin, axisMax] = independentScales
              ? [0, Math.ceil(row.max * 1.1 / 100) * 100 || 1]
              : globalDomain;
            const axisRange = axisMax - axisMin || 1;
            const pct = (v: number) => `${((v - axisMin) / axisRange) * 100}%`;
            const pctSpan = (delta: number) => `${(delta / axisRange) * 100}%`;
            return (
            <div key={i}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-3 mb-2">
                <span className="text-sm font-semibold">{row.label}</span>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                  <span>
                    <span className="font-semibold text-foreground">{row.count.toLocaleString(locale)}</span> {row.countLabel ?? countLabel}
                  </span>
                  <span>
                    {t('statMedian')} <span className="font-semibold text-foreground">{row.median.toLocaleString(locale)} {unit}</span>
                  </span>
                  <span className="flex items-baseline gap-1">
                    {t('statMean')}
                    <span className="text-xl font-bold tabular-nums" style={{ color }}>
                      {row.mean.toLocaleString(locale)}
                    </span>
                    <span>{unit}</span>
                  </span>
                </div>
              </div>

              {/* Zone du boxplot */}
              <div className="relative h-10">
                {/* Ligne horizontale min → max (moustaches) */}
                <div
                  className="absolute top-1/2 h-px -translate-y-1/2"
                  style={{
                    left: pct(row.min),
                    width: pctSpan(row.max - row.min),
                    backgroundColor: color,
                    opacity: 0.5,
                  }}
                />
                {/* Barre verticale min */}
                <div
                  className="absolute top-1/2 h-4 w-px -translate-y-1/2"
                  style={{ left: pct(row.min), backgroundColor: color, opacity: 0.7 }}
                />
                {/* Barre verticale max */}
                <div
                  className="absolute top-1/2 h-4 w-px -translate-y-1/2"
                  style={{ left: pct(row.max), backgroundColor: color, opacity: 0.7 }}
                />
                {/* Boîte Q1 → Q3 */}
                <div
                  className="absolute top-1/2 h-7 -translate-y-1/2 rounded"
                  style={{
                    left: pct(row.q1),
                    width: pctSpan(row.q3 - row.q1),
                    backgroundColor: color,
                    opacity: 0.25,
                    border: `1px solid ${color}`,
                  }}
                />
                {/* Ligne verticale médiane */}
                <div
                  className="absolute top-1/2 h-7 w-[2px] -translate-y-1/2"
                  style={{ left: pct(row.median), backgroundColor: color }}
                />
                {/* Marqueur moyenne (cercle plus visible) */}
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background shadow-sm"
                  style={{ left: pct(row.mean), backgroundColor: color }}
                  title={`${t('statMeanCap')} : ${row.mean} ${unit}`}
                />
              </div>

              {/* Étiquettes min / max sous la ligne */}
              <div className="relative h-4 text-[0.65rem] text-muted-foreground tabular-nums">
                <span className="absolute" style={{ left: pct(row.min), transform: 'translateX(-50%)' }}>
                  {row.min.toLocaleString(locale)} {unit}
                </span>
                <span className="absolute" style={{ left: pct(row.max), transform: 'translateX(-50%)' }}>
                  {row.max.toLocaleString(locale)} {unit}
                </span>
              </div>
            </div>
          );
          })}

          {/* Légende visuelle */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-[0.7rem] text-muted-foreground border-t pt-4">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-4 w-6 rounded shrink-0"
                style={{ backgroundColor: color, opacity: 0.25, border: `1px solid ${color}` }}
              />
              <span>{t('statQ1Q3', { countLabel })}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-4 w-[2px] shrink-0" style={{ backgroundColor: color }} />
              <span>{t('statMedianCap')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
              <span>{t('statMeanCap')}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block h-px w-6 shrink-0" style={{ backgroundColor: color, opacity: 0.5 }} />
              <span>{t('statMinMax')}</span>
            </div>
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
