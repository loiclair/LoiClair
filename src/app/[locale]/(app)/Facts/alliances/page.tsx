// Page `/Facts/alliances` : taux d'accord entre groupes politiques sur les votes
// finaux, à l'Assemblée et au Sénat. Server Component statique qui lit
// `scrutins_groupes_positions` et `organes`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Users, Filter, AlertTriangle, Handshake, Swords } from 'lucide-react';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { MatrixHeatmap, type MatrixGroupe } from '@/components/ui/MatrixHeatmap';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerAlliances' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/alliances'),
    openGraph: buildOpenGraph(locale, '/Facts/alliances', title, description),
  };
}

const COLOR = '#be185d';
// Bleu des paires les plus opposées : une variable CSS, avec sa variante sombre
// (`--alliances-oppose` dans `globals.css`).
const COLOR_OPPOSE = 'var(--alliances-oppose)';
const THRESHOLD = 10;

type PositionRow = {
  scrutin_uid: string;
  groupe_uid: string;
  chambre: 'AN' | 'SN';
  position_majoritaire: 'pour' | 'contre' | 'abstention';
};

type OrganeRow = {
  uid: string;
  libelle: string | null;
  libelle_abrege: string | null;
  couleur_associee: string | null;
};

type Pair = {
  a: MatrixGroupe;
  b: MatrixGroupe;
  accord: number;
  nb: number;
};

/**
 * Positions de groupe des scrutins finaux, toutes chambres.
 *
 * Les motions de censure n'y figurent pas : l'import n'écrit aucune position pour elles
 * (`import_scrutins_cloud.py`). La Constitution n'y fait recenser que les votes
 * favorables, et chaque motion offrirait 100 % d'accord à toutes les paires présentes,
 * y compris à des groupes que tout oppose.
 */
async function fetchAllPositions(): Promise<PositionRow[]> {
  // Tri sur la clé primaire `(scrutin_uid, groupe_uid)` : sans lui, l'ordre des
  // lignes suivrait le plan d'exécution et pourrait changer d'un rendu à l'autre.
  return sql<PositionRow[]>`
    select scrutin_uid, groupe_uid, chambre, position_majoritaire
    from scrutins_groupes_positions
    order by scrutin_uid, groupe_uid`;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function computeMatrix(rows: PositionRow[], groupes: MatrixGroupe[]) {
  const positionsByGroupe = new Map<string, Map<string, string>>();
  for (const r of rows) {
    let m = positionsByGroupe.get(r.groupe_uid);
    if (!m) {
      m = new Map();
      positionsByGroupe.set(r.groupe_uid, m);
    }
    m.set(r.scrutin_uid, r.position_majoritaire);
  }

  const values = new Map<string, { accord: number; nb: number }>();
  const pairs: Pair[] = [];

  for (let i = 0; i < groupes.length; i++) {
    for (let j = i + 1; j < groupes.length; j++) {
      const a = groupes[i];
      const b = groupes[j];
      const ma = positionsByGroupe.get(a.uid);
      const mb = positionsByGroupe.get(b.uid);
      if (!ma || !mb) continue;

      let nb = 0;
      let accord = 0;
      // Iterate over the smaller map for efficiency
      const [small, large] = ma.size <= mb.size ? [ma, mb] : [mb, ma];
      for (const [scrutin, pos] of small) {
        const other = large.get(scrutin);
        if (!other) continue;
        nb++;
        if (pos === other) accord++;
      }
      if (nb === 0) continue;
      const pct = (accord / nb) * 100;
      values.set(pairKey(a.uid, b.uid), { accord: pct, nb });
      pairs.push({ a, b, accord: pct, nb });
    }
  }

  return { values, pairs };
}

export default async function AlliancesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const t = await getTranslations({ locale, namespace: 'answerAlliances' });

  const positions = await fetchAllPositions();

  const groupeUidsSet = new Set<string>();
  for (const p of positions) groupeUidsSet.add(p.groupe_uid);

  const organesMap = new Map<string, OrganeRow>();
  if (groupeUidsSet.size > 0) {
    const data = await sql<OrganeRow[]>`
      select uid, libelle, libelle_abrege, couleur_associee
      from organes
      where uid = any(${Array.from(groupeUidsSet)})`;
    for (const row of data) {
      organesMap.set(row.uid, row);
    }
  }

  const buildGroupes = (chambre: 'AN' | 'SN'): { groupes: MatrixGroupe[]; rows: PositionRow[] } => {
    const rows = positions.filter((p) => p.chambre === chambre);
    const uidScrutinCount = new Map<string, number>();
    for (const r of rows) {
      uidScrutinCount.set(r.groupe_uid, (uidScrutinCount.get(r.groupe_uid) ?? 0) + 1);
    }
    const groupes: MatrixGroupe[] = Array.from(uidScrutinCount.entries())
      .filter(([, n]) => n >= THRESHOLD)
      .map(([uid]) => {
        const o = organesMap.get(uid);
        const libelle = o?.libelle || o?.libelle_abrege || uid;
        const libelleAbrege = o?.libelle_abrege || libelle;
        return {
          uid,
          libelle,
          libelleAbrege,
          color: resolveGroupeColor(o?.couleur_associee ?? null, COLOR),
        };
      })
      .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
    return { groupes, rows };
  };

  const an = buildGroupes('AN');
  const sn = buildGroupes('SN');
  const anMatrix = computeMatrix(an.rows, an.groupes);
  const snMatrix = computeMatrix(sn.rows, sn.groupes);

  const eligiblePairs = (pairs: Pair[]) => pairs.filter((p) => p.nb >= THRESHOLD);
  const anEligible = eligiblePairs(anMatrix.pairs);
  const snEligible = eligiblePairs(snMatrix.pairs);

  const sortedTop = (pairs: Pair[]) => [...pairs].sort((a, b) => b.accord - a.accord);
  const sortedBot = (pairs: Pair[]) => [...pairs].sort((a, b) => a.accord - b.accord);

  const anTop = sortedTop(anEligible).slice(0, 5);
  const anBot = sortedBot(anEligible).slice(0, 5);
  const snTop = sortedTop(snEligible).slice(0, 5);
  const snBot = sortedBot(snEligible).slice(0, 5);

  const pairLabel = (p: Pair) => `${p.a.libelle} ↔ ${p.b.libelle}`;

  const best1 = anTop[0] ? pairLabel(anTop[0]) : '—';
  const best2 = anTop[1] ? pairLabel(anTop[1]) : '—';
  const worst = anBot[0] ? pairLabel(anBot[0]) : '—';

  const formatTooltip = (a: string, b: string, accord: number, count: number) =>
    t('pairTooltip', { a, b, accord, count });

  const renderPairItem = (p: Pair, i: number, prefix: string, accent: 'high' | 'low') => (
    <li key={`${prefix}-${i}`} className="flex gap-3 items-start">
      <span className="text-xs font-medium text-muted-foreground mt-1 w-5 shrink-0 text-right">
        {i + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-snug font-medium">
          {p.a.libelle}
          <span className="text-muted-foreground mx-1.5">↔</span>
          {p.b.libelle}
        </p>
      </div>
      <div className="flex flex-col items-end shrink-0 mt-0.5">
        <span
          className="text-sm tabular-nums font-semibold"
          style={{ color: accent === 'high' ? COLOR : COLOR_OPPOSE }}
        >
          {pourcent.format(Math.round(p.accord) / 100)}
        </span>
        <span className="text-xs tabular-nums text-muted-foreground leading-tight">
          {p.nb.toLocaleString(locale)} {t('scrutinsShort')}
        </span>
      </div>
    </li>
  );

  const heroTile = (
    label: string,
    pair: Pair | undefined,
    valueAccent: 'high' | 'low'
  ) => {
    const accentColor = valueAccent === 'high' ? COLOR : COLOR_OPPOSE;
    const Icon = valueAccent === 'high' ? Handshake : Swords;
    return (
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-2 mb-3">
          <span
            className="inline-flex items-center justify-center rounded-full"
            style={{
              width: 28,
              height: 28,
              // color-mix et non un suffixe hexadécimal d'opacité : le bleu est une
              // variable CSS, à laquelle on ne peut pas coller « 1a ».
              backgroundColor: `color-mix(in srgb, ${accentColor} 10%, transparent)`,
              color: accentColor,
            }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
        </div>
        {pair ? (
          <>
            <p className="text-sm md:text-base leading-snug font-semibold mb-2">
              {pair.a.libelle}
              <span className="text-muted-foreground mx-1.5 font-normal">↔</span>
              {pair.b.libelle}
            </p>
            <div className="flex items-baseline gap-2">
              <span
                className="text-5xl md:text-6xl font-bold tabular-nums leading-none"
                style={{ color: accentColor }}
              >
                {Math.round(pair.accord).toLocaleString(locale)}
              </span>
              <span className="text-xl text-muted-foreground">%</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {t('heroPairScrutins', { count: pair.nb })}
            </p>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </div>
    );
  };

  const renderMergedPairCard = (
    chambreKey: 'AN' | 'SN',
    top: Pair[],
    bot: Pair[]
  ) => {
    if (top.length === 0 && bot.length === 0) return null;
    const titleKey = chambreKey === 'AN' ? 'pairsANTitle' : 'pairsSNTitle';
    const descKey = chambreKey === 'AN' ? 'pairsANDesc' : 'pairsSNDesc';
    const noteKey = chambreKey === 'AN' ? 'pairsANNote' : 'pairsSNNote';
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t(titleKey)}</CardTitle>
          <CardDescription>{t(descKey)}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-8">
            {top.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span
                    className="inline-flex items-center justify-center rounded-full"
                    style={{
                      width: 22,
                      height: 22,
                      backgroundColor: `${COLOR}1a`,
                      color: COLOR,
                    }}
                  >
                    <Handshake className="h-3.5 w-3.5" />
                  </span>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('pairsAlignedLabel')}
                  </h4>
                </div>
                <ol className="space-y-3">
                  {top.map((p, i) => renderPairItem(p, i, `${chambreKey}-top`, 'high'))}
                </ol>
              </div>
            )}
            {bot.length > 0 && (
              <div className={top.length > 0 ? 'pt-6 border-t border-border' : ''}>
                <div className="flex items-center gap-2 mb-4">
                  <span
                    className="inline-flex items-center justify-center rounded-full"
                    style={{
                      width: 22,
                      height: 22,
                      backgroundColor: `color-mix(in srgb, ${COLOR_OPPOSE} 10%, transparent)`,
                      color: COLOR_OPPOSE,
                    }}
                  >
                    <Swords className="h-3.5 w-3.5" />
                  </span>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('pairsOpposedLabel')}
                  </h4>
                </div>
                <ol className="space-y-3">
                  {bot.map((p, i) => renderPairItem(p, i, `${chambreKey}-bot`, 'low'))}
                </ol>
              </div>
            )}
          </div>
        </CardContent>
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{t(noteKey)}</p>
        </div>
      </Card>
    );
  };

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
          best1,
          best2,
          worst,
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Hero */}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('heroTitle')}</CardTitle>
          <CardDescription>{t('heroDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {heroTile(t('heroBestPairAN'), anTop[0], 'high')}
            {heroTile(t('heroWorstPairAN'), anBot[0], 'low')}
            {heroTile(t('heroBestPairSN'), snTop[0], 'high')}
            {heroTile(t('heroWorstPairSN'), snBot[0], 'low')}
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
          { value: 'perimetre', title: t('concept1Title'), desc: t('concept1Desc') },
          { value: 'accord-strict', title: t('concept2Title'), desc: t('concept2Desc') },
          { value: 'position-majoritaire', title: t('concept3Title'), desc: t('concept3Desc') },
          { value: 'seuil', title: t('concept4Title'), desc: t('concept4Desc') },
          { value: 'lecture', title: t('concept5Title'), desc: t('concept5Desc') },
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

      <div className="space-y-8 mb-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {an.groupes.length > 1 && (
            <MatrixHeatmap
              title={t('matrixANTitle')}
              description={t('matrixANDesc')}
              note={t('matrixANNote')}
              groupes={an.groupes}
              values={anMatrix.values}
              threshold={THRESHOLD}
              colorHigh={COLOR}
              colorLow={COLOR_OPPOSE}
              textOnLow="var(--alliances-oppose-texte)"
              formatTooltip={formatTooltip}
              belowThresholdLabel={t('pairBelowThreshold')}
              locale={locale}
            />
          )}
          {sn.groupes.length > 1 && (
            <MatrixHeatmap
              title={t('matrixSNTitle')}
              description={t('matrixSNDesc')}
              note={t('matrixSNNote')}
              groupes={sn.groupes}
              values={snMatrix.values}
              threshold={THRESHOLD}
              colorHigh={COLOR}
              colorLow={COLOR_OPPOSE}
              textOnLow="var(--alliances-oppose-texte)"
              formatTooltip={formatTooltip}
              belowThresholdLabel={t('pairBelowThreshold')}
              locale={locale}
            />
          )}
        </div>

        {/* Paires alignées + opposées, fusionnées par chambre, AN et Sénat côte à côte */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {renderMergedPairCard('AN', anTop, anBot)}
          {renderMergedPairCard('SN', snTop, snBot)}
        </div>
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
          <span>{t('methodologyCalcul')}</span>
        </p>
        <p className="flex gap-3">
          <Users className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyPositionMajoritaire')}</span>
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
      <ExploreSection color={COLOR} currentHref="/Facts/alliances" locale={locale} />
    </div>
  );
}
