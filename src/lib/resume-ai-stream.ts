// Encodage des résumés IA vers le client, partagé par /api/resume-loi et
// /api/resume-debats.

import { createUIMessageStream, createUIMessageStreamResponse } from 'ai';

// Réponse portant un résumé complet, servi d'un bloc.
// Les deux chemins passent par ici : le cache, et la génération live depuis que
// `generateObject` a remplacé le streaming (l'objet n'existe qu'une fois validé
// contre son schéma, il n'y a plus rien à streamer). `useCompletion` côté client
// est en streamProtocol 'data' : le corps doit donc parler ce protocole, même
// quand tout arrive en un seul morceau.
export function cachedTextResponse(text: string): Response {
  const stream = createUIMessageStream({
    execute({ writer }) {
      writer.write({ type: 'text-start', id: 'cached' });
      writer.write({ type: 'text-delta', id: 'cached', delta: text });
      writer.write({ type: 'text-end', id: 'cached' });
    },
  });
  return createUIMessageStreamResponse({ stream });
}
