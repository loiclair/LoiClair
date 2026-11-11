// src/lib/mcp/chiffres.ts
//
// Outils du serveur MCP qui portent sur les articles « Les faits » et sur les
// chiffres du site, par opposition aux fiches individuelles.
//
// Appelé par `src/app/api/mcp/route.ts`.

import { FACTS_ARTICLES } from '@/lib/facts-registry';
import { sql } from '@/lib/db';
import {
  getTauxPromulgation,
  getTauxApplication,
  getAmendementsTotaux,
  getParticipationMoyennes,
  getLoyauteMoyennes,
  getCumulMandats,
  getLoisPromulguees,
  delaisDepotPromulgation,
} from '@/lib/facts-queries';
import { median } from '@/lib/stats';
import { aujourdhuiAParis } from '@/lib/jour-paris';
import { TOTAUX as BUDGET_AN, SIEGES as SIEGES_AN } from '@/lib/budget-assemblee';
import { TOTAUX as BUDGET_SN, SIEGES as SIEGES_SN } from '@/lib/budget-senat';
import { lireOuCalculer, cleCache, TTL_COURT, TTL_LONG } from '@/lib/mcp/cache';
import { enveloppe, troncature, urlFr, urlEn, type Enveloppe, type Troncature } from '@/lib/mcp/enveloppe';
import messagesFr from '@/messages/fr.json';
import messagesEn from '@/messages/en.json';

const QUESTIONS_FR = messagesFr.kpisHub as unknown as Record<string, string>;
const QUESTIONS_EN = messagesEn.kpisHub as unknown as Record<string, string>;

export type ArticleCatalogue = {
  /** Chemin sans préfixe de langue, qui sert aussi d'identifiant à `chiffres_cles`. */
  id: string;
  question_fr: string;
  question_en: string;
  theme: string;
  publie_le: string;
  serie: { nom: string; chapitre: number } | null;
  url: string;
  url_en: string;
};

/**
 * Le catalogue des articles que LoiClair publie.
 *
 * Seul outil du serveur qui ne touche pas la base : `FACTS_ARTICLES` est une
 * constante du code, donc aucun cache non plus : un aller-retour Redis coûterait
 * plus que de lire un tableau en mémoire.
 *
 * Il sert de carte. Un assistant qui ne sait pas quoi appeler commence ici, voit
 * ce que le site sait répondre, et cesse d'inventer des sujets. Et il n'a rien à
 * maintenir : l'en-tête de `facts-registry.ts` dit qu'un nouvel article s'ajoute
 * là « et nulle part ailleurs », donc le catalogue suit le site tout seul.
 */
export async function catalogueFacts(): Promise<Enveloppe<ArticleCatalogue[]>> {
  const articles: ArticleCatalogue[] = FACTS_ARTICLES.map((a) => ({
    id: a.href,
    question_fr: QUESTIONS_FR[a.titleKey] ?? '',
    question_en: QUESTIONS_EN[a.titleKey] ?? '',
    theme: a.categoryKey,
    publie_le: a.publishedAt,
    serie: a.serie ? { nom: a.serie.key, chapitre: a.serie.chapter } : null,
    url: urlFr(a.href),
    url_en: urlEn(a.href),
  }));

  // Pas de bloc `methode` : le catalogue ne rend aucun chiffre, il rend la liste
  // des pages où les chiffres vivent. Y pointer les mêmes pages ferait doublon.
  return enveloppe('catalogue_facts', articles, []);
}


// ---------------------------------------------------------------------------
// chiffres_cles
// ---------------------------------------------------------------------------

/**
 * Les sujets dont le chiffre est calculable hors d'une page React.
 *
 * Les neuf articles absents de cette table ne sont pas oubliés : leur calcul vit
 * à l'intérieur de leur propre page, qui interroge la base trois à cinq fois dans
 * son corps. Les en extraire toucherait des pages qui marchent, au profit d'une
 * route nouvelle ; `chiffres_cles` rend donc leur question et leur lien, ce qui
 * reste utile et ne ment pas.
 */
const EXTRACTEURS: Record<string, () => Promise<Record<string, unknown>>> = {
  '/Facts/taux-promulgation': async () => {
    const r = await getTauxPromulgation();
    return {
      textes_deposes: r.totalDeposited,
      textes_promulgables: r.totalPromulgables,
      promulgues: r.promulgues,
      taux_promulgation: r.tauxPromulgation,
      par_procedure: r.parProcedure,
    };
  },
  '/Facts/taux-application': async () => {
    const r = await getTauxApplication();
    return {
      lois_suivies: r.totalLois,
      lois_appliquees: r.loisAppliquees,
      lois_partiellement_appliquees: r.loisPartiellementAppliquees,
      lois_non_appliquees: r.loisNonAppliquees,
      mesures_attendues: r.totalMesuresAttendues,
      mesures_prises: r.totalMesuresAppliquees,
      taux_application: r.tauxApplication,
      taux_mesures: r.tauxMesures,
      cohorte_plus_de_six_mois: r.plusDeSixMois,
    };
  },
  '/Facts/delais': async () => {
    const lois = await getLoisPromulguees();
    const delais = delaisDepotPromulgation(lois);
    return {
      lois_mesurees: delais.length,
      delai_median_jours: median(delais),
      delai_min_jours: delais.length ? Math.min(...delais) : null,
      delai_max_jours: delais.length ? Math.max(...delais) : null,
    };
  },
  '/Facts/amendements': async () => {
    const r = await getAmendementsTotaux();
    return {
      amendements_deposes: r.totalDeposes,
      amendements_adoptes: r.totalAdoptes,
      taux_adoption: r.tauxAdoption,
      mediane_deposes_par_loi: r.medianeDeposes,
      hors_lois_financieres: r.horsFinancieres,
    };
  },
  '/Facts/participation': async () => {
    const r = await getParticipationMoyennes();
    return {
      assemblee_votes_finaux_moyen: r.meanANFinal,
      assemblee_votes_solennels_moyen: r.meanANSolennel,
      senat_moyen: r.meanSN,
      deputes_mesures: r.deputes.length,
      senateurs_mesures: r.senateurs.length,
    };
  },
  '/Facts/loyaute': async () => {
    const r = await getLoyauteMoyennes();
    return {
      assemblee_cohesion_moyenne: r.meanAN,
      senat_cohesion_moyenne: r.meanSN,
      deputes_mesures: r.deputes.length,
      senateurs_mesures: r.senateurs.length,
    };
  },
  '/Facts/cumul-des-mandats': async () => {
    const r = await getCumulMandats();
    return {
      millesime: r.millesime,
      effectifs: r.effectifs,
      cumulards: r.cumulards,
      // Un décompte, jamais une liste de noms : le site publie les situations
      // sur sa page, avec le contexte qui les rend lisibles. Les deux mêmes
      // chiffres que la page, après vérification au cas par cas : seuls les
      // délais dépassés sans recours sont des situations à régulariser.
      verification_au_cas_par_cas: r.verification,
      delai_depasse: r.comptes.depasse,
      dans_le_delai_ou_election_contestee: r.comptes.dansLesTemps,
      par_type_de_mandat: r.parType,
    };
  },
  '/Facts/budget/assemblee-nationale': async () => ({
    sieges: SIEGES_AN,
    totaux: BUDGET_AN,
  }),
  '/Facts/budget/senat': async () => ({
    sieges: SIEGES_SN,
    totaux: BUDGET_SN,
  }),
};

export type SujetChiffres = {
  id: string;
  question_fr: string;
  question_en: string;
  chiffre_disponible: boolean;
  url: string;
  url_en: string;
};

export type ChiffresSujet = {
  id: string;
  question_fr: string;
  question_en: string;
  chiffres: Record<string, unknown>;
  url: string;
  url_en: string;
};

/**
 * Les chiffres d'un article, ou la liste des sujets interrogeables.
 *
 * Sans `sujet`, aucune requête n'est faite : la réponse est la liste des
 * dix-huit articles et un drapeau disant lesquels portent un chiffre. C'est ce
 * qui borne le coût de l'outil : un appel exploratoire ne déclenche jamais
 * l'agrégat le plus lourd du site.
 */
export async function chiffresCles(
  sujet?: string,
): Promise<Enveloppe<SujetChiffres[] | ChiffresSujet> | null> {
  if (!sujet) {
    const sujets: SujetChiffres[] = FACTS_ARTICLES.map((a) => ({
      id: a.href,
      question_fr: QUESTIONS_FR[a.titleKey] ?? '',
      question_en: QUESTIONS_EN[a.titleKey] ?? '',
      chiffre_disponible: a.href in EXTRACTEURS,
      url: urlFr(a.href),
      url_en: urlEn(a.href),
    }));
    return enveloppe('chiffres_cles', sujets, []);
  }

  const article = FACTS_ARTICLES.find((a) => a.href === sujet);
  if (!article) return null;

  const extracteur = EXTRACTEURS[sujet];
  const chiffres = extracteur
    ? await lireOuCalculer(cleCache('chiffres_cles', { sujet }), TTL_LONG, extracteur)
    : {};

  const donnees: ChiffresSujet = {
    id: article.href,
    question_fr: QUESTIONS_FR[article.titleKey] ?? '',
    question_en: QUESTIONS_EN[article.titleKey] ?? '',
    chiffres,
    url: urlFr(article.href),
    url_en: urlEn(article.href),
  };

  // Le bloc de méthode pointe l'article lui-même : c'est là que sa méthode est
  // écrite, et l'appelant doit pouvoir y renvoyer son lecteur.
  return enveloppe('chiffres_cles', donnees, [article.href]);
}

// ---------------------------------------------------------------------------
// actualite_parlementaire
// ---------------------------------------------------------------------------

const ARTICLES_ACTUALITE = ['/Facts/taux-promulgation'];

/**
 * Les actes qui méritent d'être rapportés comme une étape franchie.
 *
 * Les dépôts et les décisions reprennent les familles que `/Facts/delais` suit
 * déjà sur cette table, lectures uniques et navettes comprises : la liste tenue
 * à la main ratait la lecture unique, qui pèse 112 actes sur 2026, davantage que
 * les dépôts du Sénat sur la même période.
 *
 * `PROM-PUB` et non `PROM` : les 148 lignes `PROM` n'ont aucune date, quand son
 * jumeau les porte toutes. Comme les bornes filtrent sur `date_acte`, aucune
 * promulgation ne pouvait sortir d'un outil qui les annonce. `Month/monthQueries.ts`
 * et `api/newsletter/_context.ts` utilisent déjà la forme datée.
 *
 * `DECAPP-PUB` complète la fin du parcours, 114 actes sur 2026 : la promulgation
 * n'est pas le dernier mot d'une loi qui attend ses décrets.
 */
const ACTES_MARQUANTS = [
  'AN1-DEPOT', 'AN2-DEPOT', 'ANLDEF-DEPOT', 'ANLUNI-DEPOT', 'ANNLEC-DEPOT',
  'AN1-DEBATS-DEC', 'AN2-DEBATS-DEC', 'ANLDEF-DEBATS-DEC', 'ANLUNI-DEBATS-DEC', 'ANNLEC-DEBATS-DEC',
  'CMP-DEBATS-AN-DEC',
  'SN1-DEPOT', 'SN2-DEPOT', 'SNNLEC-DEPOT',
  'SN1-DEBATS-DEC', 'SN2-DEBATS-DEC', 'SNNLEC-DEBATS-DEC',
  'CMP-DEBATS-SN-DEC',
  'CC-CONCLUSION',
  'PROM-PUB',
  'DECAPP-PUB',
];

export type EvenementParlementaire = {
  dossier_uid: string;
  titre: string | null;
  acte: string | null;
  code_acte: string | null;
  date: string | null;
  url: string;
  url_en: string;
};

/**
 * Bornes de la plage demandée, normalisées.
 *
 * La normalisation n'est pas un confort : c'est elle qui fait la clé de cache.
 * Tous les appels qui portent sur la même semaine tombent sur la même entrée,
 * quel que soit le jour où ils sont faits, là où une plage libre en créerait une
 * par question posée.
 *
 * Le jour de départ est celui de Paris : `actes_legislatifs.date_acte` porte des
 * dates civiles françaises, sans heure, et calculer les bornes sur l'horloge de la
 * machine faisait rendre la semaine précédente en l'annonçant comme celle en cours,
 * chaque lundi entre minuit et deux heures du matin à Paris. Et comme les bornes
 * font la clé de cache, le décalage y survivait six heures.
 *
 * L'arithmétique se fait en UTC sur des composantes déjà parisiennes : à ce
 * stade ce ne sont plus des instants mais des dates civiles, et minuit UTC est
 * le seul point qui ne change ni de jour ni de jour de semaine au formatage.
 */
function bornes(periode: 'semaine' | 'mois', decalage: number): { debut: string; fin: string } {
  const { annee, mois, jour } = aujourdhuiAParis();
  if (periode === 'mois') {
    const debut = new Date(Date.UTC(annee, mois - 1 - decalage, 1));
    const fin = new Date(Date.UTC(debut.getUTCFullYear(), debut.getUTCMonth() + 1, 1));
    return { debut: debut.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
  }
  // Semaine ISO : on recule jusqu'au lundi, puis du nombre de semaines demandé.
  const aujourdhui = new Date(Date.UTC(annee, mois - 1, jour));
  const depuisLundi = (aujourdhui.getUTCDay() + 6) % 7;
  const lundi = new Date(Date.UTC(annee, mois - 1, jour - depuisLundi - 7 * decalage));
  const fin = new Date(lundi.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { debut: lundi.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

type ActeRow = {
  dossier_uid: string;
  code_acte: string | null;
  libelle_acte: string | null;
  date_acte: string | null;
  dossier: { titre: string | null; hors_liste: boolean | null };
};

/** Ce qui a bougé au Parlement sur une semaine ou un mois. */
export async function actualiteParlementaire(
  periode: 'semaine' | 'mois',
  decalage: number,
  limite: number,
): Promise<Enveloppe<EvenementParlementaire[]>> {
  const n = Math.min(limite, 20);
  const { debut, fin } = bornes(periode, decalage);

  const lignes = await lireOuCalculer(
    cleCache('actualite', { debut, fin, n }),
    TTL_COURT,
    // La jointure interne écarte l'acte dont le dossier manque ou est hors liste ;
    // `dossier` est un objet jsonb, la forme qu'attendent les appelants.
    // hors_liste : dossiers comptés dans le score mais absents des listes (migration 2026-10-29_dossiers_hors_liste.sql).
    () => sql<ActeRow[]>`
      select a.dossier_uid, a.code_acte, a.libelle_acte, a.date_acte,
        jsonb_build_object('titre', d.titre, 'hors_liste', d.hors_liste) as dossier
      from actes_legislatifs a
      join dossiers_legislatifs d on d.uid = a.dossier_uid and d.hors_liste = false
      where a.code_acte = any(${ACTES_MARQUANTS})
        and a.date_acte >= ${debut}
        and a.date_acte < ${fin}
      order by a.date_acte desc, a.uid
      limit ${n + 1}`.then((r) => r as ActeRow[]),
  );

  const coupe = lignes.length > n;
  const evenements: EvenementParlementaire[] = lignes.slice(0, n).map((a) => {
    return {
      dossier_uid: a.dossier_uid,
      titre: a.dossier.titre ?? null,
      acte: a.libelle_acte,
      code_acte: a.code_acte,
      date: a.date_acte,
      url: urlFr(`/dossiers-legislatifs/${a.dossier_uid}/resume-ia`),
      url_en: urlEn(`/dossiers-legislatifs/${a.dossier_uid}/resume-ia`),
    };
  });

  const tronque: Troncature | undefined = coupe ? troncature(n) : undefined;
  return enveloppe('actualite_parlementaire', evenements, ARTICLES_ACTUALITE, tronque);
}
