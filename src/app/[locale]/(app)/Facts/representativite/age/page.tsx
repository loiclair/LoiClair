// Page `/Facts/representativite/age` : âge des députés, sénateurs et ministres,
// comparé à celui de la population (`INSEE_AGE_MOYEN`). Server Component statique,
// qui lit `acteurs` et `organes`.
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
import { BoxPlotChart } from '@/components/ui/BoxPlotChart';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Filter, Scale, AlertTriangle } from 'lucide-react';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { boxStats, mean } from '@/lib/stats';
import { INSEE_AGE_MOYEN } from '@/lib/facts-shared';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerAgeRepresentants' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/representativite/age'),
    openGraph: buildOpenGraph(locale, '/Facts/representativite/age', title, description),
  };
}

const COLOR = '#7c3aed';

type Acteur = {
  prenom: string | null;
  nom: string | null;
  civ: string | null;
  age: number | null;
  groupe: string | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  est_ministre_actuel: boolean | null;
};

export default async function AnswerAgeRepresentantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerAgeRepresentants' });
  const counts = await getParliamentCounts();

  const acteurs: Acteur[] = await sql<Acteur[]>`
    select prenom, nom, civ, age, groupe, est_depute_actuel, est_senateur_actuel, est_ministre_actuel
    from acteurs
    where en_exercice = true
      and (est_depute_actuel = true or est_senateur_actuel = true or est_ministre_actuel = true)
    limit 2000`;
  const deputes = acteurs.filter((a) => a.est_depute_actuel);
  const senateurs = acteurs.filter((a) => a.est_senateur_actuel);
  const ministres = acteurs.filter((a) => a.est_ministre_actuel);

  const agesValides = (rows: Acteur[]) =>
    rows.map((a) => a.age).filter((n): n is number => typeof n === 'number' && !isNaN(n));

  const agesAN = agesValides(deputes);
  const agesSN = agesValides(senateurs);
  const agesGouv = agesValides(ministres);

  const moyAN = mean(agesAN);
  const moySN = mean(agesSN);
  const moyGouv = mean(agesGouv);

  // Exclusions : décideurs sans âge dans l'open data
  const sansAge = acteurs.filter((a) => typeof a.age !== 'number').length;

  // ── BoxPlot — 3 institutions (Gouvernement en donnée secondaire) ──
  const boxData = [
    { label: t('chambreAN'), countLabel: t('countDeputes'), ...boxStats(agesAN) },
    { label: t('chambreSN'), countLabel: t('countSenateurs'), ...boxStats(agesSN) },
    { label: t('chambreGouv'), countLabel: t('countMinistres'), ...boxStats(agesGouv) },
  ].filter((x) => x.count > 0);

  // ── Donut — tranches d'âge sur AN + Sénat uniquement ──────────────
  // Le Gouvernement est exclu de la distribution principale : ce sont des
  // nommés, pas des élus — donc pas la population à évaluer pour la
  // représentativité démocratique.
  const parlementaires = [...deputes, ...senateurs];
  const agesParlement = agesValides(parlementaires);

  const tranches = { lt40: 0, a40_49: 0, a50_59: 0, a60_69: 0, gte70: 0 };
  for (const age of agesParlement) {
    if (age < 40) tranches.lt40++;
    else if (age < 50) tranches.a40_49++;
    else if (age < 60) tranches.a50_59++;
    else if (age < 70) tranches.a60_69++;
    else tranches.gte70++;
  }
  const trancheData = [
    { name: t('tranche1'), size: tranches.lt40 },
    { name: t('tranche2'), size: tranches.a40_49 },
    { name: t('tranche3'), size: tranches.a50_59 },
    { name: t('tranche4'), size: tranches.a60_69 },
    { name: t('tranche5'), size: tranches.gte70 },
  ].filter((x) => x.size > 0);

  // ── Âge moyen par groupe (AN + Sénat) ─────────────────────────────
  const groupeUids = new Set<string>();
  parlementaires.forEach((a) => {
    if (a.groupe) groupeUids.add(a.groupe);
  });

  // On retient le libellé complet (pour l'affichage) et `couleur_associee`
  // pour colorer chaque barre : open data de l'Assemblée pour ses groupes,
  // couleurs de senat.fr pour ceux du Sénat (`COULEURS_GROUPES_SENAT`,
  // `import_acteurs_organes_cloud.py`). Un groupe sans couleur garde la teinte de la page.
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
        const libelle = o.libelle || o.libelle_abrege || o.uid;
        organesMap.set(o.uid, { libelle, couleur: o.couleur_associee });
      }
    );
  }

  const buildGroupeAges = (rows: Acteur[]) => {
    const byGroupe = new Map<string, number[]>();
    for (const a of rows) {
      if (!a.groupe || typeof a.age !== 'number') continue;
      if (!byGroupe.has(a.groupe)) byGroupe.set(a.groupe, []);
      byGroupe.get(a.groupe)!.push(a.age);
    }
    return [...byGroupe.entries()]
      .map(([uid, ages]) => {
        const info = organesMap.get(uid);
        const libelle = info?.libelle ?? uid;
        return {
          groupe: `${libelle} (${ages.length})`,
          value: mean(ages),
          fill: resolveGroupeColor(info?.couleur, COLOR),
        };
      })
      .filter((x) => x.value > 0)
      .sort((a, b) => a.value - b.value);
  };

  const groupeANData = buildGroupeAges(deputes);
  const groupeSNData = buildGroupeAges(senateurs);

  // ── Comparaison femmes / hommes par institution ───────────────────
  const meanGenre = (rows: Acteur[], civ: 'Mme' | 'M.') =>
    mean(
      rows
        .filter((a) => a.civ?.trim() === civ && typeof a.age === 'number')
        .map((a) => a.age as number)
    );

  const genreRows = [
    { label: t('chambreAN'), femmes: meanGenre(deputes, 'Mme'), hommes: meanGenre(deputes, 'M.') },
    { label: t('chambreSN'), femmes: meanGenre(senateurs, 'Mme'), hommes: meanGenre(senateurs, 'M.') },
    { label: t('chambreGouv'), femmes: meanGenre(ministres, 'Mme'), hommes: meanGenre(ministres, 'M.') },
  ].filter((r) => r.femmes > 0 && r.hommes > 0);
  const genreMaxAge = Math.max(...genreRows.flatMap((r) => [r.femmes, r.hommes]), 1);

  // ── Top 5 plus jeunes & plus âgés ─────────────────────────────────
  // Un cumulard (ex. député-ministre) ne doit apparaître qu'une fois.
  // On retient la fonction « la plus élective » dans l'ordre AN > SN > Gouv.
  type TopRow = { nom: string; age: number; institution: string; groupe: string | null };
  const institutionOf = (a: Acteur): string => {
    if (a.est_depute_actuel) return t('chambreAN');
    if (a.est_senateur_actuel) return t('chambreSN');
    return t('chambreGouv');
  };

  const tousAvecAge: TopRow[] = acteurs
    .filter((a) => typeof a.age === 'number')
    .map((a) => ({
      nom: `${a.prenom ?? ''} ${a.nom ?? ''}`.trim(),
      age: a.age as number,
      institution: institutionOf(a),
      groupe: a.groupe ? organesMap.get(a.groupe)?.libelle ?? null : null,
    }));

  const topJeunes = [...tousAvecAge].sort((a, b) => a.age - b.age).slice(0, 5);
  const topAges = [...tousAvecAge].sort((a, b) => b.age - a.age).slice(0, 5);

  // ── Rendu ─────────────────────────────────────────────────────────
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
          an: moyAN.toLocaleString(locale),
          sn: moySN.toLocaleString(locale),
          insee: INSEE_AGE_MOYEN.toLocaleString(locale),
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
          {/* Les deux populations centrales */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {[
              { label: t('chambreAN'), value: moyAN, count: agesAN.length },
              { label: t('chambreSN'), value: moySN, count: agesSN.length },
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
                  <span className="text-xl text-muted-foreground">
                    {t('yearsSuffix')}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('heroSample', { count: row.count })}
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
                  {moyGouv.toLocaleString(locale)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('yearsSuffix')}
                </span>
                <span className="text-xs text-muted-foreground">
                  ({t('heroSample', { count: agesGouv.length })})
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-sm text-muted-foreground">{t('heroInseeLabel')}</span>
                <span className="text-2xl font-semibold tabular-nums" style={{ color: COLOR }}>
                  {INSEE_AGE_MOYEN.toLocaleString(locale)}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('yearsSuffix')}
                </span>
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
            {t('conceptPerimetreTitle')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptPerimetreDesc', { an: counts.an, sn: counts.sn })}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="gouvernement">
          <AccordionTrigger className="hover:no-underline">
            {t('conceptGouvTitle')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptGouvDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="moyenne">
          <AccordionTrigger className="hover:no-underline">
            {t('conceptMoyenneTitle')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptMoyenneDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="tranches">
          <AccordionTrigger className="hover:no-underline">
            {t('conceptTranchesTitle')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptTranchesDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="boxplot">
          <AccordionTrigger className="hover:no-underline">
            {t('conceptBoxplotTitle')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptBoxplotDesc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="date">
          <AccordionTrigger className="hover:no-underline">
            {t('conceptDateTitle')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('conceptDateDesc')}</p>
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
        {boxData.length > 0 && (
          <BoxPlotChart
            data={boxData}
            title={t('boxChartTitle')}
            description={t('boxChartDesc')}
            unit={t('yearsSuffix')}
            locale={locale}
            color={COLOR}
            countLabel={t('boxCountLabel')}
            note={t('boxChartNote')}
            domain={[20, 90]}
          />
        )}

        {trancheData.length > 0 && (
          <DonutChart
            data={trancheData}
            title={t('trancheChartTitle')}
            description={t('trancheChartDesc')}
            tooltipLabel={t('trancheChartLabel')}
            note={t('trancheChartNote')}
            colors={['#fde68a', '#f59e0b', '#059669', '#1e40af', '#4c1d95']}
          />
        )}

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
              xDomain={[30, 70]}
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
              xDomain={[30, 70]}
            />
          </div>
        )}

        {genreRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('genreChartTitle')}</CardTitle>
              <CardDescription>{t('genreChartDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {genreRows.map((row) => {
                  const ecart = Math.round((row.hommes - row.femmes) * 10) / 10;
                  const ecartLabel =
                    ecart === 0
                      ? t('genreEcartZero')
                      : ecart > 0
                      ? t('genreEcartH', { ans: Math.abs(ecart).toLocaleString(locale) })
                      : t('genreEcartF', { ans: Math.abs(ecart).toLocaleString(locale) });
                  return (
                    <div key={row.label}>
                      <div className="flex items-baseline justify-between mb-3">
                        <span className="text-sm font-semibold">{row.label}</span>
                        <span className="text-xs text-muted-foreground">{ecartLabel}</span>
                      </div>
                      <div className="space-y-2">
                        {[
                          { key: 'femmes', label: t('genreFemmes'), value: row.femmes, color: '#ec4899' },
                          { key: 'hommes', label: t('genreHommes'), value: row.hommes, color: COLOR },
                        ].map((bar) => (
                          <div key={bar.key} className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground w-16 shrink-0">{bar.label}</span>
                            <div className="relative flex-1 h-6 rounded bg-muted/40 overflow-hidden">
                              <div
                                className="h-full rounded flex items-center justify-end pr-2"
                                style={{
                                  width: `${(bar.value / genreMaxAge) * 100}%`,
                                  backgroundColor: bar.color,
                                }}
                              >
                                <span className="text-[11px] font-semibold text-white tabular-nums">
                                  {bar.value}
                                </span>
                              </div>
                            </div>
                            <span className="text-xs text-muted-foreground w-10 shrink-0 text-right tabular-nums">
                              {t('yearsSuffix')}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
            <div className="border-t px-6 py-4">
              <p className="text-sm text-foreground/70 leading-relaxed">{t('genreChartNote')}</p>
            </div>
          </Card>
        )}

        {topJeunes.length > 0 && topAges.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t('topTitle')}</CardTitle>
              <CardDescription>{t('topDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  {t('topJeunesLabel')}
                </h4>
                <ol className="space-y-3">
                  {topJeunes.map((p, i) => (
                    <li key={`j${i}`} className="flex gap-3 items-start">
                      <span className="text-xs font-medium text-muted-foreground mt-0.5 w-5 shrink-0 text-right">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight font-medium">{p.nom}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.groupe ? `${p.institution} · ${p.groupe}` : p.institution}
                        </p>
                      </div>
                      <span
                        className="text-xs tabular-nums shrink-0 mt-0.5 font-semibold"
                        style={{ color: COLOR }}
                      >
                        {p.age} {t('yearsSuffix')}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                  {t('topAgesLabel')}
                </h4>
                <ol className="space-y-3">
                  {topAges.map((p, i) => (
                    <li key={`a${i}`} className="flex gap-3 items-start">
                      <span className="text-xs font-medium text-muted-foreground mt-0.5 w-5 shrink-0 text-right">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-tight font-medium">{p.nom}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {p.groupe ? `${p.institution} · ${p.groupe}` : p.institution}
                        </p>
                      </div>
                      <span
                        className="text-xs tabular-nums shrink-0 mt-0.5 font-semibold"
                        style={{ color: COLOR }}
                      >
                        {p.age} {t('yearsSuffix')}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            </CardContent>
            <div className="border-t px-6 py-4">
              <p className="text-sm text-foreground/70 leading-relaxed">{t('topNote')}</p>
            </div>
          </Card>
        )}
      </div>

      {/* ③ MÉTHODOLOGIE */}
      <Separator className="mb-8" />
      <h2
        className="text-xs font-bold uppercase tracking-widest mb-5"
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
          <span>{t('methodologyCalcul')}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyExclusions', { count: sansAge })}</span>
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
      <ExploreSection color={COLOR} currentHref="/Facts/representativite/age" locale={locale} />
    </div>
  );
}
