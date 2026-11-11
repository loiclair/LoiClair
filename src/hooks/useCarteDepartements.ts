'use client';

// Charge une fois par page `public/departements.svg`, la carte des départements,
// pour les composants client qui la dessinent : le menu Département de /les-elus
// (`DepartementMap`) et la carte de /Facts/representativite/geographie
// (`FranceChoropleth`).
//
// Pourquoi ne plus la passer en prop depuis le serveur : une prop d'un composant
// client est recopiée dans le HTML et dans le flux RSC de la page, que l'ISR stocke à
// chaque génération, par page et par langue. Servi en statique, le fichier de 158 Ko
// n'y est pas recopié et reste en cache navigateur.

import { useEffect, useState } from 'react';

let contenu: string | null = null;
let promesse: Promise<string> | null = null;

/** Lance le chargement s'il n'est pas déjà parti, et rend sa promesse. Un échec
 *  libère la place : l'appel suivant réessaie. */
export function chargerCarteDepartements(): Promise<string> {
  promesse ??= fetch('/departements.svg')
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((texte) => (contenu = texte))
    .catch((e) => {
      promesse = null;
      throw e;
    });
  return promesse;
}

/** Le texte de la carte, ou `null` tant qu'il n'est pas arrivé (ou si le chargement a
 *  échoué). Déjà chargée, la carte est rendue dès le premier rendu. */
export function useCarteDepartements(): string | null {
  const [svg, setSvg] = useState<string | null>(contenu);
  useEffect(() => {
    if (svg) return;
    let annule = false;
    chargerCarteDepartements()
      .then((texte) => { if (!annule) setSvg(texte); })
      .catch(() => {});
    return () => { annule = true; };
  }, [svg]);
  return svg;
}
