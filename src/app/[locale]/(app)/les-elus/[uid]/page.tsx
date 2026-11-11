// Fiche d'un élu, `/les-elus/[uid]` : Server Component qui rassemble profil,
// textes, score d'activité, votes, accord de vote avec chaque groupe, questions,
// interventions, transparence et élection d'origine du siège, puis passe le tout
// à `EluProfileClient`.
export const revalidate = 86400;
export const dynamic = 'force-static';
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

import { notFound } from 'next/navigation';
import { estUidElu } from '@/lib/uid-fiches';
import { premierDebutPeriode } from '@/lib/mandat-actuel';
import { aujourdhuiAParisIso } from '@/lib/jour-paris';
import { sql, auPlusUneLigne } from '@/lib/db';
import { filtreParolesElu } from '@/lib/debats-texte';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import EluProfileClient from './EluProfileClient';
import type { AffinitesVote, DateMandat, LienWikipedia, MandatTermine, NatureMandat, Paroles } from './EluRows';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { lireAccordsGroupes } from '@/lib/affinites-vote';
import { dernierGroupe, estAncienElu, roleQuitte, type DrapeauxMandat } from '@/lib/ancien-elu';
import { estOrigineGouvernementale } from '@/lib/origine-gouvernementale';
import { amendementsAvecVote } from '@/lib/scrutin-votes';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { libelleTheme } from '@/lib/themes-dossiers';
import { fonctionsDeLigne, mesuresDeLigne, type FonctionKey, type MetricKey } from '@/lib/activite-weights';
import { LEGISLATURE_17_START } from '@/lib/facts-shared';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { echeanceSituation, enVigueur, motifSituation, type SituationCumul } from '@/lib/mandats-locaux';
import { choisirElection, preparerElection, type ElectionEluBrute } from '@/lib/election-affichage';

/**
 * Fonction au Bureau de la chambre (« Président », « Questeur »…), ou `null`
 * pour l'immense majorité des élus qui n'en ont pas. Rendue en seconde pastille
 * de mandat, avec son libellé long en infobulle.
 *
 * Deux sources, parce que le même champ ne dit pas la même chose des deux
 * côtés : au Sénat, `qualite_actuelle` porte la fonction (« Président »,
 * « Vice-président », « Questeur », « Secrétaire », sinon « SENATEUR ») ; à
 * l'Assemblée il vaut « membre » ou « en mission » pour les 577, et la fonction
 * vit dans `mandats`, sur le mandat de type BUREAU resté ouvert.
 *
 * Les fonctions d'âge sont écartées : « Président d'âge » et « Secrétaire
 * d'âge » ne durent que la séance d'ouverture de la législature, mais l'open
 * data de l'Assemblée ne leur pose jamais de `dateFin` (5 députés concernés au
 * 2026-09-05). Les afficher annoncerait une fonction qui n'existe plus.
 *
 * Calculé ici, côté serveur, pour que le jsonb `mandats` ne parte pas au
 * navigateur : seule la chaîne extraite traverse.
 */
function fonctionBureau(acteur: {
  est_senateur_actuel?: boolean | null;
  est_depute_actuel?: boolean | null;
  qualite_actuelle?: string | null;
  mandats?: unknown;
}): { court: string; long: string } | null {
  if (acteur.est_senateur_actuel) {
    const q = acteur.qualite_actuelle?.trim();
    if (!q || q.toUpperCase() === 'SENATEUR') return null;
    return { court: q, long: `${q} du Sénat` };
  }

  if (acteur.est_depute_actuel && Array.isArray(acteur.mandats)) {
    for (const m of acteur.mandats as Record<string, unknown>[]) {
      if (m?.typeOrgane !== 'BUREAU' || m?.dateFin) continue;
      const infos = m.infosQualite as { libQualite?: string } | undefined;
      const long = infos?.libQualite?.trim();
      if (!long || /\bd'âge\b/i.test(long)) continue;
      // « Président de l'Assemblée nationale » → « Président » : la pastille
      // voisine dit déjà « Député », le libellé complet reste en infobulle.
      return { court: long.replace(/\s+de l'Assemblée nationale$/i, ''), long };
    }
  }

  return null;
}

/**
 * Les mandats nationaux en cours, tirés du jsonb `mandats` et rangés du plus
 * structurant au plus accessoire.
 *
 * Le rang ordonne chaque bloc de la fiche, du plus structurant au plus
 * accessoire. Le fil montre les cinq premières lignes des deux premiers blocs
 * non vides, mandats et fonctions le plus souvent ; les appartenances (une
 * dizaine de groupes d'amitié et autant de groupes d'études chez un député)
 * restent alors dans le tiroir.
 *
 * `cle` porte une clé de traduction et non un libellé : « Commission
 * permanente » doit devenir « Standing committee » côté anglais. Les types que
 * ce tableau ne nomme pas retombent sur `autre`, ce qui vaut mieux qu'un code
 * d'organe affiché tel quel.
 *
 * `nature` range la ligne dans l'un des trois blocs de la fiche. Additionnés
 * sous le seul mot « mandats », un député affichait « 24 mandats en cours »
 * (Éric Ciotti) alors qu'il n'en détient qu'un au sens du cumul, plus ses
 * mandats locaux : le reste est ce qu'il fait dans sa chambre (`fonction`) ou
 * ce dont il est membre sans y exercer de pouvoir de décision (`appartenance`).
 */
const TYPES_MANDAT: Record<string, { cle: string; rang: number; nature: NatureMandat }> = {
  ASSEMBLEE: { cle: 'chambre', rang: 0, nature: 'mandat' },
  SENAT: { cle: 'chambre', rang: 0, nature: 'mandat' },
  GP: { cle: 'groupe', rang: 1, nature: 'fonction' },
  GROUPESENAT: { cle: 'groupe', rang: 1, nature: 'fonction' },
  COMPER: { cle: 'commission', rang: 2, nature: 'fonction' },
  COMSENAT: { cle: 'commission', rang: 2, nature: 'fonction' },
  COMNL: { cle: 'commissionSpeciale', rang: 3, nature: 'fonction' },
  COMSPSENAT: { cle: 'commissionSpeciale', rang: 3, nature: 'fonction' },
  // Code propre au Sénat : l'Assemblée n'a pas de `typeOrgane` de commission
  // d'enquête, `sync_senat.py` en fabrique un depuis `com.typorgcod`. Sans lui,
  // les commissions d'enquête du Sénat s'afficheraient « Commission
  // permanente », l'import les rangeant toutes sous `COMSENAT` avant.
  COMENQSENAT: { cle: 'commissionEnquete', rang: 4, nature: 'fonction' },
  BUREAU: { cle: 'bureau', rang: 5, nature: 'fonction' },
  DELEGBUREAU: { cle: 'bureau', rang: 5, nature: 'fonction' },
  GOUVERNEMENT: { cle: 'gouvernement', rang: 6, nature: 'fonction' },
  MINISTERE: { cle: 'gouvernement', rang: 6, nature: 'fonction' },
  DELEG: { cle: 'delegation', rang: 7, nature: 'fonction' },
  DELEGSENAT: { cle: 'delegation', rang: 7, nature: 'fonction' },
  OFFPAR: { cle: 'office', rang: 8, nature: 'fonction' },
  CMP: { cle: 'cmp', rang: 9, nature: 'fonction' },
  MISINFO: { cle: 'mission', rang: 10, nature: 'fonction' },
  MISINFOPRE: { cle: 'mission', rang: 10, nature: 'fonction' },
  MISINFOCOM: { cle: 'mission', rang: 10, nature: 'fonction' },
  API: { cle: 'international', rang: 11, nature: 'appartenance' },
  ORGEXTPARL: { cle: 'extraParlementaire', rang: 12, nature: 'appartenance' },
  GE: { cle: 'groupeEtudes', rang: 13, nature: 'appartenance' },
  GEVI: { cle: 'groupeEtudes', rang: 13, nature: 'appartenance' },
  GA: { cle: 'groupeAmitie', rang: 14, nature: 'appartenance' },
  PARPOL: { cle: 'parti', rang: 15, nature: 'appartenance' },
};

const RANG_AUTRE = 16;

/**
 * Un type absent du tableau compte comme une fonction : ceux qu'on trouve sur
 * les mandats ouverts des élus en exercice (mesuré au 2026-09-15) sont `CNPS`
 * et `CNPE`, commissions spéciales et d'enquête de l'Assemblée, et `CONFPT`,
 * la Conférence des présidents, tous des organes où l'élu siège.
 */
const NATURE_AUTRE: NatureMandat = 'fonction';

export type MandatNational = {
  id: string;
  categorie: string;
  nature: NatureMandat;
  libelle: string | null;
  qualite: string | null;
  dateDebut: string | null;
};

/**
 * Nettoie le nom d'un organe de ses précisions d'archivage. L'open data
 * distingue « Assemblée nationale de la 17ème législature » de celle d'avant, et
 * « Sénat (5ème République) » des Sénats des républiques précédentes. C'est
 * exact et sans intérêt en tête d'une liste de mandats tous en cours.
 */
function nettoyerLibelleOrgane(libelle: string): string {
  return libelle
    .replace(/\s*\(\s*\d+\s*(?:è|e|ème|eme)?\s*République\s*\)$/i, '')
    .replace(/\s+de la \d+\s*(?:è|e|ème|eme)?\s*législature$/i, '')
    .trim();
}

/**
 * La qualité exercée dans l'organe, si elle distingue vraiment son titulaire.
 *
 * Deux nettoyages, dans cet ordre. L'open data écrit « Président du » ou
 * « Membre de la » : l'article traîne parce que le nom de l'organe est censé
 * suivre, ce qui n'est pas le cas dans une pastille. Puis « Membre »,
 * « SENATEUR », « Député » tombent : c'est la qualité de l'immense majorité
 * des lignes, et la pastille de type le dit déjà. « Membre suppléant », lui,
 * reste : il dit quelque chose que les autres lignes ne disent pas.
 */
function qualiteSignificative(qualite: string | null): string | null {
  if (!qualite) return null;
  const propre = qualite.replace(/\s+(du|de la|de l'|des|de)$/i, '').trim();
  return /^(membre|s[ée]nateur|d[ée]put[ée])$/i.test(propre) ? null : propre || null;
}

/**
 * Une ligne de `mandats_senat` : les mandats internes au Sénat, que le dump du
 * Sénat publie et que l'open data de l'Assemblée, d'où vient le jsonb, résume à
 * une commission par sénateur.
 */
export type MandatSenatRow = {
  type: string;
  libelle: string;
  qualite: string | null;
  date_debut: string | null;
};

/**
 * Les types du jsonb que la source Sénat reprend intégralement. Dès qu'un
 * sénateur a des lignes dans `mandats_senat`, ceux-là sortent du jsonb : les
 * deux sources décrivent les mêmes organes sous des libellés différents
 * (« Commission de l'aménagement du territoire et du développement durable »
 * d'un côté, « Développement durable » de l'autre), donc en doublons qu'aucune
 * déduplication automatique ne peut reconnaître.
 *
 * `API` et `OFFPAR` en font partie : la table `delega` du Sénat, qui alimente
 * nos lignes `DELEGSENAT`, contient aussi les assemblées internationales et les
 * offices. Le recouvrement est total et les libellés diffèrent d'une
 * abréviation — « Section française de l'A.P.F. » d'un côté, « Section
 * française de l'Assemblée parlementaire de la francophonie » de l'autre — donc
 * 127 sénateurs verraient deux lignes pour le même siège. Prix payé : les six
 * sénateurs du « Groupe de travail sur les droits et libertés constitutionnels
 * à l'ère numérique », seul organe `OFFPAR` sans équivalent côté Sénat.
 *
 * `MISINFOCOM` en fait partie depuis que `com.typorgcod` distingue les natures
 * de commission : les missions communes d'information du Sénat arrivent
 * désormais sous ce code. Il ne filtre rien aujourd'hui, aucun sénateur en
 * exercice n'en portant dans le jsonb, mais une mission commune est par nature
 * partagée avec l'Assemblée, donc le premier cas produirait deux lignes.
 *
 * `CMP` reste, lui : aucune commission mixte paritaire ne survit aux filtres de
 * `import_mandats_senat`, leurs appartenances étant toutes closes.
 *
 * La chambre (`SENAT`) et le groupe politique (`GROUPESENAT`) restent au jsonb :
 * le dump du Sénat ne les publie pas dans ce périmètre.
 */
const TYPES_REPRIS_PAR_SENAT = new Set([
  'COMSENAT', 'COMSPSENAT', 'MISINFOCOM', 'DELEGSENAT', 'ORGEXTPARL', 'GE', 'GEVI', 'GA',
  'API', 'OFFPAR',
]);

function mandatsNationaux(
  mandats: unknown,
  libelleParOrgane: Map<string, string>,
  mandatsSenat: MandatSenatRow[] = [],
): MandatNational[] {
  const remplaceParLeSenat = mandatsSenat.length > 0;

  const lignesJsonb = (Array.isArray(mandats) ? (mandats as Record<string, unknown>[]) : [])
    .filter((m) => !(remplaceParLeSenat
      && typeof m?.typeOrgane === 'string'
      && TYPES_REPRIS_PAR_SENAT.has(m.typeOrgane)))
    .map((m) => {
      const type = typeof m?.typeOrgane === 'string' ? m.typeOrgane : '';
      const connu = TYPES_MANDAT[type];
      const organes = m.organes as { organeRef?: string } | undefined;
      const infos = m.infosQualite as { libQualite?: string } | undefined;
      const qualite = infos?.libQualite?.trim() || null;
      const libelle = organes?.organeRef ? libelleParOrgane.get(organes.organeRef) ?? null : null;
      return {
        id: typeof m.uid === 'string' ? m.uid : `${type}-${organes?.organeRef ?? ''}`,
        organeRef: organes?.organeRef ?? '',
        categorie: connu?.cle ?? 'autre',
        nature: connu?.nature ?? NATURE_AUTRE,
        libelle: libelle ? nettoyerLibelleOrgane(libelle) : null,
        qualite: qualiteSignificative(qualite),
        dateDebut: typeof m.dateDebut === 'string' ? m.dateDebut : null,
        rang: connu?.rang ?? RANG_AUTRE,
      };
    });

  // Les lignes du Sénat prennent la même forme intermédiaire, pour que le tri
  // et la déduplication ci-dessous travaillent sur l'ensemble sans savoir d'où
  // vient quoi. `mandats_senat` reprend les codes `typeOrgane` de l'Assemblée :
  // `TYPES_MANDAT` les traduit donc sans nouvelle clé de traduction.
  const lignesSenat = mandatsSenat.map((m) => {
    const connu = TYPES_MANDAT[m.type];
    // Pas de référence d'organe côté Sénat : la clé primaire de la table fait
    // déjà l'unicité, on la reprend telle quelle comme identité de ligne.
    const id = `SEN-${m.type}-${m.libelle}`;
    return {
      id,
      organeRef: id,
      categorie: connu?.cle ?? 'autre',
      nature: connu?.nature ?? NATURE_AUTRE,
      libelle: m.libelle,
      qualite: qualiteSignificative(m.qualite),
      dateDebut: m.date_debut,
      rang: connu?.rang ?? RANG_AUTRE,
    };
  });

  const lignes = [...lignesJsonb, ...lignesSenat]
    .sort((a, b) => a.rang - b.rang || (a.libelle ?? '').localeCompare(b.libelle ?? ''));

  // Un même organe porte souvent deux mandats ouverts : l'appartenance et la
  // fonction qu'on y exerce. Un président de groupe en a un « Membre du » et un
  // « Président du », qui produiraient deux lignes jumelles dont l'une ne dirait
  // rien. On n'en garde qu'une, celle qui porte la fonction.
  const parOrgane = new Map<string, (typeof lignes)[number]>();
  for (const ligne of lignes) {
    const cle = ligne.organeRef || ligne.id;
    const retenue = parOrgane.get(cle);
    if (!retenue || (!retenue.qualite && ligne.qualite)) parOrgane.set(cle, ligne);
  }

  return Array.from(parOrgane.values())
    .sort((a, b) => a.rang - b.rang || (a.libelle ?? '').localeCompare(b.libelle ?? ''))
    .map((m) => ({
      id: m.id,
      categorie: m.categorie,
      nature: m.nature,
      libelle: m.libelle,
      qualite: m.qualite,
      dateDebut: m.dateDebut,
    }));
}

/**
 * La date qui ouvre le mandat en cours, et ce qu'elle veut dire : la même date,
 * sous le même libellé, en tête de fiche et sur la ligne de chambre de la liste
 * des mandats. Trois dates différentes s'y côtoyaient avant, sans que rien ne
 * dise laquelle était quoi.
 *
 * `election` pour un député élu, aux élections générales ou à une partielle :
 * c'est alors `dateDebut` du mandat ASSEMBLEE, le jour du scrutin (30 juin ou
 * 7 juillet 2024 pour les générales). Un ancien ministre revenu siéger compte
 * aussi comme élu, sa date restant celle de son élection.
 *
 * `fonction` sinon, avec `date_debut_mandat` (la prise de fonction effective) :
 * - pour un suppléant (`causeMandat` « remplacement d'un député… »), dont
 *   `dateDebut` porte l'élection de son titulaire et non son arrivée ;
 * - pour un sénateur, dont l'open data ne publie pas la cause du mandat et dont
 *   `dateDebut` est l'installation (le plus souvent 1ᵉʳ octobre 2020 ou
 *   2 octobre 2023), pas le jour du scrutin, et varie d'une ligne à l'autre
 *   quand deux mandats SENAT restent ouverts.
 *
 * `null` hors mandat parlementaire : chez un ministre, `date_debut_mandat` garde
 * la prise de fonction de l'ancien mandat de député, qu'afficher à côté de
 * « Ministre » ferait lire comme le début de ses fonctions au Gouvernement.
 */
function dateDuMandat(acteur: {
  est_depute_actuel?: boolean | null;
  est_senateur_actuel?: boolean | null;
  date_debut_mandat?: string | null;
  mandats?: unknown;
}): DateMandat | null {
  if (!acteur.est_depute_actuel && !acteur.est_senateur_actuel) return null;

  if (acteur.est_depute_actuel && Array.isArray(acteur.mandats)) {
    const siege = (acteur.mandats as Record<string, unknown>[])
      .find((m) => m?.typeOrgane === 'ASSEMBLEE' && !m?.dateFin);
    const cause = (siege?.election as { causeMandat?: string } | undefined)?.causeMandat?.trim();
    if (siege && typeof siege.dateDebut === 'string' && cause && !/^remplacement/i.test(cause)) {
      return { date: siege.dateDebut, nature: 'election' };
    }
  }

  return acteur.date_debut_mandat ? { date: acteur.date_debut_mandat, nature: 'fonction' } : null;
}

/**
 * Le mandat que l'élu a quitté, pour la fiche d'un ancien élu (`estAncienElu`) :
 * la pastille « Ancien député » et, quand elle est connue, la date de fin. `null`
 * pour un élu en exercice, un ministre ou le Président de la République.
 *
 * Le rôle se lit dans `roles_text` (`roleQuitte`), qui porte tous les mandats passés,
 * parce que le jsonb `mandats` ne garde pas toujours l'ancien siège (Harold Huwart,
 * député jusqu'au 2026-07-25, n'y a plus que son parti). La date est la fin la plus
 * récente de `periodes_mandat_assemblee`, qui
 * garde les deux chambres pour un ancien élu ; elle n'est connue que pour 142 des
 * 2 221 anciens élus au 2026-10-26 ; sans elle, le bandeau ne donne pas de date.
 */
function mandatTermine(acteur: DrapeauxMandat & {
  roles_text?: string | null;
  periodes_mandat_assemblee?: unknown;
}): MandatTermine | null {
  // `estAncienElu` écarte aussi le Président de la République en exercice.
  if (!estAncienElu(acteur)) return null;
  const role = roleQuitte(acteur.roles_text);
  const fins = (Array.isArray(acteur.periodes_mandat_assemblee) ? acteur.periodes_mandat_assemblee as PeriodeMandat[] : [])
    .map((p) => p?.fin)
    .filter((f): f is string => typeof f === 'string' && f.length > 0)
    .sort();
  const parlementaire = role === 'depute' || role === 'senateur' || role === 'parlementaire';
  return { role, fin: parlementaire ? fins.at(-1) ?? null : null };
}

/**
 * Bornes du décompte des jours actifs, recopiées de `activite_elus_mv`
 * (migration `2026-09-09_dossiers_inities_tous_auteurs.sql`) : ouverture de la
 * 17ᵉ législature à l'Assemblée, dernier renouvellement au Sénat. À changer
 * avec la vue, sinon la fiche annonce un décompte que le score ne fait pas.
 */
const DEBUT_DECOMPTE: Record<'AN' | 'SN', string> = { AN: LEGISLATURE_17_START, SN: '2023-10-02' };

/**
 * Procédure Haute Cour, écartée des dossiers déposés comme dans `activite_elus_mv` :
 * l'article 68 impose la signature d'un dixième des membres, et la source les liste
 * tous comme auteurs du texte de dépôt. Seul l'initiateur déclaré compte.
 */
const PROCEDURE_HAUTE_COUR = 'Responsabilité pénale du président de la république';

/** Une période de mandat effective dans la chambre, telle qu'écrite par l'import. */
type PeriodeMandat = { debut?: string | null; fin?: string | null };

/**
 * La date d'où partent les jours actifs affichés sur la fiche, calculée comme la
 * vue `activite_elus_mv` : le début de la première période de mandat qui court
 * encore à la borne de la chambre, ramené à cette borne ; sans période, la prise
 * de fonction si elle est plus tardive que la borne.
 *
 * Prendre la prise de fonction seule datait mal les anciens ministres : l'import
 * la garde au mandat rouvert à leur retour, pendant que la vue compte aussi leurs
 * jours d'avant le Gouvernement (« 984 jours actifs comptés depuis le 24 janvier
 * 2025 » chez Agnès Canayer, qui siège depuis 2023). Comparaisons de chaînes ISO,
 * donc chronologiques.
 */
function debutDuDecompte(
  chambre: 'AN' | 'SN',
  dateDebutMandat: string | null,
  periodes: PeriodeMandat[] | null | undefined,
): string {
  const borne = DEBUT_DECOMPTE[chambre];
  // Une période sans début part de la borne, comme `GREATEST(debut, borne)` dans la
  // vue, qui ignore un NULL : l'écarter ferait retomber la fiche sur la prise de fonction.
  const debuts = (periodes ?? [])
    .filter((p) => !p.fin || p.fin > borne)
    .map((p) => (p.debut && p.debut > borne ? p.debut : borne))
    .sort();
  const depart = debuts[0] ?? dateDebutMandat;
  return depart && depart > borne ? depart : borne;
}

/**
 * Le début de la fenêtre où se comptent les dossiers déposés et les rapports d'un élu
 * en exercice, recopié du `debut_fenetre` de `activite_elus_mv` (migration
 * `2026-10-15_activite_mandat_chambre_actuelle.sql`) : la plus tardive entre la borne
 * de sa chambre et le premier début de ses périodes de mandat, la prise de fonction à
 * défaut de période. À changer avec la vue, sinon « Ses textes » et le score ne
 * comptent plus les mêmes dossiers. `null` hors mandat parlementaire (ministre, ancien
 * élu) : sans mandat en cours, la section garde tout son historique.
 *
 * Ce n'est pas `debutDuDecompte`, qui écarte les périodes closes avant la borne. Les
 * deux divergent chez un élu dont une période s'est close avant la borne : le décompte
 * des jours part de la période suivante, la fenêtre de la borne, comme dans la vue.
 */
function debutFenetre(acteur: {
  est_depute_actuel?: boolean | null;
  est_senateur_actuel?: boolean | null;
  date_debut_mandat?: string | null;
  periodes_mandat_assemblee?: unknown;
}): string | null {
  if (!acteur.est_depute_actuel && !acteur.est_senateur_actuel) return null;
  const borne = DEBUT_DECOMPTE[acteur.est_depute_actuel ? 'AN' : 'SN'];
  // `min()` de la vue ignore un début NULL, et rend NULL sans période : alors la prise
  // de fonction prend le relais, comme son `COALESCE`.
  const premier = premierDebutPeriode(acteur.periodes_mandat_assemblee)
    ?? acteur.date_debut_mandat?.slice(0, 10) ?? null;
  return premier && premier > borne ? premier : borne;
}

/** Une intervention réduite à son dossier et à sa date de séance. */
type LigneDateIntervention = {
  id: number;
  dossier_uid: string;
  seance: unknown;
};

/**
 * La date nue de la séance jointe : un objet, ou `null` quand la séance manque
 * (sous-requête corrélée de la lecture des interventions).
 */
function dateDeSeance(seance: unknown): string | null {
  return (seance as { date_seance?: string | null } | null | undefined)?.date_seance ?? null;
}

/**
 * Le début du mandat dans la chambre actuelle d'un élu en exercice qui a siégé dans
 * l'autre, ou `null`. Sa fiche cache ce qui précède (D-239) : votes, prises de
 * parole, textes et questions de son ancien mandat. `roles_text` porte tous les
 * mandats, anciens compris, et `periodes_mandat_assemblee` les seules périodes de la
 * chambre actuelle. Ni la chambre d'un dossier ni celle de ses textes ne servent :
 * un dossier né au Sénat commence souvent par un texte de l'Assemblée, et un organe
 * commun aux deux chambres publie côté Assemblée des rapports de sénateurs.
 */
function debutApresChangement(acteur: {
  est_depute_actuel?: boolean | null;
  est_senateur_actuel?: boolean | null;
  roles_text?: string | null;
  periodes_mandat_assemblee?: unknown;
}): string | null {
  const roles = acteur.roles_text ?? '';
  const aChange = (acteur.est_depute_actuel && roles.includes('Sénat'))
    || (acteur.est_senateur_actuel && roles.includes('Député'));
  if (!aChange) return null;
  return premierDebutPeriode(acteur.periodes_mandat_assemblee);
}

/**
 * Les cinq dossiers sur lesquels l'élu est intervenu le plus récemment, classés
 * par la date de sa dernière séance sur chacun. Deux dossiers débattus le même
 * jour se départagent par leur `uid`, pour que la fiche ne change pas d'ordre
 * d'une régénération à l'autre. Appelée par la page avec toutes les lignes de
 * l'élu (dates ISO, donc comparables comme des chaînes).
 */
function cinqDerniersDossiers(lignes: LigneDateIntervention[]): string[] {
  const derniereDate = new Map<string, string>();
  for (const ligne of lignes) {
    const date = dateDeSeance(ligne.seance) ?? '';
    const connue = derniereDate.get(ligne.dossier_uid);
    if (connue === undefined || date > connue) derniereDate.set(ligne.dossier_uid, date);
  }
  return Array.from(derniereDate.entries())
    .sort(([uidA, dateA], [uidB, dateB]) => dateB.localeCompare(dateA) || uidA.localeCompare(uidB))
    .slice(0, 5)
    .map(([dossierUid]) => dossierUid);
}

/** Wikimédia demande un User-Agent nominatif, le même que `enrich_wikipedia_acteurs.py`. */
const USER_AGENT_WIKIMEDIA = 'LoiClairBot/1.0 (https://loiclair.fr; contact@loiclair.fr)';

/**
 * Le lien « Article Wikipédia » de la fiche, dans la langue de l'interface quand
 * l'article existe (EL-01). La fiche ne reprend plus aucun texte de Wikipédia :
 * l'extrait qualifiait certains élus et pas d'autres selon ce que ses
 * contributeurs avaient écrit, et restait en français sur la version anglaise.
 *
 * `titreFr` vient de `acteurs.wikipedia_titre`, résolu chaque nuit par identifiant
 * officiel et jamais par le nom (D-154) : c'est l'article français. Hors
 * français, les liens interlangues de cet article donnent le titre local ; faute
 * d'article, ou si Wikipédia ne répond pas, le lien retombe sur l'article
 * français et `repliFrancais` le signale au libellé. Mise en cache un jour,
 * comme la page.
 */
async function lienWikipedia(titreFr: string, locale: string): Promise<LienWikipedia> {
  const francais: LienWikipedia = {
    url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(titreFr)}`,
    repliFrancais: locale !== 'fr',
  };
  if (locale === 'fr') return francais;

  try {
    const params = new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', redirects: '1',
      prop: 'langlinks', lllang: locale, titles: titreFr,
    });
    const res = await fetch(`https://fr.wikipedia.org/w/api.php?${params}`, {
      headers: { 'User-Agent': USER_AGENT_WIKIMEDIA },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return francais;
    const d = await res.json() as { query?: { pages?: { langlinks?: { lang: string; title: string }[] }[] } };
    const titreLocal = d.query?.pages?.[0]?.langlinks?.find((l) => l.lang === locale)?.title;
    if (!titreLocal) return francais;
    return {
      url: `https://${locale}.wikipedia.org/wiki/${encodeURIComponent(titreLocal.replace(/ /g, '_'))}`,
      repliFrancais: false,
    };
  } catch {
    return francais;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; uid: string }> }): Promise<Metadata> {
  const { locale, uid } = await params;
  if (!estUidElu(uid)) notFound();
  setRequestLocale(locale);
  // `auPlusUneLigne` : une panne lève et la régénération garde la page précédente,
  // au lieu de figer le titre « Élu introuvable » (D-136). Une fiche marquée par
  // `/api/revalidate` n'en a plus et rend une erreur le temps de la panne.
  const data = await auPlusUneLigne(sql<({ prenom: string | null; nom: string | null } & DrapeauxMandat)[]>`
    select prenom, nom, est_depute_actuel, est_senateur_actuel, est_ministre_actuel, roles_text
    from acteurs where uid = ${uid}`, 'acteurs (métadonnées)');
  const t = await getTranslations({ locale, namespace: 'elus' });
  if (!data) return { title: t('metaProfileNotFound') };
  const nom = `${data.prenom} ${data.nom}`;
  const title = `${nom} — LoiClair`;
  const description = t('metaProfileDescription', { nom });
  return {
    title,
    description,
    // La fiche d'un ancien élu porte son e-mail et son téléphone : elle reste en ligne
    // parce qu'elle n'est pas indexée (D-234), et `sitemap.ts` applique la même règle.
    // Sans canonical, que Google déconseille d'associer à `noindex`.
    ...(estAncienElu(data)
      ? { robots: { index: false, follow: true } }
      : { alternates: buildAlternates(locale, `/les-elus/${uid}`) }),
    openGraph: buildOpenGraph(locale, `/les-elus/${uid}`, title, description),
  };
}

export default async function EluProfilePage({ params }: { params: Promise<{ locale: string; uid: string }> }) {
  const { locale, uid } = await params;
  if (!estUidElu(uid)) notFound();
  setRequestLocale(locale);

  type Props = React.ComponentProps<typeof EluProfileClient>;
  // Les colonnes de `acteurs` que la page lit elle-même ; les autres traversent
  // telles quelles vers le client.
  type ActeurLigne = Record<string, unknown> & {
    uid: string;
    civ: string | null;
    est_depute_actuel: boolean | null;
    est_senateur_actuel: boolean | null;
    est_ministre_actuel: boolean | null;
    qualite_actuelle: string | null;
    date_debut_mandat: string | null;
    periodes_mandat_assemblee: unknown;
    roles_text: string | null;
    organes_refs: string[] | null;
    wikipedia_titre: string | null;
    mandats: unknown;
    historique_groupes: unknown;
    groupe: Record<string, unknown> | null;
  };
  type Moyennes = {
    taux_participation_votes_finaux_moyen: number | null;
    taux_participation_votes_solennels_moyen: number | null;
    taux_cohesion_moyen: number | null;
    // Absente de `get_senate_averages` : le taux de délégation n'est calculé que pour les députés.
    taux_delegation_moyen?: number | null;
  };

  const [acteur, dossiersInitiesRows, textesCoauteurRows, assemblyAvg, senateAvg, activiteLigne, questionsRows, datesInterventionsRows, votesNominatifRows, actesMappingRows, mandatsLocaux, transparenceRows, hatvp, mandatsSenatRows, verificationCumul, situationCumul, amendementsRows, themesRows, electionRows] = await Promise.all([
    // `auPlusUneLigne` et non `uneLigne` : un élu absent rend `null`, et une panne
    // lève, pour qu'on distingue un vrai 404 d'une panne. `groupe` garde la forme et
    // la place que la page attend : un objet (ou `null` pour un élu sans groupe), rangé
    // après les colonnes simples. Tous les objets joints de cette page sont des
    // `jsonb_build_object` et non des `json_build_object` : leurs clés sortent dans
    // l'ordre d'un jsonb (par longueur, puis alphabétique), pas dans celui du select,
    // et cet ordre part tel quel dans le HTML (constaté le 2026-11-05).
    auPlusUneLigne(sql<ActeurLigne[]>`
      select a.uid, a.prenom, a.nom, a.civ, a.age,
        a.libelle_profession, a.departement_election, a.num_departement, a.num_circo,
        a.taux_participation_votes_finaux, a.taux_participation_votes_solennels, a.taux_cohesion_groupe,
        a.scrutins_finaux_pendant_mandat, a.scrutins_solennels_pendant_mandat, a.votes_actifs_importants,
        a.votes_finaux_solennels, a.votes_delegues, a.taux_delegation,
        a.place_hemicycle,
        a.nb_amendements_auteur, a.nb_amendements_cosignataire, a.amendements_par_sort,
        a.email, a.telephone, a.profil_url, a.twitter_url, a.instagram_url, a.facebook_url, a.linkedin_url,
        a.url_profil_officiel, a.wikipedia_titre, a.adresse_circonscription,
        a.est_depute_actuel, a.est_senateur_actuel, a.est_ministre_actuel,
        a.qualite_actuelle, a.date_debut_mandat, a.periodes_mandat_assemblee, a.roles_text, a.organes_refs, a.mandats,
        a.historique_groupes,
        (select jsonb_build_object(
          'uid', o.uid, 'libelle', o.libelle, 'libelle_abrege', o.libelle_abrege, 'couleur_associee', o.couleur_associee,
          'taux_participation_votes_finaux_moyen', o.taux_participation_votes_finaux_moyen,
          'taux_participation_votes_solennels_moyen', o.taux_participation_votes_solennels_moyen,
          'taux_delegation_moyen', o.taux_delegation_moyen,
          'taux_cohesion_interne', o.taux_cohesion_interne
        ) from organes o where o.uid = a.groupe) as groupe
      from acteurs a
      where a.uid = ${uid}`, 'acteurs'),
    // Les deux listes du tiroir « Ses textes » arrivent entières (D-329) : un
    // `.limit(20)` et un `.limit(50)` sans tri y coupaient au hasard, à 27 dossiers
    // déposés pour Éric Ciotti et 111 textes pour Agnès Canayer (2026-09-15). Le tri
    // en base, clé primaire en dernier, ne fait que fixer l'ordre de lecture : l'ordre
    // affiché est refait plus bas (`parDateAffichee`). `initiateur`, comme `groupe`
    // plus haut, reprend l'objet de l'ancienne jointure, après les colonnes simples.
    sql<InitieRow[]>`
      select d.uid, d.titre, d.titre_en, d.statut_final, d.procedure_libelle, d.date_depot, d.date_promulgation,
        d.textes_associes_refs,
        (select jsonb_build_object('prenom', a.prenom, 'nom', a.nom)
          from acteurs a where a.uid = d.initiateur_acteur_ref) as initiateur
      from dossiers_legislatifs d
      where d.initiateur_acteur_ref = ${uid}
      order by d.date_depot desc nulls last, d.uid`,
    // L'uid est un paramètre de la requête : aucune valeur ne peut élargir le filtre.
    sql<TexteCoauteurRow[]>`
      select t.uid, t.denomination, t.type_libelle, t.auteurs_refs, t.cosignataires_refs, t.rapporteurs_refs,
        t.dossier_ref, t.depot_code, t.date_depot, t.chambre,
        (select jsonb_build_object(
          'uid', d.uid, 'titre', d.titre, 'titre_en', d.titre_en, 'statut_final', d.statut_final,
          'procedure_libelle', d.procedure_libelle, 'date_depot', d.date_depot,
          'date_promulgation', d.date_promulgation, 'textes_associes_refs', d.textes_associes_refs,
          'initiateur', (select jsonb_build_object('prenom', a.prenom, 'nom', a.nom)
            from acteurs a where a.uid = d.initiateur_acteur_ref)
        ) from dossiers_legislatifs d where d.uid = t.dossier_ref) as dossier
      from textes t
      where (t.auteurs_refs @> array[${uid}]::text[]
          or t.cosignataires_refs @> array[${uid}]::text[]
          or t.rapporteurs_refs @> array[${uid}]::text[])
        and t.dossier_ref is not null
      -- uid est unique sur textes (textes_uid_key) : il suffit à départager.
      order by t.date_depot desc nulls last, t.uid`,
    // Les deux fonctions rendent un jsonb : la valeur seule, pas une ligne.
    sql<{ v: Moyennes | null }[]>`select get_assembly_averages() as v`.then((r) => r[0]?.v ?? null),
    sql<{ v: Moyennes | null }[]>`select get_senate_averages() as v`.then((r) => r[0]?.v ?? null),
    // `*` plutôt qu'une liste de colonnes : une colonne nommée mais absente de la
    // vue fait échouer toute la requête, et la lecture levant (D-136), toute la
    // fiche avec elle. C'est ce qui arrive entre le déploiement du site et la
    // migration qui ajoute la colonne (`est_president_groupe`).
    auPlusUneLigne(sql<Record<string, unknown>[]>`
      select * from activite_elus_mv where uid = ${uid}`, 'activite_elus_mv'),
    // Plafond délibéré (D-329) : le tiroir de la fiche montre au plus 100
    // questions. 37 496 questions en base, 38 par élu en moyenne, mais 1 119
    // pour Hervé Maurey (PA415446) — tout charger gonflerait la charge statique
    // des fiches les plus actives pour une liste que personne ne fait défiler
    // jusqu'au bout. Le compte annoncé sur le bouton vient de la vue
    // d'activité, qui donne le total exact.
    sql<({ date_jo: string | null } & Record<string, unknown>)[]>`
      select uid, type, date_jo, titre, rubrique, ministere, a_reponse, url_source
      from questions
      where uid_auteur = ${uid}
      order by date_jo desc nulls last
      limit 100`,
    // Le dossier et la date de séance de chaque prise de parole de l'élu
    // (`filtreParolesElu`), sans le texte : de quoi retrouver les cinq dossiers
    // débattus le plus récemment
    // (`cinqDerniersDossiers`). Toutes les lignes et non les 100 plus hautes par
    // `id`, qui suit l'ordre d'import et non celui des séances : la fiche de
    // Marine Le Pen listait juin 2026, mai 2026, octobre 2024, avril 2025.
    sql<LigneDateIntervention[]>`
      select i.id, i.dossier_uid,
        (select jsonb_build_object('date_seance', s.date_seance)
          from debat_seances s where s.uid = i.seance_uid) as seance
      from debat_interventions i
      where i.acteur_uid = ${uid}
        and ${filtreParolesElu()}
        and i.dossier_uid is not null
      -- Tri par seance_uid d'abord, pour que Postgres suive l'index
      -- idx_debat_interventions_acteur_seance (acteur_uid, seance_uid)
      -- (pipeline/migrations/2026-04-15_debats_parlementaires.sql). Trié par id seul,
      -- il parcourait toute la table par la clé primaire : 254 000 lignes lues pour en
      -- garder 155 sur PA703511, jusqu'à 8 s. Mesuré le 2026-10-28 : de 115-520 ms à
      -- 3-50 ms à chaud. id reste en second pour départager, l'ordre n'a pas d'autre usage.
      order by i.seance_uid, i.id`,
    // Les scrutins où cet élu figure, avec sa position, dépliés côté Postgres
    // (`2026-09-22_positions_scrutins_elu.sql`), déjà triés par la fonction. La lecture
    // directe de `scrutins` rapatriait les 536 `votes_nominatifs` entiers, soit la liste
    // nominative des ~570 sièges de chaque scrutin, pour n'en garder qu'une position :
    // 3,2 Mo par fiche contre 137 Ko ici, mesurés le 2026-09-22 sur PA1008. C'est ce
    // balayage qui a saturé la base le 21 septembre 2026.
    // Colonnes nommées : `titre_en` ne part que sur /en. Sur /fr, il pesait 47 Ko de plus
    // sur les 141 de la fiche la plus chargée (PA1008, mesuré le 2026-10-20).
    sql<PositionScrutin[]>`
      select uid, titre, ${locale === 'en' ? sql`titre_en,` : sql``} date_scrutin, sort_code, sort_libelle,
        type_vote_code, type_vote_libelle, synthese_pour, synthese_contre, synthese_abstentions, "position"
      from positions_scrutins_elu(p_uid => ${uid})`,
    // Toutes les lignes en une lecture : 1 139 actes portent un vote au 2026-10-27.
    // Le tri fixe laquelle gagne quand deux actes citent le même scrutin (la dernière lue).
    sql<{ dossier_uid: string; vote_refs: string[] | null }[]>`
      select dossier_uid, vote_refs
      from actes_legislatifs
      where vote_refs is not null
      order by uid, dossier_uid`,
    sql<NonNullable<Props['mandatsLocaux']>>`
      select type, collectivite, fonction, date_debut, date_debut_fonction, date_donnee, population,
        verif_effet, verif_date, verif_source_url, verif_source_nom
      from mandats_locaux
      where uid = ${uid}
      order by type, collectivite`,
    sql<NonNullable<Props['transparence']>>`
      select source, identifiant, categorie, date_element, intitule, tiers, valeur_texte, detail, url_source
      from transparence_elements
      where uid = ${uid}
      -- Antichronologique, la clé en dernier pour un ordre stable entre deux
      -- éléments déclarés le même jour.
      order by date_element desc nulls last, identifiant`,
    auPlusUneLigne(sql<NonNullable<Props['hatvp']>[]>`
      select statut_publication, date_depot, url_dossier
      from hatvp_declarations
      where uid = ${uid}`, 'hatvp_declarations'),
    // Mandats internes au Sénat. Vide pour un député : la table ne porte que des
    // sénateurs, et `mandatsNationaux` s'en tient alors au jsonb.
    sql<MandatSenatRow[]>`
      select type, libelle, qualite, date_debut
      from mandats_senat
      where uid = ${uid}`,
    // Date de la dernière vérification au cas par cas des mandats locaux, que
    // l'alerte de cumul cite : écrite par `import_rne.py`.
    auPlusUneLigne(sql<{ derniere_reussite: string | null }[]>`
      select derniere_reussite
      from sync_etat
      where cle = 'verification_cumul'`, 'sync_etat'),
    // Recours en cours ou date limite établis par la vérification, s'il y en a.
    auPlusUneLigne(sql<SituationCumul[]>`
      select recours, date_limite, source_url, source_nom
      from situations_cumul
      where uid = ${uid}`, 'situations_cumul'),
    // Les amendements adoptés dont l'élu est l'auteur, sans leur texte : 500 au plus
    // (Thibault Bazin au 2026-10-25), lus en une fois. Les lignes du Sénat sont
    // bornées au dernier renouvellement, comme le compteur des déposés dont elles sont
    // les adoptés (`SENAT_DERNIERE_ELECTION` d'`import_amendements.py`) : la table, elle,
    // remonte à 2011. Le titre du dossier n'est pas joint : répété sur chaque ligne, il
    // portait la fiche de Thibault Bazin à 177 Ko, contre 139 Ko avec ses 12 titres lus
    // à part (mesuré le 2026-10-25, octets bruts).
    sql<LigneAmendement[]>`
      select uid, chambre, lieu, numero, article, date_amendement, url, dossier_uid
      from amendements
      where auteur_uid = ${uid}
        and (chambre = 'AN' or date_amendement >= ${DEBUT_DECOMPTE.SN})
      order by date_amendement desc nulls last, uid`,
    // Ses trois sujets de prédilection, déjà classés par la vue
    // (`2026-10-27_themes_elus.sql`). Aucune ligne pour un ancien élu ni sous le
    // plancher de la méthode : le bloc est alors absent. `rang` est unique par élu.
    sql<{ theme: string; rang: number }[]>`
      select theme, rang
      from themes_elus_mv
      where uid = ${uid}
      order by rang`,
    // L'élection qui lui a donné son siège (D-298), avec ses résultats en objet (clé
    // étrangère `(election, circonscription)`), rangés après les colonnes simples comme
    // dans l'ancienne jointure. Deux lignes au plus, une par chambre :
    // `choisirElection` tranche plus bas, une fois la chambre connue. Ni `elus` ni
    // `colistiers`, qui ne servent qu'à l'import.
    sql<ElectionEluBrute[]>`
      select e.election, e.nature, e.cle, e.liste_id, e.remplace_nom, e.remplace_uid, e.date_partielle,
        (select jsonb_build_object('mode', r.mode, 'date_scrutin', r.date_scrutin, 'tours', r.tours)
          from election_resultats r
          where r.election = e.election and r.circonscription = e.circonscription) as election_resultats
      from election_elus e
      where e.uid = ${uid}
      order by e.election`,
  ]);

  // Une ligne de `positions_scrutins_elu` : un scrutin où l'élu figure, et le seau
  // de `votes_nominatifs` qui le porte, déjà filtré en base. Six valeurs possibles,
  // et « voter » n'en couvre que la moitié : `pour`, `contre`, `abstentions`,
  // `nonVotants`, `institutionnels` (présidence de séance) et `absents`, ce dernier
  // s'affichant « Aucun vote » et jamais « absent » (D-117).
  type PositionScrutin = {
    uid: string;
    titre: string | null;
    /** Absent sur /fr : la lecture ne le demande que sur /en. */
    titre_en?: string | null;
    date_scrutin: string | null;
    sort_code: string | null;
    sort_libelle: string | null;
    type_vote_code: string | null;
    type_vote_libelle: string | null;
    synthese_pour: number | null;
    synthese_contre: number | null;
    synthese_abstentions: number | null;
    position: string;
  };

  // Mapping scrutin_uid → dossier_uid (depuis actes_legislatifs.vote_refs)
  // La lecture lève sur une erreur, comme celle des positions ci-dessous (D-136) : sans
  // cette map, chaque vote de la fiche perd son lien vers le dossier, en silence et
  // pour 24 h.
  const scrutinToDossier: Record<string, string> = {};
  for (const acte of actesMappingRows) {
    for (const voteRef of acte.vote_refs ?? []) {
      scrutinToDossier[voteRef] = acte.dossier_uid;
    }
  }

  // La lecture lève, sans repli `?? []` (D-136) : une lecture en échec rendait jusqu'ici
  // une fiche sans aucun vote, figée 24 h en cache ISR. Le 21 septembre 2026, 748
  // fiches sont parties ainsi. Lever laisse Next servir la version précédente, ou une
  // erreur sur une fiche marquée par `/api/revalidate` : jamais une fiche vide.
  // Le titre est choisi ici, selon la langue (`lib/titre-dossier.ts`), et `titre_en` ne
  // part pas au client, comme pour les listes de dossiers plus bas.
  const votesElu = votesNominatifRows
    .map(({ titre_en, ...s }) => ({
      ...s,
      titre: titreDossier({ titre: s.titre, titre_en }, locale) || null,
      titreTraduit: titreTraduit({ titre: s.titre, titre_en }, locale),
      dossier_uid: scrutinToDossier[s.uid] ?? null,
    }));

  // Lève sur une panne, `null` seulement si l'élu n'existe pas : seul ce dernier cas
  // mérite un 404, qui serait sinon mis en cache à la place de la fiche (D-136).
  if (!acteur) notFound();

  // Le délai pour choisir, calculé ici et non dans le composant client : il dépend
  // du jour, et le calculer des deux côtés ferait diverger serveur et navigateur
  // autour de minuit. Même calcul que `/Facts/cumul-des-mandats` (`echeanceSituation`).
  const aujourdhui = aujourdhuiAParisIso();
  const echeance = acteur.est_depute_actuel || acteur.est_senateur_actuel
    ? echeanceSituation({
        motif: motifSituation(mandatsLocaux.map(enVigueur).filter((m) => m !== null)),
        chambre: acteur.est_depute_actuel ? 'AN' : 'SN',
        entree: acteur.date_debut_mandat ?? null,
        situation: situationCumul,
        aujourdhui,
      })
    : null;

  // Un élu passé d'une chambre à l'autre ne montre que son mandat actuel, comme son
  // score (D-239). Un député élu sénateur le 1er octobre 2026 affichait sous « Ses
  // votes » ses 166 votes de député, et ses questions de député sous un bouton qui en
  // annonçait 0, le compte venant de `activite_elus_mv`. Une ligne sans date reste.
  const debutMandat = debutApresChangement(acteur);
  const duMandat = (date: string | null | undefined) =>
    debutMandat === null || !date || date.slice(0, 10) >= debutMandat;

  // Les prises de parole d'un élu en exercice partent de la borne de sa chambre, celle
  // de `recalc_nb_prises_parole()` qui fait le compte « sur le mandat » affiché au-dessus
  // de la liste (Sénat : dernier renouvellement, Assemblée : 17ᵉ législature). Sans
  // borne, une sénatrice comptée à 0 voyait listés deux dossiers de 2019 (PA415486, le
  // 2026-11-09). La date part aussi au tiroir (`parolesDepuis`), qui demande le texte à
  // la même borne. Un ministre ou un ancien élu n'a pas de compte : il garde tout.
  const borneParoles = acteur.est_depute_actuel ? DEBUT_DECOMPTE.AN
    : acteur.est_senateur_actuel ? DEBUT_DECOMPTE.SN : null;
  const debutParoles = borneParoles !== null && (debutMandat === null || debutMandat < borneParoles)
    ? borneParoles : debutMandat;
  const dansParoles = (date: string | null | undefined) =>
    debutParoles === null || !date || date.slice(0, 10) >= debutParoles;

  const votesChambre = votesElu.filter((v) => duMandat(v.date_scrutin));
  const top5DossierUids = cinqDerniersDossiers(
    datesInterventionsRows.filter((l) => dansParoles(dateDeSeance(l.seance))),
  );

  // Toutes les interventions de l'élu sur ces 5 dossiers, en une lecture (l'élu le plus
  // bavard en compte 1 117). `id` est la clé primaire, le tri est déjà stable. L'ordre
  // d'affichage se refait plus bas, `id` suivant l'import. `seance` et `dossier`
  // reprennent les objets de l'ancienne jointure, après les colonnes simples.
  const interventionsRows = top5DossierUids.length > 0
    ? await sql<RawIntervention[]>`
        select i.id, i.ordre, i.dossier_uid,
          (select jsonb_build_object('uid', s.uid, 'chambre', s.chambre, 'date_seance', s.date_seance)
            from debat_seances s where s.uid = i.seance_uid) as seance,
          (select jsonb_build_object('uid', d.uid, 'titre', d.titre, 'titre_en', d.titre_en)
            from dossiers_legislatifs d where d.uid = i.dossier_uid) as dossier
        from debat_interventions i
        where i.acteur_uid = ${uid}
          and ${filtreParolesElu()}
          and i.dossier_uid = any(${top5DossierUids})
        order by i.id desc`
    : [];

  // Pour les ministres : récupérer le portefeuille (organe MINISTERE lié)
  let ministere: { libelle: string | null; libelle_abrege: string | null } | null = null;
  const acteurOrganesRefs = acteur.organes_refs;
  if (acteur.est_ministre_actuel && Array.isArray(acteurOrganesRefs) && acteurOrganesRefs.length > 0) {
    const organesData = await sql<{ libelle: string | null; libelle_abrege: string | null; preseance: number | null }[]>`
      select libelle, libelle_abrege, preseance
      from organes
      where uid = any(${acteurOrganesRefs})
        and code_type = 'MINISTERE'
      order by preseance asc nulls last
      limit 1`;
    if (organesData.length > 0) {
      ministere = { libelle: organesData[0].libelle, libelle_abrege: organesData[0].libelle_abrege };
    }
  }

  // Les mandats du jsonb ne portent que des références d'organes : une requête
  // les résout en libellés lisibles. Même pattern que le portefeuille
  // ministériel juste au-dessus, mais sur les organes de tous les mandats.
  const refsMandats = Array.isArray(acteur.mandats)
    ? Array.from(new Set(
        (acteur.mandats as Record<string, unknown>[])
          .map((m) => (m.organes as { organeRef?: string } | undefined)?.organeRef)
          .filter((ref): ref is string => typeof ref === 'string'),
      ))
    : [];
  const libelleParOrgane = new Map<string, string>();
  if (refsMandats.length > 0) {
    const organesMandats = await sql<{ uid: string; libelle: string | null; libelle_abrege: string | null }[]>`
      select uid, libelle, libelle_abrege
      from organes
      where uid = any(${refsMandats})`;
    for (const o of organesMandats) {
      if (o.libelle) libelleParOrgane.set(o.uid, o.libelle);
    }
  }
  const dateMandat = dateDuMandat(acteur as Parameters<typeof dateDuMandat>[0]);
  // La ligne de chambre reprend la date de l'en-tête (voir `dateDuMandat`) : sans
  // ce report, un suppléant lisait en tête son arrivée et, dans la liste,
  // l'élection de son titulaire.
  const mandatsNat = mandatsNationaux(
    acteur.mandats,
    libelleParOrgane,
    mandatsSenatRows,
  ).map((m) => (dateMandat && m.categorie === 'chambre' ? { ...m, dateDebut: dateMandat.date } : m));

  const wikiTitre = acteur.wikipedia_titre ?? null;
  const wikipedia = wikiTitre ? await lienWikipedia(wikiTitre, locale) : null;

  // Les trois listes de dossiers lisent `titre_en` : sur /en, le titre traduit par l'IA
  // remplace `titre` quand il existe (`lib/titre-dossier.ts`), et `titre_en` ne part
  // pas au client ; `titreTraduit` y va à sa place, pour le badge IA de la section.
  // Type de retour écrit à la main : un `Omit` sur ces lignes à signature d'index
  // effaçait `uid` du type.
  const titreLu = <T extends Record<string, unknown>>({ titre_en, ...d }: T): T & { titre: string; titreTraduit: boolean } => {
    const titres = { titre: d.titre as string | null, titre_en: titre_en as string | null };
    return { ...d, titre: titreDossier(titres, locale), titreTraduit: titreTraduit(titres, locale) } as T & { titre: string; titreTraduit: boolean };
  };

  type InitieRow = Record<string, unknown> & {
    uid: string; date_depot?: string | null; procedure_libelle?: string | null; textes_associes_refs: string[] | null;
  };
  type TexteCoauteurRow = {
    uid: string;
    auteurs_refs: string[] | null;
    cosignataires_refs: string[] | null;
    rapporteurs_refs: string[] | null;
    type_libelle: string | null;
    denomination: string | null;
    dossier_ref: string;
    depot_code: string | null;
    date_depot: string | null;
    chambre: string | null;
    dossier: Record<string, unknown> | null;
  };
  type DossierCoauteur = Record<string, unknown> & {
    uid?: string; texte_uid?: string; denomination?: string | null; commeMinistre?: boolean;
  };

  // « Ses textes » compte comme le score (`activite_elus_mv`), pour que la section et
  // la mesure « dossiers initiés » donnent le même chiffre. Jusqu'au 2026-10-25, seuls
  // les dossiers dont l'élu était l'initiateur déclaré y passaient pour déposés, sur
  // tous ses mandats : 168 élus sur 921 n'avaient pas le compte du score (4 contre 13
  // chez Lermytte). Un ministre ou un ancien élu n'a pas de fenêtre (`debutFenetre`) :
  // sa section garde tout, sans borne de date ni de chambre.
  const fenetre = debutFenetre(acteur);
  const chambreActuelle: 'AN' | 'SN' | null = acteur.est_depute_actuel ? 'AN' : acteur.est_senateur_actuel ? 'SN' : null;

  // « Ses amendements » : un élu en exercice ne garde que les adoptés de sa chambre,
  // comme le compteur des déposés, l'import ne comptant pas à l'Assemblée un sénateur
  // en exercice et ne rattachant au Sénat que les sénateurs en exercice. Les titres de
  // ses dossiers (12 pour les 500 adoptés de Thibault Bazin) se lisent en une requête ; le titre est choisi
  // selon la langue, et `titre_en` ne part pas au client.
  type LigneAmendement = {
    uid: string; chambre: 'AN' | 'SN'; lieu: 'seance' | 'commission'; numero: string; article: string | null;
    date_amendement: string | null; url: string; dossier_uid: string;
  };
  const lignesAmendements = amendementsRows
    .filter((a) => (chambreActuelle === null || a.chambre === chambreActuelle) && duMandat(a.date_amendement));
  const dossiersAmendes = [...new Set(lignesAmendements.map((a) => a.dossier_uid))];
  const titreParDossier = new Map<string, { uid: string; titre: string; titreTraduit: boolean }>();
  // Les titres, les votes publics et les affinités de vote se lisent ensemble : trois
  // lectures indépendantes. Les affinités partent des positions déjà lues
  // (`votesNominatifRows`) : rappeler `positions_scrutins_elu` doublait le balayage des
  // `votes_nominatifs` de tous les scrutins à chaque régénération de fiche.
  const [titres, avecVote, accordsRows] = await Promise.all([
    dossiersAmendes.length > 0
      ? sql<Record<string, unknown>[]>`
          select uid, titre${locale === 'en' ? sql`, titre_en` : sql``}
          from dossiers_legislatifs
          where uid = any(${dossiersAmendes})`
      : Promise.resolve([]),
    amendementsAvecVote(lignesAmendements.map((a) => a.uid)),
    lireAccordsGroupes(votesNominatifRows, chambreActuelle),
  ]);
  for (const d of titres) {
    const lu = titreLu(d);
    titreParDossier.set(lu.uid as string, { uid: lu.uid as string, titre: lu.titre, titreTraduit: lu.titreTraduit });
  }
  const amendements = lignesAmendements.map(({ chambre: _chambre, dossier_uid, ...a }) => {
    void _chambre;
    return { ...a, ...(avecVote.has(a.uid) && { avecVote: true }), dossier: titreParDossier.get(dossier_uid) ?? { uid: dossier_uid, titre: null } };
  });

  // Une date absente sort, comme dans la vue, où `NULL >= date` n'est pas vrai.
  const dansFenetre = (date: string | null | undefined) =>
    fenetre === null || (!!date && date.slice(0, 10) >= fenetre);
  const dossierDuTexte = (t: TexteCoauteurRow) => t.dossier as InitieRow | null;

  // Déposés, comme le CTE `initiateurs` de la vue : l'initiateur déclaré du dossier, et
  // les auteurs de son texte de dépôt initial. Le dossier joint au texte porte les
  // mêmes colonnes qu'une ligne de la première requête.
  const deposes = new Map<string, InitieRow>();
  for (const d of dossiersInitiesRows) deposes.set(d.uid, d);
  for (const t of textesCoauteurRows) {
    if (t.depot_code !== 'INITDEP' || !(t.auteurs_refs ?? []).includes(uid)) continue;
    const d = dossierDuTexte(t);
    if (!d || deposes.has(d.uid)) continue;
    // Une procédure absente sort aussi : dans la vue, `NULL <> 'Responsabilité…'`
    // n'est pas vrai, donc ce texte n'y crédite pas son auteur.
    if (d.procedure_libelle == null || d.procedure_libelle === PROCEDURE_HAUTE_COUR) continue;
    // Un projet de loi signé comme ministre reste chez les cosignés, marqué comme tel
    // plus bas : la vue ne le compte nulle part.
    if (estOrigineGouvernementale(d.textes_associes_refs)) continue;
    deposes.set(d.uid, d);
  }
  // Sans borne de date, comme `initiated_pairs` dans la vue : un dossier déposé avant
  // la fenêtre ne s'affiche pas, mais ses textes ne passent pas pour autant en
  // cosignature.
  const initiatedDossierUids = new Set<string>(deposes.keys());

  // Un dossier du Gouvernement (règle D-152, la même que `activite_elus_mv`) ne
  // crédite pas son signataire dans le score : il l'a signé comme ministre. La
  // fiche le dit sur la ligne : sans cela, un ancien Premier ministre voit ses
  // projets de loi listés ici et un compteur de dossiers initiés qui les ignore.
  // Les références de textes restent au serveur.
  const dossiersInities = [...deposes.values()]
    .filter((d) => dansFenetre(d.date_depot))
    .map(
      ({ textes_associes_refs, ...d }) => ({ ...titreLu(d), commeMinistre: estOrigineGouvernementale(textes_associes_refs) }),
    );
  const seenRapporteurDossiers = new Set<string>();
  const dossiersCoauteur = textesCoauteurRows
    .filter((t) => {
      // Signataire au sens large : premier signataire (`auteurs_refs`, ce que remplit
      // le Sénat) ou cosignataire (`cosignataires_refs`, ce que remplit l'Assemblée).
      const isAuteur = (t.auteurs_refs ?? []).includes(uid)
        || (t.cosignataires_refs ?? []).includes(uid);
      const isRapporteur = (t.rapporteurs_refs ?? []).includes(uid);
      // Bornes de la vue pour un élu en exercice. D'abord un texte de la législature,
      // datée selon la chambre du texte. Puis, pour un texte signé, la chambre
      // actuelle et non la date : un député peut rejoindre les cosignataires d'un texte
      // déposé avant son arrivée. Pour un rapport, la fenêtre de l'élu : un rapport se
      // dépose une fois écrit, et un organe commun aux deux chambres publie côté
      // Assemblée des rapports de sénateurs.
      if (chambreActuelle !== null) {
        if (!t.chambre || !t.date_depot) return false;
        if (t.date_depot.slice(0, 10) < DEBUT_DECOMPTE[t.chambre === 'Sénat' ? 'SN' : 'AN']) return false;
      }
      if (isAuteur && (chambreActuelle === null || (chambreActuelle === 'SN') === (t.chambre === 'Sénat'))) {
        return true;
      }
      if (!isRapporteur || !dansFenetre(t.date_depot)) return false;
      // Garder uniquement les rapports (pas les textes sources ni les annexes). Un
      // rapporteur pour avis signe un document de type « Avis », que la vue compte.
      const type = t.type_libelle?.toLowerCase() ?? '';
      if (!type.includes('rapport') && t.type_libelle !== 'Avis') return false;
      if (t.denomination?.toLowerCase().startsWith('annexe')) return false;
      // 1 mission = 1 dossier (peu importe le nombre de tomes/rapports produits)
      if (seenRapporteurDossiers.has(t.dossier_ref)) return false;
      seenRapporteurDossiers.add(t.dossier_ref);
      return true;
    })
    .map((t): DossierCoauteur | null => {
      const brut = t.dossier;
      if (!brut) return null;
      const { textes_associes_refs, ...dossier } = brut as Record<string, unknown> & { textes_associes_refs?: string[] | null };
      // Même exclusion que la vue : signer ou cosigner un texte d'un dossier du
      // Gouvernement ne compte pas. Une motion de censure (`depot_code` MOTION…)
      // ne compte jamais comme texte cosigné : elle sort de la liste (et non
      // « comme ministre », ce qu'elle n'est pas). Être rapporteur d'un projet
      // de loi reste un travail de parlementaire, compté.
      const signataire = (t.auteurs_refs ?? []).includes(uid) || (t.cosignataires_refs ?? []).includes(uid);
      if (signataire && (t.depot_code ?? '').startsWith('MOTION')) return null;
      const commeMinistre = signataire && estOrigineGouvernementale(textes_associes_refs);
      return { ...titreLu(dossier), texte_uid: t.uid, denomination: t.denomination, commeMinistre };
    })
    .filter((d): d is DossierCoauteur => {
      if (!d?.uid) return false;
      if (initiatedDossierUids.has(d.uid as string)) return false;
      return true;
    });

  // Chaque ligne affiche la promulgation, ou le dépôt à défaut (`TexteRow`) : les
  // deux listes se rangent sur cette même date, du plus récent au plus ancien. La
  // base les trie sur le dépôt, et une loi promulguée s'y lisait hors de sa place
  // (décembre 2024, puis mai 2025, puis mars 2025 chez Michel Barnier).
  const dateAffichee = (d: Record<string, unknown>) =>
    ((d.date_promulgation ?? d.date_depot) as string | null) ?? '';
  const parDateAffichee = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    dateAffichee(b).localeCompare(dateAffichee(a)) || String(a.uid).localeCompare(String(b.uid));
  dossiersInities.sort(parDateAffichee);
  dossiersCoauteur.sort(parDateAffichee);

  // ── Score d'activité (vue matérialisée activite_elus_mv) ────────────────
  type ActiviteScore = {
    score: number | null; rank: number | null; total: number; chambre: 'AN' | 'SN';
    cpPart: number | null; cpDoss: number | null; cpCosign: number | null; cpRapp: number | null; cpRappCtrl: number | null;
    cpAmendAuteur: number | null; cpAmendCosign: number | null;
    cpQuestO: number | null; cpQuestE: number | null; cpPrisesParole: number | null;
    cpCommPres: number | null;
    nb_dossiers_inities: number; nb_textes_cosignes: number; nb_rapporteur: number; nb_rapports_controle: number;
    nb_amendements_auteur: number; nb_amendements_cosignataire: number;
    nb_questions_orales: number; nb_questions_ecrites: number;
    nb_prises_parole: number;
    nb_commission_presences: number | null;
    joursActifs: number;
    debutDecompte: string;
    // Distingue les motifs de score absent, pour que la fiche dise lequel (D-123).
    estPresidentChambre: boolean;
    estPresidentGroupe: boolean;
  };

  // ActiviteScore enrichi avec rangs par fonction et par mesure
  type ActiviteScoreFull = ActiviteScore & {
    sousScores: Record<FonctionKey, { rang: number | null; total: number }>;
    rangsMesures: Record<MetricKey, number | null>;
  };
  let activiteScore: ActiviteScoreFull | null = null;
  // Centiles (`cp_*`), rangs par mesure (`rang_*`) et rangs par fonction
  // (`rang_<fonction>`) ne sont pas déclarés ici : ils se lisent par `mesuresDeLigne`
  // et `fonctionsDeLigne` (`lib/activite-weights.ts`), seule correspondance entre les
  // colonnes de la vue et les clés du code.
  const thisRow = activiteLigne as {
    chambre: string;
    score: number | null;
    rang_chambre: number | null;
    nb_dossiers_inities: number | null;
    nb_textes_cosignes: number | null;
    nb_rapporteur: number | null;
    nb_rapports_controle: number | null;
    nb_amendements_auteur: number | null;
    nb_amendements_cosignataire: number | null;
    nb_questions_orales: number | null;
    nb_questions_ecrites: number | null;
    nb_prises_parole: number | null;
    nb_commission_presences: number | null;
    date_debut_mandat: string | null;
    jours_actifs: number | null;
    est_president_chambre: boolean;
    // Peut manquer si le site est déployé avant la migration qui ajoute la
    // colonne : voir le `select *` plus haut.
    est_president_groupe?: boolean;
  } | null;

  if (thisRow) {
    const chambre = (thisRow.chambre === 'AN' ? 'AN' : 'SN') as 'AN' | 'SN';

    // Le total de la chambre, compté sans transférer de ligne : sous-scores et rangs
    // viennent de la vue (`2026-10-25_activite_rangs_par_fonction.sql`).
    const [{ n: chambreTotal }] = await sql<{ n: number }[]>`
      select count(*) as n
      from activite_elus_mv
      where chambre = ${chambre}
        and score is not null`;

    // Le total d'une fonction est celui de la chambre : chez un élu classé, la vue ne
    // rend jamais de sous-score NULL (« Délibérer » a toujours les prises de parole,
    // « Examiner les textes » toujours le rapporteur).
    const rangsFonctions = fonctionsDeLigne(thisRow, 'rang');
    const sousScores = Object.fromEntries(
      (Object.keys(rangsFonctions) as FonctionKey[]).map((f) => [f, { rang: rangsFonctions[f], total: chambreTotal }]),
    ) as Record<FonctionKey, { rang: number | null; total: number }>;

    activiteScore = {
      score: thisRow.score,
      rank: thisRow.rang_chambre,
      total: chambreTotal,
      chambre,
      ...mesuresDeLigne(thisRow, 'cp'),
      nb_dossiers_inities: thisRow.nb_dossiers_inities ?? 0,
      nb_textes_cosignes: thisRow.nb_textes_cosignes ?? 0,
      nb_rapporteur: thisRow.nb_rapporteur ?? 0,
      nb_rapports_controle: thisRow.nb_rapports_controle ?? 0,
      nb_amendements_auteur: thisRow.nb_amendements_auteur ?? 0,
      nb_amendements_cosignataire: thisRow.nb_amendements_cosignataire ?? 0,
      nb_questions_orales: thisRow.nb_questions_orales ?? 0,
      nb_questions_ecrites: thisRow.nb_questions_ecrites ?? 0,
      nb_prises_parole: thisRow.nb_prises_parole ?? 0,
      nb_commission_presences: thisRow.nb_commission_presences ?? null,
      joursActifs: thisRow.jours_actifs ?? 0,
      debutDecompte: debutDuDecompte(
        chambre,
        thisRow.date_debut_mandat,
        (acteur as { periodes_mandat_assemblee?: PeriodeMandat[] | null }).periodes_mandat_assemblee,
      ),
      estPresidentChambre: thisRow.est_president_chambre,
      estPresidentGroupe: thisRow.est_president_groupe ?? false,
      sousScores,
      rangsMesures: mesuresDeLigne(thisRow, 'rang'),
    };
  }

  const assemblyAverages = acteur.est_senateur_actuel ? senateAvg : assemblyAvg;

  type RawIntervention = {
    id: number;
    ordre: number | null;
    dossier_uid: string;
    seance: unknown;
    dossier: unknown;
  } & Record<string, unknown>;
  // Rangées dans l'ordre des cinq dossiers, puis de la séance la plus récente à la
  // plus ancienne, et dans une séance de la dernière prise de parole à la
  // première. Le client groupe par dossier en gardant cet ordre d'arrivée, et
  // `ParoleEntete` lit la date du dossier sur sa première intervention.
  //
  // Pas de texte ici : le tiroir le demande à son ouverture (`/api/elus/[uid]/paroles`).
  const rangDossier = new Map(top5DossierUids.map((dossierUid, i) => [dossierUid, i]));
  // Un dossier peut avoir été débattu avant la borne (changement de chambre, mandat
  // précédent) : sur les cinq dossiers retenus, ces interventions sortent aussi.
  const interventions = interventionsRows
    .filter((iv) => dansParoles(dateDeSeance(iv.seance)))
    .map((iv) => {
      const dossier = iv.dossier as Record<string, unknown> | null;
      return { ...iv, dossier: dossier ? titreLu(dossier) : null };
    })
    .sort((a, b) =>
      (rangDossier.get(a.dossier_uid) ?? 0) - (rangDossier.get(b.dossier_uid) ?? 0)
      || (dateDeSeance(b.seance) ?? '').localeCompare(dateDeSeance(a.seance) ?? '')
      || (b.ordre ?? 0) - (a.ordre ?? 0)
      || b.id - a.id);

  // Forme compacte envoyée au client (voir `Paroles`) : une ligne par intervention,
  // dans l'ordre ci-dessus, et chaque séance, chaque dossier une seule fois.
  const paroles: Paroles = { dossiers: {}, seances: {}, lignes: [] };
  for (const iv of interventions) {
    const seance = iv.seance as { uid: string; chambre: 'AN' | 'SEN'; date_seance: string } | null;
    const dossier = iv.dossier as Paroles['dossiers'][string] | null;
    if (seance) paroles.seances[seance.uid] = { uid: seance.uid, chambre: seance.chambre, date_seance: seance.date_seance };
    if (dossier) paroles.dossiers[dossier.uid] = dossier;
    paroles.lignes.push([iv.dossier_uid ?? null, seance?.uid ?? null]);
  }

  // Filtrées après le plafond de 100 sans rien perdre : la requête trie du plus récent
  // au plus ancien, et le filtre ne retire que les plus anciennes.
  const questionsChambre = questionsRows
    .filter((q) => duMandat(q.date_jo));

  // Traduits ici pour que le namespace `themesDossiers` ne parte pas au client.
  const tThemes = await getTranslations({ locale, namespace: 'themesDossiers' });
  const themesPredilection = themesRows
    .map((l) => libelleTheme(l.theme, tThemes));

  // Préparée ici, traduite comprise : le composant ne reçoit que des textes, et le
  // namespace `election` ne part pas au client.
  const electionBrute = choisirElection(electionRows, chambreActuelle);
  const election = electionBrute && preparerElection(electionBrute, {
    locale,
    t: await getTranslations({ locale, namespace: 'election' }),
    feminin: acteur.civ?.trim() === 'Mme',
  });

  // `mandats`, `periodes_mandat_assemblee` et `historique_groupes` restent au serveur :
  // seuls la fonction, le début du décompte, le mandat quitté et le dernier groupe
  // qu'on en extrait descendent.
  const { mandats: _mandats, periodes_mandat_assemblee: _periodes, historique_groupes: _historique, ...acteurSansMandats } = acteur as Record<string, unknown>;
  void _mandats;
  void _periodes;
  void _historique;

  // Un ancien élu n'a plus de groupe dans `groupe` : sa fiche nomme le dernier qu'il a
  // eu, lu dans son historique, sous le libellé « Dernier groupe ».
  const termine = mandatTermine(acteur as Parameters<typeof mandatTermine>[0]);
  const uidDernierGroupe = termine && !acteur.groupe ? dernierGroupe(acteur.historique_groupes) : null;
  const dernierGroupeFiche = uidDernierGroupe
    ? await auPlusUneLigne(sql<{ libelle: string | null; couleur_associee: string | null }[]>`
        select libelle, couleur_associee from organes where uid = ${uidDernierGroupe}`, 'organes (dernier groupe)')
    : null;

  // La couleur se résout ici, pour que le client reçoive une valeur prête : un groupe
  // du Sénat sans couleur en base retombe sur le gris de `resolveGroupeColor`. Le
  // groupe signalé est l'actuel, ou le dernier d'un ancien élu, celui de l'en-tête.
  const uidGroupe = (acteur.groupe?.uid as string | undefined) ?? null;
  const affinites: AffinitesVote = {
    total: accordsRows[0]?.total ?? 0,
    groupeMarque: uidGroupe ? { uid: uidGroupe, dernier: false }
      : uidDernierGroupe ? { uid: uidDernierGroupe, dernier: true }
      : null,
    groupes: accordsRows.map((r) => ({
      uid: r.groupe_uid,
      sigle: r.libelle_abrege?.trim() || r.libelle?.trim() || r.groupe_uid,
      libelle: r.libelle,
      couleur: resolveGroupeColor(r.couleur_associee),
      accord: r.accord,
      communs: r.communs,
    })),
  };

  return (
    <EluProfileClient
      acteur={acteurSansMandats as unknown as React.ComponentProps<typeof EluProfileClient>['acteur']}
      fonctionBureau={fonctionBureau(acteur as Parameters<typeof fonctionBureau>[0])}
      dateMandat={dateMandat}
      mandatTermine={termine}
      dernierGroupe={dernierGroupeFiche?.libelle ? { libelle: dernierGroupeFiche.libelle, couleur: dernierGroupeFiche.couleur_associee } : null}
      ministere={ministere}
      dossiersInities={dossiersInities as unknown as React.ComponentProps<typeof EluProfileClient>['dossiersInities']}
      dossiersCoauteur={dossiersCoauteur as unknown as React.ComponentProps<typeof EluProfileClient>['dossiersCoauteur']}
      amendements={amendements}
      wikipedia={wikipedia}
      assemblyAverages={assemblyAverages}
      activiteScore={activiteScore}
      themesPredilection={themesPredilection}
      election={election}
      mandatsNationaux={mandatsNat}
      mandatsLocaux={mandatsLocaux}
      echeanceCumul={echeance && { echeance, depassee: echeance.etat === 'date' && echeance.date < aujourdhui }}
      verificationCumul={verificationCumul?.derniere_reussite ?? null}
      transparence={transparenceRows}
      hatvp={hatvp}
      questions={questionsChambre as unknown as React.ComponentProps<typeof EluProfileClient>['questions']}
      paroles={paroles}
      parolesDepuis={debutParoles}
      votesNominatifs={votesChambre as unknown as React.ComponentProps<typeof EluProfileClient>['votesNominatifs']}
      affinites={affinites}
    />
  );
}
