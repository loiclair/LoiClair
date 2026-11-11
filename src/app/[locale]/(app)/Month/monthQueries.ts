// src/app/[locale]/(app)/Month/monthQueries.ts
// Requêtes SQL isolées pour la page "Fil d'actualité" (seul appelant : `Month/page.tsx`).
//
// Les lectures sans tri gardent l'ordre que Postgres choisit, comme avant. La plupart
// remplissent une Map ou un Set, où il ne compte pas ; trois Map gardent la dernière
// ligne lue quand plusieurs actes visent la même clé (`getMotionDecisionActes`,
// `getPromulgationTexteUids`, `getCommissionNominActes`).

import { sql } from '@/lib/db';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';

// ── Source unique : mapping libellé → type d'événement ──
// Toutes les listes filtrées (feed, timeline) en dérivent automatiquement.
export type FeedEventType =
  | 'DEPOT_TEXTE' | 'DEPOT_RAPPORT' | 'DECISION' | 'NAVETTE'
  | 'CMP_CONVOCATION' | 'CMP_RAPPORT' | 'MOTION_CENSURE' | 'DECL_GOUVERNEMENT'
  | 'MOTION_VOTE' | 'CC_SAISINE' | 'PROMULGATION' | 'DECRET' | 'LOI_APPLIQUEE'
  | 'COMMISSION_CREA' | 'COMMISSION_RAPPORT' | 'COMMISSION_RAPPORT_PUBLIE' | 'AUTRE';

export const LIBELLE_TO_TYPE: Record<string, FeedEventType> = {
  "1er depot d'une initiative.": 'DEPOT_TEXTE',
  "1er dépôt d'une initiative.": 'DEPOT_TEXTE',
  "Dépôt de rapport": 'DEPOT_RAPPORT',
  "Décision": 'DECISION',
  "Dépôt d'une initiative en navette": 'NAVETTE',
  "Convocation d'une CMP": 'CMP_CONVOCATION',
  "Dépôt du rapport d'une CMP": 'CMP_RAPPORT',
  "Décision de la CMP": 'DECISION',
  "Motion de censure": 'MOTION_CENSURE',
  "Dépôt d'une déclaration du gouvernement": 'DECL_GOUVERNEMENT',
  "Décision sur une motion de censure": 'MOTION_VOTE',
  "Saisine du conseil constitutionnel": 'CC_SAISINE',
  "Conclusion du conseil constitutionnel": 'DECISION',
  "Promulgation d'une loi": 'PROMULGATION',
  "Publication d'un décret d'application": 'DECRET',
  "Création d'une commission d'enquête": 'COMMISSION_CREA',
};

// Fil d'actualité : tous sauf motions (traitées séparément)
const FEED_TRACKED_LIBELLES = Object.keys(LIBELLE_TO_TYPE).filter(
  l => LIBELLE_TO_TYPE[l] !== 'MOTION_CENSURE' && LIBELLE_TO_TYPE[l] !== 'MOTION_VOTE',
);

/**
 * Actes suivis par le fil, datés dans la fenêtre `[dateStart, dateEnd]` (ISO), du plus
 * récent au plus ancien. Une panne est journalisée et rend une liste vide.
 */
export async function getMonthActes(dateStart: string, dateEnd: string) {
  try {
    // `dossier` est l'objet `{ hors_liste }` qu'attendent les appelants.
    // Plusieurs actes tombent à la même heure : `uid` les départage (D-329), sans quoi
    // leur ordre suivrait le plan d'exécution et changerait avec lui.
    return await sql<(ActeRow & { dossier: { hors_liste: boolean } })[]>`
      select a.uid, a.code_acte, a.libelle_acte, a.date_acte, a.statut_conclusion, a.organe_ref, a.vote_refs,
        a.textes_associes, a.texte_adopte, a.dossier_uid, a.code_loi, a.titre_loi, a.url_conclusion,
        (select json_build_object('hors_liste', d.hors_liste) from dossiers_legislatifs d where d.uid = a.dossier_uid) as dossier
      from actes_legislatifs a
      where a.date_acte >= ${dateStart}
        and a.date_acte <= ${dateEnd}
        and a.date_acte is not null
        and a.libelle_acte = any(${FEED_TRACKED_LIBELLES})
        -- hors_liste : dossiers comptés dans le score mais absents des listes (migration 2026-10-29_dossiers_hors_liste.sql).
        -- Le fil commence en juillet 2024 : sans ce filtre, les dépôts du Sénat du 1er au
        -- 17 juillet 2024 et une promulgation de 2025 y entreraient. dossier_uid est
        -- NOT NULL, le filtre n'écarte donc aucun autre acte.
        and exists (select 1 from dossiers_legislatifs d where d.uid = a.dossier_uid and d.hors_liste = false)
      order by a.date_acte desc, a.uid desc`;
  } catch (error) {
    console.error('Erreur actes mois:', error);
    return [];
  }
}

// Motions de censure (traitées séparément de getMonthActes)
// Filtre : seulement celles avec textes
export async function getMonthMotionActes(dateStart: string, dateEnd: string) {
  try {
    return await sql<ActeRow[]>`
      select uid, code_acte, libelle_acte, date_acte, statut_conclusion, organe_ref, vote_refs, textes_associes,
        texte_adopte, dossier_uid
      from actes_legislatifs
      where date_acte >= ${dateStart}
        and date_acte <= ${dateEnd}
        and libelle_acte = 'Motion de censure'
        and textes_associes is not null
      order by date_acte desc`;
  } catch (error) {
    console.error('Erreur motions mois:', error);
    return [];
  }
}

// Récupère le statut_conclusion des actes enfants de type MOTION-VOTE
// (code_acte *-MOTION-VOTE, sans dépendre du libelle exact)
export async function getMotionDecisionActes(parentUids: string[]) {
  if (parentUids.length === 0) return new Map<string, string>();

  let data: { uid: string; parent_uid: string | null; statut_conclusion: string | null }[] = [];
  try {
    data = await sql<typeof data>`
      select uid, parent_uid, statut_conclusion
      from actes_legislatifs
      where parent_uid = any(${parentUids})
        and statut_conclusion is not null`;
  } catch (error) {
    console.error('Erreur décision motions:', error);
  }

  const map = new Map<string, string>();
  for (const row of data) {
    if (row.parent_uid && row.statut_conclusion) {
      map.set(row.parent_uid, row.statut_conclusion);
    }
  }
  return map;
}

// Forme d'une ligne d'actes_legislatifs telle que la consomme acteToFeedEvent
// dans page.tsx. Les trois derniers champs sont optionnels parce que les deux
// requêtes qui produisent ce type ne sélectionnent pas les mêmes colonnes :
// getMonthActes les demande, getMonthMotionActes non.
export type ActeRow = { uid: string; code_acte: string; libelle_acte: string | null; date_acte: string; statut_conclusion: string | null; organe_ref: string | null; vote_refs: string[] | null; textes_associes: string[] | null; texte_adopte: string | null; dossier_uid: string | null; code_loi?: string | null; titre_loi?: string | null; url_conclusion?: string | null };

// Une entrée de `getDossierTitles`. `titreTraduit` dit que `titre` est la traduction
// de l'IA : la carte du fil laisse alors de côté les titres français de ses documents.
type DossierTitre = { titre: string; titreTraduit: boolean; uid: string; statut_final: string | null; procedure_libelle: string | null; initiateurActeurRef: string | null; groupeAbrege: string | null; datePromulgation: string | null; codeLoi: string | null };

// Récupère les titres des dossiers liés aux actes (batch) + initiateur. Sur /en, le
// titre traduit par l'IA quand il existe (`lib/titre-dossier.ts`).
export async function getDossierTitles(dossierUids: string[], locale: string) {
  if (dossierUids.length === 0) return new Map<string, DossierTitre>();

  type Ligne = { uid: string; titre: string | null; titre_en: string | null; statut_final: string | null; procedure_libelle: string | null; initiateur_acteur_ref: string | null; initiateur_groupe_libelle: string | null; date_promulgation: string | null; code_loi: string | null };
  let data: Ligne[] = [];
  try {
    data = await sql<Ligne[]>`
      select uid, titre, titre_en, statut_final, procedure_libelle, initiateur_acteur_ref, initiateur_groupe_libelle,
        date_promulgation, code_loi
      from dossiers_legislatifs
      where uid = any(${dossierUids})`;
  } catch (error) {
    console.error('Erreur titres dossiers:', error);
  }

  const map = new Map<string, DossierTitre>();
  for (const d of data) {
    map.set(d.uid, {
      titre: titreDossier(d, locale),
      titreTraduit: titreTraduit(d, locale),
      uid: d.uid,
      statut_final: d.statut_final,
      procedure_libelle: d.procedure_libelle,
      initiateurActeurRef: d.initiateur_acteur_ref ?? null,
      groupeAbrege: d.initiateur_groupe_libelle ?? null,
      datePromulgation: d.date_promulgation ?? null,
      codeLoi: d.code_loi ?? null,
    });
  }
  return map;
}

type TexteLite = { uid: string; denomination: string | null; titre_principal: string | null; lien_texte: string | null; provenance: string | null; statut_adoption: string | null; url_accessible: boolean | null; date_accessible: string | null; auteurs_refs: string[] | null; has_tomes: boolean | null; rapporteurs_refs: string[] | null; contenu_legifrance: string | null };

export async function getTextesByUids(uids: string[]) {
  if (uids.length === 0) return new Map<string, TexteLite>();

  let data: TexteLite[] = [];
  try {
    data = await sql<TexteLite[]>`
      select uid, denomination, titre_principal, lien_texte, provenance, statut_adoption, url_accessible,
        date_accessible, auteurs_refs, has_tomes, rapporteurs_refs, contenu_legifrance
      from textes
      where uid = any(${uids})`;
  } catch (error) {
    console.error('Erreur textes batch:', error);
  }

  const map = new Map<string, TexteLite>();
  for (const t of data) {
    map.set(t.uid, t);
  }
  return map;
}

export async function getOrganesByUids(uids: string[]) {
  if (uids.length === 0) return new Map<string, { name: string; libelleAbrege: string | null; codeType: string | null }>();

  let data: { uid: string; libelle: string | null; libelle_abrege: string | null; code_type: string | null }[] = [];
  try {
    data = await sql<typeof data>`
      select uid, libelle, libelle_abrege, code_type
      from organes
      where uid = any(${uids})`;
  } catch (error) {
    console.error('Erreur organes batch:', error);
  }

  const map = new Map<string, { name: string; libelleAbrege: string | null; codeType: string | null }>();
  for (const o of data) {
    const name = o.libelle || o.libelle_abrege;
    if (name) map.set(o.uid, { name, libelleAbrege: o.libelle_abrege ?? null, codeType: o.code_type ?? null });
  }
  return map;
}

export type ActeurLite = {
  prenom: string;
  nom: string;
  groupe: string | null;
  organes_refs: string[] | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  est_ministre_actuel: boolean | null;
};

export async function getActeursByUids(uids: string[]) {
  if (uids.length === 0) return new Map<string, ActeurLite>();

  type Ligne = { uid: string; prenom: string | null; nom: string | null; groupe: string | null; organes_refs: string[] | null; est_depute_actuel: boolean | null; est_senateur_actuel: boolean | null; est_ministre_actuel: boolean | null };
  let data: Ligne[] = [];
  try {
    data = await sql<Ligne[]>`
      select uid, prenom, nom, groupe, organes_refs, est_depute_actuel, est_senateur_actuel, est_ministre_actuel
      from acteurs
      where uid = any(${uids})`;
  } catch (error) {
    console.error('Erreur acteurs batch:', error);
  }

  const map = new Map<string, ActeurLite>();
  for (const a of data) {
    map.set(a.uid, {
      prenom: a.prenom ?? '',
      nom: a.nom ?? '',
      groupe: a.groupe ?? null,
      organes_refs: a.organes_refs ?? null,
      est_depute_actuel: a.est_depute_actuel ?? null,
      est_senateur_actuel: a.est_senateur_actuel ?? null,
      est_ministre_actuel: a.est_ministre_actuel ?? null,
    });
  }
  return map;
}

type ScrutinLite = { uid: string; titre: string | null; sort_libelle: string | null; type_vote_libelle: string | null; type_vote_code: string | null; type_majorite: string | null; synthese_pour: number | null; synthese_contre: number | null; synthese_abstentions: number | null; synthese_nombre_votants: number | null; synthese_non_votants: number | null; synthese_suffrages_requis: number | null; chambre: string | null };

// Scrutins cités par les actes du mois. Sur /en, le titre traduit par l'IA quand il
// existe (`lib/titre-dossier.ts`), choisi ici comme celui des dossiers.
export async function getScrutinsByUids(uids: string[], locale: string) {
  if (uids.length === 0) return new Map<string, ScrutinLite>();

  let data: (ScrutinLite & { titre_en: string | null })[] = [];
  try {
    data = await sql<typeof data>`
      select uid, titre, titre_en, sort_libelle, type_vote_libelle, type_vote_code, type_majorite, synthese_pour,
        synthese_contre, synthese_abstentions, synthese_nombre_votants, synthese_non_votants,
        synthese_suffrages_requis, chambre
      from scrutins
      where uid = any(${uids})`;
  } catch (error) {
    console.error('Erreur scrutins batch:', error);
  }

  const map = new Map<string, ScrutinLite>();
  for (const { titre_en, ...s } of data) {
    map.set(s.uid, { ...s, titre: titreDossier({ titre: s.titre, titre_en }, locale) || null });
  }
  return map;
}

// ── Application des lois : requêtes pour LOI_APPLIQUEE et application directe ──

/** Set des dossier_uid ayant application_directe = true */
export async function getApplicationDirecteSet(dossierUids: string[]) {
  if (dossierUids.length === 0) return new Set<string>();

  try {
    const data = await sql<{ dossier_uid: string | null }[]>`
      select dossier_uid
      from application_lois
      where application_directe = true
        and dossier_uid = any(${dossierUids})`;
    return new Set(data.map(d => d.dossier_uid).filter(Boolean) as string[]);
  } catch (error) {
    console.error('Erreur application_directe:', error);
    return new Set<string>();
  }
}

/** Lois pleinement appliquées via décrets (statut_application = 'appliquee') */
export async function getFullyAppliedLaws() {
  try {
    // `nb_mesures_attendues` et `dossier_uid` ne sont jamais nuls ici : le filtre les écarte.
    return await sql<{ dossier_uid: string; titre: string | null; titre_en: string | null; nb_mesures_attendues: number; nb_mesures_appliquees: number | null }[]>`
      select dossier_uid, titre, titre_en, nb_mesures_attendues, nb_mesures_appliquees
      from application_lois
      where statut_application = 'appliquee'
        and nb_mesures_attendues > 0
        and dossier_uid is not null`;
  } catch (error) {
    console.error('Erreur fully applied laws:', error);
    return [];
  }
}

/** Date du dernier décret DECAPP-PUB et nombre total par dossier */
export async function getPromulgationTexteUids(dossierUids: string[]) {
  if (dossierUids.length === 0) return new Map<string, string>();
  let data: { dossier_uid: string; textes_associes: string[] | null }[] = [];
  try {
    data = await sql<typeof data>`
      select dossier_uid, textes_associes
      from actes_legislatifs
      where libelle_acte = ${"Promulgation d'une loi"}
        and dossier_uid = any(${dossierUids})
        and textes_associes is not null`;
  } catch (error) {
    console.error('Erreur promulgation texte uids:', error);
  }
  const map = new Map<string, string>();
  for (const row of data) {
    const uid = row.textes_associes?.[0];
    if (uid) map.set(row.dossier_uid, uid);
  }
  return map;
}

export async function getLastDecreeDates(dossierUids: string[]) {
  if (dossierUids.length === 0) return new Map<string, { lastDate: string; count: number }>();

  let data: { dossier_uid: string; date_acte: string }[] = [];
  try {
    data = await sql<typeof data>`
      select dossier_uid, date_acte
      from actes_legislatifs
      where code_acte = 'DECAPP-PUB'
        and dossier_uid = any(${dossierUids})
        and date_acte is not null`;
  } catch (error) {
    console.error('Erreur last decree dates:', error);
  }

  const map = new Map<string, { lastDate: string; count: number }>();
  for (const row of data) {
    const existing = map.get(row.dossier_uid);
    if (!existing) {
      map.set(row.dossier_uid, { lastDate: row.date_acte, count: 1 });
    } else {
      existing.count++;
      if (row.date_acte > existing.lastDate) existing.lastDate = row.date_acte;
    }
  }
  return map;
}

/** Dossiers ayant au moins un texte avec URL accessible (texte publié).
 *  Utilisé pour désactiver le lien "Explorer le dossier" quand aucun texte
 *  n'est encore publié et qu'il n'y a donc rien à résumer. */
export async function getDossiersWithAccessibleTexte(dossierUids: string[]) {
  if (dossierUids.length === 0) return new Set<string>();
  try {
    const data = await sql<{ dossier_ref: string | null }[]>`
      select dossier_ref
      from textes
      where dossier_ref = any(${dossierUids})
        and (url_accessible = true or contenu_legifrance is not null)`;
    return new Set(data.map(d => d.dossier_ref).filter(Boolean) as string[]);
  } catch (error) {
    console.error('Erreur dossiers with accessible texte:', error);
    return new Set<string>();
  }
}

/** Rapporteur désigné sur l'acte AN20-COMENQ-NOMIN (nomination séparée de la création) */
export async function getCommissionNominActes(dossierUids: string[]): Promise<Map<string, string>> {
  if (dossierUids.length === 0) return new Map<string, string>();

  let data: { dossier_uid: string | null; rapporteurs: unknown }[] = [];
  try {
    data = await sql<typeof data>`
      select dossier_uid, rapporteurs
      from actes_legislatifs
      where code_acte = 'AN20-COMENQ-NOMIN'
        and dossier_uid = any(${dossierUids})`;
  } catch (error) {
    console.error('Erreur commission nomin actes:', error);
  }

  const map = new Map<string, string>();
  for (const row of data) {
    if (!row.dossier_uid) continue;
    const r = row.rapporteurs as { rapporteur?: { acteurRef?: string } | Array<{ acteurRef?: string }> } | null;
    if (!r) continue;
    let acteurRef: string | null = null;
    if (Array.isArray(r.rapporteur)) {
      acteurRef = r.rapporteur[0]?.acteurRef ?? null;
    } else if (r.rapporteur?.acteurRef) {
      acteurRef = r.rapporteur.acteurRef;
    }
    if (acteurRef) map.set(row.dossier_uid, acteurRef);
  }
  return map;
}

/**
 * UIDs de textes référencés par des actes COMENQ-RAPPORT.
 *
 * Lève sur une panne (D-136) : une liste vide passerait pour « aucun rapport », et le
 * bilan mensuel rendu sans eux resterait figé jusqu'à la régénération suivante.
 */
export async function getComenqTexteUids(): Promise<string[]> {
  const data = await sql<{ textes_associes: string[] | null }[]>`
    select textes_associes
    from actes_legislatifs
    where code_acte = 'AN20-COMENQ-RAPPORT'
      and textes_associes is not null`;
  const uids: string[] = [];
  for (const row of data) for (const uid of row.textes_associes ?? []) uids.push(uid);
  return uids;
}

export type ComenqRapportPublie = {
  uid: string;
  denomination: string | null;
  titre_principal: string | null;
  lien_texte: string | null;
  date_accessible: string | null;
  rapporteurs_refs: string[] | null;
  dossier_ref: string | null;
};

/** Textes de rapports COMENQ devenus accessibles (date_accessible) dans la fenêtre de dates. Lève sur une panne, comme `getComenqTexteUids`. */
export async function getComenqRapportsPublies(
  texteUids: string[],
  dateStart: string,
  dateEnd: string,
): Promise<ComenqRapportPublie[]> {
  if (texteUids.length === 0) return [];
  return await sql<ComenqRapportPublie[]>`
    select uid, denomination, titre_principal, lien_texte, date_accessible, rapporteurs_refs, dossier_ref
    from textes
    where uid = any(${texteUids})
      and url_accessible = true
      and date_accessible >= ${dateStart}
      and date_accessible <= ${dateEnd}`;
}
