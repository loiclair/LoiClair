// Dit si la base refuse les écritures de ce serveur, pour que les routes de résumé
// IA (`/api/resume-loi`, `/api/resume-debats`) ne paient pas une génération
// qu'elles ne pourraient pas ranger. Serveur uniquement.
//
// L'app d'essai lit la production avec le compte `essai_lecture`, en
// `default_transaction_read_only` (D-336) : chaque résumé généré y était jeté à
// l'écriture, et la visite suivante le repayait (LOI-92, 10 générations perdues
// le 2026-11-23). La production et les serveurs locaux, qui écrivent, ne sont
// pas concernés.

import { sql } from '@/lib/db';

let reponse: Promise<boolean> | null = null;

/**
 * Vrai quand la session Postgres de ce processus est en lecture seule. Lu une
 * fois par processus : le réglage tient au compte, pas à la requête. Une lecture
 * en échec rend faux et sera retentée : mieux vaut une génération perdue que
 * des résumés bloqués en production sur une panne passagère.
 */
export function baseEnLectureSeule(): Promise<boolean> {
  if (!reponse) {
    reponse = sql<{ ro: string }[]>`select current_setting('transaction_read_only') as ro`
      .then(([ligne]) => ligne?.ro === 'on')
      .catch((e: unknown) => {
        reponse = null;
        console.error('[base-lecture-seule] lecture impossible :', e);
        return false;
      });
  }
  return reponse;
}
