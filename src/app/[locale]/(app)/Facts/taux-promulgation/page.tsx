// Page `/Facts/taux-promulgation` : part des textes à vocation législative devenus des
// lois. Server Component statique. Les totaux viennent de `getTauxPromulgation()`,
// partagé avec `/etat-des-lieux` et la landing.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import {
  estPromulgueeOuAppliquee,
  PROCEDURES_PROMULGABLES,
  PROCEDURE_KEY,
  LEGISLATURE_17_START,
} from '@/lib/facts-shared';
import { getTauxPromulgation } from '@/lib/facts-queries';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { MonthlyDossiersChart } from '@/components/ui/MonthlyDossiersChart';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import { estNonInscrits } from '@/lib/non-inscrits';
import { DonutChart } from '@/components/ui/DonutChart';
import { LegislativeFunnel } from '@/components/ui/LegislativeFunnel';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, LineChart, Users, AlertTriangle } from 'lucide-react';

import type { Metadata } from 'next';
import { formateurDate } from '@/lib/jour-paris';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerPromulgation' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/taux-promulgation'),
    openGraph: buildOpenGraph(locale, '/Facts/taux-promulgation', title, description),
  };
}

const COLOR_NON_INSCRITS = '#94a3b8'; // gris : pas un groupe politique (D-313)

export default async function AnswerPromulgationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerPromulgation' });
  const tTypes = await getTranslations({ locale, namespace: 'textTypes' });

  type OrganeChambreRow = { uid: string; code_type: string | null; libelle_abrege: string | null };
  const [promulgationData, organesChambre] = await Promise.all([
    getTauxPromulgation(),
    sql<OrganeChambreRow[]>`
      select uid, code_type, libelle_abrege, libelle
      from organes
      where code_type = any(${['GP', 'GROUPESENAT', 'GOUVERNEMENT']})`,
  ]);

  // La lecture lève sur une panne, sans repli `|| []` (D-136) : sans cette map, chaque
  // groupe retombe sur « Autre », les deux graphiques par groupe fusionnent tout sous
  // une barre unique, et la page fausse part en cache pour 48 h. Lever laisse servir
  // la précédente.
  const organesChambreMap = new Map<string, { chambre: string; sigle: string | null }>(
    organesChambre.map((o) => [
      o.uid,
      {
        chambre: o.code_type === 'GP' ? 'AN' : o.code_type === 'GROUPESENAT' ? 'Sénat' : 'Gouvernement',
        sigle: o.libelle_abrege,
      },
    ])
  );

  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - 23, 1);
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const initMonthlyCounts = () => {
    const counts: Record<string, number> = {};
    for (let d = new Date(startDate); d < endDate; d.setMonth(d.getMonth() + 1)) {
      counts[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = 0;
    }
    return counts;
  };

  const toChartData = (counts: Record<string, number>) =>
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mois, count]) => {
        const [year, month] = mois.split('-').map(Number);
        const monthName = formateurDate(locale, { month: 'short' }).format(
          new Date(year, month - 1)
        );
        return { month: `${monthName}-${year}`, dossiers: count };
      });

  const monthKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  const { totalPromulgables, promulgues, adoptes, tauxPromulgation, totalDeposited, parProcedure } =
    promulgationData;
  const monthlyCounts = initMonthlyCounts();
  const monthlyDeposits = initMonthlyCounts();
  const gsMap = new Map<string, { groupe: string; chambre: string; nonInscrit: boolean; promulgues: number }>();
  const gsProposedMap = new Map<string, { groupe: string; chambre: string; nonInscrit: boolean; total: number }>();
  const typeCounts: Record<string, number> = {};
  const currentMonthKey = monthKey(now);
  let depositsThisMonth = 0;

  // `getTauxPromulgation` rend deux ventilations agrégées de la même cohorte et non
  // la liste des 3 312 dossiers (902 Ko par appel avant le 2026-09-22). Les deux
  // sommes de `nb` valent `totalDeposited` : ce sont deux découpages de la même
  // population, à ne jamais additionner l'un à l'autre.
  //
  // Le test « promulgué » est le même dans les deux boucles, et le même que celui de
  // `getTauxPromulgation` : la définition vit dans `estPromulgueeOuAppliquee`
  // (`facts-shared.ts`), sur `statut_final` brut, et n'est jamais recopiée ici.
  const estSeauPromulgue = (procedure: string | null, statut: string | null) =>
    PROCEDURES_PROMULGABLES.has(procedure ?? '') && estPromulgueeOuAppliquee(statut);

  // Par mois : le compte par type de texte, la courbe des dépôts et celle des
  // promulgations. Les mois arrivent déjà découpés en `AAAA-MM`.
  for (const s of promulgationData.parMois) {
    const type = s.procedure_libelle || 'Autre';
    typeCounts[type] = (typeCounts[type] || 0) + s.nb;

    if (s.mois_depot) {
      if (monthlyDeposits[s.mois_depot] !== undefined) monthlyDeposits[s.mois_depot] += s.nb;
      if (s.mois_depot === currentMonthKey) depositsThisMonth += s.nb;
    }

    if (!estSeauPromulgue(s.procedure_libelle, s.statut_final)) continue;
    if (s.mois_promulgation && monthlyCounts[s.mois_promulgation] !== undefined) {
      monthlyCounts[s.mois_promulgation] += s.nb;
    }
  }

  // Par groupe initiateur : les textes déposés, puis les lois promulguées.
  for (const s of promulgationData.parGroupe) {
    const gLib = s.initiateur_groupe_libelle;
    if (!gLib) continue;
    const gUid = s.initiateur_groupe_uid;
    const organe = gUid ? organesChambreMap.get(gUid) : undefined;
    const chambre = organe?.chambre ?? 'Autre';
    const groupe = chambre === 'Gouvernement' ? 'Gouvernement' : gLib;
    // Les groupes du Gouvernement fusionnent sous une seule barre, quel que soit
    // l'organe ministériel qui a déposé le texte.
    const key = chambre === 'Gouvernement' ? 'GOUVERNEMENT' : gUid || gLib;

    if (!gsProposedMap.has(key)) gsProposedMap.set(key, { groupe, chambre, nonInscrit: estNonInscrits(organe?.sigle), total: 0 });
    gsProposedMap.get(key)!.total += s.nb;

    if (!estSeauPromulgue(s.procedure_libelle, s.statut_final)) continue;
    if (!gsMap.has(key)) gsMap.set(key, { groupe, chambre, nonInscrit: estNonInscrits(organe?.sigle), promulgues: 0 });
    gsMap.get(key)!.promulgues += s.nb;
  }

  // Moyenne mensuelle depuis le début de la 17ᵉ législature (mois partiels inclus)
  const legStart = new Date(LEGISLATURE_17_START);
  const monthsSinceStart =
    (now.getFullYear() - legStart.getFullYear()) * 12 +
    (now.getMonth() - legStart.getMonth()) + 1;
  const avgMonthlyDeposits = monthsSinceStart > 0 ? Math.round(totalDeposited / monthsSinceStart) : 0;

  // Les non-inscrits ne forment pas un groupe (D-313) : leur barre reste, étiquetée de
  // sa chambre (les deux organes ont des libellés proches, « Non inscrit » à
  // l'Assemblée, « Non inscrits » au Sénat), mais elle ne se classe pas et vient après
  // tous les groupes. Reconnus par le sigle de l'organe, jamais par son libellé.
  const etiquetteGroupe = (g: { groupe: string; chambre: string; nonInscrit: boolean }) => {
    if (!g.nonInscrit) return g.groupe;
    return t(g.chambre === 'AN' ? 'libelleNonInscritsAN' : 'libelleNonInscritsSN');
  };
  const nonInscritsEnDernier = (a: { nonInscrit: boolean }, b: { nonInscrit: boolean }) =>
    Number(a.nonInscrit) - Number(b.nonInscrit);

  const groupeProposedData = [...gsProposedMap.values()]
    .filter((g) => g.total > 0)
    .sort((a, b) => nonInscritsEnDernier(a, b) || b.total - a.total)
    .map((g) => ({ groupe: etiquetteGroupe(g), value: g.total, ...(g.nonInscrit ? { fill: COLOR_NON_INSCRITS } : {}) }));

  const chartData = toChartData(monthlyCounts);
  const depositChartData = toChartData(monthlyDeposits);

  const groupeData = [...gsMap.values()]
    .filter((g) => g.promulgues > 0)
    .sort((a, b) => nonInscritsEnDernier(a, b) || b.promulgues - a.promulgues)
    .map((g) => ({ groupe: etiquetteGroupe(g), value: g.promulgues, ...(g.nonInscrit ? { fill: COLOR_NON_INSCRITS } : {}) }));

  const TOP_N = 6;
  const sortedTypes = Object.entries(typeCounts).sort(([, a], [, b]) => b - a);
  // Le comptage s'est fait sur le libellé brut ; la forme courte traduite
  // n'apparaît qu'ici, une fois les six premiers types retenus.
  const topTypes = sortedTypes.slice(0, TOP_N).map(([name, size]) => {
    const key = PROCEDURE_KEY[name];
    return { name: key ? tTypes(`short.${key}`) : name, size };
  });
  const autreSize = sortedTypes.slice(TOP_N).reduce((sum, [, v]) => sum + v, 0);
  const typeChartData = autreSize > 0 ? [...topTypes, { name: t('typeAutre'), size: autreSize }] : topTypes;

  // ── Rendu ───────────────────────────────────────────────────────────
  return (
    <div className="py-12">

      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#0d9488' }}>
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          totalDeposited: totalDeposited.toLocaleString(locale),
          total: totalPromulgables.toLocaleString(locale),
          count: promulgues.toLocaleString(locale),
          // Sans toLocaleString, le séparateur décimal reste le point : « 4.8 % » en français.
          rate: tauxPromulgation.toLocaleString(locale),
          // Le taux global mélange deux origines aux destins très différents : la
          // réponse les donne à part, lues par clé de procédure et non par libellé.
          rateProjets: (parProcedure.projetLoi?.taux ?? 0).toLocaleString(locale),
          ratePropositions: (parProcedure.propositionLoi?.taux ?? 0).toLocaleString(locale),
          hl: (chunks) => (
            <Surligne couleur="#0d9488">{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Funnel législatif */}
      <div className="mb-8">
        <LegislativeFunnel
          title={t('funnelTitle')}
          description={t('funnelDesc')}
          ofTotalLabel={(rate) => t('funnelOfTotal', { rate })}
          locale={locale}
          rateBaseIndex={1}
          steps={[
            { label: t('funnelStep1'), count: totalDeposited, description: '' },
            { label: t('funnelStep2'), count: totalPromulgables, description: '' },
            { label: t('funnelStep3'), count: adoptes, description: '' },
            { label: t('funnelStep4'), count: promulgues, description: '' },
          ]}
        />
        <p className="mt-3 text-sm text-muted-foreground text-center">
          <Link
            href="/Facts/taux-application"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            {t('funnelNoteApplication')}
          </Link>
        </p>
      </div>

      {/* Accordion À comprendre */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: '#0d9488' }}>
        {t('conceptsTitle')}
      </h2>
      <Accordion type="multiple" className="mb-12">

        <AccordionItem value="conceptPerimetre">
          <AccordionTrigger className="hover:no-underline">{t('conceptPerimetreTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptPerimetreDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="promulgation">
          <AccordionTrigger className="hover:no-underline">{t('whatIsPromulgationTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('whatIsPromulgationP1')}</p>
            <p className="text-foreground/80 leading-relaxed mt-2">{t('whatIsPromulgationP2')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="concept3">
          <AccordionTrigger className="hover:no-underline">{t('concept3Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept3Desc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="concept1">
          <AccordionTrigger className="hover:no-underline">{t('concept1Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t.rich('concept1Desc', {
                link: (chunks) => (
                  <Link href="/processus-legislatif" className="underline underline-offset-2 hover:opacity-70 transition-opacity">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="concept4">
          <AccordionTrigger className="hover:no-underline">{t('concept4Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t.rich('concept4Desc', {
                link: (chunks) => (
                  <Link href="/Facts/succes-legislatif/efficacite" className="underline underline-offset-2 hover:opacity-70 transition-opacity">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="concept2">
          <AccordionTrigger className="hover:no-underline">{t('concept2Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t.rich('concept2Desc', {
                link: (chunks) => (
                  <Link href="/processus-legislatif" className="underline underline-offset-2 hover:opacity-70 transition-opacity">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="concept5">
          <AccordionTrigger className="hover:no-underline">{t('concept5Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept5Desc')}</p>
          </AccordionContent>
        </AccordionItem>

      </Accordion>

      {/* ② EN CHIFFRES — Grille 2 colonnes desktop */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-8" style={{ color: '#0d9488' }}>
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('cardThisMonthTitle')}</CardTitle>
            <CardDescription>{t('cardThisMonthDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-primary">
              {depositsThisMonth.toLocaleString(locale)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('cardAvgMonthlyTitle')}</CardTitle>
            <CardDescription>{t('cardAvgMonthlyDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold text-primary">
              {avgMonthlyDeposits.toLocaleString(locale)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        <MonthlyDossiersChart
          data={depositChartData}
          title={t('depositChartTitle')}
          description={t('depositChartDescription')}
          tooltipLabel={t('depositChartTooltipLabel')}
          note={t('depositChartNote')}
        />
        <MonthlyDossiersChart
          data={chartData}
          title={t('chartTitle')}
          description={t('chartDescription')}
          tooltipLabel={t('chartTooltipLabel')}
          note={t('promulgationChartNote')}
        />
        <div className="md:col-span-2">
          <DonutChart
            data={typeChartData}
            title={t('typeChartTitle')}
            description={t('typeChartDesc')}
            tooltipLabel={t('typeChartLabel')}
            note={t('typeChartNote')}
            legendPosition="right"
          />
        </div>
        {groupeProposedData.length > 0 && (
          <GroupeBarChart
            data={groupeProposedData}
            title={t('groupeProposedChartTitle')}
            description={t('groupeProposedChartDesc')}
            color="var(--chart-1)"
            valueLabel={t('groupeProposedChartLabel')}
            note={t('groupeProposedChartNote')}
            labelWidth={270}
            labelMaxChars={34}
          />
        )}
        {groupeData.length > 0 && (
          <GroupeBarChart
            data={groupeData}
            title={t('groupeChartTitle')}
            description={t('groupeChartDesc')}
            color="var(--chart-5)"
            valueLabel={t('groupeChartLabel')}
            note={t('groupeChartNote')}
            labelWidth={270}
            labelMaxChars={34}
          />
        )}
      </div>

      {/* ③ MÉTHODOLOGIE */}
      <Separator className="mb-8" />
      <h2 id="methodologie" className="text-xs font-bold uppercase tracking-widest mb-5 scroll-mt-24" style={{ color: '#0d9488' }}>
        {t('methodologyTitle')}
      </h2>
      <div className="text-sm leading-relaxed text-foreground/80 space-y-4 mb-16">
        <p className="flex gap-3">
          <Target className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyPerimeter')}</span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyRate')}</span>
        </p>
        <p className="flex gap-3">
          <LineChart className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyCharts')}</span>
        </p>
        <p className="flex gap-3">
          <Users className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyGroups')}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimit')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color="#0d9488" currentHref="/Facts/taux-promulgation" locale={locale} />
    </div>
  );
}
