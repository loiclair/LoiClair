// Page `/Facts/taux-application` : part des lois promulguées depuis juillet 2024
// pleinement appliquées, et quand elles le sont devenues. Server Component statique.
// Les taux viennent de `getTauxApplication()`, partagé avec `/etat-des-lieux` et la
// landing ; les dates d'application, des actes `AN-APPLI-*`. Le taux écarte les lois
// de moins de 6 mois, le donut et les graphiques les gardent.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { getTauxApplication } from '@/lib/facts-queries';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { DonutChart } from '@/components/ui/DonutChart';
import { MonthlyDossiersChart } from '@/components/ui/MonthlyDossiersChart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Scale, ListChecks, AlertTriangle } from 'lucide-react';

import type { Metadata } from 'next';
import { formateurDate } from '@/lib/jour-paris';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerApplication' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/taux-application'),
    openGraph: buildOpenGraph(locale, '/Facts/taux-application', title, description),
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function AnswerApplicationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const t = await getTranslations({ locale, namespace: 'answerApplication' });

  const {
    lois,
    totalLois,
    loisApplicationDirecte,
    loisAppliquees,
    loisPartiellementAppliquees,
    loisNonAppliquees,
    totalMesuresAttendues,
    totalMesuresAppliquees,
    plusDeSixMois,
    loisRecentes,
    tauxApplication,
    tauxMesures,
  } = await getTauxApplication();

  // Récupérer les actes d'application (directe + complète) pour savoir QUAND chaque loi
  // est devenue appliquée, sur les dossiers des lois suivies. Jusqu'au 2026-09-15, la
  // page lisait les actes de tous les dossiers déposés depuis juillet 2024 ; elle suit
  // désormais le périmètre des lois de `getTauxApplication`.
  const dossierUidsList = lois.map((l) => l.dossier_uid).filter((u): u is string => u !== null);
  const actesAppli = await sql<{ dossier_uid: string; date_acte: string; code_acte: string }[]>`
    select dossier_uid, date_acte, code_acte
    from actes_legislatifs
    where code_acte = any(${['AN-APPLI-DIRECTE', 'AN-APPLI-COMPLETE']})
      and dossier_uid = any(${dossierUidsList})
      and date_acte is not null`;

  // Le taux et sa réponse portent sur les lois de plus de 6 mois (`plusDeSixMois`) ;
  // le donut, les trimestres et le classement gardent toutes les lois, récentes
  // comprises, pour qu'une loi de l'été reste visible quelque part.
  const appliqueesTaux = plusDeSixMois.applicationDirecte + plusDeSixMois.appliquees;

  // ── Donut chart (3 catégories) ─────────────────────────────────────
  // Appliquées = appliquee + application_directe
  const loisPleinementAppliquees = loisAppliquees + loisApplicationDirecte;
  const donutData = [
    { name: t('donutSliceApplied'), size: loisPleinementAppliquees },
    { name: t('donutSlicePartial'), size: loisPartiellementAppliquees },
    { name: t('donutSliceNone'), size: loisNonAppliquees },
  ].filter((d) => d.size > 0);

  // ── Historique depuis le début de la 17ᵉ législature (juillet 2024) ─
  const now = new Date();
  const startDate = new Date(2024, 6, 1); // juillet 2024
  const endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const initMonthlyCounts = () => {
    const counts: Record<string, number> = {};
    for (let d = new Date(startDate); d < endDate; d.setMonth(d.getMonth() + 1)) {
      counts[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`] = 0;
    }
    return counts;
  };

  // Lois devenues pleinement appliquées par mois — on utilise la date réelle
  // d'application (acte AN-APPLI-DIRECTE ou AN-APPLI-COMPLETE)
  const monthlyApplied = initMonthlyCounts();
  actesAppli.forEach((a) => {
    if (!a.date_acte) return;
    const date = new Date(a.date_acte);
    if (isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (monthlyApplied[key] !== undefined) monthlyApplied[key]++;
  });
  const appliedChartData = Object.entries(monthlyApplied)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mois, count]) => {
      const [year, month] = mois.split('-').map(Number);
      const monthName = formateurDate(locale, { month: 'short' }).format(
        new Date(year, month - 1)
      );
      return { month: `${monthName}-${year}`, dossiers: count };
    });

  // ── Taux d'application par trimestre de promulgation ──────────────
  // Montre comment les lois "mûrissent" : les plus anciennes ont un meilleur taux
  // car le gouvernement a eu plus de temps pour publier les décrets.
  // Les lois "sans_objet" (sans échéancier publié) sont comptées comme non
  // appliquées : elles nécessitent des décrets, ils n'ont juste pas encore été
  // recensés par le baromètre.
  const trimestreStats: Record<string, { attendues: number; appliquees: number; nbLois: number; label: string }> = {};
  const TRIMESTRE_LABELS: Record<number, string> = locale === 'en'
    ? { 0: 'Jan–Mar', 1: 'Apr–Jun', 2: 'Jul–Sep', 3: 'Oct–Dec' }
    : { 0: 'Janv.–Mars', 1: 'Avr.–Juin', 2: 'Juil.–Sept.', 3: 'Oct.–Déc.' };
  const trimestreLabel = (d: Date): { key: string; label: string } => {
    const year = d.getFullYear();
    const q = Math.floor(d.getMonth() / 3);
    return {
      key: `${year}-${q}`,
      label: `${TRIMESTRE_LABELS[q]} ${year}`,
    };
  };
  lois.forEach((loi) => {
    if (!loi.date_publication) return;
    const date = new Date(loi.date_publication);
    if (isNaN(date.getTime())) return;
    const { key, label } = trimestreLabel(date);
    if (!trimestreStats[key]) trimestreStats[key] = { attendues: 0, appliquees: 0, nbLois: 0, label };
    trimestreStats[key].nbLois++;

    if (loi.statut_application === 'application_directe') {
      // Application directe : 1 "mesure" virtuelle, comptée comme appliquée
      trimestreStats[key].attendues += 1;
      trimestreStats[key].appliquees += 1;
    } else if (loi.statut_application === 'sans_objet') {
      // Sans échéancier publié : on sait qu'il faudra des décrets, on ignore combien.
      // On compte 1 mesure attendue (non appliquée) comme proxy minimal.
      trimestreStats[key].attendues += 1;
    } else {
      trimestreStats[key].attendues += loi.nb_mesures_attendues || 0;
      trimestreStats[key].appliquees += loi.nb_mesures_appliquees || 0;
    }
  });
  const trimestreChartData = Object.entries(trimestreStats)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, stats]) => ({
      groupe: stats.label,
      value: stats.attendues > 0
        ? Math.round((stats.appliquees * 100) / stats.attendues)
        : 0,
      nbLois: stats.nbLois,
    }));

  // ── Top 10 lois avec le plus de mesures non appliquées ─────────────
  const topNonApplied = lois
    .filter((loi) => {
      const attendues = loi.nb_mesures_attendues || 0;
      const appliquees = loi.nb_mesures_appliquees || 0;
      return attendues > 0 && attendues - appliquees > 0;
    })
    .map((loi) => ({
      titre: titreDossier(loi, locale) || loi.jorftext_id,
      traduit: titreTraduit(loi, locale),
      attendues: loi.nb_mesures_attendues || 0,
      appliquees: loi.nb_mesures_appliquees || 0,
      manquantes: (loi.nb_mesures_attendues || 0) - (loi.nb_mesures_appliquees || 0),
    }))
    .sort((a, b) => b.manquantes - a.manquantes)
    .slice(0, 15);

  const loisNecessitantDecrets = totalLois - loisApplicationDirecte;
  const tauxNecessitantDecrets =
    totalLois > 0
      ? Math.round((loisNecessitantDecrets * 1000) / totalLois) / 10
      : 0;

  // ── Rendu ──────────────────────────────────────────────────────────
  return (
    <div className="py-12">

      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: '#2563eb' }}>
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          totalLois: plusDeSixMois.lois.toLocaleString(locale),
          appliquees: appliqueesTaux.toLocaleString(locale),
          applicationDirecte: plusDeSixMois.applicationDirecte.toLocaleString(locale),
          totalementAppliquees: plusDeSixMois.appliquees.toLocaleString(locale),
          // Nombres bruts : le message les passe par un pluriel ICU.
          enAttente: plusDeSixMois.enAttente,
          sansEcheancier: plusDeSixMois.sansEcheancier,
          recentes: loisRecentes,
          // Le taux porte une décimale : sans toLocaleString le séparateur reste
          // le point, donc « 57.3 % » au lieu de « 57,3 % » en français.
          tauxApplication: tauxApplication.toLocaleString(locale),
          hl: (chunks) => (
            <Surligne couleur="#2563eb">{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Accordion À comprendre */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: '#2563eb' }}>
        {t('conceptsTitle')}
      </h2>
      <Accordion type="multiple" className="mb-12">

        <AccordionItem value="conceptPerimetre">
          <AccordionTrigger className="hover:no-underline">{t('conceptPerimetreTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptPerimetreDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="concept1">
          <AccordionTrigger className="hover:no-underline">{t('concept1Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept1Desc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="concept2">
          <AccordionTrigger className="hover:no-underline">{t('concept2Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept2Desc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="concept4">
          <AccordionTrigger className="hover:no-underline">{t('concept4Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t.rich('concept4Desc', {
                link: (chunks) => (
                  <Link href="/Facts/taux-promulgation" className="underline underline-offset-2 hover:opacity-70 transition-opacity">
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

      {/* ② EN CHIFFRES — Grille 2 colonnes */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-8" style={{ color: '#2563eb' }}>
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        {/* 1. Donut — Répartition par statut */}
        <DonutChart
          data={donutData}
          title={t('donutTitle')}
          description={t('donutDesc')}
          tooltipLabel={t('donutLabel')}
          note={t('donutNote')}
          colors={['#2563eb', '#60a5fa', '#94a3b8']}
        />

        {/* 2. Stack vertical : Taux d'application + Mesures */}
        <div className="flex flex-col gap-6">
          {/* Carte principale : Taux d'application */}
          <Card className="flex-1 flex flex-col">
            <CardHeader>
              <CardTitle>{t('tauxCardTitle')}</CardTitle>
              <CardDescription>{t('tauxCardDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-center">
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-5xl font-bold tabular-nums" style={{ color: '#2563eb' }}>
                  {tauxApplication.toLocaleString(locale)}
                  <span className="text-2xl">&nbsp;%</span>
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {appliqueesTaux.toLocaleString(locale)} / {plusDeSixMois.lois.toLocaleString(locale)}
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(tauxApplication, 100)}%`,
                    backgroundColor: '#2563eb',
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {t('tauxCardFormula', {
                  directe: plusDeSixMois.applicationDirecte.toLocaleString(locale),
                  appliquees: plusDeSixMois.appliquees.toLocaleString(locale),
                  total: plusDeSixMois.lois.toLocaleString(locale),
                })}
              </p>
            </CardContent>
          </Card>

          {/* Mesures d'application (complémentaire) */}
          <Card className="flex-1 flex flex-col">
            <CardHeader>
              <CardTitle>{t('gaugeTitle')}</CardTitle>
              <CardDescription>{t('gaugeDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-center">
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-5xl font-bold tabular-nums" style={{ color: '#2563eb' }}>
                  {tauxMesures.toLocaleString(locale)}
                  <span className="text-2xl">&nbsp;%</span>
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {totalMesuresAppliquees.toLocaleString(locale)} / {totalMesuresAttendues.toLocaleString(locale)}
                </span>
              </div>
              <div className="h-3 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(tauxMesures, 100)}%`,
                    backgroundColor: '#2563eb',
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 3. Top 10 lois non appliquées */}
        {topNonApplied.length > 0 && (
          <Card>
            <CardHeader>
              {/* Badge IA des titres de lois traduits (sur /en), en tête de la liste. */}
              <CardTitle>{t('topNonAppliedTitle')}{topNonApplied.some((l) => l.traduit) && <span style={{ marginLeft: '8px', verticalAlign: '2px' }}><AIBadgeTitre pluriel /></span>}</CardTitle>
              <CardDescription>{t('topNonAppliedDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {topNonApplied.map((loi, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="text-xs font-medium text-muted-foreground mt-0.5 w-5 shrink-0 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed mb-1.5">{loi.titre}</p>
                      <div className="flex items-center gap-2">
                        <div className="h-2 rounded-full bg-red-100 dark:bg-red-950 overflow-hidden flex-1">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${loi.attendues > 0 ? (loi.appliquees / loi.attendues) * 100 : 0}%`,
                              backgroundColor: '#2563eb',
                            }}
                          />
                        </div>
                        <span className="text-xs tabular-nums shrink-0 text-right text-muted-foreground">
                          {loi.appliquees}/{loi.attendues} · <span style={{ color: '#dc2626' }}>{t('topNonAppliedPending', { count: loi.manquantes })}</span>
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted-foreground mt-6">{t('topNonAppliedNote')}</p>
            </CardContent>
          </Card>
        )}

        {/* 4. Stack vertical : Lois nécessitant des décrets + Taux par trimestre + Lois appliquées par mois */}
        {trimestreChartData.length > 0 && (
          <div className="flex flex-col gap-6 h-full">
            <Card>
              <CardHeader>
                <CardTitle>{t('decretsCardTitle')}</CardTitle>
                <CardDescription>{t('decretsCardDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-center">
                <div className="flex items-baseline justify-between">
                  <span className="text-5xl font-bold tabular-nums" style={{ color: '#2563eb' }}>
                    {tauxNecessitantDecrets.toLocaleString(locale)}
                    <span className="text-2xl">&nbsp;%</span>
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {loisNecessitantDecrets.toLocaleString(locale)} / {totalLois.toLocaleString(locale)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-3">{t('decretsCardNote')}</p>
              </CardContent>
            </Card>

            <Card className="flex-1 flex flex-col">
              <CardHeader>
                <CardTitle>{t('trimestreTitle')}</CardTitle>
                <CardDescription>{t('trimestreDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  {trimestreChartData.map((trim, i) => (
                    <div key={i}>
                      <div className="flex items-baseline justify-between gap-2 mb-1">
                        <span className="text-sm font-medium tabular-nums">{trim.groupe}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {pourcent.format(trim.value / 100)} · {t('trimLoisCount', { count: trim.nbLois })}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${trim.value}%`,
                            backgroundColor: '#2563eb',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-6">{t('trimestreNote')}</p>
              </CardContent>
            </Card>

            <MonthlyDossiersChart
              data={appliedChartData}
              title={t('monthlyAppliedTitle')}
              description={t('monthlyAppliedDesc')}
              tooltipLabel={t('monthlyAppliedTooltip')}
              note={t('monthlyAppliedNote')}
            />
          </div>
        )}

      </div>

      {/* ③ MÉTHODOLOGIE */}
      <Separator className="mb-8" />
      <h2 id="methodologie" className="text-xs font-bold uppercase tracking-widest mb-5 scroll-mt-24" style={{ color: '#2563eb' }}>
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
          <Scale className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyComparison')}</span>
        </p>
        <p className="flex gap-3">
          <ListChecks className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyMeasures')}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimit')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color="#2563eb" currentHref="/Facts/taux-application" locale={locale} />
    </div>
  );
}
