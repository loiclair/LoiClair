'use client';

// Encart des quatre fonctions du score d'activité sur `/Activite` : pour chacune,
// ses composantes et leur poids, lus dans `lib/activite-weights.ts`.

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ACTIVITE_FUNCTIONS, ACTIVITE_WEIGHTS, formatPoids, type FonctionKey } from '@/lib/activite-weights';

const FONCTION_ORDER: FonctionKey[] = ['legiferer', 'deliberer', 'controler', 'commission'];

export function ActiviteFonctionsEncart({ accentColor }: { accentColor: string }) {
  const t = useTranslations('elus');
  const locale = useLocale();

  return (
    <div className="mb-8">
      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
        {t('activite.introText')}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {FONCTION_ORDER.map((key) => {
          const f = ACTIVITE_FUNCTIONS[key];
          return (
            <Card key={key} className="py-4 gap-3">
              <CardHeader className="px-4">
                <CardTitle className="text-sm flex items-baseline justify-between gap-2">
                  <span style={{ color: accentColor }} className="font-semibold">{t(`activite.fonctions.${key}` as Parameters<typeof t>[0])}</span>
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">{f.percent}&nbsp;%</span>
                </CardTitle>
                <p className="text-xs text-muted-foreground leading-snug mt-1">
                  {t(`activite.fonctionDescs.${key}` as Parameters<typeof t>[0])}
                </p>
              </CardHeader>
              <CardContent className="px-4">
                <ul className="space-y-1.5 text-xs">
                  {f.metrics.map((m) => (
                    <li key={m} className="flex items-center justify-between gap-2 leading-tight">
                      <span className="text-muted-foreground">{t(`activite.metrics.${m}` as Parameters<typeof t>[0])}</span>
                      <span className="text-foreground/80 tabular-nums shrink-0">×&nbsp;{formatPoids(ACTIVITE_WEIGHTS[m], locale)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
