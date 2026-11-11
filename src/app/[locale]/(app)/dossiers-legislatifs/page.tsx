// Page `/dossiers-legislatifs` : recherche des dossiers. Le serveur ne fournit que les
// valeurs de chaque filtre et les dossiers les plus consultés ; la rangée de filtres
// et le filtrage des résultats vivent côté client (`DossiersResultsClient`).

export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Suspense, cache } from 'react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import DossiersSearchInput from '@/components/DossiersSearchInput';
import DossiersResultsClient from '@/components/DossiersResultsClient';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { PROCEDURE_KEY } from '@/lib/facts-shared';
import { libelleTheme } from '@/lib/themes-dossiers';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dossiers' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDesc');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/dossiers-legislatifs'),
    openGraph: buildOpenGraph(locale, '/dossiers-legislatifs', title, description),
  };
}

const toSlug = (str: string) =>
  str.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+$/, '');

const getFilterData = cache(async (locale: string) => {
  const t = await getTranslations({ locale, namespace: 'dossiers' });
  const tTypes = await getTranslations({ locale, namespace: 'textTypes' });
  const tThemes = await getTranslations({ locale, namespace: 'themesDossiers' });

  // Vues de valeurs distinctes : les trois listes de filtres tiennent en moins de
  // 30 lignes chacune, au lieu de lire les 3 055 dossiers pour les recalculer côté JS.
  const [uniqueProcedures, uniqueGroupes, uniqueThemes] = await Promise.all([
    sql<{ procedure_libelle: string }[]>`select procedure_libelle from dossiers_procedures_distinctes`,
    sql<{ initiateur_groupe_libelle: string }[]>`select initiateur_groupe_libelle from dossiers_groupes_distincts`,
    sql<{ theme: string }[]>`select theme from dossiers_themes_distincts`,
  ]);

  const uniqueTypes = [...new Set(uniqueProcedures.map((item) => item.procedure_libelle))].sort();
  // Le slug vient du libellé officiel, dans les deux langues : seul le texte affiché
  // passe, sur /en, à la forme courte traduite, comme dans la liste. Sur /en, le tri
  // suit ce texte : rangées sur le libellé français, les options anglaises sortaient
  // dans un ordre sans logique visible (FilterBar ne retrie pas).
  const typeOptions = uniqueTypes.map((libelle) => {
    const cle = PROCEDURE_KEY[libelle];
    return { slug: toSlug(libelle), libelle: locale === 'en' && cle ? tTypes(`short.${cle}`) : libelle };
  });
  if (locale === 'en') typeOptions.sort((a, b) => a.libelle.localeCompare(b.libelle, 'en') || a.slug.localeCompare(b.slug));

  const uniqueGroupesLibelles = [...new Set(uniqueGroupes.map((item) => item.initiateur_groupe_libelle))].sort();
  const groupeOptions = uniqueGroupesLibelles.map((libelle) => ({ slug: toSlug(libelle), libelle }));

  // La vue dépile déjà le tableau `themes` : une ligne par thème, pas un tableau.
  const uniqueThemesList = [...new Set(uniqueThemes.map((item) => item.theme))].sort();
  // Même règle que le filtre Type : slug tiré du thème en base, libellé traduit, tri sur
  // le texte affiché en anglais.
  const themeOptions = uniqueThemesList.map((theme) => ({ slug: toSlug(theme), libelle: libelleTheme(theme, tThemes) }));
  if (locale === 'en') themeOptions.sort((a, b) => a.libelle.localeCompare(b.libelle, 'en') || a.slug.localeCompare(b.slug));

  const statutOptions = [
    { slug: 'en_cours_d_examen', libelle: t('statutEnCours') },
    { slug: 'publie', libelle: t('statutPublie') },
    { slug: 'adopte_par_assemblee', libelle: t('statutAdopteAssemblee') },
    { slug: 'adopte_par_senat', libelle: t('statutAdopteSenat') },
    { slug: 'adopte_par_parlement', libelle: t('statutAdopteParlement') },
    { slug: 'rejetee', libelle: t('statutRejete') },
    { slug: 'promulguee', libelle: t('statutPromulguee') },
    { slug: 'appliquee', libelle: t('statutAppliquee') },
    { slug: 'retire', libelle: t('statutRetire') },
  ];

  const filterLabels = {
    statut: Object.fromEntries(statutOptions.map((o) => [o.slug, o.libelle])),
    age: Object.fromEntries([
      ['moins_6m', t('ageMoins6m')],
      ['6m_1a', t('age6m1a')],
      ['plus_1a', t('agePlus1a')],
    ]),
    type: Object.fromEntries(typeOptions.map((o) => [o.slug, o.libelle])),
    groupe: Object.fromEntries(groupeOptions.map((o) => [o.slug, o.libelle])),
    theme: Object.fromEntries(themeOptions.map((o) => [o.slug, o.libelle])),
  };

  return { filterLabels };
});

// Les plus consultés du mois. Sur /en, le titre traduit par l'IA quand il existe
// (`lib/titre-dossier.ts`), comme dans la liste sous la recherche. Le menu n'affiche
// que le titre : seuls `uid`, `titre` et `titreTraduit` (pour le badge IA) partent au client.
async function SearchInputSection({ locale }: { locale: string }) {
  const popularData = await sql<{ uid: string; titre: string | null; titre_en: string | null }[]>`
    select uid, titre, titre_en
    from dossiers_legislatifs
    -- hors_liste : dossiers comptés dans le score mais absents des listes (migration 2026-10-29_dossiers_hors_liste.sql).
    where hors_liste = false
      and view_count_month > 0
    -- Départage : sans la clé primaire, l'ordre des ex æquo suit le plan d'exécution.
    order by view_count_month desc, uid
    limit 5`;

  const popularDossiers = popularData.map((d) => ({ uid: d.uid, titre: titreDossier(d, locale), titreTraduit: titreTraduit(d, locale) }));

  return <DossiersSearchInput popularDossiers={popularDossiers} />;
}

async function ResultsSection({ locale }: { locale: string }) {
  const { filterLabels } = await getFilterData(locale);
  return <DossiersResultsClient filterLabels={filterLabels} />;
}

export default async function DossiersLegislatifsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="fade-slide-in" style={{ paddingTop: '1rem', paddingBottom: 4, position: 'relative', zIndex: 10 }}>
        <Suspense fallback={<DossiersSearchInput popularDossiers={[]} />}>
          <SearchInputSection locale={locale} />
        </Suspense>
      </div>

      <Suspense fallback={null}>
        <ResultsSection locale={locale} />
      </Suspense>
    </div>
  );
}
