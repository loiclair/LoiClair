// Page `/Facts/cumul-des-mandats` : part des parlementaires qui gardent un mandat
// local, par chambre et par groupe, et liste nominative des situations que le
// Répertoire national des élus décrit comme contraires à la loi, après
// vérification au cas par cas : un seul tableau, délais dépassés en tête, puis
// les situations encore dans les temps ; celles que la vérification montre
// réglées sont retirées. Données lues par `getCumulMandats`
// (`lib/facts-queries`), textes dans `answerCumulMandats`.
export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getCumulMandats } from '@/lib/facts-queries';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { GroupeBarChart } from '@/components/ui/GroupeBarChart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Filter, AlertTriangle } from 'lucide-react';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { Surligne } from '@/components/ui/Surligne';
import type { CorrectionCumul } from '@/lib/facts-queries';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerCumulMandats' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Facts/cumul-des-mandats'),
    openGraph: buildOpenGraph(locale, '/Facts/cumul-des-mandats', title, description),
  };
}

const COLOR = '#0f766e';

/** L'ambre des situations interdites, le même que sur la fiche élu. Pas le
 *  rouge : ces situations doivent se résoudre, mais elles sont souvent
 *  régulières le temps que le délai de choix s'ouvre. */
const ALERTE = '#b45309';

/**
 * Les trois articles que l'article cite, liés à leur texte sur Légifrance : ce
 * sont eux qui font la règle, et le lecteur doit pouvoir les lire lui-même.
 * Un volet qui ne porte pas la balise n'en souffre pas, `t.rich` ignore ce
 * qu'il ne trouve pas.
 */
const ARTICLES_LEGIFRANCE = {
  lo141: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000028612481',
  lo1411: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000028601346',
  lo151: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000028603725',
  l238: 'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027433861',
} as const;

const LIENS_LOI = Object.fromEntries(
  Object.entries(ARTICLES_LEGIFRANCE).map(([cle, href]) => [
    cle,
    (chunks: React.ReactNode) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-2 hover:no-underline"
        style={{ color: COLOR }}
      >
        {chunks}
      </a>
    ),
  ]),
);

/** Seuil sous lequel un groupe ne figure pas dans le graphique : à cinq
 *  membres, une part se déplace de vingt points pour un seul élu. */
const EFFECTIF_MINIMUM = 10;

export default async function CumulMandatsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const t = await getTranslations({ locale, namespace: 'answerCumulMandats' });

  // `anomalies` arrive rangé : délais dépassés en tête, puis dans le délai, puis
  // élections contestées, chaque groupe par urgence.
  const { millesime, verification, effectifs, cumulards, parType, parGroupe, anomalies, comptes } =
    await getCumulMandats();

  const totalElus = effectifs.AN + effectifs.SN;
  const totalCumulards = cumulards.AN + cumulards.SN;
  const partAN = effectifs.AN > 0 ? Math.round((cumulards.AN / effectifs.AN) * 100) : 0;
  const partSN = effectifs.SN > 0 ? Math.round((cumulards.SN / effectifs.SN) * 100) : 0;
  const partTotale = totalElus > 0 ? Math.round((totalCumulards / totalElus) * 100) : 0;

  const millesimeLisible = millesime
    ? new Date(millesime).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : '';

  // Le jour compte : c'est un délai de trente jours qui court, et « mars 2026 »
  // ne permettrait pas de situer une situation ouverte le 30.
  const dateLisible = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const verificationLisible = verification ? dateLisible(verification) : '';

  // « · Source : ici », en lien externe, à la suite de tout ce que LoiClair
  // affirme au-delà du registre.
  const lienSource = (url: string | null, nom: string | null) =>
    url && (
      <>
        {' · '}
        {t.rich('correctionSource', {
          nom: nom ?? url,
          lien: (chunks) => (
            <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline">
              {chunks}
            </a>
          ),
        })}
      </>
    );

  // Une correction se lit en deux lignes étiquetées : « Registre : … », ce que
  // dit la donnée officielle, puis « Corrigé par LoiClair : … », ce qui a changé
  // et d'où on le tient. Le lecteur sépare ainsi d'un coup d'œil la source
  // publique de notre vérification. Sans date dans la source, le changement est
  // daté du jour où LoiClair l'a constaté.
  const rendreCorrection = (c: CorrectionCumul) => (
    <div key={`${c.type}-${c.collectivite}`}>
      <div>
        {t('correctionRegistre', {
          libelle: `${c.fonction ?? t(`type_${c.type}` as Parameters<typeof t>[0])} · ${c.collectivite}`,
        })}
      </div>
      <div className="text-xs">
        {c.effet === 'fonction_jamais_exercee'
          ? t('correctionErreur')
          : c.date
            ? t('correctionDatee', { effet: c.effet, date: dateLisible(c.date) })
            : t('correctionConstatee', { effet: c.effet, date: verificationLisible })}
        {lienSource(c.sourceUrl, c.sourceNom)}
      </div>
    </div>
  );

  // Le nom, lié à la fiche, puis la chambre et la date d'ouverture de la
  // situation : sans cette date, la liste se lit comme un palmarès de fautifs.
  const rendreNom = (a: { uid: string; nom: string; chambre: 'AN' | 'SN'; depuis?: string | null }) => (
    <>
      <Link
        href={`/les-elus/${a.uid}`}
        prefetch={false}
        className="block text-sm font-medium leading-snug hover:underline hover:text-primary transition-colors"
      >
        {a.nom}
      </Link>
      <div className="text-xs text-muted-foreground">
        {t(a.chambre === 'AN' ? 'chambreAN' : 'chambreSN')}
        {a.depuis && <> · {t('anomalieDepuis', { date: dateLisible(a.depuis) })}</>}
      </div>
    </>
  );

  // Le motif tel que le registre le décrit, puis ce que la vérification y a déjà
  // corrigé, en gris : une précision, pas un motif de plus. `alerte` met les
  // pastilles et l'ambre, réservés aux délais dépassés : une situation encore
  // dans les temps est régulière et ne porte aucune teinte d'alerte.
  const rendreMotif = (a: (typeof anomalies)[number], alerte: boolean) => (
    <div className="text-sm text-muted-foreground leading-snug space-y-0.5">
      {alerte && (a.executives.length > 0 || a.conseils.length > 0) && (
        <div className="flex flex-wrap gap-1.5 pb-1.5">
          {/* La pastille porte toute la réserve (D-274) : elle passe à la
              ligne au lieu de déborder, d'où des coins moins arrondis qu'une
              pilule d'une ligne. */}
          {a.executives.length > 0 && (
            <span
              className="text-[11px] font-medium px-2 py-0.5 rounded-md"
              style={{ backgroundColor: 'rgba(217, 119, 6, 0.14)', color: ALERTE, lineHeight: 1.35 }}
            >
              {t('anomalieBadgeExecutif')}
            </span>
          )}
          {a.conseils.length > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-muted text-muted-foreground">
              {t('anomalieBadgeConseils')}
            </span>
          )}
        </div>
      )}
      {a.executives.map((e) => (
        <div key={e} style={alerte ? { color: ALERTE } : undefined}>{e}</div>
      ))}
      {a.conseils.length > 0 && (
        <div>
          {a.conseils
            .map((c) => `${c.collectivite} (${t(`typeCourt_${c.type}` as Parameters<typeof t>[0])})`)
            .join(' + ')}
        </div>
      )}
      {a.corrections.length > 0 && (
        <div className="pt-1.5 space-y-1 text-muted-foreground/80">{a.corrections.map(rendreCorrection)}</div>
      )}
    </div>
  );

  // La colonne Statut. Un délai dépassé, en ambre : passé ce délai, la loi met
  // fin d'elle-même au mandat le plus ancien, et le registre peut ne pas l'avoir
  // encore enregistré. Un délai en cours ou une élection contestée, en gris : la
  // situation est régulière aujourd'hui. Seule une date établie par la
  // vérification ou une contestation porte une source ; le reste se calcule
  // depuis le registre et la loi (`echeanceSituation`).
  const rendreStatut = (a: (typeof anomalies)[number]) => {
    const e = a.echeance;
    const source = e && lienSource(e.sourceUrl, e.sourceNom);
    if (a.groupe === 'depasse') {
      return (
        <span style={{ color: ALERTE }}>
          {e?.etat === 'date' ? t('statutDepasse', { date: dateLisible(e.date) }) : t('statutNonDate')}
          {source}
        </span>
      );
    }
    return (
      <span className="text-muted-foreground">
        {e?.etat === 'date' ? t('statutDelai', { date: dateLisible(e.date) }) : t('statutRecours')}
        {source && <span className="text-xs">{source}</span>}
      </span>
    );
  };

  // Le nom complet du groupe, suivi de sa chambre. Y ajouter l'effectif
  // dépassait la largeur réservée aux libellés et tronquait les noms, alors que
  // c'est justement le nom qu'on vient lire.
  const groupesDe = (chambre: 'AN' | 'SN') =>
    parGroupe
      .filter((g) => g.chambre === chambre && g.effectif >= EFFECTIF_MINIMUM)
      .map((g) => ({
        groupe: `${g.groupe} · ${g.cumulards}/${g.effectif}`,
        value: Math.round((g.cumulards / g.effectif) * 100),
      }));

  // L'ordre suit l'échelon, du plus proche du terrain au plus large : c'est
  // celui des fiches élu, et il se lit mieux qu'un classement par volume.
  const ORDRE_TYPES = ['municipal', 'arrondissement', 'communautaire', 'departemental', 'regional', 'assemblee'];
  const typesAffiches = ORDRE_TYPES
    .filter((type) => parType[type])
    .map((type) => ({ type, nombre: parType[type] }));

  return (
    <div className="py-12">

      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLOR }}>
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          part: partTotale,
          total: totalCumulards,
          hl: (chunks) => (
            <Surligne couleur={COLOR}>{chunks}</Surligne>
          ),
        })}
      </p>

      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('heroTitle')}</CardTitle>
          <CardDescription>{t('heroDesc', { date: millesimeLisible })}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div>
              <div className="text-4xl font-bold tabular-nums" style={{ color: COLOR }}>{pourcent.format(partAN / 100)}</div>
              <p className="text-sm text-muted-foreground mt-1">
                {t('heroAN', { cumulards: cumulards.AN, effectif: effectifs.AN })}
              </p>
            </div>
            <div>
              <div className="text-4xl font-bold tabular-nums" style={{ color: COLOR }}>{pourcent.format(partSN / 100)}</div>
              <p className="text-sm text-muted-foreground mt-1">
                {t('heroSN', { cumulards: cumulards.SN, effectif: effectifs.SN })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* À COMPRENDRE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: COLOR }}>
        {t('conceptsTitle')}
      </h2>
      <Accordion type="multiple" className="mb-12">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <AccordionItem key={n} value={`concept-${n}`}>
            <AccordionTrigger className="text-left">
              {t(`concept${n}Title` as Parameters<typeof t>[0])}
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-foreground/80">
              {t.rich(`concept${n}Body` as Parameters<typeof t>[0], LIENS_LOI)}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* ② EN CHIFFRES */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: COLOR }}>
        {t('sectionInNumbers')}
      </h2>

      <div className="grid grid-cols-1 gap-6 mb-12">
        {/* Un graphique par chambre : les groupes n'y portent pas les mêmes
            noms, et une échelle commune ferait croire à un classement unique
            alors que les deux assemblées ne se recrutent pas pareil.
            `labelWidth` et `labelMaxChars` réservent la place des noms complets :
            aux valeurs par défaut, « Rassemblement Démocratique et Social
            Européen » déborde à gauche de sa colonne et perd ses premières
            lettres, le libellé étant aligné par la droite. */}
        <GroupeBarChart
          data={groupesDe('AN')}
          title={t('groupesChartTitleAN')}
          description={t('groupesChartDesc', { seuil: EFFECTIF_MINIMUM })}
          color={COLOR}
          valueLabel={t('groupesChartLabel')}
          xDomain={[0, 100]}
          labelWidth={280}
          labelMaxChars={40}
        />

        <GroupeBarChart
          data={groupesDe('SN')}
          title={t('groupesChartTitleSN')}
          description={t('groupesChartDesc', { seuil: EFFECTIF_MINIMUM })}
          color={COLOR}
          valueLabel={t('groupesChartLabel')}
          note={t('groupesChartNote')}
          xDomain={[0, 100]}
          labelWidth={280}
          labelMaxChars={40}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t('typesTitle')}</CardTitle>
            <CardDescription>{t('typesDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {typesAffiches.map(({ type, nombre }) => (
                <li key={type} className="flex items-baseline justify-between gap-4 border-b pb-2 last:border-0">
                  <span className="text-sm">{t(`type_${type}` as Parameters<typeof t>[0])}</span>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: COLOR }}>
                    {nombre.toLocaleString(locale)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
          <div className="border-t px-6 py-4">
            <p className="text-sm text-foreground/70 leading-relaxed">{t('typesNote')}</p>
          </div>
        </Card>

        {/* Les situations relevées dans le registre, dans leur propre carte :
          ce sont deux règles distinctes, et les noyer parmi les taux de cumul
          laissait croire qu'elles en étaient une déclinaison. Deux chiffres :
          les délais dépassés, seuls à régulariser, et les situations encore
          dans les temps. */}
      <Card className="mb-12" style={{ borderColor: 'rgba(217, 119, 6, 0.35)' }}>
        <CardHeader>
          <CardTitle>{t('interditsTitle')}</CardTitle>
          {/* Le total d'abord, en gras : sans lui, le lecteur devait additionner
              les deux chiffres qui suivent pour savoir combien d'élus la liste
              nomme. */}
          <CardDescription>
            {t.rich('interditsDesc', {
              total: anomalies.length,
              b: (chunks) => <strong className="font-semibold text-foreground">{chunks}</strong>,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <div>
              <div className="text-4xl font-bold tabular-nums" style={{ color: ALERTE }}>{comptes.depasse}</div>
              <p className="text-sm text-muted-foreground mt-1">{t('heroDepasse')}</p>
            </div>
            <div>
              <div className="text-4xl font-bold tabular-nums text-foreground/70">{comptes.dansLesTemps}</div>
              <p className="text-sm text-muted-foreground mt-1">{t('heroDansLesTemps')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('anomaliesTitle')}</CardTitle>
            <CardDescription>{t('anomaliesDesc')}</CardDescription>
          </CardHeader>
          {/* Avant les noms, pas après : en pied de carte, la méthode arrivait
              quand le lecteur avait déjà lu la liste comme un palmarès de
              fautifs. Card espace déjà ses enfants (gap-6), d'où le seul padding
              horizontal ici. Elle dit quelles sources sont croisées, que chaque
              ligne est vérifiée à la main et quand, pour qu'un mois sauté se
              voie, et qu'une situation réglée est retirée. Suit l'adresse où un
              élu nommé à tort peut le signaler. */}
          <div className="px-6 space-y-2">
            <p
              className="text-sm text-foreground/70 leading-relaxed border-l-2 pl-4"
              style={{ borderColor: ALERTE }}
            >
              {t('anomaliesAlerte', { date: millesimeLisible, verification: verificationLisible })}
            </p>
            <p className="text-sm text-foreground/70 leading-relaxed pl-4">
              {t.rich('anomaliesContact', {
                mail: (chunks) => (
                  // `target="_blank"` comme tous les liens vers contact@loiclair.fr,
                  // pour qu'ils se comportent pareil.
                  <a
                    href="mailto:contact@loiclair.fr"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:no-underline"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </div>
          <CardContent>
            {/* Un seul tableau, sur le modèle d'`ActiviteTable` : délais
                dépassés en tête, en ambre, puis les situations encore dans les
                temps, en gris. Sous 640 px, le motif passe sous le nom plutôt
                que d'écraser une troisième colonne. */}
            {anomalies.length > 0 ? (
              <table className="w-full text-sm table-fixed sm:table-auto">
                <thead className="border-b border-border">
                  <tr>
                    <th className="py-2.5 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('colParlementaire')}
                    </th>
                    <th className="hidden sm:table-cell py-2.5 px-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('colMotif')}
                    </th>
                    <th className="w-36 sm:w-auto py-2.5 pl-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('colStatut')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {anomalies.map((a) => (
                    <tr key={a.uid} className="align-top">
                      <td className="py-3 pr-3">
                        {rendreNom(a)}
                        <div className="sm:hidden mt-2">{rendreMotif(a, a.groupe === 'depasse')}</div>
                      </td>
                      <td className="hidden sm:table-cell py-3 px-3">{rendreMotif(a, a.groupe === 'depasse')}</td>
                      <td className="py-3 pl-3">{rendreStatut(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-muted-foreground">{t('tableauVide')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ③ MÉTHODOLOGIE */}
      <Separator className="mb-8" />
      <h2 id="methodologie" className="text-xs font-bold uppercase tracking-widest mb-5 scroll-mt-24" style={{ color: COLOR }}>
        {t('methodologyTitle')}
      </h2>
      <div className="text-sm leading-relaxed text-foreground/80 space-y-4 mb-16">
        <p className="flex gap-3">
          <Target className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologySource', { date: millesimeLisible })}</span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyRapprochement')}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyComptage')}</span>
        </p>
        <p className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimite')}</span>
        </p>
      </div>

      {/* ④ EXPLORER */}
      <ExploreSection color={COLOR} currentHref="/Facts/cumul-des-mandats" locale={locale} />
    </div>
  );
}
