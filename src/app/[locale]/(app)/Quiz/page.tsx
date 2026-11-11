export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getQuizAffiniteGroupesActifs, getQuizAffiniteScrutinUids } from '@/lib/quiz-affinite-queries';
import { computeQuestionSetFingerprint } from '@/lib/quiz-utils';
import QuizHubCard from './QuizHubCard';
import { QUIZ_PROCESSUS_POOL_FINGERPRINT } from '@/lib/quiz-processus-selection';
import QuizProcessusHubCard from './QuizProcessusHubCard';
import { Lock } from 'lucide-react';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'quiz' });
  const title = t('pageMetaTitle');
  const description = t('pageMetaDesc');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Quiz'),
    openGraph: buildOpenGraph(locale, '/Quiz', title, description),
  };
}

export default async function QuizHubPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quiz' });
  const [groupes, scrutinUids] = await Promise.all([
    getQuizAffiniteGroupesActifs(),
    getQuizAffiniteScrutinUids(),
  ]);
  const currentFingerprint = computeQuestionSetFingerprint(scrutinUids);

  return (
    <div className="py-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
        <Lock className="h-4 w-4 shrink-0" />
        <p>{t('hubPrivacyNote')}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 items-start">
        <QuizHubCard groupes={groupes} currentFingerprint={currentFingerprint} />
        <QuizProcessusHubCard poolFingerprint={QUIZ_PROCESSUS_POOL_FINGERPRINT} />
      </div>
    </div>
  );
}
