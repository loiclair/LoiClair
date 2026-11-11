// src/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/elus-actifs-carte.ts
// Ce que la carte « Les plus actifs dans ce dossier » montre sans rien charger, et le
// badge « Rapporteur » de ses lignes. Lu par `page.tsx`, qui n'envoie que la carte, et
// par `ElusActifsSection`, qui pose le badge sur la liste entière du panneau. Module
// sans `'use client'` ni dépendance serveur : une constante importée d'un fichier
// client arrive côté serveur sous forme de référence, pas de valeur.

import type { ElusActifsChambre } from './ElusActifsSection';
import type { BadgeElu } from './SourcesSection';

export const ELUS_VISIBLES = 5;

/** Pose le badge « Rapporteur » d'après les rapporteurs du texte (`elusDesSources`).
 *  Un élu ne le porte que dans la colonne de la chambre où il a rapporté ; un badge
 *  de rapporteur sans chambre connue vaut pour les deux. */
export function marquerRapporteurs(
  chambres: ElusActifsChambre[],
  rapporteurs: { uid: string; badge: BadgeElu | null }[],
): ElusActifsChambre[] {
  return chambres.map((c) => ({
    ...c,
    elus: c.elus.map((e) => ({
      ...e,
      rapporteur: rapporteurs.some((r) =>
        r.uid === e.uid && (r.badge === null || r.badge === (c.chambre === 'AN' ? 'depute' : 'senateur'))),
    })),
  }));
}

/** Les élus de la carte, chambre par chambre ; `nb` garde le total de la chambre. */
export function carteElusActifs(chambres: ElusActifsChambre[]): ElusActifsChambre[] {
  return chambres.map((c) => ({ ...c, elus: c.elus.slice(0, ELUS_VISIBLES) }));
}
