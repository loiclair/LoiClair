export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getQuizAffiniteData } from '@/lib/quiz-affinite-queries';
import AffiniteQuizClient from './AffiniteQuizClient';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'quiz' });
  const title = t('affiniteMetaTitle');
  const description = t('affiniteMetaDesc');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Quiz/affinite'),
    openGraph: buildOpenGraph(locale, '/Quiz/affinite', title, description),
  };
}

export default async function AffiniteQuizPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'quiz' });
  const { questions, groupes } = await getQuizAffiniteData(locale);

  if (questions.length === 0) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{t('unavailableTitle')}</h1>
        <p className="text-muted-foreground">{t('unavailableDesc')}</p>
      </div>
    );
  }

  return <AffiniteQuizClient questions={questions} groupes={groupes} />;
}
