// Page `/Facts/succes-legislatif/volume` : textes initiés, adoptés et promulgués par
// groupe politique (et par le Gouvernement), en nombre et par membre. Server Component
// statique ; les graphiques interactifs vivent dans `SuccesLegislatifCharts`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { estNonInscrits } from '@/lib/non-inscrits';
import { LEGISLATURE_17_START, PROCEDURES_PROMULGABLES } from '@/lib/facts-shared';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Filter, AlertTriangle, Users } from 'lucide-react';
import { SuccesLegislatifCharts, type GroupeStatSerialized } from './SuccesLegislatifCharts';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerSuccesLegislatif' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/succes-legislatif/volume'),
    openGraph: buildOpenGraph(locale, '/Facts/succes-legislatif/volume', title, description),
  };
}

const COLOR = '#ca8a04';
const GOUV_KEY = '__GOUVERNEMENT__';
const MIN_TEXTES = 10;

type ChambreCode = 'AN' | 'SN' | 'GOUV';

export default async function SuccesLegislatifPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerSuccesLegislatif' });

  // ── Requêtes en parallèle ───────────────────────────────────────────────
  const [dossiers, organes, acteurs] = await Promise.all([
    // Tri sur `uid` : les groupes entrent dans `statsByKey` dans l'ordre des
    // dossiers, et la page rend ses groupes dans cet ordre-là avant tout tri.
    sql<{
      initiateur_groupe_uid: string | null;
      initiateur_groupe_libelle: string | null;
      statut_final: string | null;
      procedure_libelle: string | null;
    }[]>`
      select initiateur_groupe_uid, initiateur_groupe_libelle, statut_final, procedure_libelle
      from dossiers_legislatifs
      where date_depot >= ${LEGISLATURE_17_START}
      order by uid`,
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
    sql<{ groupe: string | null }[]>`
      select groupe
      from acteurs
      where en_exercice = true and groupe is not null
      limit 2000`,
  ]);

  // ── Taille de chaque groupe : comptage des acteurs en exercice ──────────
  const tailleByGroupe = new Map<string, number>();
  for (const a of acteurs as { groupe: string | null }[]) {
    if (!a.groupe) continue;
    tailleByGroupe.set(a.groupe, (tailleByGroupe.get(a.groupe) ?? 0) + 1);
  }

  // ── Info par organe (libelle, couleur, chambre) ─────────────────────────
  type OrganeInfo = { libelle: string; libelleAbrege: string; color: string; chambre: ChambreCode; nonInscrit: boolean };
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
      nonInscrit: estNonInscrits(o.libelle_abrege),
    });
  }

  // ── Agrégation par groupe (tous les Gouvernements → 1 seule clé) ───────
  const statsByKey = new Map<string, GroupeStatSerialized>();
  // Les textes dont l'auteur n'a pas de groupe en base : l'import range chaque
  // proposition dans le groupe de son auteur le jour du dépôt, et il n'en reste
  // que si l'auteur n'en avait aucun ce jour-là, si l'Assemblée ne l'a pas encore
  // publié, ou, pour un texte du Gouvernement, si aucun gouvernement ne couvre sa
  // date de dépôt. Aucun graphique par groupe ne peut les placer, mais la réponse les
  // compte, comme la tuile « Qui écrit les lois qui passent ? » les compte côté
  // Parlement, et la légende de chaque graphique dit combien il en manque. Écartés
  // sans le dire, ils retiraient 16 lois au total le 2026-10-08.
  const sansGroupe = { nbInities: 0, nbAdoptes: 0, nbPromulges: 0 };

  for (const d of dossiers as {
    initiateur_groupe_uid: string | null;
    initiateur_groupe_libelle: string | null;
    statut_final: string | null;
    procedure_libelle: string | null;
  }[]) {
    if (!PROCEDURES_PROMULGABLES.has(d.procedure_libelle ?? '')) continue;

    const uid = d.initiateur_groupe_uid;
    const info = uid ? organeInfo.get(uid) : null;

    const statut = (d.statut_final ?? '').toLowerCase();
    const estPromulge = statut.includes('promulgu') || statut.includes('appliqu');
    const estAdopte = statut.includes('adopt') || estPromulge;

    const isGouv = info?.chambre === 'GOUV' || d.initiateur_groupe_libelle === 'GOUVERNEMENT';
    const key = isGouv ? GOUV_KEY : uid;
    if (!key) {
      sansGroupe.nbInities++;
      if (estAdopte) sansGroupe.nbAdoptes++;
      if (estPromulge) sansGroupe.nbPromulges++;
      continue;
    }

    if (!statsByKey.has(key)) {
      statsByKey.set(key, {
        key,
        libelle: isGouv
          ? t('libelleGouvernement')
          : info?.nonInscrit
            ? t(info.chambre === 'SN' ? 'libelleNonInscritsSN' : 'libelleNonInscritsAN')
            : info?.libelle ?? d.initiateur_groupe_libelle ?? key,
        libelleAbrege: isGouv ? 'GOUV' : info?.libelleAbrege ?? key.slice(0, 3).toUpperCase(),
        color: isGouv ? '#334155' : info?.color ?? COLOR,
        chambre: isGouv ? 'GOUV' : info?.chambre ?? 'AN',
        taille: isGouv ? null : tailleByGroupe.get(key) ?? 0,
        nonInscrit: !isGouv && (info?.nonInscrit ?? false),
        nbInities: 0,
        nbAdoptes: 0,
        nbPromulges: 0,
      });
    }

    const s = statsByKey.get(key)!;
    s.nbInities++;
    if (estAdopte) s.nbAdoptes++;
    if (estPromulge) s.nbPromulges++;
  }

  // ── Filtrage au seuil ──────────────────────────────────────────────────
  const stats = [...statsByKey.values()]
    .filter((s) => s.nbInities >= MIN_TEXTES)
    .sort((a, b) => b.nbInities - a.nbInities);

  // ── Totaux globaux (pour la réponse courte, non filtrables) ─────────────
  // Les totaux comptent le Gouvernement et les textes sans groupe, mais la
  // réponse les nomme à part : aucun des deux n'est un groupe politique, et les
  // compter parmi eux annonçait des groupes de trop.
  // Les non-inscrits non plus : ils ne forment pas un groupe (D-313), et la page
  // victoires les écarte déjà. Leurs textes restent dans les totaux et les graphiques,
  // nommés à part dans la réponse ; ils sortent seulement du décompte des groupes et des
  // classements par membre (celui-ci et l'exemple de `SuccesLegislatifCharts`), où leur
  // effectif n'est celui d'aucun groupe.
  const totalInities = stats.reduce((sum, s) => sum + s.nbInities, sansGroupe.nbInities);
  const totalPromulges = stats.reduce((sum, s) => sum + s.nbPromulges, sansGroupe.nbPromulges);
  const nbGroupes = stats.filter((s) => s.chambre !== 'GOUV' && !s.nonInscrit).length;
  const avecGouvernement = stats.some((s) => s.chambre === 'GOUV');
  const avecNonInscrits = stats.some((s) => s.nonInscrit);
  const avecSansGroupe = sansGroupe.nbInities > 0;

  const groupesAvecTaille = stats.filter(
    (s) => s.chambre !== 'GOUV' && !s.nonInscrit && s.taille && s.taille > 0,
  );
  const parSiegeRanking = groupesAvecTaille
    .map((s) => ({
      key: s.key,
      libelle: s.libelle,
      taille: s.taille as number,
      parSiege: s.nbPromulges / (s.taille as number),
      nbPromulges: s.nbPromulges,
    }))
    .filter((s) => s.nbPromulges > 0)
    .sort((a, b) => b.parSiege - a.parSiege);
  const topParSiege = parSiegeRanking[0];
  // La réponse ne dit « devant des groupes N fois plus nombreux » que si c'est vrai ce
  // jour-là : écrite en dur (« deux à trois fois plus grosses »), la phrase restait
  // affichée quand le premier (EPR et ses 90 membres au 2026-10-28) n'avait plus aucun
  // groupe deux fois plus gros derrière lui. En dessous de 1,5, l'écart ne mérite pas d'être dit.
  // Tous les groupes sont derrière le premier, y compris ceux qui n'ont fait passer aucune
  // loi, absents du classement.
  const tailleMaxDerriere = Math.max(
    0,
    ...groupesAvecTaille.filter((s) => s.key !== topParSiege?.key).map((s) => s.taille as number),
  );
  const ratioPlusGros = topParSiege ? tailleMaxDerriere / topParSiege.taille : 0;
  const avecPlusGros = ratioPlusGros >= 1.5;

  return (
    <div className="py-12">

      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLOR }}>
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          totalGroupes: nbGroupes.toLocaleString(locale),
          gouv: avecGouvernement ? 'oui' : 'non',
          // Une seule mention pour les deux : deux incises à la suite ne se lisaient pas.
          autres: avecNonInscrits && avecSansGroupe ? 'lesDeux' : avecNonInscrits ? 'ni' : avecSansGroupe ? 'inconnu' : 'aucun',
          plusGros: avecPlusGros ? 'oui' : 'non',
          ratioPlusGros: ratioPlusGros.toLocaleString(locale, { maximumFractionDigits: 1 }),
          totalInities: totalInities.toLocaleString(locale),
          totalPromulges: totalPromulges.toLocaleString(locale),
          // La phrase dit déjà « du groupe » : un libellé du Sénat commence par ce mot.
          topGroupe: topParSiege?.libelle?.replace(/^Groupe /, '') ?? '—',
          topTaille: topParSiege?.taille.toLocaleString(locale) ?? '—',
          topLois: topParSiege?.nbPromulges.toLocaleString(locale) ?? '—',
          topParSiege: topParSiege
            ? topParSiege.parSiege.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : '—',
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
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
          { value: 'adoption', title: t('concept2Title'), desc: t('concept2Desc') },
          { value: 'parMembre', title: t('concept3Title'), desc: t('concept3Desc') },
          { value: 'gouv', title: t('concept4Title'), desc: t('concept4Desc') },
          { value: 'majorite', title: t('concept5Title'), desc: t('concept5Desc') },
          { value: 'taille', title: t('concept6Title'), desc: t('concept6Desc') },
        ].map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="hover:no-underline">{item.title}</AccordionTrigger>
            <AccordionContent>
              <p className="text-foreground/80 leading-relaxed">{item.desc}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Hero scatter + filtre + butterflies (client) */}
      <SuccesLegislatifCharts stats={stats} sansGroupe={sansGroupe} />

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
          <span>{t('methodologyRate')}</span>
        </p>
        <p className="flex gap-3">
          <Users className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyTaille')}</span>
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
      <ExploreSection color={COLOR} currentHref="/Facts/succes-legislatif/volume" locale={locale} />
    </div>
  );
}
