'use client';

// L'accordéon « À comprendre » de /Activite : périmètre, calcul du score, détail des
// onze mesures. Les sections elles-mêmes sont écrites par la page, qui est un composant
// serveur ; ce composant tient leur état d'ouverture, et celui de la mesure dépliée.
//
// Il porte les deux parce que Radix ne monte le contenu d'une section fermée nulle part
// dans le DOM. Deux conséquences, l'une et l'autre traitées ici :
//
//  — une arrivée par `#mesure-cpRappCtrl`, depuis le tiroir d'une fiche élu, ne trouve
//    rien à viser tant que la section des mesures est repliée. Elle est donc ouverte ici,
//    et le défilement attend que Radix ait monté la ligne ;
//  — l'état du tableau meurt avec son contenu à chaque repliage. Tenu ici, il survit :
//    sinon toute réouverture relisait le hash et rouvrait la mesure qu'il désigne encore.

import { useEffect, useState, type ReactNode } from 'react';
import { Accordion } from '@/components/ui/accordion';
import { MesuresContext, ancreMesure, mesuresDansLOrdre } from '@/components/ui/MesuresDetail';
import type { MetricKey } from '@/lib/activite-weights';

export function ConceptsAccordion({
  children,
  sectionMesures,
}: {
  children: ReactNode;
  /** La valeur de l'`AccordionItem` qui contient le tableau des mesures. */
  sectionMesures: string;
}) {
  const [ouvertes, setOuvertes] = useState<string[]>([]);
  const [mesureOuverte, setMesureOuverte] = useState<MetricKey | null>(null);

  useEffect(() => {
    function depuisLeHash() {
      const ancre = window.location.hash.slice(1);
      const trouvee = mesuresDansLOrdre().find(({ metric }) => ancreMesure(metric) === ancre);
      if (!trouvee) return;
      setOuvertes((actuelles) =>
        actuelles.includes(sectionMesures) ? actuelles : [...actuelles, sectionMesures],
      );
      setMesureOuverte(trouvee.metric);
      // Le défilement se fait ici et pas par le navigateur : Next remet la page en haut
      // au terme de sa navigation, après que le hash a été honoré. Il est instantané, un
      // défilement animé partant vers une position calculée avant le dépliage. Et il
      // réessaie, la ligne n'étant montée qu'une fois l'animation d'ouverture lancée :
      // un délai fixe serait toujours trop court ou trop long.
      let essais = 0;
      const attente = window.setInterval(() => {
        const cible = document.getElementById(ancre);
        if (cible || ++essais > 20) {
          window.clearInterval(attente);
          cible?.scrollIntoView({ block: 'start' });
        }
      }, 60);
    }
    depuisLeHash();
    window.addEventListener('hashchange', depuisLeHash);
    return () => window.removeEventListener('hashchange', depuisLeHash);
  }, [sectionMesures]);

  return (
    <MesuresContext.Provider value={{ ouverte: mesureOuverte, setOuverte: setMesureOuverte }}>
      <Accordion type="multiple" className="mb-12" value={ouvertes} onValueChange={setOuvertes}>
        {children}
      </Accordion>
    </MesuresContext.Provider>
  );
}
