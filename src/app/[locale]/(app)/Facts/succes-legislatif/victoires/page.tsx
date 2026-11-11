// Page `/Facts/succes-legislatif/victoires` : part des votes finaux où la position
// majoritaire de chaque groupe rejoint le résultat, à l'Assemblée et au Sénat. Server
// Component statique qui lit `scrutins_groupes_positions`, `scrutins` et `organes`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Users, Filter, AlertTriangle } from 'lucide-react';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerSuccesLegislatifVictoires' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/succes-legislatif/victoires'),
    openGraph: buildOpenGraph(locale, '/Facts/succes-legislatif/victoires', title, description),
  };
}

const COLOR = '#ca8a04';
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

/**
 * Positions de groupe des scrutins finaux, toutes chambres.
 *
 * Les motions de censure n'y figurent pas : l'import n'écrit aucune position pour elles
 * (`import_scrutins_cloud.py`). La Constitution n'y fait recenser que les votes
 * favorables, et une motion rejetée compterait une défaite pour ses seuls signataires
 * et rien pour ceux qui l'ont fait tomber.
 */
async function fetchAllPositions(): Promise<PositionRow[]> {
  // Tri sur la clé primaire `(scrutin_uid, groupe_uid)` : sans lui, l'ordre des
  // lignes suivrait le plan d'exécution et pourrait changer d'un rendu à l'autre.
  return sql<PositionRow[]>`
    select scrutin_uid, groupe_uid, chambre, position_majoritaire
    from scrutins_groupes_positions
    order by scrutin_uid, groupe_uid`;
}

type ScrutinInfo = { sortCode: string | null; date: string | null };

/**
 * Résultat officiel et date de chaque scrutin, en une lecture. La date sert à dater la période couverte par chaque chambre dans la
 * réponse : les deux chambres ne commencent pas au même moment.
 */
async function fetchScrutins(scrutinUids: string[]): Promise<Map<string, ScrutinInfo>> {
  const map = new Map<string, ScrutinInfo>();
  const data = await sql<{ uid: string; sort_code: string | null; date_scrutin: string | null }[]>`
    select uid, sort_code, date_scrutin
    from scrutins
    where uid = any(${scrutinUids})`;
  for (const row of data) {
    map.set(row.uid, { sortCode: row.sort_code, date: row.date_scrutin });
  }
  return map;
}

type GroupeVictoires = {
  uid: string;
  libelle: string;
  color: string;
  victoires: number;
  nb: number;
  taux: number;
};

export default async function SuccesLegislatifVictoiresPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerSuccesLegislatifVictoires' });

  const positions = await fetchAllPositions();

  const scrutinUidsSet = new Set<string>();
  const groupeUidsSet = new Set<string>();
  for (const p of positions) {
    scrutinUidsSet.add(p.scrutin_uid);
    groupeUidsSet.add(p.groupe_uid);
  }

  const [scrutinsMap, organesMap] = await Promise.all([
    fetchScrutins(Array.from(scrutinUidsSet)),
    (async () => {
      const map = new Map<string, OrganeRow>();
      const data = await sql<OrganeRow[]>`
        select uid, libelle, libelle_abrege, couleur_associee
        from organes
        where uid = any(${Array.from(groupeUidsSet)})`;
      for (const row of data) {
        map.set(row.uid, row);
      }
      return map;
    })(),
  ]);

  // Date du plus ancien scrutin retenu dans le calcul, par chambre (avant le
  // seuil par groupe, qui ne change pas la période) : les deux chambres n'ont
  // pas le même historique en base (au 2026-09-15, octobre 2024 pour
  // l'Assemblée, octobre 2023 pour le Sénat), donc la réponse compare deux
  // moyennes sur deux périodes différentes, et doit le dire.
  const premierScrutin: Record<'AN' | 'SN', string | null> = { AN: null, SN: null };

  const buildGroupes = (chambre: 'AN' | 'SN'): GroupeVictoires[] => {
    const tally = new Map<string, { victoires: number; nb: number }>();
    for (const p of positions) {
      if (p.chambre !== chambre) continue;
      if (p.position_majoritaire === 'abstention') continue;
      const scrutin = scrutinsMap.get(p.scrutin_uid);
      if (!scrutin?.sortCode) continue;
      const sortCode = scrutin.sortCode;
      const campVainqueur = sortCode === 'adopté' ? 'pour' : sortCode === 'rejeté' ? 'contre' : null;
      if (!campVainqueur) continue;

      const entry = tally.get(p.groupe_uid) ?? { victoires: 0, nb: 0 };
      entry.nb++;
      if (p.position_majoritaire === campVainqueur) entry.victoires++;
      tally.set(p.groupe_uid, entry);

      const date = scrutin.date;
      const premier = premierScrutin[chambre];
      if (date && (premier === null || date < premier)) premierScrutin[chambre] = date;
    }

    return Array.from(tally.entries())
      .filter(([, v]) => v.nb >= THRESHOLD)
      .map(([uid, v]) => {
        const o = organesMap.get(uid);
        const libelle = o?.libelle || o?.libelle_abrege || uid;
        return {
          uid,
          libelle,
          color: resolveGroupeColor(o?.couleur_associee ?? null, COLOR),
          victoires: v.victoires,
          nb: v.nb,
          taux: (v.victoires / v.nb) * 100,
        };
      })
      // L'uid départage les ex æquo : sans lui, le groupe nommé en tête de la réponse
      // dépendait de l'ordre de lecture des lignes.
      .sort((a, b) => b.taux - a.taux || a.uid.localeCompare(b.uid));
  };

  const an = buildGroupes('AN');
  const sn = buildGroupes('SN');

  const avgTaux = (groupes: GroupeVictoires[]): number =>
    groupes.length > 0 ? groupes.reduce((sum, g) => sum + g.taux, 0) / groupes.length : 0;

  const moyenneAN = avgTaux(an);
  const moyenneSN = avgTaux(sn);
  // Le premier de chaque chambre : nommer celui de l'Assemblée seul (LIOT, 96 %) laissait
  // croire qu'il était en tête des deux, quand le graphique de la même page montre
  // l'Union centriste à 100 % au Sénat.
  const topAN = an[0];
  const topSN = sn[0];

  const anData = an.map((g) => ({ groupe: g.libelle, value: Math.round(g.taux), fill: g.color }));
  const snData = sn.map((g) => ({ groupe: g.libelle, value: Math.round(g.taux), fill: g.color }));

  const fmtPct = (x: number) =>
    x.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' %';
  // `date_scrutin` arrive sans fuseau (« 2023-10-10T00:00:00 ») : lu en UTC, le
  // mois ne peut pas glisser selon le fuseau du serveur de rendu.
  const moisAnnee = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const debut = (date: string | null) =>
    date ? moisAnnee.format(new Date(`${date.slice(0, 10)}T00:00:00Z`)) : '…';

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
          debutAN: debut(premierScrutin.AN),
          debutSN: debut(premierScrutin.SN),
          topGroupeAN: topAN?.libelle ?? '—',
          topTauxAN: topAN ? fmtPct(topAN.taux) : '—',
          topGroupeSN: topSN?.libelle ?? '—',
          topTauxSN: topSN ? fmtPct(topSN.taux) : '—',
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/* Hero : deux moyennes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        <HeroCard label={t('heroVictoiresANLabel')} value={moyenneAN} locale={locale} />
        <HeroCard label={t('heroVictoiresSNLabel')} value={moyenneSN} locale={locale} />
      </div>

      {/* À COMPRENDRE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: COLOR }}>
        {t('conceptsTitle')}
      </h2>
      <Accordion type="multiple" className="mb-12">
        {[
          { value: 'perimetre', title: t('concept1Title'), desc: t('concept1Desc') },
          { value: 'camp-vainqueur', title: t('concept2Title'), desc: t('concept2Desc') },
          { value: 'position-majoritaire', title: t('concept3Title'), desc: t('concept3Desc') },
          { value: 'abstention', title: t('concept4Title'), desc: t('concept4Desc') },
          { value: 'seuil', title: t('concept5Title'), desc: t('concept5Desc') },
        ].map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="hover:no-underline">{item.title}</AccordionTrigger>
            <AccordionContent>
              <p className="text-foreground/80 leading-relaxed">{item.desc}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
        <AccordionItem value="efficacite">
          <AccordionTrigger className="hover:no-underline">{t('concept6Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t.rich('concept6Desc', {
                a: (chunks) => (
                  <Link
                    href="/Facts/succes-legislatif/efficacite"
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

      {/* ② EN CHIFFRES */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-8" style={{ color: COLOR }}>
        {t('sectionInNumbers')}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-16">
        {anData.length > 0 && (
          <GroupeBarChart
            data={anData}
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
        {snData.length > 0 && (
          <GroupeBarChart
            data={snData}
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
      <ExploreSection color={COLOR} currentHref="/Facts/succes-legislatif/victoires" locale={locale} />
    </div>
  );
}

function HeroCard({ label, value, locale }: { label: string; value: number; locale: string }) {
  const pct = Math.round(value * 10) / 10;
  // Le style `percent` pose l'espace avant le signe en français et le colle en
  // anglais ; d'où le /100, la valeur arrivant déjà en pourcentage.
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
