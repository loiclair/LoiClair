// Ce que la loi fait d'un mandat local détenu par un parlementaire.
//
// La règle vit ici et nulle part ailleurs : la fiche élu et l'article
// /Facts/cumul-des-mandats la lisent tous les deux, et un décompte qui
// divergerait entre les deux écrans serait pire que pas de décompte du tout.
// Les appelants lui passent les lignes en vigueur (`enVigueur`), pas celles du
// registre brut.

/**
 * Ce que LoiClair a constaté sur une ligne du registre, quand il retarde ou se
 * trompe. Tenu à la main dans `pipeline/corrections_rne.json`, posé par
 * `import_rne.py` dans les colonnes `verif_*`.
 *
 * - `fonction_quittee` : la fonction de direction est quittée, le siège reste.
 * - `mandat_quitte` : le siège lui-même est quitté.
 * - `fonction_jamais_exercee` : le registre prête une fonction que l'élu n'a
 *   jamais eue.
 */
export type EffetVerification = 'fonction_quittee' | 'mandat_quitte' | 'fonction_jamais_exercee'

/** Une ligne de `mandats_locaux`, telle que la base la rend. */
export type MandatLocalRow = {
  type: string
  collectivite: string
  fonction: string | null
  population?: number | null
  /** Entrée au conseil : date le motif « deux conseils ». */
  date_debut?: string | null
  /** Prise de fonction, distincte de l'entrée au conseil : un maire est élu
   *  conseiller le dimanche et maire la semaine suivante. Date le motif
   *  « fonction exécutive ». */
  date_debut_fonction?: string | null
  verif_effet?: EffetVerification | null
  /** Date du changement d'après la source, nulle quand elle ne la donne pas. */
  verif_date?: string | null
  verif_source_url?: string | null
  verif_source_nom?: string | null
}

/**
 * La ligne telle qu'elle vaut aujourd'hui, après ce que LoiClair a constaté :
 * sans sa fonction si elle est quittée ou n'a jamais existé, `null` si le siège
 * est quitté, inchangée sinon.
 *
 * Les règles ci-dessous ne lisent que des lignes passées par ici. Elles restent
 * donc les seules à juger, et le registre corrigé n'a pas de décompte à lui :
 * l'article, la fiche et le serveur MCP comptent pareil (D-126).
 */
export function enVigueur<T extends MandatLocalRow>(mandat: T): T | null {
  switch (mandat.verif_effet) {
    case 'mandat_quitte':
      return null
    case 'fonction_quittee':
    case 'fonction_jamais_exercee':
      return { ...mandat, fonction: null }
    default:
      return mandat
  }
}

/**
 * Le statut d'un mandat au regard des règles de cumul. Tous sont des cumuls :
 * ce statut dit ce que la loi en fait, pas s'il en est un.
 *
 * - `executif` : LO 141-1 l'interdit purement et simplement à un parlementaire
 *   (maire, adjoint, président ou vice-président d'un conseil).
 * - `quota` : autorisé, mais il occupe l'unique place que LO 141 laisse.
 * - `commune_petite` : autorisé et sans limite, LO 141 ne comptant le siège
 *   municipal qu'à partir de 1 000 habitants.
 * - `flechage` : le siège communautaire, qui découle du mandat municipal sans
 *   élection distincte et n'occupe donc pas la place.
 */
export type StatutMandat = 'executif' | 'quota' | 'commune_petite' | 'flechage'

/** Seuil de population à partir duquel LO 141 compte le siège municipal. */
export const SEUIL_COMMUNE_LO141 = 1000

/**
 * Les mandats locaux que LO 141 énumère.
 *
 * Détenir l'un d'eux, c'est cumuler, quelle que soit la taille de la commune :
 * le seuil de 1 000 habitants ne dit pas s'il y a cumul, il dit seulement si ce
 * cumul occupe l'unique place autorisée. Le siège communautaire n'y figure pas,
 * il découle du mandat municipal par fléchage.
 */
export const TYPES_LOCAUX_LO141 = new Set([
  'municipal',
  'departemental',
  'regional',
  'arrondissement',
  'assemblee',
])

/**
 * Une fonction que LO 141-1 interdit, c'est-à-dire la direction d'une
 * collectivité.
 *
 * Le registre national inscrit dans le même champ des rôles qui n'ont rien
 * d'exécutif : « Autre membre » d'une assemblée, ou « Président de commission
 * du conseil départemental ». Présider une commission interne n'est pas diriger
 * la collectivité, et les compter parmi les cumuls interdits serait une
 * accusation fausse.
 */
export function estFonctionExecutive(fonction: string | null): boolean {
  if (!fonction) return false
  const f = fonction.toLowerCase()
  if (f.includes('commission')) return false
  return f.includes('maire') || f.includes('président') || f.includes('president')
}

/**
 * Le mandat pèse-t-il sur l'unique place que LO 141 autorise ?
 *
 * Indépendant de la fonction exercée : un maire est d'abord conseiller
 * municipal, et son siège occupe la place comme celui d'un simple conseiller.
 * Les deux règles se cumulent, elles ne se remplacent pas.
 */
export function compteDansQuota(mandat: MandatLocalRow): boolean {
  if (!TYPES_LOCAUX_LO141.has(mandat.type)) return false
  // La population ne vaut que pour les mandats communaux ; ailleurs elle est
  // nulle et ne doit pas exclure le mandat.
  if (mandat.type === 'municipal' || mandat.type === 'arrondissement') {
    return (mandat.population ?? 0) >= SEUIL_COMMUNE_LO141
  }
  return true
}

/**
 * Le statut à afficher. Quand les deux règles s'appliquent, c'est l'interdiction
 * qui s'affiche : elle est la plus forte, et la pastille n'a la place que d'une
 * mention.
 */
export function statutMandat(mandat: MandatLocalRow): StatutMandat {
  if (estFonctionExecutive(mandat.fonction)) return 'executif'
  if (compteDansQuota(mandat)) return 'quota'
  return TYPES_LOCAUX_LO141.has(mandat.type) ? 'commune_petite' : 'flechage'
}

/**
 * Le nombre de mandats qui pèsent sur le quota de LO 141. Au-delà de un, la
 * situation est incompatible et l'élu doit renoncer à l'un d'eux.
 *
 * Paris, Lyon et Marseille inscrivent le même élu au conseil municipal et au
 * conseil d'arrondissement : c'est un mandat vu à deux échelons, compté une
 * fois.
 */
export function compterQuota(mandats: MandatLocalRow[]): number {
  const communesMunicipales = new Set(
    mandats.filter((m) => m.type === 'municipal').map((m) => m.collectivite),
  )
  return mandats.filter((m) => {
    if (!compteDansQuota(m)) return false
    return !(m.type === 'arrondissement' && communesMunicipales.has(m.collectivite))
  }).length
}

// ── Le délai pour choisir ───────────────────────────────────────────────────

/**
 * Ce que la vérification au cas par cas établit sur la situation d'un
 * parlementaire et qu'aucun registre ne publie, lu dans `situations_cumul` :
 * un recours contre l'élection en cours, ou une date limite que le calcul ne
 * sait pas trouver. L'un ou l'autre, jamais les deux (contrainte de la table).
 */
export type SituationCumul = {
  recours: boolean
  date_limite: string | null
  source_url: string
  source_nom: string | null
}

/** Ce que l'écran dit du délai : suspendu par un recours, ou une date. */
export type EcheanceCumul =
  | { etat: 'recours'; sourceUrl: string; sourceNom: string | null }
  | {
      etat: 'date'
      date: string
      /** Source de la date quand elle vient de la vérification, pas du calcul. */
      sourceUrl: string | null
      sourceNom: string | null
    }

/**
 * Les scrutins de renouvellement du Sénat, rangés par série : un siège revient
 * aux urnes tous les six ans, dans sa série. La réforme de 2003 a fondu les
 * anciennes séries B (2001) et C (2004) dans la série 1, renouvelée en 2011.
 *
 * À compléter du scrutin de septembre 2029 avant le 1er octobre 2029 : sans lui,
 * les sénateurs élus ce jour-là retombent sur leur date d'entrée, et leur date
 * limite arrive quatre jours trop tard.
 */
const SERIES_SENAT = [
  ['2001-09-23', '2004-09-26', '2011-09-25', '2017-09-24', '2023-09-24'],
  ['2008-09-21', '2014-09-28', '2020-09-27', '2026-09-27'],
]

/** `iso` décalé de `jours` jours, en date nue. */
function decaler(iso: string, jours: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + jours)
  return d.toISOString().slice(0, 10)
}

/**
 * Le dernier scrutin qui a élu ou réélu un sénateur, à partir de son entrée.
 *
 * `acteurs.date_debut_mandat` garde le début de la présence continue au Sénat
 * (2020 pour un sénateur réélu en septembre 2026), et c'est voulu : ses votes
 * depuis 2020 comptent. Le délai de LO 151, lui, repart de chaque élection.
 * L'entrée, qui suit son scrutin de quelques jours (le 1er octobre, le 2 en
 * 2023), situe le siège dans sa série ; on remonte au dernier scrutin de la
 * série. `null` si l'entrée ne suit aucun scrutin : un remplaçant, entré en
 * cours de mandat, dont la série ne se déduit pas.
 */
export function derniereElectionSenat(entree: string, aujourdhui: string): string | null {
  for (const serie of SERIES_SENAT) {
    const ancre = serie.find((scrutin) => entree >= scrutin && entree <= decaler(scrutin, 15))
    if (ancre) return serie.filter((scrutin) => scrutin >= ancre && scrutin <= aujourdhui).at(-1) ?? ancre
  }
  return null
}

/**
 * Depuis quand la situation existe : la plus ancienne date de motif parmi les
 * lignes en vigueur. Une fonction exécutive s'ouvre à la prise de fonction, un
 * double siège à l'arrivée du second conseil, le premier étant régulier tant
 * qu'il est seul. `null` si une date manque à la source ou s'il n'y a pas de
 * situation.
 */
export function motifSituation(mandats: MandatLocalRow[]): string | null {
  const dates: string[] = []
  for (const m of mandats) {
    if (!estFonctionExecutive(m.fonction)) continue
    const debut = m.date_debut_fonction ?? m.date_debut
    if (debut) dates.push(debut)
  }
  if (compterQuota(mandats) > 1) {
    const datees = mandats
      .filter((m) => compteDansQuota(m))
      .map((m) => m.date_debut)
      .filter((d): d is string => Boolean(d))
      .sort()
    if (datees.length > 1) dates.push(datees[datees.length - 1])
  }
  return dates.sort()[0] ?? null
}

/**
 * La date affichée « depuis le », jamais antérieure à l'entrée au Parlement :
 * un vice-président de conseil départemental élu en 2021 et devenu député en
 * 2025 n'est en situation que depuis 2025, et afficher 2021 en ferait un
 * récidiviste de quatre ans.
 */
export function depuisSituation(motif: string | null, entree: string | null): string | null {
  return motif && entree && entree > motif ? entree : motif
}

/**
 * Le délai de LO 151 : trente jours après l'élection qui a créé la situation,
 * suspendu tant qu'un recours contre cette élection n'est pas jugé
 * définitivement (la page le rappelle dans « Ce qui arrive si l'élu ne choisit
 * pas »).
 *
 * L'élection qui crée la situation est la plus tardive de deux : celle du motif
 * local, et la dernière élection au Parlement (pour un sénateur, le dernier
 * scrutin de son siège ; pour un député, son entrée). Ce que la vérification a
 * établi passe avant le calcul : un recours, ou une date imposée.
 *
 * `null` sans date de motif ni situation vérifiée : on ne date pas ce qu'on ne
 * sait pas dater.
 */
export function echeanceSituation(args: {
  motif: string | null
  chambre: 'AN' | 'SN'
  entree: string | null
  situation: SituationCumul | null
  aujourdhui: string
}): EcheanceCumul | null {
  const { motif, chambre, entree, situation, aujourdhui } = args
  if (situation?.recours) {
    return { etat: 'recours', sourceUrl: situation.source_url, sourceNom: situation.source_nom }
  }
  if (situation?.date_limite) {
    return { etat: 'date', date: situation.date_limite, sourceUrl: situation.source_url, sourceNom: situation.source_nom }
  }
  if (!motif) return null
  const election = entree && chambre === 'SN' ? derniereElectionSenat(entree, aujourdhui) ?? entree : entree
  const declenchement = election && election > motif ? election : motif
  return { etat: 'date', date: decaler(declenchement, 30), sourceUrl: null, sourceNom: null }
}
