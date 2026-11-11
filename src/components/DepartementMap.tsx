'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { DEPT_NAME_TO_SVG_ID, SVG_ID_TO_DEPT_NAME } from '@/lib/departements';
import { useCarteDepartements } from '@/hooks/useCarteDepartements';

// Carte cliquable des départements, posée dans le menu Département de /les-elus
// (`ElusResultsClient`). Surligne les départements cochés ; un clic rend le nom
// propre à la carte, que l'appelant ramène à la graphie de son filtre et coche ou
// décoche. Le dessin vient de `useCarteDepartements`, que la liste précharge à son
// montage : il est en général là quand le menu s'ouvre.

interface Props {
  /** Départements cochés, dans la graphie du filtre (variantes comprises). */
  selectedDepts: string[];
  onToggle: (dept: string) => void;
}

export default function DepartementMap({ selectedDepts, onToggle }: Props) {
  const svgContent = useCarteDepartements();
  const containerRef = useRef<HTMLDivElement>(null);
  const onToggleRef = useRef(onToggle);

  useEffect(() => { onToggleRef.current = onToggle; }, [onToggle]);

  // Re-appliquer le highlight après chaque commit React — dangerouslySetInnerHTML
  // peut perdre les classes CSS manuelles quand React reconcile le nœud DOM.
  // Pas de deps : capture selectedDepts du scope du render pour avoir la valeur fraîche.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll('.selected-dept').forEach(el => el.classList.remove('selected-dept'));
    for (const dept of selectedDepts) {
      const svgId = DEPT_NAME_TO_SVG_ID[dept];
      if (svgId) container.querySelector(`#${svgId}`)?.classList.add('selected-dept');
    }
  });

  // Native listener — React onClick doesn't fire on SVG paths inside Radix portals
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const listener = (e: Event) => {
      const path = (e.target as Element).closest('path[id^="d"]');
      if (!path) return;
      const deptName = SVG_ID_TO_DEPT_NAME[(path as Element).id];
      if (!deptName) return;
      onToggleRef.current(deptName);
    };
    container.addEventListener('click', listener);
    return () => container.removeEventListener('click', listener);
  }, []);

  return (
    <div
      ref={containerRef}
      className="departement-map"
      // Avant l'arrivée du dessin, la place de la carte (proportions de son viewBox) est
      // réservée : le menu ne change pas de taille quand elle apparaît.
      style={{ display: 'flex', justifyContent: 'center', width: '100%', padding: '1rem', cursor: 'pointer', ...(svgContent ? {} : { aspectRatio: '385 / 447' }) }}
      dangerouslySetInnerHTML={{ __html: svgContent ?? '' }}
    />
  );
}
