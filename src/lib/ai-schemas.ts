/**
 * Schémas de sortie des pipelines IA, et les types TypeScript qui vont avec.
 *
 * Le schéma part dans le corps de la requête (`response_format`), hors des messages :
 * le modèle ne peut alors rendre qu'un objet conforme. C'est ce qui referme par
 * construction la classe de bug du 2026-09-07, où une révision de Grok s'était
 * mise à enrober ses titres markdown de gras, cassant tous les découpages par
 * expression régulière.
 *
 * ── Deux règles à ne pas défaire ──────────────────────────────────────────────
 *
 * 1. L'ORDRE DES CLÉS ENTRE DANS LE HASH DE VERSION. Chaque schéma est sérialisé
 *    par `JSON.stringify` dans le calcul de la version du prompt qu'il accompagne
 *    (voir `prompts.ts`). Réordonner une clé, même sans rien changer d'autre,
 *    change le hash, donc vide le cache et fait tout régénérer. Rien ne le
 *    signale au moment du merge : seule la ligne « Version » des réglages de
 *    /documentation/prompts-ia change visiblement.
 *
 * 2. `maxItems` OUI, `minItems` NON. Le mode strict les applique vraiment (mesuré
 *    sur gpt-6-luna : une demande de 5 entrées rendue à 2 sous `maxItems: 2`, et
 *    aucun dépassement sur les 60 résumés du banc d'essai). Un plafond
 *    protège la mise en page. Un plancher, lui, forcerait le modèle à inventer
 *    une mesure sur un texte qui n'en porte qu'une, et la base en contient déjà
 *    un cas. Les fourchettes basses restent donc dans le texte du prompt, où
 *    elles guident sans contraindre.
 *
 * Ce fichier n'a aucun import de valeur, surtout pas `crypto`, qui interdirait
 * à un composant client de s'en servir. Le seul import est un type, effacé à la
 * compilation. Les routes enveloppent ces objets dans `jsonSchema()` au moment de
 * l'appel ; les composants n'en prennent que les types.
 *
 * Le schéma des décisions du Conseil constitutionnel ne vit pas ici mais dans
 * `prompts/cc-decision.json`, à côté de son prompt : ce fichier est lu à la fois
 * par le script Python et par la page publique.
 */

import type { JSONSchema7 } from 'ai';

// ── Résumé de loi ─────────────────────────────────────────────────────────────
// Un seul schéma pour les deux langues, à noms de champs neutres : c'est le
// prompt qui porte la langue, et chaque écran pose ses propres titres traduits.

export const SCHEMA_RESUME_LOI: JSONSchema7 = {
  type: 'object',
  additionalProperties: false,
  required: ['objectif', 'mesures', 'exemples', 'aRetenir'],
  properties: {
    objectif: { type: 'string' },
    mesures: { type: 'array', maxItems: 5, items: { type: 'string' } },
    exemples: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['acteur', 'recit'],
        properties: { acteur: { type: 'string' }, recit: { type: 'string' } },
      },
    },
    aRetenir: { type: 'string' },
  },
};

export type ResumeLoiIa = {
  objectif: string;
  mesures: string[];
  exemples: { acteur: string; recit: string }[];
  aRetenir: string;
};

// ── Résumé de débats ──────────────────────────────────────────────────────────
// `contre` vide veut dire « aucune opposition exprimée », et rien d'autre. La
// sentinelle textuelle qu'il remplace était indistinguable d'un parsing raté :
// une puce hors gabarit était ignorée en silence et s'affichait comme une
// absence réelle d'arguments.
// Plafond à 8 par camp et non 5 : le prompt oblige à citer chaque groupe qui a
// pris position, et un même débat peut réunir les 11 groupes de l'Assemblée,
// ceux du Sénat et le Gouvernement.

const ARGUMENT_DEBAT: JSONSchema7 = {
  type: 'object',
  additionalProperties: false,
  required: ['groupes', 'argument'],
  properties: { groupes: { type: 'string' }, argument: { type: 'string' } },
};

export const SCHEMA_RESUME_DEBATS: JSONSchema7 = {
  type: 'object',
  additionalProperties: false,
  required: ['synthese', 'pour', 'contre'],
  properties: {
    synthese: { type: 'string' },
    pour: { type: 'array', maxItems: 8, items: ARGUMENT_DEBAT },
    contre: { type: 'array', maxItems: 8, items: ARGUMENT_DEBAT },
  },
};

export type ArgumentDebat = { groupes: string; argument: string };

export type ResumeDebatsIa = {
  synthese: string;
  pour: ArgumentDebat[];
  contre: ArgumentDebat[];
};

// ── Newsletter hebdomadaire ───────────────────────────────────────────────────
// Quatre sections de même forme, chacune pouvant être vide. Le plafond est à 4 :
// le prompt en demande au plus 3 pour « application », « publications » et « depots »,
// 4 pour « decisions ».

const SECTION_NEWSLETTER: JSONSchema7 = {
  type: 'array',
  maxItems: 4,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['titre', 'corps'],
    properties: { titre: { type: 'string' }, corps: { type: 'string' } },
  },
};

export const SCHEMA_NEWSLETTER: JSONSchema7 = {
  type: 'object',
  additionalProperties: false,
  required: ['resume', 'application', 'decisions', 'depots', 'publications'],
  properties: {
    resume: { type: 'string' },
    application: SECTION_NEWSLETTER,
    decisions: SECTION_NEWSLETTER,
    depots: SECTION_NEWSLETTER,
    publications: SECTION_NEWSLETTER,
  },
};

export type ParagrapheNewsletter = { titre: string; corps: string };

export type ResumeSemaineIa = {
  resume: string;
  application: ParagrapheNewsletter[];
  decisions: ParagrapheNewsletter[];
  depots: ParagrapheNewsletter[];
  publications: ParagrapheNewsletter[];
};
