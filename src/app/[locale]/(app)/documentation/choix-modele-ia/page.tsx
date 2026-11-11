// Page `/documentation/choix-modele-ia` : quel modèle d'IA fait quelle tâche, et
// pourquoi. Le modèle se choisit tâche par tâche, chacune d'après son propre banc, et
// la page les présente à égalité : le bloc « Qui écrit quoi » (lu dans les constantes
// de production), puis une section par banc. Le résumé de loi, avec les résultats lus
// dans `lib/evaluation-modeles` (généré par scripts/banc-modeles/classement.py) et la
// méthode de mesure ; la fiche courte des dossiers (`lib/evaluation-fiches-courtes`) ;
// le classement de « Ce qui me concerne » (`lib/evaluation-ce-qui-me-concerne`) ; les
// titres anglais des dossiers, sans comparaison de modèles, dont le texte suffit. Les
// consignes envoyées aux modèles vivent sur la page sœur `/documentation/prompts-ia`.
// Aucune donnée ici, mais le badge du pied de page date le dernier run de nuit : sans
// minuterie, il garderait la date du déploiement.
export const revalidate = 86400;

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Surligne } from '@/components/ui/Surligne';
import { ArrowLeftRight, BarChart3, CheckCircle2, ChevronRight } from 'lucide-react';
import { EVALUATION_MODELES, type ModeleEvalue } from '@/lib/evaluation-modeles';
import { EVALUATION_FICHES_COURTES } from '@/lib/evaluation-fiches-courtes';
import { EVALUATION_CE_QUI_ME_CONCERNE } from '@/lib/evaluation-ce-qui-me-concerne';
import { ScoreCoutChart } from '@/components/ui/ScoreCoutChart';
import {
  MODEL_CC_DECISION, MODEL_FAMILLE_IA, MODEL_NEWSLETTER, MODEL_RESUME_DEBATS, MODEL_RESUME_LOI, MODEL_SEARCH_SUMMARY, PARAMS_RESUME_LOI,
} from '@/lib/prompts';
import promptConcerne from '@/lib/prompts/ce-qui-me-concerne.json';
import promptTitres from '@/lib/prompts/titres-en.json';
import type { IconType } from 'react-icons';
import { RiAnthropicFill, RiGeminiFill, RiGrokAiFill, RiOpenaiFill } from 'react-icons/ri';
import { buildAlternates } from '@/lib/og-metadata';

// Logo de chaque fournisseur, tous pris dans le même jeu (Remix Icons) pour un trait
// homogène. xAI n'y a pas de logo propre : on prend celui de Grok, son seul produit
// ici ; pour Google, celui de Gemini, le modèle mesuré.
const LOGOS: Record<ModeleEvalue['famille'], IconType> = {
  openai: RiOpenaiFill, anthropic: RiAnthropicFill, google: RiGeminiFill, xai: RiGrokAiFill,
};
// Famille d'un modèle de production, lue dans son identifiant : ces modèles ne sont
// pas tous dans le grand banc (Claude Haiku 5.5 n'y figure pas), qui porte la famille.
const familleDe = (id: string): ModeleEvalue['famille'] | null =>
  id.startsWith('gpt') ? 'openai' : id.startsWith('claude') ? 'anthropic' : id.startsWith('gemini') ? 'google' : id.startsWith('grok') ? 'xai' : null;

// Une ancre ne cache pas son titre sous la barre de navigation fixe : même hauteur
// que partout ailleurs, définie une fois dans globals.css.
const MARGE_ANCRE = 'var(--hauteur-entete)';

// Le cyan qui signale l'IA sur tout le site (voir `.avis-limite` dans globals.css) :
// le teal `--primary`, plus clair, tombe sous le contraste minimum en thème clair.
const COULEUR_IA = '#0891b2';

// Ordre des critères dans le tableau : celui de leur poids dans le score.
const CRITERES = ['exactitude', 'neutralite', 'completude', 'clarte', 'exemples'] as const;
// Critères du banc de la fiche courte (sa section, plus bas) : pas d'exemples,
// mais le choix des thèmes.
const CRITERES_FICHE = ['exactitude', 'neutralite', 'completude', 'clarte', 'themes'] as const;

// Noms d'affichage des modèles du banc : des noms propres, identiques dans les
// deux langues. Un identifiant absent de la table s'affiche tel quel.
const NOMS_MODELES: Record<string, string> = {
  'gpt-6-luna': 'GPT-6 Luna', 'gpt-6-sol': 'GPT-6 Sol', 'gpt-6-astra': 'GPT-6 Astra',
  'grok-4.3': 'Grok 4.3', 'grok-4.7': 'Grok 4.7',
  'claude-opus-5-5': 'Claude Opus 5.5', 'claude-sonnet-5': 'Claude Sonnet 5', 'claude-haiku-5-5': 'Claude Haiku 5.5',
  'gemini-3.1-pro-preview': 'Gemini 3.1 Pro', 'mistral-large-4': 'Mistral Large 4',
  'deepseek-v4-pro': 'DeepSeek V4 Pro', 'gemini-3.8-flash': 'Gemini 3.8 Flash', 'mistral-medium-3-5': 'Mistral Medium 3.5',
};
// Colonnes du tableau de « Ce qui me concerne », dans l'ordre d'affichage ; ce sont
// toutes des parts, le coût est ajouté à part.
const COLONNES_CONCERNE = [
  ['justesse', 'concerneColJustes'], ['certain', 'concerneColCertain'], ['probable', 'concerneColProbable'],
  ['rappel', 'concerneColRappel'], ['fidelite', 'concerneColFidelite'],
] as const;

// En-tête de colonne des tableaux : les deux premières à gauche, les chiffres à droite.
const styleEntete = (i: number): React.CSSProperties => ({
  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '.08em', textAlign: i < 2 ? 'left' : 'right', whiteSpace: 'nowrap',
});

/**
 * Tableau des sections à deux modèles (fiche courte, « Ce qui me concerne ») : le modèle retenu, ligne teintée comme dans le
 * grand tableau, contre le modèle comparé. Première colonne à gauche, chiffres à
 * droite ; défile seul sur écran étroit, jamais la page entière.
 */
function TableauDuel({ entetes, lignes }: { entetes: string[]; lignes: { cle: string; retenu: boolean; cellules: React.ReactNode[] }[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="w-full border-collapse" style={{ fontSize: '13px' }}>
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
            {entetes.map((col, i) => (
              <th key={col} className="text-muted-foreground font-normal py-2 pr-4" style={styleEntete(i === 0 ? 0 : 2)}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr
              key={l.cle}
              className="border-b"
              // En style et non en classe, Tailwind v4 étant peu fiable sur Safari.
              style={{ borderColor: 'var(--border)', backgroundColor: l.retenu ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : undefined }}
            >
              {l.cellules.map((c, j) => (
                <td key={j} className="py-2 pr-4 tabular-nums" style={{ textAlign: j === 0 ? 'left' : 'right', whiteSpace: j === 0 ? 'normal' : 'nowrap', minWidth: j === 0 ? '130px' : undefined }}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'choixModeleIA' });
  return {
    title: t('pageTitle') + ' — LoiClair',
    description: t('pageMetaDesc'),
    alternates: buildAlternates(locale, '/documentation/choix-modele-ia'),
  };
}

/**
 * Les chiffres du tableau, du nuage et de la réponse viennent de `EVALUATION_MODELES` ;
 * le bloc « Qui écrit quoi » et la carte des modèles, des constantes de production.
 * Quelques-uns sont en revanche écrits en dur dans les traductions et ne suivent pas
 * un nouveau banc : `about.faq.q7` (huit modèles, 20 fois moins cher, les deux
 * modèles nommés et leurs tâches), `choixModeleIA.intro` (OpenAI pour le modèle
 * servi par Mammouth, Anthropic pour celui de la fiche courte), `promptsIA.cardModele*` (les deux modèles
 * nommés), `evalLimitesCourt` (0,2 point, 500 000 caractères, GPT-6 Luna en
 * raisonnement moyen, 7 $). Le lien vers la grille de notation, plus bas, vise la
 * copie figée `grille-2026-09-29.md` : à changer si un nouveau banc est noté avec une
 * autre grille. À relire à chaque banc.
 */
export default async function ChoixModeleIAPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'choixModeleIA' });
  const ev = EVALUATION_MODELES;
  const en = locale === 'en';
  const nombre = (n: number, decimales = 1) =>
    n.toLocaleString(en ? 'en-GB' : 'fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
  // « 0,80 $ » en français, « $0.80 » en anglais ; pas de centimes au-delà de 100 $.
  const dollars = (n: number) => {
    const v = n.toLocaleString(en ? 'en-GB' : 'fr-FR', { maximumFractionDigits: n >= 100 ? 0 : 2, minimumFractionDigits: n >= 100 || n < 0.1 || Number.isInteger(n) ? 0 : 2 });
    return en ? `$${v}` : `${v} $`;
  };
  const nom = (m: ModeleEvalue) => {
    const base = NOMS_MODELES[m.id] ?? m.id;
    // Le réglage par défaut de la mesure (celui de la prod ce jour-là) n'est pas
    // précisé : seules les variantes le sont.
    if (m.raisonnement === ev.raisonnement) return base;
    // « thinking » : budget de réflexion imposé, seule façon de faire réfléchir les Claude sur cette tâche.
    if (m.raisonnement === 'thinking') return `${base} (${t('evalReflexionForcee')})`;
    return `${base} (${t('evalRaisonnement', { niveau: t(`evalNiveaux.${m.raisonnement}` as 'evalNiveaux.low') })})`;
  };
  const fc = EVALUATION_FICHES_COURTES;
  const nomFiche = (id: string) => NOMS_MODELES[id] ?? id;
  const pourcentage = (n: number) => n.toLocaleString(en ? 'en-GB' : 'fr-FR', { style: 'percent', maximumFractionDigits: 0 });
  const cq = EVALUATION_CE_QUI_ME_CONCERNE;
  const dateLongue = (iso: string) => new Date(iso).toLocaleDateString(en ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  // « A, B et C » ou « A, B and C », selon la langue.
  const jugesConcerne = new Intl.ListFormat(en ? 'en-GB' : 'fr-FR', { type: 'conjunction' }).format(cq.juges.map(nomFiche));
  const retenu = ev.modeles.find((m) => m.id === MODEL_FAMILLE_IA && m.raisonnement === PARAMS_RESUME_LOI.reasoningEffort);
  const meilleur = ev.modeles[0];
  // Nom tel que le lecteur le connaît, même si le banc n'a pas mesuré le modèle en prod.
  const nomRetenu = retenu ? nom(retenu) : (NOMS_MODELES[MODEL_FAMILLE_IA] ?? MODEL_FAMILLE_IA);
  const date = dateLongue(ev.dateMesure);
  const longueurs = ev.textes.map((x) => x.caracteres);
  const pourcent = (w: number) => Math.round(w * 100);
  const paramsTextes = {
    n: ev.textes.length, fr: ev.textes.filter((x) => x.langue === 'fr').length, en: ev.textes.filter((x) => x.langue === 'en').length,
    min: nombre(Math.min(...longueurs), 0), max: nombre(Math.max(...longueurs), 0),
  };
  const paramsPoids = { exactitude: pourcent(ev.poids.exactitude), neutralite: pourcent(ev.poids.neutralite), autres: pourcent(ev.poids.clarte) };

  // « Qui écrit quoi » : le modèle de chaque tâche est lu dans la constante qui sert
  // en production, pas dans les bancs, pour que la liste dise ce qui tourne vraiment.
  // Débats, décisions du Conseil constitutionnel et newsletter, sans banc propre,
  // tiennent en une ligne tant qu'ils partagent un modèle ; dès que l'un en change
  // (`MODEL_CC_DECISION` se règle à part, dans `prompts/cc-decision.json`), chacun
  // reprend sa ligne, pour que la liste ne mente jamais.
  const sansBanc: { cle: string; tache: string; modele: string }[] = [
    { cle: 'debats', tache: t('quiTacheDebats'), modele: MODEL_RESUME_DEBATS },
    { cle: 'cc', tache: t('quiTacheCc'), modele: MODEL_CC_DECISION },
    { cle: 'newsletter', tache: t('quiTacheNewsletter'), modele: MODEL_NEWSLETTER },
  ];
  const quiEcritQuoi: { cle: string; tache: string; modele: string; ancre?: string }[] = [
    { cle: 'loi', tache: t('quiTacheLoi'), modele: MODEL_RESUME_LOI, ancre: 'resume-loi' },
    ...(new Set(sansBanc.map((s) => s.modele)).size === 1
      ? [{ cle: 'autres', tache: t('quiTacheAutres'), modele: sansBanc[0].modele }]
      : sansBanc),
    { cle: 'fiche', tache: t('quiTacheFiche'), modele: MODEL_SEARCH_SUMMARY, ancre: 'fiche-courte' },
    { cle: 'concerne', tache: t('quiTacheConcerne'), modele: promptConcerne.modele, ancre: 'ce-qui-me-concerne' },
    { cle: 'titres', tache: t('quiTacheTitres'), modele: promptTitres.modele, ancre: 'titres-anglais' },
  ];
  const modelesEnService = [...new Set(quiEcritQuoi.map((q) => q.modele))];

  // En-têtes du tableau unique : les deux premières colonnes à gauche, les chiffres à droite.
  const entetes = [
    '#', t('evalColModele'), t('evalColScore'), ...CRITERES.map((k) => t(`evalCriteres.${k}`)),
    t('evalColGraves'), t('evalColConsignes'), t('evalColEcart'), t('evalColCout'),
  ];
  // Meilleure valeur de chaque colonne chiffrée, pour la mettre en avant : la plus
  // haute pour les notes et les consignes, la plus basse pour les erreurs, l'écart
  // et le coût. Les ex æquo sont tous mis en avant.
  const meilleure = (valeurs: (number | null)[], plusBas = false) => {
    const connues = valeurs.filter((v): v is number => v !== null);
    return plusBas ? Math.min(...connues) : Math.max(...connues);
  };
  const tops = {
    score: meilleure(ev.modeles.map((m) => m.score)),
    criteres: Object.fromEntries(CRITERES.map((k) => [k, meilleure(ev.modeles.map((m) => m.criteres[k]))])) as Record<typeof CRITERES[number], number>,
    graves: meilleure(ev.modeles.map((m) => m.gravesPour10), true),
    consignes: meilleure(ev.modeles.map((m) => m.consignes)),
    ecart: meilleure(ev.modeles.map((m) => m.ecartTirages), true),
    cout: meilleure(ev.modeles.map((m) => m.coutPour1000), true),
  };
  const top = (contenu: React.ReactNode, estTop: boolean) =>
    estTop ? <span style={{ color: COULEUR_IA, fontWeight: 600 }}>{contenu}</span> : contenu;
  // Le pire taux d'erreurs graves, cité en regard de celui du modèle retenu.
  const pire = ev.modeles.reduce((a, b) => (b.gravesPour10 > a.gravesPour10 ? b : a));

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="mb-10">
        {/* Le titre vit dans l'en-tête commun (`usePageHero`) ; l'intro reste
            ici, elle nomme les modèles en service, que l'en-tête ne connaît pas.
            Elle ne dit pas qui fait quoi, c'est le rôle du bloc « Qui écrit quoi » :
            seulement par où passe chaque modèle. `MODEL_FAMILLE_IA` est celui que
            sert Mammouth (`lib/ai-provider.ts`) ; la fiche courte appelle l'API
            d'Anthropic directement. */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t('intro', { n: modelesEnService.length, modeleMammouth: nomFiche(MODEL_FAMILLE_IA), modeleAnthropic: nomFiche(MODEL_SEARCH_SUMMARY) })}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-5">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 pb-4 flex flex-col gap-1">
              <BarChart3 className="h-5 w-5 text-primary" />
              <p className="font-semibold text-sm mt-1">{t('cardBancsTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('cardBancsDesc')}</p>
            </CardContent>
          </Card>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 pb-4 flex flex-col gap-1">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <p className="font-semibold text-sm mt-1">{t('cardModelesTitle', { n: modelesEnService.length })}</p>
              <p className="text-xs text-muted-foreground">
                {t('cardModelesDesc', { modeles: new Intl.ListFormat(en ? 'en-GB' : 'fr-FR', { type: 'conjunction' }).format(modelesEnService.map(nomFiche)) })}
              </p>
            </CardContent>
          </Card>
          <Card className="border-[#F39C12]/30 bg-[#F39C12]/5">
            <CardContent className="pt-4 pb-4 flex flex-col gap-1">
              <ArrowLeftRight className="h-5 w-5 text-[#F39C12] dark:text-[#F1C40F]" />
              <p className="font-semibold text-sm mt-1">{t('cardAttitreTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('cardAttitreDesc')}</p>
            </CardContent>
          </Card>
        </div>
      </div>

      <section className="mb-12">
        <h2 className="text-xl font-semibold tracking-tight mb-3">{t('quiTitle')}</h2>
        {/* Séparateurs en style et non en classe, Tailwind v4 étant peu fiable sur Safari. */}
        <ul style={{ borderTop: '1px solid var(--border)' }}>
          {quiEcritQuoi.map((q) => {
            const famille = familleDe(q.modele);
            const Logo = famille ? LOGOS[famille] : null;
            return (
              <li key={q.cle} className="py-3 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6" style={{ borderBottom: '1px solid var(--border)' }}>
                {q.ancre
                  ? <a href={`#${q.ancre}`} className="text-sm text-foreground hover:underline">{q.tache}</a>
                  : <span className="text-sm text-foreground">{q.tache}</span>}
                <span className="text-xs text-muted-foreground sm:text-right">
                  {Logo && <Logo aria-hidden style={{ display: 'inline', width: '13px', height: '13px', marginRight: '5px', verticalAlign: '-2px' }} />}
                  <span className="text-foreground font-medium">{nomFiche(q.modele)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section id="resume-loi" className="mb-12" style={{ scrollMarginTop: MARGE_ANCRE }}>
        <h2 className="text-xl font-semibold tracking-tight mb-3">{t('sectionPourquoi', { modele: nomRetenu })}</h2>
        {retenu && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t.rich('evalAnswer', {
              // Modèles distincts : GPT-6 Luna, mesuré à deux réglages, a deux lignes au tableau.
              n: new Set(ev.modeles.map((m) => m.id)).size, modele: nomRetenu, score: nombre(retenu.score), cout: dollars(retenu.coutPour1000),
              meilleur: nom(meilleur), ecart: nombre(meilleur.score - retenu.score),
              ratio: Math.round(meilleur.coutPour1000 / retenu.coutPour1000),
              hl: (chunks) => <Surligne couleur={COULEUR_IA}>{chunks}</Surligne>,
            })}{' '}
            {t.rich('evalGraves', {
              graves: nombre(retenu.gravesPour10), pire: nombre(pire.gravesPour10), nomPire: nom(pire),
              hl: (chunks) => <Surligne couleur={COULEUR_IA}>{chunks}</Surligne>,
            })}
          </p>
        )}

        <h3 className="text-sm font-semibold text-foreground mt-6">{t('evalChartTitle')}</h3>
        <p className="text-xs text-muted-foreground mt-1 mb-3 leading-relaxed">{t('evalChartHowTo')}</p>
        <ScoreCoutChart
          points={ev.modeles.map((m, i) => ({
            numero: i + 1, nom: nom(m), score: m.score, cout: m.coutPour1000, frontiere: m.frontiere, retenu: m === retenu, Logo: LOGOS[m.famille],
          }))}
          libelleAxeX={t('evalAxeX')}
          libelleAxeY={t('evalAxeY')}
          titre={t('evalChartAria')}
          formatCout={dollars}
          formatScore={(n) => nombre(n)}
        />

        {/* Un seul tableau : il sert aussi de légende au nuage. Défile seul si l'écran
            est étroit, jamais la page entière. */}
        <div className="mt-5" style={{ overflowX: 'auto' }}>
          <table className="w-full border-collapse" style={{ fontSize: '13px' }}>
            <thead>
              <tr>
                <th colSpan={3} />
                <th
                  colSpan={CRITERES.length}
                  className="text-muted-foreground font-normal pt-2 pr-4 border-b"
                  style={{ ...styleEntete(2), textAlign: 'center', borderColor: 'var(--border)' }}
                >
                  {t('evalGroupeCriteres')}
                </th>
                <th colSpan={4} />
              </tr>
              <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                {entetes.map((col, i) => (
                  <th key={col} className="text-muted-foreground font-normal py-2 pr-4" style={styleEntete(i)}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ev.modeles.map((m, i) => {
                const Logo = LOGOS[m.famille];
                const cellules: React.ReactNode[] = [
                  i + 1,
                  // En gras sur la frontière, astérisque s'il n'a qu'un correcteur, pastille s'il est retenu.
                  <span key="n" className="text-foreground">
                    <Logo aria-hidden className="text-muted-foreground" style={{ display: 'inline', width: '14px', height: '14px', marginRight: '6px', verticalAlign: '-2px' }} />
                    <span style={{ fontWeight: m.frontiere ? 600 : 400 }}>{nom(m)}</span>
                    {m.correcteurs.length === 1 && '*'}
                    {m === retenu && <Badge variant="secondary" className="ml-2">{t('evalRetenu')}</Badge>}
                  </span>,
                  <span key="s" className="text-foreground" style={{ fontWeight: 600 }}>{top(nombre(m.score), m.score === tops.score)}</span>,
                  ...CRITERES.map((k) => top(nombre(m.criteres[k]), m.criteres[k] === tops.criteres[k])),
                  top(nombre(m.gravesPour10), m.gravesPour10 === tops.graves),
                  top(pourcentage(m.consignes), m.consignes === tops.consignes),
                  m.ecartTirages === null ? '·' : top(nombre(m.ecartTirages), m.ecartTirages === tops.ecart),
                  top(dollars(m.coutPour1000), m.coutPour1000 === tops.cout),
                ];
                return (
                  <tr
                    key={`${m.id}-${m.raisonnement}`}
                    className="border-b"
                    // Ligne du modèle retenu teintée ; en style et non en classe, Tailwind v4 étant peu fiable sur Safari.
                    style={{ borderColor: 'var(--border)', backgroundColor: m === retenu ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : undefined }}
                  >
                    {cellules.map((c, j) => (
                      <td
                        key={j}
                        className={`py-2 pr-4 tabular-nums${j === 0 ? ' text-muted-foreground' : ''}`}
                        // Le nom du modèle passe à la ligne, pour laisser voir plus de chiffres sur mobile.
                        style={{ textAlign: j < 2 ? 'left' : 'right', whiteSpace: j === 1 ? 'normal' : 'nowrap', minWidth: j === 1 ? '130px' : undefined }}
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
          {t('evalLegende')}
          {ev.modeles.some((m) => m.correcteurs.length === 1) && <> {t('evalNoteUnCorrecteur')}</>}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {t('evalDate', { date, resumes: ev.resumesNotes })}
        </p>

        {/* Méthode et limites en deux paragraphes, comme les sections de la fiche
            courte et de « Ce qui me concerne » : le détail du jury reste dans
            scripts/banc-modeles. Le lien vise `grille-2026-09-29.md`, celle qui a noté
            le banc du 2026-09-29 : grille.md a changé depuis (voir classement.py). */}
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed mt-6">
          <p>{t('evalMethode', { ...paramsTextes, ...paramsPoids, jury: ev.correcteurs.length })}</p>
          <p>{t.rich('evalLimitesCourt', {
            n: ev.textes.length,
            lien: (chunks) => (
              <a href="https://github.com/loiclair/LoiClair/tree/production/scripts/banc-modeles" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">{chunks}</a>
            ),
            grille: (chunks) => (
              <a href="https://github.com/loiclair/LoiClair/blob/production/scripts/banc-modeles/grille-2026-09-29.md" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">{chunks}</a>
            ),
          })}</p>
        </div>
      </section>

      <section id="fiche-courte" className="mb-12" style={{ scrollMarginTop: MARGE_ANCRE }}>
        <h2 className="text-xl font-semibold tracking-tight mb-3">{t('ficheTitle', { modele: nomFiche(fc.retenu) })}</h2>
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>{t('ficheIntro', { retenu: nomFiche(fc.retenu), compare: nomFiche(fc.compare) })}</p>
          <p>{t('ficheMethode', { versions: fc.versionsInstructions, paires: fc.pairesJugees, juge: nomFiche(fc.juge) })}</p>
          <p>{t.rich('ficheResultat', {
            retenu: nomFiche(fc.retenu), compare: nomFiche(fc.compare),
            gagne: fc.preferences.retenu, perdu: fc.preferences.compare, egal: fc.preferences.egalite,
            hl: (chunks) => <Surligne couleur={COULEUR_IA}>{chunks}</Surligne>,
          })}</p>
          <TableauDuel
            entetes={[t('evalColModele'), t('ficheColPreferences'), ...CRITERES_FICHE.map((k) => (k === 'themes' ? t('ficheColThemes') : t(`evalCriteres.${k}`))), t('ficheColCout')]}
            lignes={(['retenu', 'compare'] as const).map((qui) => ({
              cle: qui, retenu: qui === 'retenu',
              cellules: [
                <span key="n" className="text-foreground">{nomFiche(fc[qui])}</span>,
                fc.preferences[qui],
                ...CRITERES_FICHE.map((k) => nombre(fc.notes[qui][k])),
                dollars(fc.coutPour1000[qui]),
              ],
            }))}
          />
          <p className="text-xs">{t('ficheTableLegende', { paires: fc.pairesJugees, egal: fc.preferences.egalite })}</p>
          <p>{t('ficheChoix', {
            retenu: nomFiche(fc.retenu), coutRetenu: dollars(fc.coutPour1000.retenu), coutCompare: dollars(fc.coutPour1000.compare),
            ratio: Math.round(fc.coutPour1000.retenu / fc.coutPour1000.compare),
          })}</p>
          <p>{t.rich('ficheLimites', {
            date: dateLongue(fc.dateMesure),
            lien: (chunks) => (
              <a href="https://github.com/loiclair/LoiClair/tree/production/scripts/banc-fiches-courtes" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">{chunks}</a>
            ),
          })}</p>
        </div>
      </section>

      <section id="ce-qui-me-concerne" className="mb-12" style={{ scrollMarginTop: MARGE_ANCRE }}>
        <h2 className="text-xl font-semibold tracking-tight mb-3">{t('concerneTitle', { modele: nomFiche(cq.retenu) })}</h2>
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>{t.rich('concerneIntro', {
            retenu: nomFiche(cq.retenu), compare: nomFiche(cq.compare),
            lien: (chunks) => <Link href="/ce-qui-me-concerne" className="underline hover:text-foreground">{chunks}</Link>,
          })}</p>
          <p>{t('concerneMethode', {
            total: cq.elements.reglage + cq.elements.test, juges: jugesConcerne, cas: cq.casDepartages,
          })}</p>
          <p>{t('concerneBoucle', { reglage: cq.elements.reglage })}</p>
          <p>{t.rich('concerneResultat', {
            retenu: nomFiche(cq.retenu), compare: nomFiche(cq.compare),
            hl: (chunks) => <Surligne couleur={COULEUR_IA}>{chunks}</Surligne>,
          })}</p>
          <TableauDuel
            entetes={[t('evalColModele'), ...COLONNES_CONCERNE.map(([, cle]) => t(cle)), t('concerneColCout')]}
            lignes={(['retenu', 'compare'] as const).map((qui) => ({
              cle: qui, retenu: qui === 'retenu',
              cellules: [
                <span key="n" className="text-foreground">{nomFiche(cq[qui])}</span>,
                ...COLONNES_CONCERNE.map(([k]) => pourcentage(cq.test[qui][k])),
                dollars(cq.coutPour1000[qui]),
              ],
            }))}
          />
          <p className="text-xs">{t('concerneTableLegende', { test: cq.elements.test })}</p>
          <p>{t('concerneChoix', { retenu: nomFiche(cq.retenu), compare: nomFiche(cq.compare), coutRetenu: dollars(cq.coutPour1000.retenu), coutCompare: dollars(cq.coutPour1000.compare) })}</p>
          <p>{t.rich('concerneLimites', {
            test: cq.elements.test, date: dateLongue(cq.dateMesure),
            lien: (chunks) => (
              <a href="https://github.com/loiclair/LoiClair/tree/production/scripts/banc-ce-qui-me-concerne" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">{chunks}</a>
            ),
          })}</p>
        </div>
      </section>

      {/* Pas de tableau : un seul modèle a été essayé, et seule la réflexion a été
          comparée. Les chiffres du texte sont ceux du banc du 2026-10-20. */}
      <section id="titres-anglais" className="mb-12" style={{ scrollMarginTop: MARGE_ANCRE }}>
        <h2 className="text-xl font-semibold tracking-tight mb-3">{t('titresTitle', { modele: nomFiche(promptTitres.modele) })}</h2>
        <div className="space-y-3 text-sm text-muted-foreground leading-relaxed">
          <p>{t('titresIntro')}</p>
          <p>{t('titresMethode')}</p>
          <p>{t('titresChoix', { modele: nomFiche(promptTitres.modele) })}</p>
          <p>{t.rich('titresLimites', {
            modele: nomFiche(promptTitres.modele),
            lien: (chunks) => (
              <a href="https://github.com/loiclair/LoiClair/tree/production/scripts/banc-titres-en" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">{chunks}</a>
            ),
          })}</p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold tracking-tight mb-3">{t('sectionSuivant')}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">{t('suivantBody')}</p>
      </section>

      <Link
        href="/documentation/prompts-ia"
        className="flex items-center justify-between gap-4 rounded-lg border p-4 hover:bg-muted/40 transition-colors"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{t('lienInstructions.surtitre')}</span>
          <span className="text-sm font-semibold text-foreground">{t('lienInstructions.titre')}</span>
          <span className="text-xs text-muted-foreground">{t('lienInstructions.desc')}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>
    </div>
  );
}
