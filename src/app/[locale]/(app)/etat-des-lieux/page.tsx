export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

// Tableau de bord L1 : l'état de la 17ᵉ législature, chaque mesure cliquable
// vers l'article /Facts qui la creuse. La page ne calcule rien : tout vient de
// getEtatDesLieux(), qui partage ses helpers avec les articles.
//
// Organisation par acteur, et non par thème. Un regroupement thématique mettait
// les décrets sous « ce que le Parlement produit » alors qu'un décret est pris
// par le Gouvernement, et la participation aux votes sous « combien de temps ça
// prend ». Les trois rangées répondent donc à trois questions sur trois acteurs
// distincts, et la colonne de gauche porte le parcours d'un texte, en nombre
// puis en temps.
//
// Mise en page en bento : à partir de xl, la grille occupe exactement ce qui
// reste de l'écran une fois la nav déduite, de sorte qu'après avoir passé le
// hero au scroll, toutes les mesures tiennent ensemble sans rien couper. C'est
// cette contrainte de hauteur qui dicte la forme des tuiles : une phrase, un
// héros, une bande basse, jamais un paragraphe. En dessous de xl, la hauteur
// est libre et la page redevient une page qui défile, en deux colonnes puis en
// une.

import { Link } from '@/i18n/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getEtatDesLieux } from '@/lib/dashboard-queries';
import { INSEE_AGE_MOYEN, FRANCE_PCT_FEMMES } from '@/lib/facts-shared';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { LegislativeFunnel } from '@/components/ui/LegislativeFunnel';
// Pas de `<Button asChild>` autour d'un Link dans une page serveur : voir button-variants.ts.
import { buttonVariants } from '@/components/ui/button-variants';
import { Waffle, Donut, DotPlot, Sparkline } from './MiniCharts';
import { TileInfo, type InfoItem } from './TileInfo';
import {
  ArrowRight,
  Filter,
  Clock,
  PenLine,
  GitMerge,
  CalendarDays,
  Zap,
  Stamp,
  MessageSquare,
  Vote,
  Hourglass,
  Scale,
} from 'lucide-react';

import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'etatDesLieux' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('metaDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/etat-des-lieux'),
    openGraph: buildOpenGraph(locale, '/etat-des-lieux', title, description),
  };
}

/**
 * Une teinte par section : elle dit de quelle famille d'articles la tuile
 * ouvre la porte, ce n'est pas de la décoration. Le jeu est passé au
 * validateur de la skill dataviz sur les deux surfaces du site (carte sombre
 * `#211f1d` et carte claire `#ffffff`) : bande de luminosité, plancher de
 * chroma, séparation daltonienne et contrast >= 3:1, tout au vert. Ne pas
 * substituer une teinte sans repasser le validateur : les couleurs d'article
 * du site, essayées d'abord, échouaient (violet et bleu confondus en
 * deutéranopie, vert et sarcelle même en vision normale).
 */
const TONE_PARCOURS = '#0d9488';
const TONE_PARLEMENT = '#d97706';
const TONE_GOUVERNEMENT = '#db2777';
const TONE_ELUS = '#6366f1';

/** Borne haute de l'axe des âges, en années. Commune aux chambres et au repère INSEE. */
const AGE_SCALE = 80;

type FigureSize = 'lead' | 'context';

/** Ce que `TileInfo` affiche, sans le rembourrage que chaque carte lui donne */
type TileInfoText = Omit<React.ComponentProps<typeof TileInfo>, 'padding'>;

/**
 * Un chiffre de tuile. `lead` porte la réponse, `context` la met en
 * perspective : c'est cette différence de taille qui donne le sens de lecture.
 * Deux valeurs réellement comparables (Assemblée et Sénat) sont toutes deux en
 * `lead`, sinon la taille prétendrait une hiérarchie qui n'existe pas.
 */
function Figure({
  label,
  value,
  unit,
  size = 'lead',
  tone,
  bar,
}: {
  label: string;
  value: string;
  unit?: string;
  size?: FigureSize;
  tone: string;
  /**
   * Part du chiffre dans sa référence, entre 0 et 1 : rend une jauge sous la
   * valeur. Le rail vaut les 100 % du taux, donc la part se lit sans axe ni
   * légende, et à l'endroit même du chiffre.
   */
  bar?: number;
}) {
  const isLead = size === 'lead';
  return (
    <div className="min-w-0 flex-1">
      <p
        className="uppercase tracking-wide text-muted-foreground"
        style={{ fontSize: '0.625rem', lineHeight: 1.3 }}
      >
        {label}
      </p>
      <div className="mt-0.5 flex items-baseline gap-1">
        {/* Tailles en inline plutôt qu'en classes : piège Tailwind v4 sur
            Safari, cf. ARCHITECTURE.md. `whitespace-nowrap` parce que les
            valeurs composées se coupaient en deux lignes dans les colonnes
            étroites de la version anglaise. */}
        <span
          className="font-bold tabular-nums leading-none whitespace-nowrap"
          style={{
            fontSize: isLead ? 'clamp(2rem, 2.6vw, 2.625rem)' : '1.125rem',
            color: isLead ? tone : 'var(--muted-foreground)',
          }}
        >
          {value}
        </span>
        {unit && (
          <span
            className="text-muted-foreground"
            style={{ fontSize: isLead ? '0.8125rem' : '0.6875rem' }}
          >
            {unit}
          </span>
        )}
      </div>
      {bar !== undefined && (
        // Rail et remplissage en styles inline : `bg-muted/60` passe par
        // `color-mix()`, absent des vieux Safari (cf. ARCHITECTURE.md).
        <div
          className="mt-1.5"
          style={{
            height: '6px',
            borderRadius: '9999px',
            backgroundColor: 'var(--muted)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.max(0, Math.min(1, bar)) * 100}%`,
              height: '100%',
              borderRadius: '9999px',
              backgroundColor: tone,
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Une rangée de chiffres, éventuellement flanquée d'un graphique.
 * Les chiffres se partagent la largeur à parts égales : c'est ce qui rend
 * comparables les jauges tracées sous eux.
 */
function FigureRow({
  items,
  tone,
  aside,
}: {
  items: Array<{ label: string; value: string; unit?: string; size?: FigureSize; bar?: number }>;
  tone: string;
  /** Graphique compact posé à droite des chiffres (la gaufre) */
  aside?: React.ReactNode;
}) {
  return (
    <div className="w-full min-w-0">
      <div className="flex items-end gap-3">
        {/* `gap-5` et non `gap-3` : à 12 px, l'unité d'un chiffre
            (« 344 mesures ») venait toucher l'étiquette du suivant, et la
            paire se lisait comme un seul bloc. À trois chiffres la largeur
            manque, et « 43.1 years » débordait de 2 px en anglais. */}
        <div className={`flex min-w-0 flex-1 items-end ${items.length > 2 ? 'gap-4' : 'gap-5'}`}>
          {items.map((f) => (
            <Figure key={f.label} {...f} tone={tone} />
          ))}
        </div>
        {aside}
      </div>
    </div>
  );
}

/**
 * Une tuile du bento, en trois bandes : la question et sa phrase en haut, le
 * héros au centre de la hauteur qui reste, et une bande basse pour le reste.
 *
 * Le héros est ce que la tuile répond : un grand chiffre, ou l'anneau quand
 * c'est lui qui la porte. Il est centré dans la hauteur libre parce que tout
 * était auparavant collé en bas, et qu'une tuile haute de 250 px n'était alors
 * qu'une phrase suivie d'un grand vide.
 *
 * Toute la carte mène à l'article, mais elle n'est plus elle-même un lien :
 * elle porte la ⓘ, et un bouton dans un `<a>` est du HTML invalide où le tap
 * partirait vers l'article. Un lien vide couvre donc la carte (`inset-0`),
 * placé après le contenu pour passer au-dessus des graphiques positionnés, et
 * seuls la ⓘ et le verso qu'elle ouvre (`TileInfo`) passent au-dessus de lui.
 *
 * L'effet de survol est porté par la Card elle-même et non par `group-hover`,
 * qui ne survit pas à la pipeline CSS sur Safari (cf. ARCHITECTURE.md). Le
 * lien remplissant exactement la Card, un `:hover` sur elle revient au même.
 */
function Tile({
  href,
  icon: Icon,
  tone,
  title,
  info,
  description,
  hero,
  heroCentered = false,
  foot,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tone: string;
  title: string;
  /** Les définitions que la ⓘ montre au verso de la carte */
  info: TileInfoText;
  /** Omise sur la tuile des délais, qui partage sa colonne avec l'entonnoir */
  description?: string;
  /** Ce que la tuile répond, en grand */
  hero: React.ReactNode;
  /**
   * Centre le héros horizontalement. Réservé à l'anneau, forme symétrique que
   * la marge gauche laisserait flanquée d'un vide ; un chiffre, lui, reste
   * dans l'axe du titre au-dessus.
   */
  heroCentered?: boolean;
  /** La bande basse : les chiffres de contexte, ou un graphique pleine largeur */
  foot?: React.ReactNode;
}) {
  return (
    <Card className="relative h-full min-h-0 gap-0 overflow-hidden py-3 transition-colors hover:border-foreground/30 has-[a:focus-visible]:border-foreground/40">
      <CardHeader className="px-4">
        {/* `paddingRight` : le titre s'arrête 4 px avant la zone de la ⓘ (24 px
            de large, dont 16 pris dans la marge de la carte). Alex l'a préféré
            à une zone plus étroite, en sachant qu'un à trois titres passent
            alors à deux lignes selon la largeur (mesuré de 1 280 à 1 800 px,
            FR et EN), dont « Combien d'amendements passent ? » dès 1 440 px. */}
        <CardTitle
          className="flex items-start gap-1.5"
          style={{ fontSize: '0.9375rem', lineHeight: 1.3, paddingRight: '0.75rem' }}
        >
          {/* Petite icône de trait plutôt qu'une pastille pleine : elle sert
              de point d'accroche au balayage sans peser dans la carte. */}
          <Icon className="mt-px shrink-0" style={{ width: '0.875rem', height: '0.875rem', color: tone }} />
          <span className="min-w-0">{title}</span>
        </CardTitle>
        {description && (
          // Deux lignes au maximum : sans plafond, une phrase qui passe à
          // trois lignes dans une colonne étroite pousse le héros hors de la
          // cellule.
          <CardDescription
            style={{
              fontSize: '0.75rem',
              lineHeight: 1.35,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 min-h-0 flex-col px-4 pt-2">
        <div className={`flex flex-1 min-h-0 items-center ${heroCentered ? 'justify-center' : ''}`}>
          {hero}
        </div>
        {foot && <div className="mt-3 shrink-0">{foot}</div>}
      </CardContent>
      <Link href={href} aria-label={title} className="absolute inset-0 rounded-xl focus:outline-none" />
      {/* Le rembourrage du verso est celui de la Card (`py-3`, `px-4`). */}
      <TileInfo {...info} padding="0.75rem 1rem" />
    </Card>
  );
}

function SectionTitle({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <h2
      className="self-end font-bold uppercase tracking-widest md:col-span-2 xl:col-span-3"
      style={{ color: tone, fontSize: '0.6875rem' }}
    >
      {children}
    </h2>
  );
}

export default async function EtatDesLieuxPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'etatDesLieux' });
  const d = await getEtatDesLieux();

  const n = (v: number) => v.toLocaleString(locale);

  // Le verso d'une tuile : chaque chiffre affiché et ce qu'il mesure. Les termes
  // reprennent l'étiquette que porte le chiffre dans la tuile, pour que le
  // lecteur fasse le lien sans chercher, sauf quand elle ne se lit pas seule :
  // les délais (l'étiquette porte un nombre de lois) et la procédure accélérée
  // (« Des lois promulguées… » est une fin de phrase) ont un terme à eux.
  const info = (title: string, items: InfoItem[]): TileInfoText => ({
    label: t('infoLabel', { title }),
    closeLabel: t('infoClose'),
    items,
  });
  const depotsParMois = d.ceMoisCi.serie.map((m) => m.depots);

  // Mise en forme seule, la date vient du helper. `AAAA-MM-JJ` se lit comme
  // minuit UTC : formatée en UTC, elle garde son jour quel que soit le fuseau
  // du serveur.
  const dernierePromulgation = d.ceMoisCi.dernierePromulgation
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
        new Date(d.ceMoisCi.dernierePromulgation),
      )
    : null;

  return (
    // `100vh` et non `100dvh` / `100svh` : les vieux Safari ignorent ces unités
    // (cf. ARCHITECTURE.md). La contrainte ne s'appliquant qu'à partir de xl,
    // la barre d'URL mobile qui motive `dvh` n'entre pas en jeu.
    //
    // Le plancher `min-h` est ce dont la colonne de gauche a besoin : en dessous,
    // mieux vaut que la page défile un peu que d'écraser l'entonnoir.
    //
    // Le plafond `max-h` est l'autre moitié de la même idée. Les rangées de
    // tuiles sont en `1fr` et les marches de l'entonnoir en `flex-1` : sans lui,
    // un écran de 1 600 px de haut distribue 700 px de rabiot dans les cellules,
    // et chaque tuile devient un grand vide surmonté d'une phrase. Au-delà du
    // plafond, la page laisse simplement du blanc sous le bouton.
    <div className="py-8 xl:flex xl:flex-col xl:h-[calc(100vh-var(--hauteur-entete))] xl:min-h-[1040px] xl:max-h-[1080px]">
      {/*
        Quatre colonnes à partir de xl. La première tient le parcours d'un texte
        sur toute la hauteur ; les neuf tuiles remplissent les trois autres en
        trois rangées, chacune précédée de son titre de section. Les rangées de
        tuiles sont en `1fr` et les titres en `auto`, donc toute la hauteur
        restante se répartit entre les tuiles.
      */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 xl:flex-1 xl:min-h-0 xl:grid-rows-[auto_1fr_auto_1fr_auto_1fr]">
        {/* LE PARCOURS D'UN TEXTE — combien passent, et en combien de temps */}
        <div className="md:col-span-2 xl:col-span-1 xl:row-span-6 flex min-h-0 flex-col gap-4">
          <LegislativeFunnel
            title={t('funnelTitle')}
            description={t('funnelDesc')}
            ofTotalLabel={(rate) => t('funnelOfTotal', { rate })}
            locale={locale}
            rateBaseIndex={1}
            className="min-h-0 flex-1"
            compact
            icon={<Filter className="shrink-0" style={{ width: '0.875rem', height: '0.875rem', color: TONE_PARCOURS }} />}
            // Rembourrage de la Card par défaut (`py-6`, `px-6`), que l'entonnoir
            // garde. Sa zone de 24 px tient dans la marge du haut : le titre
            // n'a rien à lui céder.
            info={<TileInfo {...info(t('funnelTitle'), [
              { term: t('funnelStep1'), text: t('infoFunnelDeposes') },
              { term: t('funnelStep2'), text: t('infoFunnelPromulgables') },
              { term: t('funnelStep3'), text: t('infoFunnelAdoptes') },
              { term: t('funnelStep4'), text: t('infoFunnelPromulgues') },
              { term: t('funnelStep5'), text: t('infoFunnelAppliquees') },
            ])} padding="1.5rem" />}
            barColor={TONE_PARCOURS}
            steps={[
              { label: t('funnelStep1'), count: d.funnel.deposes, description: '' },
              { label: t('funnelStep2'), count: d.funnel.promulgables, description: '' },
              { label: t('funnelStep3'), count: d.funnel.adoptes, description: '' },
              { label: t('funnelStep4'), count: d.funnel.promulgues, description: '' },
              { label: t('funnelStep5'), count: d.funnel.appliquees, description: '' },
            ]}
          />
          <div className="shrink-0">
            {/* Pas de phrase ici : la colonne partage sa hauteur avec
                l'entonnoir, et le titre suffit à enchaîner sur lui. */}
            <Tile
              href="/Facts/delais"
              icon={Clock}
              tone={TONE_PARCOURS}
              title={t('delaisTitle')}
              info={info(t('delaisTitle'), [
                { term: t('infoDelaisDepotTerm'), text: t('infoDelaisDepot') },
                { term: t('infoDelaisDecretsTerm'), text: t('infoDelaisDecrets') },
              ])}
              // Deux délais côte à côte, jamais leur somme : ce sont deux moyennes
              // sur deux populations (toutes les lois promulguées, puis les seules
              // lois dont tous les décrets sont pris), et leur total n'était le
              // parcours d'aucune loi. Chaque étiquette porte son nombre de lois,
              // le second étant bien plus petit que le premier.
              hero={
                <FigureRow
                  tone={TONE_PARCOURS}
                  items={[
                    {
                      label: t('delaisFigDepot', { count: d.delais.nbDepotPromulgation }),
                      value: n(d.delais.depotPromulgation),
                      unit: t('daysUnit'),
                    },
                    {
                      label: t('delaisFigDecrets', { count: d.delais.nbDecrets }),
                      value: n(d.delais.promulgationDecrets),
                      unit: t('daysUnit'),
                    },
                  ]}
                />
              }
            />
          </div>
        </div>

        {/* ① CE QUE LE PARLEMENT PRODUIT */}
        <SectionTitle tone={TONE_PARLEMENT}>{t('sectionParlement')}</SectionTitle>
        <Tile
          href="/Facts/succes-legislatif/volume"
          icon={PenLine}
          tone={TONE_PARLEMENT}
          title={t('origineTitle')}
          info={info(t('origineTitle'), [
            { term: t('origineFigParl'), text: t('infoOrigineParl') },
            { term: t('origineFigGouv'), text: t('infoOrigineGouv') },
          ])}
          description={t('origineDesc')}
          hero={
            <FigureRow
              tone={TONE_PARLEMENT}
              items={[{ label: t('origineFigParl'), value: n(d.origine.parlementaires), unit: t('origineUnit') }]}
              aside={
                <Waffle
                  filled={d.origine.parlementaires}
                  total={d.origine.total}
                  tone={TONE_PARLEMENT}
                  label={t('origineChartLabel', {
                    parl: n(d.origine.parlementaires),
                    total: n(d.origine.total),
                  })}
                />
              }
            />
          }
          foot={
            <FigureRow
              tone={TONE_PARLEMENT}
              items={[{ label: t('origineFigGouv'), value: n(d.origine.gouvernement), size: 'context' }]}
            />
          }
        />
        <Tile
          href="/Facts/amendements"
          icon={GitMerge}
          tone={TONE_PARLEMENT}
          title={t('amendementsTitle')}
          info={info(t('amendementsTitle'), [
            { term: t('amendementsFigAdoptes'), text: t('infoAmendementsAdoptes') },
            { term: t('amendementsFigDeposes'), text: t('infoAmendementsDeposes') },
          ])}
          description={t('amendementsDesc')}
          heroCentered
          hero={
            <Donut
              ratio={d.amendements.tauxAdoption / 100}
              value={`${n(d.amendements.tauxAdoption)}\u202f%`}
              caption={t('amendementsFigAdoptes')}
              tone={TONE_PARLEMENT}
              label={t('amendementsChartLabel', { pct: n(d.amendements.tauxAdoption) })}
            />
          }
          foot={
            <FigureRow
              tone={TONE_PARLEMENT}
              items={[{ label: t('amendementsFigDeposes'), value: n(d.amendements.deposes), size: 'context' }]}
            />
          }
        />
        <Tile
          href="/Month"
          icon={CalendarDays}
          tone={TONE_PARLEMENT}
          title={t('moisTitle')}
          info={info(t('moisTitle'), [
            { term: t('moisFigDepots'), text: t('infoMoisDepots') },
            { term: t('moisFigPromulgations'), text: t('infoMoisPromulgations') },
          ])}
          description={t('moisDesc')}
          hero={
            <FigureRow
              tone={TONE_PARLEMENT}
              items={[
                { label: t('moisFigDepots'), value: n(d.ceMoisCi.depots) },
                {
                  label: t('moisFigPromulgations'),
                  value: n(d.ceMoisCi.promulgations),
                  // Renseignée par le helper seulement quand le mois compte zéro loi.
                  unit: dernierePromulgation ? t('moisFigDernierePromulgation', { date: dernierePromulgation }) : undefined,
                  size: 'context',
                },
              ]}
            />
          }
          foot={
            <Sparkline
              values={depotsParMois}
              tone={TONE_PARLEMENT}
              label={t('moisSparklineLabel', { mois: n(depotsParMois.length) })}
            />
          }
        />

        {/* ② CE QUE LE GOUVERNEMENT EN FAIT */}
        <SectionTitle tone={TONE_GOUVERNEMENT}>{t('sectionGouvernement')}</SectionTitle>
        <Tile
          href="/processus-legislatif"
          icon={Zap}
          tone={TONE_GOUVERNEMENT}
          title={t('accelereeTitle')}
          info={info(t('accelereeTitle'), [
            { term: t('infoAccelereePctTerm'), text: t('infoAccelereePct') },
            { term: t('accelereeFigLois'), text: t('infoAccelereeLois') },
          ])}
          description={t('accelereeDesc')}
          hero={
            <FigureRow
              tone={TONE_GOUVERNEMENT}
              items={[{ label: t('accelereeFigPct'), value: n(d.procedureAcceleree.pct), unit: '%' }]}
              aside={
                <Waffle
                  filled={d.procedureAcceleree.lois}
                  total={d.procedureAcceleree.total}
                  tone={TONE_GOUVERNEMENT}
                  label={t('accelereeChartLabel', {
                    lois: n(d.procedureAcceleree.lois),
                    total: n(d.procedureAcceleree.total),
                  })}
                />
              }
            />
          }
          foot={
            <FigureRow
              tone={TONE_GOUVERNEMENT}
              items={[{ label: t('accelereeFigLois'), value: n(d.procedureAcceleree.lois), size: 'context' }]}
            />
          }
        />
        <Tile
          href="/Facts/taux-application"
          icon={Stamp}
          tone={TONE_GOUVERNEMENT}
          title={t('decretsTitle')}
          info={info(t('decretsTitle'), [
            { term: t('decretsFigApplied'), text: t('infoDecretsApplied') },
            { term: t('decretsFigTaken'), text: t('infoDecretsTaken') },
          ])}
          description={t('decretsDesc')}
          heroCentered
          hero={
            // Un taux de lois, pas de mesures : le titre demande si les lois
            // s'appliquent, l'anneau doit répondre dans la même unité.
            <Donut
              ratio={d.decrets.tauxLois / 100}
              value={`${n(d.decrets.tauxLois)}\u202f%`}
              caption={t('decretsFigApplied')}
              tone={TONE_GOUVERNEMENT}
              label={t('decretsChartLabel', {
                appliquees: n(d.decrets.loisAppliquees),
                total: n(d.decrets.loisSuivies),
              })}
            />
          }
          foot={
            // Le détail en mesures reste en bas : c'est ce que le Gouvernement
            // a réellement à prendre, et l'écart entre les deux chiffres dit
            // pourquoi tant de lois ne sont pas encore pleinement appliquées.
            <FigureRow
              tone={TONE_GOUVERNEMENT}
              items={[
                {
                  label: t('decretsFigTaken'),
                  value: n(d.decrets.prises),
                  unit: t('decretsFigOutOf', { attendues: n(d.decrets.attendues) }),
                  size: 'context',
                },
              ]}
            />
          }
        />
        <Tile
          href="/les-elus"
          icon={MessageSquare}
          tone={TONE_GOUVERNEMENT}
          title={t('questionsTitle')}
          info={info(t('questionsTitle'), [
            { term: t('questionsFigAnswered'), text: t('infoQuestionsAnswered') },
            { term: t('questionsFigAsked'), text: t('infoQuestionsAsked') },
          ])}
          description={t('questionsDesc', {
            an: n(d.questionsEcrites.pctAN),
            senat: n(d.questionsEcrites.pctSenat),
          })}
          heroCentered
          hero={
            <Donut
              ratio={d.questionsEcrites.pct / 100}
              value={`${n(d.questionsEcrites.pct)}\u202f%`}
              caption={t('questionsFigAnswered')}
              tone={TONE_GOUVERNEMENT}
              label={t('questionsChartLabel', { pct: n(d.questionsEcrites.pct) })}
            />
          }
          foot={
            <FigureRow
              tone={TONE_GOUVERNEMENT}
              items={[{ label: t('questionsFigAsked'), value: n(d.questionsEcrites.total), size: 'context' }]}
            />
          }
        />

        {/* ③ QUI SONT NOS ÉLUS */}
        <SectionTitle tone={TONE_ELUS}>{t('sectionElus')}</SectionTitle>
        <Tile
          href="/Facts/participation"
          icon={Vote}
          tone={TONE_ELUS}
          title={t('participationTitle')}
          info={info(t('participationTitle'), [
            { term: t('chamberAN'), text: t('infoParticipationAN') },
            { term: t('chamberSN'), text: t('infoParticipationSN') },
          ])}
          description={t('participationDesc')}
          hero={
            <FigureRow
              tone={TONE_ELUS}
              items={[
                { label: t('chamberAN'), value: n(d.participation.an), unit: '%', bar: d.participation.an / 100 },
                { label: t('chamberSN'), value: n(d.participation.senat), unit: '%', bar: d.participation.senat / 100 },
              ]}
            />
          }
          // Seule tuile du bento à porter une phrase en bande basse : deux
          // barres côte à côte se lisent comme un classement, et celles-ci ne
          // mesurent pas la même chose (cf. /Facts/participation).
          foot={
            <p className="text-muted-foreground" style={{ fontSize: '0.6875rem', lineHeight: 1.35 }}>
              {t('participationFoot')}
            </p>
          }
        />
        <Tile
          href="/Facts/representativite/age"
          icon={Hourglass}
          tone={TONE_ELUS}
          title={t('ageTitle')}
          info={info(t('ageTitle'), [
            { term: t('chamberAN'), text: t('infoAgeAN') },
            { term: t('chamberSN'), text: t('infoAgeSN') },
            { term: t('ageFigFrance'), text: t('infoAgeFrance') },
          ])}
          description={t('ageDesc')}
          hero={
            <FigureRow
              tone={TONE_ELUS}
              items={[
                { label: t('chamberAN'), value: n(d.representativite.ageMoyenAN), unit: t('yearsUnit') },
                { label: t('chamberSN'), value: n(d.representativite.ageMoyenSN), unit: t('yearsUnit') },
                {
                  label: t('ageFigFrance'),
                  value: n(INSEE_AGE_MOYEN),
                  unit: t('yearsUnit'),
                  size: 'context',
                },
              ]}
            />
          }
          foot={
            // Échelle commune 0-80 ans pour les deux chambres et le repère
            // INSEE : trois valeurs lues sur la même règle, sinon l'écart avec
            // la population ne veut rien dire.
            <DotPlot
              values={[d.representativite.ageMoyenAN, d.representativite.ageMoyenSN]}
              scale={AGE_SCALE}
              reference={INSEE_AGE_MOYEN}
              tone={TONE_ELUS}
              label={t('ageChartLabel', {
                an: n(d.representativite.ageMoyenAN),
                sn: n(d.representativite.ageMoyenSN),
                insee: n(INSEE_AGE_MOYEN),
              })}
            />
          }
        />
        <Tile
          href="/Facts/representativite/genre"
          icon={Scale}
          tone={TONE_ELUS}
          title={t('femmesTitle')}
          info={info(t('femmesTitle'), [
            { term: t('femmesFigParlement'), text: t('infoFemmesParlement') },
            { term: t('femmesFigFrance'), text: t('infoFemmesFrance') },
          ])}
          description={t('femmesDesc', { insee: n(FRANCE_PCT_FEMMES) })}
          hero={
            <FigureRow
              tone={TONE_ELUS}
              items={[
                { label: t('femmesFigParlement'), value: n(d.representativite.pctFemmes), unit: '%' },
                { label: t('femmesFigFrance'), value: n(FRANCE_PCT_FEMMES), unit: '%', size: 'context' },
              ]}
            />
          }
          foot={
            <DotPlot
              values={[d.representativite.pctFemmes]}
              scale={100}
              reference={FRANCE_PCT_FEMMES}
              tone={TONE_ELUS}
              label={t('femmesChartLabel', {
                pct: n(d.representativite.pctFemmes),
                insee: n(FRANCE_PCT_FEMMES),
              })}
            />
          }
        />
      </div>

      <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground" style={{ fontSize: '0.8125rem' }}>
          {t('footerNote')}
        </p>
        <Link href="/Facts" className={buttonVariants({ size: 'lg' })}>
          {t('ctaFacts')}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
