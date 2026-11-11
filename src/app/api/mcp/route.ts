// src/app/api/mcp/route.ts
//
// Serveur MCP de LoiClair : les données du site, en lecture seule, pour un
// assistant IA. Monté ici, `/api/mcp` est l'adresse que les clients collent.
//
// Ce qu'il n'expose jamais, et qui ne doit pas revenir par une extension :
//   - le texte des résumés produits par un modèle, seulement leur lien, pour
//     qu'aucun texte généré ne quitte la page qui porte ses avertissements ;
//   - la table `debat_interventions`, dont une seule réponse peut peser plus de
//     dix mégaoctets ;
//   - les centiles du score d'activité, qui ne sont pas des faits sur une
//     personne mais des positions dans un calcul maison ;
//   - toute somme ou tout classement sur `transparence_elements.valeur_texte`,
//     qui mélange par construction un montant, une durée et un nombre de parts.
//
// La sécurité ne tient pas à une authentification, qu'il n'y a pas, mais à la
// forme des outils : leur liste est fermée, aucun ne prend un nom de table ou de
// colonne en argument, et chaque identifiant est validé par une expression qui
// n'autorise que des caractères alphanumériques. C'est ce qui compte, parce que
// la connexion Postgres du site (`src/lib/db.ts`) a tous les droits : elle
// ignore les politiques de ligne et peut écrire.
//
// Deux outils lisent large, et c'est assumé : `chiffres_cles` appelle sept
// lectures de `facts-queries`, `chercher_elu` lit en plus toute la table des
// mandats locaux quand on filtre sur le cumul. Ils sont facturés en conséquence, et le cache de six heures les rend
// gratuits à partir du deuxième appel.

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { mcpRateLimit, PREFIXE_REDIS, redis } from '@/lib/rate-limit';
import { catalogueFacts, chiffresCles, actualiteParlementaire } from '@/lib/mcp/chiffres';
import { chercherElu, ficheElu } from '@/lib/mcp/elus';
import { chercherLoi, ficheLoi, trouverTexte, votesElu, detailScrutin } from '@/lib/mcp/lois';
import { versContenuMcp, erreurMcp, type ReponseMcp } from '@/lib/mcp/enveloppe';
import { aujourdhuiAParisIso } from '@/lib/jour-paris';

export const runtime = 'nodejs';

/**
 * Jetons consommés par appel, proportionnels au temps de calcul demandé.
 *
 * Le barème suit le coût réel côté base, pas le nombre de requêtes : une lecture
 * sur clé primaire ne coûte qu'un aller-retour, là où une recherche en texte
 * libre balaie toute la table. Facturer les deux au même prix laisserait la
 * seconde saturer l'instance bien avant que le seau ne se vide.
 *
 * Un seul seau sert tout le serveur, avec une clé fixe : le protocole est sans
 * état, il n'y a donc ni session ni identité à partitionner, et l'adresse IP ne
 * sépare rien puisque les appels arrivent derrière celles d'Anthropic ou
 * d'OpenAI. Ce n'est pas de l'équité (un seul appelant vorace peut en sortir
 * tout le monde), c'est un plafond de dépense.
 */
const COUTS: Record<string, number> = {
  catalogue_facts: 1,
  // Lectures sur clé primaire ou sur index : quelques dizaines de millisecondes.
  fiche_loi: 2,
  trouver_texte: 2,
  detail_scrutin: 2,
  actualite_parlementaire: 2,
  // Index `idx_acteurs_en_exercice` : le filtre ne porte que sur le millier
  // d'élus en fonction, mesuré à 95 ms. Le filtre sur le cumul y ajoute la
  // lecture de toute la table des mandats locaux, d'où un coût au-dessus des fiches.
  chercher_elu: 3,
  // Cinq lectures sur clé primaire.
  fiche_elu: 5,
  // Balayage complet de `dossiers_legislatifs`, mesuré à 733 ms : les titres
  // sont longs et aucun index trigram ne les couvre. C'est l'outil le plus
  // coûteux par appel, il doit être le plus cher.
  chercher_loi: 5,
  // Chaque scrutin porte une liste de près de six cents identifiants.
  votes_elu: 5,
  // Certains sujets paginent une table entière ; sans sujet, l'outil ne lit rien.
  chiffres_cles: 10,
};

/** Quatre-vingt-dix jours de compteurs : assez pour voir une tendance, assez peu pour ne rien accumuler. */
const RETENTION_STATS = 90 * 24 * 60 * 60;

/**
 * Consomme le quota et compte l'appel.
 *
 * Rend la date de reprise quand le seau est vide, `null` sinon.
 *
 * Une panne d'Upstash laisse passer : le pire cas est une lecture non plafonnée
 * sur des données déjà publiques, là où refuser rendrait le serveur entier
 * indisponible pour un hoquet de cache.
 */
async function consommer(outil: string): Promise<number | null> {
  try {
    const { success, reset } = await mcpRateLimit.limit('global', { rate: COUTS[outil] ?? 2 });
    if (!success) return reset;

    // Compté ici plutôt que dans `onEvent` : la garde connaît le nom de l'outil,
    // là où l'événement ne porte que la méthode du protocole. C'est le seul
    // chiffre qui dira si ce serveur sert à quelqu'un.
    const jour = aujourdhuiAParisIso();
    const cle = `${PREFIXE_REDIS}mcp:stats:${outil}:${jour}`;
    // Incrément et durée de vie dans la même transaction : aucune clé ne reste
    // sans expiration, et l'appel ne paie qu'un aller-retour vers Upstash.
    await redis.multi().incr(cle).expire(cle, RETENTION_STATS).exec();
  } catch (e) {
    console.warn('[mcp] quota ou compteur indisponible, appel laissé passer', e);
  }
  return null;
}

/**
 * Consomme le quota, exécute l'outil, et convertit toute panne en code.
 *
 * Le SDK met le message de l'exception dans la réponse qu'il renvoie : sans ce
 * filet, une erreur de lecture partirait chez un appelant anonyme avec le texte
 * de Postgres, ses noms de tables et de colonnes. Or le contrat des routes du
 * dépôt est « un code d'erreur, jamais une phrase », d'autant que le corps ne
 * connaît pas la langue du lecteur. Le détail, lui, reste indispensable au
 * diagnostic : il part dans les journaux du serveur, qui eux sont privés.
 *
 * C'est aussi le seul endroit où les exceptions de `lignesOuLeve` sont vues :
 * les modules d'outils lèvent volontairement sur une panne base, pour ne jamais
 * publier une liste vide comme un fait.
 */
async function repondre(outil: string, calcul: () => Promise<ReponseMcp>): Promise<ReponseMcp> {
  const reprise = await consommer(outil);
  if (reprise) return erreurMcp('quota_epuise', { reprise });
  try {
    return await calcul();
  } catch (e) {
    console.error(`[mcp] ${outil} a échoué`, e);
    return erreurMcp('erreur_interne');
  }
}

// Les identifiants du site sont strictement alphanumériques : huit caractères au
// plus pour un élu, quinze pour un dossier, zéro exception sur les 6 772 lignes
// des deux tables. Valider leur forme borne le nombre de valeurs distinctes qui
// atteignent la base : ce n'est pas cosmétique, ne pas élargir cette expression.
const UID = /^[A-Za-z0-9]{1,20}$/;

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'catalogue_facts',
      {
        title: 'Catalogue des articles LoiClair',
        description:
          "La liste des questions auxquelles LoiClair répond avec des chiffres : taux de promulgation, application des lois, délais, représentativité, participation, loyauté, cumul des mandats, budget des chambres, activité des élus. Chaque entrée porte son identifiant, sa question et son lien dans les deux langues. Appeler cet outil en premier quand on ne sait pas quel autre appeler : il dit ce que le site sait répondre.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async () =>
        repondre('catalogue_facts', async () => versContenuMcp(await catalogueFacts())),
    );

    server.registerTool(
      'chercher_elu',
      {
        title: 'Rechercher des parlementaires',
        description:
          "Trouve des députés et des sénateurs en exercice, par nom, département, groupe, chambre, cumul des mandats ou tranche de participation aux votes. Les filtres se combinent librement : « les sénateurs du Rhône qui cumulent avec un mandat local » est une seule requête.\n\nLe nom se cherche sans accents ni casse : « melenchon » trouve « Mélenchon ». Vingt résultats au maximum ; quand il en reste, la réponse porte un bloc `tronque` qui le dit. Utilise ensuite `fiche_elu` avec l'`uid` d'un résultat pour le détail.\n\n`cumul: \'avec\'` retient les élus qui détiennent au moins un mandat local au sens de la loi sur le cumul (conseil municipal, départemental, régional, d'arrondissement ou d'assemblée territoriale), avec la même définition que la page /Facts/cumul-des-mandats. Détenir un tel mandat est un fait, pas une irrégularité : la légalité dépend du nombre de mandats et de la nature des fonctions, et se lit sur la fiche.",
        inputSchema: z.object({
          nom: z
            .string()
            .trim()
            .regex(/^[\p{L}\p{M}\s'\u2019-]{2,60}$/u)
            .optional()
            .describe("Nom ou prénom, accents facultatifs. Lettres, espaces, apostrophes et traits d'union seulement."),
          departement: z
            .string()
            .regex(/^[\p{L}\p{M}\s'\u2019-]{2,40}$/u)
            .optional()
            .describe(
              "Nom du département d'élection, accents compris : « Rhône », et non « Rhone ». Préférer `num_departement`, qui ne pose pas ce problème.",
            ),
          num_departement: z
            .string()
            .regex(/^[0-9AB]{1,3}$/)
            .optional()
            .describe('Numéro du département, par exemple 69, 2A, 974.'),
          groupe: z
            .string()
            .regex(/^[\p{L}\p{M}\s'\u2019-]{2,60}$/u)
            .optional()
            .describe('Fragment du nom du groupe politique.'),
          chambre: z.enum(['assemblee', 'senat']).optional(),
          cumul: z
            .enum(['avec', 'sans'])
            .optional()
            .describe("« avec » : détient au moins un mandat local au sens de la loi sur le cumul."),
          participation: z
            .enum(['moins_50', 'de_50_a_75', 'de_75_a_90', 'plus_90'])
            .optional()
            .describe('Tranche de participation aux votes finaux, en pourcentage.'),
          inclure_anciens: z
            .boolean()
            .optional()
            .describe(
              "Par défaut, seuls les élus en fonction. Mettre à true pour atteindre d'anciens parlementaires, par exemple Jean-Luc Mélenchon, qui ne siège plus. La base ne garde pas la chambre d'un mandat achevé : combiné à `chambre`, ce mode laisse donc passer les anciens, dont le champ `chambre` est vide.",
            ),
          limite: z.number().int().min(1).max(20).optional().describe('Nombre de résultats, 10 par défaut.'),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async (filtres) =>
        repondre('chercher_elu', async () => versContenuMcp(await chercherElu(filtres))),
    );

    server.registerTool(
      'fiche_elu',
      {
        title: 'Fiche d’un parlementaire',
        description:
          "Identité, groupe, circonscription, cumul des mandats, déclarations d'intérêts et score d'activité d'un député ou d'un sénateur, à partir de son identifiant.\n\nDeux champs se lisent de travers si on n'y prend pas garde, et le contresens porterait sur une personne réelle. Un `score` absent ne veut pas dire que l'élu est inactif : les présidents des deux chambres, les présidents de groupe et les mandats de moins de 180 jours sont exclus du classement par construction, et le champ `exclusion_classement` dit lequel de ces trois cas s'applique. Et le score mesure des actes, jamais leur qualité : être nommé rapporteur, qui pèse lourd, ne dépend pas que de l'élu.\n\nLes éléments de transparence sont rendus tels que déclarés : `valeur_texte` mélange des montants, des durées et des nombres de parts, il ne s'additionne pas et ne se classe pas.\n\nUn mandat local peut porter un bloc `verification` : le Répertoire national des élus retarde de plusieurs mois, et LoiClair y note, source à l'appui, une fonction ou un siège quitté depuis, ou une fonction que le registre prête à tort. Le décompte du cumul en tient déjà compte, et `statut` est nul pour un siège quitté. Quand l'élu a une situation à régulariser, `delai` donne la date limite pour choisir (trente jours après l'élection qui l'a créée), ou signale un recours contre cette élection, qui suspend le délai.\n\n`delegation`, pour un député seulement, donne la part de ses votes finaux et solennels qu'un collègue porteur de sa délégation a déposés à sa place. Un vote délégué est un vote valide, compté dans la participation. N'en conclus jamais que l'élu était absent : la donnée dit qui a déposé le vote, pas où se trouvait l'élu.\n\n`affinites_vote` donne, pour chaque groupe de la chambre de l'élu, la part de ses votes finaux où il a voté comme ce groupe (`accord_pct`), sur `votes_communs` scrutins. La position d'un groupe est l'option qui a reçu le plus de voix de ses membres, abstention comprise ; les motions de censure et les scrutins où l'élu n'a pas voté n'entrent pas dans le calcul. Un groupe n'apparaît qu'à partir de `seuil_votes_communs` votes en commun, et un groupe formé en cours de mandat repose sur moins de votes que les autres : comparer `votes_communs` avant de comparer deux pourcentages. Le vote de l'élu compte dans la position de son propre groupe.",
        inputSchema: z.object({
          uid: z
            .string()
            .regex(UID)
            .describe("Identifiant LoiClair de l'élu, par exemple PA1592. Se trouve dans l'URL de sa fiche."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async ({ uid }) =>
        repondre('fiche_elu', async () => {
          const fiche = await ficheElu(uid);
          if (!fiche) return erreurMcp('elu_introuvable', { uid });
          return versContenuMcp(fiche);
        }),
    );

    server.registerTool(
      'fiche_loi',
      {
        title: 'Fiche d’un dossier législatif',
        description:
          "Où en est un texte : son statut, sa procédure, ses thèmes, sa date de dépôt, qui l'a déposé, le nombre d'amendements déposés et adoptés, sa promulgation et l'état de ses décrets d'application.\n\nLes valeurs de `statut` et de `procedure` sont des identifiants stables, pas du texte à afficher : c'est à toi de les formuler dans la langue de ton interlocuteur. Chaque fiche porte son lien vers LoiClair en français et en anglais, et le lien Légifrance quand le texte est promulgué.\n\nSi un résumé des débats existe, seul son lien est rendu : le texte est produit par un modèle, et il ne se lit qu'avec les avertissements de la page qui le porte.",
        inputSchema: z.object({
          uid: z
            .string()
            .regex(UID)
            .describe("Identifiant LoiClair du dossier, par exemple DLR5L17N51670. Se trouve dans l'URL de sa fiche."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async ({ uid }) =>
        repondre('fiche_loi', async () => {
          const fiche = await ficheLoi(uid);
          if (!fiche) return erreurMcp('dossier_introuvable', { uid });
          return versContenuMcp(fiche);
        }),
    );

    server.registerTool(
      'chercher_loi',
      {
        title: 'Rechercher des lois et propositions',
        description:
          "Trouve des dossiers législatifs par mots du titre, thème ou statut d'avancement. Les filtres se combinent.\n\nLa recherche porte sur le titre officiel et elle est sensible aux accents, contrairement à celle des élus : écrire « sécurité », pas « securite ». Quand on connaît le numéro de dépôt d'un texte, `trouver_texte` est plus sûr.\n\nLe champ `statut` rendu est un identifiant stable, pas un libellé à afficher.",
        inputSchema: z.object({
          mots: z
            .string()
            .trim()
            .regex(/^[\p{L}\p{M}\p{N}\s'\u2019-]{2,80}$/u)
            .optional()
            .describe("Mots du titre, avec leurs accents. Quatre au maximum sont retenus, combinés en ET."),
          theme: z
            .string()
            .regex(/^[\p{L}\p{M}\p{N}\s,'\u2019-]{2,60}$/u)
            .optional()
            .describe(
              "Thème exact, tel que l'Assemblée le nomme : « Justice », « Environnement », « Questions sociales et santé », « Économie et finances, fiscalité »…",
            ),
          statut: z
            .enum([
              'en_cours_d_examen',
              'publie',
              'adopte_par_assemblee',
              'adopte_par_senat',
              'adopte_par_parlement',
              'rejetee',
              'rejete_par_assemblee',
              'rejete_par_senat',
              'promulguee',
              'appliquee',
              'retire',
            ])
            .optional(),
          limite: z.number().int().min(1).max(20).optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async (filtres) =>
        repondre('chercher_loi', async () => versContenuMcp(await chercherLoi(filtres))),
    );

    server.registerTool(
      'trouver_texte',
      {
        title: 'Retrouver un texte et son lien officiel',
        description:
          "Retrouve un texte parlementaire par son numéro de dépôt, par des mots de son titre, ou tous les textes d'un dossier. Rend le lien officiel vers le document, sur le site de la chambre ou sur Légifrance.\n\nSur 8 795 textes, 8 792 portent un lien et 8 615 un numéro : quand le numéro est connu, c'est la voie la plus fiable, puisqu'elle ne dépend pas de l'orthographe du titre.",
        inputSchema: z.object({
          numero: z
            .string()
            .regex(/^[0-9]{1,6}$/)
            .optional()
            .describe('Numéro de dépôt du texte, par exemple 3126.'),
          mots: z
            .string()
            .trim()
            .regex(/^[\p{L}\p{M}\p{N}\s'\u2019-]{2,80}$/u)
            .optional(),
          dossier_uid: z.string().regex(UID).optional().describe("Tous les textes d'un dossier."),
          chambre: z.enum(['assemblee', 'senat']).optional(),
          limite: z.number().int().min(1).max(20).optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async (filtres) =>
        repondre('trouver_texte', async () => versContenuMcp(await trouverTexte(filtres))),
    );

    server.registerTool(
      'votes_elu',
      {
        title: 'Votes récents d’un parlementaire',
        description:
          "La position d'un élu sur les scrutins récents que LoiClair suit.\n\nCE N'EST PAS TOUS SES VOTES. Le détail nominatif est publié pour 100 % des scrutins du Sénat et des scrutins solennels de l'Assemblée, mais pour 199 des 8 339 scrutins publics ordinaires. Ne jamais conclure d'une absence dans cette liste qu'un élu n'a pas pris part à un vote.\n\nHuit positions possibles. `pour`, `contre` et `abstention` sont des positions exprimées. `non_votant` est une position déclarée. `fonction_institutionnelle` désigne la présidence de séance et les statuts assimilés. `aucun_vote` signifie que la chambre n'a rien enregistré au nom de cet élu sur ce scrutin : ce n'est PAS une absence de l'hémicycle, et ça ne doit jamais être présenté comme telle. La prudence vaut dans les deux sens : un vote délégué est enregistré au nom de l'élu absent, et la délégation pèse jusqu'à un tiers des suffrages d'un scrutin solennel. `non_recense` ne paraît que sur une motion de censure : l'article 49 de la Constitution ne fait recenser que les voix favorables, et les autres députés, la présidence de séance mise à part, y sont sans position enregistrable. Ne jamais les dire opposés ni absents. `non_publie` dit que le scrutin n'a pas de détail nominatif.\n\nLa réponse porte aussi un bloc `elu` avec sa période de mandat : pour un parlementaire qui ne siège plus, les scrutins récents sont tous postérieurs à son mandat, et une liste entière de `aucun_vote` ne dit rien de son assiduité.",
        inputSchema: z.object({
          uid: z.string().regex(UID).describe("Identifiant LoiClair de l'élu."),
          chambre: z
            .enum(['assemblee', 'senat'])
            .optional()
            .describe(
              "Restreint aux scrutins d'une chambre. Par défaut, celle où l'élu siège : les scrutins récents alternent les deux, et ceux de l'autre chambre reviendraient tous en `aucun_vote`. Le champ `chambre` de la réponse dit laquelle a été lue.",
            ),
          limite: z.number().int().min(1).max(20).optional().describe('Nombre de scrutins, 10 par défaut.'),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async ({ uid, chambre, limite }) =>
        repondre('votes_elu', async () => {
          const votes = await votesElu(uid, limite ?? 10, chambre);
          if (!votes) return erreurMcp('elu_introuvable', { uid });
          return versContenuMcp(votes);
        }),
    );

    server.registerTool(
      'detail_scrutin',
      {
        title: 'Détail d’un scrutin',
        description:
          "La synthèse d'un scrutin, la position majoritaire de chaque groupe, et le nombre d'élus par position.\n\nSur une motion de censure, `positions_groupes` est toujours vide : seules les voix favorables y sont recensées, ce qui ne permet de dire la position d'aucun groupe. Les effectifs, eux, restent rendus.\n\nLes noms des votants ne sont pas rendus : un scrutin en compte près de six cents, et les énumérer sature la réponse sans rien apprendre. Pour la position d'une personne précise, utiliser `votes_elu`.",
        inputSchema: z.object({
          uid: z
            .string()
            .regex(/^VT(AN|SN)[A-Z0-9]{1,40}$/)
            .describe('Identifiant du scrutin, de la forme VTANR5L17V8430.'),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async ({ uid }) =>
        repondre('detail_scrutin', async () => {
          const detail = await detailScrutin(uid);
          if (!detail) return erreurMcp('scrutin_introuvable', { uid });
          return versContenuMcp(detail);
        }),
    );

    server.registerTool(
      'chiffres_cles',
      {
        title: 'Chiffres d’un article LoiClair',
        description:
          "Les chiffres publiés d'un article des « Faits » : taux de promulgation, application des lois, délais, amendements, participation, loyauté aux groupes, cumul des mandats, budget des deux chambres.\n\nAppelé sans `sujet`, il rend la liste des dix-huit sujets et dit lesquels portent un chiffre : c'est la façon économique de savoir quoi demander. Neuf articles n'ont que leur question et leur lien, parce que leurs chiffres sont calculés à l'intérieur de leur page ; le lien reste la bonne réponse à donner.\n\nCes chiffres ont des limites de périmètre et de méthode, écrites sur la page de chaque article, dont le lien accompagne toujours la réponse.",
        inputSchema: z.object({
          sujet: z
            .string()
            .regex(/^\/[A-Za-z0-9\/-]{2,60}$/)
            .optional()
            .describe("Identifiant d'un article, tel que `catalogue_facts` le rend : /Facts/taux-application."),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async ({ sujet }) =>
        repondre('chiffres_cles', async () => {
          const chiffres = await chiffresCles(sujet);
          if (!chiffres) return erreurMcp('sujet_inconnu', { sujet });
          return versContenuMcp(chiffres);
        }),
    );

    server.registerTool(
      'actualite_parlementaire',
      {
        title: 'Ce qui a bougé au Parlement',
        description:
          "Les étapes législatives franchies sur une semaine ou un mois : dépôts, votes en séance (toutes lectures, lecture unique comprise), commissions mixtes, décisions du Conseil constitutionnel, promulgations et publications de décrets d'application.\n\nLa période est toujours une semaine entière (du lundi au dimanche, à l'heure de Paris) ou un mois entier, jamais une plage libre. `decalage: 0` désigne la période en cours, `1` la précédente.",
        inputSchema: z.object({
          periode: z.enum(['semaine', 'mois']).describe('Granularité de la période.'),
          decalage: z
            .number()
            .int()
            .min(0)
            .max(52)
            .optional()
            .describe('0 pour la période en cours, 1 pour la précédente, et ainsi de suite.'),
          limite: z.number().int().min(1).max(20).optional(),
        }),
        annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false },
      },
      async ({ periode, decalage, limite }) =>
        repondre('actualite_parlementaire', async () =>
          versContenuMcp(await actualiteParlementaire(periode, decalage ?? 0, limite ?? 10)),
        ),
    );
  },
  {
    serverInfo: { name: 'loiclair', version: '1.0.0' },
  },
);

/**
 * Durée après laquelle on referme nous-mêmes un flux `subscriptions/listen`.
 *
 * Depuis le protocole 2026-07-28, un client ouvre ce POST pour recevoir les
 * notifications du serveur, et le SDK le garde ouvert indéfiniment (un
 * « keepalive » toutes les 15 s). Ce serveur n'émet jamais de notification, ses
 * outils sont fixes : l'écoute n'a rien à attendre, et le client se reconnecte
 * à chaque coupure. La fermeture reste abrupte, le SDK n'envoyant pas de trame
 * finale quand le signal s'interrompt. Les 50 s datent du délai de 60 s de l'ancien
 * hébergeur : rien sur le VPS n'impose cette valeur (voir le backlog).
 */
const DUREE_ECOUTE_MS = 50_000;

/**
 * Point d'entrée POST : passe chaque requête au SDK, en bornant la durée d'une
 * écoute. L'en-tête `Mcp-Method` est obligatoire sur toute requête du protocole
 * 2026-07-28 (le SDK refuse celles qui l'omettent), il suffit donc à reconnaître
 * l'écoute sans relire le corps. Le routeur d'écoute du SDK referme le flux quand
 * `request.signal` s'interrompt.
 *
 * La requête est reconstruite à partir de ses parties : `new Request(req, …)`
 * lève sur la requête que Next fournit (« Cannot read private member #state »,
 * constaté sous `next dev`). Le corps d'une écoute ne fait que quelques
 * centaines d'octets, le relire en entier ne coûte rien.
 */
async function post(req: Request): Promise<Response> {
  if (req.headers.get('mcp-method') !== 'subscriptions/listen') return handler(req);
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(DUREE_ECOUTE_MS)]);
  return handler(
    new Request(req.url, { method: req.method, headers: req.headers, body: await req.arrayBuffer(), signal }),
  );
}

// Pas de `DELETE` : le transport est sans état, les opérations de session
// répondent de toute façon 405.
export { handler as GET, post as POST };
