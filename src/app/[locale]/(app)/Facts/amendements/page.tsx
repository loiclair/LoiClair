// Page `/Facts/amendements` : volume et adoption des amendements sur les lois
// promulguées. Server Component statique. Totaux et moyennes viennent de
// `getAmendementsTotaux()`, partagé avec `/etat-des-lieux` ; les volumes par groupe
// politique, de la colonne `dossiers_legislatifs.amendements_par_groupe` des mêmes
// lois, donc au groupe de l'auteur le jour du dépôt (D-278, D-280).
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
import { StackedBarChart } from '@/components/ui/StackedBarChart';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, GitMerge, AlertTriangle, Users } from 'lucide-react';
import { LEGISLATURE_17_START, PROCEDURE_KEY, PROCEDURES_FINANCIERES, PROCEDURES_PROMULGABLES } from '@/lib/facts-shared';
import { getAmendementsTotaux } from '@/lib/facts-queries';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { estNonInscrits } from '@/lib/non-inscrits';
import { boxStats } from '@/lib/stats';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerAmendements' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/amendements'),
    openGraph: buildOpenGraph(locale, '/Facts/amendements', title, description),
  };
}

const COLOR = '#059669';
const COLOR_NON_INSCRITS = '#94a3b8'; // gris : pas un groupe politique (D-313)

// Une ligne de `dossiers_legislatifs.amendements_par_groupe` (forme documentée dans
// la migration 2026-10-25_amendements_par_groupe.sql). Seules les lignes de type
// `groupe` portent un uid d'organe ; gouvernement, commission et non publiés n'ont
// pas de groupe.
type RepartitionLigne = { chambre: 'AN' | 'SN'; type: string; groupe: string | null; deposes: number };

export default async function AmendementsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerAmendements' });
  const tTypes = await getTranslations({ locale, namespace: 'textTypes' });
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });

  // Forme courte affichable d'une procédure. Un libellé absent de `PROCEDURE_KEY`
  // (procédure rare, ou nouvelle côté Assemblée) sort tel quel, donc en français :
  // mieux vaut le libellé officiel qu'un trou dans le graphique.
  const procedureLabel = (libelle: string | null | undefined): string => {
    const key = PROCEDURE_KEY[libelle ?? ''];
    return key ? tTypes(`short.${key}`) : (libelle ?? t('procedureOther'));
  };

  // Les totaux globaux viennent du helper partagé avec /etat-des-lieux : cette page
  // doit afficher le même taux d'adoption que la tuile du tableau de bord.
  const [{ dossiers, totalDeposes, tauxAdoption, medianeDeposes, horsFinancieres }, repartitionRows, effectifRows] = await Promise.all([
    getAmendementsTotaux(),
    // Répartition par groupe de ces lois : mêmes filtres que `getAmendementsTotaux`
    // (recoupés plus bas par uid, pour que les deux ne dérivent pas). Une lecture
    // à part plutôt qu'une colonne de plus dans le helper : `/etat-des-lieux` le
    // partage et n'a pas besoin de ce jsonb (106 Ko pour les 83 lois du
    // 2026-10-29, mesurés bruts).
    sql<{ uid: string; amendements_par_groupe: RepartitionLigne[] | null }[]>`
      select uid, amendements_par_groupe
      from dossiers_legislatifs
      where date_depot >= ${LEGISLATURE_17_START}
        and date_promulgation is not null
        and nb_amendements_deposes > 0
        and procedure_libelle = any(${[...PROCEDURES_PROMULGABLES]})
      order by uid`,
    // Effectif d'aujourd'hui de chaque groupe, pour la moyenne par élu : la
    // répartition ne dit pas qui a déposé, seulement combien.
    sql<{ uid: string; groupe: string }[]>`
      select uid, groupe
      from acteurs
      where en_exercice = true
        and (est_depute_actuel = true or est_senateur_actuel = true)
        and groupe is not null
      order by uid`,
  ]);

  const moyenneTous = dossiers.length > 0 ? Math.round(totalDeposes / dossiers.length) : 0;
  const pctFinancieres = totalDeposes > 0
    ? Math.round(((totalDeposes - horsFinancieres.deposes) / totalDeposes) * 100)
    : 0;

  // ── Bar chart par procédure ──────────────────────────────────────────────
  // L'identifiant de groupe est la clé de procédure, jamais son libellé affiché :
  // c'est la seule façon que les trois cartes « lois financières » se remplissent
  // à l'identique dans les deux langues.
  type ProcedureGroup = { key: string; label: string; deposesTotal: number; adoptesTotal: number };
  const byProcedure = new Map<string, ProcedureGroup>();
  for (const d of dossiers) {
    const key = PROCEDURE_KEY[d.procedure_libelle ?? ''] ?? d.procedure_libelle ?? 'autre';
    const existing = byProcedure.get(key);
    if (existing) {
      existing.deposesTotal += d.nb_amendements_deposes ?? 0;
      existing.adoptesTotal += d.nb_amendements_adoptes ?? 0;
    } else {
      byProcedure.set(key, {
        key,
        label: procedureLabel(d.procedure_libelle),
        deposesTotal: d.nb_amendements_deposes ?? 0,
        adoptesTotal: d.nb_amendements_adoptes ?? 0,
      });
    }
  }

  const procedureGroups = Array.from(byProcedure.values()).sort(
    (a, b) => b.deposesTotal - a.deposesTotal
  );
  const procedureGroupsStd = procedureGroups.filter(
    (g) => !PROCEDURES_FINANCIERES.has(g.key)
  );
  const procedureGroupsFin = procedureGroups.filter(
    (g) => PROCEDURES_FINANCIERES.has(g.key)
  );

  // Graphique stacké : déposés = adoptés + non-adoptés
  const stackedData = procedureGroupsStd.map((g) => ({
    label: g.label,
    adoptes: g.adoptesTotal,
    nonAdoptes: g.deposesTotal - g.adoptesTotal,
    total: g.deposesTotal,
  }));

  // ── BoxPlot par procédure (≥ 5 lois) ────────────────────────────────────
  const deposByProcedure = new Map<string, { label: string; valeurs: number[] }>();
  for (const d of dossiers) {
    const key = PROCEDURE_KEY[d.procedure_libelle ?? ''] ?? d.procedure_libelle ?? 'autre';
    const entry = deposByProcedure.get(key) ?? { label: procedureLabel(d.procedure_libelle), valeurs: [] };
    entry.valeurs.push(d.nb_amendements_deposes ?? 0);
    deposByProcedure.set(key, entry);
  }

  const boxData = Array.from(deposByProcedure.values())
    .filter((e) => e.valeurs.length >= 5)
    .map((e) => ({ label: e.label, countLabel: t('countLabelLois'), ...boxStats(e.valeurs) }))
    .sort((a, b) => b.median - a.median);

  // ── Groupes politiques ───────────────────────────────────────────────────
  // `total` : amendements déposés sur ces lois sous le groupe de leur auteur le jour
  // du dépôt. `count` : effectif en exercice aujourd'hui, dénominateur de la moyenne
  // par élu ; il vaut 0 pour un groupe dissous, qui n'a alors pas de barre de moyenne.
  type GroupeAgg = { total: number; count: number; hasAN: boolean; hasSN: boolean };
  const groupeAgg = new Map<string, GroupeAgg>();
  const uidsLois = new Set(dossiers.map((d) => d.uid));
  for (const row of repartitionRows) {
    if (!uidsLois.has(row.uid)) continue;
    for (const r of row.amendements_par_groupe ?? []) {
      if (r.type !== 'groupe' || !r.groupe) continue;
      const existing = groupeAgg.get(r.groupe) ?? { total: 0, count: 0, hasAN: false, hasSN: false };
      existing.total += r.deposes;
      if (r.chambre === 'AN') existing.hasAN = true;
      if (r.chambre === 'SN') existing.hasSN = true;
      groupeAgg.set(r.groupe, existing);
    }
  }
  for (const a of effectifRows) {
    const g = groupeAgg.get(a.groupe);
    if (g) g.count += 1;
  }

  const groupeUids = Array.from(groupeAgg.keys());
  const organesRaw = await sql<{
    uid: string;
    libelle: string | null;
    libelle_abrege: string | null;
    couleur_associee: string | null;
  }[]>`
    select uid, libelle, libelle_abrege, couleur_associee
    from organes
    where uid = any(${groupeUids})`;

  const chambreTag = (g: GroupeAgg) =>
    g.hasAN && g.hasSN ? t('tagANSN') : g.hasAN ? t('tagAN') : t('tagSN');

  type GroupeBarItem = { groupe: string; value: number; fill: string; nonInscrit: boolean };

  // Les non-inscrits ne forment pas un groupe (D-313) : leur barre reste, étiquetée
  // de sa chambre (les deux organes portent des libellés proches), mais elle ne se
  // classe pas, elle vient après tous les groupes, en gris. Ils n'entrent dans aucune
  // moyenne de la page : les moyennes par élu sont par groupe, les totaux sont des sommes.
  const libelleGroupe = (o: { libelle: string | null; libelle_abrege: string | null; uid: string }, g: GroupeAgg) =>
    estNonInscrits(o.libelle_abrege)
      ? t(g.hasAN ? 'libelleNonInscritsAN' : 'libelleNonInscritsSN')
      : (o.libelle ?? o.libelle_abrege ?? o.uid) + chambreTag(g);
  const couleurGroupe = (o: { libelle_abrege: string | null; couleur_associee: string | null }) =>
    estNonInscrits(o.libelle_abrege) ? COLOR_NON_INSCRITS : resolveGroupeColor(o.couleur_associee, COLOR);
  const parValeurNonInscritsEnDernier = (a: GroupeBarItem, b: GroupeBarItem) =>
    Number(a.nonInscrit) - Number(b.nonInscrit) || b.value - a.value;

  const groupeTotalData: GroupeBarItem[] = organesRaw
    .map((o) => {
      const g = groupeAgg.get(o.uid);
      if (!g || g.total < 200) return null;
      return {
        groupe: libelleGroupe(o, g),
        value: g.total,
        fill: couleurGroupe(o),
        nonInscrit: estNonInscrits(o.libelle_abrege),
      };
    })
    .filter((x): x is GroupeBarItem => x !== null)
    .sort(parValeurNonInscritsEnDernier);

  const groupeMoyData: GroupeBarItem[] = organesRaw
    .map((o) => {
      const g = groupeAgg.get(o.uid);
      if (!g || g.count < 5) return null;
      return {
        groupe: libelleGroupe(o, g),
        value: Math.round(g.total / g.count),
        fill: couleurGroupe(o),
        nonInscrit: estNonInscrits(o.libelle_abrege),
      };
    })
    .filter((x): x is GroupeBarItem => x !== null)
    .sort(parValeurNonInscritsEnDernier);

  // Valeurs dynamiques pour la note groupeMoy
  const findGroupeMoy = (abrege: string): number | null => {
    const organe = organesRaw.find((o) => o.libelle_abrege === abrege);
    if (!organe) return null;
    const g = groupeAgg.get(organe.uid);
    if (!g || g.count < 5) return null;
    return Math.round(g.total / g.count);
  };
  const gdrMoy = findGroupeMoy('GDR');
  const lrMoy = findGroupeMoy('LR');

  // ── Top 10 ───────────────────────────────────────────────────────────────
  const top10 = dossiers.slice(0, 10);

  return (
    <div className="py-12">
      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLOR }}>
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          totalAvecFin: totalDeposes.toLocaleString(locale),
          // La médiane par loi, lois financières comprises.
          medianeDeposes: medianeDeposes.toLocaleString(locale),
          totalAmendements: horsFinancieres.deposes.toLocaleString(locale),
          tauxAdoption: horsFinancieres.tauxAdoption.toLocaleString(locale),
          pctFinancieres: pctFinancieres.toLocaleString(locale),
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Hero — métriques clés */}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('heroTitle')}</CardTitle>
          <CardDescription>
            {t('heroDesc', { count: dossiers.length })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              // Le taux est formaté par `Intl` plutôt que suivi d'une unité « % » :
              // le `gap-1` de la ligne mettrait un espace avant le signe, juste en
              // français et fautif en anglais. Les vraies unités, elles, gardent
              // leur espace dans les deux langues.
              { label: t('heroStatTaux'), value: pourcent.format(tauxAdoption / 100), unit: '' },
              { label: t('heroStatTotal'), value: totalDeposes.toLocaleString(locale), unit: '' },
              { label: t('heroStatMoyenne'), value: moyenneTous.toLocaleString(locale), unit: t('unitAmend') },
            ].map((row) => (
              <div key={row.label} className="flex flex-col items-start md:items-center text-left md:text-center">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  {row.label}
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-5xl font-bold tabular-nums" style={{ color: COLOR }}>
                    {row.value}
                  </span>
                  {row.unit && (
                    <span className="text-xl text-muted-foreground">{row.unit}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-6 leading-relaxed">{t('heroNote')}</p>
        </CardContent>
      </Card>

      {/* ② À COMPRENDRE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: COLOR }}>
        {t('conceptsTitle')}
      </h2>
      <Accordion type="multiple" className="mb-12">
        {[
          { value: 'perimetre', title: t('conceptPerimetre'), desc: t('conceptPerimetreBody') },
          { value: 'amendement', title: t('conceptAmendement'), desc: t('conceptAmendementBody') },
          { value: 'qui-depose', title: t('conceptQuiDepose'), desc: t('conceptQuiDeposeBody') },
          { value: 'adopte', title: t('conceptAdopte'), desc: t('conceptAdopteBody') },
          { value: 'navette', title: t('conceptNavette'), desc: t('conceptNavetteBody') },
        ].map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="hover:no-underline">{item.title}</AccordionTrigger>
            <AccordionContent>
              <p className="text-foreground/80 leading-relaxed">{item.desc}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* ③ EN CHIFFRES */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-8" style={{ color: COLOR }}>
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">

        {/* Graphique stacké : déposés = adoptés + non-adoptés */}
        {stackedData.length > 0 && (
          <div className="md:col-span-2">
            <StackedBarChart
              data={stackedData}
              title={t('barTitle')}
              description={t('barDescDepose')}
              color={COLOR}
              locale={locale}
              labelAdoptes={t('legendAdoptes')}
              labelNonAdoptes={t('legendNonAdoptes')}
              tooltipDeposes={t('tooltipDeposes')}
              tooltipAdoptes={t('tooltipAdoptes')}
              note={t('barNote')}
              labelWidth={310}
              labelMaxChars={40}
            />
          </div>
        )}

        {/* Callout lois financières */}
        {procedureGroupsFin.length > 0 && (
          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('barFinancieresTitle')}</CardTitle>
                <CardDescription>{t('barFinancieresDesc', { pctFinancieres })}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {procedureGroupsFin.map((g) => {
                    const taux = g.deposesTotal > 0
                      ? Math.round((g.adoptesTotal / g.deposesTotal) * 100)
                      : 0;
                    return (
                      <div key={g.key} className="rounded-lg border p-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                          {g.label}
                        </p>
                        <p className="text-2xl font-bold tabular-nums" style={{ color: COLOR }}>
                          {g.deposesTotal.toLocaleString(locale)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('financieresCardNote', { taux })}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
              <div className="border-t px-6 py-4">
                <p className="text-sm text-foreground/70 leading-relaxed">{t('barFinancieresNote')}</p>
              </div>
            </Card>
          </div>
        )}

        {/* BoxPlot */}
        {boxData.length > 0 && (
          <div className="md:col-span-2">
            <BoxPlotChart
              data={boxData}
              title={t('boxTitle')}
              description={t('boxDesc')}
              unit={` ${t('unitAmend')}`}
              locale={locale}
              color={COLOR}
              note={t('boxNote')}
              independentScales
              countLabel={t('countLabelLois')}
            />
          </div>
        )}

        {/* Groupes — total absolu */}
        {groupeTotalData.length > 0 && (
          <GroupeBarChart
            data={groupeTotalData}
            title={t('groupeTotalTitle')}
            description={t('groupeTotalDesc')}
            color={COLOR}
            valueLabel={t('valueLabelAmendements')}
            note={t('groupeTotalNote')}
            labelWidth={260}
            labelMaxChars={36}
          />
        )}

        {/* Groupes — moyenne par élu */}
        {groupeMoyData.length > 0 && (
          <GroupeBarChart
            data={groupeMoyData}
            title={t('groupeMoyTitle')}
            description={t('groupeMoyDesc')}
            color={COLOR}
            valueLabel={t('valueLabelAmendParElu')}
            note={t('groupeMoyNote', {
              gdrMoy: gdrMoy != null ? gdrMoy.toLocaleString(locale) : '–',
              lrMoy: lrMoy != null ? lrMoy.toLocaleString(locale) : '–',
            })}
            labelWidth={260}
            labelMaxChars={36}
          />
        )}

        {/* Top 10 */}
        {top10.length > 0 && (
          <div className="md:col-span-2">
            <Card>
              <CardHeader>
                {/* Badge IA des titres traduits (sur /en) en tête de liste : chaque titre est un lien. */}
                <CardTitle>{t('top10Title')}{top10.some((d) => titreTraduit(d, locale)) && <span style={{ marginLeft: '8px', verticalAlign: '2px' }}><AIBadgeTitre pluriel /></span>}</CardTitle>
                <CardDescription>{t('top10Desc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <ol className="space-y-3">
                  {top10.map((d, i) => {
                    const depose = d.nb_amendements_deposes ?? 0;
                    const adopte = d.nb_amendements_adoptes ?? 0;
                    const taux = depose > 0 ? Math.round((adopte / depose) * 100) : 0;
                    const procedureShort = d.procedure_libelle
                      ? procedureLabel(d.procedure_libelle)
                      : '';
                    return (
                      <li key={d.uid} className="flex gap-3 items-start">
                        <span className="text-xs font-medium text-muted-foreground mt-0.5 w-5 shrink-0 text-right">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <Link
                            href={`/dossiers-legislatifs/${d.uid}/resume-ia`}
                            prefetch={false}
                            className="text-sm leading-tight font-medium hover:underline hover:text-primary transition-colors"
                          >
                            {titreDossier(d, locale) || d.uid}
                          </Link>
                          {procedureShort && (
                            <p className="text-xs text-muted-foreground mt-0.5">{procedureShort}</p>
                          )}
                        </div>
                        <div className="flex flex-col items-end shrink-0 mt-0.5">
                          <span className="text-xs tabular-nums font-semibold" style={{ color: COLOR }}>
                            {t('top10Deposes', { count: depose })}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground leading-tight">
                            {t('top10Adoptes', { count: adopte })}
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground leading-tight">
                            {t('pourcentage', { valeur: taux })}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
              <div className="border-t px-6 py-4">
                <p className="text-sm text-foreground/70 leading-relaxed">{t('top10Note')}</p>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* ④ MÉTHODOLOGIE */}
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
          <span>{t('methodologyChambres')}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimit')}</span>
        </p>
        <p className="flex gap-3">
          <GitMerge className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyNavette')}</span>
        </p>
      </div>

      {/* ⑤ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Facts/amendements" locale={locale} />
    </div>
  );
}
