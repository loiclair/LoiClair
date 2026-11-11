// ──────────────────────────────────────────────────────────────────────────────
// Imports pour la route API : On utilise l'AI SDK de Vercel (léger, compatible Next.js).
// Choix : AI SDK unifie les providers IA, gère les clés et les erreurs automatiquement.
// Optimisations : Factorisation du fetch/extract ; imports ESM ; tout server-side pour sécurité.
// ──────────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from 'next/server';
import { generateObject, generateText, jsonSchema } from 'ai'; // Core AI SDK (Vercel) pour appels IA unifiés
import { modeleIA, optionsIA } from '@/lib/ai-provider';
import * as cheerio from 'cheerio';
import { extractText, getDocumentProxy } from 'unpdf';
import { getSystemPrompt, getUserPromptTemplate, getUserPromptTemplateResumeLoiReduce, getPromptVersion, getSystemPromptResumeLoiMap, getUserPromptTemplateResumeLoiMap, PARAMS_RESUME_LOI, PARAMS_RESUME_LOI_MAP, MODEL_RESUME_LOI, MAX_CHARS_PER_CHUNK_RESUME_LOI, remplirGabarit, decrireEtapeResumeLoi } from '@/lib/prompts';
import { SCHEMA_RESUME_LOI, type ResumeLoiIa } from '@/lib/ai-schemas';
import { auPlusUneLigne, sql } from '@/lib/db';
import { attendreOuPrendreVerrouIa, consommerPlafondIa, enforceAiRateLimit, plafondIaAtteint, PREFIXE_IA, redis, rendreVerrouIa, type VerrouIa } from '@/lib/rate-limit';
import { cachedTextResponse } from '@/lib/resume-ai-stream';
import { avecReprises, DELAIS_REPRISE_WEB, delaiLimiteDebit, estQuotaEpuise, REPRISES_SDK_DESACTIVEES, texteNonTronque } from '@/lib/ai-retry';

// La synthèse finale ne streame plus : elle arrive d'un coup, une fois l'objet
// complet validé contre le schéma. Plus rien ne tient donc la connexion ouverte
// pendant la génération. Mesuré sur le plus gros cas (2 morceaux, 887 226
// caractères), la génération tient largement sous la minute.
//
// La dépense reste bornée par le rate-limit à 10 requêtes/heure/IP et par le
// plafond du site (PLAFOND_GENERATIONS_JOUR). Un lecteur qui attend le verrou d'un
// autre reste jusqu'à deux minutes à relire la base toutes les 3 s : c'est le prix
// d'une seule génération au lieu de N.

const SCHEMA = jsonSchema<ResumeLoiIa>(SCHEMA_RESUME_LOI);

/** Durée pendant laquelle un PDF sans texte est refusé sans être retéléchargé. */
const DUREE_REFUS_PDF_S = 7 * 24 * 3600;
/** Valeur du refus d'un PDF qui ne se lit pas, et sa durée : voir POST. */
const PDF_ABIME = 'abime';
const DUREE_REFUS_PDF_ABIME_S = 3600;

const ALLOWED_HOSTNAMES = new Set([
  'www.assemblee-nationale.fr',
  'assemblee-nationale.fr',
  'www.senat.fr',
  'senat.fr',
  'www.legifrance.gouv.fr',
  'legifrance.gouv.fr',
]);

/**
 * PDF dont rien ne sort. La fonction rendait une phrase (« Texte PDF non
 * extractible… ») qui devenait le texte à résumer : le modèle, qui n'avait que le
 * titre, écrivait un résumé, et il partait en cache. `definitif` sépare le PDF
 * lu mais sans texte (un scan : chaque essai rendra le même vide) du PDF qui ne
 * se lit pas (un téléchargement abîmé peut passer au suivant).
 */
class PdfIllisible extends Error {
  constructor(readonly definitif: boolean) {
    super(definitif ? 'PDF sans texte extractible' : 'PDF illisible');
  }
}

/**
 * Télécharge le texte source d'un document parlementaire et en extrait le texte brut
 * (HTML ou PDF). Appelée par POST quand le texte n'a pas de contenu Légifrance stocké.
 * Lève PdfIllisible sur un PDF dont aucun texte ne sort.
 */
async function fetchAndExtractText(lien: string): Promise<string> {
  const response = await fetch(lien, {
    // Le délai couvre aussi la lecture du corps, pas seulement l'arrivée des en-têtes.
    // L'Assemblée sert certains rapports de plus de 10 Mo très lentement :
    // `RAPPANR5L17B2698-t1` (11 Mo) a mis 84 s le 2026-10-10, le même jour où
    // `RINFANR5L17B3276` (12 Mo) arrivait en 8 s. À 30 s, ces résumés échouaient en
    // 503.
    signal: AbortSignal.timeout(90_000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    },
  });
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    throw new Error('Erreur fetch du lien texte.');
  }

  if (!contentType.includes('text/html') && !contentType.includes('application/pdf') && !contentType.includes('text/plain')) {
    throw new Error('Contenu non supporté.');
  }

  if (lien.endsWith('.pdf') || contentType.includes('application/pdf')) {
    // Le corps se lit hors du `try` : un délai dépassé pendant la lecture reste un
    // TimeoutError, que POST rend en 503, et non un PDF illisible.
    const buffer = await response.arrayBuffer();
    let texte: string;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      texte = text.trim();
    } catch (pdfError) {
      const message = pdfError instanceof Error ? pdfError.message : String(pdfError);
      console.error('Erreur parse PDF:', message, 'Lien:', lien);
      throw new PdfIllisible(false);
    }
    if (!texte) {
      console.warn('PDF extrait vide pour lien:', lien);
      throw new PdfIllisible(true);
    }
    return texte;
  } else {
    // Décoder en tenant compte du charset (anciens docs Sénat peuvent être Latin-1)
    const arrayBuffer = await response.arrayBuffer();
    const charsetMatch = contentType.match(/charset=([\w-]+)/i);
    const charset = charsetMatch?.[1] ?? 'utf-8';
    const decoder = new TextDecoder(charset);
    const html = decoder.decode(arrayBuffer);
    const $ = cheerio.load(html);

    // Pages Sénat : sélecteurs précis pour éviter nav/sidebar
    const hostname = new URL(lien).hostname;
    if (hostname.includes('senat.fr')) {
      const contenu = $('[id="formCorrection:contenu"]');
      if (contenu.length > 0) {
        return contenu.text().replace(/\s+/g, ' ').trim();
      }
      const cols = $('.col-md-8');
      if (cols.length >= 2) {
        return $(cols.get(1)!).text().replace(/\s+/g, ' ').trim();
      }
    }

    return $('body').text().replace(/\s+/g, ' ').trim();
  }
}

/** Position juste après la dernière fin de phrase de la fenêtre, ou -1. */
function finDePhrase(fenetre: string): number {
  const re = /[.!?…]["»']?\s/g;
  let position = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fenetre)) !== null) position = m.index + m[0].length;
  return position;
}

/** Recoupe sur les fins de phrase un morceau qui dépasse encore la limite. */
function recouperSurPhrases(morceau: string, maxChars: number): string[] {
  const morceaux: string[] = [];
  let reste = morceau;
  while (reste.length > maxChars) {
    const coupe = finDePhrase(reste.slice(0, maxChars));
    const n = coupe > 0 ? coupe : maxChars;
    morceaux.push(reste.slice(0, n).trim());
    reste = reste.slice(n);
  }
  if (reste.trim()) morceaux.push(reste.trim());
  return morceaux;
}

/**
 * Découpe sur les sauts de paragraphe, puis recoupe ce qui dépasse encore.
 *
 * La première passe ne sait couper qu'entre deux paragraphes : sur un texte qui
 * n'en a pas (du HTML scrapé puis aplati par `fetchAndExtractText`, ou un PDF
 * rendu d'un bloc), elle rend un morceau unique de la taille du texte entier, et
 * l'envoie tel quel. Le défaut ne se voyait nulle part : pas d'erreur, un résumé
 * fabriqué en un seul appel, et un cache valide par-dessus.
 *
 * La seconde passe ne touche QUE les morceaux au-dessus de la limite. Pour tout
 * texte correctement découpé elle est l'identité, vérifié sur les 551 lignes de
 * `textes` qui portent un contenu stocké : une seule est concernée.
 */
function splitIntoChunks(text: string, maxChars: number, uid?: string): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks.flatMap((c) => {
    if (c.length <= maxChars) return [c];
    console.warn(`splitIntoChunks : morceau de ${c.length} caractères sans saut de paragraphe, recoupé sur les phrases. uid=${uid ?? 'inconnu'}`);
    return recouperSurPhrases(c, maxChars);
  });
}

/** Ligne de `textes` lue par POST : le texte à résumer et son cache, dans les deux langues. */
type LigneTexte = {
  uid: string;
  dossier_ref: string | null;
  chambre: string | null;
  type_libelle: string | null;
  statut_adoption: string | null;
  lien_texte: string | null;
  contenu_legifrance: string | null;
  titre_principal_court: string | null;
  denomination: string | null;
  resume_ia: string | null;
  resume_ia_en: string | null;
  resume_ia_prompt_version: string | null;
  resume_ia_prompt_version_en: string | null;
};

// Les erreurs rendent un code stable, jamais une phrase : la route ne connaît pas
// la langue du lecteur. Le client n'en lit d'ailleurs que le statut HTTP
// (`useAiErrorStatus`), d'où l'absence de ces codes dans le namespace `errors`.
// 400 et 404 y valent refus définitif, affiché sans bouton Réessayer : un échec
// passager doit rendre 500 ou 503.
export async function POST(request: NextRequest) {
  // Arrivée de la requête : l'attente d'un verrou se compte depuis elle.
  const recuA = Date.now();
  // Verrou de génération de ce texte, levé à la sortie quelle qu'elle soit.
  let verrou: VerrouIa | null = null;
  try {
    const raw = await request.json();

    // Parse useCompletion payload (prompt est un JSON stringifié).
    let texte_uid: string | undefined;
    let locale: string = 'fr';

    if (typeof raw.prompt === 'string') {
      try {
        const parsed = JSON.parse(raw.prompt);
        texte_uid = parsed.texte_uid;
        locale = parsed.locale || 'fr';
      } catch {
        return NextResponse.json({ error: 'invalidBody' }, { status: 400 });
      }
    } else {
      texte_uid = raw.texte_uid;
      locale = raw.locale || 'fr';
    }

    if (!texte_uid || typeof texte_uid !== 'string') {
      return NextResponse.json({ error: 'texteUidMissing' }, { status: 400 });
    }

    // Normalise locale: only 'en' or 'fr' accepted.
    if (locale !== 'en') locale = 'fr';

    // Lookup server-side — dérive lien, contenu et cache depuis la DB.
    // Une panne de lecture n'est pas une absence : le client lit 404 comme un
    // refus définitif, sans bouton Réessayer. `auPlusUneLigne` sépare les deux
    // cas : aucune ligne rend null, une panne lève.
    let row: LigneTexte | null;
    try {
      row = await auPlusUneLigne(sql<LigneTexte[]>`
        select uid, dossier_ref, chambre, type_libelle, statut_adoption, lien_texte, contenu_legifrance,
               titre_principal_court, denomination, resume_ia, resume_ia_en, resume_ia_prompt_version,
               resume_ia_prompt_version_en
        from textes
        where uid = ${texte_uid}
      `, 'textes');
    } catch {
      return NextResponse.json({ error: 'texteLoadFailed' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'texteNotFound' }, { status: 404 });
    }

    // Une colonne de texte ET une colonne de version par langue. Les deux hashs
    // diffèrent par construction (les prompts ne sont pas les mêmes chaînes) :
    // avec une version partagée, consulter en anglais invalidait le français, et
    // réciproquement, indéfiniment.
    const cacheColumn = locale === 'en' ? 'resume_ia_en' : 'resume_ia';
    const versionColumn = locale === 'en' ? 'resume_ia_prompt_version_en' : 'resume_ia_prompt_version';
    const promptVersion = getPromptVersion(locale);
    const cached = row[cacheColumn];
    const cachedVersion = row[versionColumn];

    // Service du cache si prompt inchangé — évite la consommation d'un slot rate-limit.
    if (cached && cachedVersion === promptVersion) {
      return cachedTextResponse(cached);
    }

    const lien: string | null = row.lien_texte;
    const contenu_legifrance: string | null = row.contenu_legifrance;
    const titre_texte: string = row.titre_principal_court || row.denomination || 'Titre inconnu';

    if (!lien && !contenu_legifrance) {
      return NextResponse.json({ error: 'texteUnavailable' }, { status: 400 });
    }

    // Une génération à la fois par texte et par langue. Le lecteur qui trouve le
    // verrou attend le résumé du premier, sans passer par la limite horaire ; c'est
    // aussi ce que trouve un lecteur revenu sur un texte dont il avait abandonné la
    // génération. Deux lectures par relecture, et non une : la colonne de texte
    // peut porter un résumé d'une autre version, plusieurs Ko, qu'il serait
    // inutile de rapatrier toutes les 3 s.
    const attente = await attendreOuPrendreVerrouIa(
      `${PREFIXE_IA}verrou:loi:${texte_uid}:${locale}`,
      async () => {
        // Les noms de colonne viennent des deux paires fermées plus haut : `sql()` les
        // écrit en identifiants, jamais en texte collé.
        const data = await auPlusUneLigne(
          sql<Record<string, string | null>[]>`select ${sql(versionColumn)} from textes where uid = ${texte_uid}`,
          'textes (version du résumé)',
        );
        if (data?.[versionColumn] !== promptVersion) return null;
        const ligne = await auPlusUneLigne(
          sql<Record<string, string | null>[]>`select ${sql(cacheColumn)} from textes where uid = ${texte_uid}`,
          'textes (résumé)',
        );
        return ligne?.[cacheColumn] ?? null;
      },
      recuA,
    );
    if ('resume' in attente) return cachedTextResponse(attente.resume);
    if ('delaiDepasse' in attente) return NextResponse.json({ error: 'timeout' }, { status: 503 });
    verrou = attente.verrou;

    // Un PDF sans texte n'a pas de résumé à mettre en cache : sans ce refus mémorisé,
    // chaque vue le retéléchargeait (jusqu'à 90 s pour un gros fichier) et retirait
    // une place de la limite horaire du lecteur, pour finir en 400. Les deux langues
    // partagent le refus, c'est le même fichier. Sept jours, pour qu'un PDF remplacé
    // à la source finisse par être relu ; un contenu Légifrance arrivé entre-temps
    // passe avant, ce refus ne visant que le lien. Lu après le verrou : un lecteur
    // qui attendait le reçoit dès que le tenant l'a écrit, sans retélécharger.
    // Un PDF qui ne se lit pas est retenu aussi, une heure seulement et en 500 :
    // un fichier corrompu à la source ne se retélécharge pas à chaque clic sur
    // Réessayer, et un téléchargement abîmé se retente après l'heure.
    //
    // Plafond du site atteint : refus avant la limite horaire du lecteur, qu'un
    // résumé impossible n'a pas à entamer. Il n'est compté que plus bas.
    const clePdfIllisible = `${PREFIXE_IA}pdf-illisible:${texte_uid}`;
    const [refusPdf, plafondAtteint] = await Promise.all([
      contenu_legifrance ? null : redis.get<string>(clePdfIllisible),
      plafondIaAtteint(),
    ]);
    if (refusPdf !== null) {
      return NextResponse.json({ error: 'pdfUnreadable' }, { status: refusPdf === PDF_ABIME ? 500 : 400 });
    }
    if (plafondAtteint) {
      return NextResponse.json({ error: 'aiQuotaExhausted' }, { status: 403 });
    }

    // Rate-limit après le cache et après le refus d'un texte sans contenu : seuls les
    // vrais appels au modèle consomment un slot. Décompté avant ce refus, chaque clic
    // sur « Réessayer » d'une loi parue le jour même, encore sans texte, retirait un
    // des dix résumés de l'heure sans rien produire.
    const limited = await enforceAiRateLimit(request);
    if (limited) return limited;

    // Priorité au contenu Légifrance pré-stocké (évite le fetch URL fragile).
    let texteComplet = '';

    if (contenu_legifrance) {
      texteComplet = contenu_legifrance;
    } else if (lien) {
      // SSRF mitigation : vérifier le hostname avant tout fetch.
      let hostname: string;
      try {
        hostname = new URL(lien).hostname;
      } catch {
        return NextResponse.json({ error: 'invalidUrl' }, { status: 400 });
      }
      if (!ALLOWED_HOSTNAMES.has(hostname)) {
        return NextResponse.json({ error: 'sourceNotAllowed' }, { status: 400 });
      }
      try {
        texteComplet = await fetchAndExtractText(lien);
      } catch (e) {
        // Rien en cache, aucun appel au modèle. 400 pour un PDF sans texte, mémorisé
        // plus haut : la carte l'affiche comme indisponible, sans bouton Réessayer.
        // 500 pour un PDF qui ne se lit pas, qu'un second essai peut lire.
        if (e instanceof PdfIllisible) {
          if (e.definitif) await redis.set(clePdfIllisible, '1', { ex: DUREE_REFUS_PDF_S });
          else await redis.set(clePdfIllisible, PDF_ABIME, { ex: DUREE_REFUS_PDF_ABIME_S });
          return NextResponse.json({ error: 'pdfUnreadable' }, { status: e.definitif ? 400 : 500 });
        }
        throw e;
      }
    }

    if (!texteComplet) {
      return NextResponse.json({ error: 'texteUnreadable' }, { status: 500 });
    }

    // Étape du texte pour les trois gabarits (voir ETAPE_RESUME_LOI dans lib/prompts).
    // La lecture se lit dans les actes qui citent ce texte, pas dans `textes` qui ne
    // la porte pas. Sur les 251 textes déjà résumés, aucun n'est cité par deux
    // lectures différentes. Une lecture en échec lève : un résumé écrit sans son
    // étape serait mis en cache comme les autres.
    // L'uid du texte part en paramètre, y compris dans le tableau du `@>` : il n'est
    // jamais collé dans le texte de la requête. `uid` départage deux actes du même
    // jour, dont l'ordre était sinon celui du plan d'exécution.
    const actes = row.dossier_ref
      ? await sql<{ code_acte: string }[]>`
          select code_acte
          from actes_legislatifs
          where dossier_uid = ${row.dossier_ref}
            and (textes_associes @> ${[row.uid]}::text[] or texte_adopte = ${row.uid})
          order by date_acte, uid
        `
      : [];
    const etape_texte = decrireEtapeResumeLoi(locale, {
      codesActes: actes.map((a) => a.code_acte),
      chambre: row.chambre,
      type: row.type_libelle,
      statutAdoption: row.statut_adoption,
    });

    // Plafond du site, compté ici, juste avant le premier appel au modèle : un texte
    // illisible ou une panne de lecture n'entament pas les générations du jour. Le
    // client affiche 403 comme un service IA indisponible.
    if (!(await consommerPlafondIa())) {
      console.warn(`Plafond quotidien des générations IA atteint, résumé non lancé pour ${texte_uid}`);
      return NextResponse.json({ error: 'aiQuotaExhausted' }, { status: 403 });
    }

    // Chunking : textes courts → appel direct ; textes longs → MAP parallèle + REDUCE.
    const chunks = splitIntoChunks(texteComplet, MAX_CHARS_PER_CHUNK_RESUME_LOI, texte_uid);

    let userPrompt: string;

    if (chunks.length <= 1) {
      userPrompt = remplirGabarit(getUserPromptTemplate(locale), {
        etape_texte,
        titre_texte,
        texteComplet: chunks[0] ?? texteComplet,
      });
    } else {
      // Chaque extraction est reprise pour son propre compte. Un morceau qui ne
      // passe pas malgré les reprises, ou dont l'extraction est coupée par le
      // plafond de jetons, fait échouer toute la requête : mieux vaut une erreur
      // affichée qu'un résumé amputé d'un tiers du texte, mis en cache et servi
      // comme complet.
      const mapResults = await Promise.all(
        chunks.map((chunk, i) =>
          avecReprises(() => generateText({
            model: modeleIA(MODEL_RESUME_LOI),
            system: getSystemPromptResumeLoiMap(locale),
            prompt: remplirGabarit(getUserPromptTemplateResumeLoiMap(locale), {
              chunk_index: String(i + 1),
              chunk_total: String(chunks.length),
              titre_texte,
              etape_texte,
              texteChunk: chunk,
            }),
            ...PARAMS_RESUME_LOI_MAP,
            ...REPRISES_SDK_DESACTIVEES,
            providerOptions: optionsIA(PARAMS_RESUME_LOI_MAP.reasoningEffort),
          }), DELAIS_REPRISE_WEB).then(r => texteNonTronque(r, `${texte_uid} morceau ${i + 1}/${chunks.length}`))
        )
      );
      userPrompt = remplirGabarit(getUserPromptTemplateResumeLoiReduce(locale), {
        titre_texte,
        etape_texte,
        dispositions_extraites: mapResults.join('\n\n---\n\n'),
      });
    }

    // Le schéma voyage dans le corps de la requête, hors des messages : le modèle
    // ne peut plus rendre autre chose qu'un objet conforme. C'est ce qui referme
    // par construction la classe de bug des titres markdown enrobés de gras.
    //
    // Repris lui aussi : c'est l'appel dont l'échec coûte le plus cher, puisqu'il
    // vient après les extractions déjà payées.
    const { object } = await avecReprises(() => generateObject({
      model: modeleIA(MODEL_RESUME_LOI),
      schema: SCHEMA,
      system: getSystemPrompt(locale),
      prompt: userPrompt,
      ...PARAMS_RESUME_LOI,
      ...REPRISES_SDK_DESACTIVEES,
      providerOptions: optionsIA(PARAMS_RESUME_LOI.reasoningEffort),
    }), DELAIS_REPRISE_WEB);
    const resume = JSON.stringify(object);

    // L'écriture du cache sort de `onFinish`, qui n'existe pas sur generateObject.
    //
    // `sql` lève sur toute erreur (panne réseau, conflit de type, colonne absente) :
    // le `catch` journalise sans faire échouer la requête, le résumé est déjà
    // généré et payé, il part au lecteur juste en dessous. Qui remarquerait sinon
    // un cache jamais écrit : la facture IA, des semaines plus tard, chaque visite
    // régénérant le résumé.
    try {
      await sql`
        update textes set ${sql({
          [cacheColumn]: resume,
          [versionColumn]: promptVersion,
          resume_ia_created_at: new Date().toISOString(),
        })}
        where uid = ${texte_uid}
      `;
    } catch (e) {
      const erreurCache = e as { code?: string; message?: string };
      console.error(`Cache resume_ia non écrit pour ${texte_uid} : ${erreurCache.code} ${erreurCache.message}`);
    }

    // Même helper que le service du cache : les deux chemins parlent le protocole
    // que `useCompletion` attend, transport et client restent inchangés.
    return cachedTextResponse(resume);
  } catch (error) {
    const err = error as { message?: string; name?: string } | null;
    console.error('Erreur génération résumé:', err?.message || error || 'Erreur inconnue');
    if (err?.name === 'TimeoutError') {
      return NextResponse.json({ error: 'timeout' }, { status: 503 });
    }
    // Crédits IA épuisés : le client l'annonce autrement qu'une panne générique.
    if (estQuotaEpuise(error)) {
      return NextResponse.json({ error: 'aiQuotaExhausted' }, { status: 403 });
    }
    // Limite de débit du fournisseur, encore là après les reprises : le client
    // affiche un compte à rebours de `Retry-After` secondes au lieu d'une panne.
    const delai = delaiLimiteDebit(error);
    if (delai !== null) {
      return NextResponse.json({ error: 'ai_busy' }, { status: 429, headers: { 'Retry-After': String(delai) } });
    }
    return NextResponse.json({ error: 'serverError' }, { status: 500 });
  } finally {
    if (verrou) await rendreVerrouIa(verrou);
  }
}
