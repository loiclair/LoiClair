// Dénomination d'un texte (`textes.denomination` : « Proposition de loi »,
// « Loi n° 2026-992 », « Tome II »…) rendue dans la langue de la page, numéro
// gardé. Les libellés vivent dans le namespace `denomination` ; `t` est la fonction
// de traduction de ce namespace. Appelée par le fil `/Month` sur /en, et par la fiche
// dossier (`resume-ia/page.tsx`) dans les deux langues, à la lecture des textes.
//
// Les motifs couvrent les formes relevées en base le 2026-10-28 (une trentaine,
// numéros mis à part). Une dénomination inconnue sort telle quelle : mieux vaut du
// français qu'un libellé deviné.

type T = (cle: string, valeurs?: { num: string }) => string;

/** Motif de la dénomination brute, clé de son libellé, et groupe qui porte le
 *  numéro le cas échéant. L'ordre compte : « Annexe Texte comparatif … » avant
 *  « Annexe … ». */
const MOTIFS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Proposition de loi$/, 'propositionLoi'],
  [/^Projet de loi$/, 'projetLoi'],
  [/^Proposition de résolution$/, 'propositionResolution'],
  [/^Rapport$/, 'rapport'],
  [/^Rapport d'information$/, 'rapportInformation'],
  [/^Rapport général$/, 'rapportGeneral'],
  [/^Avis$/, 'avis'],
  [/^Résolution$/, 'resolution'],
  [/^Motion$/, 'motion'],
  [/^Déclaration$/, 'declaration'],
  [/^Lettre$/, 'lettre'],
  [/^Allocution$/, 'allocution'],
  [/^Loi n°\s*(\S+)$/, 'loi'],
  [/^Décret n°\s*(\S+)$/, 'decret'],
  [/^Version consolidée\s*\S\s*Loi n°\s*(\S+)$/, 'loiConsolidee'],
  [/^(?:Tome|Volume) (\S+)$/, 'tome'],
  [/^Annexe (?:Texte comparatif )?COMPA$/, 'texteComparatif'],
  [/^Annexe Texte comparatif (\S+)$/, 'texteComparatifNum'],
  [/^Annexe (\S+)$/, 'annexe'],
];

export function traduireDenomination(denomination: string | null, t: T): string | null {
  if (!denomination) return denomination;
  const brute = denomination.trim();
  for (const [motif, cle] of MOTIFS) {
    const m = brute.match(motif);
    if (m) return m[1] ? t(cle, { num: m[1] }) : t(cle);
  }
  return denomination;
}
