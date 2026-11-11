// Registre des articles « Les faits » : source unique du hub /Facts (une, cartes,
// bandeaux de série) et de « Continuez d'explorer » (ExploreSection) en bas de
// chaque article. Un nouvel article s'ajoute ici et nulle part ailleurs : le hub
// n'a plus de liste à lui. Les libellés sont des clés de messages, jamais du texte,
// pour que le regroupement par thème ou par série ne dépende pas de la langue.

// Clé de message du titre de chaque série, dans le namespace `kpisHub`.
export const FACTS_SERIES = {
  representativite: 'serieRepresentativite',
  succesLegislatif: 'serieSuccesLegislatif',
  budget: 'serieBudget',
} as const;

export type FactsSerieKey = keyof typeof FACTS_SERIES;

export interface FactsArticle {
  href: string;
  titleKey: string;              // kpisHub.<titleKey> : la question de l'article
  categoryKey: string;           // kpisHub.<categoryKey> : le thème de la pastille
  publishedAt: string;           // ISO "YYYY-MM-DD"
  image: string;                 // photo Unsplash de la une, des cartes et des bandeaux
  color: string;                 // teinte hex de la pastille
  // Accroche de la une : la description de la page de l'article, déjà traduite
  // dans son propre namespace.
  description: { namespace: string; key: string };
  // `labelKey` (kpisHub) : le nom court du chapitre. Il sert la seconde ligne du
  // titre dans l'en-tête de la page et la liste des chapitres du hub.
  serie?: { key: FactsSerieKey; chapter: number; labelKey: string };
}

// Garde l'union exacte des `href` du registre (`FactsHref`) tout en typant chaque
// article en `FactsArticle` : un `as const` figerait chaque entrée en un type à
// part, et `a.serie` ne se lirait plus sur celles qui n'en ont pas.
function registre<const H extends string>(articles: (FactsArticle & { href: H })[]) {
  return articles;
}

export const FACTS_ARTICLES = registre([
  { href: '/Facts/taux-promulgation',            titleKey: 'q1',                          categoryKey: 'catPromulgation',     publishedAt: '2026-04-06', color: '#0d9488', image: 'https://images.unsplash.com/photo-1589330694653-ded6df03f754?w=800&h=500&fit=crop', description: { namespace: 'answerPromulgation', key: 'pageDescription' } },
  { href: '/Facts/taux-application',             titleKey: 'q2',                          categoryKey: 'catApplication',      publishedAt: '2026-04-09', color: '#2563eb', image: 'https://images.unsplash.com/photo-1618771623063-6c3faa854a61?w=800&h=500&fit=crop', description: { namespace: 'answerApplication', key: 'pageDescription' } },
  { href: '/Facts/delais',                       titleKey: 'q3',                          categoryKey: 'catDelais',           publishedAt: '2026-04-10', color: '#b45309', image: 'https://images.unsplash.com/photo-1501139083538-0139583c060f?w=800&h=500&fit=crop', description: { namespace: 'answerDelais', key: 'pageDescription' } },
  { href: '/Facts/representativite/age',         titleKey: 'qRepresentativiteAge',        categoryKey: 'catRepresentativite', publishedAt: '2026-04-11', color: '#7c3aed', image: 'https://images.unsplash.com/photo-1645968092760-605b63706272?w=800&h=500&fit=crop', description: { namespace: 'answerAgeRepresentants', key: 'pageDescription' },        serie: { key: 'representativite', chapter: 1, labelKey: 'chapAge' } },
  { href: '/Facts/representativite/metiers',     titleKey: 'qRepresentativiteMetiers',    categoryKey: 'catRepresentativite', publishedAt: '2026-04-11', color: '#7c3aed', image: 'https://images.unsplash.com/photo-1659353589462-d407d429a4df?w=800&h=500&fit=crop', description: { namespace: 'answerMetiersRepresentants', key: 'pageDescription' },    serie: { key: 'representativite', chapter: 2, labelKey: 'chapMetiers' } },
  { href: '/Facts/representativite/genre',       titleKey: 'qRepresentativiteGenre',      categoryKey: 'catRepresentativite', publishedAt: '2026-04-11', color: '#7c3aed', image: 'https://images.unsplash.com/photo-1650398465335-9530543d340b?w=800&h=500&fit=crop', description: { namespace: 'answerGenreRepresentants', key: 'pageDescription' },      serie: { key: 'representativite', chapter: 3, labelKey: 'chapGenre' } },
  { href: '/Facts/representativite/geographie',  titleKey: 'qRepresentativiteGeographie', categoryKey: 'catRepresentativite', publishedAt: '2026-04-11', color: '#7c3aed', image: 'https://images.unsplash.com/photo-1728577379969-768bf0747172?w=800&h=500&fit=crop', description: { namespace: 'answerGeographieRepresentants', key: 'pageDescription' }, serie: { key: 'representativite', chapter: 4, labelKey: 'chapGeographie' } },
  { href: '/Facts/participation',                titleKey: 'qParticipation',              categoryKey: 'catParticipation',    publishedAt: '2026-04-12', color: '#c2410c', image: 'https://images.unsplash.com/photo-1540910419892-4a36d2c3266c?w=800&h=500&fit=crop', description: { namespace: 'answerParticipation', key: 'pageDescription' } },
  { href: '/Activite',                           titleKey: 'qActivite',                   categoryKey: 'catActivite',         publishedAt: '2026-04-13', color: '#16a34a', image: 'https://images.unsplash.com/photo-1566699270403-3f7e3f340664?w=800&h=500&fit=crop', description: { namespace: 'answerActivite', key: 'pageMetaDesc' } },
  { href: '/Facts/loyaute',                      titleKey: 'qLoyaute',                    categoryKey: 'catLoyaute',          publishedAt: '2026-04-21', color: '#0891b2', image: 'https://images.unsplash.com/photo-1740208376134-67da8e85ccf3?w=800&h=500&fit=crop', description: { namespace: 'answerLoyaute', key: 'pageDescription' } },
  { href: '/Facts/alliances',                    titleKey: 'qAlliances',                  categoryKey: 'catAlliances',        publishedAt: '2026-04-21', color: '#be185d', image: 'https://images.unsplash.com/photo-1700939460432-c1b87be0f59c?w=800&h=500&fit=crop', description: { namespace: 'answerAlliances', key: 'pageDescription' } },
  { href: '/Facts/succes-legislatif/volume',     titleKey: 'qSuccesLegislatif',           categoryKey: 'catSuccesLegislatif', publishedAt: '2026-04-23', color: '#ca8a04', image: 'https://images.unsplash.com/photo-1774898988393-5c752e4d55e9?w=800&h=500&fit=crop', description: { namespace: 'answerSuccesLegislatif', key: 'pageDescription' },           serie: { key: 'succesLegislatif', chapter: 1, labelKey: 'chapVolume' } },
  { href: '/Facts/succes-legislatif/efficacite', titleKey: 'qSuccesLegislatifEfficacite', categoryKey: 'catSuccesLegislatif', publishedAt: '2026-04-23', color: '#ca8a04', image: 'https://images.unsplash.com/photo-1593115057322-e94b77572f20?w=800&h=500&fit=crop', description: { namespace: 'answerSuccesLegislatifEfficacite', key: 'pageDescription' }, serie: { key: 'succesLegislatif', chapter: 2, labelKey: 'chapEfficacite' } },
  { href: '/Facts/succes-legislatif/victoires',  titleKey: 'qSuccesLegislatifVictoires',  categoryKey: 'catSuccesLegislatif', publishedAt: '2026-07-02', color: '#ca8a04', image: 'https://images.unsplash.com/photo-1607778417094-1fef13315e6e?w=800&h=500&fit=crop', description: { namespace: 'answerSuccesLegislatifVictoires', key: 'pageDescription' },  serie: { key: 'succesLegislatif', chapter: 3, labelKey: 'chapVictoires' } },
  { href: '/Facts/amendements',                  titleKey: 'qAmendements',                categoryKey: 'catAmendements',      publishedAt: '2026-05-01', color: '#059669', image: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=800&h=500&fit=crop', description: { namespace: 'answerAmendements', key: 'pageDescription' } },
  { href: '/Facts/cumul-des-mandats',            titleKey: 'qCumulMandats',               categoryKey: 'catCumulMandats',     publishedAt: '2026-09-06', color: '#0f766e', image: 'https://images.unsplash.com/photo-1661585248792-33764253160b?w=800&h=500&fit=crop', description: { namespace: 'answerCumulMandats', key: 'pageDescription' } },
  { href: '/Facts/budget/assemblee-nationale',   titleKey: 'qBudgetAssemblee',            categoryKey: 'catBudget',           publishedAt: '2026-09-13', color: '#475569', image: 'https://images.unsplash.com/photo-1550133881-13e70aa00bae?w=800&h=500&fit=crop', description: { namespace: 'answerBudgetAssemblee', key: 'pageDescription' },            serie: { key: 'budget', chapter: 1, labelKey: 'chapAssemblee' } },
  { href: '/Facts/budget/senat',                 titleKey: 'qBudgetSenat',                categoryKey: 'catBudget',           publishedAt: '2026-09-14', color: '#475569', image: 'https://images.unsplash.com/photo-1664008546045-a85ca0b2e869?w=800&h=500&fit=crop', description: { namespace: 'answerBudgetSenat', key: 'pageDescription' },                serie: { key: 'budget', chapter: 2, labelKey: 'chapSenat' } },
]);

/** Les adresses du registre. `navigation.tsx` s'en sert pour exiger un en-tête
 *  par article, et pas un de plus. */
export type FactsHref = (typeof FACTS_ARTICLES)[number]['href'];

/** Les clés de traduction du registre que le navigateur lit par nom variable : la
 *  description de chaque article, dans le namespace de sa page, que la recherche
 *  globale indexe (`site-pages.ts`). Le navigateur ne reçoit qu'une partie du
 *  catalogue (`src/i18n/messages-client.ts`) : un article ajouté y emporte ainsi sa
 *  description. Les clés `kpisHub.*` n'y sont pas, ce namespace partant entier. */
export function clesTraductionFacts(): string[] {
  return FACTS_ARTICLES.map((a) => `${a.description.namespace}.${a.description.key}`);
}

// Liens de « Continuez d'explorer » : d'abord les autres articles du même thème
// (dans l'ordre du registre), puis les plus récents des autres thèmes.
export function getExploreArticles(currentHref: string, max = 3): FactsArticle[] {
  const current = FACTS_ARTICLES.find((a) => a.href === currentHref);
  const others = FACTS_ARTICLES.filter((a) => a.href !== currentHref);

  if (!current) return others.slice(0, max);

  const sameCategory = others.filter((a) => a.categoryKey === current.categoryKey);
  const different = others
    .filter((a) => a.categoryKey !== current.categoryKey)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  return [...sameCategory, ...different].slice(0, max);
}
