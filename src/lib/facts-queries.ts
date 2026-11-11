// Helpers partagés qui calculent les métriques des pages /Facts/*.
// Utilisés à la fois par les pages Facts et par la landing, pour garantir
// que le même chiffre s'affiche partout.

import { auPlusUneLigne, sql } from "@/lib/db"
import {
  estPromulgueeOuAppliquee,
  LEGISLATURE_17_START,
  PROCEDURE_KEY,
  PROCEDURES_FINANCIERES,
  PROCEDURES_PROMULGABLES,
} from "@/lib/facts-shared"
import { estNonInscrits } from "@/lib/non-inscrits"
import { mean, median } from "@/lib/stats"
import { aujourdhuiAParisIso } from "@/lib/jour-paris"
import {
  compteDansQuota,
  compterQuota,
  depuisSituation,
  echeanceSituation,
  enVigueur,
  estFonctionExecutive,
  motifSituation,
  TYPES_LOCAUX_LO141,
  type EcheanceCumul,
  type EffetVerification,
  type SituationCumul,
} from "@/lib/mandats-locaux"

// ──────────────────────────────────────────────────────────────────────
// Taux de promulgation
// ──────────────────────────────────────────────────────────────────────

/**
 * Un seau de la vue `dossiers_cohorte_par_mois` : le nombre de dossiers de la cohorte
 * qui partagent une procédure, un statut, un mois de dépôt et un mois de promulgation.
 * `mois_promulgation` est nul tant que le texte n'est pas devenu une loi.
 */
export type SeauMois = {
  procedure_libelle: string | null
  statut_final: string | null
  /** `AAAA-MM`, découpé en UTC côté Postgres */
  mois_depot: string | null
  mois_promulgation: string | null
  nb: number
}

/**
 * Un seau de la vue `dossiers_cohorte_par_groupe` : même cohorte, ventilée cette fois
 * par groupe initiateur. Le libellé voyage avec l'uid parce que c'est lui qu'affiche
 * la barre du graphique, y compris pour les dossiers dont le groupe n'a pas d'uid.
 */
export type SeauGroupe = {
  procedure_libelle: string | null
  statut_final: string | null
  initiateur_groupe_uid: string | null
  initiateur_groupe_libelle: string | null
  nb: number
}

export type TauxPromulgationResult = {
  /**
   * Les deux ventilations brutes de la cohorte, pour les consommateurs qui ont besoin
   * d'un découpage que les compteurs ci-dessous ne portent pas : la courbe mensuelle
   * des dépôts et des promulgations, les graphiques par groupe, le compte par type de
   * texte. Aucune règle métier n'y est appliquée, `procedure_libelle` et
   * `statut_final` arrivent bruts.
   *
   * Les deux sommes de `nb` valent `totalDeposited` : ce sont deux vues de la même
   * population, jamais à additionner l'une à l'autre.
   */
  parMois: SeauMois[]
  parGroupe: SeauGroupe[]
  totalDeposited: number
  totalPromulgables: number
  promulgues: number
  adoptes: number
  /** arrondi à 1 décimale, lu par la page Facts et la landing */
  tauxPromulgation: number
  /**
   * Même taux par origine du texte, indexé par clé de `PROCEDURE_KEY` et jamais par
   * libellé : `propositionLoi` (parlementaires) et `projetLoi` (Gouvernement) portent
   * des taux très différents, que le taux global mélange. Lu par la réponse de
   * /Facts/taux-promulgation.
   */
  parProcedure: Record<string, { total: number; promulgues: number; taux: number }>
}

/**
 * La cohorte des textes déposés depuis le début de la 17ᵉ législature, et la part de
 * ceux à vocation législative (`PROCEDURES_PROMULGABLES`) devenus des lois, au total
 * et par procédure.
 *
 * Rend des seaux agrégés et non la liste des dossiers : la cohorte compte 3 312
 * textes dont aucun consommateur ne lit l'uid ni la date exacte, seulement des
 * comptes par mois, par groupe et par type. Un appelant qui a besoin d'une propriété
 * absente des seaux doit l'ajouter en dimension de la vue, pas rouvrir la lecture
 * ligne à ligne.
 *
 * Appelé par /Facts/taux-promulgation, `getEtatDesLieux` (entonnoir, textes déposés
 * par mois) et la maquette « Comment on arrive à nos chiffres » de la landing
 * (`(landing)/components/MethodeCard.tsx`). Les mesures qui portent sur des lois lisent `getLoisPromulguees`.
 */
export async function getTauxPromulgation(): Promise<TauxPromulgationResult> {
  // Deux vues agrégées et non les 3 312 dossiers un à un : 103 Ko au lieu des 902 Ko
  // que coûtait la lecture ligne à ligne, mesurés le 2026-09-22
  // (`2026-09-22_vues_cohorte_depots.sql`). L'ordre des seaux n'a aucun effet sur
  // les compteurs ; il est fixé pour que les graphiques qui lisent `parMois` et
  // `parGroupe` les reçoivent toujours dans le même ordre.
  const [parMois, parGroupe] = await Promise.all([
    sql<SeauMois[]>`
      select procedure_libelle, statut_final, mois_depot, mois_promulgation, nb
      from dossiers_cohorte_par_mois
      order by mois_depot desc, procedure_libelle, statut_final, mois_promulgation`,
    sql<SeauGroupe[]>`
      select procedure_libelle, statut_final, initiateur_groupe_uid, initiateur_groupe_libelle, nb
      from dossiers_cohorte_par_groupe
      order by procedure_libelle, statut_final, initiateur_groupe_uid, initiateur_groupe_libelle`,
  ])

  let totalDeposited = 0
  let totalPromulgables = 0
  let promulgues = 0
  let adoptes = 0
  const comptesParProcedure: Record<string, { total: number; promulgues: number }> = {}

  // Mêmes règles qu'avant, mot pour mot, appliquées à un seau plutôt qu'à un dossier :
  // les tests portent toujours sur `procedure_libelle` et `statut_final` bruts. La
  // définition de « promulguée » vit dans `estPromulgueeOuAppliquee`
  // (`facts-shared.ts`) : c'est elle que lisent aussi les pages qui refont ce tri.
  for (const s of parMois) {
    totalDeposited += s.nb
    if (!PROCEDURES_PROMULGABLES.has(s.procedure_libelle ?? "")) continue
    totalPromulgables += s.nb
    const statut = (s.statut_final ?? "").toLowerCase()
    const estPromulgue = estPromulgueeOuAppliquee(s.statut_final)
    if (estPromulgue) {
      promulgues += s.nb
      adoptes += s.nb
    } else if (statut.includes("adopt")) {
      adoptes += s.nb
    }
    // Toute procédure promulgable a sa clé dans `PROCEDURE_KEY` : le filtre
    // ci-dessus garantit qu'on ne tombe jamais sur un libellé hors table.
    const cle = PROCEDURE_KEY[s.procedure_libelle ?? ""]
    const compte = (comptesParProcedure[cle] ??= { total: 0, promulgues: 0 })
    compte.total += s.nb
    if (estPromulgue) compte.promulgues += s.nb
  }

  const arrondiTaux = (n: number, base: number) =>
    base > 0 ? Math.round((n * 1000) / base) / 10 : 0
  const tauxPromulgation = arrondiTaux(promulgues, totalPromulgables)
  const parProcedure = Object.fromEntries(
    Object.entries(comptesParProcedure).map(([cle, c]) => [
      cle,
      { ...c, taux: arrondiTaux(c.promulgues, c.total) },
    ]),
  )

  return {
    parMois,
    parGroupe,
    totalDeposited,
    totalPromulgables,
    promulgues,
    adoptes,
    tauxPromulgation,
    parProcedure,
  }
}

// ──────────────────────────────────────────────────────────────────────
// Lois promulguées depuis le début de la 17ᵉ législature
// ──────────────────────────────────────────────────────────────────────

export type LoiPromulguee = {
  uid: string
  date_depot: string | null
  date_promulgation: string | null
  statut_final: string | null
  procedure_libelle: string | null
  initiateur_groupe_uid: string | null
}

/**
 * Lois promulguées depuis le 18 juillet 2024, quelle que soit la date de dépôt de
 * leur texte. C'est le périmètre de toutes les mesures qui portent sur des lois
 * (origine, délais, procédure accélérée, « ce mois-ci ») ; seul le taux de
 * promulgation garde la cohorte de dépôt de `getTauxPromulgation`, parce qu'il
 * rapporte des lois à des textes déposés. Jusqu'au 2026-09-15, ces mesures lisaient
 * cette cohorte et perdaient 41 des 144 lois, justement les plus longues à aboutir.
 * Appelé par `getEtatDesLieux` et /Facts/delais.
 */
export async function getLoisPromulguees(): Promise<LoiPromulguee[]> {
  // Même test de statut que `getTauxPromulgation` (« promulgu » ou « appliqu »),
  // fait après lecture : c'est ce qui garde les deux helpers d'accord sur ce
  // qu'est une loi.
  const lignes = await sql<LoiPromulguee[]>`
    select uid, date_depot, date_promulgation, statut_final, procedure_libelle, initiateur_groupe_uid
    from dossiers_legislatifs
    where date_promulgation >= ${LEGISLATURE_17_START}
      and procedure_libelle = any(${[...PROCEDURES_PROMULGABLES]})
      -- hors_liste : dossiers comptés dans le score mais absents des listes (migration 2026-10-29_dossiers_hors_liste.sql).
      -- Une convention déposée au Sénat en 2016, promulguée en 2025, y entrerait sinon.
      and hors_liste = false
    order by date_promulgation desc, uid`
  return lignes.filter((d) => estPromulgueeOuAppliquee(d.statut_final))
}

/**
 * Délais, en jours, entre le dépôt du texte et la promulgation de la loi. Leur
 * moyenne est la tuile de `/etat-des-lieux` et le premier chiffre de la réponse de
 * /Facts/delais : les deux lisent ici.
 */
export function delaisDepotPromulgation(lois: LoiPromulguee[]): number[] {
  const jours: number[] = []
  for (const d of lois) {
    if (!d.date_depot || !d.date_promulgation) continue
    const delai = (new Date(d.date_promulgation).getTime() - new Date(d.date_depot).getTime()) / 86400000
    if (delai > 0) jours.push(delai)
  }
  return jours
}

// ──────────────────────────────────────────────────────────────────────
// Taux d'application
// ──────────────────────────────────────────────────────────────────────

/**
 * Âge minimal, en mois, d'une loi comptée dans le taux d'application. C'est la
 * convention du baromètre de l'Assemblée nationale : une loi plus jeune n'a pas
 * encore eu le temps de recevoir ses décrets, et tirerait le taux vers le bas.
 */
const MOIS_AVANT_TAUX_APPLICATION = 6

type LoiApplication = {
  jorftext_id: string
  titre: string | null
  /** Titre Légifrance traduit par l'IA, affiché sur /en par `titreDossier` (`lib/titre-dossier.ts`). */
  titre_en: string | null
  date_publication: string | null
  nb_mesures_attendues: number | null
  nb_mesures_appliquees: number | null
  statut_application: string | null
  dossier_uid: string | null
  /** Jours entre la publication de la loi et son dernier décret d'application */
  delai_max_jours: number | null
}

export type TauxApplicationResult = {
  /** Toutes les lois suivies, récentes comprises : le donut, les trimestres et `delaisDecrets` les lisent */
  lois: LoiApplication[]
  totalLois: number
  loisApplicationDirecte: number
  loisAppliquees: number
  loisPartiellementAppliquees: number
  loisNonAppliquees: number
  totalMesuresAttendues: number
  totalMesuresAppliquees: number
  /**
   * La population du taux : lois promulguées depuis plus de 6 mois, ventilées pour
   * la réponse de la page Facts. `enAttente` compte les lois à qui il manque au
   * moins une mesure (partiellement ou pas du tout appliquées) ; `sansEcheancier`,
   * celles au statut `sans_objet`, pour lesquelles le baromètre n'a publié aucun
   * échéancier de décrets : on ne peut pas écrire qu'elles attendent des décrets.
   */
  plusDeSixMois: {
    lois: number
    applicationDirecte: number
    appliquees: number
    enAttente: number
    sansEcheancier: number
  }
  /** Lois promulguées depuis moins de 6 mois : hors du taux, mais présentes dans `lois` */
  loisRecentes: number
  /**
   * Part des lois promulguées depuis plus de 6 mois pleinement appliquées
   * (application directe ou tous décrets pris), arrondie à 1 décimale. Lue par la
   * page Facts et `/etat-des-lieux` (`decrets.tauxLois`).
   */
  tauxApplication: number
  /** Part des mesures d'application prises, toutes lois confondues, arrondie à 1 décimale. Lue par la page Facts. */
  tauxMesures: number
}

/**
 * Lois publiées depuis le début de la 17ᵉ législature, quelle que soit la date de
 * dépôt de leur texte, avec leur état d'application. Appelé par
 * /Facts/taux-application, /Facts/delais et `getEtatDesLieux` ; `delaisDecrets`
 * travaille sur les `lois` qu'il rend.
 */
export async function getTauxApplication(): Promise<TauxApplicationResult> {
  // Le `exists` ne filtre pas sur la date de dépôt (voir `getLoisPromulguees`) :
  // il écarte les lignes du baromètre sans dossier, dont une « loi du 4 juillet
  // 1837 » datée du 1er janvier 2999, constatée en base le 2026-09-15, qu'un
  // filtre de date seul laisserait passer.
  const lois = await sql<LoiApplication[]>`
    select jorftext_id, titre, titre_en, date_publication, nb_mesures_attendues, nb_mesures_appliquees,
      statut_application, dossier_uid, delai_max_jours
    from application_lois a
    where date_publication >= ${LEGISLATURE_17_START}
      and exists (select 1 from dossiers_legislatifs d where d.uid = a.dossier_uid)
    order by date_publication desc, jorftext_id`

  // `date_publication` est une date nue (`AAAA-MM-JJ`) : la comparer en texte à la
  // même forme suffit.
  const seuil = new Date()
  seuil.setMonth(seuil.getMonth() - MOIS_AVANT_TAUX_APPLICATION)
  const seuilTaux = seuil.toISOString().slice(0, 10)

  let totalLois = 0
  let loisApplicationDirecte = 0
  let loisAppliquees = 0
  let loisPartiellementAppliquees = 0
  let loisNonAppliquees = 0
  let totalMesuresAttendues = 0
  let totalMesuresAppliquees = 0
  const plusDeSixMois = { lois: 0, applicationDirecte: 0, appliquees: 0, enAttente: 0, sansEcheancier: 0 }
  let loisRecentes = 0
  for (const loi of lois) {
    totalLois++
    const statut = loi.statut_application
    if (statut === "application_directe") loisApplicationDirecte++
    else if (statut === "appliquee") loisAppliquees++
    else if (statut === "partiellement_appliquee") loisPartiellementAppliquees++
    else if (statut === "non_appliquee" || statut === "sans_objet") loisNonAppliquees++

    totalMesuresAttendues += loi.nb_mesures_attendues ?? 0
    totalMesuresAppliquees += loi.nb_mesures_appliquees ?? 0

    if (!loi.date_publication || loi.date_publication >= seuilTaux) {
      loisRecentes++
      continue
    }
    // Une loi sans échéancier compte dans le taux, comme non appliquée : c'est la
    // règle du baromètre (« les lois dont l'application est inconnue sont prises en
    // compte, à 0 % »). Un statut hors des cinq connus sort du dénominateur ;
    // `compute_statut` de l'import n'en produit aucun à ce jour.
    if (statut === "application_directe") plusDeSixMois.applicationDirecte++
    else if (statut === "appliquee") plusDeSixMois.appliquees++
    else if (statut === "partiellement_appliquee" || statut === "non_appliquee") plusDeSixMois.enAttente++
    else if (statut === "sans_objet") plusDeSixMois.sansEcheancier++
    else continue
    plusDeSixMois.lois++
  }

  const tauxApplication =
    plusDeSixMois.lois > 0
      ? Math.round(((plusDeSixMois.applicationDirecte + plusDeSixMois.appliquees) * 1000) / plusDeSixMois.lois) / 10
      : 0
  const tauxMesures =
    totalMesuresAttendues > 0
      ? Math.round((totalMesuresAppliquees * 1000) / totalMesuresAttendues) / 10
      : 0

  return {
    lois,
    totalLois,
    loisApplicationDirecte,
    loisAppliquees,
    loisPartiellementAppliquees,
    loisNonAppliquees,
    totalMesuresAttendues,
    totalMesuresAppliquees,
    plusDeSixMois,
    loisRecentes,
    tauxApplication,
    tauxMesures,
  }
}

/**
 * Délais, en jours, entre la publication d'une loi et son dernier décret, pour les
 * seules lois qui attendaient des décrets et les ont tous reçus. Leur moyenne est le
 * troisième temps de /Facts/delais et le second délai de `/etat-des-lieux`, qui
 * lisent tous deux les `lois` de `getTauxApplication`.
 */
export function delaisDecrets(lois: TauxApplicationResult["lois"]): number[] {
  return lois
    .filter((a) => a.statut_application === "appliquee" && typeof a.delai_max_jours === "number")
    .map((a) => a.delai_max_jours as number)
}

// ──────────────────────────────────────────────────────────────────────
// Amendements : totaux sur toutes les lois promulguées
// ──────────────────────────────────────────────────────────────────────

export type AmendementsDossier = {
  uid: string
  titre: string | null
  /** Titre traduit par l'IA, affiché sur /en par `titreDossier` (`lib/titre-dossier.ts`). */
  titre_en: string | null
  procedure_libelle: string | null
  nb_amendements_deposes: number | null
  nb_amendements_adoptes: number | null
  date_promulgation: string | null
}

export type AmendementsTotauxResult = {
  /** Lois promulguées ayant reçu au moins un amendement, triées par volume décroissant */
  dossiers: AmendementsDossier[]
  totalDeposes: number
  totalAdoptes: number
  /** arrondi à 1 décimale */
  tauxAdoption: number
  /**
   * Amendements déposés par loi, en médiane sur toutes les lois de `dossiers`, lois
   * financières comprises, arrondie à l'entier. La moyenne (605 hors lois
   * financières au 2026-09-15) était tirée par quelques lois hors norme, dont l'aide
   * à mourir et ses 10 708 amendements ; la médiane montre la loi typique. C'est le
   * chiffre de la réponse de /Facts/amendements.
   */
  medianeDeposes: number
  /**
   * Mêmes totaux sans les lois financières (`PROCEDURES_FINANCIERES`), qui
   * concentrent l'essentiel du volume. Lu par la réponse de /Facts/amendements.
   */
  horsFinancieres: {
    deposes: number
    adoptes: number
    /** arrondi à 1 décimale */
    tauxAdoption: number
  }
}

/**
 * Lois promulguées dont le texte a été déposé depuis le 18 juillet 2024, avec
 * leurs amendements. Appelé par /Facts/amendements et `getEtatDesLieux`.
 *
 * Seul helper des lois à garder la cohorte de dépôt, en réserve assumée : les
 * amendements déposés à l'Assemblée sous la 16ᵉ législature ne sont pas en base,
 * donc une loi dont le texte date d'avant juillet 2024 y serait sous-comptée.
 */
export async function getAmendementsTotaux(): Promise<AmendementsTotauxResult> {
  const dossiers = await sql<AmendementsDossier[]>`
    select uid, titre, titre_en, procedure_libelle, nb_amendements_deposes, nb_amendements_adoptes, date_promulgation
    from dossiers_legislatifs
    where date_depot >= ${LEGISLATURE_17_START}
      and date_promulgation is not null
      and nb_amendements_deposes > 0
      and procedure_libelle = any(${[...PROCEDURES_PROMULGABLES]})
    order by nb_amendements_deposes desc, uid`

  const totalDeposes = dossiers.reduce((s, d) => s + (d.nb_amendements_deposes ?? 0), 0)
  const totalAdoptes = dossiers.reduce((s, d) => s + (d.nb_amendements_adoptes ?? 0), 0)
  const tauxAdoption =
    dossiers.length > 0 && totalDeposes > 0
      ? Math.round((totalAdoptes / totalDeposes) * 1000) / 10
      : 0

  const dossiersHorsFin = dossiers.filter(
    (d) => !PROCEDURES_FINANCIERES.has(PROCEDURE_KEY[d.procedure_libelle ?? ""] ?? ""),
  )
  const deposesHorsFin = dossiersHorsFin.reduce((s, d) => s + (d.nb_amendements_deposes ?? 0), 0)
  const adoptesHorsFin = dossiersHorsFin.reduce((s, d) => s + (d.nb_amendements_adoptes ?? 0), 0)

  return {
    dossiers,
    totalDeposes,
    totalAdoptes,
    tauxAdoption,
    medianeDeposes: median(dossiers.map((d) => d.nb_amendements_deposes ?? 0)),
    horsFinancieres: {
      deposes: deposesHorsFin,
      adoptes: adoptesHorsFin,
      tauxAdoption:
        deposesHorsFin > 0 ? Math.round((adoptesHorsFin / deposesHorsFin) * 1000) / 10 : 0,
    },
  }
}

// ──────────────────────────────────────────────────────────────────────
// Participation aux votes
// ──────────────────────────────────────────────────────────────────────

export type ParticipationActeur = {
  uid: string | null
  prenom: string | null
  nom: string | null
  taux_participation_votes_finaux: number | null
  taux_participation_votes_solennels?: number | null
  groupe: string | null
  scrutins_finaux_pendant_mandat?: number | null
  scrutins_solennels_pendant_mandat?: number | null
  votes_actifs_importants?: number | null
}

export type ParticipationMoyennesResult = {
  deputes: ParticipationActeur[]
  senateurs: ParticipationActeur[]
  /** Taux individuels non nuls, qui servent aussi aux distributions et aux classements */
  tauxANFinal: number[]
  tauxANSolennel: number[]
  tauxSN: number[]
  /** Moyennes arrondies à l'entier : les trois grands chiffres de /Facts/participation */
  meanANFinal: number
  meanANSolennel: number
  meanSN: number
}

/**
 * Parlementaires en exercice et leurs taux de participation aux votes finaux et
 * solennels. Appelé par /Facts/participation et `getEtatDesLieux`.
 *
 * Les lignes arrivent triées par nom, prénom puis `uid`. Les classements de la page
 * trient ensuite par taux, et un tri JavaScript garde l'ordre d'arrivée des ex æquo :
 * sans ce tri en base, Postgres rendait les parlementaires dans un ordre variable, et
 * deux élus au même taux échangeaient leur rang d'un rendu à l'autre.
 */
export async function getParticipationMoyennes(): Promise<ParticipationMoyennesResult> {
  const [deputes, senateurs] = await Promise.all([
    sql<ParticipationActeur[]>`
      select uid, nom, prenom, taux_participation_votes_finaux, taux_participation_votes_solennels, groupe,
        scrutins_finaux_pendant_mandat, scrutins_solennels_pendant_mandat, votes_actifs_importants
      from acteurs
      where en_exercice = true and est_depute_actuel = true and taux_participation_votes_finaux is not null
      order by nom, prenom, uid
      limit 600`,
    sql<ParticipationActeur[]>`
      select uid, nom, prenom, taux_participation_votes_finaux, groupe, scrutins_finaux_pendant_mandat
      from acteurs
      where en_exercice = true and est_senateur_actuel = true and taux_participation_votes_finaux is not null
      order by nom, prenom, uid
      limit 400`,
  ])

  const tauxANFinal = deputes
    .map((a) => a.taux_participation_votes_finaux)
    .filter((n): n is number => typeof n === "number")
  const tauxANSolennel = deputes
    .map((a) => a.taux_participation_votes_solennels)
    .filter((n): n is number => typeof n === "number")
  const tauxSN = senateurs
    .map((a) => a.taux_participation_votes_finaux)
    .filter((n): n is number => typeof n === "number")

  return {
    deputes,
    senateurs,
    tauxANFinal,
    tauxANSolennel,
    tauxSN,
    meanANFinal: mean(tauxANFinal),
    meanANSolennel: mean(tauxANSolennel),
    meanSN: mean(tauxSN),
  }
}

export type CampContrasteSenat = {
  /** Votes sur votes possibles, en %, arrondi à l'entier. 0 si le camp est vide. */
  taux: number
  /** Sénateurs en poste distincts comptés dans ce camp. */
  senateurs: number
  /** Ceux d'entre eux qui ont au moins `minVotes` votes possibles dans ce camp. */
  senateursMesurables: number
  votesPossibles: number
}

export type ContrasteGroupesSenat = {
  avecGroupe: CampContrasteSenat
  sansGroupe: CampContrasteSenat
}

/**
 * Participation des sénateurs en poste selon qu'ils avaient un groupe le jour du
 * scrutin. Appelé par /Facts/participation, qui passe son seuil en `minVotes`.
 *
 * Seuls comptent les sénateurs en poste, comme dans le grand chiffre de la page
 * (`getParticipationMoyennes`) : avec les sénateurs partis depuis 2023, un camp
 * comptait plus de personnes que le Sénat n'a de sièges, et le graphique se lisait
 * mal. Le groupe vient de `scrutins.groupes_votants`, écrit par l'import, jamais de
 * `acteurs.groupe` (D-278) : un sénateur passé par les deux situations compte donc
 * des deux côtés. Un vote pour, contre ou abstention compte comme vote, un absent comme
 * vote possible seul ; `nonVotants` et `institutionnels` sortent du calcul (président
 * de séance, déport, Gouvernement). Un vote sans groupe connu (`null`) n'entre dans
 * aucun camp.
 *
 * Le président du Sénat sort aussi : il ne vote pas par convention, et la plupart de
 * ses scrutins sont rangés en `absents` sans statut particulier (242 pour Larcher au
 * 2026-11-07), d'où le filtre sur `periodes_president_senat`, comme dans `sync_senat.py`.
 * Mesuré sans la restriction aux sénateurs en poste, ce filtre redonne aux dix groupes
 * les valeurs de `organes.taux_participation_votes_finaux_moyen` ; sans lui, LR tombait
 * à 98,97 % au lieu de 99,66 %.
 *
 * Le tri entre les camps se fait ici et non en SQL, pour ne pas écrire une seconde
 * définition des non-inscrits. `groupes_votants` se déplie une seule fois par
 * scrutin : lu vote par vote (`->>`), le même calcul prenait 20 s contre 0,8 s
 * (mesuré le 2026-11-07).
 */
export async function getContrasteGroupesSenat(minVotes: number): Promise<ContrasteGroupesSenat> {
  type Ligne = { sigle: string | null; acteur: string; possibles: number; votes: number }
  const lignes = await sql<Ligne[]>`
    with parts as (
      select g.groupe, v.acteur, count(*)::int as possibles,
        (count(*) filter (where v.seau <> 'absents'))::int as votes
      from scrutins s
      cross join lateral jsonb_each_text(s.groupes_votants) g(acteur, groupe)
      join lateral (
        select seau, jsonb_array_elements_text(s.votes_nominatifs -> seau) as acteur
        from unnest(array['pour', 'contre', 'abstentions', 'absents']) as seau
      ) v on v.acteur = g.acteur
      where s.chambre = 'Sénat' and s.votes_nominatifs is not null
        and not exists (
          select 1
          from acteurs a
          cross join lateral jsonb_array_elements(a.periodes_president_senat) p
          where a.uid = v.acteur
            and s.date_scrutin::date >= coalesce((p ->> 'debut')::date, '-infinity')
            and s.date_scrutin::date <= coalesce((p ->> 'fin')::date, 'infinity')
        )
      group by g.groupe, v.acteur
    )
    select o.libelle_abrege as sigle, p.acteur, p.possibles, p.votes
    from parts p
    join organes o on o.uid = p.groupe
    join acteurs a on a.uid = p.acteur
      and a.en_exercice = true and a.est_senateur_actuel = true`

  const bilan = (rangs: Ligne[]): CampContrasteSenat => {
    const votes = rangs.reduce((n, l) => n + l.votes, 0)
    // Par sénateur, car un sénateur passé par deux groupes a deux lignes dans le
    // même camp.
    const possiblesParSenateur = new Map<string, number>()
    for (const l of rangs) {
      possiblesParSenateur.set(l.acteur, (possiblesParSenateur.get(l.acteur) ?? 0) + l.possibles)
    }
    const votesPossibles = rangs.reduce((n, l) => n + l.possibles, 0)
    return {
      taux: votesPossibles > 0 ? Math.round((votes / votesPossibles) * 100) : 0,
      senateurs: possiblesParSenateur.size,
      senateursMesurables: [...possiblesParSenateur.values()].filter((n) => n >= minVotes).length,
      votesPossibles,
    }
  }

  return {
    avecGroupe: bilan(lignes.filter((l) => !estNonInscrits(l.sigle))),
    sansGroupe: bilan(lignes.filter((l) => estNonInscrits(l.sigle))),
  }
}

// ──────────────────────────────────────────────────────────────────────
// Loyauté envers le groupe
// ──────────────────────────────────────────────────────────────────────

export type LoyauteActeur = {
  uid: string | null
  prenom: string | null
  nom: string | null
  taux_cohesion_groupe: number | null
  groupe: string | null
  scrutins_finaux_pendant_mandat: number | null
}

export type LoyauteMoyennesResult = {
  deputes: LoyauteActeur[]
  senateurs: LoyauteActeur[]
  /** Taux individuels, qui servent aussi aux distributions et aux classements */
  tauxAN: number[]
  tauxSN: number[]
  /** Moyennes arrondies à l'entier : les deux grands chiffres de /Facts/loyaute */
  meanAN: number
  meanSN: number
}

/**
 * Parlementaires en exercice et part de leurs votes qui suivent la position
 * majoritaire de leur groupe. Appelé par /Facts/loyaute, qui garde ses propres
 * requêtes sur les groupes, et par le serveur MCP (`src/lib/mcp/chiffres.ts`).
 *
 * Même tri en base que `getParticipationMoyennes`, pour la même raison : les
 * classements de la page tirent l'ordre des ex æquo de l'ordre d'arrivée (le
 * classement des moins loyaux le lit à l'envers, par `.reverse()`).
 */
export async function getLoyauteMoyennes(): Promise<LoyauteMoyennesResult> {
  // Les deux `limit` sont voulus : 577 sièges à l'Assemblée et 348 au Sénat.
  const [deputes, senateurs] = await Promise.all([
    sql<LoyauteActeur[]>`
      select uid, nom, prenom, groupe, taux_cohesion_groupe, scrutins_finaux_pendant_mandat
      from acteurs
      where en_exercice = true and est_depute_actuel = true and taux_cohesion_groupe is not null
      order by nom, prenom, uid
      limit 700`,
    sql<LoyauteActeur[]>`
      select uid, nom, prenom, groupe, taux_cohesion_groupe, scrutins_finaux_pendant_mandat
      from acteurs
      where en_exercice = true and est_senateur_actuel = true and taux_cohesion_groupe is not null
      order by nom, prenom, uid
      limit 500`,
  ])

  const tauxAN = deputes
    .map((a) => a.taux_cohesion_groupe)
    .filter((n): n is number => typeof n === "number")
  const tauxSN = senateurs
    .map((a) => a.taux_cohesion_groupe)
    .filter((n): n is number => typeof n === "number")

  return { deputes, senateurs, tauxAN, tauxSN, meanAN: mean(tauxAN), meanSN: mean(tauxSN) }
}

// ──────────────────────────────────────────────────────────────────────
// Cumul des mandats
// ──────────────────────────────────────────────────────────────────────

export type MandatLocalRow = {
  uid: string
  type: string
  collectivite: string
  fonction: string | null
  date_debut: string | null
  /** Prise de fonction, distincte de l'entrée au conseil : un maire est élu
   *  conseiller le dimanche et maire la semaine suivante. C'est elle qui date
   *  l'interdiction de LO 141-1. */
  date_debut_fonction: string | null
  date_donnee: string
  population: number | null
  verif_effet: EffetVerification | null
  verif_date: string | null
  verif_source_url: string | null
  verif_source_nom: string | null
}

/** Ce que LoiClair a constaté sur une ligne du registre, avec sa source. */
export type CorrectionCumul = {
  /** La ligne telle que le registre la donne : c'est elle que le lecteur
   *  retrouvera sur data.gouv.fr, et la correction n'a de sens qu'à côté. */
  type: string
  collectivite: string
  fonction: string | null
  effet: EffetVerification
  /** Nulle quand la source ne date pas le changement. */
  date: string | null
  sourceUrl: string | null
  sourceNom: string | null
}

export type CumulMandatsResult = {
  /** Millésime du Répertoire national des élus, à afficher avec les chiffres. */
  millesime: string | null
  /** Date de la dernière vérification au cas par cas (`sync_etat`). */
  verification: string | null
  effectifs: { AN: number; SN: number }
  /** Élus avec au moins un mandat local au sens de LO 141, par chambre. */
  cumulards: { AN: number; SN: number }
  /** Nombre de mandats par type, toutes chambres confondues. */
  parType: Record<string, number>
  /** Par groupe politique : effectif et nombre de cumulards. */
  parGroupe: Array<{ groupe: string; chambre: "AN" | "SN"; effectif: number; cumulards: number }>
  /**
   * Une ligne par parlementaire que le registre, après vérification, met encore
   * en situation, les deux règles confondues. Une même personne peut relever des
   * deux, et n'apparaît qu'une fois : c'est la personne qui devra choisir, pas
   * chacun de ses mandats. `groupe` dit si elle est concernée ou encore en règle ;
   * l'ordre suit ces groupes.
   */
  anomalies: Array<{
    /** Identifiant de l'acteur, pour lier le nom à sa fiche. */
    uid: string
    nom: string
    chambre: "AN" | "SN"
    /** Fonctions exécutives exercées, vides si l'anomalie est le double siège. */
    executives: string[]
    /** Conseils occupant la place unique, vides s'il n'y en a qu'un. Le type
     *  accompagne le nom : une commune et son canton portent souvent le même,
     *  et « Carpentras + Carpentras » ne dit rien au lecteur. */
    conseils: Array<{ type: string; collectivite: string }>
    /** Depuis quand la situation est ouverte. C'est le chiffre qui sépare une
     *  transition d'après-scrutin d'un cas installé, et sans lui la liste se
     *  lit comme un palmarès de fautifs. Nul si une date manque à la source. */
    depuis: string | null
    /** Date limite pour choisir, ou recours qui la suspend (`echeanceSituation`). */
    echeance: EcheanceCumul | null
    /**
     * `depasse` : délai de trente jours écoulé sans recours connu, les seuls
     * réellement concernés ; une situation qu'on ne sait pas dater y va aussi,
     * plutôt que d'être rangée en règle sans preuve. `delai` : encore dans le
     * délai pour choisir. `recours` : un recours contre l'élection le suspend.
     */
    groupe: GroupeSituation
    /** Ce qui a déjà changé sans régler toute la situation (une présidence
     *  quittée, le siège de maire gardé). */
    corrections: CorrectionCumul[]
  }>
  /** Les deux chiffres de tête : délais dépassés, et situations encore dans les
   *  temps (délai en cours ou élection contestée). Celles que la vérification a
   *  vues réglées ne comptent nulle part : elles gardent leur correction sourcée
   *  sur la fiche de l'élu, pas sur la page. */
  comptes: { depasse: number; dansLesTemps: number }
}

export type GroupeSituation = "depasse" | "delai" | "recours"

export async function getCumulMandats(): Promise<CumulMandatsResult> {
  // `mandats_locaux` n'a pas de colonne de tri naturelle : la clé primaire
  // composite fait office d'ordre stable.
  const [registre, parlementaires, etatVerification, situationsVerifiees] = await Promise.all([
    sql<MandatLocalRow[]>`
      select uid, type, collectivite, fonction, date_debut, date_debut_fonction, date_donnee, population,
        verif_effet, verif_date, verif_source_url, verif_source_nom
      from mandats_locaux
      order by uid, type, collectivite`,
    // `groupe` garde la forme que les appelants attendent : un objet, ou
    // `null` pour un élu sans groupe.
    sql<{
      uid: string
      nom: string | null
      prenom: string | null
      est_depute_actuel: boolean | null
      date_debut_mandat: string | null
      groupe: { libelle: string | null } | null
    }[]>`
      select a.uid, a.nom, a.prenom, a.est_depute_actuel, a.date_debut_mandat,
        case when o.uid is null then null else json_build_object('libelle', o.libelle) end as groupe
      from acteurs a
      left join organes o on o.uid = a.groupe
      where a.en_exercice = true and (a.est_depute_actuel = true or a.est_senateur_actuel = true)
      order by a.uid`,
    auPlusUneLigne(
      sql<{ derniere_reussite: string | null }[]>`
        select derniere_reussite from sync_etat where cle = 'verification_cumul'`,
      "sync_etat",
    ),
    // Quelques dizaines de lignes au plus : une par situation vérifiée.
    sql<(SituationCumul & { uid: string })[]>`
      select uid, recours, date_limite, source_url, source_nom from situations_cumul order by uid`,
  ])
  const verification = etatVerification?.derniere_reussite ?? null
  // Le jour du rendu : la page est régénérée chaque nuit, un délai qui expire
  // passe donc dans le tableau le lendemain.
  const aujourdhui = aujourdhuiAParisIso()
  const situationDe = new Map<string, SituationCumul>(situationsVerifiees.map((s) => [s.uid, s]))

  // Tous les chiffres et la liste des situations ouvertes se calculent sur ce qui
  // vaut aujourd'hui, après la vérification au cas par cas. Le registre brut ne
  // sert plus qu'à afficher, sous une situation encore ouverte, ce qui y a déjà
  // été corrigé. Une situation entièrement réglée disparaît de la page.
  const mandats = registre.map(enVigueur).filter((m): m is MandatLocalRow => m !== null)

  const chambreDe = new Map<string, "AN" | "SN">()
  const nomDe = new Map<string, string>()
  const groupeDe = new Map<string, string>()
  const entreeAuParlementDe = new Map<string, string | null>()
  const effectifs = { AN: 0, SN: 0 }

  for (const a of parlementaires) {
    const chambre = a.est_depute_actuel ? "AN" : "SN"
    chambreDe.set(a.uid, chambre)
    nomDe.set(a.uid, [a.prenom, a.nom].filter(Boolean).join(" "))
    groupeDe.set(a.uid, a.groupe?.libelle ?? "Non inscrit")
    entreeAuParlementDe.set(a.uid, a.date_debut_mandat)
    effectifs[chambre] += 1
  }

  const cumulardsParUid = new Set<string>()
  // Les mandats de chaque élu, pour confier le décompte du quota au module
  // partagé : lui seul sait écarter le doublon d'arrondissement de Paris, Lyon
  // et Marseille, et le refaire ici le ferait diverger de la fiche élu.
  const mandatsParUid = new Map<string, MandatLocalRow[]>()
  const parType: Record<string, number> = {}
  const executifsParUid = new Map<string, string[]>()

  for (const m of mandats) {
    const chambre = chambreDe.get(m.uid)
    if (!chambre) continue
    parType[m.type] = (parType[m.type] ?? 0) + 1
    // Détenir un mandat local est un fait, indépendant de sa légalité : le
    // conseiller municipal d'un village de 200 habitants cumule bel et bien.
    // Le seuil de LO 141 ne dit pas s'il y a cumul, il dit si ce cumul occupe
    // l'unique place autorisée — c'est `compteDansQuota` qui en juge, plus bas.
    if (TYPES_LOCAUX_LO141.has(m.type)) cumulardsParUid.add(m.uid)
    mandatsParUid.set(m.uid, [...(mandatsParUid.get(m.uid) ?? []), m])
    if (m.fonction && estFonctionExecutive(m.fonction)) {
      executifsParUid.set(m.uid, [
        ...(executifsParUid.get(m.uid) ?? []),
        `${m.fonction} · ${m.collectivite}`,
      ])
    }
  }

  const cumulards = { AN: 0, SN: 0 }
  for (const uid of cumulardsParUid) {
    const chambre = chambreDe.get(uid)
    if (chambre) cumulards[chambre] += 1
  }

  const parGroupeMap = new Map<string, { groupe: string; chambre: "AN" | "SN"; effectif: number; cumulards: number }>()
  for (const [uid, chambre] of chambreDe) {
    const groupe = groupeDe.get(uid) ?? "Non inscrit"
    const cle = `${chambre}|${groupe}`
    const entree = parGroupeMap.get(cle) ?? { groupe, chambre, effectif: 0, cumulards: 0 }
    entree.effectif += 1
    if (cumulardsParUid.has(uid)) entree.cumulards += 1
    parGroupeMap.set(cle, entree)
  }

  // Les lignes du registre brut de chaque parlementaire, avec ce que LoiClair y
  // a constaté.
  const registreParUid = new Map<string, MandatLocalRow[]>()
  for (const m of registre) {
    if (!chambreDe.has(m.uid)) continue
    registreParUid.set(m.uid, [...(registreParUid.get(m.uid) ?? []), m])
  }
  const correctionsDe = (uid: string): CorrectionCumul[] =>
    (registreParUid.get(uid) ?? []).flatMap((m) =>
      m.verif_effet
        ? [{
            type: m.type,
            collectivite: m.collectivite,
            fonction: m.fonction,
            effet: m.verif_effet,
            date: m.verif_date,
            sourceUrl: m.verif_source_url,
            sourceNom: m.verif_source_nom,
          }]
        : [],
    )

  // Une ligne par personne, les deux règles réunies : qui relève des deux n'y
  // figure qu'une fois, avec ses deux motifs. C'est la personne qui devra
  // trancher, et une table par règle aurait fait lire deux fois les mêmes noms.
  const anomalies: CumulMandatsResult["anomalies"] = []
  const uidsAnomalie = new Set([
    ...executifsParUid.keys(),
    ...Array.from(mandatsParUid.entries())
      .filter(([, liste]) => compterQuota(liste) > 1)
      .map(([uid]) => uid),
  ])
  for (const uid of uidsAnomalie) {
    const chambre = chambreDe.get(uid)
    if (!chambre) continue
    const liste = mandatsParUid.get(uid) ?? []
    const conseils = compterQuota(liste) > 1 ? liste.filter((m) => compteDansQuota(m)) : []

    // Dates et délai viennent du module partagé : la fiche élu et le serveur
    // MCP datent la même situation de la même façon.
    const entree = entreeAuParlementDe.get(uid) ?? null
    const motif = motifSituation(liste)

    const echeance = echeanceSituation({
      motif,
      chambre,
      entree,
      situation: situationDe.get(uid) ?? null,
      aujourdhui,
    })

    anomalies.push({
      uid,
      nom: nomDe.get(uid) ?? uid,
      chambre,
      executives: executifsParUid.get(uid) ?? [],
      conseils: conseils.map((m) => ({ type: m.type, collectivite: m.collectivite })),
      depuis: depuisSituation(motif, entree),
      echeance,
      groupe:
        echeance?.etat === "recours" ? "recours" : echeance && echeance.date >= aujourdhui ? "delai" : "depasse",
      corrections: correctionsDe(uid),
    })
  }

  // Dans chaque groupe, ce qui presse d'abord : le délai expiré depuis le plus
  // longtemps, puis la date limite la plus proche ; les recours, qui n'ont pas de
  // date, par nom. Sans date, en fin de groupe. L'uid départage les homonymes.
  const ORDRE_GROUPES: GroupeSituation[] = ["depasse", "delai", "recours"]
  const dateDe = (a: CumulMandatsResult["anomalies"][number]) =>
    a.echeance?.etat === "date" ? a.echeance.date : "9999"

  return {
    comptes: {
      depasse: anomalies.filter((a) => a.groupe === "depasse").length,
      dansLesTemps: anomalies.filter((a) => a.groupe !== "depasse").length,
    },
    millesime: registre[0]?.date_donnee ?? null,
    verification,
    effectifs,
    cumulards,
    parType,
    parGroupe: Array.from(parGroupeMap.values()).sort(
      (a, b) => b.cumulards / b.effectif - a.cumulards / a.effectif,
    ),
    anomalies: anomalies.sort(
      (a, b) =>
        ORDRE_GROUPES.indexOf(a.groupe) - ORDRE_GROUPES.indexOf(b.groupe) ||
        dateDe(a).localeCompare(dateDe(b)) ||
        a.nom.localeCompare(b.nom) ||
        a.uid.localeCompare(b.uid),
    ),
  }
}
