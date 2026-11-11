/**
 * Pastille or des bandes de contact, dans le pied du hero des deux fiches de
 * détail : « contacter mes élus » sur la fiche dossier, « écrire à l'élu » sur
 * la fiche élu. Partagée pour que les deux bandes, qui vivent sur des pages
 * sœurs, ne divergent pas au premier ajustement. Reprise par « Décrire ma
 * situation » de la section « Ce qui change pour vous », geste du même ordre.
 * La landing en reprend l'or pour figurer ces gestes (`PourVousSection`,
 * `SectionsBand`).
 *
 * L'or est celui du badge IA et du cadre `AI_FRAME_STYLE` (`rgba(212,165,74,*)`).
 * Les variantes propres à une bande (contour pointillé, remplissage plein)
 * restent chez elle.
 */

import type { CSSProperties } from 'react';

export const BASE_PILL_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '12px',
  fontWeight: 500,
  lineHeight: 1.3,
  padding: '5px 12px',
  borderRadius: '999px',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  transition: 'background 0.15s ease, border-color 0.15s ease, color 0.15s ease',
};

export const ACTIVE_BASE: CSSProperties = {
  border: '1px solid rgba(212,165,74,0.55)',
  background: 'rgba(212,165,74,0.10)',
  // Jeton de thème : l'or clair du bandeau brun disparaît sur la crème.
  color: 'var(--bandeau-or)',
};

export const ACTIVE_HOVER: CSSProperties = {
  border: '1px solid rgba(212,165,74,0.85)',
  background: 'rgba(212,165,74,0.20)',
  color: 'var(--bandeau-or-fort)',
};
