// src/app/[locale]/(app)/Month/page.tsx
// Server Component — Fetch des donnees du mois et transformation en evenements enrichis

export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static'; // Données mises à jour une fois par nuit

import {
  getMonthActes,
  getDossierTitles,
  getTextesByUids,
  getOrganesByUids,
  getActeursByUids,
  type ActeurLite,
  getScrutinsByUids,
  getMonthMotionActes,
  getMotionDecisionActes,
  getApplicationDirecteSet,
  getFullyAppliedLaws,
  getLastDecreeDates,
  getPromulgationTexteUids,
  getDossiersWithAccessibleTexte,
  getCommissionNominActes,
  getComenqTexteUids,
  getComenqRapportsPublies,
  LIBELLE_TO_TYPE,
  type FeedEventType,
  type ActeRow,
} from './monthQueries';
import { formatISOMonth, libelleMoisLong, moisPrecedent } from './monthKeys';
import { MonthFeedClient } from './MonthFeedClient';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { estOrigineGouvernementale } from '@/lib/origine-gouvernementale';
import { aujourdhuiAParis } from '@/lib/jour-paris';
import { titreDossier } from '@/lib/titre-dossier';
import { estMotionProcedure, voteLePlusRecent } from '@/lib/scrutin-affichage';
import { getDefinition } from '@/lib/definitions';
import { traduireDenomination } from '@/lib/denomination';
import { MAJORITE_CLE, TYPE_VOTE_CLE } from './monthLibelles';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'month' });
  const title = t('pageMetaTitle');
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/Month'),
    openGraph: buildOpenGraph(locale, '/Month', title, description),
  };
}

// ---------------------------------------------------------------------------
// Types exportes pour le client (FeedEventType importé depuis monthQueries)
// ---------------------------------------------------------------------------

export type { FeedEventType } from './monthQueries';

export type ScrutinItem = {
  uid: string;
  titre: string | null;
  typeVoteCode: string | null;
  typeVoteLibelle: string | null;
  typeMajorite: string | null;
  votePour: number | null;
  voteContre: number | null;
  voteAbstentions: number | null;
  voteVotants: number | null;
  voteNonVotants: number | null;
  voteSuffragesRequis: number | null;
  statutConclusion: string | null;
  chambre: string | null;
};

export type FeedEvent = {
  id: string;
  type: FeedEventType;
  date: string;
  titre: string;
  dossierUid: string | null;
  dossierTitre: string | null;
  // Enriched fields
  libelleActe: string | null;
  codeActe: string | null;
  organeName: string | null;
  texteUid: string | null;
  texteDenomination: string | null;
  texteLien: string | null;
  texteTitre: string | null;
  texteAdopteUid: string | null;
  texteAdopteDenomination: string | null;
  texteAdopteTitre: string | null;
  texteAdopteLien: string | null;
  texteAdopteUrlAccessible: boolean | null;
  texteUrlAccessible: boolean | null;
  hasContenLegifrance: boolean;
  hasContenLegifranceAdopte: boolean;
  scrutinUid: string | null;
  scrutinTitre: string | null;
  typeVoteCode: string | null;
  typeVoteLibelle: string | null;
  typeMajorite: string | null;
  statutConclusion: string | null;
  // Auteur (pour DEPOT_TEXTE) / Provenance (pour DEPOT_RAPPORT)
  auteur: string | null;
  auteurUid: string | null;
  groupeAbrege: string | null;
  auteurChambre: 'AN' | 'SENAT' | 'GOUV' | null;
  texteProvenance: string | null;
  texteHasTomes: boolean | null;
  organeCodeType: string | null;
  rapporteurName: string | null;
  rapporteurGroupe: string | null;
  rapporteurIsMultiple: boolean | null;
  codeLoi: string | null;
  titreLoi: string | null;
  urlConclusion?: string | null;
  // Application des lois (optionnel)
  applicationDirecte?: boolean;
  nbDecrets?: number;
  nbMesuresAttendues?: number;
  datePromulgation?: string | null;
  // Vote details (optional) — scrutin le plus récent de l'acte (`voteLePlusRecent`), pour backward compat
  votePour?: number | null;
  voteContre?: number | null;
  voteAbstentions?: number | null;
  voteVotants?: number | null;
  voteNonVotants?: number | null;
  voteSuffragesRequis?: number | null;
  // Tous les scrutins liés (1 pour vote simple, N pour multi-votes)
  scrutins: ScrutinItem[];
};

export type GroupedFeedEvent = {
  key: string; // `${dossierUid}-${dateISO}-${type}`
  type: FeedEventType;
  date: string;
  dossierUid: string | null;
  dossierTitre: string | null;
  events: FeedEvent[];
  /** true si le dossier a au moins un texte avec URL publiée (résumé IA possible) */
  dossierHasTexte: boolean;
};

export type MonthKpis = {
  totalEvents: number;
};

export type MonthData = {
  groupedEvents: GroupedFeedEvent[];
  kpis: MonthKpis;
  year: number;
  month: number;
  monthFormatted: string;
  monthKey: string;
  prevMonthKey: string;
  isCurrentOrFutureMonth: boolean;
};

// ---------------------------------------------------------------------------
// Classification par libelle (source unique : LIBELLE_TO_TYPE de monthQueries)
// ---------------------------------------------------------------------------

function classifyByLibelle(libelle: string | null): FeedEventType {
  if (!libelle) return 'AUTRE';
  return LIBELLE_TO_TYPE[libelle] ?? 'AUTRE';
}

// ---------------------------------------------------------------------------
// Utilitaires de date
// ---------------------------------------------------------------------------

function getMonthBounds(isoMonth?: string): { monthStart: Date; monthEnd: Date; year: number; month: number } {
  let year: number;
  let month: number; // 0-indexed

  if (isoMonth && /^\d{4}-\d{2}$/.test(isoMonth)) {
    const [y, m] = isoMonth.split('-');
    year = parseInt(y, 10);
    month = parseInt(m, 10) - 1;
  } else {
    // Repli volontairement silencieux sur le mois courant : `loadMonthAction`
    // rejette déjà les clés hors périmètre, et le rendu statique appelle cette
    // fonction sans argument. Le mois courant est celui de Paris : le 1ᵉʳ entre
    // minuit et deux heures, l'horloge UTC du serveur serait encore au mois d'avant.
    const { annee, mois } = aujourdhuiAParis();
    year = annee;
    month = mois - 1;
  }

  const monthStart = new Date(year, month, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59, 999);

  return { monthStart, monthEnd, year, month };
}


// ---------------------------------------------------------------------------
// Helpers : groupement et enrichissement
// ---------------------------------------------------------------------------

/** Résout le groupe parlementaire d'un acteur via acteur.groupe → organe, ou
 *  organes_refs en fallback. Ne rend jamais un organe du Gouvernement : être
 *  ministre aujourd'hui ne dit rien du texte affiché, et c'est le type du texte
 *  qui décide de « Gouvernement » (voir `lib/origine-gouvernementale.ts`). */
function resolveGroupeAbrege(
  acteur: { groupe: string | null; organes_refs: string[] | null } | null | undefined,
  organes: Map<string, { name: string; libelleAbrege: string | null; codeType: string | null }>,
): string | null {
  if (!acteur) return null;
  if (acteur.groupe) return organes.get(acteur.groupe)?.name ?? null;
  if (acteur.organes_refs?.length) {
    for (const ref of acteur.organes_refs) {
      const org = organes.get(ref);
      if (org?.codeType === 'GP') return org.name;
    }
    const premier = organes.get(acteur.organes_refs[0]);
    return premier && premier.codeType !== 'GOUVERNEMENT' ? premier.name : null;
  }
  return null;
}

/** Résout la chambre parlementaire d'un acteur (pour le badge AN/Sénat).
 *  Priorise les flags calculés par le pipeline (qui tiennent compte des dates
 *  de fin de mandat) avant de retomber sur organes_refs.
 *  Ne rend plus « GOUV » d'après la personne : un député devenu ministre voyait
 *  sinon ses anciennes propositions de loi préfixées « Min. », et un projet de
 *  loi prenait le préfixe du rôle actuel de son ministre. L'appelant pose
 *  « GOUV » quand le texte lui-même vient du Gouvernement. */
function resolveAuteurChambre(
  acteur: ActeurLite | null | undefined,
  organes: Map<string, { name: string; libelleAbrege: string | null; codeType: string | null }>,
): 'AN' | 'SENAT' | null {
  if (!acteur) return null;
  if (acteur.est_depute_actuel) return 'AN';
  if (acteur.est_senateur_actuel) return 'SENAT';
  for (const ref of acteur.organes_refs ?? []) {
    const c = organes.get(ref)?.codeType;
    if (c === 'ASSEMBLEE') return 'AN';
    if (c === 'SENAT') return 'SENAT';
  }
  if (acteur.groupe && organes.get(acteur.groupe)?.codeType === 'GP') return 'AN';
  return null;
}

/** Nom d'organe d'un événement sur /en : les chambres, le Gouvernement, le Conseil
 *  constitutionnel et les commissions mixtes paritaires prennent leur libellé
 *  `month.institution.*`, la Présidence (« Présidence de la République : M. … »)
 *  garde le nom du président. Commissions et délégations restent en français. */
function organeEnAnglais(
  codeType: string | null,
  nom: string | null,
  t: (cle: string, valeurs?: Record<string, string>) => string,
): string | null {
  if (!nom) return nom;
  if (codeType === 'ASSEMBLEE') return t('institution.assemblee');
  if (codeType === 'SENAT') return t('institution.senat');
  if (codeType === 'GOUVERNEMENT') return t('institution.gouvernement');
  if (codeType === 'CONSTITU') return t('institution.cconstit');
  if (codeType === 'CMP') return t('institution.cmp');
  if (codeType === 'PRESREP') {
    const president = nom.match(/:\s*(?:M\.|Mme)?\s*(.+)$/)?.[1];
    return president ? t('presidence', { nom: president }) : nom;
  }
  return nom;
}

/** Transforme un acte brut en FeedEvent enrichi */
function acteToFeedEvent(
  a: ActeRow,
  dossierInfo: { titre: string; initiateurActeurRef: string | null; groupeAbrege: string | null } | null,
  textes: Map<string, { uid: string; denomination: string | null; titre_principal: string | null; lien_texte: string | null; provenance: string | null; statut_adoption: string | null; url_accessible: boolean | null; auteurs_refs: string[] | null; has_tomes: boolean | null; rapporteurs_refs: string[] | null; contenu_legifrance: string | null }>,
  organes: Map<string, { name: string; libelleAbrege: string | null; codeType: string | null }>,
  scrutinsMap: Map<string, { uid: string; titre: string | null; sort_libelle: string | null; type_vote_code: string | null; type_vote_libelle: string | null; type_majorite: string | null; synthese_pour: number | null; synthese_contre: number | null; synthese_abstentions: number | null; synthese_nombre_votants: number | null; synthese_non_votants: number | null; synthese_suffrages_requis: number | null; chambre: string | null }>,
  acteurs: Map<string, ActeurLite>,
): FeedEvent {
  let type = classifyByLibelle(a.libelle_acte);
  if (a.code_acte === 'AN20-COMENQ-RAPPORT') type = 'COMMISSION_RAPPORT';
  const texte = a.textes_associes?.[0] ? textes.get(a.textes_associes[0]) : null;
  const texteAdopte = a.texte_adopte ? textes.get(a.texte_adopte) : null;
  const organeData = a.organe_ref ? organes.get(a.organe_ref) : null;
  const scrutinsList = (a.vote_refs ?? []).map(ref => scrutinsMap.get(ref)).filter(Boolean) as NonNullable<ReturnType<typeof scrutinsMap.get>>[];
  const voteRetenu = voteLePlusRecent(scrutinsList.map(s => s.uid));
  const scrutin = scrutinsList.find(s => s.uid === voteRetenu) ?? null;

  // ── Auteur & groupe ──────────────────────────────────────────────────────
  const WITH_AUTEUR = new Set<FeedEventType>(['DEPOT_TEXTE', 'DECISION', 'NAVETTE', 'CMP_CONVOCATION', 'CMP_RAPPORT']);
  let auteur: string | null = null;
  let auteurUid: string | null = null;
  let groupeAbrege: string | null = null;
  let auteurChambre: 'AN' | 'SENAT' | 'GOUV' | null = null;
  let rapporteurName: string | null = null;
  let rapporteurGroupe: string | null = null;
  let rapporteurIsMultiple: boolean | null = null;

  if (WITH_AUTEUR.has(type)) {
    if (type === 'DEPOT_TEXTE') {
      // Source principale : auteurs_refs du texte ; fallback : initiateur du dossier
      const resolvedUid = texte?.auteurs_refs?.[0] ?? dossierInfo?.initiateurActeurRef ?? null;
      const acteurData = resolvedUid ? acteurs.get(resolvedUid) : null;
      auteur = acteurData ? `${acteurData.prenom} ${acteurData.nom}`.trim() : null;
      auteurUid = resolvedUid;
      // Un dépôt du Gouvernement se lit sur le texte déposé lui-même, ou sur le
      // libellé d'initiateur du dossier. Le client affiche alors « Gouvernement »
      // devant le nom, et aucun groupe : celui du ministre serait son groupe
      // actuel, pas une information sur ce texte.
      if (estOrigineGouvernementale([texte?.uid], dossierInfo?.groupeAbrege)) {
        auteurChambre = 'GOUV';
      } else {
        groupeAbrege = resolveGroupeAbrege(acteurData, organes);
        auteurChambre = resolveAuteurChambre(acteurData, organes);
      }
    } else {
      const resolvedUid = dossierInfo?.initiateurActeurRef ?? null;
      const acteurData = resolvedUid ? acteurs.get(resolvedUid) : null;
      auteur = acteurData ? `${acteurData.prenom} ${acteurData.nom}`.trim() : null;
      auteurUid = resolvedUid;
      groupeAbrege = dossierInfo?.groupeAbrege ?? null;
      auteurChambre = resolveAuteurChambre(acteurData, organes);
    }
  }

  // ── Rapporteur (DEPOT_RAPPORT + CMP_RAPPORT) ────────────────────────────
  if (type === 'DEPOT_RAPPORT' || type === 'CMP_RAPPORT' || type === 'COMMISSION_RAPPORT') {
    const rapporteurUid = texte?.rapporteurs_refs?.[0] ?? null;
    const rapporteurData = rapporteurUid ? acteurs.get(rapporteurUid) : null;
    if (rapporteurData) {
      rapporteurName = `${rapporteurData.prenom} ${rapporteurData.nom}`.trim();
      rapporteurGroupe = resolveGroupeAbrege(rapporteurData, organes);
      rapporteurIsMultiple = (texte?.rapporteurs_refs?.length ?? 0) > 1;
    }
  }

  return {
    id: `acte-${a.uid}`,
    type,
    date: a.date_acte,
    titre: a.libelle_acte || a.code_acte,
    dossierUid: a.dossier_uid,
    dossierTitre: dossierInfo?.titre ?? null,
    libelleActe: a.libelle_acte,
    codeActe: a.code_acte,
    // DEPOT_TEXTE + DEPOT_RAPPORT : libelle_abrege (version courte) ; autres types : nom complet
    organeName: (type === 'DEPOT_TEXTE' || type === 'DEPOT_RAPPORT') ? (organeData?.libelleAbrege ?? organeData?.name ?? null) : (organeData?.name ?? null),
    texteUid: texte?.uid ?? null,
    texteDenomination: texte?.denomination ?? null,
    texteTitre: texte?.titre_principal ?? null,
    texteLien: texte?.lien_texte ?? null,
    texteAdopteUid: texteAdopte?.uid ?? null,
    texteAdopteDenomination: texteAdopte?.denomination ?? null,
    texteAdopteTitre: texteAdopte?.titre_principal ?? null,
    texteAdopteLien: texteAdopte?.lien_texte ?? null,
    texteAdopteUrlAccessible: texteAdopte?.url_accessible ?? null,
    texteUrlAccessible: texte?.url_accessible ?? null,
    hasContenLegifrance: (texte?.contenu_legifrance ?? null) !== null,
    hasContenLegifranceAdopte: (texteAdopte?.contenu_legifrance ?? null) !== null,
    scrutinUid: scrutin?.uid ?? null,
    scrutinTitre: scrutin?.titre ?? null,
    typeVoteCode: scrutin?.type_vote_code ?? null,
    typeVoteLibelle: scrutin?.type_vote_libelle ?? null,
    typeMajorite: scrutin?.type_majorite ?? null,
    statutConclusion: a.statut_conclusion,
    urlConclusion: a.url_conclusion ?? null,
    auteur,
    auteurUid,
    groupeAbrege,
    auteurChambre,
    texteProvenance: texte?.provenance ?? null,
    texteHasTomes: texte?.has_tomes ?? null,
    organeCodeType: organeData?.codeType ?? null,
    rapporteurName,
    rapporteurGroupe,
    rapporteurIsMultiple,
    codeLoi: a.code_loi ?? null,
    titreLoi: a.titre_loi ?? null,
    votePour: scrutin?.synthese_pour ?? null,
    voteContre: scrutin?.synthese_contre ?? null,
    voteAbstentions: scrutin?.synthese_abstentions ?? null,
    voteVotants: scrutin?.synthese_nombre_votants ?? null,
    voteNonVotants: scrutin?.synthese_non_votants ?? null,
    voteSuffragesRequis: scrutin?.synthese_suffrages_requis ?? null,
    scrutins: scrutinsList.map(s => ({
      uid: s.uid,
      titre: s.titre,
      typeVoteCode: s.type_vote_code,
      typeVoteLibelle: s.type_vote_libelle,
      typeMajorite: s.type_majorite,
      votePour: s.synthese_pour,
      voteContre: s.synthese_contre,
      voteAbstentions: s.synthese_abstentions,
      voteVotants: s.synthese_nombre_votants,
      voteNonVotants: s.synthese_non_votants,
      voteSuffragesRequis: s.synthese_suffrages_requis,
      statutConclusion: (() => {
        // Le sort d'une motion de procédure n'est pas celui du texte : l'acte le dit. Lu
        // par la même grille, pour que le badge s'écrive comme sur les autres votes.
        const l = ((estMotionProcedure(s.titre) ? a.statut_conclusion : s.sort_libelle) ?? '').toLowerCase();
        if (l.includes('rejet') || l.includes("n'a pas adopt") || l.includes('pas adopté')) return 'Rejeté';
        if (l.includes('adopt')) return 'Adopté';
        return a.statut_conclusion;
      })(),
      chambre: s.chambre,
    })),
  };
}

/** Convertit une date en YYYY-MM-DD timezone Paris */
function toParisDateISO(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.split('T')[0] || 'unknown';
  const paris = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  return `${paris.getFullYear()}-${String(paris.getMonth() + 1).padStart(2, '0')}-${String(paris.getDate()).padStart(2, '0')}`;
}

/** Priorité des types pour désigner l'événement primaire d'un groupe fusionné */
const TYPE_PRIORITY: Record<FeedEventType, number> = {
  LOI_APPLIQUEE: 100,
  PROMULGATION: 90,
  MOTION_CENSURE: 80,
  DECISION: 70,
  CC_SAISINE: 60,
  CMP_RAPPORT: 50,
  CMP_CONVOCATION: 45,
  NAVETTE: 40,
  DEPOT_RAPPORT: 30,
  COMMISSION_RAPPORT_PUBLIE: 31,
  COMMISSION_RAPPORT: 29,
  COMMISSION_CREA: 28,
  DEPOT_TEXTE: 25,
  DECL_GOUVERNEMENT: 20,
  DECRET: 15,
  MOTION_VOTE: 10,
  AUTRE: 0,
};

/** Groupe des FeedEvents en GroupedFeedEvent[] — fusion par dossier + date (types différents inclus) */
function groupFeedEvents(feedEvents: FeedEvent[]): Map<string, GroupedFeedEvent> {
  const groupMap = new Map<string, GroupedFeedEvent>();
  for (const event of feedEvents) {
    const dateISO = event.date ? toParisDateISO(event.date) : 'unknown';
    const key = event.dossierUid
      ? `${event.dossierUid}-${dateISO}`
      : `${event.id}-${dateISO}`;
    const existing = groupMap.get(key);
    if (existing) {
      existing.events.push(event);
    } else {
      groupMap.set(key, {
        key,
        type: event.type,
        date: dateISO,
        dossierUid: event.dossierUid,
        dossierTitre: event.dossierTitre,
        events: [event],
        dossierHasTexte: false,
      });
    }
  }
  // Tri interne par priorité de type pour identifier l'événement primaire
  for (const group of groupMap.values()) {
    group.events.sort((a, b) => (TYPE_PRIORITY[b.type] ?? 0) - (TYPE_PRIORITY[a.type] ?? 0));
    group.type = group.events[0].type;
  }
  return groupMap;
}

// ---------------------------------------------------------------------------
// fetchMonthData — pipeline réutilisable (Server Component + Server Action)
// ---------------------------------------------------------------------------

export async function fetchMonthData(monthKey?: string, locale?: string, lawFullyAppliedLabel?: string): Promise<MonthData> {
  const { monthStart, monthEnd, year, month } = getMonthBounds(monthKey);

  // Elargir les bornes de +/-1 jour pour compenser les decalages de timezone
  const queryStart = new Date(monthStart.getTime() - 86400000);
  const queryEnd = new Date(monthEnd.getTime() + 86400000);
  const monthStartISO = queryStart.toISOString();
  const monthEndISO = queryEnd.toISOString();

  // ── Round 1 : actes du mois + lois pleinement appliquées + rapports COMENQ ──
  const [actes, motionActes, fullyAppliedLaws, comenqTexteUids] = await Promise.all([
    getMonthActes(monthStartISO, monthEndISO),
    getMonthMotionActes(monthStartISO, monthEndISO),
    getFullyAppliedLaws(),
    getComenqTexteUids(),
  ]);

  // Dates du dernier décret + texte_uid promulgation pour chaque loi appliquée
  const appliedDossierUids = fullyAppliedLaws.map(a => a.dossier_uid!);
  const [lastDecreeDates, promulgationTexteUids, comenqPublies] = await Promise.all([
    getLastDecreeDates(appliedDossierUids),
    getPromulgationTexteUids(appliedDossierUids),
    getComenqRapportsPublies(comenqTexteUids, monthStartISO, monthEndISO),
  ]);

  const uniqueMotions = [...new Map(motionActes.map(a => [a.uid, a])).values()];

  // ── Round 2 : résolutions intermédiaires ──
  const motionUids = uniqueMotions.map(a => a.uid);
  const motionDecisionMap = await getMotionDecisionActes(motionUids);

  // Collecter UIDs depuis actes + motions
  const texteUids = new Set<string>();
  const organeUids = new Set<string>();
  const scrutinUidsFromActes = new Set<string>();
  const dossierUidsSet = new Set<string>();

  for (const a of [...actes, ...uniqueMotions]) {
    (a.textes_associes ?? []).forEach((t: string) => texteUids.add(t));
    if (a.texte_adopte) texteUids.add(a.texte_adopte);
    if (a.organe_ref) organeUids.add(a.organe_ref);
    (a.vote_refs ?? []).forEach((r: string) => scrutinUidsFromActes.add(r));
    if (a.dossier_uid) dossierUidsSet.add(a.dossier_uid);
  }
  // Ajouter les dossiers des lois appliquées pour résolution
  for (const uid of appliedDossierUids) dossierUidsSet.add(uid);
  // Ajouter les dossiers des rapports COMENQ publiés ce mois
  for (const r of comenqPublies) { if (r.dossier_ref) dossierUidsSet.add(r.dossier_ref); }

  // Dossiers des actes COMMISSION_CREA pour récupérer leur rapporteur (acte NOMIN séparé)
  const creaDossierUids = actes
    .filter(a => classifyByLibelle(a.libelle_acte) === 'COMMISSION_CREA')
    .map(a => a.dossier_uid)
    .filter((uid): uid is string => uid !== null);

  // ── Round 3 : textes, scrutins, dossiers, textes accessibles, rapporteurs CREA ──
  const [dossierTitles, textes, scrutinsMapFromActes, dossiersWithTexte, nominMap] = await Promise.all([
    getDossierTitles([...dossierUidsSet], locale ?? 'fr'),
    getTextesByUids([...texteUids]),
    getScrutinsByUids([...scrutinUidsFromActes], locale ?? 'fr'),
    getDossiersWithAccessibleTexte([...dossierUidsSet]),
    getCommissionNominActes(creaDossierUids),
  ]);

  // ── Round 4 : acteurs (auteurs + rapporteurs des textes + initiateurs des dossiers + rapporteurs CREA) ──
  const acteurUids = new Set<string>();
  for (const texte of textes.values()) {
    if (texte.auteurs_refs?.[0]) acteurUids.add(texte.auteurs_refs[0]);
    if (texte.rapporteurs_refs?.[0]) acteurUids.add(texte.rapporteurs_refs[0]);
  }
  for (const d of dossierTitles.values()) {
    if (d.initiateurActeurRef) acteurUids.add(d.initiateurActeurRef);
  }
  for (const acteurRef of nominMap.values()) acteurUids.add(acteurRef);
  for (const r of comenqPublies) { if (r.rapporteurs_refs?.[0]) acteurUids.add(r.rapporteurs_refs[0]); }

  // Lancer acteurs + organes des actes en parallèle
  const acteOrganeUids = [...organeUids];
  const [acteurs, organesPart1] = await Promise.all([
    getActeursByUids([...acteurUids]),
    getOrganesByUids(acteOrganeUids),
  ]);

  // Fetch uniquement les organes de groupe des acteurs non encore connus
  const extraOrganeUids = new Set<string>();
  for (const a of acteurs.values()) {
    if (a.groupe && !organeUids.has(a.groupe)) extraOrganeUids.add(a.groupe);
    for (const r of a.organes_refs ?? []) {
      if (!organeUids.has(r)) extraOrganeUids.add(r);
    }
  }
  const organesPart2 = extraOrganeUids.size > 0
    ? await getOrganesByUids([...extraOrganeUids])
    : new Map<string, { name: string; libelleAbrege: string | null; codeType: string | null }>();
  const organes = new Map([...organesPart1, ...organesPart2]);

  // ── Transformation en FeedEvents ──
  const acteEvents: FeedEvent[] = actes
    .map(a => {
      const dossier = a.dossier_uid ? dossierTitles.get(a.dossier_uid) : null;
      return acteToFeedEvent(a, dossier ?? null, textes, organes, scrutinsMapFromActes, acteurs);
    })
    .filter(e => e.type !== 'AUTRE');

  // Enrichir les COMMISSION_CREA avec le rapporteur de l'acte NOMIN
  for (const event of acteEvents) {
    if (event.type === 'COMMISSION_CREA' && event.dossierUid) {
      const acteurRef = nominMap.get(event.dossierUid);
      if (acteurRef) {
        const acteur = acteurs.get(acteurRef);
        if (acteur) {
          event.rapporteurName = `${acteur.prenom} ${acteur.nom}`.trim();
          event.rapporteurGroupe = resolveGroupeAbrege(acteur, organes);
        }
      }
    }
  }

  const motionEvents: FeedEvent[] = uniqueMotions.map(a => {
    const dossier = a.dossier_uid ? dossierTitles.get(a.dossier_uid) : null;
    const childConclusion = motionDecisionMap.get(a.uid) ?? null;
    const texteStatut = a.textes_associes?.[0] ? textes.get(a.textes_associes[0])?.statut_adoption ?? null : null;
    const voteRef = voteLePlusRecent((a.vote_refs ?? []).filter((r: string) => scrutinsMapFromActes.has(r)));
    const scrutinFallback = voteRef ? scrutinsMapFromActes.get(voteRef)?.sort_libelle ?? null : null;
    return acteToFeedEvent(
      { ...a, statut_conclusion: childConclusion ?? texteStatut ?? scrutinFallback },
      dossier ?? null, textes, organes, scrutinsMapFromActes, acteurs,
    );
  });

  // ── Application directe : enrichir les cartes PROMULGATION ──
  const promulgationDossierUids = acteEvents
    .filter(e => e.type === 'PROMULGATION' && e.dossierUid)
    .map(e => e.dossierUid!);
  const applicationDirecteSet = await getApplicationDirecteSet(promulgationDossierUids);
  for (const event of acteEvents) {
    if (event.type === 'PROMULGATION' && event.dossierUid && applicationDirecteSet.has(event.dossierUid)) {
      event.applicationDirecte = true;
    }
  }

  // ── LOI_APPLIQUEE : événements synthétiques ──
  const monthStartISO_paris = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEndISO_paris = `${year}-${String(month + 1).padStart(2, '0')}-${String(monthEnd.getDate()).padStart(2, '0')}`;

  const loiAppliqueeEvents: FeedEvent[] = [];
  for (const law of fullyAppliedLaws) {
    const decreeInfo = lastDecreeDates.get(law.dossier_uid!);
    if (!decreeInfo) continue;
    const lastDateParis = toParisDateISO(decreeInfo.lastDate);
    if (lastDateParis < monthStartISO_paris || lastDateParis > monthEndISO_paris) continue;

    const dossier = dossierTitles.get(law.dossier_uid!);
    loiAppliqueeEvents.push({
      id: `loi-appliquee-${law.dossier_uid}`,
      type: 'LOI_APPLIQUEE',
      date: decreeInfo.lastDate,
      // Sur /en, le titre de la loi traduit par l'IA quand il existe (`lib/titre-dossier.ts`).
      titre: titreDossier(law, locale ?? 'fr') || dossier?.titre || lawFullyAppliedLabel || 'Loi pleinement appliquée',
      dossierUid: law.dossier_uid,
      dossierTitre: dossier?.titre ?? null,
      libelleActe: null, codeActe: null, organeName: null,
      texteUid: promulgationTexteUids.get(law.dossier_uid!) ?? null, texteDenomination: null, texteTitre: null, texteLien: null,
      texteAdopteUid: null, texteAdopteDenomination: null, texteAdopteTitre: null, texteAdopteLien: null,
      texteAdopteUrlAccessible: null, texteUrlAccessible: null,
      hasContenLegifrance: false, hasContenLegifranceAdopte: false,
      scrutinUid: null, scrutinTitre: null,
      typeVoteCode: null, typeVoteLibelle: null, typeMajorite: null, statutConclusion: null,
      auteur: null, auteurUid: null, groupeAbrege: null, auteurChambre: null,
      texteProvenance: null, texteHasTomes: null, organeCodeType: null,
      rapporteurName: null, rapporteurGroupe: null, rapporteurIsMultiple: null,
      codeLoi: dossier?.codeLoi ?? null,
      titreLoi: titreDossier(law, locale ?? 'fr') || null,
      nbDecrets: decreeInfo.count,
      nbMesuresAttendues: law.nb_mesures_attendues,
      datePromulgation: dossier?.datePromulgation ?? null,
      scrutins: [],
    });
  }

  // ── COMMISSION_RAPPORT_PUBLIE : événements synthétiques pour rapports devenus accessibles ──
  const comenqPublieEvents: FeedEvent[] = comenqPublies.map(r => {
    const dossier = r.dossier_ref ? dossierTitles.get(r.dossier_ref) : null;
    const rapporteurUid = r.rapporteurs_refs?.[0] ?? null;
    const rapporteurData = rapporteurUid ? acteurs.get(rapporteurUid) : null;
    return {
      id: `comenq-publie-${r.uid}`,
      type: 'COMMISSION_RAPPORT_PUBLIE' as const,
      date: r.date_accessible!,
      titre: r.titre_principal || dossier?.titre || 'Rapport disponible',
      dossierUid: r.dossier_ref ?? null,
      dossierTitre: dossier?.titre ?? null,
      libelleActe: null, codeActe: null, organeName: null,
      texteUid: r.uid, texteDenomination: r.denomination, texteTitre: r.titre_principal, texteLien: r.lien_texte,
      texteAdopteUid: null, texteAdopteDenomination: null, texteAdopteTitre: null, texteAdopteLien: null,
      texteAdopteUrlAccessible: null, texteUrlAccessible: true,
      hasContenLegifrance: false, hasContenLegifranceAdopte: false,
      scrutinUid: null, scrutinTitre: null,
      typeVoteCode: null, typeVoteLibelle: null, typeMajorite: null, statutConclusion: null,
      auteur: null, auteurUid: null, groupeAbrege: null, auteurChambre: null,
      texteProvenance: null, texteHasTomes: null, organeCodeType: null,
      rapporteurName: rapporteurData ? `${rapporteurData.prenom} ${rapporteurData.nom}`.trim() : null,
      rapporteurGroupe: rapporteurData ? resolveGroupeAbrege(rapporteurData, organes) : null,
      rapporteurIsMultiple: (r.rapporteurs_refs?.length ?? 0) > 1,
      codeLoi: null, titreLoi: null,
      scrutins: [],
    };
  });

  // Sur /en, les libellés que la base écrit en français passent en anglais : acte
  // (glossaire `definitions`), chambre et Présidence, type de scrutin et majorité,
  // dénomination des textes (`lib/denomination.ts`). Les noms de commissions et de
  // délégations restent en français, comme les noms de groupes ; le dialogue de
  // `LocaleToggle` l'annonce. Le statut de conclusion se traduit à l'affichage
  // (`MonthFeedClient`), sa valeur brute servant de clé de couleur.
  //
  // Une carte dont le dossier a un titre traduit l'affiche en plus à la place des
  // titres français de ses documents (`titre_principal` des textes, `titre_loi` des
  // actes) : `CardTitle` et `SubEvent` les préfèrent sinon. La dénomination d'un
  // texte, elle, est retirée partout où elle prendrait la place de ce titre, sauf
  // pour un décret, dont elle nomme la loi appliquée (« For Act No. … »). Le titre
  // de loi d'une loi appliquée est déjà traduit (`titreDossier`), il reste.
  const [tMonth, tDefinitions, tDenomination] = locale === 'en'
    ? await Promise.all([
      getTranslations({ locale, namespace: 'month' }),
      getTranslations({ locale, namespace: 'definitions' }),
      getTranslations({ locale, namespace: 'denomination' }),
    ])
    : [];
  const enAnglais = (e: FeedEvent): FeedEvent => {
    if (!tMonth || !tDefinitions || !tDenomination) return e;
    const libelle = (table: Record<string, string>, prefixe: string, brut: string | null) =>
      brut && table[brut] ? tMonth(`${prefixe}.${table[brut]}`) : brut;
    const acte = e.libelleActe ? (getDefinition(e.libelleActe, tDefinitions)?.term ?? e.libelleActe) : null;
    const titreTraduit = e.type !== 'LOI_APPLIQUEE' && !!e.dossierUid && !!dossierTitles.get(e.dossierUid)?.titreTraduit;
    return {
      ...e,
      titre: e.titre === e.libelleActe && acte ? acte : e.titre,
      libelleActe: acte,
      organeName: organeEnAnglais(e.organeCodeType, e.organeName, tMonth),
      typeVoteLibelle: libelle(TYPE_VOTE_CLE, 'typeVote', e.typeVoteLibelle),
      typeMajorite: libelle(MAJORITE_CLE, 'majorite', e.typeMajorite),
      scrutins: e.scrutins.map((s) => ({
        ...s,
        typeVoteLibelle: libelle(TYPE_VOTE_CLE, 'typeVote', s.typeVoteLibelle),
        typeMajorite: libelle(MAJORITE_CLE, 'majorite', s.typeMajorite),
      })),
      texteDenomination: titreTraduit && e.type !== 'DECRET' ? null : traduireDenomination(e.texteDenomination, tDenomination),
      texteAdopteDenomination: traduireDenomination(e.texteAdopteDenomination, tDenomination),
      ...(titreTraduit ? { texteTitre: null, texteAdopteTitre: null, titreLoi: null } : {}),
    };
  };
  const allEvents: FeedEvent[] = [...acteEvents, ...motionEvents, ...loiAppliqueeEvents, ...comenqPublieEvents]
    .map(enAnglais)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // Filtrer les events du buffer ±1j qui tombent hors du mois (timezone Paris)
  const monthEvents = allEvents.filter(event => {
    const iso = toParisDateISO(event.date);
    return iso >= monthStartISO_paris && iso <= monthEndISO_paris;
  });

  // Volume du mois, affiché dans la barre du fil (post-timezone)
  const kpis: MonthKpis = {
    totalEvents: monthEvents.length,
  };

  // Grouper les événements filtrés
  const groupMap = groupFeedEvents(monthEvents);
  const groupedEvents = [...groupMap.values()].sort((a, b) =>
    b.date.localeCompare(a.date) || (b.type === 'LOI_APPLIQUEE' ? 1 : 0) - (a.type === 'LOI_APPLIQUEE' ? 1 : 0)
  );

  for (const g of groupedEvents) {
    g.dossierHasTexte = g.dossierUid ? dossiersWithTexte.has(g.dossierUid) : false;
  }

  // Clé du mois courant + mois précédent
  const currentMonthKey = formatISOMonth(new Date(year, month, 1));
  const prevMonthKey = moisPrecedent(currentMonthKey);

  const isCurrentOrFutureMonth = monthEnd >= new Date();

  // Formatage du mois : "février 2026"
  const monthFormatted = libelleMoisLong(currentMonthKey, locale ?? 'fr');

  return {
    groupedEvents,
    kpis,
    year,
    month,
    monthFormatted,
    monthKey: currentMonthKey,
    prevMonthKey,
    isCurrentOrFutureMonth,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function MonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const resolvedParams = await searchParams;

  const t = await getTranslations({ locale, namespace: 'month' });
  const lawFullyAppliedLabel = t('lawFullyApplied');

  const moisParam = typeof resolvedParams.mois === 'string' ? resolvedParams.mois : undefined;
  const typeParam = typeof resolvedParams.type === 'string' ? resolvedParams.type : undefined;

  const data = await fetchMonthData(moisParam, locale, lawFullyAppliedLabel);

  return (
    <MonthFeedClient
        key={data.monthKey}
        groupedEvents={data.groupedEvents}
        kpis={data.kpis}
        monthFormatted={data.monthFormatted}
        initialMonthKey={data.monthKey}
        initialPrevMonthKey={data.prevMonthKey}
        isCurrentOrFutureMonth={data.isCurrentOrFutureMonth}
        initialFilterType={typeParam}
      />
  );
}
