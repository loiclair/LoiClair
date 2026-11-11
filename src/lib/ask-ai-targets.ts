// Les six IA grand public vers lesquelles la fiche dossier renvoie le lecteur,
// dans l'ordre d'affichage. Lues par `AskAILinks` (resume-ia/AICardElements.tsx) et par la
// maquette de l'accueil (`(landing)/components/LoiEnClair.tsx`). Module sans
// 'use client' : la maquette est un Server Component, qui ne peut pas lire une
// valeur exportée d'un fichier client.

import type { IconType } from 'react-icons';
import { RiClaudeFill, RiGoogleFill, RiGrokAiFill, RiOpenaiFill, RiPerplexityFill } from 'react-icons/ri';
import { SiMistralai } from 'react-icons/si';

/**
 * Largeur de la case du point séparateur de la rangée (`AskAISeparator`), et
 * décalage vers la gauche qui le cache en début de ligne (cf. `AskAILinks`).
 */
export const ASK_AI_SEP_WIDTH = 16;

/**
 * Chaque IA reçoit la question dans l'adresse, déjà écrite : un clic suffit,
 * sans copier-coller. `url` attend la question déjà encodée. Les noms sont des
 * marques et ne se traduisent pas, sauf le Mode IA de Google, qui est un
 * libellé de fonction (`labelKey`, namespace `resumeIA`).
 *
 * - ChatGPT : `hints=search` active la recherche web, pour que le modèle puisse
 *   ouvrir le lien officiel glissé dans la question.
 * - Google : `udm=50` ouvre le Mode IA au lieu de la page de résultats classique.
 *
 * Constaté le 2026-10-13 dans un navigateur vierge : ChatGPT, Perplexity et Grok
 * reçoivent la question sans compte ; Claude et Le Chat renvoient vers leur page
 * de connexion. Pour Le Chat, aucun autre paramètre (`prompt`, `message`, `text`,
 * `query`, `input`) ne pré-remplit la question. Les deux sont gardés quand même,
 * pour les lecteurs qui y ont un compte.
 */
export const ASK_AI_TARGETS: {
  name: string;
  labelKey?: 'askAIGoogleMode';
  Icon: IconType;
  url: (q: string) => string;
}[] = [
  { name: 'ChatGPT', Icon: RiOpenaiFill, url: (q) => `https://chatgpt.com/?q=${q}&hints=search` },
  { name: 'Claude', Icon: RiClaudeFill, url: (q) => `https://claude.ai/new?q=${q}` },
  { name: 'Le Chat', Icon: SiMistralai, url: (q) => `https://chat.mistral.ai/chat?q=${q}` },
  { name: 'Perplexity', Icon: RiPerplexityFill, url: (q) => `https://www.perplexity.ai/search?q=${q}` },
  { name: 'Grok', Icon: RiGrokAiFill, url: (q) => `https://grok.com/?q=${q}` },
  { name: 'Google', labelKey: 'askAIGoogleMode', Icon: RiGoogleFill, url: (q) => `https://www.google.com/search?udm=50&q=${q}` },
];
