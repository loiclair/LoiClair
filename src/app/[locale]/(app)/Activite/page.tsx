// Page `/Activite` : classement d'activité des parlementaires. Server Component
// statique, régénéré après chaque run de nuit. Scores et rangs viennent de `activite_elus_mv`
// (rafraîchie par le cron nocturne), les libellés de groupe de `organes`, et les
// lignes partent vers les composants client du tableau et de la recherche.
// Rafraîchie chaque nuit par /api/revalidate ; la minuterie n'est qu'un filet. Il est
// de 24 h et non de 48 comme les autres pages nocturnes : la fiche élu affiche les mêmes
// jours actifs et le même score, garde elle aussi un filet de 24 h, et un filet de 48 h
// ici a fait afficher aux deux pages des jours actifs différents.
export const revalidate = 86400;
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, getMessages, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { Separator } from '@/components/ui/separator';
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { ConceptsAccordion } from '@/components/ui/ConceptsAccordion';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import { Target, Calculator, Filter, AlertCircle, CalendarRange, FileCode2, Database, CalendarDays } from 'lucide-react';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { ActiviteTable, type ActiviteRow } from '@/components/ui/ActiviteTable';
import { ActiviteSearch, type ActiviteSearchEntry } from '@/components/ui/ActiviteSearch';
import { ActiviteFonctionsEncart } from '@/components/ui/ActiviteFonctionsEncart';
import { MesuresRecap } from '@/components/ui/MesuresDetail';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import { getParliamentCounts } from '@/lib/parliament-counts';
import { lienSource } from '@/lib/sources';
import {
  ACTIVITE_FUNCTIONS,
  ACTIVITE_METHODE_MAJ,
  ACTIVITE_WEIGHTS,
  fonctionsDeLigne,
  mesuresDeLigne,
  type FonctionKey,
  type MetricKey,
} from '@/lib/activite-weights';
import { StackedFamsByGroupChart } from '@/app/[locale]/(app)/Facts/representativite/metiers/StackedFamsByGroupChart';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerActivite' });
  const title = t('pageMetaTitle');
  const description = t('pageMetaDesc');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Activite'),
    openGraph: buildOpenGraph(locale, '/Activite', title, description),
  };
}

const COLOR = '#06B6D4';

// Les deux sources du score, lues dans la liste unique du site : les dumps open data de
// l'Assemblée (`source1`) et du Sénat (`source2`). L'en-tête de la page (`PAGES_L2` dans
// `navigation.tsx`) n'affiche pas de sources, comme celui des autres pages de ce groupe :
// elles vivent en tête de Méthodologie.
const SOURCES_SCORE = [lienSource('source1'), lienSource('source2')];

// Une teinte par fonction pour le graphique « ce qui fait le score ». Les quatre ont
// passé le validateur de palette (écart perceptif, trois daltonismes, contraste 3:1)
// sur le fond clair comme sur le fond sombre des cartes, d'où une seule série pour
// les deux thèmes. Teal et violet viennent de la palette de graphiques (BRAND_ID
// §8.8), l'or est l'Or Doux assombri pour tenir 3:1 sur blanc. Ni bleu, ni rouge,
// ni vert : sur un graphique par groupe, ils se liraient comme des couleurs de parti.
const FONCTION_COLORS: Record<FonctionKey, string> = {
  legiferer: '#0891B2',
  deliberer: '#B8892F',
  controler: '#8B5CF6',
  commission: '#DB2777',
};
const FONCTION_ORDER: FonctionKey[] = ['legiferer', 'deliberer', 'controler', 'commission'];
const METRIQUES = Object.keys(ACTIVITE_WEIGHTS) as MetricKey[];

type ViewRow = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  groupe: string | null;
  chambre: string;
  taux_participation_votes_finaux: number | null;
  nb_dossiers_inities: number | null;
  nb_textes_cosignes: number | null;
  nb_rapporteur: number | null;
  nb_rapports_controle: number | null;
  nb_amendements_auteur: number | null;
  nb_amendements_cosignataire: number | null;
  nb_questions_orales: number | null;
  nb_questions_ecrites: number | null;
  nb_prises_parole: number | null;
  nb_commission_presences: number | null;
  // Centiles (`cp_*`), sous-scores (`score_<fonction>`) et rangs par fonction
  // (`rang_<fonction>`) se lisent par `mesuresDeLigne` et `fonctionsDeLigne`.
  score: number | null;
  rang_chambre: number | null;
  date_debut_mandat: string | null;
  jours_actifs: number;
  est_president_chambre: boolean;
  est_president_groupe: boolean;
};

export default async function ActivitePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerActivite' });
  const tKpis = await getTranslations({ locale, namespace: 'kpis' });
  const tKpisHub = await getTranslations({ locale, namespace: 'kpisHub' });
  // Insécable devant le deux-points en français, rien en anglais.
  const deuxPoints = locale === 'fr' ? '\u00a0:' : ':';
  const messages = await getMessages();
  const tableCountTemplate = (messages as Record<string, Record<string, string>>)['answerActivite']['tableCount'];
  const tableCountWithMinistersTemplate = (messages as Record<string, Record<string, string>>)['answerActivite']['tableCountWithMinisters'];
  const tableCountRankedTemplate = (messages as Record<string, Record<string, string>>)['answerActivite']['tableCountRanked'];

  // ── Données : vue matérialisée (rafraîchie en fin de cron nightly) ─────
  // Le tri se termine par `uid` pour être stable, deux élus pouvant partager un score.
  const [rows, counts] = await Promise.all([
    sql<ViewRow[]>`
      select *
      from activite_elus_mv
      order by score desc, uid`,
    getParliamentCounts(),
  ]);
  const { an: anEnExercice, sn: snEnExercice } = counts;

  // ── Organes ─────────────────────────────────────────────────────────────
  const groupeUids = new Set<string>();
  rows.forEach((r) => { if (r.groupe) groupeUids.add(r.groupe); });

  type OrganeInfo = { libelle: string; couleur: string | null };
  const organesMap = new Map<string, OrganeInfo>();

  if (groupeUids.size > 0) {
    const organesData = await sql<{ uid: string; libelle: string | null; libelle_abrege: string | null; couleur_associee: string | null }[]>`
      select uid, libelle, libelle_abrege, couleur_associee
      from organes
      where uid = any(${Array.from(groupeUids)})`;
    organesData.forEach((o) => {
      organesMap.set(o.uid, {
        libelle: o.libelle ?? o.libelle_abrege ?? o.uid,
        couleur: o.couleur_associee,
      });
    });
  }

  // ── Mapping ViewRow → ActiviteRow ───────────────────────────────────────
  const enriched: ActiviteRow[] = rows.map((r) => ({
    uid: r.uid,
    prenom: r.prenom ?? '',
    nom: r.nom ?? '',
    groupe: r.groupe,
    groupeLabel: r.groupe ? (organesMap.get(r.groupe)?.libelle ?? null) : null,
    chambre: (r.chambre === 'AN' ? 'AN' : 'SN') as 'AN' | 'SN',
    rang: r.rang_chambre ?? null,
    taux_participation_votes_finaux: r.taux_participation_votes_finaux,
    nb_dossiers_inities: r.nb_dossiers_inities ?? 0,
    nb_textes_cosignes: r.nb_textes_cosignes ?? 0,
    nb_rapporteur: r.nb_rapporteur ?? 0,
    nb_rapports_controle: r.nb_rapports_controle ?? 0,
    nb_amendements_auteur: r.nb_amendements_auteur ?? 0,
    nb_amendements_cosignataire: r.nb_amendements_cosignataire ?? 0,
    nb_questions_orales: r.nb_questions_orales ?? 0,
    nb_questions_ecrites: r.nb_questions_ecrites ?? 0,
    nb_prises_parole: r.nb_prises_parole ?? 0,
    nb_commission_presences: r.nb_commission_presences ?? null,
    score: r.score,
    ...mesuresDeLigne(r, 'cp'),
    sousScores: fonctionsDeLigne(r, 'score'),
    rangsFonctions: fonctionsDeLigne(r, 'rang'),
    joursActifs: r.jours_actifs ?? 0,
    estPresidentChambre: r.est_president_chambre,
    estPresidentGroupe: r.est_president_groupe,
  }));

  // Score NULL → exclu du classement, des moyennes par groupe et du top 3. Trois motifs
  // y mènent : mandat de moins de 180 jours, présidence de la chambre (D-123), et
  // présidence d'un groupe politique.
  const scored = enriched.filter((r) => r.score !== null);

  // Ministres en fonction = parlementaires en titre (acteurs) absents de la MV
  // (qui exclut est_ministre_actuel = true). Affiché au footer du tableau pour
  // expliquer l'écart entre le badge « (577) » et le compte affiché.
  const anInTable = enriched.filter((r) => r.chambre === 'AN').length;
  const snInTable = enriched.filter((r) => r.chambre === 'SN').length;
  const anMinistersExcluded = Math.max(0, anEnExercice - anInTable);
  const snMinistersExcluded = Math.max(0, snEnExercice - snInTable);

  // Total par chambre pour le rang affiché dans la search : seulement les classés.
  const anTotal = scored.filter((r) => r.chambre === 'AN').length;
  const snTotal = scored.filter((r) => r.chambre === 'SN').length;

  const searchEntries: ActiviteSearchEntry[] = enriched.map((r) => ({
    uid: r.uid,
    nom: r.nom,
    prenom: r.prenom,
    chambre: r.chambre,
    groupeLabel: r.groupeLabel,
    score: r.score,
    rank: r.rang ?? null,
    total: r.chambre === 'AN' ? anTotal : snTotal,
    cpPart: r.cpPart,
    cpDoss: r.cpDoss,
    cpCosign: r.cpCosign,
    cpRapp: r.cpRapp,
    cpRappCtrl: r.cpRappCtrl,
    cpAmendAuteur: r.cpAmendAuteur,
    cpAmendCosign: r.cpAmendCosign,
    cpQuestO: r.cpQuestO,
    cpQuestE: r.cpQuestE,
    cpPrisesParole: r.cpPrisesParole,
    cpCommPres: r.cpCommPres,
    joursActifs: r.joursActifs,
    estPresidentChambre: r.estPresidentChambre,
    estPresidentGroupe: r.estPresidentGroupe,
  }));

  // ── Groupe bar chart : score moyen par groupe (AN + SN) ────────────────
  const groupeChartFor = (chambre: 'AN' | 'SN') => {
    const scoresByGroupe = new Map<string, number[]>();
    scored
      .filter((r) => r.chambre === chambre && r.groupe)
      .forEach((r) => {
        const uid = r.groupe as string;
        if (!scoresByGroupe.has(uid)) scoresByGroupe.set(uid, []);
        scoresByGroupe.get(uid)!.push(r.score as number);
      });
    return Array.from(scoresByGroupe.entries())
      .map(([uid, scores]) => {
        const info = organesMap.get(uid);
        if (!info) return null;
        const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
        return { groupe: info.libelle, value: avg, fill: resolveGroupeColor(info.couleur, COLOR) };
      })
      .filter((x): x is { groupe: string; value: number; fill: string } => x !== null)
      .sort((a, b) => b.value - a.value);
  };
  const groupeChartAN = groupeChartFor('AN');
  const groupeChartSN = groupeChartFor('SN');

  // ── Ce qui fait le score de chaque groupe : points apportés par fonction ──
  // Reprend la formule du score de la vue (`2026-09-09_activite_rapports_controle.sql`) :
  // une mesure apporte centile × poids ÷ somme des poids des mesures disponibles pour
  // l'élu. Les apports d'un élu somment donc à son score, et leur moyenne par groupe au
  // score moyen du groupe : la barre entière retombe sur la valeur du graphique
  // précédent, aux arrondis près. Mêmes élus que `groupeChartFor` (classés, avec un
  // groupe connu de `organes`), sinon les deux graphiques ne se liraient plus ensemble.
  const contributionsChartFor = (chambre: 'AN' | 'SN') => {
    const parGroupe = new Map<string, { n: number; apports: Record<FonctionKey, number> }>();
    scored
      .filter((r) => r.chambre === chambre && r.groupe && organesMap.has(r.groupe))
      .forEach((r) => {
        const sommePoids = METRIQUES.reduce((s, m) => (r[m] == null ? s : s + ACTIVITE_WEIGHTS[m]), 0);
        if (sommePoids === 0) return;
        const uid = r.groupe as string;
        if (!parGroupe.has(uid)) {
          parGroupe.set(uid, { n: 0, apports: { legiferer: 0, deliberer: 0, controler: 0, commission: 0 } });
        }
        const acc = parGroupe.get(uid)!;
        acc.n += 1;
        for (const f of FONCTION_ORDER) {
          for (const m of ACTIVITE_FUNCTIONS[f].metrics) {
            const v = r[m];
            if (v != null) acc.apports[f] += (v * ACTIVITE_WEIGHTS[m]) / sommePoids;
          }
        }
      });
    return Array.from(parGroupe.entries())
      .map(([uid, { n, apports }]) => {
        const moyennes = FONCTION_ORDER.map((f) => apports[f] / n);
        return {
          total: moyennes.reduce((a, b) => a + b, 0),
          row: {
            groupe: organesMap.get(uid)!.libelle,
            ...Object.fromEntries(FONCTION_ORDER.map((f, i) => [f, Math.round(moyennes[i] * 10) / 10])),
          },
        };
      })
      .sort((a, b) => b.total - a.total)
      .map((x) => x.row);
  };
  const contributionsAN = contributionsChartFor('AN');
  const contributionsSN = contributionsChartFor('SN');
  const fonctionLabels: Record<FonctionKey, string> = {
    legiferer: t('fonctionLabelLegiferer'),
    deliberer: t('fonctionLabelDeliberer'),
    controler: t('fonctionLabelControler'),
    commission: t('fonctionLabelCommission'),
  };
  const contributionSegments = FONCTION_ORDER.map((f) => ({
    key: f,
    label: fonctionLabels[f],
    color: FONCTION_COLORS[f],
  }));

  // Top 3 par chambre — utilisés dans la section LA RÉPONSE.
  // On affiche le rang RANK fourni par la vue pour respecter les ex-aequo
  // (ex : deux élus à 90 sont tous les deux 1ᵉʳˢ, le suivant est 3ᵉ).
  const top3 = (chambre: 'AN' | 'SN') =>
    scored
      .filter((r) => r.chambre === chambre)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3);
  const top3AN = top3('AN');
  const top3SN = top3('SN');

  // Portraits du podium. Seuls les sénateurs en ont besoin : `photoElu` dérive
  // l'URL d'un député de son uid, mais lit celle d'un sénateur dans sa fiche
  // officielle, colonne absente de `activite_elus_mv`. Une panne lève (D-136) : la
  // version précédente de la page, avec ses photos, vaut mieux qu'un podium en
  // initiales figé 24 h. `PhotoEluVignette` garde son repli sur les initiales pour
  // un sénateur sans fiche officielle ou une image qui ne charge pas.
  const profilsSenat = await sql<{ uid: string; url_profil_officiel: string | null }[]>`
    select uid, url_profil_officiel
    from acteurs
    where uid = any(${top3SN.map((r) => r.uid)})`;
  const profilParUid = new Map(profilsSenat.map((a) => [a.uid, a.url_profil_officiel]));

  return (
    <div className="py-12">
      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLOR }}>
        {t('sectionAnswer')}
      </h2>
      {/* Top 3 par chambre en podium : ils tiennent lieu de phrase-réponse (D-160).
          L'ordre du DOM reste 1, 2, 3 pour les lecteurs d'écran ; seul `order` place
          le 2ᵉ à gauche. La hauteur de marche suit le rang et non la position, pour
          que deux ex-aequo soient à la même hauteur. Le bloc de texte réserve deux
          lignes de nom et deux de groupe : sans ça, un nom plus long hausserait sa
          colonne et le podium ne se lirait plus par les marches. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {([
          { label: tKpis('top3Assemblee'), rows: top3AN },
          { label: tKpis('top3Senat'),               rows: top3SN },
        ] as const).map(({ label, rows }) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-sm font-semibold" style={{ color: COLOR }}>{label}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ol className="flex items-end" style={{ gap: '0.5rem' }}>
                {rows.map((r, i) => {
                  const marche = r.rang === 1 ? 76 : r.rang === 2 ? 52 : 34;
                  return (
                    <li
                      key={r.uid}
                      className="flex flex-col items-center text-center min-w-0"
                      style={{ order: [2, 1, 3][i], flex: '1 1 0' }}
                    >
                      <Link href={`/les-elus/${r.uid}`} prefetch={false} className="group flex flex-col items-center w-full min-w-0">
                        <PhotoEluVignette
                          acteur={{ uid: r.uid, url_profil_officiel: profilParUid.get(r.uid) ?? null, prenom: r.prenom, nom: r.nom }}
                          taille={r.rang === 1 ? 64 : 52}
                        />
                        <span
                          className="font-semibold group-hover:underline"
                          style={{ marginTop: '0.5rem', fontSize: '0.9375rem', lineHeight: 1.25, minHeight: '2.5em', overflowWrap: 'anywhere' }}
                        >
                          {r.prenom}<br />{r.nom}
                        </span>
                      </Link>
                      <span
                        className="text-muted-foreground"
                        style={{
                          marginTop: '0.25rem',
                          fontSize: '0.75rem',
                          lineHeight: 1.3,
                          minHeight: '2.6em',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {r.groupeLabel ?? '—'}
                      </span>
                      <div
                        className="w-full font-bold tabular-nums"
                        style={{
                          marginTop: '0.5rem',
                          height: `${marche}px`,
                          paddingTop: '0.375rem',
                          backgroundColor: `${COLOR}14`,
                          borderTop: `2px solid ${COLOR}`,
                          color: COLOR,
                          fontSize: '1rem',
                        }}
                      >
                        {r.rang ?? '—'}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        ))}
      </div>

      {/*
        La mise en garde suit immédiatement le Top 3 : c'est le seul endroit où elle
        est lue juste après les trois noms, avant le tableau complet. Le détail reste
        en méthodologie. Filet de 2 px plutôt qu'un encadré coloré, cf. BRAND_ID §8.4.
      */}
      <div className="mb-12" style={{ borderLeft: `2px solid ${COLOR}`, paddingLeft: '1rem' }}>
        <p className="leading-relaxed text-foreground/80" style={{ fontSize: '0.9375rem' }}>
          <span className="font-semibold text-foreground">{t('caveatTitle')}</span>{' '}
          {t.rich('caveatBody', {
            corrections: (chunks) => (
              <Link href="/documentation/corrections" prefetch={false} className="underline hover:text-foreground">
                {chunks}
              </Link>
            ),
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

      {/* Chercher un élu */}
      <div className="mb-12">
        <Card>
          <CardHeader>
            <CardTitle>{t('searchTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ActiviteSearch
              entries={searchEntries}
              color={COLOR}
              labels={{
                placeholder: t('searchPlaceholder'),
                noResult: t('searchNoResult'),
                colScore: t('colScore'),
                colParticipation: t('colParticipation'),
                colInities: t('colInities'),
                colCosignes: t('colCosignes'),
                colRapporteur: t('colRapporteur'),
                colRappCtrl: t('colRappCtrl'),
                colAmendAuteur: t('colAmendAuteur'),
                colAmendCosign: t('colAmendCosign'),
                colQuestO: t('colQuestO'),
                colQuestE: t('colQuestE'),
                colPrisesParole: t('colPrisesParole'),
                colCommPres: t('colCommPres'),
                rankLabel: t('colRang'),
                outOfLabel: t('searchOutOf'),
                chambreAN: t('chambreAN'),
                chambreSN: t('chambreSN'),
                badgeMandatRecent: t('badgeMandatRecent'),
                badgeMandatRecentTooltip: t('badgeMandatRecentTooltip'),
                badgePresidentChambre: t('badgePresidentChambre'),
                badgePresidentChambreTooltip: t('badgePresidentChambreTooltip'),
                badgePresidentGroupe: t('badgePresidentGroupe'),
                badgePresidentGroupeTooltip: t('badgePresidentGroupeTooltip'),
                joursActifs: t('joursActifs'),
                joursActifsTooltip: t('joursActifsTooltip'),
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* À COMPRENDRE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: COLOR }}>
        {t('conceptsTitle')}
      </h2>
      <ActiviteFonctionsEncart accentColor={COLOR} />
      {/* Trois sections repliées : qui est classé, comment, et ce que chaque mesure
          contient. Repliées parce que le lecteur venu pour le classement n'a pas à
          traverser un mur de texte, et que l'encart ci-dessus donne déjà les poids. */}
      <ConceptsAccordion sectionMesures="mesures">
        <AccordionItem value="perimetre">
          <AccordionTrigger className="hover:no-underline">{t('concept1Title')}</AccordionTrigger>
          <AccordionContent>
            <p className="text-foreground/80 leading-relaxed">
              {t('concept1Desc', { an: anEnExercice, sn: snEnExercice })}
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="score">
          <AccordionTrigger className="hover:no-underline">{t('concept2Title')}</AccordionTrigger>
          <AccordionContent>
            {/* Quatre étapes numérotées plutôt qu'un paragraphe : le calcul est une suite
                d'opérations, et chacune se relit seule quand on revient sur la page. */}
            <p className="text-foreground/80 leading-relaxed">{t('concept2Desc')}</p>
            <ol className="mt-4 space-y-4">
              {([1, 2, 3, 4] as const).map((n) => (
                <li key={n} className="flex gap-3">
                  <span
                    className="shrink-0 tabular-nums font-semibold"
                    style={{ color: COLOR, fontSize: '0.9375rem', lineHeight: 1.7 }}
                  >
                    {n}
                  </span>
                  <span>
                    <span className="font-semibold">
                      {t(`concept2Etape${n}Titre` as Parameters<typeof t>[0])}
                    </span>
                    <span className="text-foreground/80 leading-relaxed">
                      {' — '}
                      {t(`concept2Etape${n}Desc` as Parameters<typeof t>[0])}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-muted-foreground mt-4" style={{ fontSize: '0.875rem', lineHeight: 1.7 }}>
              {t('concept2Note')}
            </p>
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="mesures">
          <AccordionTrigger className="hover:no-underline">{t('mesureLabels.recapTitle')}</AccordionTrigger>
          <AccordionContent>
            <MesuresRecap accentColor={COLOR} />
          </AccordionContent>
        </AccordionItem>
      </ConceptsAccordion>

      {/* ② EN CHIFFRES */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-8" style={{ color: COLOR }}>
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        {/* Score moyen par groupe — Assemblée nationale */}
        {groupeChartAN.length > 0 && (
          <GroupeBarChart
            data={groupeChartAN}
            title={t('chartTitleAN')}
            description={t('chartDescGroupe')}
            color={COLOR}
            valueLabel={t('chartValueLabel')}
            labelWidth={280}
            labelMaxChars={38}
            xDomain={[0, 100]}
          />
        )}

        {/* Score moyen par groupe — Sénat */}
        {groupeChartSN.length > 0 && (
          <GroupeBarChart
            data={groupeChartSN}
            title={t('chartTitleSN')}
            description={t('chartDescGroupe')}
            color={COLOR}
            valueLabel={t('chartValueLabel')}
            labelWidth={280}
            labelMaxChars={38}
            xDomain={[0, 100]}
          />
        )}

        {/* Ce qui fait le score de chaque groupe. Juste sous le score moyen par groupe,
            dans le même ordre de chambres : chaque barre décompose la valeur lue au-dessus. */}
        {contributionsAN.length > 0 && (
          <StackedFamsByGroupChart
            data={contributionsAN}
            segments={contributionSegments}
            title={t('chartTitleContribAN')}
            description={t('chartDescContrib')}
            labelWidth={280}
            labelMaxChars={38}
            unite="points"
          />
        )}
        {contributionsSN.length > 0 && (
          <StackedFamsByGroupChart
            data={contributionsSN}
            segments={contributionSegments}
            title={t('chartTitleContribSN')}
            description={t('chartDescContrib')}
            labelWidth={280}
            labelMaxChars={38}
            unite="points"
          />
        )}

        {/* Tableau principal */}
        <div className="md:col-span-2">
          <ActiviteTable
            rows={enriched}
            color={COLOR}
            labels={{
              tableTitle: t('tableTitle'),
              tableDesc: t('tableDesc'),
              tableNote: t('tableNote'),
              tableCount: tableCountTemplate,
              tableCountWithMinisters: tableCountWithMinistersTemplate,
              tableCountRanked: tableCountRankedTemplate,
              ministersExcludedAN: anMinistersExcluded,
              ministersExcludedSN: snMinistersExcluded,
              colRangTooltip: t('colRangTooltip'),
              filterAN: t('filterAN', { count: anEnExercice }),
              filterSN: t('filterSN', { count: snEnExercice }),
              joursActifs: t('joursActifs'),
              joursActifsTooltip: t('joursActifsTooltip'),
              badgeNonClasse: t('badgeNonClasse'),
              badgeNonClasseTooltip: t('badgeNonClasseTooltip'),
              badgePresidentChambre: t('badgePresidentChambre'),
              badgePresidentChambreTooltip: t('badgePresidentChambreTooltip'),
              badgePresidentGroupe: t('badgePresidentGroupe'),
              badgePresidentGroupeTooltip: t('badgePresidentGroupeTooltip'),
              colRang: t('colRang'),
              colNom: t('colNom'),
              colScore: t('colScore'),
              colGroupe: t('colGroupe'),
              colParticipation: t('colParticipation'),
              colInities: t('colInities'),
              colCosignes: t('colCosignes'),
              colRapporteur: t('colRapporteur'),
              colRappCtrl: t('colRappCtrl'),
              colAmendAuteur: t('colAmendAuteur'),
              colAmendCosign: t('colAmendCosign'),
              colQuestO: t('colQuestO'),
              colQuestE: t('colQuestE'),
              colPrisesParole: t('colPrisesParole'),
              colCommPres: t('colCommPres'),
              viewLabelPrefix: t('viewLabelPrefix'),
              viewScoreGlobal: t('viewScoreGlobal'),
              fonctionLabelLegiferer: t('fonctionLabelLegiferer'),
              fonctionLabelDeliberer: t('fonctionLabelDeliberer'),
              fonctionLabelControler: t('fonctionLabelControler'),
              fonctionLabelCommission: t('fonctionLabelCommission'),
              tooltipComposantes: t('tooltipComposantes'),
            }}
          />
        </div>
      </div>

      {/* ③ MÉTHODOLOGIE */}
      <Separator className="mb-8" />
      <h2 id="methodologie" className="text-xs font-bold uppercase tracking-widest mb-5 scroll-mt-24" style={{ color: COLOR }}>
        {t('methodologyTitle')}
      </h2>
      <div className="text-sm leading-relaxed text-foreground/80 space-y-4 mb-16">
        <p className="flex gap-3">
          <Database className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>
            {tKpisHub('labelSources')}{deuxPoints}{' '}
            {SOURCES_SCORE.map((src, i) => (
              <span key={src.key}>
                {i > 0 && ', '}
                <a href={src.href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                  {src.label}
                </a>
              </span>
            ))}
          </span>
        </p>
        <p className="flex gap-3">
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{tKpisHub('labelUpdated')}{deuxPoints} {tKpisHub('valueDaily')}</span>
        </p>
        <p className="flex gap-3">
          <Target className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          {/* Les six effectifs sont passés en paramètre, jamais écrits dans la traduction :
              figés, ils vieillissaient en silence à chaque suppléance ou remaniement. */}
          <span>
            {t('methodologyPerimetre', {
              an: anEnExercice,
              sn: snEnExercice,
              anTableau: anInTable,
              snTableau: snInTable,
              anClasses: anTotal,
              snClasses: snTotal,
            })}
          </span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyCentile')}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyScore')}</span>
        </p>
        <p className="flex gap-3">
          <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyFenetre')}</span>
        </p>
        <p className="flex gap-3">
          <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyNormalisation')}</span>
        </p>
        <p className="flex gap-3">
          <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimites')}</span>
        </p>
        <p className="flex gap-3">
          <FileCode2 className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>
            {t.rich('methodologyMaj', {
              date: new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', {
                day: 'numeric', month: 'long', year: 'numeric',
              }).format(new Date(`${ACTIVITE_METHODE_MAJ}T12:00:00`)),
              github: (chunks) => (
                <a
                  href="https://github.com/loiclair/LoiClair/blob/production/src/lib/activite-weights.ts"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  {chunks}
                </a>
              ),
            })}
          </span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Activite" locale={locale} />
    </div>
  );
}
