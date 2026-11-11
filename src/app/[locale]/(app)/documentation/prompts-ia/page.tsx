// Page `/documentation/prompts-ia` : les sept usages de l'IA sur le site. Pour chacun,
// ce qu'elle produit, les règles qu'on lui donne, le déroulé, les réglages et les
// instructions exactes, tous lus dans `lib/prompts` et `lib/ai-schemas`, sauf ceux de
// « Ce qui me concerne » et des titres anglais, lus dans `lib/prompts/ce-qui-me-concerne.json`
// et `lib/prompts/titres-en.json`. Le choix du
// modèle et le banc d'essai vivent sur la page sœur `/documentation/choix-modele-ia`.
// Aucune donnée ici, mais le badge du pied de page date le dernier run de nuit : sans
// minuterie, il garderait la date du déploiement.
export const revalidate = 86400;

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import type { UsageIA } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import { AccordionUsages } from './AccordionUsages';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Bot, Check, CheckCircle2, ChevronRight, RefreshCw } from 'lucide-react';
import {
  getSystemPrompt,
  getUserPromptTemplate,
  getSystemPromptResumeLoiMap,
  getUserPromptTemplateResumeLoiMap,
  getUserPromptTemplateResumeLoiReduce,
  SYSTEM_PROMPT_DEBATS_MAP,
  USER_PROMPT_TEMPLATE_DEBATS_MAP,
  getSystemPromptDebatsReduce,
  getUserPromptTemplateDebatsReduce,
  PARAMS_RESUME_LOI,
  PARAMS_RESUME_LOI_MAP,
  MODEL_RESUME_LOI,
  MAX_CHARS_PER_CHUNK_RESUME_LOI,
  getPromptVersion,
  SYSTEM_PROMPT_SEARCH_SUMMARY,
  USER_PROMPT_TEMPLATE_SEARCH_SUMMARY,
  PARAMS_SEARCH_SUMMARY,
  SCHEMA_SEARCH_SUMMARY,
  MODEL_SEARCH_SUMMARY,
  MAX_INPUT_CHARS_SEARCH_SUMMARY,
  NB_THEMES_SEARCH_SUMMARY,
  PARAMS_DEBATS_MAP,
  PARAMS_DEBATS_REDUCE,
  MODEL_RESUME_DEBATS,
  MAX_CHARS_PER_CHUNK_DEBATS,
  getPromptVersionDebats,
  PROMPT_RESUME_SEMAINE,
  NEWSLETTER_MODEL_PARAMS,
  MODEL_NEWSLETTER,
  MODEL_CC_DECISION,
  MAX_INPUT_CHARS_CC_DECISION,
  PARAMS_CC_DECISION,
  SYSTEM_PROMPT_CC,
  SCHEMA_CC_DECISION,
  PROMPT_VERSION_CC,
} from '@/lib/prompts';
import { SCHEMA_RESUME_LOI, SCHEMA_RESUME_DEBATS, SCHEMA_NEWSLETTER } from '@/lib/ai-schemas';
import promptConcerne from '@/lib/prompts/ce-qui-me-concerne.json';
import promptTitres from '@/lib/prompts/titres-en.json';
import { buildAlternates } from '@/lib/og-metadata';

// Consigne de « Ce qui me concerne » telle que la reçoit le modèle : le catalogue des
// profils y est inséré groupe par groupe, sous l'intitulé de chaque groupe, comme le
// fait `SYSTEM` dans `pipeline/classer_articles.py`.
const SYSTEME_CONCERNE = promptConcerne.system.replace('{catalogue}', promptConcerne.themes.map((th) =>
  `${th.intitule} :\n` + promptConcerne.profils.filter((p) => p.theme === th.id).map((p) => `- ${p.id} : ${p.definition}`).join('\n'),
).join('\n\n'));

const SOURCE_PROMPTS = 'https://github.com/loiclair/LoiClair/blob/production/src/lib/prompts.ts';

// Les schémas sont affichés tels qu'ils partent au modèle, simplement indentés.
const enJson = (schema: unknown) => JSON.stringify(schema, null, 2);

// Ordre de grandeur d'une page imprimée, pour dire un seuil en caractères de façon
// parlante (500 000 caractères, environ 200 pages). Une approximation, pas une mesure.
const CARACTERES_PAR_PAGE = 2500;

type TypeEtape = 'site' | 'ia' | 'fin';
type Reglage = { nom: string; valeur: string; expl: string; code?: boolean };
type Usage = {
  // Sert aussi d'ancre de la section (`#loi`), visée par les badges IA du site.
  cle: UsageIA;
  titre: string;
  produit: string;
  regles: number;
  etapes: TypeEtape[];
  etapesParams?: Record<string, string>;
  texteLong?: boolean;
  note?: string;
  reglages: Reglage[];
  // Un réglage à deux valeurs (lecture des morceaux, puis texte final) : la note le dit.
  deuxValeurs?: boolean;
  onglets: { cle: string; texte: string }[];
  // Fichier où vivent ces instructions, pour le lien GitHub ; `lib/prompts.ts` par défaut.
  source?: string;
};

/**
 * Déroulé d'un usage : une rangée de 3 ou 4 étapes, empilées sur mobile. Les étapes
 * faites par l'IA sont teintées et marquées, la dernière porte une coche.
 */
function Etapes({ usage, libelleIA, texte }: { usage: Usage; libelleIA: string; texte: (i: number, champ: 'titre' | 'texte') => string }) {
  return (
    <ol className={`grid grid-cols-1 gap-2 ${usage.etapes.length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
      {usage.etapes.map((type, i) => (
        <li key={i} className={`rounded-lg border p-3 flex flex-col gap-1 ${type === 'ia' ? 'border-primary/30 bg-primary/5' : ''}`}>
          <span className="flex items-center gap-2">
            <span
              className="inline-flex items-center justify-center rounded-full border text-muted-foreground tabular-nums"
              style={{ width: '20px', height: '20px', fontSize: '11px' }}
            >
              {type === 'fin' ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {type === 'ia' && <span className="text-primary font-semibold" style={{ fontSize: '11px' }}>{libelleIA}</span>}
          </span>
          <span className="text-sm font-medium text-foreground">{texte(i, 'titre')}</span>
          <span className="text-xs text-muted-foreground leading-relaxed">{texte(i, 'texte')}</span>
        </li>
      ))}
    </ol>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'promptsIA' });
  return {
    title: t('pageTitle') + ' — LoiClair',
    description: t('pageMetaDesc'),
    alternates: buildAlternates(locale, '/documentation/prompts-ia'),
  };
}

export default async function PromptsIAPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'promptsIA' });
  // Les niveaux de réflexion sont déjà traduits pour le tableau du banc d'essai.
  const tModele = await getTranslations({ locale, namespace: 'choixModeleIA' });
  // Les valeurs viennent des constantes, jamais d'un chiffre recopié : la page a
  // annoncé 100 000 et 120 000 caractères pendant des mois alors que le code en
  // appliquait 500 000.
  const nombre = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR');
  const decimal = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pages = (caracteres: number) => nombre.format(Math.round(caracteres / CARACTERES_PAR_PAGE));
  // Une seule valeur si lecture et texte final partagent le réglage, sinon les deux.
  const paire = (a: string, b: string) => (a === b ? a : `${a} · ${b}`);
  const niveau = (effort: string) => tModele(`evalNiveaux.${effort}` as 'evalNiveaux.low');

  const modele = (id: string): Reglage => ({ nom: t('reglages.modele'), valeur: id, expl: t('reglages.modeleExpl'), code: true });
  const temperature = (valeur: string): Reglage => ({ nom: t('reglages.temperature'), valeur, expl: t('reglages.temperatureExpl') });
  const longueur = (valeur: string): Reglage => ({ nom: t('reglages.longueur'), valeur: t('reglages.longueurValeur', { n: valeur }), expl: t('reglages.longueurExpl') });
  const reflexion = (valeur: string, expl = t('reglages.reflexionExpl')): Reglage => ({ nom: t('reglages.reflexion'), valeur, expl });
  const caracteres = (nom: string, n: number, expl: string): Reglage => ({ nom, valeur: t('reglages.morceauxValeur', { n: nombre.format(n) }), expl });
  const version = (valeur: string, expl: string): Reglage => ({ nom: t('reglages.version'), valeur, expl, code: true });

  const usages: Usage[] = [
    {
      cle: 'loi', titre: t('resumeLoi.title'), produit: t('resumeLoi.usedOn'), regles: 4,
      etapes: ['site', 'ia', 'ia', 'fin'], texteLong: true, deuxValeurs: true,
      reglages: [
        modele(MODEL_RESUME_LOI),
        temperature(paire(decimal.format(PARAMS_RESUME_LOI_MAP.temperature), decimal.format(PARAMS_RESUME_LOI.temperature))),
        longueur(paire(nombre.format(PARAMS_RESUME_LOI_MAP.maxOutputTokens), nombre.format(PARAMS_RESUME_LOI.maxOutputTokens))),
        reflexion(paire(niveau(PARAMS_RESUME_LOI_MAP.reasoningEffort), niveau(PARAMS_RESUME_LOI.reasoningEffort))),
        caracteres(t('reglages.morceaux'), MAX_CHARS_PER_CHUNK_RESUME_LOI, t('reglages.morceauxExplLoi', { pages: pages(MAX_CHARS_PER_CHUNK_RESUME_LOI) })),
        version(getPromptVersion(locale), t('reglages.versionExplVisite')),
      ],
      onglets: [
        { cle: 'instructions', texte: getSystemPrompt(locale) },
        { cle: 'message', texte: getUserPromptTemplate(locale) },
        { cle: 'morceauLecture', texte: getSystemPromptResumeLoiMap(locale) },
        { cle: 'morceauMessage', texte: getUserPromptTemplateResumeLoiMap(locale) },
        { cle: 'morceauReunion', texte: getUserPromptTemplateResumeLoiReduce(locale) },
        { cle: 'format', texte: enJson(SCHEMA_RESUME_LOI) },
      ],
    },
    {
      cle: 'debats', titre: t('debatsReduce.title'), produit: t('debatsReduce.usedOn'), regles: 3,
      etapes: ['site', 'ia', 'ia', 'fin'], note: t('debatsExtractionFr'), deuxValeurs: true,
      reglages: [
        modele(MODEL_RESUME_DEBATS),
        temperature(paire(decimal.format(PARAMS_DEBATS_MAP.temperature), decimal.format(PARAMS_DEBATS_REDUCE.temperature))),
        longueur(paire(nombre.format(PARAMS_DEBATS_MAP.maxOutputTokens), nombre.format(PARAMS_DEBATS_REDUCE.maxOutputTokens))),
        reflexion(paire(niveau(PARAMS_DEBATS_MAP.reasoningEffort), niveau(PARAMS_DEBATS_REDUCE.reasoningEffort))),
        caracteres(t('reglages.morceaux'), MAX_CHARS_PER_CHUNK_DEBATS, t('reglages.morceauxExplDebats')),
        version(getPromptVersionDebats(locale), t('reglages.versionExplVisite')),
      ],
      // Pas de variante anglaise de l'extraction : elle se fait en français pour les deux langues, ce que dit `debatsExtractionFr`.
      onglets: [
        { cle: 'seanceLecture', texte: SYSTEM_PROMPT_DEBATS_MAP },
        { cle: 'seanceMessage', texte: USER_PROMPT_TEMPLATE_DEBATS_MAP },
        { cle: 'synthese', texte: getSystemPromptDebatsReduce(locale) },
        { cle: 'syntheseMessage', texte: getUserPromptTemplateDebatsReduce(locale) },
        { cle: 'format', texte: enJson(SCHEMA_RESUME_DEBATS) },
      ],
    },
    {
      cle: 'cc', titre: t('ccDecisionTitle'), produit: t('ccDecisionUsedOn'), regles: 2,
      etapes: ['site', 'ia', 'fin'],
      reglages: [
        modele(MODEL_CC_DECISION),
        temperature(decimal.format(PARAMS_CC_DECISION.temperature)),
        longueur(nombre.format(PARAMS_CC_DECISION.maxOutputTokens)),
        reflexion(niveau(PARAMS_CC_DECISION.reasoningEffort)),
        caracteres(t('reglages.texteLu'), MAX_INPUT_CHARS_CC_DECISION, t('reglages.texteLuExplCc')),
        version(PROMPT_VERSION_CC, t('reglages.versionExplNuit')),
      ],
      onglets: [
        { cle: 'instructions', texte: SYSTEM_PROMPT_CC },
        { cle: 'format', texte: enJson(SCHEMA_CC_DECISION) },
      ],
    },
    {
      cle: 'search', titre: t('searchTitle'), produit: t('usedInSearch', { nbThemes: NB_THEMES_SEARCH_SUMMARY }), regles: 3,
      etapes: ['site', 'ia', 'fin'],
      etapesParams: { chars: nombre.format(MAX_INPUT_CHARS_SEARCH_SUMMARY), pages: pages(MAX_INPUT_CHARS_SEARCH_SUMMARY) },
      reglages: [
        // Pas de ligne « température » : Claude Haiku 5.5 n'en reçoit pas (voir prompts.ts).
        modele(MODEL_SEARCH_SUMMARY),
        longueur(nombre.format(PARAMS_SEARCH_SUMMARY.maxOutputTokens)),
        reflexion(niveau(PARAMS_SEARCH_SUMMARY.reasoningEffort), t('reglages.reflexionExplFiche')),
        caracteres(t('reglages.texteLu'), MAX_INPUT_CHARS_SEARCH_SUMMARY, t('reglages.texteLuExplSearch', { pages: pages(MAX_INPUT_CHARS_SEARCH_SUMMARY) })),
      ],
      onglets: [
        { cle: 'instructions', texte: SYSTEM_PROMPT_SEARCH_SUMMARY },
        { cle: 'message', texte: USER_PROMPT_TEMPLATE_SEARCH_SUMMARY },
        { cle: 'format', texte: enJson(SCHEMA_SEARCH_SUMMARY) },
      ],
    },
    {
      cle: 'concerne', titre: t('concerneTitle'),
      produit: t('concerneUsedOn', { nbProfils: promptConcerne.profils.length, nbThemes: promptConcerne.themes.length }), regles: 4,
      etapes: ['site', 'ia', 'fin'],
      // Pas de ligne « température » : Claude Haiku 5.5 n'en reçoit pas. Pas de
      // « format » ni de « version » : schéma et empreinte ne sont construits que par
      // `classer_articles.py`, et les recopier ici les ferait diverger.
      reglages: [
        modele(promptConcerne.modele),
        longueur(nombre.format(promptConcerne.maxOutputTokens)),
        reflexion(niveau(promptConcerne.reasoningEffort), t('reglages.reflexionExplConcerne')),
      ],
      onglets: [
        { cle: 'instructions', texte: SYSTEME_CONCERNE },
        { cle: 'message', texte: promptConcerne.userTemplate },
      ],
      source: 'https://github.com/loiclair/LoiClair/blob/production/src/lib/prompts/ce-qui-me-concerne.json',
    },
    {
      cle: 'titres', titre: t('titresTitle'), produit: t('titresUsedOn'), regles: 4,
      etapes: ['site', 'ia', 'fin'],
      // Comme « Ce qui me concerne » : ni température (Claude Haiku 5.5 n'en reçoit
      // pas), ni format, ni version, construits par `traduire_titres.py` seul.
      reglages: [
        modele(promptTitres.modele),
        longueur(nombre.format(promptTitres.maxOutputTokens)),
        reflexion(niveau(promptTitres.reasoningEffort), t('reglages.reflexionExplTitres')),
      ],
      onglets: [
        { cle: 'instructions', texte: promptTitres.system },
        { cle: 'message', texte: promptTitres.userTemplate },
      ],
      source: 'https://github.com/loiclair/LoiClair/blob/production/src/lib/prompts/titres-en.json',
    },
    {
      cle: 'nl', titre: t('newsletterTitle'), produit: t('newsletterUsedOn'), regles: 4,
      etapes: ['site', 'ia', 'fin'],
      reglages: [
        modele(MODEL_NEWSLETTER),
        temperature(decimal.format(NEWSLETTER_MODEL_PARAMS.temperature)),
        longueur(nombre.format(NEWSLETTER_MODEL_PARAMS.maxOutputTokens)),
        reflexion(niveau(NEWSLETTER_MODEL_PARAMS.reasoningEffort)),
      ],
      onglets: [
        { cle: 'instructions', texte: PROMPT_RESUME_SEMAINE },
        { cle: 'format', texte: enJson(SCHEMA_NEWSLETTER) },
      ],
    },
  ];

  const titreBloc = 'text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2';
  const lienGithub = (href: string, chunks: React.ReactNode) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">{chunks}</a>
  );

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="mb-10">
        {/* Titre et `introBody` vivent dans l'en-tête commun (`usePageHero`) ;
            la note reste ici, l'en-tête ne porte pas de lien. */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t.rich('introNote', { github: (chunks) => lienGithub('https://github.com/loiclair/LoiClair', chunks) })}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 pb-4 flex flex-col gap-1">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <p className="font-semibold text-sm mt-1">{t('cardUsagesTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('cardUsagesDesc')}</p>
            </CardContent>
          </Card>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 pb-4 flex flex-col gap-1">
              <Bot className="h-5 w-5 text-primary" />
              <p className="font-semibold text-sm mt-1">{t('cardModeleTitle')}</p>
              <p className="text-xs text-muted-foreground">
                {t.rich('cardModeleDesc', {
                  lien: (chunks) => <Link href="/documentation/choix-modele-ia" className="underline hover:text-foreground">{chunks}</Link>,
                })}
              </p>
            </CardContent>
          </Card>
          <Card className="border-[#F39C12]/30 bg-[#F39C12]/5">
            <CardContent className="pt-4 pb-4 flex flex-col gap-1">
              <RefreshCw className="h-5 w-5 text-[#F39C12] dark:text-[#F1C40F]" />
              <p className="font-semibold text-sm mt-1">{t('cardAJourTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('cardAJourDesc')}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="mb-12">
        <h2 className="text-xl font-semibold tracking-tight mb-2">{t('sectionUsages')}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-3">{t('sectionUsagesIntro')}</p>
        <AccordionUsages cles={usages.map((u) => u.cle)}>
          {usages.map((u) => (
            <AccordionItem key={u.cle} value={u.cle} id={u.cle} style={{ scrollMarginTop: 'var(--hauteur-entete)' }}>
              <AccordionTrigger className="text-base font-semibold hover:no-underline">{u.titre}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground space-y-6 pb-6">
                <div>
                  <p className={titreBloc}>{t('blocProduit')}</p>
                  <p className="leading-relaxed">{u.produit}</p>
                </div>

                <div>
                  <p className={titreBloc}>{t('blocRegles')}</p>
                  <ul className="space-y-1.5">
                    {Array.from({ length: u.regles }, (_, i) => (
                      <li key={i} className="flex gap-2 leading-relaxed">
                        <Check className="h-4 w-4 shrink-0 text-[#27AE60] dark:text-[#2ECC71]" style={{ marginTop: '2px' }} />
                        <span>
                          <span className="font-medium text-foreground">{t(`regles.${u.cle}.e${i + 1}.titre`)}</span>{' '}
                          {t(`regles.${u.cle}.e${i + 1}.texte`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className={titreBloc}>{t('blocEtapes')}</p>
                  <Etapes
                    usage={u}
                    libelleIA={t('etapeIA')}
                    texte={(i, champ) => t(`etapes.${u.cle}.e${i + 1}.${champ}`, u.etapesParams)}
                  />
                  {u.texteLong && (
                    <div className="mt-3 rounded-lg border bg-muted/40 p-4">
                      <p className="text-sm font-semibold text-foreground">{t('texteLong.titre', { pages: pages(MAX_CHARS_PER_CHUNK_RESUME_LOI) })}</p>
                      <ol className="mt-2 space-y-1 list-[upper-alpha] pl-5 leading-relaxed">
                        {(['decouper', 'lire', 'reunir'] as const).map((k) => (
                          <li key={k}>{t.rich(`texteLong.${k}`, { b: (chunks) => <span className="font-medium text-foreground">{chunks}</span> })}</li>
                        ))}
                      </ol>
                      <p className="mt-2 text-xs">{t.rich('texteLong.mapReduce', { i: (chunks) => <em>{chunks}</em> })}</p>
                    </div>
                  )}
                  {u.note && <p className="mt-3 text-xs leading-relaxed">{u.note}</p>}
                </div>

                <div>
                  <p className={titreBloc}>{t('blocReglages')}</p>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="w-full border-collapse" style={{ fontSize: '13px' }}>
                      <tbody>
                        {u.reglages.map((r) => (
                          <tr key={r.nom} className="border-b align-top" style={{ borderColor: 'var(--border)' }}>
                            <td className="py-2 pr-4 text-foreground" style={{ whiteSpace: 'nowrap' }}>{r.nom}</td>
                            <td className={`py-2 pr-4 text-foreground tabular-nums${r.code ? ' font-mono' : ''}`} style={{ whiteSpace: 'nowrap' }}>{r.valeur}</td>
                            <td className="py-2 leading-relaxed" style={{ minWidth: '220px' }}>{r.expl}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {u.deuxValeurs && <p className="mt-2 text-xs">{t('reglages.deuxValeurs')}</p>}
                </div>

                <Tabs defaultValue={u.onglets[0].cle}>
                  <div style={{ overflowX: 'auto' }}>
                    <TabsList>
                      {u.onglets.map((o) => (
                        <TabsTrigger key={o.cle} value={o.cle}>{t(`onglets.${o.cle}`)}</TabsTrigger>
                      ))}
                    </TabsList>
                  </div>
                  {u.onglets.map((o) => (
                    <TabsContent key={o.cle} value={o.cle}>
                      <pre className="rounded-lg border bg-muted/40 p-4 text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
                        {o.texte.trim()}
                      </pre>
                    </TabsContent>
                  ))}
                  <p className="text-xs">
                    {t.rich('instructionsMeta', { github: (chunks) => lienGithub(u.source ?? SOURCE_PROMPTS, chunks) })}
                  </p>
                </Tabs>
              </AccordionContent>
            </AccordionItem>
          ))}
        </AccordionUsages>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold tracking-tight mb-2">{t('sectionAJour')}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t('aJourIntro')}</p>
        <div className="flex flex-wrap items-center gap-2 mt-4 text-xs">
          {(['modifie', 'version', 'remplace', 'reecrit'] as const).map((k, i) => (
            <span key={k} className="flex items-center gap-2">
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <span className={`rounded-full border px-3 py-1 ${i === 0 ? 'border-primary/30 bg-primary/5 text-foreground font-medium' : 'text-muted-foreground'}`}>
                {t(`cycle.${k}`)}
              </span>
            </span>
          ))}
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed mt-4">{t('aJourNuit')}</p>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2">{t('aJourJamais')}</p>
      </section>

      <Link
        href="/documentation/choix-modele-ia"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 hover:bg-muted/40 transition-colors"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{t('lienModele.surtitre')}</span>
          <span className="text-sm font-semibold text-foreground">{t('lienModele.titre')}</span>
          <span className="text-xs text-muted-foreground">{t('lienModele.desc')}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  );
}
