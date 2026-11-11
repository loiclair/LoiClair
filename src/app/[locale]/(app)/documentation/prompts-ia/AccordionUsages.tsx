'use client';

// Accordéon des usages de `/documentation/prompts-ia`, ouvert sur l'usage que nomme
// l'ancre de l'adresse (`#loi`, `#titres`…). Chaque badge IA du site mène ainsi aux
// instructions du texte qu'il marque (`AIBadge`, prop `usage`). Sans ce composant,
// l'ancre amenait sur un titre replié et le lecteur devait encore l'ouvrir. Les
// usages eux-mêmes restent rendus par la page serveur, passés en `children`.

import { useEffect, useState, type ReactNode } from 'react';
import { Accordion } from '@/components/ui/accordion';

export function AccordionUsages({ cles, children }: { cles: readonly string[]; children: ReactNode }) {
  const [ouverts, setOuverts] = useState<string[]>([]);

  // Dans un effet : l'ancre n'existe qu'après l'hydratation, le rendu serveur ne la
  // connaît pas. `hashchange` couvre une ancre changée dans l'onglet déjà ouvert sur
  // la page, qui ne la recharge pas.
  useEffect(() => {
    const ouvrirDepuisAncre = () => {
      // Une ancre peut nommer plusieurs usages (`#concerne+titres`), dans l'ordre de la page.
      const demandes = window.location.hash.slice(1).split('+');
      const vises = cles.filter((c) => demandes.includes(c));
      if (vises.length === 0) return;
      setOuverts((v) => [...v, ...vises.filter((c) => !v.includes(c))]);
      // Une ancre simple désigne un id : le navigateur, ou Next sur une navigation
      // interne, y amène déjà le titre (`scrollMarginTop` de l'item). Une ancre multiple
      // ne désigne aucun id : on défile nous-mêmes jusqu'à la première section. Elle
      // s'ouvre vers le bas, sans déplacer son titre. À l'image suivante : appelé tout
      // de suite, au premier chargement, le défilement était perdu et la page restait en haut.
      if (vises.length > 1) requestAnimationFrame(() => document.getElementById(vises[0])?.scrollIntoView({ block: 'start' }));
    };
    ouvrirDepuisAncre();
    window.addEventListener('hashchange', ouvrirDepuisAncre);
    return () => window.removeEventListener('hashchange', ouvrirDepuisAncre);
  }, [cles]);

  return (
    <Accordion type="multiple" value={ouverts} onValueChange={setOuverts} className="border-y">
      {children}
    </Accordion>
  );
}
