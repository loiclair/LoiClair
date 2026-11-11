// Compteurs réels des parlementaires en exercice (lus depuis acteurs).
// Server-only : importe le client Postgres. Pour les constantes légales utilisables
// côté client, voir `parliament-constants.ts`.

import { sql } from "@/lib/db";
import { LEGAL_AN, LEGAL_SN, type ParliamentCounts } from "@/lib/parliament-constants";

export { LEGAL_AN, LEGAL_SN, LEGAL_TOTAL, type ParliamentCounts } from "@/lib/parliament-constants";

/**
 * Renvoie les comptes réels (depuis acteurs) et logge un warning serveur
 * si on est sous le nombre légal. Les pages ne tombent jamais sur des
 * placeholders vides : si la requête échoue, on retombe sur les chiffres légaux.
 */
export async function getParliamentCounts(): Promise<ParliamentCounts> {
  // Chaque compte retombe seul sur son chiffre légal : une panne sur l'un ne fait
  // pas perdre l'autre.
  const [an, sn] = await Promise.all([
    sql<{ n: number }[]>`select count(*) as n from acteurs where est_depute_actuel = true`
      .then((r) => r[0].n, () => LEGAL_AN),
    sql<{ n: number }[]>`select count(*) as n from acteurs where est_senateur_actuel = true`
      .then((r) => r[0].n, () => LEGAL_SN),
  ]);

  if (an < LEGAL_AN || sn < LEGAL_SN) {
    console.warn(
      `[parliament-counts] Effectifs sous le nombre légal : AN=${an}/${LEGAL_AN}, SN=${sn}/${LEGAL_SN}. ` +
      `Vérifier l'import de la table acteurs (un parlementaire en exercice manque).`,
    );
  }

  return { an, sn, total: an + sn };
}
