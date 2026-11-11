// Reconnaître le « groupe » des non-inscrits parmi les organes. Ce n'est qu'une
// réunion administrative d'élus sans groupe, sans ligne commune (D-313) : les pages
// l'écartent des décomptes et des classements de groupes, ou le rangent à part.
//
// Le sigle `libelle_abrege` vaut « NI » dans les deux chambres : un organe par
// législature à l'Assemblée (PO840056 pour la 17ᵉ), PO77708 au Sénat. Une seule
// définition, pour que deux pages ne puissent pas en avoir deux. Les imports Python
// ont la leur (`organes_non_inscrits` d'`import_scrutins_cloud.py`,
// `ORGANE_NON_INSCRITS_SENAT` de `sync_senat.py`).

/** Vrai si le sigle d'un organe (`organes.libelle_abrege`) est celui des non-inscrits. */
export function estNonInscrits(sigle: string | null | undefined): boolean {
  return sigle === 'NI';
}
