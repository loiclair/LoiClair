// Formes des uid qu'une fiche accepte dans son adresse, testées avant toute requête.
//
// Appelé en tête de la page et de `generateMetadata` des fiches élu, dossier et vote.
// Une adresse hors motif rend 404 avant toute requête sur l'uid (constaté le
// 2026-10-28 : seul l'appel `sync_etat` du layout part encore en base). Sans cette
// garde, un uid forgé déclencherait toutes les lectures de la fiche. Le 404
// lui-même peut encore être rangé par l'ISR : la garde ne l'empêche pas, non mesuré.
//
// Un refus ne se journalise pas : un robot qui essaie des variantes remplirait le
// journal. Le prix est qu'une forme d'uid nouvelle rendrait 404 en silence, d'où des
// motifs relevés sur la base entière et laissés ouverts là où une variante est plausible.

// Acteurs : PA suivi de 3 à 6 chiffres sur les 3 177 lignes en base au 2026-10-28.
// La borne large est celle de `api/comparer-elus`.
const ELU_UID = /^PA\d{1,10}$/;

// Dossiers, au 2026-10-28 : 3 375 `DLR5L<législature>N<numéro>` (Assemblée) et
// 533 `DSN<RAP|RES><année>N<4 chiffres>` (Sénat). Les trois lettres du Sénat restent
// ouvertes : une catégorie nouvelle ne doit pas rendre 404 à l'import suivant.
const DOSSIER_UID = /^(?:DLR\dL\d{1,2}N\d{1,7}|DSN[A-Z]{3}\d{4}N\d{1,5})$/;

export function estUidElu(uid: string): boolean {
  return ELU_UID.test(uid);
}

export function estUidDossier(uid: string): boolean {
  return DOSSIER_UID.test(uid);
}

// Séances, au 2026-10-28 : 476 `AN:CRSANR5L17S<année><O|E><n>N<numéro>` et 348
// `SEN:d<AAAAMMJJ>`, transposés en `an-…` et `sen-…` par `seanceVersSlug`.
const SEANCE_SLUG = /^(?:an-CRSANR\dL\d{1,2}S\d{4}[A-Z]\d{1,2}N\d{1,4}|sen-d\d{8})$/;

export function estSlugSeance(slug: string): boolean {
  return SEANCE_SLUG.test(slug);
}

// Scrutins : `VTANR5L<législature>V<numéro>` (Assemblée) et `VTSNR<session>V<numéro>`
// (Sénat). Motif repris de `api/scrutin-votes`, qui le teste aussi, laissé large après
// le préfixe de chambre. Appelé par la page d'un vote et par cette route.
const SCRUTIN_UID = /^VT(AN|SN)[A-Z0-9]{1,40}$/;

export function estUidScrutin(uid: string): boolean {
  return SCRUTIN_UID.test(uid);
}

// Amendements : `AMANR5L…` (Assemblée) et `SN` suivi de `amd.id` du dump ameli (Sénat).
// Appelé par la page d'un amendement, sa route et `api/ce-qui-me-concerne/element`.
const AMENDEMENT_UID = /^(AMANR[A-Z0-9]{10,60}|SN\d{1,12})$/;

export function estUidAmendement(uid: string): boolean {
  return AMENDEMENT_UID.test(uid);
}
