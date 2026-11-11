// Page `/Facts/representativite/geographie` : nombre d'habitants par parlementaire,
// département par département. Server Component statique qui lit `acteurs`, le SVG
// des départements (pour leurs noms) et la population de `public/data/`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import fs from 'node:fs/promises';
import path from 'node:path';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { getParliamentCounts, LEGAL_AN, LEGAL_SN } from '@/lib/parliament-counts';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import { DonutChart } from '@/components/ui/DonutChart';
import { FranceChoropleth } from '@/components/ui/FranceChoropleth';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  Target,
  Calculator,
  Filter,
  Scale,
  AlertTriangle,
} from 'lucide-react';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerGeographieRepresentants' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/representativite/geographie'),
    openGraph: buildOpenGraph(locale, '/Facts/representativite/geographie', title, description),
  };
}

const COLOR = '#7c3aed';
const COLOR_DARK = '#4c1d95';
const COLOR_LIGHT = '#ede9fe';
const COLOR_UNKNOWN = '#f5f3ff';

type Acteur = {
  uid: string;
  num_departement: string | null;
  departement_election: string | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
};

type PopulationData = {
  millesime: number;
  publication: string;
  source: string;
  sourceUrl: string;
  departements: Record<string, number>;
};

const IDF_CODES = ['75', '77', '78', '91', '92', '93', '94', '95'];
const DROM_CODES = ['971', '972', '973', '974', '976'];
// COMs : présents dans le SVG et dans la table de population.
// Note : 978 (Saint-Martin) est groupé avec 977 (Saint-Barthélemy) dans le SVG sous d977.
const COM_CODES = ['975', '977', '986', '987', '988'];

// Normalise un code département lu en base.
// - Zero-padding 2 chiffres pour la métropole
// - Uppercase pour la Corse (2A/2B)
// - 3 chiffres conservés pour l'outre-mer
// - 978 (Saint-Martin) → 977 : groupés sous le même tracé SVG "Saint-Barthélemy & Saint-Martin"
const normalizeCode = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const s = raw.trim().toUpperCase();
  if (!s) return null;
  if (s === '2A' || s === '2B') return s;
  if (/^\d+$/.test(s)) {
    if (s.length >= 3) {
      // Saint-Martin partage le tracé SVG de Saint-Barthélemy
      if (s === '978') return '977';
      return s;
    }
    return s.padStart(2, '0');
  }
  return s;
};

// Décode les entités HTML basiques présentes dans les SVG (ex. &amp; → &).
const decodeHtmlEntities = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

// Extrait {code → nom} depuis le SVG source via les éléments <title> imbriqués.
// Gère les codes à 2 chiffres (métropole), Corse (2A/2B),
// 3 chiffres (DROM/COM) et le cercle symbolique (999).
const extractDeptNames = (svg: string): Record<string, string> => {
  const out: Record<string, string> = {};
  // Capture : id="dXX" suivi du contenu du premier <title> enfant
  const re = /id="d([0-9]{1,3}|2A|2B)"[^>]*>[\s\S]*?<title>([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    const code = m[1];
    // Retire le suffixe " (code)" s'il est présent dans le titre
    const name = decodeHtmlEntities(m[2].trim()).replace(/\s*\([^)]*\)\s*$/, '');
    if (!out[code]) out[code] = name;
  }
  return out;
};

export default async function AnswerGeographieRepresentantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const t = await getTranslations({ locale, namespace: 'answerGeographieRepresentants' });
  const counts = await getParliamentCounts();

  const [acteurs, svgMarkup, populationRaw] = await Promise.all([
    sql<Acteur[]>`
      select uid, num_departement, departement_election, est_depute_actuel, est_senateur_actuel
      from acteurs
      where (est_depute_actuel = true or est_senateur_actuel = true)
      limit 2000`,
    // Lu ici pour les seuls noms de départements (`extractDeptNames`) : le tracé ne
    // part pas en prop, `FranceChoropleth` le charge depuis `public/`, hors de la
    // page que l'ISR stocke.
    fs.readFile(path.join(process.cwd(), 'public', 'departements.svg'), 'utf8'),
    fs.readFile(
      path.join(process.cwd(), 'public', 'data', 'population-departements.json'),
      'utf8'
    ),
  ]);

  const population = JSON.parse(populationRaw) as PopulationData;
  const deptNames = extractDeptNames(svgMarkup);

  // Regroupement par département.
  // Les élus sans num_departement (Français établis hors de France) sont
  // comptés sous le code "999" — qui a un tracé SVG (cercle symbolique)
  // et une population estimée dans le JSON.
  const totalParDept = new Map<string, number>();
  for (const a of acteurs) {
    const code = normalizeCode(a.num_departement);
    if (!code || !(code in population.departements)) {
      // Inclut : null (Français de l'étranger) et codes inconnus
      totalParDept.set('999', (totalParDept.get('999') ?? 0) + 1);
      continue;
    }
    totalParDept.set(code, (totalParDept.get(code) ?? 0) + 1);
  }

  const totalParlementaires = acteurs.length;
  const nbEtranger = totalParDept.get('999') ?? 0;

  // habitants par parlementaire pour chaque code avec population connue.
  const habitantsParElu: Record<string, number> = {};
  for (const [code, nb] of totalParDept.entries()) {
    const pop = population.departements[code];
    if (pop === undefined || nb === 0) continue;
    habitantsParElu[code] = Math.round(pop / nb);
  }

  // Codes retenus pour ancrer l'échelle de couleur et les Top 10 :
  // uniquement métropole (01-95, 2A, 2B) + DROM.
  // Les COMs (SPM, Wallis, Polynésie…) ont des ratios atypiques qui
  // écraserait l'échelle et parasiteraient le classement.
  const isMetroDrom = (c: string) =>
    c === '2A' || c === '2B' || DROM_CODES.includes(c) || /^\d{2}$/.test(c);

  const scaleEntries = Object.entries(habitantsParElu).filter(([c]) => isMetroDrom(c));
  const scaleValues = scaleEntries.map(([, v]) => v);
  const minVal = scaleValues.length ? Math.min(...scaleValues) : 0;
  const maxVal = scaleValues.length ? Math.max(...scaleValues) : 0;
  const ratioExtremes = minVal > 0 ? Math.round((maxVal / minVal) * 10) / 10 : 0;

  const codeMin = scaleEntries.find(([, v]) => v === minVal)?.[0] ?? '';
  const codeMax = scaleEntries.find(([, v]) => v === maxVal)?.[0] ?? '';
  const deptMin = deptNames[codeMin] || codeMin;
  const deptMax = deptNames[codeMax] || codeMax;

  // Top 10 sur-représentés / sous-représentés — tous les territoires y compris
  // les Français de l'étranger (999), traités comme un territoire unique.
  const labelFor = (code: string) =>
    code === '999' ? t('zoneEtranger') : (deptNames[code] || code);
  const sortedAllTerritories = Object.entries(habitantsParElu).sort(
    (a, b) => a[1] - b[1]
  );
  const topOverData = sortedAllTerritories.slice(0, 10).map(([code, v]) => ({
    groupe: `${labelFor(code)} (${code})`,
    value: v,
  }));
  // Top 10 sous-représentés (ratio le plus haut).
  const topUnderData = sortedAllTerritories
    .slice(-10)
    .reverse()
    .map(([code, v]) => ({
      groupe: `${labelFor(code)} (${code})`,
      value: v,
    }));

  // Île-de-France : % parlementaires vs % population INSEE.
  // Exclut "999" du total pour ne comparer que les territoires.
  const idfPop = IDF_CODES.reduce(
    (s, c) => s + (population.departements[c] ?? 0),
    0
  );
  const totalPopTerritoires = Object.entries(population.departements)
    .filter(([c]) => c !== '999')
    .reduce((s, [, v]) => s + v, 0);
  const idfElus = IDF_CODES.reduce(
    (s, c) => s + (totalParDept.get(c) ?? 0),
    0
  );
  const totalElusTerritoires = [...totalParDept.entries()]
    .filter(([c]) => c !== '999')
    .reduce((s, [, v]) => s + v, 0);

  const pctIdfPop =
    totalPopTerritoires > 0
      ? Math.round((idfPop / totalPopTerritoires) * 1000) / 10
      : 0;
  const pctIdfElus =
    totalElusTerritoires > 0
      ? Math.round((idfElus / totalElusTerritoires) * 1000) / 10
      : 0;
  // positif = IDF a plus de pop% que d'élus% → sous-représentée
  // négatif = IDF a plus d'élus% que de pop% → sur-représentée
  const diffIdf = Math.round((pctIdfPop - pctIdfElus) * 10) / 10;
  const idfIsUnder = diffIdf > 0;

  // Répartition par zone.
  const domTotal = DROM_CODES.reduce((s, c) => s + (totalParDept.get(c) ?? 0), 0);
  const comTotal = COM_CODES.reduce((s, c) => s + (totalParDept.get(c) ?? 0), 0);
  const metropoleHorsIdf =
    totalElusTerritoires - idfElus - domTotal - comTotal;
  const zonesData = [
    { name: t('zoneMetropoleHorsIdf'), size: metropoleHorsIdf },
    { name: t('zoneIdf'), size: idfElus },
    { name: t('zoneOutreMer'), size: domTotal + comTotal },
    { name: t('zoneEtranger'), size: nbEtranger },
  ].filter((z) => z.size > 0);

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
          minRatio: minVal.toLocaleString(locale),
          maxRatio: maxVal.toLocaleString(locale),
          ratioExtremes: ratioExtremes.toLocaleString(locale),
          deptMin,
          deptMax,
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Accordion À comprendre — avant la carte */}
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
            <p className="text-foreground/80 leading-relaxed">
              {t('concept1Desc', { an: counts.an, sn: counts.sn, total: counts.total })}
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="constitution">
          <AccordionTrigger className="hover:no-underline">
            {/* Les effectifs fixés par la loi, pas ceux du jour : un siège vacant
                ferait dire au texte que la loi prévoit 574 députés. */}
            {t('concept2Title', { an: LEGAL_AN, sn: LEGAL_SN })}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t('concept2Desc', { an: LEGAL_AN, sn: LEGAL_SN })}
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="decoupage">
          <AccordionTrigger className="hover:no-underline">
            {t('concept3Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t('concept3Desc')}
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="senat">
          <AccordionTrigger className="hover:no-underline">
            {t('concept4Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t('concept4Desc')}
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="gouvernement">
          <AccordionTrigger className="hover:no-underline">
            {t('concept5Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t('concept5Desc')}
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="calcul">
          <AccordionTrigger className="hover:no-underline">
            {t('concept6Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t('concept6Desc', { millesime: population.millesime, vigueur: population.millesime + 3 })}
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Visuel hero — la carte */}
      <div className="mb-16">
        <FranceChoropleth
          data={habitantsParElu}
          deptNames={deptNames}
          title={t('heroChartTitle')}
          description={t('heroChartDesc')}
          note={t('heroChartNote', {
            millesime: population.millesime,
            // L'Insee fait entrer en vigueur les populations légales d'un millésime
            // le 1ᵉʳ janvier de la troisième année qui suit (millésime 2023 : 2026).
            vigueur: population.millesime + 3,
            total: totalElusTerritoires,
            etranger: nbEtranger,
          })}
          valueLabel={t('heroValueLabel')}
          minValue={minVal}
          maxValue={maxVal}
          locale={locale}
          colorFrom={COLOR_LIGHT}
          colorTo={COLOR_DARK}
          colorUnknown={COLOR_UNKNOWN}
          legendLabelMin={t('legendLabelMin')}
          legendLabelMax={t('legendLabelMax')}
        />
      </div>

      {/* ② EN CHIFFRES */}
      <h2
        className="text-xs font-bold uppercase tracking-widest mb-8"
        style={{ color: COLOR }}
      >
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        <GroupeBarChart
          data={topOverData}
          title={t('topOverTitle')}
          description={t('topOverDesc')}
          color={COLOR}
          valueLabel={t('topOverLabel')}
          note={t('topOverNote')}
          labelWidth={220}
          labelMaxChars={30}
        />
        <GroupeBarChart
          data={topUnderData}
          title={t('topUnderTitle')}
          description={t('topUnderDesc')}
          color={COLOR_DARK}
          valueLabel={t('topUnderLabel')}
          note={t('topUnderNote')}
          labelWidth={220}
          labelMaxChars={30}
        />

        {/* Île-de-France vs France — verdict en une phrase */}
        <div
          className="rounded-xl border bg-card p-6 flex flex-col"
          style={{ minHeight: '16rem' }}
        >
          <div>
            <h3 className="text-base font-semibold leading-none">
              {t('idfCardTitle')}
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5">
              {t('idfCardDesc')}
            </p>
          </div>
          <div className="flex-1 flex items-center">
            <div className="grid grid-cols-2 gap-6 w-full">
              <div>
                <div
                  className="text-4xl md:text-5xl font-bold"
                  style={{ color: COLOR }}
                >
                  {pourcent.format(pctIdfPop / 100)}
                </div>
                <div className="text-xs text-muted-foreground mt-2 leading-snug">
                  {t('idfCardPopLabel')}
                </div>
              </div>
              <div>
                <div
                  className="text-4xl md:text-5xl font-bold"
                  style={{ color: COLOR_DARK }}
                >
                  {pourcent.format(pctIdfElus / 100)}
                </div>
                <div className="text-xs text-muted-foreground mt-2 leading-snug">
                  {t('idfCardElusLabel')}
                </div>
              </div>
            </div>
          </div>
          {/* Verdict calculé : sous- ou sur-représentation en points */}
          <p className="text-sm font-medium leading-snug mt-4" style={{ color: COLOR_DARK }}>
            {t(idfIsUnder ? 'idfCardVerdictUnder' : 'idfCardVerdictOver', {
              diff: Math.abs(diffIdf).toLocaleString(locale),
            })}
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            {t('idfCardNote', { pop: idfPop.toLocaleString(locale), elus: idfElus, millesime: population.millesime })}
          </p>
        </div>

        {zonesData.length > 0 && (
          <DonutChart
            data={zonesData}
            title={t('zonesChartTitle')}
            description={t('zonesChartDesc', { total: counts.total })}
            tooltipLabel={t('zonesChartLabel')}
            note={t('zonesChartNote', { total: totalParlementaires })}
            colors={['#7c3aed', '#4c1d95', '#a78bfa', '#ddd6fe']}
          />
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
          <span>
            {t('methodologyPerimeter', {
              anTotal: counts.an,
              snTotal: counts.sn,
              territoires: totalElusTerritoires,
              etranger: nbEtranger,
            })}
          </span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyCalcul', { millesime: population.millesime, vigueur: population.millesime + 3 })}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyExclusions', { etranger: nbEtranger })}</span>
        </p>
        <p className="flex gap-3">
          <Scale className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyComparison')}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimit')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Facts/representativite/geographie" locale={locale} />
    </div>
  );
}
