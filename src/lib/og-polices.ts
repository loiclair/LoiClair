// Polices des images de partage, lues par les trois routes de `src/app/api/og/`.
// Satori (le moteur d'`ImageResponse`) ne lit ni `next/font` ni le woff2 : il lui
// faut les .ttf, rangés dans `src/app/api/og/_polices/` avec leur licence OFL.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

let policesEnCours: Promise<{ name: string; data: Buffer; weight: 500 | 600 | 700; style: 'normal' }[]> | null = null;

/**
 * IBM Plex Sans en 500, 600 et 700, lues une fois par instance. Une graisse absente
 * (400, 800) prend la plus proche. `process.cwd()` et un chemin littéral, pour que
 * le traçage des fichiers de Next les embarque dans chaque fonction qui l'appelle.
 * Un échec de lecture vide le cache : sinon la promesse rejetée servirait à toutes
 * les requêtes suivantes de l'instance.
 */
export function polices() {
  policesEnCours ??= Promise.all(
    ([[500, 'Medium'], [600, 'SemiBold'], [700, 'Bold']] as const).map(async ([weight, nom]) => ({
      name: 'IBM Plex Sans',
      data: await readFile(join(process.cwd(), 'src/app/api/og/_polices', `IBMPlexSans-${nom}.ttf`)),
      weight,
      style: 'normal' as const,
    })),
  ).catch((erreur) => {
    policesEnCours = null;
    throw erreur;
  });
  return policesEnCours;
}
