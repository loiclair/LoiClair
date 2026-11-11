// Conversion uid de séance ↔ segment d'URL, partagée par l'index des séances, la
// page d'une séance et la fiche d'un élu.
//
// Un uid de séance porte un deux-points (« AN:CRSANR5L17S2026O1N224 », « SEN:d20260416 »),
// qui s'encoderait en « %3A » dans une URL. Le couple chambre + date ne suffit pas à
// identifier une séance (790 séances pour 560 couples), l'uid est donc nécessaire : on le
// transpose en « an-<reste> ». Le reste de l'uid ne contient jamais de tiret (vérifié sur
// les 790 séances) et l'uid n'a jamais plus d'un deux-points, donc la conversion est
// réversible sans ambiguïté.

export function seanceVersSlug(uid: string): string {
  return uid.replace(/^(AN|SEN):/, (_, chambre: string) => `${chambre.toLowerCase()}-`);
}

export function slugVersSeance(slug: string): string {
  return slug.replace(/^(an|sen)-/, (_, chambre: string) => `${chambre.toUpperCase()}:`);
}

// Fragment d'adresse (« #elu-<uid> ») qui restreint la page d'une séance aux
// interventions d'un élu ; la fiche de l'élu le pose sur ses liens. Un fragment plutôt
// qu'un paramètre `?elu=` : la page est `force-static`, le serveur ne verrait pas le
// paramètre, et `useSearchParams` côté client exigerait un Suspense autour du verbatim.
const PREFIXE_ELU = '#elu-';

export function fragmentElu(acteurUid: string): string {
  return PREFIXE_ELU + encodeURIComponent(acteurUid);
}

/** Uid de l'élu porté par `window.location.hash`, ou null. Un fragment mal encodé,
 *  tapé à la main, vaut null plutôt que de faire planter la page. */
export function eluDuFragment(hash: string): string | null {
  if (!hash.startsWith(PREFIXE_ELU)) return null;
  try {
    return decodeURIComponent(hash.slice(PREFIXE_ELU.length)) || null;
  } catch {
    return null;
  }
}
