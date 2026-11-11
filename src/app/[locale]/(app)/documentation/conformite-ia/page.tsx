// Page `/documentation/conformite-ia` : conformité des résumés IA aux textes européens
// et français sur l'intelligence artificielle.
// Aucune donnée ici, mais le badge du pied de page date le dernier run de nuit : sans
// minuterie, il garderait la date du déploiement. La même régénération quotidienne
// fait passer une échéance du calendrier de « À venir » à « En vigueur » le jour venu.
export const revalidate = 86400;

import { Card, CardContent } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, ExternalLink, Bot } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { aujourdhuiAParisIso } from '@/lib/jour-paris';
import {
  PARAMS_RESUME_LOI,
  PARAMS_DEBATS_REDUCE,
  PARAMS_CC_DECISION,
  NEWSLETTER_MODEL_PARAMS,
  NB_THEMES_SEARCH_SUMMARY,
} from '@/lib/prompts';
import { buildAlternates } from '@/lib/og-metadata';
import { Link } from '@/i18n/navigation';

// Ordre d'affichage des mesures, une paire de clés `{cle}Title` / `{cle}Desc` par
// mesure dans `conformiteIA.conformite`.
const MESURES = ['etiquette', 'prompts', 'parametres', 'neutralite', 'temperature', 'source'] as const;

// Échéances de l'AI Act (règlement 2024/1689, article 113), dans la version
// modifiée par l'omnibus numérique sur l'IA (règlement 2026/1744, publié au JO le
// 24 juillet 2026, en vigueur le 27 juillet 2026). Le statut se calcule sur la date
// plutôt que de s'écrire dans les traductions : écrit à la main, il annonçait encore
// « À venir » une échéance passée.
const ECHEANCES = [
  { cle: 'entreeVigueur', date: '2024-08-01' },
  { cle: 'interdictions', date: '2025-02-02' },
  { cle: 'gpai', date: '2025-08-02' },
  { cle: 'transparence', date: '2026-08-02' },
  { cle: 'hautRisque', date: '2027-12-02' },
] as const;

// `href` : source externe, ouverte dans un nouvel onglet. `chemin` : page de LoiClair,
// rendue par le `Link` localisé (un lien en dur vers /fr/ renverrait un lecteur anglais
// sur la version française).
const SOURCES: ReadonlyArray<{ cle: string; href?: string; chemin?: string }> = [
  { cle: 'aiAct', href: 'https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=OJ:L_202401689' },
  { cle: 'omnibus', href: 'https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=OJ:L_202601744' },
  { cle: 'commission', href: 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai' },
  { cle: 'cnil', href: 'https://www.cnil.fr/fr/les-fiches-pratiques-ia' },
  { cle: 'mammouth', href: 'https://info.mammouth.ai/docs/terms-of-service/' },
  { cle: 'openai', href: 'https://openai.com/policies/services-agreement/' },
  { cle: 'anthropic', href: 'https://www.anthropic.com/legal/commercial-terms' },
  { cle: 'parametres', chemin: '/documentation/prompts-ia' },
];

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'conformiteIA' });
  return {
    title: t('meta.title'),
    description: t('meta.description'),
    alternates: buildAlternates(locale, '/documentation/conformite-ia'),
  };
}

export default async function ConformiteIAPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'conformiteIA' });

  const risqueRows = t.raw('risque.rows') as Array<{ level: string; badge: string; desc: string; applicable: boolean }>;
  const obligationItems = t.raw('obligations.items') as Array<{ title: string; desc: string }>;

  // Températures lues dans les paramètres réellement envoyés au modèle : la page
  // ne peut plus promettre autre chose que ce qui tourne, ni diverger de
  // /documentation/prompts-ia qui lit les mêmes constantes. La fiche courte des
  // dossiers n'en a pas : Claude Haiku 5.5 refuse toute valeur autre que la sienne.
  const temperatures = {
    resumeLoi: PARAMS_RESUME_LOI.temperature,
    cc: PARAMS_CC_DECISION.temperature,
    debats: PARAMS_DEBATS_REDUCE.temperature,
    newsletter: NEWSLETTER_MODEL_PARAMS.temperature,
  };
  // Valeurs à insérer dans le texte d'une mesure, lues dans le code pour la même
  // raison que les températures.
  const valeursMesure: Partial<Record<(typeof MESURES)[number], Record<string, number>>> = {
    temperature: temperatures,
    etiquette: { nbThemes: NB_THEMES_SEARCH_SUMMARY },
  };
  const conformiteItems = MESURES.map((cle) => ({
    title: t(`conformite.${cle}Title`),
    desc: t(`conformite.${cle}Desc`, valeursMesure[cle]),
  }));

  const aujourdhui = aujourdhuiAParisIso();
  const formatDate = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  // `Intl` écrit « 1 août » : l'usage français veut « 1er » pour le premier du mois.
  const dateAffichee = (iso: string) => {
    const texte = formatDate.format(new Date(iso));
    return locale === 'en' ? texte : texte.replace(/^1 /, '1er ');
  };
  const timelineItems = ECHEANCES.map(({ cle, date }) => ({
    cle,
    date: dateAffichee(date),
    label: t(`timeline.${cle}Label`),
    detail: t(`timeline.${cle}Detail`),
    done: date <= aujourdhui,
  }));

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <Card className="border-[#27AE60]/30 bg-[#27AE60]/5">
          <CardContent className="pt-4 pb-4 flex flex-col gap-1">
            <CheckCircle2 className="h-5 w-5 text-[#27AE60] dark:text-[#2ECC71]" />
            <p className="font-semibold text-sm mt-1">{t('card1.label')}</p>
            <p className="text-xs text-muted-foreground">{t('card1.desc')}</p>
          </CardContent>
        </Card>
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4 flex flex-col gap-1">
            <Bot className="h-5 w-5 text-primary" />
            <p className="font-semibold text-sm mt-1">{t('card2.label')}</p>
            <p className="text-xs text-muted-foreground">{t('card2.desc')}</p>
          </CardContent>
        </Card>
        <Card className="border-[#F39C12]/30 bg-[#F39C12]/5">
          <CardContent className="pt-4 pb-4 flex flex-col gap-1">
            <Clock className="h-5 w-5 text-[#F39C12] dark:text-[#F1C40F]" />
            <p className="font-semibold text-sm mt-1">{t('card3.label')}</p>
            <p className="text-xs text-muted-foreground">{t('card3.desc')}</p>
          </CardContent>
        </Card>
      </div>

      <Accordion type="multiple" defaultValue={['role', 'risque', 'obligations', 'conformite']} className="space-y-3">

        <AccordionItem value="aiact" className="border rounded-lg px-4">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            {t('aiact.title')}
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground space-y-3 pb-4">
            <p>{t('aiact.p1')}</p>
            <p>{t('aiact.p2')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="role" className="border rounded-lg px-4">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            {t('role.title')}
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground space-y-3 pb-4">
            <p>{t('role.intro')}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
              <div className="rounded-lg border p-3">
                <p className="font-semibold text-foreground mb-1">{t('role.provider.title')}</p>
                <p>{t('role.provider.desc')}</p>
              </div>
              <div className="rounded-lg border p-3 border-primary/40 bg-primary/5">
                <p className="font-semibold text-foreground mb-1">{t('role.deployer.title')}</p>
                <p>{t('role.deployer.desc')}</p>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="risque" className="border rounded-lg px-4">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            {t('risque.title')}
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground space-y-3 pb-4">
            <p>{t('risque.tableIntro')}</p>
            <div className="space-y-2 mt-2">
              {risqueRows.map(({ level, badge, desc, applicable }) => (
                <div key={level} className={`rounded-lg border p-3 flex gap-3 ${applicable ? 'border-primary/40 bg-primary/5' : ''}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-foreground text-sm">{level}</span>
                      <Badge variant={applicable ? 'secondary' : level.toLowerCase().includes('unacceptable') || level.toLowerCase().includes('inacceptable') ? 'destructive' : 'outline'}>{badge}</Badge>
                      {applicable && <Badge variant="default" className="text-xs">LoiClair</Badge>}
                    </div>
                    <p className="text-xs">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs">{t('risque.quizSansIa')}</p>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="obligations" className="border rounded-lg px-4">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            {t('obligations.title')}
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground space-y-3 pb-4">
            <p>{t('obligations.articleIntro')}</p>
            <div className="space-y-2 mt-2">
              {obligationItems.map(({ title, desc }) => (
                <div key={title} className="flex gap-3 p-3 rounded-lg border">
                  <CheckCircle2 className="h-4 w-4 text-[#27AE60] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground text-sm">{title}</p>
                    <p className="text-xs mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-3 p-3 rounded-lg border border-orange-500/30 bg-orange-500/5">
              <AlertTriangle className="h-4 w-4 text-[#F39C12] shrink-0 mt-0.5" />
              <p className="text-xs">{t('obligations.warning')}</p>
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="conformite" className="border rounded-lg px-4">
          <AccordionTrigger className="text-base font-semibold hover:no-underline">
            {t('conformite.title')}
          </AccordionTrigger>
          <AccordionContent className="text-sm text-muted-foreground space-y-3 pb-4">
            <div className="space-y-2">
              {conformiteItems.map(({ title, desc }) => (
                <div key={title} className="flex gap-3 p-3 rounded-lg border">
                  <CheckCircle2 className="h-4 w-4 text-[#27AE60] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-foreground text-sm">{title}</p>
                    <p className="text-xs mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

      </Accordion>

      {/* Timeline */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-5">{t('timeline.title')}</h2>
        <div className="space-y-0">
          {timelineItems.map(({ cle, date, label, detail, done }, index) => (
            <div key={cle} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className={`h-5 w-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1
                  ${done ? 'bg-[#27AE60] border-[#27AE60]' : 'bg-background border-primary'}`}>
                  {done && <CheckCircle2 className="h-3 w-3 text-white" />}
                </div>
                {index < timelineItems.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
              </div>
              <div className="pb-7">
                <p className="text-xs text-muted-foreground">{date}</p>
                <p className="font-semibold text-sm">
                  {label}{' '}
                  <Badge variant="secondary" className="text-xs ml-1">
                    {done ? t('badges.effective') : t('badges.upcoming')}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sources */}
      <div className="mt-10 border-t pt-8">
        <h2 className="text-lg font-semibold mb-4">{t('sources.title')}</h2>
        <div className="space-y-2">
          {SOURCES.map(({ cle, href, chemin }) =>
            chemin ? (
              <Link
                key={cle}
                href={chemin}
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                {t(`sources.${cle}`)}
              </Link>
            ) : (
              <a
                key={cle}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                {t(`sources.${cle}`)}
              </a>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
