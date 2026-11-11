// Agrégat unique du tableau de bord /etat-des-lieux.
//
// Règle qui gouverne ce fichier : une tuile ne doit jamais afficher un chiffre
// différent de l'article qu'elle ouvre. Toute valeur vient donc d'un helper
// partagé de `facts-queries.ts`, jamais d'un recalcul local. Les trois
// mesures propres au tableau de bord (origine des lois, procédure accélérée,
// réponse aux questions écrites) sont calculées ici, une seule fois.
//
// Une exception assumée : l'origine des lois compte toutes les lois promulguées
// depuis le 18 juillet 2024, alors que l'article qu'elle ouvre
// (/Facts/succes-legislatif/volume) suit les textes déposés depuis cette date
// jusqu'à leur promulgation, seule base où déposés, adoptés et promulgués se
// suivent. La tuile et l'article disent chacun leur périmètre.
//
// `getEtatDesLieux` est appelé par `src/app/[locale]/(app)/etat-des-lieux/page.tsx`,
// page statique rafraîchie à la fin du run de nuit (`/api/revalidate`).

import { sql } from "@/lib/db"
import { LEGISLATURE_17_START } from "@/lib/facts-shared"
import { LIBELLE_PROCEDURE_ACCELEREE } from "@/lib/definitions"
import { mean } from "@/lib/stats"
import {
  delaisDecrets,
  delaisDepotPromulgation,
  getLoisPromulguees,
  getTauxPromulgation,
  getTauxApplication,
  getAmendementsTotaux,
  getParticipationMoyennes,
} from "@/lib/facts-queries"

/** Un parlementaire en fonction, pour les deux repères de représentativité */
type RepresentativiteActeur = {
  civ: string | null
  age: number | null
  est_depute_actuel: boolean | null
  est_senateur_actuel: boolean | null
}

export type EtatDesLieux = {
  /** L'entonnoir : 5 marches, du dépôt à l'application complète */
  funnel: {
    deposes: number
    promulgables: number
    adoptes: number
    promulgues: number
    appliquees: number
  }
  /**
   * L'application des lois, sur deux plans qu'il ne faut pas confondre :
   * `tauxLois` compte des lois pleinement appliquées, `prises` et `attendues`
   * comptent les mesures que ces lois prévoient. Un pourcentage de mesures
   * affiché sous une question qui porte sur les lois se lit comme une part de
   * lois, et il vaut le double.
   */
  decrets: {
    tauxLois: number
    loisAppliquees: number
    loisSuivies: number
    prises: number
    attendues: number
  }
  /** Qui écrit les lois qui passent */
  origine: { parlementaires: number; gouvernement: number; total: number; pctParlementaires: number }
  /** Amendements adoptés */
  amendements: { deposes: number; tauxAdoption: number }
  /**
   * Du dépôt à la promulgation, puis de la promulgation aux décrets : deux moyennes
   * sur deux populations différentes, chacune avec son nombre de lois. Jamais
   * additionnées : leur somme ne serait le parcours d'aucune loi.
   */
  delais: {
    depotPromulgation: number
    nbDepotPromulgation: number
    promulgationDecrets: number
    nbDecrets: number
  }
  /** Ce mois-ci, et les 23 mois qui précèdent pour la courbe */
  ceMoisCi: {
    depots: number
    promulgations: number
    /**
     * Date (`AAAA-MM-JJ`) de la dernière promulgation, renseignée seulement quand
     * aucune loi n'a été promulguée ce mois-ci : le « 0 » affiché mi-septembre 2026,
     * en pleine intersession, ne disait pas depuis quand aucune loi n'était sortie.
     */
    dernierePromulgation: string | null
    /** Du plus ancien au plus récent, mois courant inclus. `mois` en `YYYY-MM`. */
    serie: Array<{ mois: string; depots: number; promulgations: number }>
  }
  /** Présence aux votes */
  participation: { an: number; senat: number }
  /** Procédure accélérée */
  procedureAcceleree: { lois: number; total: number; pct: number }
  /** Le gouvernement répond-il ? */
  questionsEcrites: { pct: number; pctAN: number; pctSenat: number; total: number }
  /** Ressemblent-ils à la France ? */
  representativite: { ageMoyenAN: number; ageMoyenSN: number; pctFemmes: number }
}

/**
 * Arrondi à 1 décimale, réservé aux mesures qu'un article affiche déjà ainsi
 * (taux d'adoption des amendements, part de femmes), pour que les deux pages
 * portent le même chiffre au dixième près.
 */
const pct1 = (n: number, base: number) => (base > 0 ? Math.round((n * 1000) / base) / 10 : 0)

/** Arrondi à l'entier, pour les mesures propres au tableau de bord */
const pct = (n: number, base: number) => (base > 0 ? Math.round((n * 100) / base) : 0)

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`

/** Longueur de la courbe des dépôts et promulgations, en mois glissants */
const SERIE_MOIS = 24

/**
 * Nombre de questions écrites de la 17ᵉ législature, compté par Postgres : il y en
 * a plus de 27 000, aucune ligne ne remonte. `chambre` restreint à l'AN ou au
 * Sénat ; omis, le compte porte sur les deux.
 */
const countQuestionsEcrites = async (opts: { chambre?: "AN" | "SENAT"; repondues?: boolean } = {}) => {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*) as n
    from questions
    where type = 'QE'
      and date_jo >= ${LEGISLATURE_17_START}
      ${opts.chambre ? sql`and chambre = ${opts.chambre}` : sql``}
      ${opts.repondues ? sql`and a_reponse = true` : sql``}`
  return n
}

export async function getEtatDesLieux(): Promise<EtatDesLieux> {
  const [
    promulgation,
    loisPromulguees,
    application,
    amendements,
    participation,
    organesGouvernement,
    parlementaires,
    qeTotal,
    qeRepondues,
    qeAN,
    qeANRepondues,
    qeSN,
    qeSNRepondues,
  ] = await Promise.all([
    getTauxPromulgation(),
    getLoisPromulguees(),
    getTauxApplication(),
    getAmendementsTotaux(),
    getParticipationMoyennes(),
    // Les organes GOUVERNEMENT, pour l'origine des lois : voir plus bas.
    sql<{ uid: string; code_type: string | null }[]>`
      select uid, code_type from organes where code_type = 'GOUVERNEMENT'`,
    sql<RepresentativiteActeur[]>`
      select civ, age, est_depute_actuel, est_senateur_actuel
      from acteurs
      where en_exercice = true and (est_depute_actuel = true or est_senateur_actuel = true)
      limit 2000`,
    countQuestionsEcrites(),
    countQuestionsEcrites({ repondues: true }),
    countQuestionsEcrites({ chambre: "AN" }),
    countQuestionsEcrites({ chambre: "AN", repondues: true }),
    countQuestionsEcrites({ chambre: "SENAT" }),
    countQuestionsEcrites({ chambre: "SENAT", repondues: true }),
  ])

  // ── Lois promulguées depuis le 18 juillet 2024 ───────────────────────
  // `getLoisPromulguees`, quelle que soit la date de dépôt du texte : c'est la
  // population commune à l'origine des lois, au délai de promulgation, à la
  // courbe des promulgations et à la procédure accélérée. Seuls l'entonnoir et
  // les dépôts gardent la cohorte de dépôt de `getTauxPromulgation`.

  // ── Origine des lois qui passent ────────────────────────────────────
  // On repère le Gouvernement, et tout le reste est parlementaire : une loi
  // vient du Gouvernement si son auteur est l'organe GOUVERNEMENT, ou si sa
  // procédure est un « Projet de … ». Le second test suffit pour toutes les
  // procédures sauf les deux mixtes (« Projet ou proposition de loi
  // constitutionnelle / organique »), que seul l'auteur départage.
  //
  // L'inverse (compter les parlementaires par leur groupe, et le Gouvernement
  // comme le reste) rangeait au Gouvernement toute proposition de loi dont le
  // groupe d'auteur manque en base : 31 lois sur 144 le 2026-10-07 (sénateurs
  // sans groupe après le renouvellement, auteurs partis ou devenus ministres),
  // soit 54 / 90 affiché au lieu de 85 / 59. C'est le repli « sans groupe =
  // Gouvernement » que D-152 écarte du pipeline.
  const estGouvernement = new Set<string>(
    organesGouvernement
      .filter((o) => o.code_type === "GOUVERNEMENT")
      .map((o) => o.uid),
  )
  let origineGouv = 0
  for (const d of loisPromulguees) {
    const parAuteur = d.initiateur_groupe_uid !== null && estGouvernement.has(d.initiateur_groupe_uid)
    if (parAuteur || (d.procedure_libelle ?? "").startsWith("Projet de ")) origineGouv++
  }
  const originePar = loisPromulguees.length - origineGouv

  // ── Dépôt → promulgation, puis promulgation → décrets ──────────────
  // Les deux helpers que lit /Facts/delais, pour le même chiffre sur les deux pages.
  const delaisPromulgation = delaisDepotPromulgation(loisPromulguees)
  const delaisPromulgationDecrets = delaisDecrets(application.lois)

  // ── Ce mois-ci, et la courbe des 24 derniers mois ───────────────────
  // Fenêtre glissante initialisée à zéro : un mois sans dépôt doit apparaître
  // comme un creux dans la courbe, pas comme un trou dans la série.
  const now = new Date()
  const currentMonth = monthKey(now)
  const serieMap = new Map<string, { mois: string; depots: number; promulgations: number }>()
  for (let i = SERIE_MOIS - 1; i >= 0; i--) {
    const m = monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1))
    serieMap.set(m, { mois: m, depots: 0, promulgations: 0 })
  }

  /** Ajoute `nb` au mois déjà découpé `AAAA-MM`, et dit si c'est le mois courant. */
  const compteMois = (
    mois: string | null,
    champ: 'depots' | 'promulgations',
    nb: number,
  ): boolean => {
    if (!mois) return false
    const bucket = serieMap.get(mois)
    if (bucket) bucket[champ] += nb
    return mois === currentMonth
  }

  const compte = (
    dateStr: string | null,
    champ: 'depots' | 'promulgations',
  ): boolean => {
    if (!dateStr) return false
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return false
    return compteMois(monthKey(d), champ, 1)
  }

  // Les dépôts arrivent de la vue déjà groupés par mois : rien à redécouper ici.
  let depotsCeMois = 0
  for (const s of promulgation.parMois) {
    if (compteMois(s.mois_depot, 'depots', s.nb)) depotsCeMois += s.nb
  }
  let promulgationsCeMois = 0
  let dernierePromulgation: string | null = null
  for (const d of loisPromulguees) {
    if (compte(d.date_promulgation, 'promulgations')) promulgationsCeMois++
    // `date_promulgation` est un horodatage sans fuseau à minuit : ses dix premiers
    // caractères sont la date, qui se compare en texte.
    const jour = d.date_promulgation?.slice(0, 10) ?? null
    if (jour && (!dernierePromulgation || jour > dernierePromulgation)) dernierePromulgation = jour
  }

  // ── Procédure accélérée ─────────────────────────────────────────────
  // Le libellé d'acte est unique en base ; on compte les dossiers distincts
  // qui le portent parmi les lois déjà promulguées.
  const uidsPromulgues = loisPromulguees.map((d) => d.uid).filter((u): u is string => u !== null)
  const actesAcceleres = await sql<{ dossier_uid: string | null }[]>`
    select dossier_uid
    from actes_legislatifs
    where libelle_acte = ${LIBELLE_PROCEDURE_ACCELEREE}
      and dossier_uid = any(${uidsPromulgues})`
  const loisAccelerees = new Set(
    actesAcceleres
      .map((a) => a.dossier_uid)
      .filter((u): u is string => u !== null),
  ).size

  // ── Représentativité ────────────────────────────────────────────────
  const agesDe = (rows: RepresentativiteActeur[]) =>
    rows.map((a) => a.age).filter((n): n is number => typeof n === "number" && !isNaN(n))
  const femmes = parlementaires.filter((a) => a.civ?.trim() === "Mme").length

  // Une loi d'application directe n'attend aucune mesure : elle est appliquée
  // dès sa publication, et compte donc avec les lois dont toutes les mesures
  // sont prises.
  const estPleinementAppliquee = (statut: string | null) =>
    statut === "application_directe" || statut === "appliquee"

  // Dernière marche de l'entonnoir : les lois pleinement appliquées parmi les
  // textes de la cohorte de dépôt, et non parmi toutes les lois promulguées
  // depuis juillet 2024. Sinon la marche compterait des lois dont le texte
  // n'est dans aucune des marches du dessus.
  //
  // La cohorte n'arrive plus en liste d'uid (`getTauxPromulgation` rend des seaux
  // agrégés) : on part des lois pleinement appliquées, une centaine, et on demande
  // lesquelles ont été déposées dans la fenêtre. Environ 1 Ko d'uid au lieu de la
  // cohorte entière, qui en compte plus de trois mille. Le filtre final reste le
  // même, donc deux lois qui partageraient un dossier compteraient toujours pour
  // deux, comme avant.
  const uidsCandidats = [
    ...new Set(
      application.lois
        .filter((l) => estPleinementAppliquee(l.statut_application))
        .map((l) => l.dossier_uid)
        .filter((u): u is string => u !== null),
    ),
  ]
  const uidsCohorte = new Set(
    uidsCandidats.length === 0
      ? []
      : (await sql<{ uid: string }[]>`
          select uid from dossiers_legislatifs
          where date_depot >= ${LEGISLATURE_17_START} and uid = any(${uidsCandidats})`).map((d) => d.uid),
  )
  const appliqueesCohorte = application.lois.filter(
    (l) => l.dossier_uid && uidsCohorte.has(l.dossier_uid) && estPleinementAppliquee(l.statut_application),
  ).length

  // Le taux porte sur les lois de plus de 6 mois (`getTauxApplication`) : la
  // phrase de l'anneau cite la même population que lui.
  const sixMois = application.plusDeSixMois

  return {
    funnel: {
      deposes: promulgation.totalDeposited,
      promulgables: promulgation.totalPromulgables,
      adoptes: promulgation.adoptes,
      promulgues: promulgation.promulgues,
      appliquees: appliqueesCohorte,
    },
    decrets: {
      tauxLois: application.tauxApplication,
      loisAppliquees: sixMois.applicationDirecte + sixMois.appliquees,
      loisSuivies: sixMois.lois,
      prises: application.totalMesuresAppliquees,
      attendues: application.totalMesuresAttendues,
    },
    origine: {
      parlementaires: originePar,
      gouvernement: origineGouv,
      total: loisPromulguees.length,
      pctParlementaires: pct(originePar, loisPromulguees.length),
    },
    amendements: {
      deposes: amendements.totalDeposes,
      tauxAdoption: amendements.tauxAdoption,
    },
    delais: {
      depotPromulgation: mean(delaisPromulgation),
      nbDepotPromulgation: delaisPromulgation.length,
      promulgationDecrets: mean(delaisPromulgationDecrets),
      nbDecrets: delaisPromulgationDecrets.length,
    },
    ceMoisCi: {
      depots: depotsCeMois,
      promulgations: promulgationsCeMois,
      dernierePromulgation: promulgationsCeMois === 0 ? dernierePromulgation : null,
      serie: [...serieMap.values()],
    },
    participation: { an: participation.meanANFinal, senat: participation.meanSN },
    procedureAcceleree: {
      lois: loisAccelerees,
      total: loisPromulguees.length,
      pct: pct(loisAccelerees, loisPromulguees.length),
    },
    questionsEcrites: {
      pct: pct(qeRepondues, qeTotal),
      pctAN: pct(qeANRepondues, qeAN),
      pctSenat: pct(qeSNRepondues, qeSN),
      total: qeTotal,
    },
    representativite: {
      ageMoyenAN: mean(agesDe(parlementaires.filter((a) => a.est_depute_actuel))),
      ageMoyenSN: mean(agesDe(parlementaires.filter((a) => a.est_senateur_actuel))),
      pctFemmes: pct1(femmes, parlementaires.length),
    },
  }
}
