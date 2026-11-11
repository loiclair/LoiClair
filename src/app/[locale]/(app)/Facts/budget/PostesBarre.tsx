'use client';

/**
 * Barre unique des postes de dépense d'une chambre, avec une infobulle par
 * segment, partagée par les chapitres de « Budget des chambres »
 * (/Facts/budget/assemblee-nationale, /Facts/budget/senat). Composant client
 * parce que l'infobulle réagit au survol et au toucher ; la page serveur lui
 * passe des libellés et montants déjà formatés, et la couleur de chaque poste.
 */

import { useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface SegmentPoste {
  cle: string;
  titre: string;
  /** Part du total en pourcentage, déjà formatée. */
  part: string;
  /** Montant de l'année, déjà formaté. */
  montant: string;
  valeur: number;
  couleur: string;
}

export function PostesBarre({ segments, label }: { segments: SegmentPoste[]; label: string }) {
  // Ouverture pilotée : Radix n'ouvre l'infobulle qu'au survol et au focus, un
  // toucher sur téléphone ne montrait rien. Le clic l'ouvre donc aussi.
  const [ouvert, setOuvert] = useState<string | null>(null);

  return (
    <div role="group" aria-label={label} className="flex w-full" style={{ height: 18, gap: 2 }}>
      {segments.map((s, i) => (
        <Tooltip key={s.cle} open={ouvert === s.cle} onOpenChange={(o) => setOuvert(o ? s.cle : null)}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={`${s.titre}, ${s.part}, ${s.montant}`}
              onClick={() => setOuvert(s.cle)}
              // Largeur en flex-grow et non en pourcentage, pour que les filets
              // de 2 px entre segments ne fassent pas déborder la barre ; 4 px minimum
              // pour que le plus petit poste reste visible et touchable.
              style={{
                flexGrow: s.valeur,
                flexBasis: 0,
                minWidth: 4,
                backgroundColor: s.couleur,
                borderTopLeftRadius: i === 0 ? 9999 : 0,
                borderBottomLeftRadius: i === 0 ? 9999 : 0,
                borderTopRightRadius: i === segments.length - 1 ? 9999 : 0,
                borderBottomRightRadius: i === segments.length - 1 ? 9999 : 0,
              }}
            />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            <p className="font-semibold">{s.titre}</p>
            <p className="tabular-nums">{s.part} · {s.montant}</p>
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
