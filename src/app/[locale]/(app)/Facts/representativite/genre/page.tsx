// Page `/Facts/representativite/genre` : part de femmes à l'Assemblée, au Sénat et au
// Gouvernement, comparée à la population (`FRANCE_PCT_FEMMES`, repère partagé avec
// `/etat-des-lieux`). Server Component statique qui lit `acteurs` et `organes`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { getParliamentCounts } from '@/lib/parliament-counts';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import { DonutChart } from '@/components/ui/DonutChart';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Filter, Scale, AlertTriangle } from 'lucide-react';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { FRANCE_PCT_FEMMES } from '@/lib/facts-shared';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerGenreRepresentants' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/representativite/genre'),
    openGraph: buildOpenGraph(locale, '/Facts/representativite/genre', title, description),
  };
}

const COLOR = '#7c3aed';
const COLOR_HOMMES = '#64748b';

type Acteur = {
  civ: string | null;
  groupe: string | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  est_ministre_actuel: boolean | null;
};

const isFemme = (a: Acteur) => a.civ?.trim() === 'Mme';

const pct = (n: number, base: number) =>
  base > 0 ? Math.round((n * 1000) / base) / 10 : 0;

/** Loi n° 2000-493 du 6 juin 2000, première loi sur la parité, citée dans la réponse. */
const LOI_PARITE = { annee: 2000, mois: 5, jour: 6 };

/**
 * Années pleines écoulées depuis la loi sur la parité, à la date du rendu. La
 * page est régénérée chaque nuit : écrit en dur, ce nombre était devenu faux
 * (« vingt-cinq ans » en 2026) sans que rien ne le signale.
 */
const anneesDepuisLoiParite = (maintenant: Date): number => {
  const anniversairePasse =
    maintenant.getMonth() > LOI_PARITE.mois ||
    (maintenant.getMonth() === LOI_PARITE.mois && maintenant.getDate() >= LOI_PARITE.jour);
  return maintenant.getFullYear() - LOI_PARITE.annee - (anniversairePasse ? 0 : 1);
};

export default async function AnswerGenreRepresentantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerGenreRepresentants' });
  const counts = await getParliamentCounts();

  // Lève sur une panne (D-136) : sans cela, la page figeait « 0 % » de femmes.
  const acteurs: Acteur[] = await sql<Acteur[]>`
    select civ, groupe, est_depute_actuel, est_senateur_actuel, est_ministre_actuel
    from acteurs
    where en_exercice = true
      and (est_depute_actuel = true or est_senateur_actuel = true or est_ministre_actuel = true)
    limit 2000`;
  const deputes = acteurs.filter((a) => a.est_depute_actuel);
  const senateurs = acteurs.filter((a) => a.est_senateur_actuel);
  const ministres = acteurs.filter((a) => a.est_ministre_actuel);

  const nFemmesAN = deputes.filter(isFemme).length;
  const nFemmesSN = senateurs.filter(isFemme).length;
  const nFemmesGouv = ministres.filter(isFemme).length;
  const pctAN = pct(nFemmesAN, deputes.length);
  const pctSN = pct(nFemmesSN, senateurs.length);
  const pctGouv = pct(nFemmesGouv, ministres.length);
  // Écart à la part de femmes dans la population, et non à 50 % : c'est le
  // repère que la réponse cite juste avant. Arrondi au dixième, comme les parts.
  const ecartPopulation = (part: number) => Math.round((FRANCE_PCT_FEMMES - part) * 10) / 10;

  // ── Donut Femmes / Hommes (parlementaires uniquement) ─────────────
  const totalParl = deputes.length + senateurs.length;
  const femmesParl = nFemmesAN + nFemmesSN;
  const hommesParl = totalParl - femmesParl;
  const donutData = [
    { name: t('donutFemmes'), size: femmesParl },
    { name: t('donutHommes'), size: hommesParl },
  ];

  // ── % de femmes par groupe politique ──────────────────────────────
  const parlementaires = [...deputes, ...senateurs];
  const groupeUids = new Set<string>();
  parlementaires.forEach((a) => {
    if (a.groupe) groupeUids.add(a.groupe);
  });

  type OrganeInfo = { libelle: string; couleur: string | null };
  const organesMap = new Map<string, OrganeInfo>();
  if (groupeUids.size > 0) {
    const organesData = await sql<{
      uid: string;
      libelle: string | null;
      libelle_abrege: string | null;
      couleur_associee: string | null;
    }[]>`
      select uid, libelle, libelle_abrege, couleur_associee
      from organes
      where uid = any(${Array.from(groupeUids)})`;
    organesData.forEach(
      (o: {
        uid: string;
        libelle: string | null;
        libelle_abrege: string | null;
        couleur_associee: string | null;
      }) => {
        organesMap.set(o.uid, {
          libelle: o.libelle || o.libelle_abrege || o.uid,
          couleur: o.couleur_associee,
        });
      }
    );
  }

  const buildGroupePct = (rows: Acteur[]) => {
    const byGroupe = new Map<string, { f: number; total: number }>();
    for (const a of rows) {
      if (!a.groupe) continue;
      const acc = byGroupe.get(a.groupe) ?? { f: 0, total: 0 };
      acc.total += 1;
      if (isFemme(a)) acc.f += 1;
      byGroupe.set(a.groupe, acc);
    }
    return [...byGroupe.entries()]
      .filter(([, acc]) => acc.total >= 3)
      .map(([uid, acc]) => {
        const info = organesMap.get(uid);
        const libelle = info?.libelle ?? uid;
        return {
          groupe: `${libelle} (${acc.total})`,
          value: pct(acc.f, acc.total),
          fill: resolveGroupeColor(info?.couleur, COLOR),
        };
      })
      .sort((a, b) => b.value - a.value);
  };

  const groupeANData = buildGroupePct(deputes);
  const groupeSNData = buildGroupePct(senateurs);

  return (
    <div className="py-12">
      {/* ① LA RÉPONSE */}
      <h2
        className="text-xs font-bold uppercase tracking-widest mb-3"
        style={{ color: COLOR }}
      >
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          an: pctAN.toLocaleString(locale),
          sn: pctSN.toLocaleString(locale),
          insee: FRANCE_PCT_FEMMES.toLocaleString(locale),
          ecartAN: ecartPopulation(pctAN).toLocaleString(locale),
          ecartSN: ecartPopulation(pctSN).toLocaleString(locale),
          annees: anneesDepuisLoiParite(new Date()),
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Hero — 2 grands chiffres + 2 repères secondaires */}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('heroTitle')}</CardTitle>
          <CardDescription>{t('heroDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {[
              { label: t('chambreAN'), value: pctAN, count: nFemmesAN, total: deputes.length },
              { label: t('chambreSN'), value: pctSN, count: nFemmesSN, total: senateurs.length },
            ].map((row) => (
              <div
                key={row.label}
                className="flex flex-col items-start md:items-center text-left md:text-center"
              >
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  {row.label}
                </span>
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-6xl font-bold tabular-nums"
                    style={{ color: COLOR }}
                  >
                    {row.value.toLocaleString(locale)}
                  </span>
                  <span className="text-xl text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('heroSample', { f: row.count, total: row.total })}
                </p>
              </div>
            ))}
          </div>

          {/* Repères secondaires — séparés visuellement */}
          <div className="border-t pt-5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3 text-center md:text-left">
              {t('heroRepere')}
            </p>
            <div className="flex flex-wrap items-baseline justify-around md:justify-start gap-x-10 gap-y-3">
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-muted-foreground">{t('chambreGouv')}</span>
                <span className="text-2xl font-semibold tabular-nums" style={{ color: COLOR }}>
                  {pctGouv.toLocaleString(locale)}
                </span>
                <span className="text-sm text-muted-foreground">%</span>
                <span className="text-xs text-muted-foreground">
                  ({t('heroSample', { f: nFemmesGouv, total: ministres.length })})
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-muted-foreground">{t('heroInseeLabel')}</span>
                <span className="text-2xl font-semibold tabular-nums" style={{ color: COLOR }}>
                  {FRANCE_PCT_FEMMES.toLocaleString(locale)}
                </span>
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Accordion À comprendre */}
      <h2
        className="text-xs font-bold uppercase tracking-widest mb-5"
        style={{ color: COLOR }}
      >
        {t('conceptsTitle')}
      </h2>
      <Accordion
        type="multiple"
        className="mb-12"
      >
        <AccordionItem value="perimetre">
          <AccordionTrigger className="hover:no-underline">
            {t('concept1Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept1Desc', { an: counts.an, sn: counts.sn, total: counts.total })}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="civ">
          <AccordionTrigger className="hover:no-underline">
            {t('concept2Title', { an: counts.an, sn: counts.sn })}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept2Desc', { an: counts.an, sn: counts.sn })}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="parite">
          <AccordionTrigger className="hover:no-underline">
            {t('concept3Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept3Desc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="scrutin">
          <AccordionTrigger className="hover:no-underline">
            {t('concept4Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t('concept4Desc', { an: pctAN.toLocaleString(locale), sn: pctSN.toLocaleString(locale) })}
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="gouvernement">
          <AccordionTrigger className="hover:no-underline">
            {t('concept5Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept5Desc')}</p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* ② EN CHIFFRES */}
      <h2
        className="text-xs font-bold uppercase tracking-widest mb-8"
        style={{ color: COLOR }}
      >
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        <DonutChart
          data={donutData}
          title={t('donutChartTitle')}
          description={t('donutChartDesc')}
          tooltipLabel={t('donutChartLabel')}
          note={t('donutChartNote', { total: totalParl, f: femmesParl, h: hommesParl })}
          colors={[COLOR, COLOR_HOMMES]}
        />

        {groupeANData.length > 0 && (
          <div className="md:col-span-2">
            <GroupeBarChart
              data={groupeANData}
              title={t('groupeANChartTitle')}
              description={t('groupeANChartDesc')}
              color={COLOR}
              valueLabel={t('groupeChartLabel')}
              note={t('groupeANChartNote')}
              labelWidth={320}
              labelMaxChars={44}
              xDomain={[0, 100]}
            />
          </div>
        )}

        {groupeSNData.length > 0 && (
          <div className="md:col-span-2">
            <GroupeBarChart
              data={groupeSNData}
              title={t('groupeSNChartTitle')}
              description={t('groupeSNChartDesc')}
              color={COLOR}
              valueLabel={t('groupeChartLabel')}
              note={t('groupeSNChartNote')}
              labelWidth={320}
              labelMaxChars={44}
              xDomain={[0, 100]}
            />
          </div>
        )}
      </div>

      {/* ③ MÉTHODOLOGIE */}
      <Separator className="mb-8" />
      <h2
        id="methodologie"
        className="text-xs font-bold uppercase tracking-widest mb-5 scroll-mt-24"
        style={{ color: COLOR }}
      >
        {t('methodologyTitle')}
      </h2>
      <div className="text-sm leading-relaxed text-foreground/80 space-y-4 mb-16">
        <p className="flex gap-3">
          <Target className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyPerimeter', { an: counts.an, sn: counts.sn, total: counts.total, gouv: ministres.length })}</span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyCalcul')}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyExclusions')}</span>
        </p>
        <p className="flex gap-3">
          <Scale className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyComparaison')}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimit')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Facts/representativite/genre" locale={locale} />
    </div>
  );
}
