// Page `/Facts/participation` : part des votes finaux et solennels auxquels les
// parlementaires prennent part. Server Component statique. Rangées et moyennes
// viennent de `getParticipationMoyennes()`, partagé avec `/etat-des-lieux` et la
// landing ; les taux par groupe, de `organes` ; le contraste du Sénat avec ou sans
// groupe, de `getContrasteGroupesSenat()`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { getParliamentCounts } from '@/lib/parliament-counts';
import {
  getContrasteGroupesSenat,
  getParticipationMoyennes,
  type ParticipationActeur,
} from '@/lib/facts-queries';
import { boxStats } from '@/lib/stats';
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
import { Target, Calculator, Filter, Scale } from 'lucide-react';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { ParticipationSearch, type ParticipationSearchEntry } from '@/components/ui/ParticipationSearch';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerParticipation' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/participation'),
    openGraph: buildOpenGraph(locale, '/Facts/participation', title, description),
  };
}

const COLOR = '#c2410c';

/**
 * Nombre minimal de scrutins tenus pendant le mandat pour figurer dans les
 * classements et la recherche. À 10, un élu arrivé en cours de route pouvait
 * prendre la tête d'une liste sur une poignée de votes : 50 écarte ces taux qui
 * ne reposent sur presque rien, sans vider les listes (la législature compte
 * déjà plusieurs centaines de votes finaux). Le contraste du Sénat, compté vote
 * par vote, s'en sert pour dire qui compte dans `MIN_SENATEURS_SANS_GROUPE`.
 */
const MIN_SCRUTINS = 50;

/**
 * Nombre minimal de sénateurs sans groupe ayant chacun `MIN_SCRUTINS` votes
 * possibles sans groupe pour afficher le contraste du Sénat. En dessous, la phrase
 * « un sénateur sans groupe vote dans X % » reposerait sur une ou deux personnes.
 * Ils étaient 3 au 2026-11-07 : un départ ou une entrée dans un groupe suffit à
 * masquer le graphique et sa phrase.
 */
const MIN_SENATEURS_SANS_GROUPE = 3;

/**
 * Sources du volet « Pourquoi le Sénat affiche presque 100 % ». Le mécanisme
 * qu'il décrit (un sénateur peut déposer les bulletins de tout son groupe) est une
 * affirmation forte : elle doit être vérifiable en un clic, sans quoi elle se
 * lit comme une opinion. Les libellés sont traduits, les URL non : ce sont des
 * constantes, pas du contenu.
 */
const SOURCES_SENAT: { key: 'sourceSenat' | 'sourceAN' | 'sourceLoi'; href: string }[] = [
  { key: 'sourceSenat', href: 'https://www.senat.fr/leg/exposes-des-motifs/ppr22-125-expose.html' },
  {
    key: 'sourceAN',
    href: 'https://www.assemblee-nationale.fr/dyn/synthese/fonctionnement-assemblee-nationale/travail-legislatif/les-votes-a-l-assemblee-nationale',
  },
  { key: 'sourceLoi', href: 'https://www.legifrance.gouv.fr/loda/id/LEGITEXT000006069198' },
];

type Acteur = ParticipationActeur;

export default async function ParticipationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const t = await getTranslations({ locale, namespace: 'answerParticipation' });
  const counts = await getParliamentCounts();

  // Les rangées et les trois moyennes viennent du helper partagé avec
  // /etat-des-lieux : la tuile du tableau de bord et le hero de cette page
  // doivent afficher les mêmes taux AN et Sénat.
  const [
    {
      deputes,
      senateurs,
      tauxANFinal,
      tauxANSolennel,
      tauxSN,
      meanANFinal,
      meanANSolennel,
      meanSN,
    },
    { avecGroupe, sansGroupe },
  ] = await Promise.all([getParticipationMoyennes(), getContrasteGroupesSenat(MIN_SCRUTINS)]);

  // ── Organes ──────────────────────────────────────────────────────────
  const groupeUids = new Set<string>();
  [...deputes, ...senateurs].forEach((a) => {
    if (a.groupe) groupeUids.add(a.groupe);
  });

  type OrganeInfo = {
    libelle: string;
    couleur: string | null;
    tauxFinalMoyen: number | null;
    tauxSolennelMoyen: number | null;
  };
  const organesMap = new Map<string, OrganeInfo>();

  if (groupeUids.size > 0) {
    const organesData = await sql<{
      uid: string;
      libelle: string | null;
      libelle_abrege: string | null;
      couleur_associee: string | null;
      taux_participation_votes_finaux_moyen: number | null;
      taux_participation_votes_solennels_moyen: number | null;
    }[]>`
      select uid, libelle, libelle_abrege, couleur_associee, taux_participation_votes_finaux_moyen,
        taux_participation_votes_solennels_moyen
      from organes
      where uid = any(${Array.from(groupeUids)})`;
    organesData.forEach(
      (o: {
        uid: string;
        libelle: string | null;
        libelle_abrege: string | null;
        couleur_associee: string | null;
        taux_participation_votes_finaux_moyen: number | null;
        taux_participation_votes_solennels_moyen: number | null;
      }) => {
        organesMap.set(o.uid, {
          libelle: o.libelle || o.libelle_abrege || o.uid,
          couleur: o.couleur_associee,
          tauxFinalMoyen: o.taux_participation_votes_finaux_moyen,
          tauxSolennelMoyen: o.taux_participation_votes_solennels_moyen,
        });
      }
    );
  }

  // ── BoxPlot ──────────────────────────────────────────────────────────
  const boxAllData = [
    { label: t('boxANFinalLabel'), countLabel: t('boxANCountLabel'), ...boxStats(tauxANFinal), mean: meanANFinal },
    ...(tauxANSolennel.length > 0
      ? [{ label: t('boxANSolennelLabel'), countLabel: t('boxANCountLabel'), ...boxStats(tauxANSolennel), mean: meanANSolennel }]
      : []),
    { label: t('boxSNLabel'), countLabel: t('boxSNCountLabel'), ...boxStats(tauxSN), mean: meanSN },
  ];

  // ── Groupe bar charts (moyennes organes) ──────────────────────────────
  const deputeGroupeUids = new Set(
    deputes.map((d) => d.groupe).filter((g): g is string => g !== null)
  );

  const buildGroupeData = (
    uids: Set<string>,
    valueKey: 'tauxFinalMoyen' | 'tauxSolennelMoyen'
  ) =>
    Array.from(uids)
      .map((uid) => {
        const info = organesMap.get(uid);
        if (!info) return null;
        const value = info[valueKey];
        if (value === null || value === undefined) return null;
        return {
          groupe: info.libelle,
          value: Math.round(value),
          fill: resolveGroupeColor(info.couleur, COLOR),
        };
      })
      .filter((x): x is { groupe: string; value: number; fill: string } => x !== null)
      .sort((a, b) => b.value - a.value);

  const groupeANFinalData = buildGroupeData(deputeGroupeUids, 'tauxFinalMoyen');
  const groupeANSolennelData = buildGroupeData(deputeGroupeUids, 'tauxSolennelMoyen');

  // ── Contraste Sénat : avec groupe / sans groupe ───────────────────────
  // Le détail par groupe n'est pas affiché : les groupes du Sénat tiennent
  // tous dans un point et demi, l'écart ne classe personne. Le seul contraste
  // qui dise quelque chose oppose les sénateurs qu'un délégué de groupe fait
  // voter à ceux qui doivent déposer leur bulletin eux-mêmes. Chaque vote compte
  // au groupe du jour du scrutin (D-278) : ce sont des votes sur votes possibles,
  // pas une moyenne de taux individuels.
  //
  // Sans camp « sans groupe » assez fourni, le graphique du contraste disparaît, et
  // les textes qui expliquent l'écart AN/Sénat taisent leur phrase chiffrée
  // (`contraste` de leur select ICU) au lieu de s'afficher avec des trous.
  const contrasteSNDispo =
    avecGroupe.votesPossibles > 0 && sansGroupe.senateursMesurables >= MIN_SENATEURS_SANS_GROUPE;

  // La première barre reprend le grand chiffre du Sénat : sans elle, le lecteur voit
  // un chiffre en haut de page, un autre ici, et ne sait pas pourquoi. Les trois
  // portent sur les sénateurs en poste ; la première compte aussi les votes émis
  // sans groupe.
  const contrasteSNData = [
    {
      groupe: t('contrasteSNEnsembleLabel', { count: tauxSN.length }),
      value: meanSN,
      fill: COLOR,
    },
    {
      groupe: t('contrasteSNAvecLabel', { count: avecGroupe.senateurs }),
      value: avecGroupe.taux,
      fill: COLOR,
    },
    {
      groupe: t('contrasteSNSansLabel', { count: sansGroupe.senateurs }),
      value: sansGroupe.taux,
      fill: COLOR,
    },
  ];

  // ── Leaderboards ──────────────────────────────────────────────────────
  type LeaderboardKey = 'taux_participation_votes_finaux' | 'taux_participation_votes_solennels';
  type LeaderRow = { uid: string | null; nom: string; groupe: string | null; value: number; nbVotes?: number; nbScrutins?: number };

  const buildLeaderboard = (rows: Acteur[], key: LeaderboardKey, direction: 'top' | 'bot'): LeaderRow[] => {
    const mapped = rows
      .filter((a) => typeof a[key] === 'number')
      .map((a) => {
        const value = Math.round(a[key] as number);
        let nbVotes: number | undefined;
        let nbScrutins: number | undefined;
        if (key === 'taux_participation_votes_finaux' && a.scrutins_finaux_pendant_mandat != null) {
          nbScrutins = a.scrutins_finaux_pendant_mandat;
          nbVotes = Math.round((a[key] as number) / 100 * nbScrutins);
        } else if (key === 'taux_participation_votes_solennels' && a.scrutins_solennels_pendant_mandat != null) {
          nbScrutins = a.scrutins_solennels_pendant_mandat;
          nbVotes = a.votes_actifs_importants ?? undefined;
        }
        return {
          uid: a.uid ?? null,
          nom: `${a.prenom ?? ''} ${a.nom ?? ''}`.trim(),
          groupe: a.groupe ? organesMap.get(a.groupe)?.libelle ?? null : null,
          value,
          nbVotes,
          nbScrutins,
        };
      })
      .filter((r) => r.nbScrutins !== undefined && r.nbScrutins >= MIN_SCRUTINS);
    return direction === 'top'
      ? mapped.sort((a, b) => b.value - a.value).slice(0, 50)
      : mapped.sort((a, b) => a.value - b.value).slice(0, 50);
  };

  // ── Search entries (ranked, all parliamentarians) ────────────────────────
  const deputesFinalRanked = [...deputes]
    .filter((a) => a.uid != null && typeof a.taux_participation_votes_finaux === 'number' && (a.scrutins_finaux_pendant_mandat ?? 0) >= MIN_SCRUTINS)
    .sort((a, b) => (b.taux_participation_votes_finaux as number) - (a.taux_participation_votes_finaux as number));
  const deputesSolennelRanked = [...deputes]
    .filter((a) => a.uid != null && typeof a.taux_participation_votes_solennels === 'number' && (a.scrutins_solennels_pendant_mandat ?? 0) >= MIN_SCRUTINS)
    .sort((a, b) => (b.taux_participation_votes_solennels as number) - (a.taux_participation_votes_solennels as number));
  // Sénateurs : même seuil pour figurer dans la recherche, mais ni tri ni rang
  // (voir `snFinal` plus bas).
  const senateursFinalRetenus = new Set<string>(
    senateurs
      .filter((a) => a.uid != null && typeof a.taux_participation_votes_finaux === 'number' && (a.scrutins_finaux_pendant_mandat ?? 0) >= MIN_SCRUTINS)
      .map((a) => a.uid as string),
  );

  const deputeFinalRankMap = new Map<string, number>(deputesFinalRanked.map((a, i) => [a.uid as string, i + 1]));
  const deputeSolennelRankMap = new Map<string, number>(deputesSolennelRanked.map((a, i) => [a.uid as string, i + 1]));

  const searchEntries: ParticipationSearchEntry[] = [
    ...deputes.map((a): ParticipationSearchEntry => {
      const nom = `${a.prenom ?? ''} ${a.nom ?? ''}`.trim();
      const groupeLabel = a.groupe ? (organesMap.get(a.groupe)?.libelle ?? null) : null;
      const anFinalRank = a.uid != null ? deputeFinalRankMap.get(a.uid) : undefined;
      const anSolennelRank = a.uid != null ? deputeSolennelRankMap.get(a.uid) : undefined;
      return {
        uid: a.uid ?? null,
        nom,
        groupe: groupeLabel,
        type: 'depute',
        anFinal: anFinalRank !== undefined && typeof a.taux_participation_votes_finaux === 'number' ? {
          value: Math.round(a.taux_participation_votes_finaux),
          rank: anFinalRank,
          total: deputesFinalRanked.length,
          nbScrutins: a.scrutins_finaux_pendant_mandat ?? undefined,
          nbVotes: a.scrutins_finaux_pendant_mandat != null
            ? Math.round(a.taux_participation_votes_finaux / 100 * a.scrutins_finaux_pendant_mandat)
            : undefined,
        } : undefined,
        anSolennel: anSolennelRank !== undefined && typeof a.taux_participation_votes_solennels === 'number' ? {
          value: Math.round(a.taux_participation_votes_solennels),
          rank: anSolennelRank,
          total: deputesSolennelRanked.length,
          nbScrutins: a.scrutins_solennels_pendant_mandat ?? undefined,
          nbVotes: a.votes_actifs_importants ?? undefined,
        } : undefined,
      };
    }),
    ...senateurs.map((a): ParticipationSearchEntry => {
      const nom = `${a.prenom ?? ''} ${a.nom ?? ''}`.trim();
      const groupeLabel = a.groupe ? (organesMap.get(a.groupe)?.libelle ?? null) : null;
      const snFinalRetenu = a.uid != null && senateursFinalRetenus.has(a.uid);
      return {
        uid: a.uid ?? null,
        nom,
        groupe: groupeLabel,
        type: 'senateur',
        // Pas de rang au Sénat : l'écart entre sénateurs tient au dépôt des
        // bulletins par le groupe et ne classe personne, comme pour les listes.
        snFinal: snFinalRetenu && typeof a.taux_participation_votes_finaux === 'number' ? {
          value: Math.round(a.taux_participation_votes_finaux),
          nbScrutins: a.scrutins_finaux_pendant_mandat ?? undefined,
          nbVotes: a.scrutins_finaux_pendant_mandat != null
            ? Math.round(a.taux_participation_votes_finaux / 100 * a.scrutins_finaux_pendant_mandat)
            : undefined,
        } : undefined,
      };
    }),
  ];

  const top10ANFinal = buildLeaderboard(deputes, 'taux_participation_votes_finaux', 'top');
  const flop10ANFinal = buildLeaderboard(deputes, 'taux_participation_votes_finaux', 'bot');
  const top10ANSolennel = buildLeaderboard(deputes, 'taux_participation_votes_solennels', 'top');
  const flop10ANSolennel = buildLeaderboard(deputes, 'taux_participation_votes_solennels', 'bot');
  // Pas de listes individuelles pour le Sénat : un seul sénateur par groupe peut
  // déposer les bulletins de tous ses collègues, donc le taux dit pour qui un
  // bulletin a été déposé et non qui a voté : l'écart entre deux sénateurs ne
  // classe personne (raison écrite dans `methodologySenat`).

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
        {p.groupe && (
          <p className="text-xs text-muted-foreground mt-0.5">{p.groupe}</p>
        )}
      </div>
      <div className="flex flex-col items-end shrink-0 mt-0.5">
        <span className="text-xs tabular-nums font-semibold" style={{ color: COLOR }}>
          {pourcent.format(p.value / 100)}
        </span>
        {p.nbVotes !== undefined && p.nbScrutins !== undefined && (
          <span className="text-xs tabular-nums text-muted-foreground leading-tight">
            {p.nbVotes}/{p.nbScrutins}
          </span>
        )}
      </div>
    </li>
  );

  // ── Volets « À comprendre » ───────────────────────────────────────────
  // Hors du JSX pour que `sources`, présent sur le seul volet du Sénat, reste
  // typé optionnel plutôt qu'inféré absent sur les autres.
  type ConceptItem = {
    value: string;
    title: string;
    desc: string;
    sources?: typeof SOURCES_SENAT;
  };
  const conceptItems: ConceptItem[] = [
    { value: 'perimetre', title: t('concept1Title'), desc: t('concept1Desc', { an: counts.an, sn: counts.sn }) },
    // Juste après le périmètre : c'est la question que pose n'importe quel
    // lecteur devant l'écart 43 / 98, avant même de savoir ce qu'est un vote
    // final.
    {
      value: 'ecart-chambres',
      title: t('conceptSenatTitle'),
      desc: t('conceptSenatDesc', {
        an: meanANFinal.toLocaleString(locale),
        sn: meanSN.toLocaleString(locale),
        solennel: meanANSolennel.toLocaleString(locale),
        contraste: contrasteSNDispo ? 'oui' : 'non',
        tauxSansGroupe: sansGroupe.taux.toLocaleString(locale),
        tauxAvecGroupe: avecGroupe.taux.toLocaleString(locale),
      }),
      sources: SOURCES_SENAT,
    },
    { value: 'vote-final', title: t('concept2Title'), desc: t('concept2Desc') },
    { value: 'vote-important', title: t('concept3Title'), desc: t('concept3Desc', { solennel: meanANSolennel.toLocaleString(locale) }) },
    { value: 'non-votant', title: t('concept4Title'), desc: t('concept4Desc') },
  ];

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
          an: meanANFinal.toLocaleString(locale),
          sn: meanSN.toLocaleString(locale),
          solennel: meanANSolennel.toLocaleString(locale),
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      {/*
        La mise en garde vit ici, entre la réponse et les trois grands chiffres :
        c'est le seul endroit où elle est lue avant que le lecteur ait comparé
        43 % et 98 %. Le détail complet reste en méthodologie. Filet de 2 px
        plutôt qu'un encadré coloré, cf. BRAND_ID §8.4.
      */}
      <div
        className="mb-12"
        style={{ borderLeft: `2px solid ${COLOR}`, paddingLeft: '1rem' }}
      >
        <p className="leading-relaxed text-foreground/80" style={{ fontSize: '0.9375rem' }}>
          <span className="font-semibold text-foreground">{t('caveatTitle')}</span>{' '}
          {t('caveatBody', {
            sn: meanSN.toLocaleString(locale),
            contraste: contrasteSNDispo ? 'oui' : 'non',
            tauxSansGroupe: sansGroupe.taux.toLocaleString(locale),
            tauxAvecGroupe: avecGroupe.taux.toLocaleString(locale),
          })}
        </p>
        <a
          href="#methodologie"
          className="inline-block mt-2 text-sm font-medium hover:underline"
          style={{ color: COLOR }}
        >
          {t('caveatLink')}
        </a>
      </div>

      {/* Hero — 3 grands chiffres */}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('heroTitle')}</CardTitle>
          <CardDescription>{t('heroDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: t('heroANFinal'), value: meanANFinal, count: tauxANFinal.length },
              { label: t('heroANSolennel'), value: meanANSolennel, count: tauxANSolennel.length },
              { label: t('heroSN'), value: meanSN, count: tauxSN.length },
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
        {conceptItems.map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="hover:no-underline">{item.title}</AccordionTrigger>
            <AccordionContent>
              {/* Une ligne vide dans la traduction fait un paragraphe : le
                  volet du Sénat raconte une mécanique en cinq temps, et le
                  même bloc de dix lignes ne se lisait pas. Les autres volets,
                  d'un seul tenant, rendent exactement comme avant. */}
              {item.desc.split('\n\n').map((paragraphe, i) => (
                <p
                  key={i}
                  className="text-foreground/80 leading-relaxed"
                  style={i > 0 ? { marginTop: '0.75rem' } : undefined}
                >
                  {paragraphe}
                </p>
              ))}
              {item.sources && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('sourcesLabel')}{' '}
                  {item.sources.map((s, i) => (
                    <span key={s.key}>
                      {i > 0 && <span aria-hidden> · </span>}
                      <a
                        href={s.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 hover:text-foreground transition-colors"
                      >
                        {t(s.key)}
                      </a>
                    </span>
                  ))}
                </p>
              )}
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
        {/* Distribution AN + Sénat fusionnée */}
        {boxAllData.length > 0 && (
          <div className="md:col-span-2">
            <BoxPlotChart
              data={boxAllData}
              title={t('boxANTitle')}
              description={t('boxANDesc')}
              unit="%"
              locale={locale}
              color={COLOR}
              countLabel={t('boxCountLabel')}
              note={t('boxNote')}
              domain={[0, 100]}
            />
          </div>
        )}

        {/* Moyennes par groupe — AN (votes finaux + votes importants côte à côte) */}
        {(groupeANFinalData.length > 0 || groupeANSolennelData.length > 0) && (
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
            {groupeANFinalData.length > 0 && (
              <GroupeBarChart
                data={groupeANFinalData}
                title={t('groupeANFinalTitle')}
                description={t('groupeANFinalDesc')}
                color={COLOR}
                valueLabel={t('valueLabel')}
                note={t('groupeANFinalNote')}
                labelWidth={280}
                labelMaxChars={38}
                xDomain={[0, 100]}
              />
            )}
            {groupeANSolennelData.length > 0 && (
              <GroupeBarChart
                data={groupeANSolennelData}
                title={t('groupeANSolennelTitle')}
                description={t('groupeANSolennelDesc')}
                color={COLOR}
                valueLabel={t('valueLabel')}
                note={t('groupeANSolennelNote')}
                labelWidth={280}
                labelMaxChars={38}
                xDomain={[0, 100]}
              />
            )}
          </div>
        )}

        {/* Sénat — ce que change l'appartenance à un groupe */}
        {contrasteSNDispo && (
          <div className="md:col-span-2">
            <GroupeBarChart
              data={contrasteSNData}
              title={t('contrasteSNTitle')}
              description={t('contrasteSNDesc')}
              color={COLOR}
              valueLabel={t('valueLabel')}
              note={t('contrasteSNNote')}
              labelWidth={200}
              labelMaxChars={26}
              xDomain={[0, 100]}
            />
          </div>
        )}

        {/* Recherche parlementaire */}
        <div className="md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('searchTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ParticipationSearch
                entries={searchEntries}
                color={COLOR}
                labels={{
                  placeholder: t('searchPlaceholder'),
                  noResult: t('searchNoResult'),
                  rankLabel: t('searchRankLabel'),
                  outOfLabel: t('searchOutOf'),
                  deputeLabel: t('searchDepute'),
                  senateurLabel: t('searchSenateur'),
                  anFinalLabel: t('heroANFinal'),
                  anSolennelLabel: t('heroANSolennel'),
                  snFinalLabel: t('heroSN'),
                  scrutinsLabel: t('searchScrutins'),
                }}
              />
            </CardContent>
          </Card>
        </div>

        {/* Leaderboards AN — votes finaux + votes importants (côte à côte, colonne unique chacun) */}
        {(top10ANFinal.length > 0 || flop10ANFinal.length > 0 || top10ANSolennel.length > 0 || flop10ANSolennel.length > 0) && (
          <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-6">
            {(top10ANFinal.length > 0 || flop10ANFinal.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('leaderANFinalTitle')}</CardTitle>
                  <CardDescription>{t('leaderANFinalDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {top10ANFinal.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                          {t('leaderTopLabel')}
                        </h4>
                        <ol className="space-y-3 pr-1" style={{ maxHeight: '460px', overflowY: 'auto' }}>
                          {top10ANFinal.map((p, i) => renderLeaderItem(p, i, 'anft'))}
                        </ol>
                      </div>
                    )}
                    {flop10ANFinal.length > 0 && (
                      <div className="pt-6 border-t border-border">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                          {t('leaderBotLabel')}
                        </h4>
                        <ol className="space-y-3 pr-1" style={{ maxHeight: '460px', overflowY: 'auto' }}>
                          {flop10ANFinal.map((p, i) => renderLeaderItem(p, i, 'anfb'))}
                        </ol>
                      </div>
                    )}
                  </div>
                </CardContent>
                <div className="border-t px-6 py-4">
                  <p className="text-sm text-foreground/70 leading-relaxed">{t('leaderANFinalNote', { min: MIN_SCRUTINS })}</p>
                </div>
              </Card>
            )}
            {(top10ANSolennel.length > 0 || flop10ANSolennel.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>{t('leaderANSolennelTitle')}</CardTitle>
                  <CardDescription>{t('leaderANSolennelDesc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {top10ANSolennel.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                          {t('leaderTopLabel')}
                        </h4>
                        <ol className="space-y-3 pr-1" style={{ maxHeight: '460px', overflowY: 'auto' }}>
                          {top10ANSolennel.map((p, i) => renderLeaderItem(p, i, 'anst'))}
                        </ol>
                      </div>
                    )}
                    {flop10ANSolennel.length > 0 && (
                      <div className="pt-6 border-t border-border">
                        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                          {t('leaderBotLabel')}
                        </h4>
                        <ol className="space-y-3 pr-1" style={{ maxHeight: '460px', overflowY: 'auto' }}>
                          {flop10ANSolennel.map((p, i) => renderLeaderItem(p, i, 'ansb'))}
                        </ol>
                      </div>
                    )}
                  </div>
                </CardContent>
                <div className="border-t px-6 py-4">
                  <p className="text-sm text-foreground/70 leading-relaxed">{t('leaderANSolennelNote', { min: MIN_SCRUTINS })}</p>
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
          <span>{t('methodologyPerimetre')}</span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyFormule')}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>
            {t('methodologyExclusions', { min: MIN_SCRUTINS, minSenateurs: MIN_SENATEURS_SANS_GROUPE })}
          </span>
        </p>
        <p className="flex gap-3">
          <Scale className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologySenat')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Facts/participation" locale={locale} />
    </div>
  );
}
