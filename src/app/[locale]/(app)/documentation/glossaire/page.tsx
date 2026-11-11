// Page `/documentation/glossaire` : définit les statuts, libellés d'actes et provenances
// que la base emploie réellement, lus dans ses vues de valeurs distinctes. Les types de
// procédures renvoient à `/processus-legislatif#types-de-textes`, qui les définit.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db'
import { DEFINITION_KEYS } from '@/lib/definitions'
import { Link } from '@/i18n/navigation'
import type { Metadata } from 'next'
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata'

type GlossaireEntry = { term: string; definition: string }
/** `renvoi` : la rubrique ne liste rien et pointe vers la page qui définit ses termes. */
type Category = { label: string; entries: GlossaireEntry[]; renvoi?: boolean }

// Titre et description repris du menu et de l'en-tête de page, déjà traduits : sans
// eux, la page prenait ceux de l'accueil.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const tNav = await getTranslations({ locale, namespace: 'nav' });
  const tHeaders = await getTranslations({ locale, namespace: 'pageHeaders' });
  const title = `${tNav('glossary')} — LoiClair`;
  const description = tHeaders('ledeGlossaire');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/documentation/glossaire'),
    openGraph: buildOpenGraph(locale, '/documentation/glossaire', title, description),
  };
}

export default async function GlossairePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'definitions' });
  const collator = new Intl.Collator(locale);

  // Une valeur sans définition est écartée plutôt qu'affichée « à venir » : une page
  // qui promet d'expliquer ne montre pas de trous. Deux libellés de la base qui
  // partagent une clé (« Promulgation d'une loi » / « de la loi ») ne font qu'une
  // entrée. Une clé déjà définie dans une section précédente n'est pas répétée :
  // « Commission d'enquête » est à la fois une procédure et un libellé d'acte.
  // Le tri suit le terme affiché dans la langue du lecteur, pas la valeur
  // brute : en anglais, l'ordre alphabétique français n'aurait aucun sens.
  const dejaDefinies = new Set<string>()
  function toEntries(values: (string | null)[]): GlossaireEntry[] {
    const keys = new Set(
      values
        .map(v => (v ? DEFINITION_KEYS[v] : undefined))
        .filter((k): k is string => !!k && !dejaDefinies.has(k))
    )
    keys.forEach(k => dejaDefinies.add(k))
    return [...keys]
      .map(k => ({ term: t(`${k}.term`), definition: t(`${k}.definition`) }))
      .sort((a, b) => collator.compare(a.term, b.term))
  }

  // Vues de valeurs distinctes : Postgres fait le DISTINCT, la réponse tient en
  // quelques dizaines de lignes. Lire les tables entières rapatriait jusqu'à
  // 27 301 lignes pour en garder 55. Une panne lève : la version précédente de la
  // page reste servie, plutôt qu'un glossaire vidé de ses rubriques.
  const [statuts, procedures, actes, provenances] = await Promise.all([
    sql<{ statut_final: string | null }[]>`select statut_final from dossiers_statuts_distincts`,
    sql<{ procedure_libelle: string | null }[]>`select procedure_libelle from dossiers_procedures_distinctes`,
    sql<{ libelle_acte: string | null }[]>`select libelle_acte from actes_libelles_distincts`,
    sql<{ provenance: string | null }[]>`select provenance from textes_provenances_distinctes`,
  ])

  // Les types de procédures sont définis sur `/processus-legislatif`, classés par
  // auteur avec le badge « Peut devenir une loi » : les recopier ici les montrait
  // deux fois, et leur rubrique n'est plus qu'un renvoi. Leurs clés sont tout de
  // même marquées comme déjà définies, pour que « Commission d'enquête », aussi
  // libellé d'acte, ne revienne pas dans les étapes.
  for (const { procedure_libelle } of procedures) {
    const cle = procedure_libelle ? DEFINITION_KEYS[procedure_libelle] : undefined
    if (cle) dejaDefinies.add(cle)
  }

  const categories: Category[] = [
    {
      label: t('categoryStatuts'),
      entries: toEntries(statuts.map(r => r.statut_final)),
    },
    { label: t('categoryProcedures'), entries: [], renvoi: true },
    {
      label: t('categoryEtapes'),
      entries: toEntries(actes.map(r => r.libelle_acte)),
    },
    {
      label: t('categoryProvenance'),
      entries: toEntries(provenances.map(r => r.provenance)),
    },
  ].filter(c => c.renvoi || c.entries.length > 0)

  // Deux colonnes dès 1024 px, pour raccourcir la page sans allonger les lignes :
  // sur toute la largeur, une définition courait sur 170 caractères et l'œil
  // perdait la ligne suivante ; une colonne en garde 70 à 80. Grille remplie par
  // rangées, pas en colonnes de journal : l'ordre alphabétique se lit de gauche à
  // droite, sans remonter en haut d'une section de 51 termes pour lire la suite.
  // Tailles, interligne, écarts et opacité en style inline (Tailwind v4 peu fiable
  // sur Safari) : `text-foreground/80` passerait par color-mix(), absent avant 16.2.
  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="space-y-14">
        {categories.map(({ label, entries, renvoi }) => (
          <section key={label}>
            <h2 className="font-semibold mb-6 pb-2 border-b" style={{ fontSize: '1.25rem' }}>{label}</h2>
            {renvoi ? (
              <p style={{ fontSize: '1rem', lineHeight: 1.6, maxWidth: '44rem' }}>
                <span style={{ opacity: 0.8 }}>{t('proceduresRenvoi')}</span>{' '}
                <Link href="/processus-legislatif#types-de-textes" className="font-medium underline underline-offset-2">
                  {t('proceduresLien')}
                </Link>
              </p>
            ) : (
              <dl className="grid grid-cols-1 lg:grid-cols-2" style={{ columnGap: '4rem', rowGap: '1.5rem' }}>
                {entries.map(({ term, definition }) => (
                  <div key={term}>
                    <dt className="font-semibold" style={{ fontSize: '1rem', lineHeight: 1.4 }}>{term}</dt>
                    <dd className="mt-1" style={{ fontSize: '1rem', lineHeight: 1.6, opacity: 0.8 }}>{definition}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
