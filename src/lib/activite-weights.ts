// Source unique des poids du score d'activité (v6 : les deux compteurs de rapport
// séparés, le vote et la présence en commission alignés à 1,25). Doit rester
// strictement aligné avec la dernière migration qui reconstruit `activite_elus_mv`
// (`2026-10-25_activite_rangs_par_fonction.sql` ; poids fixés par
// `2026-09-15_activite_poids_vote_commission.sql`) : si un poids change ici, il
// doit changer dans la SQL et inversement.

export type MetricKey =
  | 'cpPart'
  | 'cpDoss'
  | 'cpCosign'
  | 'cpRapp'
  | 'cpRappCtrl'
  | 'cpAmendAuteur'
  | 'cpAmendCosign'
  | 'cpQuestO'
  | 'cpQuestE'
  | 'cpPrisesParole'
  | 'cpCommPres';

export const ACTIVITE_WEIGHTS: Record<MetricKey, number> = {
  cpPart: 1.25,
  cpDoss: 1.25,
  cpCosign: 0.3,
  cpRapp: 1.75,
  cpRappCtrl: 1.75,
  cpAmendAuteur: 0.75,
  cpAmendCosign: 0.2,
  cpQuestO: 0.5,
  cpQuestE: 0.25,
  cpPrisesParole: 0.75,
  cpCommPres: 1.25,
};

// Date de la dernière modification de la méthode, affichée par la section
// Méthodologie de /Activite. Elle se change dans le même geste qu'un poids
// ci-dessus ou que la migration jumelle : une date figée pendant que le calcul
// bouge est un mensonge sur la page dont le sujet est la fiabilité. Elle ne se
// dérive pas du journal des corrections, qui recense des erreurs de données et
// non des changements de méthode : les deux ensembles ne coïncident pas.
export const ACTIVITE_METHODE_MAJ = '2026-11-05';

export type FonctionKey = 'legiferer' | 'deliberer' | 'controler' | 'commission';

// total = somme des poids dans la fonction. Les 4 totaux somment à 10 pts,
// donc total × 10 = pourcentage de contribution au score final 0-100.
//
// Les quatre missions du mandat ne pèsent pas autant : chaque mesure porte le poids de
// l'investissement qu'elle demande, et le total d'une fonction n'est que leur somme.
// Trois conséquences voulues, à ne pas « corriger » :
//   - Délibérer vaut 20 % et Examiner les textes 30 %. Un vote se délègue (un tiers des
//     suffrages d'un scrutin solennel à l'Assemblée), la présence en commission coûte des
//     heures chaque semaine et ne se délègue pas. Les deux se rejoignent à 1,25 plutôt que
//     de s'inverser, le vote gardant une importance symbolique que son coût seul ne dit
//     pas.
//   - « dossier initié » ne vaut que 12,5 % du score.
//   - les deux lignes de rapport en valent 35 % à elles deux. C'est le prix de la
//     séparation : pour qu'un élu qui n'a qu'un type de rapport garde le poids qu'il
//     avait quand une seule ligne les mélangeait, chaque ligne doit valoir à peu près
//     autant que cette ligne unique. Être nommé rapporteur ne dépend pas que de l'élu,
//     mais le score mesure l'importance de l'acte et ce qu'il demande, pas ce que l'élu
//     contrôle : le biais se dit dans les limites de la méthodologie, il ne se pondère
//     pas.
export const ACTIVITE_FUNCTIONS: Record<FonctionKey, { total: number; percent: number; metrics: MetricKey[] }> = {
  legiferer:  { total: 2.5, percent: 25, metrics: ['cpDoss', 'cpAmendAuteur', 'cpCosign', 'cpAmendCosign'] },
  deliberer:  { total: 2.0, percent: 20, metrics: ['cpPart', 'cpPrisesParole'] },
  controler:  { total: 2.5, percent: 25, metrics: ['cpRappCtrl', 'cpQuestO', 'cpQuestE'] },
  commission: { total: 3.0, percent: 30, metrics: ['cpRapp', 'cpCommPres'] },
};

/**
 * Le suffixe de colonne de chaque mesure dans `activite_elus_mv` : `cp_<suffixe>` pour
 * le centile, `rang_<suffixe>` pour le rang. C'est la seule correspondance entre les noms
 * de la vue et `MetricKey` : la fiche élu, `/Activite` et le MCP passent tous par
 * `mesuresDeLigne`, pour qu'une mesure ajoutée ne puisse pas manquer à l'un d'eux.
 */
const SUFFIXE_COLONNE: Record<MetricKey, string> = {
  cpPart: 'part',
  cpDoss: 'doss',
  cpCosign: 'cosign',
  cpRapp: 'rapp',
  cpRappCtrl: 'rapp_ctrl',
  cpAmendAuteur: 'amend_auteur',
  cpAmendCosign: 'amend_cosign',
  cpQuestO: 'quest_o',
  cpQuestE: 'quest_e',
  cpPrisesParole: 'prises_parole',
  cpCommPres: 'comm_pres',
};

/**
 * Lit sur une ligne de `activite_elus_mv` les onze centiles (`cp_*`) ou les onze rangs
 * (`rang_*`). Une colonne absente rend null : la vue se lit en `select('*')` pour qu'un
 * code déployé avant sa migration ne casse pas, et la mesure s'affiche alors sans valeur.
 */
export function mesuresDeLigne(ligne: object, prefixe: 'cp' | 'rang'): Record<MetricKey, number | null> {
  const l = ligne as Record<string, number | null | undefined>;
  return Object.fromEntries(
    (Object.keys(SUFFIXE_COLONNE) as MetricKey[]).map((m) => [m, l[`${prefixe}_${SUFFIXE_COLONNE[m]}`] ?? null]),
  ) as Record<MetricKey, number | null>;
}

/**
 * Lit sur une ligne de `activite_elus_mv` le sous-score (`score_<fonction>`) ou le rang
 * (`rang_<fonction>`) des quatre fonctions. La vue les calcule elle-même, dans la
 * convention `RANK()` de `rang_chambre` (D-029) ; null hors classement, ou pour une
 * colonne absente comme dans `mesuresDeLigne`.
 */
export function fonctionsDeLigne(ligne: object, prefixe: 'score' | 'rang'): Record<FonctionKey, number | null> {
  const l = ligne as Record<string, number | null | undefined>;
  return Object.fromEntries(
    (Object.keys(ACTIVITE_FUNCTIONS) as FonctionKey[]).map((f) => [f, l[`${prefixe}_${f}`] ?? null]),
  ) as Record<FonctionKey, number | null>;
}

/**
 * Poids affiché à côté d'une composante (« × 0,3 » en français, « × 0.3 » en
 * anglais) : au plus deux décimales, sans zéro final. Affichage seul : ne touche
 * ni aux poids ni à `ACTIVITE_METHODE_MAJ`. Appelé par `ActiviteTable` et
 * `ActiviteFonctionsEncart`.
 */
export function formatPoids(w: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(w);
}

/** Score d'activité affiché, toujours à une décimale (« 90,2 », « 90.2 »).
 *  Appelé par `ActiviteTable` et `ActiviteSearch`. */
export function formatScore(score: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(score);
}
