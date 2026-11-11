/**
 * Point d'entrée unique vers le fournisseur d'IA, pour les routes qui génèrent
 * (résumé de loi, résumé des débats, newsletter). Le script des décisions du
 * Conseil constitutionnel a son propre client, qui vise la même adresse ; celui
 * des fiches courtes des dossiers appelle l'API Anthropic, hors Mammouth.
 *
 * Mammouth (société française) sert les modèles par une API compatible OpenAI
 * Chat Completions. Le modèle lui-même est choisi dans `prompts.ts`
 * (MODEL_FAMILLE_IA), pas ici.
 *
 * `supportsStructuredOutputs` fait partir le schéma en `response_format`
 * `json_schema` strict : le modèle ne peut rendre qu'un objet conforme.
 * Sans lui, le SDK se rabattrait sur un simple `json_object`, sans schéma.
 *
 * Le niveau de raisonnement passe par `providerOptions.mammouth.reasoningEffort`,
 * seule voie qui arrive dans la requête sous la forme `reasoning_effort`.
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export const IA_BASE_URL = 'https://api.mammouth.ai/v1';

const mammouth = createOpenAICompatible({
  name: 'mammouth',
  baseURL: IA_BASE_URL,
  // `.trim()` : un retour à la ligne collé avec la clé casse l'en-tête HTTP, et
  // toutes les routes renvoient 500 sans erreur lisible (voir CLAUDE.md).
  apiKey: (process.env.MAMMOUTH_API_KEY || '').trim(),
  supportsStructuredOutputs: true,
});

export const modeleIA = (id: string) => mammouth.chatModel(id);

/** Options de fournisseur d'un appel : le niveau de raisonnement. */
export const optionsIA = (reasoningEffort: string) => ({ mammouth: { reasoningEffort } });
