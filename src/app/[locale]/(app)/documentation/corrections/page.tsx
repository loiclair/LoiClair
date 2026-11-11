export const revalidate = 86400;
export const dynamic = 'force-static';

import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { CORRECTIONS } from '@/lib/corrections';
import SignalerButton from '@/components/SignalerButton';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'corrections' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/documentation/corrections'),
    openGraph: buildOpenGraph(locale, '/documentation/corrections', title, description),
  };
}

export default async function CorrectionsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'corrections' });

  // Midi pour neutraliser le fuseau : une date ISO seule est lue en UTC, et
  // l'Europe/Paris la ferait reculer d'un jour à l'affichage.
  const formatDate = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const entries = [...CORRECTIONS].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="max-w-5xl">

        {/* Le titre vit dans l'en-tête commun (`usePageHero`). */}
        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl">{t('intro')}</p>

        <div className="mt-6 rounded-lg border p-5 max-w-3xl">
          <p className="text-sm font-medium">{t('howTitle')}</p>
          <ol className="mt-3 space-y-2 text-sm text-muted-foreground list-decimal pl-5 marker:text-muted-foreground/60">
            <li className="leading-relaxed">{t('howStep1')}</li>
            <li className="leading-relaxed">{t('howStep2')}</li>
            <li className="leading-relaxed">{t('howStep3')}</li>
          </ol>
          <div className="mt-4">
            <SignalerButton label={t('reportCta')} />
          </div>
        </div>

        {/* Journal vide : une ligne le dit, sinon la page n'affiche qu'un blanc
            entre le bloc de signalement et la note du bas. */}
        {entries.length === 0 && (
          <p className="mt-12 text-sm text-muted-foreground">{t('empty')}</p>
        )}

        {/* Pas de filet entre deux corrections : c'est l'espace qui les sépare.
            Une entrée porte déjà un filet vertical entre ses colonnes, et en
            ajouter un horizontal à chaque entrée quadrillait la page. */}
        <div className="mt-12 space-y-12">
          {entries.map((correction) => {
            const texte = locale === 'en' ? correction.en : correction.fr;
            const enCours = correction.status === 'en-cours';
            return (
              <article key={correction.id}>
                <p className="text-muted-foreground" style={{ fontSize: '0.75rem' }}>
                  <time dateTime={correction.date}>
                    {t(enCours ? 'dateOngoing' : 'dateFixed', {
                      date: formatDate.format(new Date(`${correction.date}T12:00:00`)),
                    })}
                  </time>
                  {' · '}
                  <span className="uppercase font-semibold tracking-wide">
                    {t(`scopes.${correction.scope}`)}
                  </span>
                </p>

                <h2 className="font-medium mt-2" style={{ fontSize: '0.9375rem', lineHeight: 1.5 }}>
                  {texte.title}
                </h2>

                {/* Deux colonnes à partir de `sm`, empilées en dessous : sur un
                    téléphone, deux colonnes de texte suivi tombent à six mots
                    par ligne. La colonne de droite porte le filet, elle ne
                    l'affiche donc qu'une fois les colonnes côte à côte. */}
                <div className="mt-4 grid gap-x-10 gap-y-5 sm:grid-cols-2">
                  <div>
                    <p className="uppercase font-semibold tracking-wide text-muted-foreground" style={{ fontSize: '0.6875rem' }}>
                      {t(enCours ? 'labelToday' : 'labelBefore')}
                    </p>
                    <p className="mt-2 text-muted-foreground" style={{ fontSize: '0.875rem', lineHeight: 1.65 }}>
                      {texte.before}
                    </p>
                  </div>
                  <div className="sm:border-l sm:pl-10">
                    <p className="uppercase font-semibold tracking-wide" style={{ fontSize: '0.6875rem' }}>
                      {t(enCours ? 'labelOngoing' : 'labelSince')}
                    </p>
                    {/* Un correctif en ligne se lit en texte plein, un correctif
                        annoncé reste atténué : la couleur dit ce qui est déjà
                        vrai à l'écran. */}
                    <p
                      className={`mt-2 ${enCours ? 'text-muted-foreground' : ''}`}
                      style={{ fontSize: '0.875rem', lineHeight: 1.65 }}
                    >
                      {texte.after}
                    </p>
                    <Link
                      href={correction.href}
                      className="inline-flex items-center gap-1 mt-3 text-primary hover:underline"
                      style={{ fontSize: '0.8125rem' }}
                    >
                      {t('viewPage')}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-12 pt-6 border-t leading-relaxed max-w-3xl">{t('engagement')}</p>

      </div>
    </div>
  );
}
