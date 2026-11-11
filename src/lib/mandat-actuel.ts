// Le début du mandat d'un élu dans sa chambre actuelle, lu dans
// `acteurs.periodes_mandat_assemblee`. Pour un élu en exercice, la colonne ne porte que
// les périodes de sa chambre actuelle encore ouvertes au début de la fenêtre suivie
// (`import_acteurs_organes_cloud.py`) : la plus ancienne est donc le début de ce mandat.
// Pour un ancien élu, elle mêle les deux chambres, et le premier début n'est plus celui
// d'un mandat actuel : l'appelant ne la passe que pour un élu en exercice.
//
// Lue par la fiche de l'élu (borne de ses compteurs, ce qu'elle cache de son ancien
// mandat, D-239) et par l'outil MCP `votes_elu`, pour qu'ils suivent la même règle.

/** Premier début des périodes (« YYYY-MM-DD »), ou `null` sans période datée. */
export function premierDebutPeriode(periodes: unknown): string | null {
  if (!Array.isArray(periodes)) return null;
  return (
    (periodes as ({ debut?: string | null } | null)[])
      .map((p) => p?.debut?.slice(0, 10))
      .filter((d): d is string => !!d)
      .sort()[0] ?? null
  );
}
