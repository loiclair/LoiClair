// Données d'une semaine parlementaire pour la lettre du lundi : actes classés par
// rubrique, texte d'entrée du prompt (`eventsSummary`) et blocs fixes du gabarit
// (votes, dossier en lumière, profils touchés, tendances). Seul appelant :
// `newsletter/send/route.ts`.
import { sql } from '@/lib/db'
import { ORDRE_PROFILS } from '@/lib/profils'
import { profilsParDossier } from '@/lib/ce-qui-me-concerne'
import { LEGAL_AN } from '@/lib/parliament-counts'
import { voteLePlusRecent, type ChiffresScrutin } from '@/lib/scrutin-affichage'
import { getTopActiviteParChambre, type TopActiviteElu } from '@/lib/activite-queries'

// ── Libellés retenus ──────────────────────────────────────────────────────────

const NIVEAU1_PROMULGATION = "Promulgation d'une loi"
const NIVEAU1_DECRET = "Publication d'un décret d'application"
const NIVEAU1_APP_COMPLETE = 'Application complète de la loi'

// `Motion de censure` (le dépôt, quelques jours avant le vote) n'y est pas : la
// même motion serait racontée deux fois, et c'est `Décision sur une motion de
// censure` qui porte le scrutin et son résultat.
const NIVEAU2_DECISIONS = [
  'Décision',
  'Décision de la CMP',
  'Conclusion du conseil constitutionnel',
  'Décision sur une motion de censure',
]

const NIVEAU3_DEPOTS = [
  "1er dépôt d'une initiative.",
  "1er depot d'une initiative.",
]

const ALL_LIBELLES = [
  NIVEAU1_PROMULGATION,
  NIVEAU1_DECRET,
  NIVEAU1_APP_COMPLETE,
  ...NIVEAU2_DECISIONS,
  ...NIVEAU3_DEPOTS,
]

// ── Types exportés ────────────────────────────────────────────────────────────

export type ActePromulgation = {
  uid: string
  date_acte: string
  code_loi: string | null
  titre_loi: string | null
  dossier_uid: string
  dossier_titre: string
  dossier_search_summary: string | null
  initiateur: string | null
  application_directe: boolean | null
  lignesIA: string[]
}

export type ActeDecret = {
  uid: string
  date_acte: string
  titre_decret: string | null
  dossier_uid: string
  dossier_titre: string
  dossier_search_summary: string | null
  lignesIA: string[]
}

export type ActeApplicationComplete = {
  uid: string
  date_acte: string
  dossier_uid: string
  dossier_titre: string
  dossier_search_summary: string | null
  lignesIA: string[]
}

export type ActeDecision = {
  uid: string
  date_acte: string
  libelle_acte: string
  statut_conclusion: string | null
  dossier_uid: string
  dossier_titre: string
  dossier_procedure: string | null
  dossier_search_summary: string | null
  initiateur: string | null
  scrutin: {
    /** Le vote retenu (`voteLePlusRecent`) : son adresse, `/Scrutins/<uid>`, est celle du bouton du courriel. */
    uid: string
    titre: string | null
    sort_libelle: string | null
    type_vote_libelle: string | null
    /** `MOC`, `SPS`, `SPO` côté AN ; null côté Sénat, qui ne publie pas de type. */
    type_vote_code: string | null
    chambre: string | null
    pour: number | null
    contre: number | null
    abstentions: number | null
    non_votants: number | null
    nombre_votants: number | null
    suffrages_requis: number | null
  } | null
  lignesIA: string[]
}

export type ActeDepot = {
  uid: string
  date_acte: string
  dossier_uid: string
  dossier_titre: string
  dossier_procedure: string | null
  dossier_search_summary: string | null
  initiateur: string | null
  lignesIA: string[]
}

// Types utilisés par send/route.ts pour le template email
export type VoteHebdo = {
  titre: string
  /**
   * Chiffres bruts du scrutin. Les segments de la barre, le repère de majorité et le
   * taux de participation se déduisent par `affichageScrutin()` au moment du rendu :
   * c'est la même règle que les barres du site, motions de censure comprises.
   */
  chiffres: ChiffresScrutin
  sort: string
  type_vote_libelle: string | null
  type_majorite_label: string
  /** Le scrutin montré : le bouton « Je consulte le vote » mène à sa page. */
  scrutinUid: string
}

export type DossierLumiere = {
  uid: string
  titre: string
  procedure: string | null
  search_summary: string | null
  date_depot: string | null
}

export type WeekContext = {
  weekLabel: string
  promulgations: ActePromulgation[]
  decrets: ActeDecret[]
  applicationsCompletes: ActeApplicationComplete[]
  decisions: ActeDecision[]
  depots: ActeDepot[]
  stats: {
    promulgations: number
    decrets: number
    applicationsCompletes: number
    applications: number
    decisions: number
    /** Lois promulguées qui attendent leurs décrets : elles paraissent sous « Publié », avec les décrets. */
    promulgationsEnAttente: number
    depots: number
  }
  eventsSummary: string
  // Pour le template email (send/route.ts)
  votesHebdo: VoteHebdo[]
  dossierLumiere: DossierLumiere | null
  topDossiers: { uid: string; titre: string }[]
  topActeurs: { uid: string; prenom: string; nom: string; qualite: string | null }[]
  topActifsAN: TopActiviteElu[]
  topActifsSN: TopActiviteElu[]
  /**
   * Profils de citoyen les plus touchés par les textes de la semaine (rubrique « Qui
   * est concerné. »), au plus `MAX_PROFILS_SEMAINE`, du plus touché au moins touché.
   * Des identifiants du catalogue, traduits au rendu.
   */
  profilsSemaine: string[]
  /** Nombre de profils touchés en tout, ceux de `profilsSemaine` compris : la lettre
   *  dit combien d'autres elle ne nomme pas. */
  nbProfilsTouches: number
}

const MAX_PROFILS_SEMAINE = 5

// ── Fonction principale ───────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** `Intl` écrit « 1 octobre » : l'usage français veut « 1er » pour le premier du mois. */
export function premierDuMois(date: string): string {
  return date.replace(/^1 /, '1er ')
}

/**
 * Vrai quand le résultat d'une décision est un rejet : texte ou motion rejetés,
 * désaccord entre l'Assemblée et le Sénat. Valeurs relevées en base : `rejetée`,
 * `rejeté`, `rejet du texte par la commission préalable`, `Motion rejetée`,
 * `Désaccord`. Sans cette étiquette, le prompt les recevait comme des adoptions
 * et leur prêtait des effets au conditionnel.
 */
function estRejet(statut: string | null): boolean {
  const v = (statut ?? '').toLowerCase()
  return v.includes('rejet') || v.includes('désaccord')
}

// Chaque lecture lève sur panne (`sql` le fait seul), et aucune ne doit être
// enveloppée d'un repli. Quand une panne base rendait `null`, le `|| []` en aval
// l'avalait, et `totalActes` tombait à zéro : `send/route.ts` répondait alors
// `200 {"skipped":true,"reason":"no_events"}`, run vert et pas de lettre. Une base
// tombée était donc rigoureusement indiscernable d'une semaine parlementaire
// calme, cinquante-deux fois par an. `buildWeekContext` est déjà appelée dans un
// `try/catch` qui alerte et rend 500 : lever suffit à rendre la panne bruyante,
// sans une ligne d'alerte de plus.
//
// Les lectures par liste d'identifiants n'ont pas de tri : elles remplissent une
// Map par identifiant unique, où l'ordre ne compte pas (`application_lois` n'a
// qu'une ligne par dossier, vérifié le 2026-11-05).

type LigneActe = {
  uid: string
  libelle_acte: string
  date_acte: string
  dossier_uid: string
  vote_refs: string[] | null
  statut_conclusion: string | null
  code_loi: string | null
  titre_loi: string | null
  organe_ref: string | null
}

type LigneDossier = {
  uid: string
  titre: string
  procedure_libelle: string
  search_summary: string | null
  initiateur_acteur_ref: string | null
  initiateur_groupe_libelle: string | null
  view_count_month: number
}

type LigneScrutin = {
  uid: string
  titre: string
  sort_libelle: string | null
  type_vote_libelle: string | null
  type_vote_code: string | null
  chambre: string | null
  synthese_pour: number | null
  synthese_contre: number | null
  synthese_abstentions: number | null
  synthese_non_votants: number | null
  synthese_nombre_votants: number | null
  synthese_suffrages_requis: number | null
}

export async function buildWeekContext(weekStart: string, weekEnd: string): Promise<WeekContext> {
  if (!DATE_RE.test(weekStart) || !DATE_RE.test(weekEnd)) {
    throw new Error('weekStart et weekEnd doivent être au format YYYY-MM-DD')
  }
  const weekStartDate = new Date(weekStart + 'T00:00:00Z')
  const weekEndDate = new Date(weekEnd + 'T00:00:00Z')
  if (isNaN(weekStartDate.getTime()) || isNaN(weekEndDate.getTime())) {
    throw new Error('Dates invalides')
  }
  const weekLabel = `${premierDuMois(weekStartDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' }))} au ${premierDuMois(weekEndDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }))}`

  // ── 1. Actes de la semaine ────────────────────────────────────────────────
  // Mêmes dossiers que le fil du mois (`getMonthActes`) : pas ceux marqués `hors_liste`,
  // absents de toutes les listes du site. Ils portent pourtant des actes datés
  // (promulgation, décision du Sénat recréée par sync_senat.py) qui seraient sinon
  // racontés dans la lettre. `dossier_uid` est NOT NULL : le filtre n'écarte aucun
  // autre acte.
  const actesRaw = await sql<LigneActe[]>`
    select a.uid, a.libelle_acte, a.date_acte, a.dossier_uid, a.vote_refs, a.statut_conclusion,
      a.code_loi, a.titre_loi, a.organe_ref
    from actes_legislatifs a
    where a.date_acte >= ${weekStart}
      and a.date_acte <= ${weekEnd}
      and a.libelle_acte = any(${ALL_LIBELLES})
      and a.date_acte is not null
      and exists (select 1 from dossiers_legislatifs d where d.uid = a.dossier_uid and d.hors_liste = false)
    order by a.date_acte, a.uid, a.dossier_uid`

  // Un même acte peut être rattaché à deux dossiers (une motion de censure au projet
  // de loi de finances et à l'engagement de responsabilité). La `Map` garde la
  // dernière ligne : le tri par `dossier_uid` fixe laquelle.
  const actesList = [...new Map(actesRaw.map(a => [a.uid, a])).values()]

  // ── 2. Dossiers associés ─────────────────────────────────────────────────
  const dossierUids = [...new Set(actesList.map(a => a.dossier_uid).filter(Boolean))]

  const dossiersRaw = dossierUids.length > 0
    ? await sql<LigneDossier[]>`
        select uid, titre, procedure_libelle, search_summary, initiateur_acteur_ref, initiateur_groupe_libelle, view_count_month
        from dossiers_legislatifs
        where uid = any(${dossierUids})`
    : []

  const dossierMap = new Map(dossiersRaw.map(d => [d.uid, d]))

  // ── 3. Scrutins associés ─────────────────────────────────────────────────
  const allVoteRefs = [...new Set(actesList.flatMap(a => a.vote_refs || []).filter(Boolean))]

  const scrutinsRaw = allVoteRefs.length > 0
    ? await sql<LigneScrutin[]>`
        select uid, titre, sort_libelle, type_vote_libelle, type_vote_code, chambre, synthese_pour, synthese_contre,
          synthese_abstentions, synthese_non_votants, synthese_nombre_votants, synthese_suffrages_requis
        from scrutins
        where uid = any(${allVoteRefs})`
    : []

  const scrutinMap = new Map(scrutinsRaw.map(s => [s.uid, s]))

  // ── 3bis. Organes (pour résoudre la chambre des décisions sans scrutin) ──
  const decisionOrganeRefs = [...new Set(
    actesList
      .filter(a => (NIVEAU2_DECISIONS.includes(a.libelle_acte) || NIVEAU3_DEPOTS.includes(a.libelle_acte)) && a.organe_ref)
      .map(a => a.organe_ref as string)
  )]

  const organesRaw = decisionOrganeRefs.length > 0
    ? await sql<{ uid: string; libelle_abrege: string | null; code_type: string | null }[]>`
        select uid, libelle_abrege, code_type from organes where uid = any(${decisionOrganeRefs})`
    : []

  const organeMap = new Map(organesRaw.map(o => [o.uid, o]))

  function resolveChambреFromOrgane(organeRef: string | null): string | null {
    if (!organeRef) return null
    const o = organeMap.get(organeRef)
    if (!o) return null
    if (o.code_type === 'ASSEMBLEE') return 'Assemblée nationale'
    if (o.code_type === 'SENAT') return 'Sénat'
    return null
  }

  // ── 4. Acteurs (initiateurs des dossiers) ────────────────────────────────
  const initiateurUids = [...new Set(
    dossiersRaw.map(d => d.initiateur_acteur_ref).filter(Boolean) as string[]
  )]

  const acteursRaw = initiateurUids.length > 0
    ? await sql<{ uid: string; nom: string | null; prenom: string | null }[]>`
        select uid, nom, prenom from acteurs where uid = any(${initiateurUids})`
    : []

  const acteurMap = new Map(acteursRaw.map(a => [a.uid, a]))

  // ── 5. Application des lois (pour les promulgations) ─────────────────────
  const promDossierUids = [...new Set(
    actesList
      .filter(a => a.libelle_acte === NIVEAU1_PROMULGATION)
      .map(a => a.dossier_uid)
      .filter(Boolean)
  )]

  const appLoisRaw = promDossierUids.length > 0
    ? await sql<{ dossier_uid: string; application_directe: boolean | null }[]>`
        select dossier_uid, application_directe from application_lois where dossier_uid = any(${promDossierUids})`
    : []

  const appLoisMap = new Map(appLoisRaw.map(a => [a.dossier_uid, a]))

  // ── 6. Top dossiers & acteurs (pour le template email) ───────────────────
  const topRows = dossierUids.length > 0
    ? await sql<{ uid: string; titre: string }[]>`
        select uid, titre
        from dossiers_legislatifs
        where uid = any(${dossierUids})
          and view_count_month is not null
        order by view_count_month desc, uid
        limit 3`
    : []

  const topDossiers = topRows.map(d => ({ uid: d.uid, titre: d.titre }))

  const topActeursRows = await sql<{
    uid: string
    prenom: string | null
    nom: string | null
    est_ministre_actuel: boolean | null
    est_depute_actuel: boolean | null
    est_senateur_actuel: boolean | null
  }[]>`
    select uid, prenom, nom, est_ministre_actuel, est_depute_actuel, est_senateur_actuel
    from acteurs
    where view_count_month > 0
    order by view_count_month desc, uid
    limit 3`

  const topActeurs = topActeursRows.map(a => {
    const qualite = a.est_ministre_actuel ? 'Ministre'
      : a.est_depute_actuel ? 'Député(e)'
      : a.est_senateur_actuel ? 'Sénateur/trice'
      : null
    return { uid: a.uid, prenom: a.prenom ?? '', nom: a.nom ?? '', qualite }
  })

  const { topAN: topActifsAN, topSN: topActifsSN } = await getTopActiviteParChambre()

  // ── 7. Construction des actes enrichis ────────────────────────────────────

  function resolveInitiateur(dossierUid: string): string | null {
    const d = dossierMap.get(dossierUid)
    if (!d) return null
    const acteur = d.initiateur_acteur_ref ? acteurMap.get(d.initiateur_acteur_ref) ?? null : null
    const groupe = d.initiateur_groupe_libelle ?? null
    if (acteur && groupe) return `${acteur.prenom} ${acteur.nom} (${groupe})`
    if (acteur) return `${acteur.prenom} ${acteur.nom}`
    return groupe
  }

  const promulgations: ActePromulgation[] = []
  const decrets: ActeDecret[] = []
  const applicationsCompletes: ActeApplicationComplete[] = []
  const decisions: ActeDecision[] = []
  const depots: ActeDepot[] = []
  const tousBlocsIA: string[] = [] // ordre chronologique = même ordre que actesList

  for (const acte of actesList) {
    const dossier = dossierMap.get(acte.dossier_uid) ?? null
    const titre = dossier?.titre ?? 'Dossier inconnu'
    const dateStr = acte.date_acte?.slice(0, 10) // YYYY-MM-DD
    const search_summary = dossier?.search_summary ?? null

    if (acte.libelle_acte === NIVEAU1_PROMULGATION) {
      const appLoi = appLoisMap.get(acte.dossier_uid)
      const application_directe = appLoi?.application_directe ?? null
      const initiateur = resolveInitiateur(acte.dossier_uid)

      // Une loi qui attend ses décrets n'est pas une décision : elle paraît avec eux
      // sous « Publié », et ne compte pas dans la case « décisions ».
      const tag = application_directe === true ? '[EN VIGUEUR]' : '[PROMULGUÉ]'
      const lignesIA: string[] = [
        `${tag} • Promulgation — ${dateStr}`,
        `  Dossier : "${titre}"`,
      ]
      if (acte.code_loi) lignesIA.push(`  Loi n° : ${acte.code_loi}`)
      if (initiateur) lignesIA.push(`  Initiateur du dossier : ${initiateur}`)
      if (application_directe === true) lignesIA.push(`  Application : directe (aucun décret nécessaire)`)
      else if (application_directe === false) lignesIA.push(`  Application : des décrets d'application sont requis`)
      if (search_summary) lignesIA.push(`  Résumé : ${search_summary}`)

      promulgations.push({
        uid: acte.uid, date_acte: acte.date_acte, code_loi: acte.code_loi ?? null,
        titre_loi: acte.titre_loi ?? null, dossier_uid: acte.dossier_uid, dossier_titre: titre,
        dossier_search_summary: search_summary, initiateur, application_directe, lignesIA,
      })
      tousBlocsIA.push(lignesIA.join('\n'))

    } else if (acte.libelle_acte === NIVEAU1_DECRET) {
      // Pas d'initiateur : celui du dossier est l'auteur de la loi, pas du décret, et
      // transmis au prompt il devenait « (projet du gouvernement) » en incise du décret.
      const lignesIA: string[] = [
        `[DÉCRET] • Décret d'application — ${dateStr}`,
        `  Dossier : "${titre}"`,
      ]
      if (acte.titre_loi) lignesIA.push(`  Décret : ${acte.titre_loi}`)
      if (search_summary) lignesIA.push(`  Résumé : ${search_summary}`)

      decrets.push({
        uid: acte.uid, date_acte: acte.date_acte, titre_decret: acte.titre_loi ?? null,
        dossier_uid: acte.dossier_uid, dossier_titre: titre, dossier_search_summary: search_summary,
        lignesIA,
      })
      tousBlocsIA.push(lignesIA.join('\n'))

    } else if (acte.libelle_acte === NIVEAU1_APP_COMPLETE) {
      const lignesIA: string[] = [
        `[EN VIGUEUR] • Application complète — ${dateStr}`,
        `  Dossier : "${titre}"`,
        `  Statut : tous les décrets d'application ont été publiés — la loi est pleinement applicable`,
      ]
      if (search_summary) lignesIA.push(`  Résumé : ${search_summary}`)

      applicationsCompletes.push({
        uid: acte.uid, date_acte: acte.date_acte, dossier_uid: acte.dossier_uid,
        dossier_titre: titre, dossier_search_summary: search_summary, lignesIA,
      })
      tousBlocsIA.push(lignesIA.join('\n'))

    } else if (NIVEAU2_DECISIONS.includes(acte.libelle_acte)) {
      const scrutinRef = voteLePlusRecent((acte.vote_refs || []).filter((r: string) => scrutinMap.has(r)))
      const s = scrutinRef ? scrutinMap.get(scrutinRef) ?? null : null
      const scrutin = s && scrutinRef ? {
        uid: scrutinRef,
        titre: s.titre ?? null,
        sort_libelle: s.sort_libelle ?? null,
        type_vote_libelle: s.type_vote_libelle ?? null,
        type_vote_code: s.type_vote_code ?? null,
        chambre: s.chambre ?? null,
        pour: s.synthese_pour ?? null,
        contre: s.synthese_contre ?? null,
        abstentions: s.synthese_abstentions ?? null,
        non_votants: s.synthese_non_votants ?? null,
        nombre_votants: s.synthese_nombre_votants ?? null,
        suffrages_requis: s.synthese_suffrages_requis ?? null,
      } : null

      const initiateur = resolveInitiateur(acte.dossier_uid)
      const procedure = dossier?.procedure_libelle ?? null
      const chambre = scrutin?.chambre ?? resolveChambреFromOrgane(acte.organe_ref ?? null)
      const resultat = acte.statut_conclusion ?? scrutin?.sort_libelle ?? null

      // Une censure adoptée (`Motion adoptée`, relevé en base le 4 décembre 2024)
      // renverse le Gouvernement sur-le-champ : en [PAS EN VIGUEUR], le prompt la
      // racontait au conditionnel, comme un texte qui attend sa promulgation.
      const censureAdoptee = acte.libelle_acte === 'Décision sur une motion de censure'
        && !estRejet(resultat) && (resultat ?? '').toLowerCase().includes('adopt')
      const tag = censureAdoptee ? '[CENSURE ADOPTÉE]'
        : estRejet(resultat) ? '[REJETÉ]' : '[PAS EN VIGUEUR]'
      const lignesIA: string[] = [
        `${tag} • ${acte.libelle_acte} — ${dateStr}${chambre ? ` (${chambre})` : ''}`,
        `  Dossier : "${titre}"`,
      ]
      if (resultat) lignesIA.push(`  Décision : ${resultat}`)
      if (procedure) lignesIA.push(`  Procédure : ${procedure}`)
      if (initiateur) lignesIA.push(`  Initiateur du dossier : ${initiateur}`)
      if (scrutin) {
        const chambreLabel = scrutin.chambre === 'Sénat' ? 'au Sénat'
          : scrutin.chambre ? `à l'${scrutin.chambre}` : null
        const voteHeader = [scrutin.type_vote_libelle, chambreLabel].filter(Boolean).join(' ')
        const voteLabel = [voteHeader, scrutin.titre].filter(Boolean).join(' — ')
        if (voteLabel) lignesIA.push(`  Vote : ${voteLabel}`)
        const isCensure = acte.libelle_acte === 'Décision sur une motion de censure'
          || (scrutin.type_vote_libelle ?? '').toLowerCase().includes('censure')
        const parts = [
          `${scrutin.pour ?? 0} pour`,
          `${scrutin.contre ?? 0} contre`,
          `${scrutin.abstentions ?? 0} abstentions`,
        ]
        if (isCensure && scrutin.suffrages_requis != null) parts.push(`seuil : ${scrutin.suffrages_requis}`)
        lignesIA.push(`  Votes : ${parts.join(', ')}`)
      }
      if (search_summary) lignesIA.push(`  Résumé : ${search_summary}`)

      decisions.push({
        uid: acte.uid, date_acte: acte.date_acte, libelle_acte: acte.libelle_acte,
        statut_conclusion: acte.statut_conclusion ?? null, dossier_uid: acte.dossier_uid,
        dossier_titre: titre, dossier_procedure: procedure, dossier_search_summary: search_summary,
        initiateur, scrutin, lignesIA,
      })
      tousBlocsIA.push(lignesIA.join('\n'))

    } else if (NIVEAU3_DEPOTS.includes(acte.libelle_acte)) {
      const initiateur = resolveInitiateur(acte.dossier_uid)
      const procedure = dossier?.procedure_libelle ?? null

      const chambre = resolveChambреFromOrgane(acte.organe_ref ?? null)
      const lignesIA: string[] = [
        `[DÉPOSÉ] • Dépôt — ${dateStr}${chambre ? ` (${chambre})` : ''}`,
        `  Dossier : "${titre}"`,
      ]
      if (procedure) lignesIA.push(`  Procédure : ${procedure}`)
      if (initiateur) lignesIA.push(`  Initiateur du dossier : ${initiateur}`)
      if (search_summary) lignesIA.push(`  Résumé : ${search_summary}`)

      depots.push({
        uid: acte.uid, date_acte: acte.date_acte, dossier_uid: acte.dossier_uid,
        dossier_titre: titre, dossier_procedure: procedure, dossier_search_summary: search_summary,
        initiateur, lignesIA,
      })
      tousBlocsIA.push(lignesIA.join('\n'))
    }
  }

  // ── 8. eventsSummary — ordre chronologique ────────────────────────────────
  const eventsSummary = [`Semaine du ${weekLabel}`, '', tousBlocsIA.join('\n\n')].join('\n')

  // ── 9. votesHebdo (pour le template email) ────────────────────────────────
  const votesHebdo: VoteHebdo[] = (() => {
    const candidates = decisions.filter(d =>
      (d.libelle_acte === 'Décision' || d.libelle_acte === 'Décision de la CMP')
      && d.scrutin?.nombre_votants != null
    )
    if (candidates.length === 0) return []

    const isImportant = (t: string | null) => {
      const v = (t ?? '').toLowerCase()
      return v.includes('solennel') || v.includes('censure')
    }

    const important = candidates.filter(c => isImportant(c.scrutin!.type_vote_libelle))
    const selected = important.length > 0 ? important : [candidates.sort((a, b) => {
      const pourA = a.scrutin!.pour ?? 0, contreA = a.scrutin!.contre ?? 0
      const pourB = b.scrutin!.pour ?? 0, contreB = b.scrutin!.contre ?? 0
      const totalA = pourA + contreA, totalB = pourB + contreB
      const ratioA = totalA > 0 ? Math.abs(pourA / totalA - 0.5) : 1
      const ratioB = totalB > 0 ? Math.abs(pourB / totalB - 0.5) : 1
      return ratioA - ratioB
    })[0]]

    return selected.map(d => {
      const s = d.scrutin!
      const pour = s.pour ?? 0, contre = s.contre ?? 0
      const abstentions = s.abstentions ?? 0
      // Une motion de censure s'adopte à la majorité absolue des membres, pas des
      // suffrages exprimés : sans le seuil, le résultat ne se lit pas.
      const isMajCensure = s.type_vote_code === 'MOC'
      // Majorité absolue à l'AN = (LEGAL_AN / 2) + 1 = 289 (si LEGAL_AN = 577)
      const majAbsolueAN = Math.floor(LEGAL_AN / 2) + 1
      return {
        titre: d.dossier_titre,
        chiffres: {
          typeVoteCode: s.type_vote_code,
          pour,
          contre,
          abstentions,
          nonVotants: s.non_votants ?? 0,
          votants: s.nombre_votants ?? pour + contre + abstentions,
          suffragesRequis: s.suffrages_requis ?? 0,
          chambre: s.chambre,
        },
        sort: s.sort_libelle ?? '',
        type_vote_libelle: s.type_vote_libelle ?? null,
        type_majorite_label: isMajCensure
          ? `Majorité absolue requise (${majAbsolueAN}/${LEGAL_AN})`
          : 'Majorité des suffrages exprimés',
        scrutinUid: s.uid,
      }
    })
  })()

  // ── 10. dossierLumiere — dépôt le plus consulté ce mois-ci ───────────────
  // Les dépôts d'une semaine sont tous datés à minuit : « le premier » n'était qu'un
  // ordre de plan d'exécution. Le départage par identifiant rend le choix stable,
  // y compris en début de mois, quand tous les compteurs sont encore à zéro.
  const vues = (uid: string) => dossierMap.get(uid)?.view_count_month ?? 0
  const depotLumiere = [...depots].sort((a, b) =>
    vues(b.dossier_uid) - vues(a.dossier_uid) || a.dossier_uid.localeCompare(b.dossier_uid)
  )[0]
  const dossierLumiere: DossierLumiere | null = depotLumiere ? {
    uid: depotLumiere.dossier_uid,
    titre: depotLumiere.dossier_titre,
    procedure: depotLumiere.dossier_procedure,
    search_summary: depotLumiere.dossier_search_summary,
    date_depot: depotLumiere.date_acte,
  } : null

  // ── 11. profilsSemaine : profils les plus touchés par les textes de la semaine ──
  // `dossierUids` est l'union des dossiers de toutes les rubriques : chaque acte
  // retenu tombe dans l'une d'elles. La vue ne garde que les impacts « certain » et
  // « probable » (D-251) : c'est la lecture de la page « Ce qui me concerne »,
  // restreinte aux textes de la lettre.
  const profilsParTexte = dossierUids.length > 0 ? await profilsParDossier(dossierUids) : new Map<string, string[]>()
  // La vue rend des couples distincts : chaque profil d'un texte compte ce texte une fois.
  const textesParProfil = new Map<string, number>()
  for (const profils of profilsParTexte.values()) {
    for (const p of profils) textesParProfil.set(p, (textesParProfil.get(p) ?? 0) + 1)
  }
  // À égalité, l'ordre des pastilles du site, thèmes les plus courants d'abord. Un
  // profil absent du catalogue (retiré depuis le classement) n'a pas de libellé : il
  // est écarté plutôt qu'affiché par son identifiant.
  const rangProfil = new Map(ORDRE_PROFILS.map((id, i) => [id, i]))
  const profilsTouches = [...textesParProfil.keys()].filter(id => rangProfil.has(id))
  // `sort` trie sur place : `profilsTouches` n'en garde que sa longueur.
  const profilsSemaine = profilsTouches
    .sort((a, b) => textesParProfil.get(b)! - textesParProfil.get(a)! || rangProfil.get(a)! - rangProfil.get(b)!)
    .slice(0, MAX_PROFILS_SEMAINE)

  const applicationsCount = applicationsCompletes.length + promulgations.filter(p => p.application_directe === true).length

  return {
    weekLabel, promulgations, decrets, applicationsCompletes, decisions, depots,
    stats: {
      promulgations: promulgations.length,
      decrets: decrets.length,
      applicationsCompletes: applicationsCompletes.length,
      applications: applicationsCount,
      decisions: decisions.length,
      promulgationsEnAttente: promulgations.filter(p => p.application_directe !== true).length,
      depots: depots.length,
    },
    eventsSummary, votesHebdo, dossierLumiere, topDossiers, topActeurs, topActifsAN, topActifsSN,
    profilsSemaine, nbProfilsTouches: profilsTouches.length,
  }
}
