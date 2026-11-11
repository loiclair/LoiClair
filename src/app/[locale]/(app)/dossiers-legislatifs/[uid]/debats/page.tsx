// Index des séances de débat d'un dossier : une ligne par séance, qui mène au verbatim.
//
// La page portait auparavant le verbatim du dossier entier, jusqu'à 15 402 interventions
// et 7 Mo de texte. Le verbatim vit désormais sur `.../debats/[seance]`, où la plus
// grosse séance du corpus tient en 1 954 interventions, donc sous un poids lisible.
// Server component pur : que des liens, aucune interaction.

export const revalidate = 86400;
export const dynamic = 'force-static';
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

import { notFound } from 'next/navigation';
import { estUidDossier } from '@/lib/uid-fiches';
import type { Metadata } from 'next';
import { auPlusUneLigne, sql } from '@/lib/db';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { ChevronRight } from 'lucide-react';
import PageHero from '@/components/PageHero';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import { seanceVersSlug } from './seance-slug';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';

type SeanceStat = {
  seance_uid: string;
  chambre: 'AN' | 'SEN';
  date_seance: string;
  /** « Séance 116 » côté AN, null côté Sénat (voir le rendu plus bas). */
  titre: string | null;
  nb_interventions: number;
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string; uid: string }> }): Promise<Metadata> {
  const { locale, uid } = await params;
  if (!estUidDossier(uid)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'resumeIA' });
  // Lève sur une panne (D-136) : la régénération garde alors la page précédente au
  // lieu de figer le titre générique. Une fiche marquée par
  // `/api/revalidate` n'en a plus et rend une erreur le temps de la panne.
  const data = await auPlusUneLigne(sql<{ titre: string | null; titre_en: string | null }[]>`
    select titre, titre_en from dossiers_legislatifs where uid = ${uid}`, 'dossiers_legislatifs (métadonnées)');
  // Sur /en, le titre traduit par l'IA quand il existe (`lib/titre-dossier.ts`).
  const titre = data ? titreDossier(data, locale) : '';
  const title = titre
    ? `${t('debatsBreadcrumbDebats')} — ${titre} — LoiClair`
    : `${t('debatsTitle')} — LoiClair`;
  const description = titre ? t('debatsMetaDescription', { titre }) : t('debatsVerbatimIntro');
  return {
    title,
    description,
    alternates: buildAlternates(locale, `/dossiers-legislatifs/${uid}/debats`),
    openGraph: buildOpenGraph(locale, `/dossiers-legislatifs/${uid}/debats`, title, description),
  };
}

export default async function DebatsSeancesPage({ params }: { params: Promise<{ locale: string; uid: string }> }) {
  const { locale, uid } = await params;
  if (!estUidDossier(uid)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'resumeIA' });

  const [dossier, seances] = await Promise.all([
    // `auPlusUneLigne` : une absence rend null, donc un 404, distinct d'une panne.
    auPlusUneLigne(sql<{ uid: string; titre: string | null; titre_en: string | null }[]>`
      select uid, titre, titre_en from dossiers_legislatifs where uid = ${uid}`, 'dossiers_legislatifs'),
    // Vue d'agrégation : 52 séances au maximum pour un dossier, et le compte des
    // interventions est fait par Postgres au lieu d'être déduit de leurs lignes.
    sql<SeanceStat[]>`
      select seance_uid, chambre, date_seance, titre, nb_interventions
      from dossiers_seances_stats
      where dossier_uid = ${uid}
      order by date_seance asc, seance_uid asc`,
  ]);

  // Une panne lève (D-136) et ne devient plus un 404 mis en cache : seul un dossier
  // absent de la base en mérite un.
  if (!dossier) notFound();

  const breadcrumb = [
    { label: t('debatsBreadcrumbTextes'), href: '/dossiers-legislatifs' },
    {
      label: titreDossier(dossier, locale) || `dossier ${dossier.uid}`,
      href: `/dossiers-legislatifs/${dossier.uid}/resume-ia`,
      ...(titreTraduit(dossier, locale) ? { badge: <AIBadgeTitre surBandeau /> } : {}),
    },
    { label: t('debatsBreadcrumbDebats') },
  ];

  const dateLocale = locale === 'en' ? 'en-GB' : 'fr-FR';

  return (
    <>
      <PageHero
        breadcrumb={breadcrumb}
        title={t('debatsHeroTitle')}
        subtitle={dossier.uid}
      />
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '1.5rem 1rem 3rem' }}>
        {seances.length === 0 ? (
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.875rem', lineHeight: 1.5 }}>
            {t('noDebatesYet')}
          </p>
        ) : (
          <>
            <p style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              {t('debatsSeancesIntro')}
            </p>

            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {seances.map((s) => {
                // `date_seance` est une date nue : la découper évite le décalage d'un
                // jour qu'un `new Date('2026-04-16')`, interprété en UTC, produirait.
                const [y, m, d] = s.date_seance.split('-').map(Number);
                const dateStr = new Date(y, m - 1, d).toLocaleDateString(dateLocale, {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                });
                const chambreLabel = s.chambre === 'AN' ? t('assemblee') : t('senat');
                // Seules les séances de l'AN ont un titre, et tous suivent « Séance N » (mesuré
                // en base le 2026-10-29 : 769 sur 769). Un autre motif s'afficherait tel quel.
                const titreSeance = (titre: string) => {
                  const m = /^Séance (\d+)$/.exec(titre);
                  return m ? t('debatsSeanceTitre', { n: m[1] }) : titre;
                };
                const chambreColor = s.chambre === 'AN' ? '#2563eb' : '#059669';

                return (
                  <li key={s.seance_uid} style={{ borderBottom: '1px solid var(--border)' }}>
                    <Link
                      href={`/dossiers-legislatifs/${uid}/debats/${seanceVersSlug(s.seance_uid)}`}
                      prefetch={false}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.875rem 0.25rem',
                        color: 'var(--foreground)',
                        textDecoration: 'none',
                      }}
                    >
                      {/* Deux blocs à toutes les largeurs : pastille + date en haut, titre et
                          nombre d'interventions en dessous. Quand la place manque, la date
                          passe sous la pastille (trois lignes en tout). Sur une seule ligne,
                          les quatre éléments dépassaient 390 px (la date passait sur 3 lignes
                          et le compteur sortait de l'écran). `minWidth: 0` laisse la colonne rétrécir
                          dans le flex au lieu de s'élargir à son contenu. */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem 0.75rem' }}>
                          <span
                            style={{
                              padding: '0.15rem 0.5rem',
                              borderRadius: '0.25rem',
                              background: chambreColor + '20',
                              color: chambreColor,
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {chambreLabel}
                          </span>
                          <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{dateStr}</span>
                        </div>
                        {/* L'AN tient plusieurs séances le même jour : le titre (« Séance 116 »)
                            est ce qui les départage. Le Sénat n'en a pas, mais son uid est daté,
                            donc il n'a jamais deux séances à la même date. */}
                        <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', lineHeight: 1.4, color: 'var(--muted-foreground)' }}>
                          {s.titre && <>{titreSeance(s.titre)} · </>}
                          {t('debatsSeanceInterventions', { count: s.nb_interventions })}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--muted-foreground)' }} aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </>
  );
}
