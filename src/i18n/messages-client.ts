// src/i18n/messages-client.ts
// Serveur uniquement. Choisit dans le catalogue de traductions ce qui part au
// navigateur : le socle, pour le `NextIntlClientProvider` de la mise en page racine
// (`src/app/[locale]/layout.tsx`), et la part propre à chaque route, pour le
// `TraductionsRoute` du `layout.tsx` de cette route.
//
// Pourquoi : le catalogue entier (437 Ko pour le français au 2026-10-20) était
// recopié dans le HTML et le flux RSC de chaque page. Trié une première fois pour le
// site entier (ce que lit du code client, où que ce soit), il pesait encore 44 Ko
// compressés sur chaque page, deux fois, et chaque génération ISR les stockait : les
// mentions légales recevaient le vocabulaire du quiz et des fiches. Les composants
// serveur lisent toujours tout par `getTranslations` ; seul le code client
// (`useTranslations`) est concerné.
//
// Un composant client qui lit une clé absente de sa route afficherait la clé brute
// (« dossiers.pageTitle »). `scripts/verifier-traductions-client.mjs`, lancé par
// `npm run lint:strict`, le bloque : il lit les listes ci-dessous telles qu'écrites,
// d'où leur forme de simples littéraux.

import type { AbstractIntlMessages } from 'next-intl';
import { clesTraductionFacts } from '@/lib/facts-registry';
import { clesTraductionNavigation } from '@/lib/navigation';

type Catalogue = Record<string, unknown>;

/** Namespaces que le socle envoie entiers : ceux que lisent les mises en page
 *  communes (menu, recherche globale, pied de page, modales), présentes sur toutes les
 *  pages. Un namespace presque entièrement lu part entier plutôt que clé par clé :
 *  quelques Ko de plus, mais aucune liste de clés à tenir à jour. `elus`, `dossiers` et
 *  `resumeIA` (11 Ko compressés à eux trois) y sont parce que la recherche globale passe
 *  ses traducteurs à `libelleMandat` et `translateStatut`, et monte `AIBadgeTitre`, dont
 *  le fichier lit des clés de `resumeIA` par nom variable. `elements` (les noms des
 *  cases d'éléments, `lib/elements.ts`) est lu par l'en-tête des rubriques
 *  (`usePageHero`, monté par `AppShell` sur toutes les pages). */
export const NAMESPACES_SOCLE = [
  'adhesion',
  'common',
  'dossiers',
  'elements',
  'elus',
  'errors',
  'footer',
  'kpisHub',
  'nav',
  'rechercheGlobale',
  'resumeIA',
  'share',
  'signaler',
];

/** Parties précises d'un namespace que le socle envoie : un sous-arbre ou une clé, en
 *  chemin pointé. `kpis.pageTitle` est lu par le menu et la recherche globale. */
export const SOUS_ARBRES_SOCLE = [
  'kpis.pageTitle',
];

/** Ce que chaque route ajoute au socle, par dossier relatif à `src/app/[locale]`. Une
 *  route reçoit aussi les listes de ses dossiers parents, que leur propre
 *  `layout.tsx` a déjà posées. Chaque dossier listé a un `layout.tsx` qui appelle
 *  `messagesRoute` avec ce même nom. */
export const TRADUCTIONS_PAR_ROUTE: Record<string, string[]> = {
  '(landing)': ['landing'],
  '(app)/about': ['newsletter'],
  '(app)/Activite': ['answerActivite.mesures', 'answerActivite.mesureLabels'],
  '(app)/ce-qui-me-concerne': ['ceQuiMeConcerne', 'scrutinVotes', 'amendementPage'],
  '(app)/dossiers-legislatifs': ['textTypes'],
  '(app)/dossiers-legislatifs/[uid]/resume-ia': ['ceQuiMeConcerne', 'scrutinVotes', 'amendementPage'],
  '(app)/Facts/succes-legislatif/efficacite': ['answerSuccesLegislatifEfficacite'],
  '(app)/Facts/succes-legislatif/volume': ['answerSuccesLegislatif'],
  '(app)/les-elus/[uid]': ['definitions'],
  '(app)/Scrutins/[uid]': ['scrutinVotes'],
  '(app)/Amendements/[uid]': ['scrutinVotes', 'amendementPage'],
  '(app)/Month': ['month'],
  '(app)/newsletter': ['newsletter'],
  '(app)/processus-legislatif': ['definitions', 'textTypes'],
  '(app)/Quiz': ['quiz', 'quizProcessus', 'themesDossiers'],
};

/** Copie dans `dest` la valeur de `src` au chemin pointé `chemin`, si elle existe. */
function copier(src: Catalogue, dest: Catalogue, chemin: string) {
  const parties = chemin.split('.');
  let s: unknown = src;
  let d = dest;
  for (let i = 0; i < parties.length; i++) {
    if (typeof s !== 'object' || s === null) return;
    s = (s as Catalogue)[parties[i]];
    if (s === undefined) return;
    if (i === parties.length - 1) d[parties[i]] = s;
    else d = (d[parties[i]] ??= {}) as Catalogue;
  }
}

/** Le socle : ce qui part au navigateur sur toutes les pages. */
export function messagesClient(messages: Catalogue): Catalogue {
  const sortie: Catalogue = {};
  for (const ns of NAMESPACES_SOCLE) if (ns in messages) sortie[ns] = messages[ns];
  for (const c of [...SOUS_ARBRES_SOCLE, ...clesTraductionNavigation(), ...clesTraductionFacts()]) {
    copier(messages, sortie, c);
  }
  return sortie;
}

/** Ce que la route `route` ajoute au socle et aux routes parentes. Le catalogue lu
 *  est celui de `getMessages`, dont les feuilles sont des chaînes : le sous-ensemble
 *  en garde la forme, d'où le type rendu. */
export function messagesRoute(messages: Catalogue, route: string): AbstractIntlMessages {
  const sortie: Catalogue = {};
  for (const c of TRADUCTIONS_PAR_ROUTE[route] ?? []) copier(messages, sortie, c);
  return sortie as AbstractIntlMessages;
}
