/**
 * Reprise d'un appel IA après échec, et rejet d'une extraction coupée avant sa fin
 * (`texteNonTronque`), l'échec qu'aucune reprise ne répare.
 *
 * Trois pipelines appellent le modèle en plusieurs morceaux : le résumé de loi, le
 * résumé de débats et la newsletter. Seule la newsletter avait une reprise ; les
 * deux autres faisaient un `Promise.all` nu, où un seul 429 ou une seule coupure
 * réseau sur un morceau jetait le travail de tous les autres. Sur le PLF 2026,
 * c'est jusqu'à une minute d'appels perdue.
 *
 * Ce qui échoue après reprises fait échouer la requête entière, volontairement :
 * continuer avec les morceaux réussis produirait un résumé amputé, mis en cache
 * et servi comme complet, que rien ne distinguerait d'un bon.
 *
 * DEUX PRÉCAUTIONS, sans lesquelles cette fonction fait plus de mal que de bien.
 *
 * 1. Chaque appel enveloppé DOIT passer `maxRetries: 0`. Le SDK rejoue déjà deux
 *    fois par défaut : sans ça, les deux étages se multiplient au lieu de
 *    s'additionner, et un morceau coûte jusqu'à neuf requêtes au lieu de trois.
 *    Sur un lot de huit morceaux en parallèle, une vague de 429 en produirait
 *    soixante-douze, soit exactement l'amplification que le plafond de huit
 *    appels simultanés cherche à éviter.
 * 2. Une erreur non rejouable ne se rejoue pas. Des crédits épuisés
 *    (`estQuotaEpuise`) ou une requête invalide (400) rendront la même erreur au second essai : les
 *    reprises ne feraient que retarder le message affiché au lecteur et gonfler
 *    le compteur d'appels.
 */

import { APICallError, type FinishReason } from 'ai';

/**
 * Crédits du fournisseur épuisés. Les deux routes qui génèrent à la visite
 * renvoient alors un 403 au client, qui affiche un message dédié plutôt qu'une
 * panne générique.
 *
 * Mammouth est un proxy LiteLLM, qui tient les crédits du compte comme un plafond
 * de dépense. Observé le 2026-10-12 avec une clé de test plafonnée à 0,0001 $ :
 * `429` et `{"error":{"type":"budget_exceeded","message":"Budget has been exceeded! …"}}`.
 * Le statut seul ne suffit pas, puisqu'un 429 est d'abord une limite de débit
 * (50 requêtes par minute sur la clé), qui elle se rejoue. On lit donc le `type`,
 * le seul champ qui nomme le budget sans ambiguïté, et pas le statut. Le plafond
 * du compte entier (`/user/info`, `max_budget`) n'a pas été franchi pour de vrai :
 * qu'il rende le même `type` qu'un plafond de clé reste une hypothèse. Le 402
 * reste donc reconnu en filet : « paiement requis » ne peut pas se confondre avec
 * une limite de débit, et un épuisement côté compte, jamais observé, pourrait le
 * rendre.
 */
export function estQuotaEpuise(err: unknown): boolean {
  if (!APICallError.isInstance(err)) return false;
  if (err.statusCode === 402) return true;
  try {
    return JSON.parse(err.responseBody ?? '')?.error?.type === 'budget_exceeded';
  } catch {
    return false;
  }
}

/**
 * Limite de débit du fournisseur : le délai d'attente en secondes, ou null si
 * l'erreur est d'une autre nature. Les deux routes qui génèrent à la visite
 * renvoient alors un 429 avec `Retry-After`, et la carte affiche un compte à
 * rebours plutôt qu'une panne.
 *
 * Mesuré le 2026-10-15 avec la clé de test saturée : `429`,
 * `{"error":{"type":"throttling_error", …}}` et l'en-tête `retry-after: 60`.
 * On ne teste pas ce `type` : tout 429 qui n'est pas un budget épuisé est une
 * limite de débit, quel que soit le libellé que LiteLLM lui donne. L'en-tête
 * est borné : 5 s au moins pour que le compte à rebours se lise, 120 s au plus
 * pour qu'une valeur aberrante ne fige pas le bouton. Absent, on compte 60 s,
 * la fenêtre d'une minute de la limite.
 *
 * Les reprises de `avecReprises` jouent quand même avant : la limite est souple,
 * et la mesure montre qu'une reprise à 1 s ou 4 s trouve souvent un trou.
 */
export function delaiLimiteDebit(err: unknown): number | null {
  if (!APICallError.isInstance(err) || err.statusCode !== 429 || estQuotaEpuise(err)) return null;
  const entete = Number(err.responseHeaders?.['retry-after']);
  if (!Number.isFinite(entete) || entete <= 0) return 60;
  return Math.min(120, Math.max(5, Math.ceil(entete)));
}

/** Une erreur que le provider marque comme définitive ne se rejoue pas, un quota épuisé non plus. */
function estRejouable(err: unknown): boolean {
  if (estQuotaEpuise(err)) return false;
  return APICallError.isInstance(err) ? err.isRetryable !== false : true;
}

/** Rejoue `appel` après chacun des `delais` (en millisecondes), puis relance la dernière erreur. */
export async function avecReprises<T>(appel: () => Promise<T>, delais: readonly number[]): Promise<T> {
  let derniereErreur: unknown;
  for (let i = 0; i <= delais.length; i += 1) {
    try {
      return await appel();
    } catch (err) {
      derniereErreur = err;
      if (!estRejouable(err)) throw err;
      if (i < delais.length) await new Promise((r) => setTimeout(r, delais[i]));
    }
  }
  throw derniereErreur;
}

/** Route web : un lecteur attend devant sa page, la reprise doit rester courte. */
export const DELAIS_REPRISE_WEB = [1_000, 4_000] as const;

/** Cron nocturne : personne n'attend, on laisse le temps à un 429 de retomber. */
export const DELAIS_REPRISE_CRON = [5_000, 15_000, 45_000] as const;

/**
 * Texte d'une extraction MAP, ou erreur si le modèle s'est arrêté avant la fin :
 * sur son plafond de jetons (`finishReason` « length ») ou coupé par le filtre de
 * contenu du fournisseur (« content-filter »). Une extraction coupée ne lève rien
 * d'elle-même : elle partirait en cache et nourrirait la synthèse, que rien ne
 * distinguerait d'une bonne. Appelée APRÈS `avecReprises`, jamais dedans : le même
 * plafond couperait au même endroit, une reprise ne ferait que repayer l'appel.
 */
export function texteNonTronque(resultat: { text: string; finishReason: FinishReason }, contexte: string): string {
  if (resultat.finishReason === 'length' || resultat.finishReason === 'content-filter') {
    throw new Error(`Extraction tronquée (${resultat.finishReason}) : ${contexte}`);
  }
  return resultat.text;
}

/**
 * À étaler dans chaque appel enveloppé par `avecReprises`, cf. précaution 1.
 * Constante nommée plutôt que `maxRetries: 0` recopié : un `0` nu se relit comme
 * « pas de reprise du tout », alors qu'il y en a, un étage plus haut.
 */
export const REPRISES_SDK_DESACTIVEES = { maxRetries: 0 } as const;
