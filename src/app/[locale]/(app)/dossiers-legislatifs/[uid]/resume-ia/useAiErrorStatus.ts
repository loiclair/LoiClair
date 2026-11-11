'use client';

// Traduit le statut HTTP des routes de résumé IA en un état d'erreur affichable.
// Partagé par la carte du résumé de loi (ResumeIAClient) et celle des débats
// (ArgumentsPourContre), qui passent `customFetch` à `useCompletion`.
//
// Chaque carte garde son propre état, heure de reprise comprise : le message de
// limite horaire s'affiche là où le résumé manque, et n'affirme donc rien sur
// les autres sections de la page ni sur le reste du site. L'attente imposée par
// le fournisseur (`'busy'`) suit la même règle : une autre carte, ou la même
// page rechargée, refait sa demande et affiche son propre compte à rebours.

import { useCallback, useState } from 'react';

const RATE_LIMIT_RESET_HEADER = 'x-ratelimit-reset';
const RETRY_AFTER_HEADER = 'retry-after';

export type AiErrorKind = 'rate-limit' | 'busy' | 'timeout' | 'generic' | 'quota' | 'unavailable' | null;

export function useAiErrorStatus() {
  const [errorKind, setErrorKind] = useState<AiErrorKind>(null);
  const [rateLimitResetMs, setRateLimitResetMs] = useState<number | null>(null);
  const [busyUntilMs, setBusyUntilMs] = useState<number | null>(null);

  const customFetch: typeof globalThis.fetch = useCallback(async (input, init) => {
    setErrorKind(null);
    let res: Response;
    try {
      res = await globalThis.fetch(input, init);
    } catch (e) {
      // Un abandon volontaire n'est pas une panne. `stop()` avorte le fetch quand
      // le lecteur choisit un autre texte ; sans cette garde, le rejet du fetch
      // abandonné arrive après le démarrage de la génération suivante et affiche
      // « Le résumé n'a pas pu être généré » par-dessus elle. Le SDK, lui, ignore
      // déjà l'AbortError (callCompletionApi n'appelle pas onError dans ce cas).
      // Rien n'est perdu côté serveur : la route ne lit pas le signal d'abandon
      // de la requête, elle va jusqu'au bout et écrit le cache.
      //
      // La reconnaissance passe par le signal, jamais par le nom de l'exception.
      // Le signal est celui de l'AbortController du hook, que `callCompletionApi`
      // passe à chaque appel : `aborted` dit donc avec certitude que l'abandon
      // vient de nous. Tester aussi `e.name === 'AbortError'` avalerait en plus
      // les abandons venus d'ailleurs (Échap dans Firefox, coupure réseau), qui
      // eux doivent rester une panne affichée : sans erreur ni squelette, le
      // cadre doré resterait vide et sans bouton pour relancer.
      if (init?.signal?.aborted) throw e;
      setErrorKind('generic');
      throw e;
    }
    if (res.status === 429) {
      const resetHeader = res.headers.get(RATE_LIMIT_RESET_HEADER);
      const resetMs = resetHeader ? Number(resetHeader) : NaN;
      const retryAfterHeader = res.headers.get(RETRY_AFTER_HEADER);
      const retryAfterS = retryAfterHeader ? Number(retryAfterHeader) : NaN;
      // Deux 429 distinctes, reconnues à leur en-tête. `X-RateLimit-Reset` :
      // notre limite horaire par lecteur (`enforceAiRateLimit`), annoncée avec
      // son heure de reprise. `Retry-After` seul : la limite par minute du
      // fournisseur, que les routes relaient en `ai_busy`, attendue avec un
      // compte à rebours. Une 429 sans l'un ni l'autre (proxy, pare-feu de la
      // plateforme) n'a rien à annoncer et retombe sur l'erreur générique, qui
      // offre au moins un bouton Réessayer.
      if (Number.isFinite(resetMs)) {
        setRateLimitResetMs(resetMs);
        setErrorKind('rate-limit');
      } else if (Number.isFinite(retryAfterS) && retryAfterS > 0) {
        setBusyUntilMs(Date.now() + retryAfterS * 1000);
        setErrorKind('busy');
      } else {
        setErrorKind('generic');
      }
    } else if (res.status === 503) {
      setErrorKind('timeout');
    } else if (res.status === 403) {
      // Crédits IA épuisés (estQuotaEpuise côté route). Depuis que la génération ne streame plus, l'erreur
      // arrive avant le premier octet : c'est le statut HTTP qui la porte, plus
      // un code glissé dans le flux.
      setErrorKind('quota');
    } else if (res.status === 400 || res.status === 404) {
      // Refus définitif. Les deux routes ne rendent 400 et 404 que pour une
      // demande qui échouera pareil à chaque essai : texte sans contenu, dossier
      // ou texte introuvable, aucune intervention de fond. Un bouton Réessayer
      // ne ferait que consommer la limite horaire du lecteur.
      setErrorKind('unavailable');
    } else if (!res.ok) {
      setErrorKind('generic');
    }
    return res;
  }, []);

  // Erreur remontée par useCompletion({ onError }).
  const handleCompletionError = useCallback(() => {
    // Le SDK lève sur toute réponse non OK et appelle ce rappel juste après que
    // customFetch a posé l'état tiré du statut (429, 503, 403, 400, 404). Cet état-là est
    // gardé : l'écraser par 'generic' affichait « Le résumé n'a pas pu être
    // généré » et un bouton Réessayer à un lecteur qui avait simplement atteint
    // son quota horaire. Seule une erreur que customFetch n'a pas qualifiée
    // (corps illisible sur une réponse 200) devient générique.
    setErrorKind(prev => prev ?? 'generic');
  }, []);

  // Efface l'erreur hors de tout appel réseau. `customFetch` ne la remet à zéro
  // qu'au départ d'une requête : un chemin qui n'en lance pas (résumé déjà en
  // cache côté client) laisserait sinon l'erreur du texte précédent masquer un
  // contenu pourtant disponible.
  const resetErrorKind = useCallback(() => setErrorKind(null), []);

  return {
    customFetch,
    errorKind,
    rateLimitResetMs,
    busyUntilMs,
    handleCompletionError,
    resetErrorKind,
  };
}

/** Heure de fin de la limite horaire, affichée dans le message de la carte. */
export function formatRateLimitResetTime(resetMs: number | null, locale: string): string {
  if (!resetMs) return '';
  return new Date(resetMs).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
