// Page `/Facts/delais` : durée du parcours d'une loi, du dépôt à l'adoption, puis à la
// promulgation, puis au dernier décret. Server Component statique. Les lois viennent de
// `getLoisPromulguees()` et `getTauxApplication()`, et le délai dépôt → promulgation
// comme l'attente des décrets de `delaisDepotPromulgation()` et `delaisDecrets()` :
// ce sont les chiffres de `/etat-des-lieux`. Seuls les délais par
// chambre et les actes passent par des lectures propres à la page.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { LEGISLATURE_17_START, PROCEDURE_KEY, isDecisionAN, isDecisionSN } from '@/lib/facts-shared';
import {
  delaisDecrets,
  delaisDepotPromulgation,
  getLoisPromulguees,
  getTauxApplication,
} from '@/lib/facts-queries';
import { boxStats, mean } from '@/lib/stats';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import { DonutChart } from '@/components/ui/DonutChart';
import { DelaiTimeline } from '@/components/ui/DelaiTimeline';
import { BoxPlotChart } from '@/components/ui/BoxPlotChart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Filter, AlertTriangle } from 'lucide-react';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerDelais' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/delais'),
    openGraph: buildOpenGraph(locale, '/Facts/delais', title, description),
  };
}

const COLOR = '#b45309';

const ACTES_CODES = [
  'AN1-DEPOT', 'AN2-DEPOT', 'ANLDEF-DEPOT', 'ANLUNI-DEPOT', 'ANNLEC-DEPOT',
  'AN1-DEBATS-DEC', 'AN2-DEBATS-DEC', 'ANLDEF-DEBATS-DEC', 'ANLUNI-DEBATS-DEC', 'ANNLEC-DEBATS-DEC',
  'CMP-DEBATS-AN-DEC',
  'SN1-DEPOT', 'SN2-DEPOT', 'SNNLEC-DEPOT',
  'SN1-DEBATS-DEC', 'SN2-DEBATS-DEC', 'SNNLEC-DEBATS-DEC',
  'CMP-DEBATS-SN-DEC',
];

const estAdopte = (s: string | null) =>
  !!s && (s.toLowerCase().includes('adopt') || s.toLowerCase().includes('modifi') || s.toLowerCase().includes('définitiv'));

export default async function AnswerDelaisPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerDelais' });
  const tTypes = await getTranslations({ locale, namespace: 'textTypes' });

  // ── Requêtes en parallèle ───────────────────────────────────────────
  // Deux populations. Les lois promulguées depuis le 18 juillet 2024, quelle que
  // soit la date de dépôt de leur texte, pour tout ce qui porte sur des lois.
  // Les textes déposés depuis cette date, promulgués ou non, pour les seuls délais
  // par chambre, qui mesurent l'examen de tous les textes.
  const [lois, application, dossiersCohorte] = await Promise.all([
    getLoisPromulguees(),
    getTauxApplication(),
    // `uid` en second critère de tri : `date_depot` a des ex æquo, et sans
    // départage leur ordre suivrait le plan d'exécution.
    sql<{ uid: string }[]>`
      select uid
      from dossiers_legislatifs
      where date_depot >= ${LEGISLATURE_17_START}
      order by date_depot desc, uid`,
  ]);
  const applicationData = application.lois;

  // Actes des deux populations, en une lecture. Leur ordre n'a pas d'effet : les
  // calculs qui suivent ne gardent que la date la plus ancienne ou la plus récente
  // de chaque dossier.
  const uidsCohorte = new Set(dossiersCohorte.map((d) => d.uid));
  const dossierUids = [...new Set([...uidsCohorte, ...lois.map((d) => d.uid)])];
  const actes = await sql<{ dossier_uid: string; date_acte: string; code_acte: string; statut_conclusion: string | null }[]>`
    select dossier_uid, date_acte, code_acte, statut_conclusion
    from actes_legislatifs
    where code_acte = any(${ACTES_CODES})
      and dossier_uid = any(${dossierUids})
      and date_acte is not null`;

  // ── Calcul des délais par chambre ──────────────────────────────────
  const dossiersUidsSet = new Set(dossierUids);
  const depotsAN = new Map<string, Date>();
  const decisionsAN = new Map<string, Date>();
  const depotsSN = new Map<string, Date>();
  const decisionsSN = new Map<string, Date>();

  for (const acte of actes) {
    if (!dossiersUidsSet.has(acte.dossier_uid)) continue;
    const date = new Date(acte.date_acte);
    if (isNaN(date.getTime())) continue;
    const { dossier_uid, code_acte, statut_conclusion } = acte;
    if (code_acte.startsWith('AN') && code_acte.endsWith('DEPOT')) {
      // Dépôt = PREMIÈRE date (la plus ancienne)
      if (!depotsAN.has(dossier_uid) || date < depotsAN.get(dossier_uid)!) depotsAN.set(dossier_uid, date);
    } else if (isDecisionAN(code_acte) && estAdopte(statut_conclusion)) {
      // Décision = DERNIÈRE date adoptée (capture navette complète + CMP + lecture définitive)
      if (!decisionsAN.has(dossier_uid) || date > decisionsAN.get(dossier_uid)!) decisionsAN.set(dossier_uid, date);
    } else if (code_acte.startsWith('SN') && code_acte.endsWith('DEPOT')) {
      // Dépôt = PREMIÈRE date
      if (!depotsSN.has(dossier_uid) || date < depotsSN.get(dossier_uid)!) depotsSN.set(dossier_uid, date);
    } else if (isDecisionSN(code_acte) && estAdopte(statut_conclusion)) {
      // Décision = DERNIÈRE date adoptée (même règle qu'à l'AN)
      if (!decisionsSN.has(dossier_uid) || date > decisionsSN.get(dossier_uid)!) decisionsSN.set(dossier_uid, date);
    }
  }

  // Adoption finale du Parlement : dernière décision adoptée (AN ou SN).
  // Cette map inclut des textes adoptés par une seule chambre — on s'en sert
  // pour les délais par chambre, mais pas comme filtre de la frise.
  const adoptionFinale = new Map<string, Date>();
  for (const [uid, d] of decisionsAN) adoptionFinale.set(uid, d);
  for (const [uid, d] of decisionsSN) {
    const existing = adoptionFinale.get(uid);
    if (!existing || d > existing) adoptionFinale.set(uid, d);
  }

  // Étape 1 de la frise, sur les seules lois promulguées (`getLoisPromulguees`) :
  // un texte adopté par une seule chambre ne compte pas comme adopté par le
  // Parlement.
  const delaisDepotAdoption: number[] = [];
  for (const d of lois) {
    if (!d.date_depot) continue;
    const adoption = adoptionFinale.get(d.uid);
    if (!adoption) continue;
    const depot = new Date(d.date_depot);
    if (adoption > depot) delaisDepotAdoption.push((adoption.getTime() - depot.getTime()) / 86400000);
  }
  const moyenneDepotAdoption = mean(delaisDepotAdoption);
  const nbDepotAdoption = delaisDepotAdoption.length;

  // Délais par chambre : tous les dossiers qui ont un dépôt + une décision adoptée
  // dans cette chambre (périmètres AN et Sénat distincts — voir la note du graphique).
  // Les actes lus couvrent aussi les lois déposées avant juillet 2024, utiles à la
  // frise : les délais par chambre, eux, ne gardent que les textes déposés depuis.
  const calcDelaisChambre = (depots: Map<string, Date>, decisions: Map<string, Date>): number[] => {
    const delais: number[] = [];
    for (const [uid, depot] of depots) {
      if (!uidsCohorte.has(uid)) continue;
      const decision = decisions.get(uid);
      if (decision && decision > depot) {
        delais.push((decision.getTime() - depot.getTime()) / 86400000);
      }
    }
    return delais;
  };

  const delaisAN = calcDelaisChambre(depotsAN, decisionsAN);
  const delaisSN = calcDelaisChambre(depotsSN, decisionsSN);

  // Statistiques de distribution (min, Q1, médiane, Q3, max) pour le boxplot
  const statsAN = boxStats(delaisAN);
  const statsSN = boxStats(delaisSN);

  // Adoption → promulgation : calcul direct par loi
  // (date_promulgation − date d'adoption finale du Parlement)
  const delaisAdoptionPromulg: number[] = [];
  for (const d of lois) {
    if (!d.date_promulgation) continue;
    const adoption = adoptionFinale.get(d.uid);
    if (!adoption) continue;
    const promulg = new Date(d.date_promulgation);
    const jours = (promulg.getTime() - adoption.getTime()) / 86400000;
    if (jours > 0) delaisAdoptionPromulg.push(jours);
  }
  const moyenneAdoptionPromulg = mean(delaisAdoptionPromulg);
  const nbAdoptionPromulg = delaisAdoptionPromulg.length;

  // Dépôt → promulgation, le chiffre qu'affiche aussi `/etat-des-lieux` : même
  // helper, même population.
  const delaisDepotPromulg = delaisDepotPromulgation(lois);
  const moyenneDepotPromulg = mean(delaisDepotPromulg);
  const nbDepotPromulg = delaisDepotPromulg.length;

  // ── Délai promulgation → application complète ──────────────────────
  // Map dossier_uid → date_depot et procédure, pour les lois suivies
  const dossierDepotMap = new Map<string, Date>();
  const dossierProcedureMap = new Map<string, string>();
  for (const d of lois) {
    if (d.date_depot) dossierDepotMap.set(d.uid, new Date(d.date_depot));
    if (d.procedure_libelle) dossierProcedureMap.set(d.uid, d.procedure_libelle);
  }

  // `delaisDecrets`, comme `/etat-des-lieux` : les deux pages portent le même chiffre.
  const delaisAppli = delaisDecrets(applicationData);
  const moyennePromulgAppli = mean(delaisAppli);
  const nbPromulgAppli = delaisAppli.length;

  // ── Délai TOTAL : dépôt → application effective ────────────────────

  // Lois nécessitant des décrets et pleinement appliquées :
  // total = (date_publication − date_depot) + delai_max_jours
  const delaisTotalDecrets: number[] = [];
  for (const a of applicationData) {
    if (a.statut_application !== 'appliquee') continue;
    if (typeof a.delai_max_jours !== 'number') continue;
    if (!a.dossier_uid || !a.date_publication) continue;
    const depot = dossierDepotMap.get(a.dossier_uid);
    if (!depot) continue;
    const pub = new Date(a.date_publication);
    const depotPub = (pub.getTime() - depot.getTime()) / 86400000;
    if (depotPub <= 0) continue;
    delaisTotalDecrets.push(depotPub + a.delai_max_jours);
  }
  const moyenneTotalDecrets = mean(delaisTotalDecrets);
  const nbTotalDecrets = delaisTotalDecrets.length;

  // Lois d'application directe : total = date_publication − date_depot
  const delaisTotalDirecte: number[] = [];
  for (const a of applicationData) {
    if (a.statut_application !== 'application_directe') continue;
    if (!a.dossier_uid || !a.date_publication) continue;
    const depot = dossierDepotMap.get(a.dossier_uid);
    if (!depot) continue;
    const pub = new Date(a.date_publication);
    const jours = (pub.getTime() - depot.getTime()) / 86400000;
    if (jours > 0) delaisTotalDirecte.push(jours);
  }
  const moyenneTotalDirecte = mean(delaisTotalDirecte);
  const nbTotalDirecte = delaisTotalDirecte.length;

  // ── Délais par type de texte (dépôt → application effective) ──────
  const parTypeMap = new Map<string, { label: string; jours: number[] }>();
  for (const a of applicationData) {
    if (!a.dossier_uid || !a.date_publication) continue;
    const depot = dossierDepotMap.get(a.dossier_uid);
    const libelle = dossierProcedureMap.get(a.dossier_uid);
    if (!depot || !libelle) continue;
    const pub = new Date(a.date_publication);
    const depotPub = (pub.getTime() - depot.getTime()) / 86400000;
    if (depotPub <= 0) continue;

    let jours: number | null = null;
    if (a.statut_application === 'appliquee' && typeof a.delai_max_jours === 'number') {
      jours = depotPub + a.delai_max_jours;
    } else if (a.statut_application === 'application_directe') {
      jours = depotPub;
    }
    if (jours === null) continue;

    // Regroupement sur la clé de procédure, le libellé traduit voyageant à côté :
    // c'est ce qui garantit une composition de groupes identique dans les deux
    // langues. Une procédure absente de la table sort avec son libellé officiel.
    const procKey = PROCEDURE_KEY[libelle];
    const key = procKey ?? libelle;
    if (!parTypeMap.has(key)) {
      parTypeMap.set(key, { label: procKey ? tTypes(`short.${procKey}`) : libelle, jours: [] });
    }
    parTypeMap.get(key)!.jours.push(jours);
  }
  const typeChartData = [...parTypeMap.values()]
    .map((e) => ({
      groupe: `${e.label} (${e.jours.length})`,
      value: mean(e.jours),
    }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

  // ── Délais par chambre : distribution (boxplot) ────────────────────
  const chambreBoxData = [
    { label: t('chambreAN'), ...statsAN },
    { label: t('chambreSN'), ...statsSN },
  ].filter((x) => x.count > 0);

  // ── Donut : tranches de délai dépôt→application effective ─────────
  const delaisApplicationTotal = [...delaisTotalDecrets, ...delaisTotalDirecte];
  const tranches = { lt6: 0, m6_12: 0, y1_2: 0, y2_3: 0, gt3: 0 };
  for (const j of delaisApplicationTotal) {
    if (j < 180) tranches.lt6++;
    else if (j < 365) tranches.m6_12++;
    else if (j < 730) tranches.y1_2++;
    else if (j < 1095) tranches.y2_3++;
    else tranches.gt3++;
  }
  const trancheChartData = [
    { name: t('tranche1'), size: tranches.lt6 },
    { name: t('tranche2'), size: tranches.m6_12 },
    { name: t('tranche3'), size: tranches.y1_2 },
    { name: t('tranche4'), size: tranches.y2_3 },
    { name: t('tranche5'), size: tranches.gt3 },
  ].filter((x) => x.size > 0);

  // ── Top 5 lois les plus longues à appliquer après promulgation ────
  const topLentes = applicationData
    .filter(
      (a) =>
        a.statut_application === 'appliquee' &&
        typeof a.delai_max_jours === 'number' &&
        (a.delai_max_jours ?? 0) > 0 &&
        a.dossier_uid &&
        dossierDepotMap.has(a.dossier_uid)
    )
    .map((a) => ({
      titre: titreDossier(a, locale) || a.jorftext_id,
      traduit: titreTraduit(a, locale),
      jours: a.delai_max_jours as number,
    }))
    .sort((a, b) => b.jours - a.jours)
    .slice(0, 5);

  // ── Rendu ──────────────────────────────────────────────────────────
  return (
    <div className="py-12">

      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLOR }}>
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          depotPromulgation: moyenneDepotPromulg.toLocaleString(locale),
          nbDepotPromulgation: nbDepotPromulg,
          adoption: moyenneDepotAdoption.toLocaleString(locale),
          promulgation: moyenneAdoptionPromulg.toLocaleString(locale),
          application: moyennePromulgAppli.toLocaleString(locale),
          // Brut : le message le passe par un pluriel ICU. L'attente des décrets ne
          // repose que sur les lois dont tous les décrets sont pris, bien moins
          // nombreuses : la réponse le dit à côté du chiffre.
          nbApplication: nbPromulgAppli,
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Timeline horizontale */}
      <div className="mb-8">
        <DelaiTimeline
          title={t('timelineTitle')}
          description={t('timelineDesc')}
          daysSuffix={t('daysSuffix')}
          tickLabels={[t('tickDepot'), t('tickAdoption'), t('tickPromulgation'), t('tickApplicable')]}
          locale={locale}
          color={COLOR}
          steps={[
            {
              label: t('timelineStep1'),
              sample: t('timelineSample1', { count: nbDepotAdoption }),
              days: moyenneDepotAdoption,
            },
            {
              label: t('timelineStep2'),
              sample: t('timelineSample2', { count: nbAdoptionPromulg }),
              days: moyenneAdoptionPromulg,
            },
            {
              label: t('timelineStep3'),
              sample: t('timelineSample3', { count: nbPromulgAppli }),
              days: moyennePromulgAppli,
            },
          ]}
          note={t('timelineNote')}
        />
      </div>

      {/* Deux cards : délai total selon le type d'application */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        <Card>
          <CardHeader>
            <CardTitle>{t('totalDecretsTitle')}</CardTitle>
            <CardDescription>{t('totalDecretsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-5xl font-bold tabular-nums" style={{ color: COLOR }}>
                {moyenneTotalDecrets.toLocaleString(locale)}
              </span>
              <span className="text-xl text-muted-foreground">{t('daysFull')}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('totalDecretsSample', { count: nbTotalDecrets })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('totalDirecteTitle')}</CardTitle>
            <CardDescription>{t('totalDirecteDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col justify-center">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-5xl font-bold tabular-nums" style={{ color: COLOR }}>
                {moyenneTotalDirecte.toLocaleString(locale)}
              </span>
              <span className="text-xl text-muted-foreground">{t('daysFull')}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('totalDirecteSample', { count: nbTotalDirecte })}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Accordion À comprendre */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: COLOR }}>
        {t('conceptsTitle')}
      </h2>
      <Accordion type="multiple" className="mb-12">

        <AccordionItem value="perimetre">
          <AccordionTrigger className="hover:no-underline">{t('conceptPerimetreTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptPerimetreDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="duree">
          <AccordionTrigger className="hover:no-underline">{t('conceptDureeTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptDureeDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="depotAdoption">
          <AccordionTrigger className="hover:no-underline">{t('conceptDepotAdoptionTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptDepotAdoptionDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="quinzeJours">
          <AccordionTrigger className="hover:no-underline">{t('concept15JoursTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept15JoursDesc', { jours: moyenneAdoptionPromulg.toLocaleString(locale) })}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="decrets">
          <AccordionTrigger className="hover:no-underline">{t('conceptDecretsTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t.rich('conceptDecretsDesc', {
                link: (chunks) => (
                  <Link href="/Facts/taux-application" className="underline underline-offset-2 hover:opacity-70 transition-opacity">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="moyenne">
          <AccordionTrigger className="hover:no-underline">{t('conceptMedianeTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptMedianeDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="acceleree">
          <AccordionTrigger className="hover:no-underline">{t('conceptAccelereeTitle')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptAccelereeDesc')}</p>
          </AccordionContent>
        </AccordionItem>

      </Accordion>

      {/* ② EN CHIFFRES */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-8" style={{ color: COLOR }}>
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        {chambreBoxData.length > 0 && (
          <BoxPlotChart
            data={chambreBoxData}
            title={t('chambreChartTitle')}
            description={t('chambreChartDesc')}
            unit={t('daysSuffix')}
            locale={locale}
            color={COLOR}
            countLabel={t('boxCountLabel')}
            note={t('chambreChartNote')}
          />
        )}

        {typeChartData.length > 0 && (
          <GroupeBarChart
            data={typeChartData}
            title={t('typeChartTitle')}
            description={t('typeChartDesc')}
            color={COLOR}
            valueLabel={t('typeChartLabel')}
            note={t('typeChartNote')}
          />
        )}

        {topLentes.length > 0 && (
          <Card>
            <CardHeader>
              {/* Badge IA des titres de lois traduits (sur /en), en tête de la liste. */}
              <CardTitle>{t('topLentesTitle')}{topLentes.some((l) => l.traduit) && <span style={{ marginLeft: '8px', verticalAlign: '2px' }}><AIBadgeTitre pluriel /></span>}</CardTitle>
              <CardDescription>{t('topLentesDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-4">
                {topLentes.map((loi, i: number) => (
                  <li key={i} className="flex gap-3 items-start">
                    <span className="text-xs font-medium text-muted-foreground mt-0.5 w-5 shrink-0 text-right">{i + 1}</span>
                    <p className="flex-1 text-sm leading-relaxed min-w-0">{loi.titre}</p>
                    <span
                      className="text-xs tabular-nums shrink-0 mt-0.5 font-semibold"
                      style={{ color: COLOR }}
                    >
                      {loi.jours} {t('daysSuffix')}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
            <div className="border-t px-6 py-4">
              <p className="text-sm text-foreground/70 leading-relaxed">{t('topLentesNote')}</p>
            </div>
          </Card>
        )}

        {trancheChartData.length > 0 && (
          <DonutChart
            data={trancheChartData}
            title={t('trancheChartTitle')}
            description={t('trancheChartDesc')}
            tooltipLabel={t('trancheChartLabel')}
            note={t('trancheChartNote')}
            colors={['#fde68a', '#fcd34d', '#f59e0b', '#b45309', '#78350f']}
          />
        )}
      </div>

      {/* ③ MÉTHODOLOGIE */}
      <Separator className="mb-8" />
      <h2 id="methodologie" className="text-xs font-bold uppercase tracking-widest mb-5 scroll-mt-24" style={{ color: COLOR }}>
        {t('methodologyTitle')}
      </h2>
      <div className="text-sm leading-relaxed text-foreground/80 space-y-4 mb-16">
        <p className="flex gap-3">
          <Target className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyPerimeter')}</span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyMediane')}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyExclusions')}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimit')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Facts/delais" locale={locale} />
    </div>
  );
}
