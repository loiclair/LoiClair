/**
 * Résultats du banc d'essai des modèles pour le résumé de loi, affichés sur
 * /documentation/choix-modele-ia.
 *
 * FICHIER GÉNÉRÉ par scripts/banc-modeles/classement.py : ne pas le modifier à
 * la main, relancer le banc (voir scripts/banc-modeles/README.md).
 */

export type ModeleEvalue = {
  id: string;
  raisonnement: string;
  famille: 'openai' | 'xai' | 'anthropic' | 'google';
  score: number;
  fr: number;
  en: number;
  criteres: Record<'exactitude' | 'neutralite' | 'completude' | 'clarte' | 'exemples', number>;
  gravesPour10: number;
  consignes: number;
  echecs: number;
  resumes: number;
  tirages: number;
  ecartTirages: number | null;
  coutPour1000: number;
  correcteurs: string[];
  frontiere: boolean;
};

export const EVALUATION_MODELES: {
  dateMesure: string;
  raisonnement: string;
  textes: { uid: string; langue: 'fr' | 'en'; caracteres: number }[];
  resumesNotes: number;
  correcteurs: string[];
  poids: Record<keyof ModeleEvalue['criteres'], number>;
  modeles: ModeleEvalue[];
} = {
  "dateMesure": "2026-09-29",
  "raisonnement": "low",
  "textes": [
    {
      "uid": "DECRET_JORFTEXT000053743425",
      "langue": "fr",
      "caracteres": 3215
    },
    {
      "uid": "LOI20251251-VC",
      "langue": "fr",
      "caracteres": 4562
    },
    {
      "uid": "LOI2025793",
      "langue": "fr",
      "caracteres": 7345
    },
    {
      "uid": "LOI20251129-VC",
      "langue": "fr",
      "caracteres": 14544
    },
    {
      "uid": "LOI2026201",
      "langue": "fr",
      "caracteres": 77804
    },
    {
      "uid": "LOI2026247",
      "langue": "fr",
      "caracteres": 6529
    },
    {
      "uid": "LOI2025989",
      "langue": "fr",
      "caracteres": 44728
    },
    {
      "uid": "DECRET_JORFTEXT000053422608",
      "langue": "en",
      "caracteres": 8035
    },
    {
      "uid": "DECRET_JORFTEXT000053958631",
      "langue": "en",
      "caracteres": 13542
    },
    {
      "uid": "LOI2026796-VC",
      "langue": "en",
      "caracteres": 40456
    }
  ],
  "resumesNotes": 150,
  "correcteurs": [
    "claude-opus-5-5",
    "gemini-3.1-pro-preview",
    "gpt-6-sol",
    "grok-4.7"
  ],
  "poids": {
    "exactitude": 0.35,
    "neutralite": 0.2,
    "completude": 0.15,
    "clarte": 0.15,
    "exemples": 0.15
  },
  "modeles": [
    {
      "id": "gpt-6-sol",
      "raisonnement": "low",
      "famille": "openai",
      "score": 8.7,
      "fr": 8.7,
      "en": 8.7,
      "criteres": {
        "exactitude": 8.8,
        "neutralite": 9.5,
        "completude": 8.2,
        "clarte": 8.6,
        "exemples": 8.1
      },
      "gravesPour10": 0.0,
      "consignes": 0.97,
      "echecs": 0,
      "resumes": 20,
      "tirages": 2,
      "ecartTirages": 0.2,
      "coutPour1000": 17.24,
      "correcteurs": [
        "claude-opus-5-5",
        "gemini-3.1-pro-preview"
      ],
      "frontiere": true
    },
    {
      "id": "gpt-6-luna",
      "raisonnement": "medium",
      "famille": "openai",
      "score": 8.5,
      "fr": 8.5,
      "en": 8.7,
      "criteres": {
        "exactitude": 8.5,
        "neutralite": 9.5,
        "completude": 8.4,
        "clarte": 8.2,
        "exemples": 7.8
      },
      "gravesPour10": 0.2,
      "consignes": 0.96,
      "echecs": 0,
      "resumes": 20,
      "tirages": 2,
      "ecartTirages": 0.4,
      "coutPour1000": 1.12,
      "correcteurs": [
        "claude-opus-5-5",
        "gemini-3.1-pro-preview"
      ],
      "frontiere": true
    },
    {
      "id": "gpt-6-astra",
      "raisonnement": "low",
      "famille": "openai",
      "score": 8.5,
      "fr": 8.4,
      "en": 8.7,
      "criteres": {
        "exactitude": 8.5,
        "neutralite": 9.6,
        "completude": 8.2,
        "clarte": 8.1,
        "exemples": 7.9
      },
      "gravesPour10": 0.0,
      "consignes": 0.96,
      "echecs": 0,
      "resumes": 10,
      "tirages": 1,
      "ecartTirages": null,
      "coutPour1000": 106.65,
      "correcteurs": [
        "claude-opus-5-5",
        "gemini-3.1-pro-preview"
      ],
      "frontiere": false
    },
    {
      "id": "gpt-6-luna",
      "raisonnement": "low",
      "famille": "openai",
      "score": 8.4,
      "fr": 8.3,
      "en": 8.7,
      "criteres": {
        "exactitude": 8.4,
        "neutralite": 9.4,
        "completude": 8.2,
        "clarte": 8.3,
        "exemples": 7.5
      },
      "gravesPour10": 0.2,
      "consignes": 0.96,
      "echecs": 0,
      "resumes": 20,
      "tirages": 2,
      "ecartTirages": 0.6,
      "coutPour1000": 0.8,
      "correcteurs": [
        "claude-opus-5-5",
        "gemini-3.1-pro-preview"
      ],
      "frontiere": true
    },
    {
      "id": "grok-4.7",
      "raisonnement": "low",
      "famille": "xai",
      "score": 7.9,
      "fr": 8.0,
      "en": 7.8,
      "criteres": {
        "exactitude": 7.6,
        "neutralite": 8.7,
        "completude": 8.9,
        "clarte": 7.8,
        "exemples": 7.0
      },
      "gravesPour10": 0.5,
      "consignes": 0.93,
      "echecs": 0,
      "resumes": 10,
      "tirages": 1,
      "ecartTirages": null,
      "coutPour1000": 28.25,
      "correcteurs": [
        "claude-opus-5-5",
        "gemini-3.1-pro-preview"
      ],
      "frontiere": false
    },
    {
      "id": "grok-4.3",
      "raisonnement": "low",
      "famille": "xai",
      "score": 6.3,
      "fr": 6.0,
      "en": 7.1,
      "criteres": {
        "exactitude": 5.3,
        "neutralite": 7.8,
        "completude": 7.4,
        "clarte": 7.3,
        "exemples": 4.8
      },
      "gravesPour10": 7.5,
      "consignes": 1.0,
      "echecs": 0,
      "resumes": 20,
      "tirages": 2,
      "ecartTirages": 1.1,
      "coutPour1000": 8.87,
      "correcteurs": [
        "claude-opus-5-5",
        "gemini-3.1-pro-preview"
      ],
      "frontiere": false
    },
    {
      "id": "claude-opus-5-5",
      "raisonnement": "thinking",
      "famille": "anthropic",
      "score": 6.3,
      "fr": 6.2,
      "en": 6.8,
      "criteres": {
        "exactitude": 4.9,
        "neutralite": 7.6,
        "completude": 8.1,
        "clarte": 8.1,
        "exemples": 4.5
      },
      "gravesPour10": 14.0,
      "consignes": 0.96,
      "echecs": 0,
      "resumes": 10,
      "tirages": 1,
      "ecartTirages": null,
      "coutPour1000": 77.21,
      "correcteurs": [
        "gpt-6-sol",
        "grok-4.7"
      ],
      "frontiere": false
    },
    {
      "id": "claude-sonnet-5",
      "raisonnement": "medium",
      "famille": "anthropic",
      "score": 5.8,
      "fr": 5.8,
      "en": 5.8,
      "criteres": {
        "exactitude": 5.0,
        "neutralite": 6.6,
        "completude": 7.0,
        "clarte": 6.9,
        "exemples": 4.4
      },
      "gravesPour10": 15.5,
      "consignes": 0.93,
      "echecs": 0,
      "resumes": 10,
      "tirages": 1,
      "ecartTirages": null,
      "coutPour1000": 36.19,
      "correcteurs": [
        "gpt-6-sol",
        "grok-4.7"
      ],
      "frontiere": false
    },
    {
      "id": "gemini-3.1-pro-preview",
      "raisonnement": "low",
      "famille": "google",
      "score": 5.2,
      "fr": 5.5,
      "en": 4.6,
      "criteres": {
        "exactitude": 4.4,
        "neutralite": 5.2,
        "completude": 5.9,
        "clarte": 8.1,
        "exemples": 3.6
      },
      "gravesPour10": 13.0,
      "consignes": 1.0,
      "echecs": 0,
      "resumes": 10,
      "tirages": 1,
      "ecartTirages": null,
      "coutPour1000": 30.48,
      "correcteurs": [
        "claude-opus-5-5"
      ],
      "frontiere": false
    }
  ]
};
