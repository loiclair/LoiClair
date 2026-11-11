'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Step {
  label: string;
  sample: string;
  days: number;
}

interface Props {
  steps: Step[];
  title: string;
  description: string;
  daysSuffix: string;
  tickLabels: [string, string, string, string];
  locale: string;
  color?: string;
  note?: string;
}

export function DelaiTimeline({
  steps,
  title,
  description,
  daysSuffix,
  tickLabels,
  locale,
  color = '#b45309',
  note,
}: Props) {
  // Couleurs dégradées : pleine, moyenne, claire
  const segmentColors = [color, `${color}cc`, `${color}80`];
  const GAP_PX = 6;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mt-2">
          {/* Numéros de jours au-dessus des segments */}
          <div className="flex w-full" style={{ gap: `${GAP_PX}px` }}>
            {steps.map((step, i) => (
              <div
                key={i}
                className="text-center"
                style={{ flex: Math.max(step.days, 1) }}
              >
                <span className="text-[0.65rem] sm:text-xs font-bold tabular-nums" style={{ color: segmentColors[i] }}>
                  {step.days.toLocaleString(locale)} {daysSuffix}
                </span>
              </div>
            ))}
          </div>

          {/* Barre segmentée — ticks sous chaque frontière */}
          <div className="flex w-full mt-1" style={{ gap: `${GAP_PX}px` }}>
            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              // Les ticks intermédiaires (Adoption, Promulgation) sont masqués sur mobile
              // pour éviter la superposition quand un segment est étroit.
              const innerTickClass = !isLast ? 'hidden sm:block' : '';
              return (
                <div
                  key={i}
                  className="relative"
                  style={{
                    flex: Math.max(step.days, 1),
                    height: '1.25rem',
                    backgroundColor: segmentColors[i] ?? color,
                    borderRadius: '2px',
                  }}
                >
                  {/* Tick gauche : uniquement sur le premier segment (aligné au bord gauche) */}
                  {i === 0 && (
                    <div className="absolute" style={{ left: 0, top: 'calc(100% + 4px)' }}>
                      <div className="h-2 w-px bg-border" />
                      <span
                        className="absolute text-[0.65rem] sm:text-xs text-muted-foreground whitespace-nowrap"
                        style={{ left: 0, top: '0.625rem' }}
                      >
                        {tickLabels[0]}
                      </span>
                    </div>
                  )}

                  {/* Tick droit : à la frontière (centre du gap) sauf pour le dernier segment (bord droit) */}
                  <div
                    className={`${innerTickClass} absolute`}
                    style={{
                      right: isLast ? 0 : `-${GAP_PX / 2}px`,
                      top: 'calc(100% + 4px)',
                    }}
                  >
                    <div className="h-2 w-px bg-border" />
                    <span
                      className="absolute text-[0.65rem] sm:text-xs text-muted-foreground whitespace-nowrap"
                      style={
                        isLast
                          ? { right: 0, top: '0.625rem' }
                          : { left: '0.5px', top: '0.625rem', transform: 'translateX(-50%)' }
                      }
                    >
                      {tickLabels[i + 1]}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Espace réservé pour les ticks et labels */}
          <div style={{ height: '2.25rem' }} />

          {/* Liste claire des étapes : pastille colorée + jours + label + échantillon */}
          <div className="mt-4 space-y-2.5 border-t pt-4">
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <span
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: segmentColors[i] ?? color }}
                />
                <div className="flex-1 min-w-0 text-sm leading-snug">
                  <span className="font-bold tabular-nums" style={{ color: segmentColors[i] }}>
                    {step.days.toLocaleString(locale)} {daysSuffix}
                  </span>
                  <span className="mx-1.5 text-muted-foreground">·</span>
                  <span className="font-semibold text-foreground/90">{step.label}</span>
                  <span className="text-muted-foreground"> — {step.sample}</span>
                </div>
              </div>
            ))}
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
