// L'entonnoir législatif : des marches numérotées, du dépôt à l'application,
// chacune avec son compte, sa barre et sa part d'une marche de référence.
// Appelé par `/Facts/taux-promulgation` (rendu normal) et `/etat-des-lieux`
// (version `compact`, dans une cellule de bento). Libellés reçus en props.

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface FunnelStep {
  label: string;
  count: number;
  description: string;
}

interface LegislativeFunnelProps {
  steps: FunnelStep[];
  title: string;
  description: string;
  ofTotalLabel: (rate: string) => string;
  locale: string;
  /** Index de l'étape servant de base au calcul du % (défaut : 0) */
  rateBaseIndex?: number;
  /** Classes sur la Card — `h-full` quand l'entonnoir remplit une cellule de bento */
  className?: string;
  /**
   * Resserre les marches et les répartit sur toute la hauteur, pour tenir dans
   * une cellule de bento. En version normale, cinq marches réclament plus de
   * place que `/etat-des-lieux` n'en accorde à sa colonne, et l'entonnoir
   * débordait sur la carte voisine. Sans hauteur imposée, l'option ne change
   * rien : `/Facts/taux-promulgation` ne la passe pas et garde son rendu.
   */
  compact?: boolean;
  /** Petite icône rendue avant le titre, pour accrocher le balayage */
  icon?: React.ReactNode;
  /**
   * Rendu tel quel dans la Card, qui devient positionnée : la ⓘ de
   * `/etat-des-lieux`, qui se place elle-même dans le coin et retourne la
   * carte pour définir chaque marche. `/Facts/taux-promulgation` ne la passe
   * pas et garde son rendu.
   */
  info?: React.ReactNode;
  /**
   * Teinte des barres et des pourcentages. Par défaut `var(--chart-1)`, la
   * couleur de série du site : les pages Facts ne passent rien et gardent
   * exactement le rendu qu'elles avaient.
   */
  barColor?: string;
}

export function LegislativeFunnel({ steps, title, description, ofTotalLabel, locale, rateBaseIndex = 0, className, compact = false, icon, info, barColor = 'var(--chart-1)' }: LegislativeFunnelProps) {
  const maxCount = steps[0]?.count || 1;

  return (
    <Card className={info ? `relative ${className ?? ''}` : className}>
      <CardHeader>
        <CardTitle className={icon ? 'flex items-center gap-1.5' : undefined}>
          {icon}
          <span className="min-w-0">{title}</span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {/* En version compacte la Card est étirée sur une hauteur imposée (bento) :
          les marches prennent chacune une part égale de la hauteur, sinon
          l'échelle se tasse en haut et laisse un grand vide en bas. Le trait de
          liaison est déjà en `flex-1`, il suit donc l'étirement. */}
      <CardContent className={compact ? 'flex flex-1 flex-col' : ''}>
        <div className={compact ? 'relative flex flex-1 flex-col' : 'relative'}>
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const widthPct = (step.count / maxCount) * 100;

            const baseCount = steps[rateBaseIndex]?.count || 0;
            // `toLocaleString` et non `toFixed` : ce dernier écrit toujours un
            // point décimal, donc « 11.8 % » sur les pages françaises.
            const totalRate = i > rateBaseIndex && baseCount > 0
              ? ((step.count / baseCount) * 100).toLocaleString(locale, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })
              : null;

            return (
              <div key={step.label} className={`relative flex gap-4 last:pb-0 ${compact ? 'flex-1 pb-3' : 'pb-7'}`}>
                {/* Ligne verticale + numéro */}
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-xs font-semibold border-2 border-muted-foreground/20 text-muted-foreground bg-background">
                    {i + 1}
                  </div>
                  {/* La marge négative doit compenser exactement le `pb` de la
                      marche, sinon le trait de liaison s'arrête avant la puce
                      suivante. */}
                  {!isLast && (
                    <div className={`w-px flex-1 bg-border ${compact ? '-mb-3' : '-mb-7'}`} />
                  )}
                </div>

                {/* Contenu */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-0.5">
                    {step.label}
                  </p>

                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-bold tabular-nums leading-tight text-foreground"
                      style={{ fontSize: compact ? '1.5rem' : '1.875rem' }}
                    >
                      {step.count.toLocaleString(locale)}
                    </span>
                    {totalRate && (
                      <span className="text-sm font-semibold tabular-nums" style={{ color: barColor }}>
                        {ofTotalLabel(totalRate)}
                      </span>
                    )}
                  </div>

                  <div className="mt-2 h-1.5 rounded-full bg-muted/60 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${widthPct}%`, backgroundColor: barColor }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      {/* Après le contenu : le verso qu'elle ouvre doit le recouvrir. */}
      {info}
    </Card>
  );
}
