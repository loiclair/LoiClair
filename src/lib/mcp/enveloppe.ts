// src/lib/mcp/enveloppe.ts
//
// Forme commune de toutes les réponses du serveur MCP : les données, la date de
// la dernière synchronisation, et le bloc de limites.
//
// Le bloc de limites est le garde-fou du serveur. Un croisement que personne
// n'a prévu reste honnête parce que sa réponse porte les pages où la méthode
// est écrite en entier. Ces liens ne viennent pas d'un dictionnaire à tenir à
// jour : chaque outil déclare, là où il forme ses données, les `href` des
// articles qui le concernent, et `FACTS_ARTICLES` en tire le reste. Un article
// renommé ou republié suit donc tout seul.
//
// Appelé par les trois modules d'outils.

import { FACTS_ARTICLES } from '@/lib/facts-registry';
import { sql, auPlusUneLigne } from '@/lib/db';
import { lireOuCalculer, cleCache } from '@/lib/mcp/cache';
import messagesFr from '@/messages/fr.json';
import messagesEn from '@/messages/en.json';

// `NEXT_PUBLIC_SITE_URL` peut valoir `https://www.loiclair.fr`, qui répond
// 308 vers l'apex. Or `share-url.ts` et `sitemap.ts` déclarent l'apex canonique,
// et chaque réponse du serveur porte ses liens d'attribution : les laisser en
// `www` ferait suivre une redirection à chaque clic, et publierait une forme que
// le site lui-même ne reconnaît pas comme la sienne. Le `www.` tombe donc ici,
// sans toucher la variable, que d'autres endroits lisent.
const SITE = (process.env.NEXT_PUBLIC_SITE_URL || 'https://loiclair.fr')
  .trim()
  .replace(/^(https?:\/\/)www\./i, '$1');

// `localePrefix: 'always'` : aucune URL du site ne vit sans son préfixe de
// langue. Une adresse sans préfixe répond 307 vers la version française, ce qui
// ferait atterrir un lecteur anglophone sur une page française. D'où les deux
// champs sur chaque résultat, plutôt qu'un paramètre de langue sur chaque outil.
export function urlFr(chemin: string): string {
  return `${SITE}/fr${chemin}`;
}

export function urlEn(chemin: string): string {
  return `${SITE}/en${chemin}`;
}

/** Les questions des articles vivent dans le namespace `kpisHub`, en clés de message. */
const QUESTIONS_FR = messagesFr.kpisHub as unknown as Record<string, string>;
const QUESTIONS_EN = messagesEn.kpisHub as unknown as Record<string, string>;

export type ArticleLie = {
  url: string;
  url_en: string;
  question_fr: string;
  question_en: string;
};

/**
 * Résout un `href` de `FACTS_ARTICLES` en lien utilisable.
 *
 * Rend `null` sur un href inconnu plutôt que de fabriquer une URL : un lien
 * mort dans un bloc qui promet la méthode serait pire que pas de lien.
 */
export function articleLie(href: string): ArticleLie | null {
  const article = FACTS_ARTICLES.find((a) => a.href === href);
  if (!article) return null;
  return {
    url: urlFr(article.href),
    url_en: urlEn(article.href),
    question_fr: QUESTIONS_FR[article.titleKey] ?? '',
    question_en: QUESTIONS_EN[article.titleKey] ?? '',
  };
}

// Une seule phrase, identique sur les dix outils, plutôt qu'un avertissement
// par métrique. Un texte qui change à chaque réponse serait plus précis, mais il
// demanderait un dictionnaire à maintenir en parallèle des méthodologies, qui
// finirait par les contredire. Le détail vit sur les pages liées, qui sont déjà
// tenues à jour parce qu'elles sont publiques.
const AVERTISSEMENT_FR =
  "Ces chiffres ont des limites connues (périmètre, exclusions, mode de calcul), expliquées sur les pages ci-dessous. Les citer sans elles peut induire en erreur.";
const AVERTISSEMENT_EN =
  'These figures have known limitations (scope, exclusions, calculation method), explained on the pages below. Quoting them without those caveats can mislead.';

export type Limites = {
  avertissement_fr: string;
  avertissement_en: string;
  methode: ArticleLie[];
};

/** Posé quand une liste a été coupée, pour que l'assistant sache qu'il en reste. */
export type Troncature = {
  limite: number;
  conseil_fr: string;
  conseil_en: string;
};

export type Enveloppe<T> = {
  outil: string;
  donnees: T;
  tronque?: Troncature;
  source: {
    nom: 'LoiClair';
    url: string;
    /** `sync_etat.derniere_reussite` : la nuit où le pipeline a tout réussi. */
    derniere_synchro: string | null;
  };
  limites: Limites;
};

/**
 * Date de la dernière synchronisation réussie.
 *
 * Elle part dans chaque réponse parce que le pipeline nocturne peut être à
 * l'arrêt (il l'a déjà été plusieurs jours d'affilée, faute de quota GitHub
 * Actions) et qu'un assistant présenterait sinon des données figées comme
 * fraîches. Une heure de cache : la valeur ne change qu'une fois par nuit, et
 * c'est la seule lecture que chaque appel ferait sinon.
 */
async function derniereSynchro(): Promise<string | null> {
  return lireOuCalculer(cleCache('synchro'), 60 * 60, async () => {
    // Une panne ne lève pas ici : l'absence de cette date n'invalide pas la
    // réponse, elle la prive d'une précision. Lever ferait tomber l'outil entier
    // pour un champ d'information.
    try {
      const ligne = await auPlusUneLigne(sql<{ derniere_reussite: string | null }[]>`
        select derniere_reussite from sync_etat where cle = 'nightly'`, 'sync_etat');
      return ligne?.derniere_reussite ?? null;
    } catch (e) {
      console.warn('[mcp] date de synchronisation illisible', e instanceof Error ? e.message : e);
      return null;
    }
  });
}

/** Assemble la réponse d'un outil. `hrefs` sont ceux des articles qui expliquent ses données. */
export async function enveloppe<T>(
  outil: string,
  donnees: T,
  hrefs: string[],
  tronque?: Troncature,
): Promise<Enveloppe<T>> {
  return {
    outil,
    donnees,
    ...(tronque ? { tronque } : {}),
    source: {
      nom: 'LoiClair',
      url: `${SITE}/fr`,
      derniere_synchro: await derniereSynchro(),
    },
    limites: {
      avertissement_fr: AVERTISSEMENT_FR,
      avertissement_en: AVERTISSEMENT_EN,
      methode: hrefs.map(articleLie).filter((a): a is ArticleLie => a !== null),
    },
  };
}

/**
 * Met une enveloppe à la forme qu'attend le protocole.
 *
 * Le JSON part sérialisé dans `text`, sans indentation : elle coûterait environ
 * un cinquième de jetons en plus à chaque réponse, payés par l'utilisateur, pour
 * une lisibilité dont un modèle n'a pas besoin. Pas de `structuredContent` non
 * plus : il faudrait déclarer et maintenir un schéma de sortie par outil, que le
 * SDK valide à l'exécution, donc un second point de vérité, dans un dépôt sans
 * test pour le rattraper quand il divergera.
 */
export function versContenuMcp(valeur: unknown): ReponseMcp {
  return { content: [{ type: 'text' as const, text: JSON.stringify(valeur) }] };
}

/** Forme d'une réponse d'outil, succès ou erreur. */
export type ReponseMcp = {
  content: { type: 'text'; text: string }[];
  isError?: true;
};

/** Réponse d'erreur : un code, jamais une phrase, la route ne connaissant pas la langue du lecteur. */
export function erreurMcp(code: string, extra: Record<string, unknown> = {}): ReponseMcp {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ erreur: code, ...extra }) }],
    isError: true,
  };
}

/** Conseil de troncature, identique partout : une liste coupée se dit de la même façon. */
export function troncature(limite: number): Troncature {
  return {
    limite,
    conseil_fr: "D'autres résultats existent. Affinez les filtres pour les atteindre.",
    conseil_en: 'More results exist. Narrow the filters to reach them.',
  };
}
