// Les liens vers une source officielle, communs aux tiroirs et à la page d'un amendement.
// Dans leur propre fichier pour rester légers : le tiroir d'un article les monte sans
// charger l'hémicycle ni les tableaux de vote.

import { ChevronRight, ExternalLink, Landmark } from 'lucide-react';
import { Link } from '@/i18n/navigation';

/** Pendant du badge IA pour ce qui vient des assemblées : même forme, lié à la page
 *  officielle. `stopPropagation` : `SectionRepliable` annule tout clic dans son titre, ce
 *  qui rendrait le lien inerte. */
export function BadgeSource({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center rounded-full bg-muted font-medium text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      style={{ gap: 5, padding: '3px 10px', fontSize: 12, lineHeight: 1.35, textDecoration: 'none' }}
    >
      <Landmark aria-hidden size={13} strokeWidth={1.75} style={{ flex: 'none' }} />
      {children}
      <ExternalLink aria-hidden size={11} strokeWidth={1.75} style={{ flex: 'none' }} />
    </a>
  );
}

/** Les deux boutons du bas d'un tiroir : la page de l'élément et sa source officielle. Les
 *  tiroirs d'un vote, d'un amendement et d'un article les partagent, pour se présenter
 *  pareil. `onClick` : sur la page déjà ouverte, le lien referme le tiroir. */
export function BoutonsPageSource({ page, source }: {
  page: { href: string; libelle: string; onClick?: () => void } | null;
  source: { href: string; libelle: string } | null;
}) {
  if (!page && !source) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" style={{ marginTop: '32px' }}>
      {page && (
        <Link
          href={page.href}
          prefetch={false}
          onClick={page.onClick}
          className="inline-flex items-center gap-1.5 rounded-full transition-opacity hover:opacity-90"
          style={{ fontSize: '13px', fontWeight: 600, padding: '7px 14px', backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)', textDecoration: 'none' }}
        >
          {page.libelle}
          <ChevronRight style={{ width: '14px', height: '14px' }} />
        </Link>
      )}
      {source && (
        <a
          href={source.href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border transition-colors hover:bg-muted"
          style={{ fontSize: '13px', fontWeight: 600, padding: '6px 14px', borderColor: 'var(--primary)', color: 'var(--primary)', textDecoration: 'none' }}
        >
          {source.libelle}
          <ExternalLink style={{ width: '13px', height: '13px' }} />
        </a>
      )}
    </div>
  );
}
