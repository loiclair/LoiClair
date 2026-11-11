import type { CSSProperties } from 'react';
import { Link } from '@/i18n/navigation';
import { ArrowRight, ArrowLeft, Compass } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { getTranslations } from 'next-intl/server';
import { getExploreArticles } from '@/lib/facts-registry';

interface ExploreSectionProps {
  color: string;
  currentHref: string;
  locale: string;
}

function cleanLabel(label: string): string {
  return label.replace(/^[←→]\s*/, '').replace(/\s*[←→]$/, '').trim();
}

export async function ExploreSection({ color, currentHref, locale }: ExploreSectionProps) {
  const t = await getTranslations({ locale, namespace: 'kpisHub' });
  const articles = getExploreArticles(currentHref);

  const links: { href: string; label: string; back?: boolean }[] = [
    ...articles.map((a) => ({
      href: a.href,
      label: (t as (key: string) => string)(a.titleKey),
    })),
    { href: '/Facts', label: t('backToFacts'), back: true },
  ];

  return (
    <>
      <Separator className="mb-8" />
      <h2 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
        <Compass className="h-5 w-5" style={{ color }} />
        {t('exploreTitle')}
      </h2>
      <div className="flex flex-col gap-2 mb-2">
        {links.map((link) => {
          const isBack = link.back ?? false;
          const displayLabel = cleanLabel(link.label);
          return (
            <Link
              key={link.href}
              href={link.href}
              className="group flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 bg-[var(--chip-bg)] hover:bg-[var(--chip-hover-bg)] hover:-translate-y-0.5 hover:shadow-md"
              style={{
                '--chip-bg': isBack ? 'var(--muted)' : `${color}14`,
                '--chip-hover-bg': isBack ? 'var(--accent)' : `${color}30`,
              } as CSSProperties}
            >
              <span className="flex items-center gap-1.5">
                {isBack && (
                  <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground group-hover:-translate-x-1 transition-transform duration-200" />
                )}
                <span className="text-sm font-medium text-foreground/80 group-hover:text-foreground transition-colors">
                  {displayLabel}
                </span>
                {!isBack && (
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:translate-x-1 transition-transform duration-200" />
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
