// Page `/Facts/loyaute` : part des votes d'un parlementaire qui suivent la position
// majoritaire de son groupe. Server Component statique. Parlementaires et moyennes
// viennent de `getLoyauteMoyennes()`, partagé avec le serveur MCP ; les groupes et leur
// cohésion interne, de `organes`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import { BoxPlotChart } from '@/components/ui/BoxPlotChart';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Filter, Scale, AlertTriangle } from 'lucide-react';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { LoyauteSearch, type LoyauteSearchEntry } from '@/components/ui/LoyauteSearch';
import { getLoyauteMoyennes, type LoyauteActeur } from '@/lib/facts-queries';
import { boxStats } from '@/lib/stats';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerLoyaute' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/loyaute'),
    openGraph: buildOpenGraph(locale, '/Facts/loyaute', title, description),
  };
}

const COLOR = '#0891b2';
/**
 * Nombre minimal de scrutins tenus pendant le mandat pour figurer dans les
 * classements et la recherche. À 10, un élu pouvait être premier ou dernier de
 * liste sur une poignée de votes ; même seuil que /Facts/participation. Il est
 * passé aux textes (`{min}`) pour que la page ne puisse pas annoncer un autre
 * chiffre que celui du calcul.
 */
const MIN_SCRUTINS = 50;

export default async function LoyautePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const t = await getTranslations({ locale, namespace: 'answerLoyaute' });

  // Parlementaires et moyennes viennent du helper partagé avec le serveur MCP : les
  // deux doivent donner le même taux de loyauté.
  const { deputes, senateurs, tauxAN, tauxSN, meanAN, meanSN } = await getLoyauteMoyennes();

  // ── Organes (groupes) ────────────────────────────────────────────────
  const groupeUids = new Set<string>();
  [...deputes, ...senateurs].forEach((a) => {
    if (a.groupe) groupeUids.add(a.groupe);
  });

  type OrganeInfo = {
    libelle: string;
    couleur: string | null;
    tauxCohesion: number | null;
  };
  const organesMap = new Map<string, OrganeInfo>();

  if (groupeUids.size > 0) {
    const organesData = await sql<{
      uid: string;
      libelle: string | null;
      libelle_abrege: string | null;
      couleur_associee: string | null;
      taux_cohesion_interne: number | null;
    }[]>`
      select uid, libelle, libelle_abrege, couleur_associee, taux_cohesion_interne
      from organes
      where uid = any(${Array.from(groupeUids)})`;
    organesData.forEach(
      (o: {
        uid: string;
        libelle: string | null;
        libelle_abrege: string | null;
        couleur_associee: string | null;
        taux_cohesion_interne: number | null;
      }) => {
        organesMap.set(o.uid, {
          libelle: o.libelle || o.libelle_abrege || o.uid,
          couleur: o.couleur_associee,
          tauxCohesion: o.taux_cohesion_interne,
        });
      }
    );
  }

  // ── Grands chiffres ───────────────────────────────────────────────────
  const allTaux = [...tauxAN, ...tauxSN];
  const shareHigh =
    allTaux.length > 0
      ? Math.round((allTaux.filter((v) => v >= 95).length / allTaux.length) * 100)
      : 0;

  // ── BoxPlot (AN vs Sénat) ────────────────────────────────────────────
  const boxAllData = [
    { label: t('boxANLabel'), countLabel: t('boxANCountLabel'), ...boxStats(tauxAN), mean: meanAN },
    { label: t('boxSNLabel'), countLabel: t('boxSNCountLabel'), ...boxStats(tauxSN), mean: meanSN },
  ];

  // ── GroupeBarChart — AN et Sénat (depuis organes.taux_cohesion_interne)
  const deputeGroupeUids = new Set(deputes.map((d) => d.groupe).filter((g): g is string => g !== null));
  const senateurGroupeUids = new Set(senateurs.map((s) => s.groupe).filter((g): g is string => g !== null));

  const buildGroupeData = (uids: Set<string>) =>
    Array.from(uids)
      .map((uid) => {
        const info = organesMap.get(uid);
        if (!info || info.tauxCohesion === null || info.tauxCohesion === undefined) return null;
        return {
          groupe: info.libelle,
          value: Math.round(info.tauxCohesion),
          fill: resolveGroupeColor(info.couleur, COLOR),
        };
      })
      .filter((x): x is { groupe: string; value: number; fill: string } => x !== null)
      .sort((a, b) => b.value - a.value);

  const groupeANData = buildGroupeData(deputeGroupeUids);
  const groupeSNData = buildGroupeData(senateurGroupeUids);

  // ── Leaderboards & ranking ───────────────────────────────────────────
  type LeaderRow = {
    uid: string | null;
    nom: string;
    groupe: string | null;
    value: number;
    nbScrutins?: number;
  };

  const toLeaderRow = (a: LoyauteActeur): LeaderRow => ({
    uid: a.uid ?? null,
    nom: `${a.prenom ?? ''} ${a.nom ?? ''}`.trim(),
    groupe: a.groupe ? organesMap.get(a.groupe)?.libelle ?? null : null,
    value: Math.round(a.taux_cohesion_groupe as number),
    nbScrutins: a.scrutins_finaux_pendant_mandat ?? undefined,
  });

  const eligible = (rows: LoyauteActeur[]) =>
    rows.filter(
      (a) =>
        typeof a.taux_cohesion_groupe === 'number' &&
        (a.scrutins_finaux_pendant_mandat ?? 0) >= MIN_SCRUTINS
    );

  const deputesEligibles = eligible(deputes);
  const senateursEligibles = eligible(senateurs);

  const deputesRanked = [...deputesEligibles].sort(
    (a, b) => (b.taux_cohesion_groupe as number) - (a.taux_cohesion_groupe as number)
  );
  const senateursRanked = [...senateursEligibles].sort(
    (a, b) => (b.taux_cohesion_groupe as number) - (a.taux_cohesion_groupe as number)
  );

  const top10AN = deputesRanked.slice(0, 10).map(toLeaderRow);
  const bot10AN = [...deputesRanked].reverse().slice(0, 10).map(toLeaderRow);
  const top10SN = senateursRanked.slice(0, 10).map(toLeaderRow);
  const bot10SN = [...senateursRanked].reverse().slice(0, 10).map(toLeaderRow);

  // ── Search entries ───────────────────────────────────────────────────
  const deputeRankMap = new Map<string, number>(
    deputesRanked.map((a, i) => [a.uid as string, i + 1])
  );
  const senateurRankMap = new Map<string, number>(
    senateursRanked.map((a, i) => [a.uid as string, i + 1])
  );

  const searchEntries: LoyauteSearchEntry[] = [
    ...deputesEligibles
      .filter((a) => a.uid != null)
      .map((a): LoyauteSearchEntry => ({
        uid: a.uid ?? null,
        nom: `${a.prenom ?? ''} ${a.nom ?? ''}`.trim(),
        groupe: a.groupe ? organesMap.get(a.groupe)?.libelle ?? null : null,
        type: 'depute',
        value: Math.round(a.taux_cohesion_groupe as number),
        rank: deputeRankMap.get(a.uid as string) ?? 0,
        total: deputesRanked.length,
        nbScrutins: a.scrutins_finaux_pendant_mandat ?? undefined,
      })),
    ...senateursEligibles
      .filter((a) => a.uid != null)
      .map((a): LoyauteSearchEntry => ({
        uid: a.uid ?? null,
        nom: `${a.prenom ?? ''} ${a.nom ?? ''}`.trim(),
        groupe: a.groupe ? organesMap.get(a.groupe)?.libelle ?? null : null,
        type: 'senateur',
        value: Math.round(a.taux_cohesion_groupe as number),
        rank: senateurRankMap.get(a.uid as string) ?? 0,
        total: senateursRanked.length,
        nbScrutins: a.scrutins_finaux_pendant_mandat ?? undefined,
      })),
  ];

  const renderLeaderItem = (p: LeaderRow, i: number, prefix: string) => (
    <li key={`${prefix}${i}`} className="flex gap-3 items-start">
      <span className="text-xs font-medium text-muted-foreground mt-0.5 w-5 shrink-0 text-right">
        {i + 1}
      </span>
      <div className="flex-1 min-w-0">
        {p.uid ? (
          <Link
            href={`/les-elus/${p.uid}`}
            prefetch={false}
            className="text-sm leading-tight font-medium hover:underline hover:text-primary transition-colors"
          >
            {p.nom}
          </Link>
        ) : (
          <span className="text-sm leading-tight font-medium">{p.nom}</span>
        )}
        {p.groupe && <p className="text-xs text-muted-foreground mt-0.5">{p.groupe}</p>}
      </div>
      <div className="flex flex-col items-end shrink-0 mt-0.5">
        <span className="text-xs tabular-nums font-semibold" style={{ color: COLOR }}>
          {pourcent.format(p.value / 100)}
        </span>
        {p.nbScrutins !== undefined && (
          <span className="text-xs tabular-nums text-muted-foreground leading-tight">
            {p.nbScrutins} {t('scrutinsShort')}
          </span>
        )}
      </div>
    </li>
  );

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
          an: meanAN.toLocaleString(locale),
          sn: meanSN.toLocaleString(locale),
          shareHigh: shareHigh.toLocaleString(locale),
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Hero — 3 grands chiffres */}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('heroTitle')}</CardTitle>
          <CardDescription>{t('heroDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: t('meanAN'), value: meanAN, count: tauxAN.length },
              { label: t('meanSN'), value: meanSN, count: tauxSN.length },
              { label: t('shareHighLabel'), value: shareHigh, count: allTaux.length },
            ].map((row) => (
              <div
                key={row.label}
                className="flex flex-col items-start md:items-center text-left md:text-center"
              >
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  {row.label}
                </span>
                <div className="flex items-baseline gap-1">
                  <span
                    className="text-6xl font-bold tabular-nums"
                    style={{ color: COLOR }}
                  >
                    {row.value.toLocaleString(locale)}
                  </span>
                  <span className="text-xl text-muted-foreground">%</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('heroSample', { count: row.count })}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* À COMPRENDRE */}
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
        {[
          { value: 'perimetre', title: t('concept1Title'), desc: t('concept1Body') },
          { value: 'voter-avec', title: t('concept2Title'), desc: t('concept2Body') },
          { value: 'absence', title: t('concept3Title'), desc: t('concept3Body') },
          { value: 'scrutins-publics', title: t('concept4Title'), desc: t('concept4Body') },
          { value: 'taux-faible', title: t('concept5Title'), desc: t('concept5Body') },
        ].map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="hover:no-underline">{item.title}</AccordionTrigger>
            <AccordionContent>
              <p className="text-foreground/80 leading-relaxed">{item.desc}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* ② EN CHIFFRES */}
      <h2
        className="text-xs font-bold uppercase tracking-widest mb-8"
        style={{ color: COLOR }}
      >
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        {/* Distribution AN vs Sénat */}
        {(tauxAN.length > 0 || tauxSN.length > 0) && (
          <div className="md:col-span-2">
            <BoxPlotChart
              data={boxAllData}
              title={t('boxPlotTitle')}
              description={t('boxPlotDesc')}
              unit="%"
              locale={locale}
              color={COLOR}
              countLabel={t('boxCountLabel')}
              note={t('boxPlotNote')}
              domain={[60, 100]}
            />
          </div>
        )}

        {/* Moyennes par groupe — AN + Sénat */}
        {(groupeANData.length > 0 || groupeSNData.length > 0) && (
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            {groupeANData.length > 0 && (
              <GroupeBarChart
                data={groupeANData}
                title={t('groupeANTitle')}
                description={t('groupeANDesc')}
                color={COLOR}
                valueLabel={t('valueLabel')}
                note={t('groupeANNote')}
                labelWidth={280}
                labelMaxChars={38}
                xDomain={[0, 100]}
              />
            )}
            {groupeSNData.length > 0 && (
              <GroupeBarChart
                data={groupeSNData}
                title={t('groupeSNTitle')}
                description={t('groupeSNDesc')}
                color={COLOR}
                valueLabel={t('valueLabel')}
                note={t('groupeSNNote')}
                labelWidth={280}
                labelMaxChars={38}
                xDomain={[0, 100]}
              />
            )}
          </div>
        )}

        {/* Recherche parlementaire */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('searchTitle')}</CardTitle>
              <CardDescription>{t('searchDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <LoyauteSearch
                entries={searchEntries}
                color={COLOR}
                labels={{
                  placeholder: t('searchPlaceholder'),
                  noResult: t('searchNoResult'),
                  rankLabel: t('searchRankLabel'),
                  outOfLabel: t('searchOutOf'),
                  deputeLabel: t('searchDepute'),
                  senateurLabel: t('searchSenateur'),
                  metricLabel: t('searchMetricLabel'),
                  scrutinsLabel: t('searchScrutins'),
                }}
              />
            </CardContent>
            <div className="border-t px-6 py-4">
              <p className="text-sm text-foreground/70 leading-relaxed">{t('searchNote', { min: MIN_SCRUTINS })}</p>
            </div>
          </Card>
        </div>

        {/* Leaderboards — une carte par chambre : ceux qui votent le plus souvent,
            puis le moins souvent, avec leur groupe */}
        {(top10AN.length > 0 || bot10AN.length > 0 || top10SN.length > 0 || bot10SN.length > 0) && (
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
            {(top10AN.length > 0 || bot10AN.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('leaderANTitle')}</CardTitle>
                  <CardDescription>{t('leaderANDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {top10AN.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                          {t('leaderTopLabel')}
                        </h4>
                        <ol className="space-y-3 pr-1">
                          {top10AN.map((p, i) => renderLeaderItem(p, i, 'lan'))}
                        </ol>
                      </div>
                    )}
                    {bot10AN.length > 0 && (
                      <div className="pt-6 border-t border-border">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                          {t('leaderBotLabel')}
                        </h4>
                        <ol className="space-y-3 pr-1">
                          {bot10AN.map((p, i) => renderLeaderItem(p, i, 'dan'))}
                        </ol>
                      </div>
                    )}
                  </div>
                </CardContent>
                <div className="border-t px-6 py-4">
                  <p className="text-sm text-foreground/70 leading-relaxed">{t('leaderANNote', { min: MIN_SCRUTINS })}</p>
                </div>
              </Card>
            )}
            {(top10SN.length > 0 || bot10SN.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('leaderSNTitle')}</CardTitle>
                  <CardDescription>{t('leaderSNDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {top10SN.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                          {t('leaderTopLabel')}
                        </h4>
                        <ol className="space-y-3 pr-1">
                          {top10SN.map((p, i) => renderLeaderItem(p, i, 'lsn'))}
                        </ol>
                      </div>
                    )}
                    {bot10SN.length > 0 && (
                      <div className="pt-6 border-t border-border">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                          {t('leaderBotLabel')}
                        </h4>
                        <ol className="space-y-3 pr-1">
                          {bot10SN.map((p, i) => renderLeaderItem(p, i, 'dsn'))}
                        </ol>
                      </div>
                    )}
                  </div>
                </CardContent>
                <div className="border-t px-6 py-4">
                  <p className="text-sm text-foreground/70 leading-relaxed">{t('leaderSNNote', { min: MIN_SCRUTINS })}</p>
                </div>
              </Card>
            )}
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
          <span>{t('methodologyPerimeter')}</span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyCalcul', { min: MIN_SCRUTINS })}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyExclusions', { min: MIN_SCRUTINS })}</span>
        </p>
        <p className="flex gap-3">
          <Scale className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologySource')}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimit')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Facts/loyaute" locale={locale} />
    </div>
  );
}
