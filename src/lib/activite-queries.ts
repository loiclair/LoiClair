// Top des parlementaires les plus actifs, pour la newsletter.
// Source : vue matérialisée `activite_elus_mv` (rafraîchie en fin de cron nightly).
// La page /Activite, elle, interroge la vue directement : elle a besoin de toutes
// les colonnes et d'un mapping qui lui est propre.

import { sql } from "@/lib/db"

export type TopActiviteElu = {
  uid: string
  prenom: string
  nom: string
  chambre: "AN" | "SN"
  score: number
  groupeLabel: string | null
}

/** Top 3 élus les plus actifs par chambre (score cumulé depuis le début de la législature).
 *
 *  Les deux lectures lèvent sur erreur au lieu de rendre une liste vide : appelée
 *  uniquement par `buildWeekContext`, cette fonction voyait sinon une panne base se
 *  transformer en newsletter sans classement, indiscernable d'un classement vide. */
export async function getTopActiviteParChambre(): Promise<{ topAN: TopActiviteElu[]; topSN: TopActiviteElu[] }> {
  type Row = { uid: string; prenom: string | null; nom: string | null; groupe: string | null; chambre: string; score: number | null }
  const rows = await sql<Row[]>`
    select uid, prenom, nom, groupe, chambre, score
    from activite_elus_mv
    where score is not null
    order by score desc, uid`

  const groupeUids = [...new Set(rows.map((r) => r.groupe).filter((g): g is string => g !== null))]
  const organesMap = new Map<string, string>()
  if (groupeUids.length > 0) {
    const organes = await sql<{ uid: string; libelle: string | null; libelle_abrege: string | null }[]>`
      select uid, libelle, libelle_abrege from organes where uid = any(${groupeUids})`
    organes.forEach((o) => {
      organesMap.set(o.uid, o.libelle_abrege ?? o.libelle ?? o.uid)
    })
  }

  const toTop3 = (chambre: "AN" | "SN"): TopActiviteElu[] =>
    rows
      .filter((r) => r.chambre === chambre)
      .slice(0, 3)
      .map((r) => ({
        uid: r.uid,
        prenom: r.prenom ?? "",
        nom: r.nom ?? "",
        chambre,
        score: r.score ?? 0,
        groupeLabel: r.groupe ? (organesMap.get(r.groupe) ?? null) : null,
      }))

  return { topAN: toTop3("AN"), topSN: toTop3("SN") }
}
