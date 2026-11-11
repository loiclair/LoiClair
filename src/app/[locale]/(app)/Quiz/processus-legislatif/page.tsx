export const revalidate = 86400;
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { poolQuizProcessus, QUIZ_PROCESSUS_POOL_FINGERPRINT } from '@/lib/quiz-processus-selection';
import QuizProcessusClient from './QuizProcessusClient';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'quizProcessus' });
  const title = t('pageMetaTitle');
  const description = t('pageMetaDesc');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Quiz/processus-legislatif'),
    openGraph: buildOpenGraph(locale, '/Quiz/processus-legislatif', title, description),
  };
}

export default async function QuizProcessusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  // La page est `force-static` et prérendue par locale : le pool choisi ici est
  // le seul des deux qui atteigne le navigateur.
  return (
    <div className="py-6">
      <QuizProcessusClient
        pool={poolQuizProcessus(locale)}
        poolFingerprint={QUIZ_PROCESSUS_POOL_FINGERPRINT}
      />
    </div>
  );
}
