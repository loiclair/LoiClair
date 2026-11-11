// Lecture serveur des données du quiz d'affinité politique : les 20 scrutins
// sélectionnés par pipeline/select_quiz_scrutins.py (table
// `quiz_affinite_scrutins`), enrichis avec le titre et la date du scrutin, les
// thèmes du dossier associé, et la position majoritaire de chaque groupe. Aucun
// texte généré par IA (voir QuizQuestionCard), hormis le titre du scrutin sur /en,
// traduit par l'IA quand la traduction existe (`lib/titre-dossier.ts`).
//
// Chaque lecture lève sur une panne (D-136) : une page figée garde alors sa
// version précédente au lieu d'un quiz sans question ni groupe.

import { sql } from "@/lib/db"
import { resolveGroupeColor } from "@/lib/groupe-colors"
import { titreDossier, titreTraduit } from "@/lib/titre-dossier"
import { estNonInscrits } from "@/lib/non-inscrits"

export type QuizAffinitePosition = "pour" | "contre" | "abstention"

export type QuizAffiniteGroupe = {
  uid: string
  libelle: string
  libelleAbrege: string
  couleur: string
}

export type QuizAffiniteQuestion = {
  scrutinUid: string
  rang: number
  titre: string
  /** Vrai quand `titre` est la traduction de l'IA (sur /en) : le badge IA le suit. */
  titreTraduit: boolean
  dateScrutin: string | null
  themes: string[]
  /** groupe_uid → position majoritaire du groupe sur ce scrutin */
  positions: Record<string, QuizAffinitePosition>
}

export type QuizAffiniteData = {
  questions: QuizAffiniteQuestion[]
  groupes: QuizAffiniteGroupe[]
}

/** Les 11 groupes politiques actifs de l'AN (Non inscrit exclu) — cf. select_quiz_scrutins.py */
export async function getQuizAffiniteGroupesActifs(): Promise<QuizAffiniteGroupe[]> {
  const data = await sql<{ uid: string; libelle: string | null; libelle_abrege: string | null; couleur_associee: string | null }[]>`
    select uid, libelle, libelle_abrege, couleur_associee
    from organes
    where code_type = 'GP' and date_fin is null
    order by uid`

  // Par le sigle et non par l'uid du groupe NI de la 17ᵉ (PO840056) : la législature
  // suivante en ouvrira un autre, que l'uid laisserait passer comme douzième groupe.
  return data.filter((o) => !estNonInscrits(o.libelle_abrege as string | null)).map((o) => ({
    uid: o.uid as string,
    libelle: (o.libelle as string) ?? (o.libelle_abrege as string) ?? (o.uid as string),
    libelleAbrege: (o.libelle_abrege as string) ?? (o.libelle as string) ?? (o.uid as string),
    couleur: resolveGroupeColor(o.couleur_associee as string | null),
  }))
}

/** Liste légère des scrutin_uid actuellement sélectionnés — sert à détecter
 * côté hub, sans charger toutes les données du quiz, qu'un résultat sauvegardé
 * correspond à une ancienne sélection (cf. computeQuestionSetFingerprint). */
export async function getQuizAffiniteScrutinUids(): Promise<string[]> {
  // Sans tri : l'appelant ne s'en sert qu'à travers `computeQuestionSetFingerprint`,
  // qui trie lui-même.
  const data = await sql<{ scrutin_uid: string }[]>`select scrutin_uid from quiz_affinite_scrutins`
  return data.map((r) => r.scrutin_uid)
}

export async function getQuizAffiniteData(locale: string): Promise<QuizAffiniteData> {
  const rows = await sql<{ scrutin_uid: string; dossier_uid: string; rang: number }[]>`
    select scrutin_uid, dossier_uid, rang from quiz_affinite_scrutins order by rang`
  const scrutinUids = rows.map((r) => r.scrutin_uid as string)
  const dossierUids = Array.from(new Set(rows.map((r) => r.dossier_uid as string)))

  // Les positions sont triées : leur ordre fixe celui des clés de `positions`,
  // sérialisé dans la page, qui sinon suivrait le plan d'exécution (D-329). Les
  // scrutins et les dossiers ne servent qu'à remplir des `Map`.
  const [scrutins, positionsLues, dossiers, groupes] = await Promise.all([
    sql<{ uid: string; titre: string | null; titre_en: string | null; date_scrutin: string | null }[]>`
      select uid, titre, titre_en, date_scrutin from scrutins where uid = any(${scrutinUids})`,
    sql<{ scrutin_uid: string; groupe_uid: string; position_majoritaire: QuizAffinitePosition }[]>`
      select scrutin_uid, groupe_uid, position_majoritaire
      from scrutins_groupes_positions
      where chambre = 'AN' and scrutin_uid = any(${scrutinUids})
      order by scrutin_uid, groupe_uid`,
    sql<{ uid: string; themes: string[] | null }[]>`
      select uid, themes from dossiers_legislatifs where uid = any(${dossierUids})`,
    getQuizAffiniteGroupesActifs(),
  ])

  const titreByUid = new Map<string, string>(
    scrutins.map((s) => [s.uid as string, titreDossier(s, locale)]),
  )
  const traduitByUid = new Map<string, boolean>(
    scrutins.map((s) => [s.uid as string, titreTraduit(s, locale)]),
  )
  const dateByUid = new Map<string, string | null>(
    scrutins.map((s) => [s.uid as string, s.date_scrutin as string | null]),
  )
  const themesByDossier = new Map<string, string[]>(
    dossiers.map((d) => [d.uid as string, (d.themes as string[]) ?? []]),
  )
  const positionsByScrutin = new Map<string, Record<string, QuizAffinitePosition>>()
  for (const p of positionsLues) {
    const scrutinUid = p.scrutin_uid as string
    const positions = positionsByScrutin.get(scrutinUid) ?? {}
    positions[p.groupe_uid as string] = p.position_majoritaire as QuizAffinitePosition
    positionsByScrutin.set(scrutinUid, positions)
  }

  const questions: QuizAffiniteQuestion[] = rows.map((r) => ({
    scrutinUid: r.scrutin_uid as string,
    rang: r.rang as number,
    titre: titreByUid.get(r.scrutin_uid as string) ?? "",
    titreTraduit: traduitByUid.get(r.scrutin_uid as string) ?? false,
    dateScrutin: dateByUid.get(r.scrutin_uid as string) ?? null,
    themes: themesByDossier.get(r.dossier_uid as string) ?? [],
    positions: positionsByScrutin.get(r.scrutin_uid as string) ?? {},
  }))

  return { questions, groupes }
}

export type QuizSharedResult = {
  /** Un groupe, ou plusieurs quand ils étaient à égalité en tête. */
  groupes: QuizAffiniteGroupe[]
  percent: number
}

/**
 * Valide un résultat partagé via URL (`?g=...&pct=...`) : `g` porte un ou
 * plusieurs uid séparés par des virgules (groupes ex æquo), chacun devant être
 * un groupe actif réel, `pct` un entier 0–100. Un seul uid invalide invalide
 * tout le lien. Utilisé par la page résultat
 * partagée et l'image OG dynamique — ces paramètres viennent d'une URL
 * publique modifiable, jamais de texte libre ne doit en sortir non validé.
 * Une panne de lecture lève au lieu de rendre `null` : un aperçu générique serait
 * mis en cache par les réseaux sociaux.
 */
export async function resolveQuizAffiniteShareParams(
  groupeUidParam: string | null | undefined,
  percentParam: string | null | undefined,
): Promise<QuizSharedResult | null> {
  const percent = percentParam != null ? Number.parseInt(percentParam, 10) : NaN
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) return null
  if (!groupeUidParam) return null

  const uids = Array.from(new Set(groupeUidParam.split(",")))
  const actifs = await getQuizAffiniteGroupesActifs()
  const groupes = uids.map((uid) => actifs.find((g) => g.uid === uid))
  if (groupes.length === 0 || groupes.some((g) => g === undefined)) return null

  return { groupes: groupes as QuizAffiniteGroupe[], percent }
}
