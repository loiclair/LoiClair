// Page `/Facts/representativite/metiers` : familles socioprofessionnelles déclarées
// par les parlementaires en exercice, comparées à la population des 15 ans ou plus
// (`INSEE_PCS_REFERENCE`). Server Component statique qui lit `acteurs` et `organes`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { getParliamentCounts } from '@/lib/parliament-counts';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import { DonutChart } from '@/components/ui/DonutChart';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import {
  Target,
  ListChecks,
  Scale,
  Filter,
  AlertTriangle,
} from 'lucide-react';
import { ComparisonBarChart } from './ComparisonBarChart';
import { StackedFamsByGroupChart } from './StackedFamsByGroupChart';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerMetiersRepresentants' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/representativite/metiers'),
    openGraph: buildOpenGraph(locale, '/Facts/representativite/metiers', title, description),
  };
}

const COLOR = '#7c3aed';
const COLOR_FRANCE = '#94a3b8';

type Acteur = {
  uid: string;
  libelle_profession: string | null;
  fam_soc_pro: string | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  groupe: string | null;
};

// Familles PCS canoniques — aligne les variantes de casse/typo renvoyées
// par l'open data ("Professions intermédiaires" vs "Professions Intermédiaires", etc.).
const FAM_CADRES = 'Cadres et professions intellectuelles supérieures';
const FAM_INTER = 'Professions intermédiaires';
const FAM_ARTISANS = "Artisans, commerçants, chefs d'entreprise";
const FAM_EMPLOYES = 'Employés';
const FAM_OUVRIERS = 'Ouvriers';
const FAM_AGRI = 'Agriculteurs exploitants';
const FAM_RETRAITES = 'Retraités';
const FAM_AUTRES_SANS = 'Autres personnes sans activité professionnelle';

// « Sans profession déclarée » n'est pas une donnée manquante : c'est la valeur que
// l'open data de l'Assemblée écrit pour des députés qui ont pourtant un libellé de
// métier (au 2026-10-29, sur 39 : 20 retraités, 11 sans activité, 5 actifs, 3 sans
// libellé exploitable), et aucun député n'y est classé « Retraités » ni « Autres
// personnes sans activité ». On les range donc d'après `libelle_profession` ; sans
// libellé exploitable, ils sortent des parts, comme une famille absente. Sans cette
// règle, le préfixe `sans` plus bas les rangeait tous dans « Autres personnes sans
// activité professionnelle », alors que la méthodologie annonçait les exclure.
const familleDepuisLibelle = (libelle: string | null): string | null => {
  const l = (libelle ?? '').toLowerCase().trim();
  if (!l) return null;
  if (/^(ancien|retrait)/.test(l)) return FAM_RETRAITES;
  if (/^(personne diverse|[eé]l[eè]ve|sans activit)/.test(l) || l === 'sans profession') {
    return FAM_AUTRES_SANS;
  }
  if (l.startsWith('agriculteur')) return FAM_AGRI;
  if (/cadre|ing[eé]nieur|psycholog/.test(l)) return FAM_CADRES;
  return null;
};

const normalizeFam = (raw: string | null, libelle: string | null): string | null => {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (s.startsWith('sans profession')) return familleDepuisLibelle(libelle);
  if (s.startsWith('cadres')) return FAM_CADRES;
  if (s.startsWith('professions intermédiaires') || s.startsWith('profession intermédiaire'))
    return FAM_INTER;
  if (s.startsWith('artisans')) return FAM_ARTISANS;
  if (s.startsWith('employés') || s.startsWith('employes')) return FAM_EMPLOYES;
  if (s.startsWith('ouvriers')) return FAM_OUVRIERS;
  if (s.startsWith('agriculteurs')) return FAM_AGRI;
  if (s.startsWith('retraités') || s.startsWith('retraites')) return FAM_RETRAITES;
  if (s.startsWith('autres') || s.startsWith('sans') || s.startsWith('aucune'))
    return FAM_AUTRES_SANS;
  return raw;
};

const normalizeLibelle = (raw: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let s = trimmed
    .replace(/\bAvocate\b/gi, 'Avocat')
    .replace(/\bMédecine\b/gi, 'Médecin')
    .replace(/\bIngénieure\b/gi, 'Ingénieur')
    .replace(/\bProfesseure\b/gi, 'Professeur')
    .replace(/\bInfirmière\b/gi, 'Infirmier')
    .replace(/\bDirectrice\b/gi, 'Directeur')
    .replace(/\bEnseignante\b/gi, 'Enseignant')
    .replace(/\bConsultante\b/gi, 'Consultant')
    .replace(/\bJuriste\b/gi, 'Juriste');
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s;
};

// Référence INSEE — Recensement de la population 2023 (géographie au 1er janvier
// 2026, même millésime que la page Géographie), population de 15 ans ou plus par
// groupe socioprofessionnel (actuel ou antérieur, 8 familles CS8).
// Source : https://www.insee.fr/fr/statistiques/2011101?geo=FRANCE-1 (table POP T7,
// colonne 2023). La table portait le numéro POP T5 et les valeurs de 2022 avant
// le 2026-10-29 : le recensement 2022 donnait 3,6 / 10,7 / 14,4 / 15,3 / 11,6 /
// 27,8 / 15,9 % pour artisans, cadres, intermédiaires, employés, ouvriers,
// retraités et autres inactifs.
const INSEE_PCS_REFERENCE: Record<string, number> = {
  [FAM_AGRI]: 0.7,
  [FAM_ARTISANS]: 3.8,
  [FAM_CADRES]: 11.1,
  [FAM_INTER]: 14.2,
  [FAM_EMPLOYES]: 15.2,
  [FAM_OUVRIERS]: 11.4,
  [FAM_RETRAITES]: 27.9,
  [FAM_AUTRES_SANS]: 15.7,
};

const FAM_ORDER = [
  FAM_RETRAITES,
  FAM_AUTRES_SANS,
  FAM_EMPLOYES,
  FAM_INTER,
  FAM_CADRES,
  FAM_OUVRIERS,
  FAM_ARTISANS,
  FAM_AGRI,
];

// Libellé PCS officiel → clé stable de `answerMetiersRepresentants.famShort`,
// où vit la forme courte affichée sur l'axe des graphiques (les noms PCS sont
// trop longs pour tenir sans troncature, surtout sur mobile).
//
// La table rend une clé et non un texte : ces valeurs identifient aussi les
// colonnes de la frise empilée, et un libellé traduit y ferait des séries vides
// dans l'autre langue, sans erreur ni warning.
const FAM_KEY: Record<string, string> = {
  [FAM_CADRES]: 'cadres',
  [FAM_INTER]: 'inter',
  [FAM_EMPLOYES]: 'employes',
  [FAM_OUVRIERS]: 'ouvriers',
  [FAM_ARTISANS]: 'artisans',
  [FAM_AGRI]: 'agri',
  [FAM_RETRAITES]: 'retraites',
  [FAM_AUTRES_SANS]: 'sans',
};

// Métadonnées utilisées par la frise empilée (chart 3) : un id stable par
// famille et une couleur distincte. Le libellé est résolu au rendu.
const FAM_STACK_META: { key: string; fam: string; color: string }[] = [
  { key: 'cadres', fam: FAM_CADRES, color: '#7c3aed' },
  { key: 'inter', fam: FAM_INTER, color: '#a78bfa' },
  { key: 'employes', fam: FAM_EMPLOYES, color: '#60a5fa' },
  { key: 'ouvriers', fam: FAM_OUVRIERS, color: '#f59e0b' },
  { key: 'artisans', fam: FAM_ARTISANS, color: '#fb923c' },
  { key: 'agri', fam: FAM_AGRI, color: '#84cc16' },
  { key: 'retraites', fam: FAM_RETRAITES, color: '#94a3b8' },
  { key: 'sans', fam: FAM_AUTRES_SANS, color: '#cbd5e1' },
];

export default async function AnswerMetiersRepresentantsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerMetiersRepresentants' });
  const counts = await getParliamentCounts();

  // Forme courte d'une famille socioprofessionnelle. Une famille hors table
  // (nouveau libellé PCS côté source) sort avec son nom officiel.
  const famLabel = (fam: string): string => {
    const key = FAM_KEY[fam];
    return key ? t(`famShort.${key}`) : fam;
  };

  const [acteurs, organes] = await Promise.all([
    sql<Acteur[]>`
      select uid, libelle_profession, fam_soc_pro, est_depute_actuel, est_senateur_actuel, groupe
      from acteurs
      where (est_depute_actuel = true or est_senateur_actuel = true)
      limit 2000`,
    sql<{ uid: string; libelle_abrege: string | null; libelle: string | null }[]>`
      select uid, libelle_abrege, libelle
      from organes
      where code_type = any(${['GP', 'GROUPESENAT']})`,
  ]);

  const organesMap = new Map<string, string>(
    organes.map((o) => [
      o.uid,
      o.libelle || o.libelle_abrege || o.uid,
    ])
  );

  const totalElus = acteurs.length;
  const nbDeputes = acteurs.filter((a) => a.est_depute_actuel).length;
  const nbSenateurs = acteurs.filter((a) => a.est_senateur_actuel).length;

  const acteursNorm = acteurs.map((a) => ({
    ...a,
    famNorm: normalizeFam(a.fam_soc_pro, a.libelle_profession),
    libNorm: normalizeLibelle(a.libelle_profession),
  }));

  const famCounts = new Map<string, number>();
  for (const a of acteursNorm) {
    if (!a.famNorm) continue;
    famCounts.set(a.famNorm, (famCounts.get(a.famNorm) ?? 0) + 1);
  }
  const avecFam = [...famCounts.values()].reduce((s, v) => s + v, 0);
  const nbSansDonnee = totalElus - avecFam;

  const pct = (n: number, base: number) =>
    base > 0 ? Math.round((n * 1000) / base) / 10 : 0;

  const famCadresParlement = famCounts.get(FAM_CADRES) ?? 0;
  const pctCadresParlement = pct(famCadresParlement, avecFam);
  const pctCadresFrance = INSEE_PCS_REFERENCE[FAM_CADRES];
  const famOuvriersEmp =
    (famCounts.get(FAM_OUVRIERS) ?? 0) + (famCounts.get(FAM_EMPLOYES) ?? 0);
  const pctOuvriersEmpParlement = pct(famOuvriersEmp, avecFam);
  const pctOuvriersEmpFrance =
    INSEE_PCS_REFERENCE[FAM_OUVRIERS] + INSEE_PCS_REFERENCE[FAM_EMPLOYES];

  // Mêmes parts, retraités et personnes sans activité retirés des deux côtés. La
  // comparaison principale reste celle des 15 ans ou plus (D-047) ; cette ligne
  // répond à l'objection « vous comparez des élus à une population à moitié
  // inactive », en montrant que l'écart tient aussi entre actifs.
  const actifsParlement =
    avecFam - (famCounts.get(FAM_RETRAITES) ?? 0) - (famCounts.get(FAM_AUTRES_SANS) ?? 0);
  const actifsFrance =
    100 - INSEE_PCS_REFERENCE[FAM_RETRAITES] - INSEE_PCS_REFERENCE[FAM_AUTRES_SANS];
  const pctCadresActifs = pct(famCadresParlement, actifsParlement);
  const pctCadresActifsFrance = pct(pctCadresFrance, actifsFrance);
  const pctOuvriersEmpActifs = pct(famOuvriersEmp, actifsParlement);
  const pctOuvriersEmpActifsFrance = pct(pctOuvriersEmpFrance, actifsFrance);

  const comparisonData = FAM_ORDER.map((fam) => ({
    groupe: famLabel(fam),
    serie1: pct(famCounts.get(fam) ?? 0, avecFam),
    serie2: INSEE_PCS_REFERENCE[fam] ?? 0,
  }));

  const donutData = [...famCounts.entries()]
    .map(([name, size]) => ({ name, size }))
    .sort((a, b) => b.size - a.size);

  const libCounts = new Map<string, number>();
  for (const a of acteursNorm) {
    if (!a.libNorm) continue;
    libCounts.set(a.libNorm, (libCounts.get(a.libNorm) ?? 0) + 1);
  }
  const topLibData = [...libCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ groupe: `${name} (${count})`, value: count }));

  const famAN = new Map<string, number>();
  const famSN = new Map<string, number>();
  for (const a of acteursNorm) {
    if (!a.famNorm) continue;
    if (a.est_depute_actuel) famAN.set(a.famNorm, (famAN.get(a.famNorm) ?? 0) + 1);
    if (a.est_senateur_actuel) famSN.set(a.famNorm, (famSN.get(a.famNorm) ?? 0) + 1);
  }
  const totalAN = [...famAN.values()].reduce((s, v) => s + v, 0);
  const totalSN = [...famSN.values()].reduce((s, v) => s + v, 0);
  const chambreData = FAM_ORDER.map((fam) => ({
    groupe: famLabel(fam),
    serie1: pct(famAN.get(fam) ?? 0, totalAN),
    serie2: pct(famSN.get(fam) ?? 0, totalSN),
  }));

  type GroupeAcc = { total: number; fams: Map<string, number> };
  const byGroupe = new Map<string, GroupeAcc>();
  for (const a of acteursNorm) {
    if (!a.groupe || !a.famNorm) continue;
    const acc = byGroupe.get(a.groupe) ?? { total: 0, fams: new Map() };
    acc.total++;
    acc.fams.set(a.famNorm, (acc.fams.get(a.famNorm) ?? 0) + 1);
    byGroupe.set(a.groupe, acc);
  }
  const groupeRows = [...byGroupe.entries()]
    .filter(([, acc]) => acc.total >= 5)
    .map(([uid, acc]) => {
      const row: Record<string, string | number> = {
        groupe: `${organesMap.get(uid) ?? uid} (${acc.total})`,
      };
      for (const meta of FAM_STACK_META) {
        row[meta.key] = pct(acc.fams.get(meta.fam) ?? 0, acc.total);
      }
      return row as { groupe: string } & Record<string, string | number>;
    })
    .sort((a, b) => Number(b.cadres) - Number(a.cadres));

  // Ligne de référence INSEE — population française des 15 ans ou plus.
  // Placée en tête pour servir de repère visuel à la lecture des groupes.
  const franceRow: { groupe: string } & Record<string, string | number> = {
    groupe: t('groupesChartFranceLabel'),
  };
  for (const meta of FAM_STACK_META) {
    franceRow[meta.key] = INSEE_PCS_REFERENCE[meta.fam] ?? 0;
  }
  const famsParGroupeData = [franceRow, ...groupeRows];

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
          // Le dénominateur des parts, et non tous les élus en exercice : les
          // élus sans profession connue sortent des pourcentages.
          total: avecFam.toLocaleString(locale),
          pctCadres: pctCadresParlement.toLocaleString(locale),
          pctCadresFrance: pctCadresFrance.toLocaleString(locale),
          pctOuvriersEmp: pctOuvriersEmpParlement.toLocaleString(locale),
          pctOuvriersEmpFrance: pctOuvriersEmpFrance.toLocaleString(locale),
          pctCadresActifs: pctCadresActifs.toLocaleString(locale),
          pctCadresActifsFrance: pctCadresActifsFrance.toLocaleString(locale),
          pctOuvriersEmpActifs: pctOuvriersEmpActifs.toLocaleString(locale),
          pctOuvriersEmpActifsFrance: pctOuvriersEmpActifsFrance.toLocaleString(locale),
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Visuel principal — LE graphique de la page */}
      <div className="mb-12">
        <ComparisonBarChart
          data={comparisonData}
          title={t('heroChartTitle')}
          description={t('heroChartDesc')}
          serie1Label={t('heroSerieParlement')}
          serie2Label={t('heroSerieFrance')}
          serie1Color={COLOR}
          serie2Color={COLOR_FRANCE}
          note={t('heroChartNote', { avecFam, sansFam: nbSansDonnee })}
          labelWidth={160}
          labelMaxChars={22}
        />
      </div>

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

        <AccordionItem value="declaration">
          <AccordionTrigger className="hover:no-underline">
            {t('concept2Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept2Desc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="pcs">
          <AccordionTrigger className="hover:no-underline">
            {t('concept3Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept3Desc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="cadre">
          <AccordionTrigger className="hover:no-underline">
            {t('concept4Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept4Desc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="active">
          <AccordionTrigger className="hover:no-underline">
            {t('concept5Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept5Desc')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="limits">
          <AccordionTrigger className="hover:no-underline">
            {t('concept6Title')}
          </AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">{t('concept6Desc')}</p>
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
        {donutData.length > 0 && (
          <DonutChart
            data={donutData}
            title={t('donutChartTitle')}
            description={t('donutChartDesc')}
            tooltipLabel={t('donutChartLabel')}
            note={t('donutChartNote', { avecFam, sansFam: nbSansDonnee })}
            colors={['#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#ede9fe', '#f5f3ff', '#faf5ff']}
          />
        )}

        {topLibData.length > 0 && (
          <GroupeBarChart
            data={topLibData}
            title={t('topLibChartTitle')}
            description={t('topLibChartDesc')}
            color={COLOR}
            valueLabel={t('topLibChartLabel')}
            note={t('topLibChartNote')}
            labelWidth={270}
            labelMaxChars={34}
          />
        )}

        <ComparisonBarChart
          data={chambreData}
          title={t('chambreChartTitle')}
          description={t('chambreChartDesc')}
          serie1Label={t('chambreSerieAN', { n: nbDeputes })}
          serie2Label={t('chambreSerieSN', { n: nbSenateurs })}
          serie1Color="#7c3aed"
          serie2Color="#c4b5fd"
          note={t('chambreChartNote', { an: totalAN, sn: totalSN })}
          labelWidth={160}
          labelMaxChars={22}
        />

      </div>

      {famsParGroupeData.length > 0 && (
        <div className="mb-16">
          <StackedFamsByGroupChart
            data={famsParGroupeData}
            segments={FAM_STACK_META.map((m) => ({
              key: m.key,
              label: famLabel(m.fam),
              color: m.color,
            }))}
            title={t('groupesChartTitle')}
            description={t('groupesChartDesc')}
            note={t('groupesChartNote')}
            labelWidth={220}
            labelMaxChars={30}
          />
        </div>
      )}

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
          <span>{t('methodologyPerimeter', { an: counts.an, sn: counts.sn, total: counts.total })}</span>
        </p>
        <p className="flex gap-3">
          <ListChecks className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyData')}</span>
        </p>
        <p className="flex gap-3">
          <Scale className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyComparison')}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyExclusions', { count: nbSansDonnee })}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimit')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Facts/representativite/metiers" locale={locale} />
    </div>
  );
}
