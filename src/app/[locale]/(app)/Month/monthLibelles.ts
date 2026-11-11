// Valeurs brutes de la base que le fil `/Month` affiche (type de scrutin, majorité
// requise, statut de conclusion), vers la clé de leur libellé dans le namespace
// `month`. Le serveur (`page.tsx`, `enAnglais`) et la carte (`MonthFeedClient`) s'en
// servent sur /en ; en français, la valeur brute s'affiche telle quelle.
//
// Les tables couvrent les valeurs relevées en base le 2026-10-28. Une valeur
// absente sort brute : un libellé français vaut mieux qu'un libellé deviné.
// Le statut brut reste la clé des couleurs (`getStatusBadgeClass`) : seule son
// étiquette passe par ici, jamais la valeur gardée dans l'événement.

/** `scrutins.type_vote_libelle` → `month.typeVote.*`. */
export const TYPE_VOTE_CLE: Record<string, string> = {
  'scrutin public ordinaire': 'ordinaire',
  'scrutin public': 'public',
  'scrutin public solennel': 'solennel',
  'motion de censure': 'motionCensure',
};

/** `scrutins.type_majorite` → `month.majorite.*`. */
export const MAJORITE_CLE: Record<string, string> = {
  'Majorité absolue des suffrages exprimés': 'absolue',
  'Majorité requise pour une motion de censure': 'motionCensure',
};

// Les deux accords du participe coexistent en base (« adopté », « adoptée ») selon
// le texte, d'où une entrée par forme. Clés en minuscules : « Adopté » vient de la
// normalisation des scrutins dans `page.tsx`, « adopté » des actes.
const STATUT_CLE: Record<string, string> = {
  'adopté': 'adopte',
  'adoptée': 'adopte',
  'modifié': 'modifie',
  'modifiée': 'modifie',
  'adopté sans modification': 'adopteSansModif',
  'adoptée sans modification': 'adopteSansModif',
  'adopté avec modifications': 'adopteAvecModif',
  'adoptée avec modifications': 'adopteAvecModif',
  "adopté, dans les conditions prévues à l'article 45, alinéa 3, de la constitution": 'adopteArt45',
  "adoptée, dans les conditions prévues à l'article 45, alinéa 3, de la constitution": 'adopteArt45',
  'rejeté': 'rejete',
  'rejetée': 'rejete',
  'motion adoptée': 'motionAdoptee',
  'motion rejetée': 'motionRejetee',
  'accord': 'accord',
  'désaccord': 'desaccord',
  "considérée comme définitive en application de l'article 151-7 du règlement": 'definitif1517',
  'rejet du texte par la commission préalable': 'rejetCommission',
  "considéré comme adopté par l'assemblée nationale en application de l'article 49, alinéa 3 de la constitution": 'adopte493',
  "considéré comme rejeté par l'assemblée nationale en application de l'article 49, alinéa 3 de la constitution": 'rejete493',
};

/** Clé `month.statut.*` d'un statut de conclusion brut, `undefined` s'il est inconnu. */
export function cleStatut(statut: string): string | undefined {
  return STATUT_CLE[statut.trim().toLowerCase()];
}
