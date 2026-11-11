// Hub « Les faits » (/Facts). Range les articles de `facts-registry.ts` en trois
// formes : la une (l'article le plus récent, en grand), des cartes, et un bandeau
// par série de deux chapitres ou plus. Server Component statique : aucun état,
// aucun script client, les survols passent par CSS.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import type { CSSProperties, ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { formateurDate } from '@/lib/jour-paris';
import { FACTS_ARTICLES, FACTS_SERIES, type FactsArticle, type FactsSerieKey } from '@/lib/facts-registry';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'kpisHub' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageSubtitle');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts'),
    openGraph: buildOpenGraph(locale, '/Facts', title, description),
  };
}

// Les clés viennent du registre, pas du code : le typage strict de next-intl ne
// peut pas les vérifier, d'où la signature élargie.
type Traduire = (key: string, values?: Record<string, string | number>) => string;

type Serie = { key: FactsSerieKey; chapitres: FactsArticle[]; dernier: FactsArticle };
type Element = { article: FactsArticle } | { serie: Serie };

const parChapitre = (a: FactsArticle, b: FactsArticle) => (a.serie?.chapter ?? 0) - (b.serie?.chapter ?? 0);

// Même écart entre les cartes qu'entre la photo et le texte d'un bandeau : c'est
// ce qui aligne la photo du bandeau sur la première colonne de cartes.
const GOUTTIERE = 'clamp(1rem, 2vw, 1.75rem)';

/**
 * Découpe les articles triés du plus récent au plus ancien.
 * - `une` : le premier article.
 * - `soeurs` : les autres chapitres de sa série, listés sous la une. Sa série ne
 *   revient pas dans la grille, sinon ses chapitres s'afficheraient deux fois.
 * - `reste` : articles seuls et séries de 2+ chapitres, une série prenant la place
 *   de son chapitre le plus récent. Une série réduite à un chapitre (le reste est
 *   à la une, ou il n'y en a qu'un) redevient une carte.
 */
function ranger(tries: FactsArticle[]) {
  const [une, ...autres] = tries;
  const serieUne = une.serie?.key;
  const dansSerieUne = (a: FactsArticle) => serieUne !== undefined && a.serie?.key === serieUne;

  const soeurs = autres.filter(dansSerieUne).sort(parChapitre);
  const candidats = autres.filter((a) => !dansSerieUne(a));

  const reste: Element[] = [];
  const vues = new Set<FactsSerieKey>();
  for (const a of candidats) {
    const cle = a.serie?.key;
    const chapitres = cle ? candidats.filter((x) => x.serie?.key === cle) : [];
    if (!cle || chapitres.length < 2) {
      reste.push({ article: a });
    } else if (!vues.has(cle)) {
      vues.add(cle);
      reste.push({ serie: { key: cle, chapitres: chapitres.sort(parChapitre), dernier: a } });
    }
  }
  return { une, soeurs, reste };
}

// Pastille de thème : fond teinté à 12,5 %, texte mêlé à 40 % de l'encre du thème
// (plus foncé en clair, plus clair en sombre). En teinte pure, ce texte de 11 px
// tombait sous 3:1 (ardoise en sombre, jaune et vert en clair). Sans color-mix()
// (Safari < 16.2), la déclaration est ignorée et le texte hérite de l'encre.
function Pastille({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      style={{
        alignSelf: 'flex-start',
        fontSize: '0.6875rem',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        lineHeight: 1,
        padding: '0.42rem 0.6rem',
        borderRadius: '6px',
        backgroundColor: `${color}20`,
        color: `color-mix(in oklch, ${color}, var(--foreground) 40%)`,
      }}
    >
      {children}
    </span>
  );
}

function DatePubliee({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)' }}>{children}</span>;
}

// Liste numérotée des chapitres. Numéro et flèche restent calés sur la première
// ligne du libellé : centrés, un libellé sur deux lignes décalait son numéro par
// rapport à la colonne voisine.
function ListeChapitres({ chapitres, t, deuxColonnes }: { chapitres: FactsArticle[]; t: Traduire; deuxColonnes: boolean }) {
  return (
    <ol
      className={`grid grid-cols-1 ${deuxColonnes ? 'lg:grid-cols-2' : ''}`}
      style={{ listStyle: 'none', margin: '0.25rem 0 0', padding: 0, columnGap: '2rem' }}
    >
      {chapitres.map((c) => (
        <li key={c.href} style={{ borderTop: '1px solid var(--border)' }}>
          <Link
            href={c.href}
            className="grid items-start text-[var(--card-foreground)] hover:text-primary transition-colors"
            style={{ gridTemplateColumns: '1.5rem 1fr auto', gap: '0.5rem', padding: '0.7rem 0', textDecoration: 'none' }}
          >
            <span style={{ fontSize: '0.8125rem', lineHeight: '1.35rem', fontWeight: 600, color: 'var(--muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>
              {c.serie?.chapter}
            </span>
            <span style={{ fontSize: '1rem', fontWeight: 600, lineHeight: 1.35 }}>
              {t(c.serie?.labelKey ?? c.titleKey)}
            </span>
            <ArrowRight aria-hidden style={{ width: '16px', height: '16px', marginTop: '0.175rem', color: 'var(--muted-foreground)' }} />
          </Link>
        </li>
      ))}
    </ol>
  );
}

// Libellé de pastille d'un article : son thème, et son numéro s'il est un chapitre.
function libelleTheme(a: FactsArticle, t: Traduire) {
  return a.serie ? `${t(a.categoryKey)} · ${t('catChapter')} ${a.serie.chapter}` : t(a.categoryKey);
}

function Une({ article, soeurs, t, tout, date }: { article: FactsArticle; soeurs: FactsArticle[]; t: Traduire; tout: Traduire; date: string }) {
  const titre = t(article.titleKey);
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-5 items-center"
      style={{ gap: 'clamp(1.25rem, 3.5vw, 3.5rem)', marginBottom: 'clamp(2.5rem, 5vw, 4rem)' }}
    >
      {/* Doublon du lien du titre : retiré du clavier et des lecteurs d'écran */}
      <Link
        href={article.href}
        tabIndex={-1}
        aria-hidden
        className="group md:col-span-3"
        style={{ position: 'relative', display: 'block', aspectRatio: '16 / 10', borderRadius: '16px', overflow: 'hidden', backgroundColor: 'var(--muted)' }}
      >
        <Image
          src={article.image}
          alt=""
          fill
          priority
          sizes="(max-width: 768px) 100vw, 60vw"
          className="transition-transform duration-500 ease-out scale-110 group-hover:scale-100"
          style={{ objectFit: 'cover' }}
        />
      </Link>
      <div className="md:col-span-2" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Pastille color={article.color}>{libelleTheme(article, t)}</Pastille>
        <h2 style={{ fontSize: 'clamp(1.625rem, 2.6vw, 2.5rem)', fontWeight: 700, lineHeight: 1.12, letterSpacing: '-0.03em', textWrap: 'balance', margin: 0 }}>
          <Link href={article.href} className="hover:text-primary transition-colors" style={{ textDecoration: 'none' }}>
            {titre}
          </Link>
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: '1.0625rem',
            lineHeight: 1.6,
            color: 'var(--card-foreground)',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {tout(`${article.description.namespace}.${article.description.key}`)}
        </p>
        <DatePubliee>{date}</DatePubliee>
        {soeurs.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)', marginBottom: '0.25rem' }}>
              {t('sameSeries')}
            </span>
            <ListeChapitres chapitres={soeurs} t={t} deuxColonnes={false} />
          </div>
        )}
      </div>
    </div>
  );
}

function Carte({ article, t, date }: { article: FactsArticle; t: Traduire; date: string }) {
  return (
    <Link
      href={article.href}
      className="group bg-[var(--fond)] hover:bg-[var(--fond-survol)] transition-colors"
      style={{
        '--fond': 'var(--muted)',
        '--fond-survol': 'color-mix(in oklch, var(--muted), var(--foreground) 5%)',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '16px',
        overflow: 'hidden',
        textDecoration: 'none',
      } as CSSProperties}
    >
      <div style={{ position: 'relative', aspectRatio: '16 / 9', overflow: 'hidden' }}>
        <Image
          src={article.image}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="transition-transform duration-500 ease-out scale-110 group-hover:scale-100"
          style={{ objectFit: 'cover' }}
        />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '1.25rem 1.5rem 1.5rem' }}>
        <Pastille color={article.color}>{libelleTheme(article, t)}</Pastille>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.02em', textWrap: 'pretty', margin: 0 }}>
          {t(article.titleKey)}
        </h2>
        <div style={{ marginTop: 'auto', paddingTop: '0.25rem' }}>
          <DatePubliee>{date}</DatePubliee>
        </div>
      </div>
    </Link>
  );
}

// Bandeau pleine largeur d'une série. Sa grille interne reprend les colonnes de la
// grille des cartes : photo sur une colonne, texte sur le reste. Dès deux colonnes,
// la photo perd son format 16/9 et s'étire sur la hauteur du texte.
function BandeauSerie({ serie, t, date }: { serie: Serie; t: Traduire; date: string }) {
  const premier = serie.chapitres[0];
  return (
    <div
      className="col-span-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      style={{ columnGap: GOUTTIERE, backgroundColor: 'var(--muted)', borderRadius: '16px', overflow: 'hidden' }}
    >
      {/* Doublon du lien du chapitre 1 : retiré du clavier et des lecteurs d'écran */}
      <Link
        href={premier.href}
        tabIndex={-1}
        aria-hidden
        className="group aspect-[16/9] md:aspect-auto md:min-h-[240px]"
        style={{ position: 'relative', display: 'block', overflow: 'hidden' }}
      >
        <Image
          src={premier.image}
          alt=""
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="transition-transform duration-500 ease-out scale-110 group-hover:scale-100"
          style={{ objectFit: 'cover' }}
        />
      </Link>
      <div
        className="lg:col-span-2 px-[1.5rem] md:pl-0 md:pr-[1.75rem]"
        style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingBlock: '1.5rem' }}
      >
        <Pastille color={premier.color}>
          {`${t(premier.categoryKey)} · ${t('chapterCount', { count: serie.chapitres.length })}`}
        </Pastille>
        <h2 style={{ fontSize: 'clamp(1.375rem, 2vw, 1.75rem)', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.025em', textWrap: 'balance', margin: 0 }}>
          {t(FACTS_SERIES[serie.key])}
        </h2>
        <ListeChapitres chapitres={serie.chapitres} t={t} deuxColonnes />
        <div style={{ marginTop: 'auto' }}>
          <DatePubliee>{t('lastChapter', { date })}</DatePubliee>
        </div>
      </div>
    </div>
  );
}

export default async function FactsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = (await getTranslations({ locale, namespace: 'kpisHub' })) as unknown as Traduire;
  // Sans namespace : l'accroche de la une vit dans le namespace de sa propre page.
  const tout = (await getTranslations({ locale })) as unknown as Traduire;
  const dateFormatter = formateurDate(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const formaterDate = (a: FactsArticle) => dateFormatter.format(new Date(`${a.publishedAt}T12:00:00`));

  const tries = [...FACTS_ARTICLES].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const { une, soeurs, reste } = ranger(tries);

  return (
    <div style={{ paddingTop: '2rem' }}>
      <Une article={une} soeurs={soeurs} t={t} tout={tout} date={formaterDate(une)} />
      {/* Placement dense : un bandeau qui ne tient pas dans la rangée entamée passe
          à la suivante, et les cartes qui le suivent dans la liste remontent combler
          la rangée. Sans lui, chaque bandeau laisserait un trou avant lui. */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 grid-flow-row-dense" style={{ gap: GOUTTIERE }}>
        {reste.map((e) =>
          'serie' in e ? (
            <BandeauSerie key={e.serie.key} serie={e.serie} t={t} date={formaterDate(e.serie.dernier)} />
          ) : (
            <Carte key={e.article.href} article={e.article} t={t} date={formaterDate(e.article)} />
          ),
        )}
      </div>
    </div>
  );
}
