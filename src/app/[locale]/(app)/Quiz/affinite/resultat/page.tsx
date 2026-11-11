import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
// Pas de `<Button asChild>` autour d'un Link dans une page serveur : voir button-variants.ts.
import { buttonVariants } from '@/components/ui/button-variants';
import { GroupLogoImage } from '@/components/ui/GroupLogoImage';
import { SharedResultPlaque } from '@/components/quiz/SharedResultPlaque';
import { resolveQuizAffiniteShareParams } from '@/lib/quiz-affinite-queries';
import { joindreLibelles } from '@/lib/quiz-affinite';
import { buildShareUrl } from '@/lib/share-url';
import type { Metadata } from 'next';

// Page d'un résultat partagé du quiz d'affinité. Les paramètres `g` (un ou
// plusieurs groupes à égalité) et `pct` sont validés par
// `resolveQuizAffiniteShareParams` avant tout affichage.

// Teinte de la plaque pour des groupes ex æquo, comme dans `QuizResultView` :
// aucune couleur de parti ne passe devant les autres.
const COULEUR_EX_AEQUO = '#06B6D4';

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
  const t = await getTranslations({ locale, namespace: 'quiz' });
  const result = await resolveQuizAffiniteShareParams(toParam(sp.g), toParam(sp.pct));

  const libelles = result ? joindreLibelles(result.groupes.map((g) => g.libelle), locale) : '';
  const title = result
    ? `${t('sharedTitle')} — ${libelles} ${result.percent}%`
    : t('sharedNotFoundTitle');
  const description = result ? t('sharedSubtitle', { groupe: libelles, percent: result.percent }) : t('sharedNotFoundDesc');

  const shareUrl = buildShareUrl(locale, '/Quiz/affinite/resultat');
  const ogParams = new URLSearchParams({ locale });
  if (result) {
    ogParams.set('g', result.groupes.map((g) => g.uid).join(','));
    ogParams.set('pct', String(result.percent));
  }
  const ogImageUrl = `https://loiclair.fr/api/og/quiz-affinite?${ogParams.toString()}`;

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

export default async function QuizAffiniteResultatPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: 'quiz' });
  const result = await resolveQuizAffiniteShareParams(toParam(sp.g), toParam(sp.pct));

  if (!result) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center flex flex-col items-center gap-4">
        <h1 className="text-xl font-semibold">{t('sharedNotFoundTitle')}</h1>
        <p className="text-muted-foreground">{t('sharedNotFoundDesc')}</p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link href="/Quiz/affinite" className={buttonVariants({ size: 'lg' })}>{t('sharedNotFoundCta')}</Link>
          <Link href="/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>{t('sharedExploreCta')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-16 text-center flex flex-col items-center gap-6">
      <p className="text-sm font-medium text-muted-foreground">{t('sharedIntro')}</p>
      <SharedResultPlaque
        color={result.groupes.length > 1 ? COULEUR_EX_AEQUO : result.groupes[0].couleur}
        logo={
          <span className="flex flex-wrap items-center justify-center gap-2">
            {result.groupes.map((g) => (
              <GroupLogoImage key={g.uid} groupeUid={g.uid} imgStyle={{ height: 40, width: 'auto', maxWidth: 160 }} />
            ))}
          </span>
        }
        title={joindreLibelles(result.groupes.map((g) => g.libelle), locale)}
        pillValue={`${result.percent}%`}
        pillLabel={t('resultBandLabel')}
      />
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/Quiz/affinite" className={buttonVariants({ size: 'lg' })}>{t('sharedCta')}</Link>
        <Link href="/" className={buttonVariants({ variant: 'outline', size: 'lg' })}>{t('sharedExploreCta')}</Link>
      </div>
    </div>
  );
}
