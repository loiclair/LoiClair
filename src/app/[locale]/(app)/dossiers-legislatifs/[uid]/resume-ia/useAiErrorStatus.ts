'use client';

// Traduit le statut HTTP des routes de résumé IA en un état d'erreur affichable.
// Partagé par la carte du résumé de loi (ResumeIAClient) et celle des débats
// (ArgumentsPourContre), qui passent `customFetch` à `useCompletion`. Ce même
// `customFetch` rend au navigateur sa vraie signature et n'envoie une demande de
// génération qu'après le délai de lib/resume-ia-delai.
//
// Chaque carte garde son propre état, heure de reprise comprise : le message de
// limite horaire s'affiche là où le résumé manque, et n'affirme donc rien sur
// les autres sections de la page ni sur le reste du site. L'attente imposée par
// le fournisseur (`'busy'`) suit la même règle : une autre carte, ou la même
// page rechargée, refait sa demande et affiche son propre compte à rebours.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DELAI_AVANT_GENERATION_MS, ENTETE_CACHE_SEUL } from '@/lib/resume-ia-delai';

const RATE_LIMIT_RESET_HEADER = 'x-ratelimit-reset';
const RETRY_AFTER_HEADER = 'retry-after';

export type AiErrorKind = 'rate-limit' | 'busy' | 'timeout' | 'generic' | 'quota' | 'unavailable' | 'challenge' | null;

/**
 * En-têtes de la demande, sans le `user-agent` que pose le SDK IA.
 *
 * `useCompletion` envoie `ai-sdk/<version> <navigator.userAgent en minuscules>`.
 * Chrome ignore cet en-tête dans un `fetch`, mais Safari et les navigateurs
 * WebKit (DuckDuckGo, sur Mac comme sur iPhone) l'envoient. Le cookie
 * `cf_clearance` que Cloudflare a remis sur la fiche ne vaut que pour la
 * signature qui l'a obtenu : la route de résumé, contrôlée (D-366), voyait un
 * inconnu et répondait 403. Constaté dans les événements Cloudflare du
 * 2026-11-19. Sans l'en-tête, le navigateur remet sa propre signature.
 */
function sansSignatureSdk(headers: HeadersInit | undefined): Headers {
  const h = new Headers(headers);
  h.delete('user-agent');
  return h;
}

/**
 * Attend `ms` millisecondes de page visible, avant de demander une génération
 * (voir lib/resume-ia-delai). Un onglet caché suspend le compte, qui repart de
 * zéro au retour. Rejette avec la raison du premier signal abandonné : la
 * demande (autre texte choisi), comme le ferait le `fetch` lui-même, ou la carte
 * démontée (lecteur parti par une navigation interne, que `useCompletion`
 * n'abandonne pas).
 */
function attendrePageVisible(ms: number, signaux: (AbortSignal | null | undefined)[]): Promise<void> {
  return new Promise((resolve, reject) => {
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const nettoyer = () => {
      clearTimeout(minuteur);
      document.removeEventListener('visibilitychange', surVisibilite);
      for (const s of signaux) s?.removeEventListener('abort', surAbandon);
    };
    const surAbandon = () => {
      nettoyer();
      const abandonne = signaux.find(s => s?.aborted);
      reject(abandonne?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const surVisibilite = () => {
      clearTimeout(minuteur);
      if (document.visibilityState === 'visible') {
        minuteur = setTimeout(() => { nettoyer(); resolve(); }, ms);
      }
    };
    if (signaux.some(s => s?.aborted)) { surAbandon(); return; }
    for (const s of signaux) s?.addEventListener('abort', surAbandon);
    document.addEventListener('visibilitychange', surVisibilite);
    surVisibilite();
  });
}

export function useAiErrorStatus() {
  const [errorKind, setErrorKind] = useState<AiErrorKind>(null);
  const [rateLimitResetMs, setRateLimitResetMs] = useState<number | null>(null);
  const [busyUntilMs, setBusyUntilMs] = useState<number | null>(null);

  // Abandonné au démontage de la carte : `useCompletion` n'abandonne pas sa
  // demande quand le composant disparaît, et une génération en attente du délai
  // partirait sinon pour un lecteur déjà sur une autre page.
  const demontage = useRef<AbortController | null>(null);
  useEffect(() => {
    const c = new AbortController();
    demontage.current = c;
    return () => c.abort();
  }, []);

  const customFetch: typeof globalThis.fetch = useCallback(async (input, init) => {
    setErrorKind(null);
    const headers = sansSignatureSdk(init?.headers);
    let res: Response;
    try {
      // Cache d'abord ; sans cache (204), la génération n'est demandée qu'après le
      // délai, page visible. Le 204 ne sort jamais d'ici : `useCompletion` ne voit
      // que la seconde réponse.
      const cacheSeul = new Headers(headers);
      cacheSeul.set(ENTETE_CACHE_SEUL, '1');
      res = await globalThis.fetch(input, { ...init, headers: cacheSeul });
      if (res.status === 204) {
        await attendrePageVisible(DELAI_AVANT_GENERATION_MS, [init?.signal, demontage.current?.signal]);
        res = await globalThis.fetch(input, { ...init, headers });
      }
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
      if (init?.signal?.aborted || demontage.current?.signal.aborted) throw e;
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
    } else if (res.status === 403 && res.headers.get('cf-mitigated') === 'challenge') {
      // Contrôle Cloudflare de la route (D-366) : le laissez-passer de la fiche a
      // expiré ou ne correspond plus. Une demande en tâche de fond ne peut pas
      // afficher le contrôle ; recharger la page le refait passer.
      setErrorKind('challenge');
    } else if (res.status === 403) {
      // Crédits IA épuisés (estQuotaEpuise côté route) ou plafond du jour atteint :
      // les deux routes rendent alors 403 avec le code `aiQuotaExhausted`, avant
      // le premier octet. Le code est lu, pas le seul statut : un autre 403 (une
      // règle Cloudflare qui bloque, depuis que D-366 place Cloudflare devant ces
      // routes) annoncerait sinon à tort un service épuisé, sans bouton. Il
      // retombe sur l'erreur générique, qui offre Réessayer. Le corps est lu sur
      // une copie : `useCompletion` relit l'original pour lever son erreur.
      const corps = await res.clone().json().catch(() => null) as { error?: unknown } | null;
      setErrorKind(corps?.error === 'aiQuotaExhausted' ? 'quota' : 'generic');
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
