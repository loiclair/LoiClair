// Page `/Facts/succes-legislatif/efficacite` : part des textes de chaque groupe
// adoptés par l'Assemblée, par le Sénat, puis promulgués. Server Component statique
// qui lit `dossiers_legislatifs`, `actes_legislatifs` et `organes`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import {
  LEGISLATURE_17_START,
  PROCEDURES_PROMULGABLES,
  EXCLUS_TOUS,
  EXCLUS_SN_SUPPL,
  isDecisionAN,
  isDecisionSN,
  estPromulgueeOuAppliquee,
} from '@/lib/facts-shared';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { estNonInscrits } from '@/lib/non-inscrits';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Filter, AlertTriangle, Users } from 'lucide-react';
import { EfficaciteCharts, type GroupeEfficaciteSerialized } from './EfficaciteCharts';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerSuccesLegislatifEfficacite' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/succes-legislatif/efficacite'),
    openGraph: buildOpenGraph(locale, '/Facts/succes-legislatif/efficacite', title, description),
  };
}

const COLOR = '#ca8a04';
const GOUV_KEY = '__GOUVERNEMENT__';
const MIN_TEXTES = 10;

type ChambreCode = 'AN' | 'SN' | 'GOUV';

const ACTE_CODES = [
  'AN1-DEBATS-DEC', 'AN2-DEBATS-DEC', 'ANLDEF-DEBATS-DEC', 'ANLUNI-DEBATS-DEC', 'ANNLEC-DEBATS-DEC',
  'CMP-DEBATS-AN-DEC',
  'SN1-DEBATS-DEC', 'SN2-DEBATS-DEC', 'SNNLEC-DEBATS-DEC',
  'CMP-DEBATS-SN-DEC',
];

const estAdopte = (s: string | null) =>
  !!s && (s.toLowerCase().includes('adopt') || s.toLowerCase().includes('modifi') || s.toLowerCase().includes('définitiv'));

export default async function SuccesLegislatifEfficacitePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerSuccesLegislatifEfficacite' });

  const [dossiers, actes, organes] = await Promise.all([
    // Tri sur `uid` : les groupes entrent dans `statsByKey` dans l'ordre des
    // dossiers, et la page rend ses groupes dans cet ordre-là avant tout tri.
    sql<{
      uid: string;
      statut_final: string | null;
      procedure_libelle: string | null;
      initiateur_groupe_uid: string | null;
      initiateur_groupe_libelle: string | null;
    }[]>`
      select uid, statut_final, procedure_libelle, initiateur_groupe_uid, initiateur_groupe_libelle
      from dossiers_legislatifs
      where date_depot >= ${LEGISLATURE_17_START}
      order by uid`,
    sql<{ dossier_uid: string; code_acte: string; statut_conclusion: string | null }[]>`
      select dossier_uid, code_acte, statut_conclusion
      from actes_legislatifs
      where code_acte = any(${ACTE_CODES})`,
    sql<{
      uid: string;
      code_type: string;
      libelle: string | null;
      libelle_abrege: string | null;
      couleur_associee: string | null;
    }[]>`
      select uid, code_type, libelle, libelle_abrege, couleur_associee
      from organes
      where code_type = any(${['GP', 'GROUPESENAT', 'GOUVERNEMENT']})`,
  ]);

  // Info par organe ──────────────────────────────────────────────────────
  type OrganeInfo = { libelle: string; libelleAbrege: string; color: string; chambre: ChambreCode };
  const organeInfo = new Map<string, OrganeInfo>();
  for (const o of organes as {
    uid: string;
    code_type: string;
    libelle: string | null;
    libelle_abrege: string | null;
    couleur_associee: string | null;
  }[]) {
    const chambre: ChambreCode =
      o.code_type === 'GP' ? 'AN' : o.code_type === 'GROUPESENAT' ? 'SN' : 'GOUV';
    organeInfo.set(o.uid, {
      libelle: o.libelle ?? o.libelle_abrege ?? o.uid,
      libelleAbrege: o.libelle_abrege ?? (o.libelle ?? o.uid).slice(0, 3).toUpperCase(),
      color: resolveGroupeColor(o.couleur_associee, COLOR),
      chambre,
    });
  }

  // Dossiers de la législature 17 ─────────────────────────────────────────
  const dossiersUids = new Set(dossiers.map((d) => d.uid as string));

  // Pour chaque dossier, marquer s'il a été adopté AN et/ou SN ────────────
  const adoptesAN = new Set<string>();
  const adoptesSN = new Set<string>();
  for (const a of actes as { dossier_uid: string; code_acte: string; statut_conclusion: string | null }[]) {
    if (!dossiersUids.has(a.dossier_uid)) continue;
    if (!estAdopte(a.statut_conclusion)) continue;
    if (isDecisionAN(a.code_acte)) adoptesAN.add(a.dossier_uid);
    else if (isDecisionSN(a.code_acte)) adoptesSN.add(a.dossier_uid);
  }

  // Agrégation par groupe ─────────────────────────────────────────────────
  const statsByKey = new Map<string, GroupeEfficaciteSerialized>();
  // Textes éligibles à un vote de chambre sans groupe en base : les imports rangent
  // chaque texte dans le groupe de son auteur le jour du dépôt, et il n'en reste que
  // sans auteur identifié dans la source (résolutions, engagements de responsabilité
  // du Gouvernement) ou si l'auteur n'avait aucun groupe ce jour-là. Aucun taux de
  // groupe ne peut les compter : la légende du graphique dit combien il en manque,
  // comme le fait /Facts/succes-legislatif/volume, au lieu de les écarter en silence.
  let sansGroupe = 0;

  for (const d of dossiers as {
    uid: string;
    statut_final: string | null;
    procedure_libelle: string | null;
    initiateur_groupe_uid: string | null;
    initiateur_groupe_libelle: string | null;
  }[]) {
    const uid = d.initiateur_groupe_uid;
    const info = uid ? organeInfo.get(uid) : null;
    const isGouv = info?.chambre === 'GOUV' || d.initiateur_groupe_libelle === 'GOUVERNEMENT';
    const key = isGouv ? GOUV_KEY : uid ?? null;
    if (!key) {
      if (!EXCLUS_TOUS.has(d.procedure_libelle ?? '')) sansGroupe++;
      continue;
    }

    if (!statsByKey.has(key)) {
      // Non-inscrits (D-313) : leur barre reste, étiquetée de sa chambre, mais le
      // graphique la range après les groupes et les moyennes l'ignorent.
      const nonInscrit = !isGouv && estNonInscrits(info?.libelleAbrege);
      statsByKey.set(key, {
        key,
        nonInscrit,
        libelle: isGouv
          ? t('libelleGouvernement')
          : nonInscrit
            ? t(info?.chambre === 'SN' ? 'libelleNonInscritsSN' : 'libelleNonInscritsAN')
            : info?.libelle ?? d.initiateur_groupe_libelle ?? key,
        libelleAbrege: isGouv ? 'GOUV' : info?.libelleAbrege ?? key.slice(0, 3).toUpperCase(),
        color: isGouv ? '#334155' : info?.color ?? COLOR,
        chambre: isGouv ? 'GOUV' : info?.chambre ?? 'AN',
        totalAn: 0,
        totalSn: 0,
        totalPromulgables: 0,
        adoptesAn: 0,
        adoptesSn: 0,
        promulges: 0,
      });
    }
    const s = statsByKey.get(key)!;
    const proc = d.procedure_libelle ?? '';

    if (!EXCLUS_TOUS.has(proc)) {
      s.totalAn++;
      if (adoptesAN.has(d.uid)) s.adoptesAn++;
      if (!EXCLUS_SN_SUPPL.has(proc)) {
        s.totalSn++;
        if (adoptesSN.has(d.uid)) s.adoptesSn++;
      }
    }
    if (PROCEDURES_PROMULGABLES.has(proc)) {
      s.totalPromulgables++;
      if (estPromulgueeOuAppliquee(d.statut_final)) s.promulges++;
    }
  }

  // Seuil : au moins MIN_TEXTES textes éligibles AN ───────────────────────
  const stats = [...statsByKey.values()].filter((s) => s.totalAn >= MIN_TEXTES);

  // Moyennes hero (sur les groupes parlementaires uniquement) ─────────────
  // Les non-inscrits ne forment pas un groupe (D-313) : leur taux reste dans les
  // graphiques, mais n'entre ni dans les moyennes « par groupe » ni dans le choix du
  // meilleur groupe, comme sur les pages volume et victoires.
  const parlementaires = stats.filter((s) => s.chambre !== 'GOUV' && !s.nonInscrit);
  const avg = (nums: number[], dens: number[]): number => {
    const rates = nums
      .map((n, i) => (dens[i] > 0 ? n / dens[i] : null))
      .filter((r): r is number => r !== null);
    if (rates.length === 0) return 0;
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  };

  const moyenneAN = avg(
    parlementaires.map((s) => s.adoptesAn),
    parlementaires.map((s) => s.totalAn),
  );
  const moyenneSN = avg(
    parlementaires.filter((s) => s.totalSn >= MIN_TEXTES).map((s) => s.adoptesSn),
    parlementaires.filter((s) => s.totalSn >= MIN_TEXTES).map((s) => s.totalSn),
  );
  const moyennePromulg = avg(
    parlementaires.filter((s) => s.totalPromulgables >= MIN_TEXTES).map((s) => s.promulges),
    parlementaires.filter((s) => s.totalPromulgables >= MIN_TEXTES).map((s) => s.totalPromulgables),
  );

  // Meilleur groupe en taux de promulgation (hors Gouv) ───────────────────
  const topPromulg = [...parlementaires]
    .filter((s) => s.totalPromulgables >= MIN_TEXTES && s.promulges > 0)
    .map((s) => ({ libelle: s.libelle, taux: s.promulges / s.totalPromulgables }))
    .sort((a, b) => b.taux - a.taux)[0];

  const fmtPct = (x: number) =>
    (x * 100).toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' %';

  return (
    <div className="py-12">
      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLOR }}>
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          tauxAN: fmtPct(moyenneAN),
          tauxSN: fmtPct(moyenneSN),
          tauxPromulg: fmtPct(moyennePromulg),
          topGroupe: topPromulg?.libelle ?? '—',
          topTaux: topPromulg ? fmtPct(topPromulg.taux) : '—',
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Hero : trois cartes moyennes */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
        <HeroCard label={t('heroAdoptionANLabel')} value={moyenneAN} locale={locale} />
        <HeroCard label={t('heroAdoptionSNLabel')} value={moyenneSN} locale={locale} />
        <HeroCard label={t('heroPromulgationLabel')} value={moyennePromulg} locale={locale} />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed mb-10">
        {t.rich('heroCaption', {
          a: (chunks) => (
            <Link href="/Facts/taux-promulgation" className="underline underline-offset-2 hover:text-foreground">
              {chunks}
            </Link>
          ),
        })}
      </p>

      {/* À COMPRENDRE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: COLOR }}>
        {t('conceptsTitle')}
      </h2>
      <Accordion type="multiple" className="mb-12">
        {[
          { value: 'perimetre', title: t('concept1Title'), desc: t('concept1Desc') },
          { value: 'denominateurs', title: t('concept2Title'), desc: t('concept2Desc') },
          { value: 'adoption', title: t('concept3Title'), desc: t('concept3Desc') },
          { value: 'navette', title: t('concept4Title'), desc: t('concept4Desc') },
          { value: 'seuil', title: t('concept5Title'), desc: t('concept5Desc') },
        ].map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="hover:no-underline">{item.title}</AccordionTrigger>
            <AccordionContent>
              <p className="text-foreground/80 leading-relaxed">{item.desc}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
        <AccordionItem value="volume">
          <AccordionTrigger className="hover:no-underline">{t('concept6Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t.rich('concept6Desc', {
                a: (chunks) => (
                  <Link
                    href="/Facts/succes-legislatif/volume"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* ② EN CHIFFRES — filtre + chart combiné (client) */}
      <EfficaciteCharts stats={stats} sansGroupe={sansGroupe} />

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
          <span>{t('methodologyDenominateurs')}</span>
        </p>
        <p className="flex gap-3">
          <Users className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyAdoption')}</span>
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
      <ExploreSection color={COLOR} currentHref="/Facts/succes-legislatif/efficacite" locale={locale} />
    </div>
  );
}

function HeroCard({ label, value, locale }: { label: string; value: number; locale: string }) {
  const pct = Math.round(value * 1000) / 10;
  // Le style `percent` pose l'espace avant le signe en français et le colle en
  // anglais ; d'où le /100, `pct` étant déjà exprimé en pourcentage.
  const affiche = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(pct / 100);
  return (
    <div className="rounded-lg border p-5 bg-background">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
      <div className="text-4xl font-bold mb-3" style={{ color: COLOR }}>
        {affiche}
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(100, pct)}%`, backgroundColor: COLOR }}
        />
      </div>
    </div>
  );
}
