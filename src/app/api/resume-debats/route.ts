// API : synthèse IA des débats parlementaires pour un dossier législatif.
// Appelée par la carte des arguments de la fiche dossier (ArgumentsPourContre).
// Pipeline map-reduce :
//   1. Filtrage des interventions procédurales / bruit
//   2. MAP  : extraction des arguments séance par séance (markdown, jamais parsé :
//      cette sortie ne sert que d'entrée au REDUCE). Toujours en français, pour
//      les deux langues, et gardée par partie de séance dans `debat_extractions`.
//   3. REDUCE : synthèse finale en JSON contraint par schéma → 8 pour et 8 contre au plus,
//      dont les groupes absents des en-têtes du dossier sont ensuite retirés
// Deux niveaux de cache :
//   • l'extraction, sous la clé sha256(VERSION_EXTRACTION_DEBATS + titre + texte de
//     la partie) : seule une séance neuve, ou corrigée par la chambre, est relue.
//     Les groupes de ses en-têtes sont ceux du jour de la séance, qui ne bougent pas
//     quand un orateur change de groupe (voir etiquetteGroupe).
//     Le titre du dossier est dans la clé, puisque le modèle le lit : un dossier
//     renommé fait relire toutes ses séances. Après une synthèse réussie en
//     production, les lignes du dossier qu'elle n'a pas lues sont supprimées :
//     ancienne version de prompt ou de modèle, séance corrigée, titre changé ;
//   • la synthèse, par langue, dans `dossiers_legislatifs`, servie telle quelle si
//     sa version (getPromptVersionDebats) et le hash du compte rendu complet
//     (resume_debats_hash_source, ou _en) de sa langue sont inchangés.
//     Ce hash demande de relire tout le débat (environ 12 Mo
//     pour le PLF 2026) : une empreinte légère, calculée par Postgres
//     (`empreinte_debats`) et rangée avec la synthèse (resume_debats_empreinte, ou
//     _en), est comparée d'abord. Identique, la synthèse part sans rien relire.
//     Cette empreinte est lue dans `dossier_debats_cache`, pré-calculée chaque nuit
//     (étape `cache-debats`) ; `empreinte_debats` n'est appelée qu'à défaut de ligne.
// Le résumé suit le débat pendant qu'il a lieu : une séance ajoutée coûte sa
// seule extraction plus une synthèse. Tant que la nouvelle synthèse ne peut pas
// se faire, la précédente reste servie.

import { NextRequest, NextResponse } from 'next/server';
import { generateObject, generateText, jsonSchema } from 'ai';
import { modeleIA, optionsIA } from '@/lib/ai-provider';
import { createHash } from 'crypto';
import {
  SYSTEM_PROMPT_DEBATS_MAP,
  USER_PROMPT_TEMPLATE_DEBATS_MAP,
  VERSION_EXTRACTION_DEBATS,
  getSystemPromptDebatsReduce,
  getUserPromptTemplateDebatsReduce,
  getPromptVersionDebats,
  remplirGabarit,
  PARAMS_DEBATS_MAP,
  PARAMS_DEBATS_REDUCE,
  MODEL_RESUME_DEBATS,
  MAX_CHARS_PER_CHUNK_DEBATS,
} from '@/lib/prompts';
import { auPlusUneLigne, sql } from '@/lib/db';
import { lecteurDeTextes } from '@/lib/debats-texte';
import { lecteurDeGroupes, type GroupeOrgane } from '@/lib/groupe-au-jour';
import { attendreOuPrendreVerrouIa, consommerPlafondIa, enforceAiRateLimit, plafondIaAtteint, PREFIXE_IA, prendreVerrouIa, rendreVerrouIa, type VerrouIa } from '@/lib/rate-limit';
import { SCHEMA_RESUME_DEBATS, type ResumeDebatsIa } from '@/lib/ai-schemas';
import { cachedTextResponse } from '@/lib/resume-ai-stream';
import { avecReprises, DELAIS_REPRISE_WEB, delaiLimiteDebit, estQuotaEpuise, REPRISES_SDK_DESACTIVEES, texteNonTronque } from '@/lib/ai-retry';

// La synthèse ne streame plus : rien ne tient la connexion ouverte pendant la
// génération. Mesuré sur le PLF 2026 (13 morceaux, 6,4 M caractères de verbatim),
// le pire cas complet tenait en 68 s. C'était avant l'extraction par séance, qui
// fait jusqu'à une cinquantaine d'appels à la première génération d'un gros
// dossier : ce temps-là n'est pas mesuré. Les extractions déjà écrites restent :
// si la requête s'interrompt, la suivante reprend là.
//
// Les reprises allongent ce pire cas sans le dire : un morceau rejoué deux fois
// ajoute ses deux délais ET ses deux appels. La dépense reste bornée par le
// rate-limit à 10 requêtes/heure/IP et par le plafond du site
// (PLAFOND_GENERATIONS_JOUR). Un lecteur qui attend le verrou d'un autre reste
// jusqu'à deux minutes à relire la base toutes les 3 s, et seulement quand aucune
// synthèse précédente ne peut lui être servie.

const SCHEMA = jsonSchema<ResumeDebatsIa>(SCHEMA_RESUME_DEBATS);

/** Plafond d'appels IA simultanés dans la phase map. Le plus gros dossier compte
 *  52 séances : toutes lancées d'un coup, elles déclenchent des 429 et perdent le
 *  résumé. */
const MAX_APPELS_IA_PARALLELES = 8;

/**
 * Version du verbatim, mêlée à l'empreinte légère des débats. `empreinte_debats`
 * ne voit que les données lues en base : un changement de code qui modifie le
 * verbatim (formatInterventions, etiquetteGroupe et QUALITE_GOUVERNEMENT, le
 * filtre procédural, la mise en forme des lignes dans POST, `groupeAuJour`,
 * `lecteurDeTextes`) laisserait servir sans relecture les synthèses faites sur
 * l'ancien format. L'incrémenter dans le même commit fait relire chaque dossier
 * une fois, ce qui réécrit les empreintes : le hash de la source décide ensuite,
 * comme avant, s'il faut régénérer.
 *
 * Une constante plutôt qu'une signature calculée sur le texte des fonctions :
 * le bundle les réécrit autrement en développement, en preview et en
 * production, et parfois d'un déploiement à l'autre sans que ce code change.
 * Chaque écart aurait fait relire tous les dossiers.
 */
const VERSION_EMPREINTE_DEBATS = 1;

/**
 * Seule la production range une empreinte. L'app d'essai et les serveurs locaux
 * écrivent dans la même base, parfois avec un autre format de verbatim sous la même
 * VERSION_EMPREINTE_DEBATS : une empreinte rangée par eux ferait servir leur
 * synthèse à la production sans que le hash de la source ne la vérifie. Ailleurs,
 * une synthèse neuve s'écrit avec une empreinte nulle, que la production revérifie.
 * `SITE_ENV=production` n'est posée que dans l'app Coolify de production.
 */
const EST_PRODUCTION = process.env.SITE_ENV?.trim() === 'production';
const RANGE_EMPREINTE = EST_PRODUCTION;

type InterventionRow = {
  id: number;
  ordre: number;
  seance_uid: string;
  orateur_nom: string | null;
  orateur_qualite: string | null;
  acteur_uid: string | null;
  texte: string;
  seance: { chambre: string; date_seance: string; texte_hash: string | null } | null;
  acteur: { nom: string | null; prenom: string | null; groupe: GroupeOrgane | null } | null;
};

// Mots-clés typiques des interventions procédurales du président de séance.
// Les changer, ou isProceduralIntervention, change le verbatim : incrémenter
// VERSION_EMPREINTE_DEBATS.
const PROCEDURAL_PATTERNS = [
  /^la parole est à/i,
  /^l['']amendement n[°o]/i,
  /^je mets aux voix/i,
  /^le scrutin est /i,
  /^il est ainsi /i,
  /^la séance est /i,
  /^je suis saisi/i,
  /^quel est l['']avis /i,
  /^la commission a /i,
  /^je vous prie de /i,
];

function isProceduralIntervention(row: InterventionRow): boolean {
  const texte = row.texte?.trim() ?? '';
  // Interventions trop courtes (< 100 chars) — souvent procédurales ou exclamations
  if (texte.length < 100) return true;
  // Didascalies
  if (row.orateur_qualite === 'didascalie') return true;
  // Président de séance : interventions qui commencent par un pattern procédural
  if (row.orateur_qualite?.toLowerCase().includes('président')) {
    for (const pattern of PROCEDURAL_PATTERNS) {
      if (pattern.test(texte)) return true;
    }
  }
  return false;
}

// Qualité d'un membre du Gouvernement dans `debat_interventions.orateur_qualite`.
// Relevé le 2026-09-14 sur toutes les qualités contenant « ministre »,
// « secrétaire d'État » ou « garde des sceaux » : toutes commencent par l'un de
// ces libellés (« ministre délégué… », « garde des sceaux, ministre de la
// justice », « Premier ministre. », les deux apostrophes), et aucune qualité de
// rapporteur ou de président de commission ne s'y trouve. Deux formes s'ajoutent,
// alignées sur le filtre SQL de `recalc_nb_prises_parole` pour que score et
// synthèse traitent les mêmes orateurs : « Première ministre », et « secrétaire d »
// seul, tronqué dans les comptes rendus du Sénat.
const QUALITE_GOUVERNEMENT = /^(premi[eè]re? ministre|ministre|garde des sceaux|secr[ée]taire d(['’]\s*[ée]tat|\s*$))/i;

// Étiquette d'un orateur dont on ne connaît pas le groupe. Les prompts la
// nomment : le modèle la rend par « Sans groupe », que la synthèse n'affiche pas.
const SANS_GROUPE = 'sans groupe connu';

/**
 * Étiquette de groupe de l'en-tête d'une intervention. Appelée pour chaque
 * en-tête par formatInterventions, et pour la liste des groupes autorisés de
 * la synthèse : les deux doivent rester identiques.
 *
 * Un membre du Gouvernement porte « Gouvernement » à la place du groupe : un
 * ministre n'a en général plus de groupe ce jour-là, et le groupe d'un élu ne dit
 * pas qu'il parle au banc du Gouvernement. Mesuré le 2026-09-14, quand l'en-tête
 * portait encore le groupe actuel, sur les 8 713 interventions ministérielles :
 * 7 687 partaient sans groupe, rien ne disant au modèle qui parlait, et 1 026 sous
 * le groupe parlementaire que l'orateur avait alors.
 *
 * Le groupe d'un orateur est celui du jour de la séance (`lecteurDeGroupes`), pas
 * son groupe actuel : l'en-tête entre dans les clés de cache, et un changement de
 * groupe d'aujourd'hui ne doit ni réécrire un débat passé ni faire relire ses séances.
 *
 * Au Sénat, une intervention sans orateur relié ni qualité vient d'un membre du
 * Gouvernement. Relevé le 2026-10-01 : sur 10 014, 10 004 portent le nom d'un
 * acteur qui n'est pas sénateur, et les 10 autres un nom qu'aucun acteur ne
 * porte. Sans étiquette, le modèle devinait le groupe.
 *
 * Toute modification change le verbatim : incrémenter VERSION_EMPREINTE_DEBATS.
 */
function etiquetteGroupe(r: InterventionRow): string {
  if (QUALITE_GOUVERNEMENT.test(r.orateur_qualite?.trim() ?? '')) return 'Gouvernement';
  const groupe = r.acteur?.groupe?.libelle_abrege ?? r.acteur?.groupe?.libelle;
  if (groupe) return groupe;
  if (r.seance?.chambre === 'SEN' && !r.acteur_uid && !r.orateur_qualite?.trim()) return 'Gouvernement';
  return SANS_GROUPE;
}

/**
 * Assemble le verbatim envoyé au modèle, une intervention par bloc, précédée
 * de l'en-tête [Date · Chambre · Orateur · Groupe] que décrivent les prompts,
 * le groupe venant d'etiquetteGroupe. Toute modification du format change le
 * hash de la source et la clé de chaque extraction : elle fait donc relire
 * toutes les séances, puis régénère les synthèses. L'empreinte légère ne la voit
 * pas : incrémenter VERSION_EMPREINTE_DEBATS dans le même commit.
 */
function formatInterventions(rows: InterventionRow[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    const date = r.seance?.date_seance ?? '';
    const chambre = r.seance?.chambre === 'SEN' ? 'Sénat' : 'Assemblée';
    const nom = r.acteur
      ? `${r.acteur.prenom ?? ''} ${r.acteur.nom ?? ''}`.trim()
      : r.orateur_nom ?? 'Intervenant';
    const header = `[${date} · ${chambre} · ${nom} · ${etiquetteGroupe(r)}]`;
    lines.push(`${header}\n${r.texte.trim()}`);
  }
  return lines.join('\n\n');
}

/**
 * Découpe le verbatim d'une séance en chunks de maxChars, en coupant sur les séparations entre interventions.
 *
 * Homonyme de la fonction de `resume-loi/route.ts`, et volontairement différente :
 * les fusionner ferait qu'une modification changerait le résultat des deux
 * produits sans qu'aucun des deux hashs de version ne bouge.
 *
 * Celle-ci n'a pas besoin de la seconde passe qui recoupe sur les fins de phrase.
 * Son entrée n'est pas un texte scrapé mais un verbatim que `formatInterventions`
 * assemble en joignant les interventions par `\n\n` : les points de coupe sont
 * garantis par construction, et la plus longue intervention de la base fait
 * 27 765 caractères, dix-huit fois sous la limite. Si le format d'assemblage
 * changeait, il faudrait reprendre ce raisonnement.
 */
function splitIntoChunks(verbatim: string, maxChars: number): string[] {
  if (verbatim.length <= maxChars) return [verbatim];

  const blocks = verbatim.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    const candidate = current ? current + '\n\n' + block : block;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Les erreurs rendent un code stable, jamais une phrase : la route ne connaît pas
// la langue du lecteur. Le client n'en lit d'ailleurs que le statut HTTP
// (`useAiErrorStatus`), d'où l'absence de ces codes dans le namespace `errors`.
// 400 et 404 y valent refus définitif, affiché sans bouton Réessayer : un échec
// passager doit rendre 500 ou 503.
export async function POST(request: NextRequest) {
  // Arrivée de la requête : l'attente d'un verrou se compte depuis elle.
  const recuA = Date.now();
  // Synthèse de la même version de prompt, faite sur un compte rendu plus ancien
  // d'une ou plusieurs séances. Servie quand la nouvelle ne peut pas se faire
  // (quota horaire atteint, génération en échec) : un résumé en retard d'une
  // séance vaut mieux qu'une carte vide. Une synthèse d'une autre version n'y a
  // pas droit, son format peut ne plus être celui qu'attend la carte.
  let precedente: string | null = null;
  // Verrou de génération de ce dossier, levé à la sortie quelle qu'elle soit.
  let verrou: VerrouIa | null = null;
  try {
    const raw = await request.json();
    let dossier_uid: string | undefined = raw.dossier_uid;
    let locale: string = raw.locale || 'fr';

    if (typeof raw.prompt === 'string') {
      try {
        const parsed = JSON.parse(raw.prompt);
        dossier_uid = parsed.dossier_uid || dossier_uid;
        locale = parsed.locale || locale;
      } catch {
        return NextResponse.json({ error: 'invalidBody' }, { status: 400 });
      }
    }

    if (!dossier_uid || typeof dossier_uid !== 'string' || dossier_uid.trim() === '' || dossier_uid.length > 200) {
      return NextResponse.json({ error: 'dossierUidInvalid' }, { status: 400 });
    }
    if (locale !== 'en') locale = 'fr';

    // Une colonne de texte, de version ET d'empreinte de source par langue : voir
    // le commentaire jumeau dans api/resume-loi/route.ts pour la version. Une
    // empreinte partagée laissait passer le résumé d'une langue fait sur l'ancien
    // compte rendu, dès que l'autre langue avait été regénérée sur le nouveau.
    // L'empreinte légère suit la même règle, pour la même raison.
    const cacheColumn = locale === 'en' ? 'resume_debats_ia_en' : 'resume_debats_ia';
    const versionColumn = locale === 'en' ? 'resume_debats_prompt_version_en' : 'resume_debats_prompt_version';
    const hashColumn = locale === 'en' ? 'resume_debats_hash_source_en' : 'resume_debats_hash_source';
    const empreinteColumn = locale === 'en' ? 'resume_debats_empreinte_en' : 'resume_debats_empreinte';

    // Le dossier et le cache existant, de la seule langue demandée (les deux
    // synthèses partaient à chaque vue, soit le double du nécessaire), et
    // l'empreinte légère des débats, en parallèle.
    // L'empreinte est lue AVANT les interventions : si l'import écrit entre les
    // deux lectures, l'empreinte rangée plus bas est l'ancienne, et la vue suivante
    // relit le débat. L'ordre inverse rangerait la nouvelle empreinte à côté d'une
    // synthèse vérifiée sur l'ancien débat, qui ne serait plus jamais refaite.
    //
    // L'empreinte vient d'abord du pré-calcul de la nuit (`dossier_debats_cache`, une
    // ligne), et seulement à défaut de `empreinte_debats` : sur le PLF 2026, la
    // fonction relit 38 000 interventions (160 à 500 ms), et deux fiches lues en même
    // temps pouvaient dépasser le délai de 8 s du rôle de la clé de service. Le
    // pré-calcul date de la dernière étape `cache-debats` réussie. Une empreinte plus
    // ancienne que le débat est le sens sûr (voir ci-dessus), mais le débat n'est
    // relu qu'à la première vue après le prochain `cache-debats` : jusqu'à 24 h après
    // l'import, plus par nuit ratée. Une synthèse refaite entre-temps est rangée avec
    // l'ancienne empreinte et revérifiée ensuite sans appel IA.
    //
    // Rend l'empreinte brute (md5), ou null si la fonction n'en rend pas ou échoue.
    // Une panne de la fonction ne coûte que le chemin long : rien n'est servi sur
    // sa foi, et null s'écrit avec une synthèse neuve. Les noms de colonne viennent
    // des quatre paires fermées plus haut : `sql()` les écrit en identifiants.
    const empreinteDuDossier = async (): Promise<string | null> => {
      try {
        const precalcul = await auPlusUneLigne(
          sql<{ empreinte: string }[]>`select empreinte from dossier_debats_cache where dossier_uid = ${dossier_uid}`,
          'dossier_debats_cache',
        );
        if (precalcul) return precalcul.empreinte;
      } catch (e) {
        const erreurCache = e as { code?: string; message?: string };
        console.error(`[resume-debats] pré-calcul des débats illisible pour ${dossier_uid} : ${erreurCache.code} ${erreurCache.message}`);
      }
      try {
        const [{ v }] = await sql<{ v: string | null }[]>`select empreinte_debats(p_dossier => ${dossier_uid}) as v`;
        return v;
      } catch (e) {
        const erreurEmpreinte = e as { code?: string; message?: string };
        console.error(`[resume-debats] empreinte non calculée pour ${dossier_uid} : ${erreurEmpreinte.code} ${erreurEmpreinte.message}`);
        return null;
      }
    };
    // `ligne: null` : aucun dossier ; `null` tout court : la lecture a échoué.
    const [lecture, md5] = await Promise.all([
      auPlusUneLigne(
        sql<Record<string, string | null>[]>`
          select uid, titre, ${sql(cacheColumn)}, ${sql(versionColumn)}, ${sql(hashColumn)}, ${sql(empreinteColumn)}
          from dossiers_legislatifs
          where uid = ${dossier_uid}
        `,
        'dossiers_legislatifs',
      ).then((l) => ({ ligne: l }), () => null),
      empreinteDuDossier(),
    ]);

    // Une panne de lecture n'est pas une absence : le client lit 404 comme un
    // refus définitif, sans bouton Réessayer. `auPlusUneLigne` sépare les deux
    // cas : aucune ligne rend null, une panne lève.
    if (!lecture) {
      return NextResponse.json({ error: 'dossierLoadFailed' }, { status: 500 });
    }
    if (!lecture.ligne) {
      return NextResponse.json({ error: 'dossierNotFound' }, { status: 404 });
    }
    const ligne = lecture.ligne;
    const promptVersion = getPromptVersionDebats(locale);
    const cached = ligne[cacheColumn];
    const cachedVersion = ligne[versionColumn];
    const cachedHash = ligne[hashColumn];

    const empreinte: string | null = typeof md5 === 'string' ? `${VERSION_EMPREINTE_DEBATS}:${md5}` : null;
    if (cached && cachedVersion === promptVersion && empreinte !== null && ligne[empreinteColumn] === empreinte) {
      return cachedTextResponse(cached);
    }

    // Toutes les interventions du dossier, en une seule requête : le plus gros en
    // compte 15 402, et le résumé doit couvrir tout le débat.
    // Le tri est déjà stable sans départage : `idx_debat_interventions_seance_ordre`
    // impose l'unicité de `(seance_uid, ordre)`. Le texte n'est pas lu ici : il est
    // remis sur chaque ligne juste après par `lecteurDeTextes`, qui contrôle l'empreinte
    // de la séance, comme le groupe de l'orateur au jour de la séance.
    // Séance et acteur sont des objets (ou null) bâtis en jsonb, la forme qu'attend
    // la suite de la route.
    let interventions: Record<string, unknown>[];
    try {
      interventions = await sql<Record<string, unknown>[]>`
        select i.id, i.ordre, i.seance_uid, i.orateur_nom, i.orateur_qualite, i.acteur_uid,
          (select jsonb_build_object('chambre', s.chambre, 'date_seance', s.date_seance, 'texte_hash', s.texte_hash)
             from debat_seances s where s.uid = i.seance_uid) as seance,
          (select jsonb_build_object('nom', a.nom, 'prenom', a.prenom)
             from acteurs a where a.uid = i.acteur_uid) as acteur
        from debat_interventions i
        where i.dossier_uid = ${dossier_uid}
        order by i.seance_uid, i.ordre
      `;
    } catch {
      return NextResponse.json({ error: 'interventionsLoadFailed' }, { status: 500 });
    }
    if (interventions.length === 0) {
      return NextResponse.json({ error: 'noInterventions' }, { status: 404 });
    }

    // Le texte est remis avant tout le reste : filtre, mise en forme, empreinte de
    // source et clés d'extraction le lisent.
    // Un texte manquant ne laisse jamais filer un résumé fait sur un débat
    // incomplet : la synthèse déjà en cache pour ce prompt est servie telle quelle,
    // ou l'appel échoue. Même chose si l'historique des groupes ne se lit pas : des
    // en-têtes sans groupe changeraient toutes les clés et feraient tout relire.
    let groupeDe: (acteurUid: string, jour: string) => GroupeOrgane | null;
    try {
      const seanceDe = (r: Record<string, unknown>) => r.seance as { texte_hash: string | null } | null;
      // Indépendantes l'une de l'autre : les deux lectures partent ensemble.
      const [texteDe, lecteur] = await Promise.all([
        lecteurDeTextes(
          interventions.map((r) => ({ uid: r.seance_uid as string, texte_hash: seanceDe(r)?.texte_hash ?? null })),
        ),
        lecteurDeGroupes(
          interventions.flatMap((r) => (typeof r.acteur_uid === 'string' ? [r.acteur_uid] : [])),
        ),
      ]);
      interventions = interventions.map((r) => ({ ...r, texte: texteDe(r.seance_uid as string, r.ordre as number) }));
      groupeDe = lecteur;
    } catch (e) {
      console.error('[resume-debats] texte des séances ou groupes des orateurs :', e);
      if (cached && cachedVersion === promptVersion) {
        return cachedTextResponse(cached);
      }
      return NextResponse.json({ error: 'interventionsLoadFailed' }, { status: 500 });
    }

    type RawInterventionRow = { seance: unknown; acteur?: unknown } & Record<string, unknown>;
    const normalized = (interventions as RawInterventionRow[]).map((r) => {
      const seance = r.seance as { date_seance?: string } | null;
      return {
        ...r,
        seance,
        acteur: r.acteur
          ? {
              ...(r.acteur as Record<string, unknown>),
              groupe: groupeDe(r.acteur_uid as string, seance?.date_seance ?? ''),
            }
          : null,
      };
    });

    // Phase 1 : Filtrage — retirer le bruit procédural
    const substantive = (normalized as unknown as InterventionRow[]).filter(r => !isProceduralIntervention(r));

    if (substantive.length === 0) {
      return NextResponse.json({ error: 'noSubstantiveInterventions' }, { status: 404 });
    }

    const verbatim = formatInterventions(substantive);
    const sourceHash = createHash('sha256').update(verbatim).digest('hex').slice(0, 16);

    // Service du cache si prompt ET source inchangés. L'empreinte légère qui a
    // manqué est alors rangée, pour que la vue suivante n'ait rien à relire. Les
    // filtres sur version et hash la posent sur cette synthèse-là, et sur aucune
    // autre qu'une requête concurrente aurait écrite entre-temps. Une écriture
    // ratée ne coûte que la relecture à la vue suivante. En production seulement
    // (voir RANGE_EMPREINTE).
    if (cached && cachedVersion === promptVersion) {
      if (cachedHash === sourceHash) {
        if (RANGE_EMPREINTE && empreinte !== null && ligne[empreinteColumn] !== empreinte) {
          try {
            await sql`
              update dossiers_legislatifs set ${sql({ [empreinteColumn]: empreinte })}
              where uid = ${dossier_uid}
                and ${sql(versionColumn)} = ${promptVersion}
                and ${sql(hashColumn)} = ${sourceHash}
            `;
          } catch (e) {
            const erreurPose = e as { code?: string; message?: string };
            console.error(`[resume-debats] empreinte non rangée pour ${dossier_uid} : ${erreurPose.code} ${erreurPose.message}`);
          }
        }
        return cachedTextResponse(cached);
      }
      precedente = cached;
    }

    // Une synthèse à la fois par dossier et par langue. Avec une synthèse
    // précédente, le lecteur qui trouve le verrou la reçoit tout de suite ; sans
    // elle, il attend celle du premier, sans passer par la limite horaire. Deux
    // lectures par relecture : voir le commentaire jumeau d'api/resume-loi.
    const cleVerrou = `${PREFIXE_IA}verrou:debats:${dossier_uid}:${locale}`;
    if (precedente) {
      verrou = await prendreVerrouIa(cleVerrou);
      if (!verrou) return cachedTextResponse(precedente);
      // Le tenant précédent a pu écrire sa synthèse et lever le verrou depuis notre
      // lecture du dossier : un hash différent de celui lu alors la signale, et elle
      // est servie au lieu d'être payée une seconde fois.
      const r = await auPlusUneLigne(
        sql<Record<string, string | null>[]>`
          select ${sql(versionColumn)}, ${sql(hashColumn)} from dossiers_legislatifs where uid = ${dossier_uid}
        `,
        'dossiers_legislatifs (version et hash)',
      );
      if (r?.[versionColumn] === promptVersion && r?.[hashColumn] !== cachedHash) {
        const l = await auPlusUneLigne(
          sql<Record<string, string | null>[]>`select ${sql(cacheColumn)} from dossiers_legislatifs where uid = ${dossier_uid}`,
          'dossiers_legislatifs (synthèse)',
        );
        const neuve = l?.[cacheColumn] ?? null;
        if (neuve) return cachedTextResponse(neuve);
      }
    } else {
      // Sans précédente, aucune synthèse de cette version n'existait : la première
      // qui s'écrit est celle que le tenant du verrou vient de faire.
      const attente = await attendreOuPrendreVerrouIa(
        cleVerrou,
        async () => {
          const data = await auPlusUneLigne(
            sql<Record<string, string | null>[]>`select ${sql(versionColumn)} from dossiers_legislatifs where uid = ${dossier_uid}`,
            'dossiers_legislatifs (version de la synthèse)',
          );
          if (data?.[versionColumn] !== promptVersion) return null;
          const l = await auPlusUneLigne(
            sql<Record<string, string | null>[]>`select ${sql(cacheColumn)} from dossiers_legislatifs where uid = ${dossier_uid}`,
            'dossiers_legislatifs (synthèse)',
          );
          return l?.[cacheColumn] ?? null;
        },
        recuA,
      );
      if ('resume' in attente) return cachedTextResponse(attente.resume);
      if ('delaiDepasse' in attente) return NextResponse.json({ error: 'timeout' }, { status: 503 });
      verrou = attente.verrou;
    }

    // Plafond du site atteint : la précédente, ou 403, avant la limite horaire du
    // lecteur, qu'une synthèse impossible n'a pas à entamer. Compté plus bas.
    if (await plafondIaAtteint()) {
      return precedente ? cachedTextResponse(precedente) : NextResponse.json({ error: 'aiQuotaExhausted' }, { status: 403 });
    }

    // Rate-limit après le cache : seuls les vrais appels au modèle consomment un slot.
    const limited = await enforceAiRateLimit(request);
    if (limited) return precedente ? cachedTextResponse(precedente) : limited;

    // Plafond du site, partagé avec /api/resume-loi. Atteint, il laisse servir la
    // synthèse précédente comme la limite horaire ; sans elle, 403, que la carte
    // affiche comme un service IA indisponible.
    if (!(await consommerPlafondIa())) {
      console.warn(`Plafond quotidien des générations IA atteint, synthèse non lancée pour ${dossier_uid}`);
      return precedente ? cachedTextResponse(precedente) : NextResponse.json({ error: 'aiQuotaExhausted' }, { status: 403 });
    }

    // Borne de la purge finale : une extraction écrite après cet instant vient
    // d'une requête concurrente, peut-être sur une séance que celle-ci ne voit
    // pas encore, et ne doit pas être supprimée.
    const debutRequete = new Date().toISOString();

    // Phase 2 : MAP, séance par séance. L'unité est la séance et non un paquet de
    // séances : une séance passée ne bouge plus, donc sa clé non plus, alors qu'un
    // regroupement déplacerait toutes les frontières dès qu'une séance change.
    // Tri par date puis uid : la synthèse lit le débat dans l'ordre où il a eu lieu.
    const titre = (ligne.titre as string | null) || 'Dossier sans titre';
    const parSeance = new Map<string, InterventionRow[]>();
    for (const r of substantive) {
      const lignes = parSeance.get(r.seance_uid);
      if (lignes) lignes.push(r);
      else parSeance.set(r.seance_uid, [r]);
    }
    const seances = [...parSeance.entries()].sort(([uidA, a], [uidB, b]) => {
      const dateA = a[0].seance?.date_seance ?? '';
      const dateB = b[0].seance?.date_seance ?? '';
      return dateA.localeCompare(dateB) || uidA.localeCompare(uidB);
    });

    type Partie = { cle: string; seanceUid: string; partie: number; texte: string; entete: string };
    const parties: Partie[] = seances.flatMap(([seanceUid, lignes]) => {
      const seance = lignes[0].seance;
      const entete = `[${seance?.date_seance ?? ''} · ${seance?.chambre === 'SEN' ? 'Sénat' : 'Assemblée'}]`;
      // Tout ce que lit le modèle entre dans la clé, le prompt par la version : une
      // séance dont la chambre corrige le compte rendu change de clé, et elle seule
      // est relue. Le titre y entre aussi, donc un dossier renommé relit tout.
      return splitIntoChunks(formatInterventions(lignes), MAX_CHARS_PER_CHUNK_DEBATS).map((texte, partie) => ({
        cle: createHash('sha256').update(`${VERSION_EXTRACTION_DEBATS}\n${titre}\n${texte}`).digest('hex'),
        seanceUid,
        partie,
        texte,
        entete,
      }));
    });

    // Une panne de lecture lève : sans les extractions déjà faites, la requête les
    // repaierait toutes.
    const extractions = new Map<string, string>(
      (await sql<{ cle: string; extraction: string }[]>`
        select cle, extraction from debat_extractions where cle = any(${parties.map((p) => p.cle)})
      `).map((l) => [l.cle, l.extraction]),
    );

    // Les parties manquantes s'extraient par lots de MAX_APPELS_IA_PARALLELES.
    // `allSettled` et non `all` : un lot dont un appel échoue attend quand même ses
    // voisins, qui écrivent leur extraction avant que la requête n'échoue. La
    // suivante n'aura donc à payer que ce qui manque encore.
    const manquantes = parties.filter((p) => !extractions.has(p.cle));
    for (let debut = 0; debut < manquantes.length; debut += MAX_APPELS_IA_PARALLELES) {
      const lot = manquantes.slice(debut, debut + MAX_APPELS_IA_PARALLELES);
      const resultats = await Promise.allSettled(
        lot.map(async (p) => {
          // Une partie qui ne passe pas malgré les reprises fait échouer toute la
          // requête : un résumé amputé de quatre séances sur quatorze, mis en cache
          // et servi comme complet, ne se distinguerait plus d'un bon. Une partie
          // coupée par le plafond de jetons aussi : elle n'est pas écrite.
          const resultat = await avecReprises(() => generateText({
            model: modeleIA(MODEL_RESUME_DEBATS),
            system: SYSTEM_PROMPT_DEBATS_MAP,
            prompt: remplirGabarit(USER_PROMPT_TEMPLATE_DEBATS_MAP, { titre_dossier: titre, verbatim: p.texte }),
            ...PARAMS_DEBATS_MAP,
            ...REPRISES_SDK_DESACTIVEES,
            providerOptions: optionsIA(PARAMS_DEBATS_MAP.reasoningEffort),
          }), DELAIS_REPRISE_WEB);
          const text = texteNonTronque(resultat, `${dossier_uid} / ${p.seanceUid} partie ${p.partie}`);
          extractions.set(p.cle, text);
          // Une extraction vide ne s'écrit pas : écrite, elle le resterait pour
          // toute la vie de cette version d'extraction.
          if (!text.trim()) return;
          // `do nothing` : deux lecteurs sur la même séance neuve la paient deux
          // fois, et la première ligne écrite reste. Une écriture ratée ne fait
          // pas échouer la requête : la synthèse a déjà son texte, seule la
          // prochaine requête repaiera la séance.
          try {
            await sql`
              insert into debat_extractions ${sql({
                cle: p.cle,
                dossier_uid,
                seance_uid: p.seanceUid,
                partie: p.partie,
                version_extraction: VERSION_EXTRACTION_DEBATS,
                extraction: text,
              })}
              on conflict (cle) do nothing
            `;
          } catch (e) {
            const error = e as { code?: string; message?: string };
            console.error(`Extraction non écrite pour ${dossier_uid} / ${p.seanceUid} : ${error.code} ${error.message}`);
          }
        }),
      );
      // Chaque échec est journalisé, un seul remonte. Un quota épuisé passe devant
      // les autres, puis une limite de débit : l'erreur remontée décide du message
      // affiché au lecteur, et une erreur réseau sur une partie voisine les
      // masquerait (une panne générique invite à réessayer tout de suite, ce
      // qu'une limite de débit en cours ferait échouer de nouveau).
      const echecs = resultats.flatMap((r, i) => (r.status === 'rejected' ? [{ raison: r.reason as unknown, partie: lot[i] }] : []));
      for (const { raison, partie } of echecs) {
        console.error(`Extraction échouée pour ${dossier_uid} / ${partie.seanceUid} : ${raison instanceof Error ? raison.message : String(raison)}`);
      }
      if (echecs.length > 0) {
        const quota = echecs.find(({ raison }) => estQuotaEpuise(raison));
        const debit = echecs.find(({ raison }) => delaiLimiteDebit(raison) !== null);
        throw (quota ?? debit ?? echecs[0]).raison;
      }
    }

    // Phase 3, REDUCE : synthèse finale en JSON contraint par schéma.
    // Le schéma voyage dans le corps de la requête, hors des messages : le modèle
    // ne peut plus rendre autre chose qu'un objet conforme, et `contre: []` dit
    // « aucune opposition » sans ambiguïté possible avec un parsing raté.
    // Chaque extraction est précédée de sa date et de sa chambre : la synthèse doit
    // nommer la chambre, et le texte extrait ne la porte pas.
    const allArguments = parties
      .map((p) => `${p.entete}\n${extractions.get(p.cle) ?? ''}`)
      .join('\n\n---\n\n');

    // Les seuls libellés que la synthèse peut écrire dans `groupes` : ceux des
    // en-têtes du dossier, plus le Gouvernement, sous son nom anglais en anglais
    // comme le demande le prompt. « Sans groupe » n'y est pas : la carte
    // n'affiche pas de groupe pour ces arguments.
    const gouvernement = locale === 'en' ? 'Government' : 'Gouvernement';
    const groupesAutorises = [...new Set(substantive.map(etiquetteGroupe))]
      .filter((g) => g !== SANS_GROUPE && g !== 'Gouvernement')
      .sort()
      .concat(gouvernement);

    // Repris lui aussi : c'est l'appel dont l'échec coûte le plus cher, puisqu'il
    // vient après toutes les extractions déjà payées.
    const { object } = await avecReprises(() => generateObject({
      model: modeleIA(MODEL_RESUME_DEBATS),
      schema: SCHEMA,
      system: getSystemPromptDebatsReduce(locale),
      prompt: remplirGabarit(getUserPromptTemplateDebatsReduce(locale), {
        titre_dossier: titre,
        arguments_extraits: allArguments,
        groupes_autorises: groupesAutorises.join(', '),
      }),
      ...PARAMS_DEBATS_REDUCE,
      ...REPRISES_SDK_DESACTIVEES,
      providerOptions: optionsIA(PARAMS_DEBATS_REDUCE.reasoningEffort),
    }), DELAIS_REPRISE_WEB);

    // Filet derrière le prompt : tout libellé hors de la liste autorisée est
    // retiré, et les autres reprennent la casse de la liste. Découpe sur les
    // virgules seulement : « République et Territoires » contient « et ».
    const parLibelle = new Map(groupesAutorises.map((g) => [g.toLowerCase(), g]));
    for (const arg of [...object.pour, ...object.contre]) {
      arg.groupes = arg.groupes.split(',').flatMap((g) => parLibelle.get(g.trim().toLowerCase()) ?? []).join(', ');
    }
    const resume = JSON.stringify(object);

    // L'écriture du cache sort de `onFinish`, qui n'existe pas sur generateObject.
    // `sql` lève sur toute erreur : le `catch` journalise sans faire échouer la
    // requête, comme dans api/resume-loi. Le coût d'un cache non écrit est ici
    // plus lourd encore, ce pipeline étant le plus cher du site.
    try {
      await sql`
        update dossiers_legislatifs set ${sql({
          [cacheColumn]: resume,
          [versionColumn]: promptVersion,
          [hashColumn]: sourceHash,
          // Null quand la fonction a échoué, ou hors production : une empreinte
          // d'avant ne doit pas rester à côté de cette synthèse.
          [empreinteColumn]: RANGE_EMPREINTE ? empreinte : null,
          resume_debats_created_at: new Date().toISOString(),
        })}
        where uid = ${dossier_uid}
      `;
    } catch (e) {
      const erreurCache = e as { code?: string; message?: string };
      console.error(`Cache resume_debats_ia non écrit pour ${dossier_uid} : ${erreurCache.code} ${erreurCache.message}`);
    }

    // Purge des extractions que cette synthèse n'a pas lues : aucune requête ne
    // les relira, leur clé contenant une version, un titre ou un texte qui n'est
    // plus celui du dossier. Revenir à un ancien prompt ou modèle fait donc
    // repayer la relecture. Les clés lues partent en un seul paramètre tableau.
    // Un échec ne fait que retarder le ménage à la prochaine synthèse.
    // En production seulement : l'app d'essai et les serveurs locaux écrivent dans
    // la même base, souvent avec un autre prompt. Ils effaceraient les extractions
    // de la production, qui repaierait la relecture du dossier entier.
    if (EST_PRODUCTION) {
      try {
        await sql`
          delete from debat_extractions
          where dossier_uid = ${dossier_uid}
            and created_at < ${debutRequete}
            and not (cle = any(${parties.map((p) => p.cle)}))
        `;
      } catch (e) {
        const erreurPurge = e as { code?: string; message?: string };
        console.error(`Purge des extractions non faite pour ${dossier_uid} : ${erreurPurge.code} ${erreurPurge.message}`);
      }
    }

    return cachedTextResponse(resume);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Erreur génération résumé débats :', message);
    if (precedente) return cachedTextResponse(precedente);
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
    return NextResponse.json(
      { error: 'serverError' },
      { status: 500 },
    );
  } finally {
    if (verrou) await rendreVerrouIa(verrou);
  }
}
