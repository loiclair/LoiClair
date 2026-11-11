import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Landmark } from 'lucide-react';
import { Link } from '@/i18n/navigation';
// Pas de `<Button asChild>` autour d'un Link dans une page serveur : voir button-variants.ts.
import { buttonVariants } from '@/components/ui/button-variants';
import { SharedResultPlaque } from '@/components/quiz/SharedResultPlaque';
import {
  resolveQuizProcessusShareParams,
  resolveQuizProcessusTier,
  QUIZ_PROCESSUS_TIER_LABEL_KEYS,
} from '@/lib/quiz-processus';
import { buildShareUrl } from '@/lib/share-url';
import type { Metadata } from 'next';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function toParam(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'quizProcessus' });
  const result = resolveQuizProcessusShareParams(toParam(sp.score));
  const tierLabel = result ? t(QUIZ_PROCESSUS_TIER_LABEL_KEYS[resolveQuizProcessusTier(result.score).key]) : '';

  const title = result ? `${t('sharedTitle')} — ${result.score}/${result.total}` : t('sharedNotFoundTitle');
  const description = result
    ? t('sharedSubtitle', { score: result.score, total: result.total, niveau: tierLabel })
    : t('sharedNotFoundDesc');

  const shareUrl = buildShareUrl(locale, '/Quiz/processus-legislatif/resultat');
  const ogParams = new URLSearchParams({ locale });
  if (result) ogParams.set('score', String(result.score));
  const ogImageUrl = `https://loiclair.fr/api/og/quiz-processus?${ogParams.toString()}`;

  return {
    title,
    description,
    // Hors index, et sans canonical, que Google déconseille d'associer à `noindex` :
    // chaque score partagé est une adresse à part, sans valeur de recherche, et
    // l'adresse sans paramètres affiche « résultat introuvable » en 200, qui ne
    // peut pas servir de page de référence. Les aperçus de lien restent servis.
    robots: { index: false, follow: true },
    openGraph: {
      title,
      description,
      siteName: 'LoiClair',
      type: 'article',
      url: shareUrl,
      images: [{ url: ogImageUrl, width: 1200, height: 630 }],
    },
  };
}

export default async function QuizProcessusResultatPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'quizProcessus' });
  const result = resolveQuizProcessusShareParams(toParam(sp.score));

  if (result) {
    const tier = resolveQuizProcessusTier(result.score);
    const tierLabel = t(QUIZ_PROCESSUS_TIER_LABEL_KEYS[tier.key]);
    return (
      <div className="max-w-xl mx-auto py-16 text-center flex flex-col items-center gap-6">
        <p className="text-sm font-medium text-muted-foreground">{t('sharedIntro')}</p>
        <SharedResultPlaque
          color={tier.color}
          logo={<Landmark className="h-6 w-6" style={{ color: tier.color }} />}
          title={tierLabel}
          pillValue={`${result.score}/${result.total}`}
        />
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/Quiz/processus-legislatif" className={buttonVariants({ size: 'lg' })}>{t('sharedCta')}</Link>
          <Link href="/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>{t('sharedExploreCta')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-16 text-center flex flex-col items-center gap-4">
      <h1 className="text-xl font-semibold">{t('sharedNotFoundTitle')}</h1>
      <p className="text-muted-foreground">{t('sharedNotFoundDesc')}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/Quiz/processus-legislatif" className={buttonVariants({ size: 'lg' })}>{t('sharedNotFoundCta')}</Link>
        <Link href="/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>{t('sharedExploreCta')}</Link>
      </div>
    </div>
  );
}
