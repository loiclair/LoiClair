// Ordre canonique des étapes clés du parcours législatif
// Partagé entre la liste des dossiers, la page résumé IA et la page d'un vote

export const STEP_CONFIG: Record<string, { labelKey: string; priority: number }> = {
  'AN1':      { labelKey: 'AN1',      priority: 10 },
  // Un dossier dédié à une motion de censure ou à un engagement de responsabilité
  // (49.3) n'a aucune étape de navette : son seul acte de décision est le vote sur la
  // motion. Sans cette étape, sa frise se réduisait au dépôt et son vote n'apparaissait
  // nulle part, alors que le scrutin est complet en base. 18 dossiers concernés.
  'MOTION':   { labelKey: 'MOTION',   priority: 15 },
  'SN1':      { labelKey: 'SN1',      priority: 20 },
  'ANLUNI':   { labelKey: 'ANLUNI',   priority: 10 },
  'CMP':      { labelKey: 'CMP',      priority: 25 },
  'AN2':      { labelKey: 'AN2',      priority: 30 },
  'SN2':      { labelKey: 'SN2',      priority: 40 },
  'ANNLEC':   { labelKey: 'ANNLEC',   priority: 50 },
  'SNNLEC':   { labelKey: 'SNNLEC',   priority: 60 },
  'ANLDEF':   { labelKey: 'ANLDEF',   priority: 70 },
  'CC':       { labelKey: 'CC',       priority: 80 },
  'PROM':     { labelKey: 'PROM',     priority: 90 },
  'DECAPP':   { labelKey: 'DECAPP',   priority: 100 },
  'AN-APPLI': { labelKey: 'AN-APPLI', priority: 110 },
};

export const MILESTONE_CODES = Object.keys(STEP_CONFIG);

// Lecture d'une étape, en clé de traduction courte (namespace `elus.banner` du bandeau
// des élus, `ContacterMesElusBanner`). La phrase du bandeau nomme déjà la chambre (« ma députée », « mon
// sénateur ») : seule la lecture manque pour dire de quel vote il s'agit quand un dossier
// en compte plusieurs. Lue par la fiche d'un texte et par la page d'un vote.
export const LECTURE_KEY_BY_MILESTONE: Record<string, string> = {
  AN1: 'lectureFirst',
  SN1: 'lectureFirst',
  AN2: 'lectureSecond',
  SN2: 'lectureSecond',
  ANLUNI: 'lectureUnique',
  ANNLEC: 'lectureNouvelle',
  SNNLEC: 'lectureNouvelle',
  ANLDEF: 'lectureDefinitive',
  CMP: 'lectureCMP',
};

/** Étape du parcours à laquelle se rattache un acte de décision (celui qui porte les
 *  `vote_refs`). Appelée par la fiche d'un texte, fast path (phrase de vote du hero) comme
 *  heavy path (cartes de décision de la timeline), et par la page d'un vote, qui nomme
 *  l'étape de la même façon. */
export function milestoneOf(code: string): string | null {
  if (code === 'CC-CONCLUSION') return 'CC';
  if (code === 'CMP-DEBATS-AN-DEC') return 'CMP';
  if (code === 'CMP-DEBATS-SN-DEC') return 'CMP';
  // Une motion de censure porte son vote sur un acte `{PRÉFIXE}-MOTION-VOTE`. Quand
  // le préfixe est une étape de navette (ANNLEC, CMP, ANLDEF), la motion a été déposée
  // pendant cette lecture et son vote s'y rattache. Sans cette ligne,
  // `decisionsByMilestone` jetait la décision avant de la construire : les votes de
  // motion n'affichaient aucune carte, alors que le scrutin était complet en base.
  // Les dossiers dédiés à une motion ou à un 49.3 portent le préfixe `AN21`, qui n'est
  // pas une étape de navette : leur vote se rattache à l'étape `MOTION`, qui n'existe
  // que pour eux.
  if (code.endsWith('-MOTION-VOTE')) {
    const prefixe = code.slice(0, -'-MOTION-VOTE'.length);
    if (prefixe !== 'MOTION' && MILESTONE_CODES.includes(prefixe)) return prefixe;
    return 'MOTION';
  }
  for (const m of MILESTONE_CODES) {
    if (code === `${m}-DEC` || code === `${m}-DEBATS-DEC`) return m;
  }
  return null;
}

// Codes d'actes détaillés utilisés pour les KPIs et le mapping timeline
export const KPI_ACTE_CODES = [
  'AN1-DEPOT', 'AN2-DEPOT', 'ANLDEF-DEPOT', 'ANLUNI-DEPOT', 'ANNLEC-DEPOT',
  'AN1-DEBATS-DEC', 'AN2-DEBATS-DEC', 'ANLDEF-DEBATS-DEC', 'ANLUNI-DEBATS-DEC', 'ANNLEC-DEBATS-DEC',
  'CMP-DEBATS-AN-DEC', 'CMP-SAISIE', 'CMP-DEC',
  'SN1-DEPOT', 'SN2-DEPOT', 'SNNLEC-DEPOT',
  'PROM-PUB',
  'SN1-DEBATS-DEC', 'SN2-DEBATS-DEC', 'SNNLEC-DEBATS-DEC',
  'CMP-DEBATS-SN-DEC',
  'CC-SAISIE-PM', 'CC-SAISIE-AN', 'CC-SAISIE-SN', 'CC-SAISIE-DROIT', 'CC-CONCLUSION',
  'DECAPP-PUB', 'AN-APPLI-RAPPORT', 'AN-APPLI-DIRECTE', 'AN-APPLI-COMPLETE',
  // Le renvoi en commission est le premier acte daté d'une deuxième lecture, et
  // parfois le seul. Sans lui, l'étape n'a aucune date : elle tombe sur le repli de
  // tri de la fiche et se range après la promulgation. Dix dossiers étaient dans ce
  // cas. Les renvois des autres lectures (ANNLEC, SNNLEC, ANLDEF) n'y sont pas :
  // aucune n'en a besoin, et chacun avancerait la date d'une étape qui va bien.
  'AN2-COM-FOND-SAISIE', 'SN2-COM-FOND-SAISIE',
  'AN1-PROCACC', 'SN1-PROCACC',
  // Étapes du parcours des dossiers de contrôle. Ces actes ne portent ni texte ni
  // vote, donc aucun autre critère de la requête de la fiche ne les ramène. Le dépôt
  // d'un rapport à l'Assemblée (`AN20-…-RAPPORT`) n'en a pas besoin : il cite son texte.
  'AN20-COMENQ-CREA', 'AN20-COMENQ-NOMIN',
  'AN20-MISINF-CREA', 'AN20-MISINF-NOMIN',
  'SN20-RAPPORT',
];

// Les codes d'actes que `parcoursDuDossier` doit recevoir, avec les actes qui portent un
// vote ou un texte : le filtre commun de la requête de la fiche et de celle du vote.
export const PARCOURS_ACTE_CODES = [...MILESTONE_CODES, ...KPI_ACTE_CODES];

// Suffixe d'un `code_acte` → clé du namespace i18n `dossiers`.
//
// Un code d'acte se lit par segments, de l'étape vers l'action : `AN1-COM-FOND-REUNION`
// dit « Assemblée, 1ʳᵉ lecture, commission au fond, réunion ». C'est la fin du code qui
// porte ce qui vient de se passer, et elle seule tient dans la colonne de droite de la
// liste, qui porte déjà la date. Les 49 codes qui apparaissent aujourd'hui comme dernier
// acte se ramènent ainsi à quinze libellés, et un code inédit tombe sur le repli.
//
// La table est lue dans l'ordre et rend au premier suffixe qui correspond. Aucun suffixe
// n'est aujourd'hui le suffixe d'un autre, donc l'ordre ne départage rien : il le fera le
// jour où un suffixe court sera ajouté (`-CREA` face à `-MISINF-CREA`, par exemple).
// Garder le plus spécifique au-dessus.
//
// Le mapping porte sur `code_acte`, jamais sur `libelle_acte` : le code est
// machine-lisible et stable, le libellé ne l'est pas (`AN1-DEPOT` porte deux libellés
// différents selon la provenance, dont un avec un point final).
//
// Ces libellés doublent parfois ceux du namespace `steps` (« Promulguée »), volontairement :
// `steps` nomme une étape dans la timeline d'une fiche, ici on qualifie une date dans une
// liste. Les deux textes peuvent diverger sans que l'un casse l'autre.
//
// `acteDecret` dit « Dernier décret » et non « Décret d'application » : ici la date est
// celle du dernier acte du dossier, quand la timeline de la fiche porte celle du premier
// décret, d'où part son « en cours depuis X mois ». Sur 35 dossiers dont le dernier acte
// est un décret, 22 ont plusieurs décrets, avec 291 jours d'écart en moyenne et jusqu'à
// 1 585 : sans « Dernier », le même libellé annonçait deux dates éloignées de quatre ans.
const ACTE_SUFFIX_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['AN-APPLI-DIRECTE', 'acteApplicationDirecte'],
  ['AN-APPLI-COMPLETE', 'acteApplicationComplete'],
  ['PROM-PUB', 'actePromulguee'],
  ['DECAPP-PUB', 'acteDecret'],
  ['CC-CONCLUSION', 'acteConseilConstit'],
  ['-MOTION-VOTE', 'acteMotion'],
  ['-MISINF-CREA', 'acteMission'],
  ['-COMENQ-CREA', 'acteCreation'],
  ['-DEBATS-SEANCE', 'acteSeance'],
  ['-DEBATS-DEC', 'acteVote'],
  ['-RAPPORT', 'acteRapport'],
  ['-REUNION', 'acteCommission'],
  ['-SAISIE', 'acteSaisine'],
  ['-NOMIN', 'acteNomination'],
  ['-RTRINI', 'acteRetrait'],
  ['-PROCACC', 'acteProcedureAcceleree'],
  ['-DEPOT', 'acteDepot'],
];

/**
 * Clé i18n (namespace `dossiers`) décrivant le dernier acte d'un dossier, ou `null`
 * quand le code est inconnu : la liste n'affiche alors que la date, jamais un code brut.
 */
export function acteLabelKey(code: string | null | undefined): string | null {
  if (!code) return null;
  for (const [suffixe, cle] of ACTE_SUFFIX_LABELS) {
    if (code.endsWith(suffixe)) return cle;
  }
  return null;
}

/** Acte lu par `parcoursDuDossier`, trié du plus ancien au plus récent, `uid` départageant
 *  (D-329) : le premier ou le dernier trouvé décide de certaines dates. */
export type ActeDuParcours = {
  code_acte: string;
  date_acte: string | null;
  parent_uid: string | null;
  textes_associes: string[] | null;
};

/** Une étape du parcours : code (une clé de `STEP_CONFIG`, ou `DEPOT`), date AAAA-MM-JJ, et
 *  `done` à faux pour une étape encore à venir. */
export type EtapeDuParcours = { code: string; date: string | null; done: boolean };

/**
 * Le parcours d'un dossier législatif, du dépôt à l'application, ordonné par date : la seule
 * règle de ce qui figure sur la frise, lue par la fiche d'un texte (`resume-ia/page.tsx`, qui
 * y ajoute libellés et détails) et par la page d'un vote (`vote-page.ts`). Fonction pure :
 * `statutApplication` est la colonne du baromètre (`application_lois`), `null` si l'appelant
 * n'affiche ni décrets ni application, les seules étapes qui en dépendent. Les dossiers de
 * contrôle ont leur propre parcours, construit par la fiche.
 */
export function parcoursDuDossier(
  actes: readonly ActeDuParcours[],
  dossier: { date_depot?: string | null; date_promulgation?: string | null; statut_final?: string | null; procedure_libelle?: string | null },
  textes: readonly { uid: string; date_publication: string | null }[],
  statutApplication: string | null,
) {
  // Single-pass sur les actes : milestones, codes, dates
  const milestoneDateMap = new Map<string, Date>();
  // Étapes ayant au moins un acte daté autre que le renvoi en commission au fond,
  // donc une lecture qui a réellement eu lieu et pas seulement été ouverte.
  const milestoneActeReel = new Set<string>();
  const actesCodes = new Set<string>();
  const allActesCodes = new Set<string>();
  let decappLastDate: Date | null = null;
  const depotDate = dossier.date_depot ? new Date(dossier.date_depot) : null;
  const datePromDate = dossier.date_promulgation ? new Date(dossier.date_promulgation) : null;
  const milestoneSet = new Set(MILESTONE_CODES);

  for (const acte of actes) {
    const code: string = acte.code_acte;
    allActesCodes.add(code);

    if (acte.parent_uid === null && milestoneSet.has(code)) {
      actesCodes.add(code);
    }

    // L'acte de vote d'une motion a toujours un parent (la motion elle-même) et un code
    // préfixé par le moment du débat : ni l'une ni l'autre des conditions ci-dessus ne
    // l'attrape. On le rattache donc explicitement à son étape.
    if (milestoneOf(code) === 'MOTION') {
      actesCodes.add('MOTION');
      if (acte.date_acte) {
        const dMotion = new Date(acte.date_acte);
        const existante = milestoneDateMap.get('MOTION');
        if (!existante || dMotion < existante) milestoneDateMap.set('MOTION', dMotion);
        milestoneActeReel.add('MOTION');
      }
    }

    if (!acte.date_acte) continue;
    const d = new Date(acte.date_acte);
    if (!depotDate || d >= depotDate) {
      if (code === 'DECAPP-PUB') {
        // Ignorer les décrets antérieurs à la promulgation (mesures déjà appliquées)
        if (datePromDate && d < datePromDate) continue;
        if (!decappLastDate || d > decappLastDate) decappLastDate = d;
      }
      for (const milestone of MILESTONE_CODES) {
        if (code.startsWith(milestone + '-')) {
          if (milestone === 'DECAPP' && datePromDate && d < datePromDate) break;
          const existing = milestoneDateMap.get(milestone);
          if (!existing || d < existing) milestoneDateMap.set(milestone, d);
          if (!code.endsWith('-COM-FOND-SAISIE')) milestoneActeReel.add(milestone);
          break;
        }
      }
    }
  }

  // La branche CMP porte aussi `CMP-DEPOT`, le dépôt du texte transmis par l'autre
  // chambre : il est daté du jour de la transmission, jusqu'à 367 jours avant la
  // convocation, et le minimum de la branche daterait donc la CMP de ce dépôt.
  // 16 dossiers sur 60 affichaient une CMP trop précoce, de 34 jours en moyenne.
  // `CMP-SAISIE` est la convocation elle-même, datée sur les 63 dossiers à CMP ; le
  // repli sur le minimum ne sert qu'au cas où elle viendrait à manquer. Trois dossiers
  // de la 16ᵉ législature en ont deux, à des mois d'écart (relevé le 2026-11-05) : la
  // plus récente l'emporte (choix d'Alex du 2026-11-05). `actes` est trié par date
  // croissante.
  const cmpSaisie = actes.findLast((a) => a.code_acte === 'CMP-SAISIE' && a.date_acte);
  if (cmpSaisie?.date_acte) milestoneDateMap.set('CMP', new Date(cmpSaisie.date_acte));

  // Une nouvelle lecture suit l'échec de la CMP (article 45 de la Constitution), mais son
  // dépôt et son renvoi en commission, datés de la transmission du texte, peuvent précéder
  // la convocation : sur « Fin de vie », dépôt le 12 mai 2026 et convocation le 19. La
  // lecture se date alors de son premier acte après la convocation, et sans date tant
  // qu'elle n'en a pas : c'est ce qui la range après la CMP, ici et sur la page d'un vote.
  const dateCmp = milestoneDateMap.get('CMP');
  for (const lecture of dateCmp ? ['ANNLEC', 'SNNLEC'] : []) {
    const debut = milestoneDateMap.get(lecture);
    if (!dateCmp || !debut || debut >= dateCmp) continue;
    const premier = actes.find((a) => a.date_acte && a.code_acte.startsWith(`${lecture}-`) && new Date(a.date_acte) >= dateCmp);
    if (premier?.date_acte) milestoneDateMap.set(lecture, new Date(premier.date_acte));
    else milestoneDateMap.delete(lecture);
  }

  // La promulgation se date de la parution au Journal officiel, `date_publication` du
  // texte de la loi, que le menu des versions affiche sous « Loi promulguée ». L'acte
  // `PROM-PUB` porte la signature, qui la précède d'un à deux jours sur 151 des 152 lois
  // (mesuré le 2026-10-29) : la fiche montrait deux dates pour la même étape. Le Journal
  // officiel l'emporte (choix d'Alex), ici comme sur la pastille de « Ce qui change pour
  // vous » (`ce-qui-me-concerne.ts`). Repli sur la signature si le texte n'est pas daté.
  const promPub = actes.find((a) => a.code_acte === 'PROM-PUB');
  const dateJO = promPub?.textes_associes
    ?.map((u) => textes.find((t) => t.uid === u)?.date_publication)
    .find(Boolean);
  if (dateJO) milestoneDateMap.set('PROM', new Date(dateJO));

  const isRejected = dossier.statut_final === 'Rejeté';
  const isProm = actesCodes.has('PROM');
  const isAppDirecte = allActesCodes.has('AN-APPLI-DIRECTE');
  const isAppAppliquee = allActesCodes.has('AN-APPLI-COMPLETE');
  // Loi « sans échéancier » au baromètre de l'Assemblée : aucune liste de décrets publiée
  // et 0 mesure à appliquer, sans être déclarée d'application directe (90 lois sur 2 065
  // au 2026-11-03, dont le code noir). La frise montrait des décrets « en attente » que
  // rien n'annonce ; elle dit maintenant ce que dit la source, sans conclure que la loi
  // est appliquée (choix d'Alex du 2026-11-03). `import_application_lois.py` ne garde
  // pas la colonne, mais son `compute_statut` rend `sans_objet` pour ces lois et pour
  // elles seules : les lois de ratification, l'autre chemin vers `sans_objet`, sont
  // toutes déclarées d'application directe dans le fichier, qui passe en premier.
  // Un acte de décret ou d'application complète l'emporte sur le baromètre, publié à
  // un autre rythme que les actes : la frise ne cache pas un décret que l'Assemblée a
  // déjà rattaché au dossier, et ne dit pas qu'aucun n'est annoncé.
  const isSansEcheancier = isProm && !isAppDirecte && !isAppAppliquee && !allActesCodes.has('DECAPP')
    && statutApplication === 'sans_objet';

  const isLectureUnique = actesCodes.has('ANLUNI');
  const hasANSteps = [...actesCodes].some(c => c.startsWith('AN'));
  const hasSNSteps = [...actesCodes].some(c => c.startsWith('SN'));
  const bothChambersPresent = (hasANSteps || isLectureUnique) && (hasSNSteps || isLectureUnique);
  const proc = (dossier.procedure_libelle ?? '').toLowerCase();
  const canBePromulgated = proc.includes('loi') || proc.includes('ratification');

  const etapes: EtapeDuParcours[] = MILESTONE_CODES
    .filter(code => {
      // Une lecture dont le seul acte daté est le renvoi en commission a été
      // ouverte puis jamais tenue : le texte est reparti en CMP. Ni l'AN ni le
      // Sénat ne l'affichent sur leurs propres fiches, cf. D-102. La condition
      // « une étape est datée plus tard » distingue cette lecture supplantée d'un
      // dossier réellement en cours d'examen en commission, dont ce serait alors
      // l'étape courante : on ne peut pas la lui effacer.
      if (milestoneDateMap.has(code) && !milestoneActeReel.has(code)) {
        const d = milestoneDateMap.get(code)!.getTime();
        if ([...milestoneDateMap.values()].some(x => x.getTime() > d)) return false;
      }
      if (code === 'PROM') return isProm || (!isRejected && canBePromulgated && bothChambersPresent);
      if (code === 'DECAPP') return isProm && !isAppDirecte && !isSansEcheancier;
      if (code === 'AN-APPLI') return isProm && !isAppDirecte && !isSansEcheancier;
      if (code === 'SN1' && !actesCodes.has('SN1')) return !isRejected && hasANSteps && !hasSNSteps && !isLectureUnique;
      if (code === 'AN1' && !actesCodes.has('AN1')) return !isRejected && hasSNSteps && !hasANSteps;
      return actesCodes.has(code);
    })
    .sort((a, b) => {
      const da = milestoneDateMap.get(a)?.getTime() ?? (1e15 + STEP_CONFIG[a].priority);
      const db = milestoneDateMap.get(b)?.getTime() ?? (1e15 + STEP_CONFIG[b].priority);
      return da - db;
    })
    .map(code => ({
      code,
      date: milestoneDateMap.get(code)?.toISOString().slice(0, 10) ?? null,
      done: (code === 'AN-APPLI' && (isAppDirecte || isAppAppliquee)) ? true : actesCodes.has(code),
    }));
  etapes.unshift({ code: 'DEPOT', date: dossier.date_depot?.slice(0, 10) ?? null, done: true });

  return { etapes, milestoneDateMap, decappLastDate, dateJO, isAppDirecte, isAppAppliquee, isSansEcheancier };
}
