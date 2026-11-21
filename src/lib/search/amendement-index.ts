// src/lib/search/amendement-index.ts
// Client uniquement : l'index des amendements de la page Textes (LOI-83). Charge les
// métadonnées (/api/search-index/amendements), puis le dispositif et les résumés
// (/api/search-index/amendements/textes), les garde dans IndexedDB par version et
// construit l'index MiniSearch. Calqué sur `chargerIndexDossiers` (`dossier-index.ts`).
// Appelé par la liste des textes (`DossiersResultsClient`) à la première requête tapée,
// jamais avant : un visiteur qui ne cherche rien ne télécharge rien.
//
// Un document par amendement adopté, ou rejeté par scrutin public (page
// `/Amendements/[uid]`), et par scrutin public sur un amendement que l'index n'a pas
// déjà (sans page ici : sa ligne mène à la page officielle du scrutin). La recherche rend, par dossier, les documents trouvés : la liste les range
// sous leur texte (`chercherAmendements`).

import MiniSearch from 'minisearch';
import { processTermDossiers } from './normalize';
import { idbGet, idbSet } from './idb';
import { decouperLigne, SEP_CHAMP, SEP_LIGNE } from './amendement-format';

/** Un amendement adopté, tel que le sert la route des métadonnées. */
export type AmendementMeta = {
  uid: string;
  dossier_uid: string;
  /** Sans la mention de rectification : « CL123 », « 71 », « II-19 ». */
  numero: string;
  /** « Art. 4 », « Après art. 1er », `null` quand la source n'en dit rien. */
  article: string | null;
  chambre: 'AN' | 'SN';
  lieu: 'seance' | 'commission';
  /** Date du sort à l'Assemblée, du dépôt au Sénat (`amendements.date_amendement`). */
  date: string | null;
  auteur_type: 'parlementaire' | 'rapporteur' | 'commission' | 'gouvernement';
  /** Prénom et nom de l'élu, ou libellé de la source ; `null` pour le Gouvernement. */
  auteur: string | null;
  /** Faux pour un amendement rejeté par scrutin public (LOI-85). */
  adopte: boolean;
  /** Adopté seulement : où en est le texte qui l'a reçu, à sa lecture (règle dans la route
   *  d'index) ; `null` quand la source ne permet pas de le dire. */
  ensemble: 'adopte' | 'rejete' | 'sans_vote' | 'en_attente' | null;
  /** Date du vote de la chambre sur l'ensemble, pour 'adopte' et 'rejete'. */
  ensemble_date: string | null;
};

/** Un scrutin public sur un amendement, rattaché à son dossier (`scrutins.dossier_uid`). */
export type VoteAmendementMeta = {
  uid: string;
  dossier_uid: string;
  /** Intitulé officiel : « l'amendement n° 12 de M. X à l'article 3 du projet de loi… ». */
  titre: string | null;
  /** Sa traduction par l'IA, affichée sur /en par `titreDossier` quand elle existe. */
  titre_en: string | null;
  date: string | null;
  adopte: boolean;
};

/** Réponse de la route des métadonnées, et sa copie IndexedDB (clé `liste`). */
type Liste = { version: string; textesVersion: string; amendements: AmendementMeta[]; votes: VoteAmendementMeta[] };
/** Les textes (route `/textes`) : leur version, une ligne par amendement (format de
 *  `amendement-format.ts`), et la version que la liste annonçait au téléchargement (voir
 *  `attendue` dans `dossier-index.ts`). */
type TextesLocaux = { version: string; lignes: string[]; attendue?: string };

/** Copie IndexedDB des textes : la clé `textes` porte la version et le nombre de
 *  paquets, les clés `textes-0`, `textes-1`… les lignes par paquets de
 *  `LIGNES_PAR_PAQUET`, chacun marqué de sa version. Écrire les 18 Mo d'une seule clé
 *  prenait 151 ms d'un tenant (Chrome, processeur ×4, 2026-11-20) : un paquet s'écrit
 *  dans sa propre tâche. Les paquets s'écrivent avant l'en-tête, et un paquet d'une autre
 *  version fait ignorer la copie : une écriture interrompue ne mélange jamais deux versions. */
type EnteteTextes = { version: string; attendue?: string; paquets: number };
type PaquetTextes = { version: string; lignes: string[] };
const LIGNES_PAR_PAQUET = 2000;

/** Rend la main au navigateur, sans le délai minimal de 4 ms que prennent des
 *  `setTimeout` enchaînés. */
const ceder = () => new Promise<void>((r) => {
  const canal = new MessageChannel();
  canal.port1.onmessage = () => r();
  canal.port2.postMessage(null);
});

async function lireTextesLocaux(): Promise<TextesLocaux | null> {
  const entete = await idbGet<EnteteTextes>('amendement-index', 'textes');
  if (!entete || typeof entete.paquets !== 'number') return null;
  const lignes: string[] = [];
  for (let i = 0; i < entete.paquets; i++) {
    const paquet = await idbGet<PaquetTextes>('amendement-index', `textes-${i}`);
    if (!paquet || paquet.version !== entete.version) return null;
    for (const l of paquet.lignes) lignes.push(l);
  }
  return { version: entete.version, attendue: entete.attendue, lignes };
}

async function ecrireTextesLocaux(t: TextesLocaux): Promise<void> {
  const paquets = Math.ceil(t.lignes.length / LIGNES_PAR_PAQUET);
  for (let i = 0; i < paquets; i++) {
    await idbSet('amendement-index', `textes-${i}`, {
      version: t.version,
      lignes: t.lignes.slice(i * LIGNES_PAR_PAQUET, (i + 1) * LIGNES_PAR_PAQUET),
    } satisfies PaquetTextes);
  }
  await idbSet('amendement-index', 'textes', { version: t.version, attendue: t.attendue, paquets } satisfies EnteteTextes);
}

/** Taille des morceaux décodés d'un coup. Recevoir les 18 Mo puis les décoder par
 *  `res.text()` prenait 162 ms d'un tenant (Chrome, processeur ×4, 2026-11-20) : la
 *  réponse se lit en flux, et chaque morceau se décode et se découpe dans sa tâche. */
const MORCEAU = 256 * 1024;

/** Télécharge les textes et les découpe en lignes au fil de l'arrivée. `null` en cas
 *  d'échec, ou sur une réponse sans version. */
async function telechargerTextes(url: string): Promise<{ version: string; lignes: string[] } | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok || !res.body) return null;
    const lecteur = res.body.getReader();
    const decodeur = new TextDecoder();
    let version: string | null = null;
    let reste = '';
    const lignes: string[] = [];
    const traiter = (texte: string) => {
      let t = reste + texte;
      if (version === null) {
        const fin = t.indexOf('\n');
        if (fin < 0) { reste = t; return; }
        version = t.slice(0, fin);
        t = t.slice(fin + 1);
      }
      const morceaux = t.split(SEP_LIGNE);
      reste = morceaux.pop() ?? '';
      for (const l of morceaux) lignes.push(l);
    };
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      for (let o = 0; o < value.length; o += MORCEAU) {
        traiter(decodeur.decode(value.subarray(o, o + MORCEAU), { stream: true }));
        await ceder();
      }
    }
    traiter(decodeur.decode());
    if (reste) lignes.push(reste);
    return version ? { version, lignes } : null;
  } catch {
    return null;
  }
}

export type ElementAmendement =
  | { genre: 'amendement'; meta: AmendementMeta }
  | { genre: 'vote'; meta: VoteAmendementMeta };

/** Ce qu'une ligne montre sous l'en-tête d'un amendement : le début du dispositif, et
 *  le résumé de l'IA dans chaque langue quand l'amendement est classé. */
export type ExtraitAmendement = { dispositif: string; resume_fr: string; resume_en: string };

export type AmendementIndex = {
  minisearch: MiniSearch;
  elements: Map<string, ElementAmendement>;
  /** Vide tant que les textes ne sont pas arrivés. */
  extraits: Map<string, ExtraitAmendement>;
  /** Vrai pour le dernier index de la visite, comme `DossierIndex.final`. */
  final: boolean;
};

/** Ce qui reste en mémoire du dispositif après l'indexation : la ligne le coupe à deux
 *  lignes, et le garder entier coûterait ses 15,8 Mo bruts (2026-11-20). */
const DEBUT_DISPOSITIF = 320;

// L'indexation rend la main au navigateur dès qu'elle a travaillé `BUDGET_MS` d'affilée,
// et non tous les N documents comme `addAllAsync` : un dispositif va de quelques mots à
// 64 000 caractères, et des lots de 40 documents prenaient jusqu'à 75 ms sur les
// budgets (Chrome, processeur ×4, 2026-11-20), au-delà des 50 ms où le navigateur
// compte une tâche comme bloquante.
const BUDGET_MS = 12;
const LOT_DOCUMENTS = 1000;

// Rattache tout document à la requête « amendement » : sans ce champ, « amendement
// CL123 » ne trouverait que les scrutins, dont l'intitulé porte le mot.
const GENRE_AMENDEMENT = 'amendement amendment';
const GENRE_VOTE = 'amendement amendment scrutin vote';

/** Un document de l'index. `ligne` : sa ligne des textes, découpée seulement quand
 *  MiniSearch en lit un champ (`champ`), donc au fil de l’indexation et non
 *  d'un seul tenant avant. */
type Doc = { uid: string; ligne?: string; champs?: [string, string, string, string]; [champ: string]: string | string[] | undefined };

/** Construit l'index. Avec les textes, chaque amendement porte aussi son dispositif et
 *  ses résumés ; sans, les mêmes champs sont indexés vides. Mêmes réglages que l'index
 *  des dossiers : normalisation, mots vides, fautes tolérées, début de mot, tous les mots. */
async function construire(liste: Liste, textes: TextesLocaux | null): Promise<AmendementIndex> {
  const elements = new Map<string, ElementAmendement>();
  const extraits = new Map<string, ExtraitAmendement>();

  // Le champ d'un document. Lire le dispositif enregistre aussi l'extrait de la ligne.
  const RANG = { dispositif: 1, resume_fr: 2, resume_en: 3 } as const;
  const champ = (doc: Doc, field: string): string => {
    const rang = RANG[field as keyof typeof RANG];
    if (!rang) return (doc[field] as string | undefined) ?? '';
    if (!doc.ligne) return '';
    if (!doc.champs) {
      doc.champs = decouperLigne(doc.ligne);
      const [, dispositif, fr, en] = doc.champs;
      // Sans copie forcée des extraits (`JSON.parse(JSON.stringify(…))`) : essayée le
      // 2026-11-20, elle faisait monter le tas de 123 à 136 Mo au lieu de le baisser.
      extraits.set(doc.uid, { dispositif: dispositif.slice(0, DEBUT_DISPOSITIF), resume_fr: fr, resume_en: en });
    }
    return doc.champs[rang];
  };

  const mini = new MiniSearch<Doc>({
    idField: 'uid',
    fields: ['numero', 'article', 'auteur', 'titre', 'titre_en', 'dispositif', 'resume_fr', 'resume_en', 'genre'],
    storeFields: [],
    processTerm: (term) => processTermDossiers(term) ?? '',
    extractField: champ,
    searchOptions: {
      // Pas de faute tolérée sur un terme qui porte un chiffre : « CL123 » trouvait 74
      // amendements aux numéros voisins au lieu du sien (banc du 2026-11-20).
      fuzzy: (term) => (/\d/.test(term) ? false : 0.2),
      prefix: true,
      combineWith: 'AND',
      // Le numéro se cherche tel quel (« CL123 ») : il passe devant un mot du dispositif.
      boost: { numero: 3, auteur: 2, genre: 0.2 },
    },
  });

  // Les lignes sont rangées par uid, comme les amendements de la liste : on les apparie
  // en avançant dans les deux. Une liste plus récente que les textes (un amendement
  // ajouté ou retiré depuis) fait passer par un index par uid, construit une fois.
  const lignes = textes?.lignes ?? [];
  const uidDe = (l: string) => l.slice(0, l.indexOf(SEP_CHAMP));
  let j = 0;
  let parUid: Map<string, string> | null = null;
  const ligneDe = (uid: string): string | undefined => {
    if (j < lignes.length && uidDe(lignes[j]) === uid) return lignes[j++];
    parUid ??= new Map(lignes.map((l) => [uidDe(l), l]));
    return parUid.get(uid);
  };

  // Rend la main tous les `LOT_DOCUMENTS` : la boucle entière prenait 53 ms d'un tenant
  // (Chrome, processeur ×4, 2026-11-20).
  const docs: Doc[] = [];
  for (const [i, a] of liste.amendements.entries()) {
    if (i > 0 && i % LOT_DOCUMENTS === 0) await ceder();
    elements.set(a.uid, { genre: 'amendement', meta: a });
    docs.push({ uid: a.uid, numero: a.numero, article: a.article ?? '', auteur: a.auteur ?? '', genre: GENRE_AMENDEMENT, ligne: ligneDe(a.uid) });
  }
  for (const v of liste.votes) {
    elements.set(v.uid, { genre: 'vote', meta: v });
    docs.push({ uid: v.uid, titre: v.titre ?? '', titre_en: v.titre_en ?? '', genre: GENRE_VOTE });
  }

  let debut = performance.now();
  for (const doc of docs) {
    mini.add(doc);
    if (performance.now() - debut > BUDGET_MS) {
      await ceder();
      debut = performance.now();
    }
  }
  return { minisearch: mini as unknown as MiniSearch, elements, extraits, final: false };
}

/** Ce que la recherche trouve dans un dossier : le meilleur score de ses documents, qui
 *  le fait remonter dans la liste, et leurs uid du plus au moins pertinent. */
export type AmendementsDuDossier = { meilleur: number; uids: string[] };

/** Les documents trouvés par `query`, regroupés par dossier. `exact` retire la tolérance
 *  aux fautes, comme `searchDossiers` : la liste le demande quand elle trie par date. */
export function chercherAmendements(index: AmendementIndex, query: string, { exact = false }: { exact?: boolean } = {}): Map<string, AmendementsDuDossier> {
  const parDossier = new Map<string, AmendementsDuDossier>();
  const q = query.trim();
  if (!q) return parDossier;
  // Rendus du plus au moins pertinent : le premier vu d'un dossier porte son meilleur score.
  const hits = index.minisearch.search(q, exact ? { fuzzy: false } : undefined) as Array<{ id: string; score: number }>;
  for (const hit of hits) {
    const el = index.elements.get(hit.id);
    if (!el) continue;
    const d = parDossier.get(el.meta.dossier_uid);
    if (d) d.uids.push(hit.id);
    else parDossier.set(el.meta.dossier_uid, { meilleur: hit.score, uids: [hit.id] });
  }
  return parDossier;
}

/** Télécharge un morceau de l'index, `null` en cas d'échec. `no-cache` pour la même
 *  raison que l'index des dossiers (`telecharger` de `dossier-index.ts`). */
async function telecharger<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const abonnes = new Set<(idx: AmendementIndex) => void>();
let dernier: AmendementIndex | null = null;
let lance = false;

function publier(idx: AmendementIndex) {
  dernier = idx;
  for (const a of abonnes) a(idx);
}

/** Enchaîne les étapes du chargement, une seule fois par page ouverte. Chaque étape
 *  publie un index utilisable, de mieux en mieux :
 *  1. la copie locale des métadonnées : les numéros, auteurs et intitulés de vote se
 *     cherchent avant tout réseau ;
 *  2. la même avec les textes locaux, même d'une version passée ;
 *  3. les métadonnées fraîches, si leur version diffère ;
 *  4. les textes frais, si leur version diffère de celle qu'annoncent les métadonnées.
 *  Le dernier index est republié avec `final`. Une même paire de versions ne se
 *  construit qu'une fois : indexer le dispositif prend plusieurs secondes sur téléphone.
 *  Une panne réseau laisse le dernier index publié : sans amendements, la liste reste
 *  celle des textes. */
async function charger() {
  const listeFraiche = telecharger<Liste>('/api/search-index/amendements');
  const [listeLocale, textesLocaux] = await Promise.all([
    idbGet<Liste>('amendement-index', 'liste'),
    lireTextesLocaux(),
  ]);

  let construit = '';
  const publierSiNouveau = async (l: Liste, t: TextesLocaux | null) => {
    const cle = `${l.version}|${t?.version ?? ''}`;
    if (cle === construit) return;
    construit = cle;
    publier(await construire(l, t));
  };

  let liste = listeLocale ?? null;
  let textes: TextesLocaux | null = textesLocaux ?? null;
  if (liste) {
    await publierSiNouveau(liste, null);
    if (textes) await publierSiNouveau(liste, textes);
  }

  const fraiche = await listeFraiche;
  if (fraiche && (fraiche.version !== liste?.version || fraiche.textesVersion !== liste?.textesVersion)) {
    liste = fraiche;
    // Dans sa propre tâche : la copie de 36 000 lignes par IndexedDB, ajoutée au début de
    // l'indexation, faisait une tâche de 56 ms (Chrome, processeur ×4, 2026-11-20).
    void ceder().then(() => idbSet('amendement-index', 'liste', fraiche));
  }
  if (!liste) return;

  // Une tentative par version annoncée, comme les résumés des dossiers : la route des
  // textes peut se régénérer après celle des métadonnées.
  const voulue = liste.textesVersion;
  const aTelecharger = !!voulue && textes?.version !== voulue && textes?.attendue !== voulue;
  // Sans textes (première visite) ou avec des textes déjà à jour, la liste fraîche se
  // publie tout de suite. Avec des textes à remplacer, elle attend : reconstruire deux
  // fois l'index complet coûterait deux fois l'indexation du dispositif.
  if (!textes || !aTelecharger) await publierSiNouveau(liste, textes);
  if (aTelecharger) {
    const frais = await telechargerTextes('/api/search-index/amendements/textes');
    if (frais) {
      textes = { ...frais, attendue: voulue };
      void ecrireTextesLocaux(textes);
    }
    await publierSiNouveau(liste, textes);
  }

  if (dernier) publier({ ...dernier, final: true });
}

/**
 * Abonne `surIndex` à l'index des amendements et lance son chargement la première fois.
 * Appelé tout de suite avec le dernier index publié s'il existe : revenir sur la liste
 * dans la même visite ne retélécharge ni ne réindexe rien. Rend le désabonnement.
 */
export function chargerIndexAmendements(surIndex: (idx: AmendementIndex) => void): () => void {
  abonnes.add(surIndex);
  if (dernier) surIndex(dernier);
  if (!lance) {
    lance = true;
    // Une exception imprévue (IndexedDB, MiniSearch) laisse le dernier index publié,
    // republié en `final` ; sans aucun, la liste reste celle des textes.
    charger().catch(() => {
      if (dernier && !dernier.final) publier({ ...dernier, final: true });
    });
  }
  return () => { abonnes.delete(surIndex); };
}
