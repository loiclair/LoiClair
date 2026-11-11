'use client';

/**
 * Barre d'ancres des deux fiches de détail (élu, dossier). Une pastille par
 * section rendue, toutes du même poids ; un clic saute à la section visée, en la
 * rouvrant si elle était repliée. Un bouton de remontée prend le relais dès que
 * la barre est sortie de l'écran.
 *
 * L'appelant résout ses ancres (clé, libellé, icône) avant de les passer, comme
 * le fait le type `SubLink` de la sous-navigation : le composant ne connaît ni
 * les libellés, ni l'ordre, ni les sections qui n'ont pas été rendues.
 *
 * Elle défile avec la page au lieu de se coller sous l'en-tête. Une barre
 * collante ne peut pas suivre un en-tête qui se replie sans se décaler, les deux
 * mouvements ne passant pas par le même moteur, et Safari ne recalcule jamais le
 * `top` d'un `position: sticky` une fois la contrainte posée : le contenu
 * défilait alors dans la bande que l'en-tête venait de libérer.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import BoutonRemonter from '@/components/BoutonRemonter';
import { useSortieDeLEcran } from '@/hooks/useSortieDeLEcran';
import { marquerDefilementProgramme } from '@/lib/defilement-programme';

export interface Ancre {
  /** Doit valoir le `cle` du `SectionRepliable` visé : c'est `section[data-cle]` qui est cherché dans le DOM. */
  cle: string;
  label: string;
  icone: ReactNode;
}

/** Saute à la section `section[data-cle="<cle>"]`, en la rouvrant si elle était
 *  repliée. Sert aux pastilles de la barre, et à la fermeture d'un tiroir ouvert par
 *  un lien partagé (`PourVous.tsx`). */
export function allerASection(cle: string) {
  const sec = document.querySelector<HTMLElement>(`section[data-cle="${cle}"]`);
  // Sauter à une section repliée ne montrerait qu'un titre : on la rouvre.
  // Écrire `.open` déclenche l'évènement `toggle`, donc l'état de
  // `SectionRepliable` suit.
  const details = sec?.querySelector('details');
  if (details && !details.open) details.open = true;
  // Un saut vers le bas est un défilement vers le bas : sans cette marque,
  // l'en-tête se repliait en route et la section arrivait sous la bande de
  // 78 px que `scroll-margin-top` lui réserve, désormais vide. Le point
  // d'arrivée, lui, ne change pas : l'en-tête est fixe et déplacé par un
  // `transform`, donc il ne décale aucun défilement.
  marquerDefilementProgramme();
  // Le saut vise la position au moment du clic : une section qui grandit
  // pendant le défilement doux (les arguments du débat arrivent en flux)
  // atterrit un peu à côté. Re-viser après coup serait pire, le navigateur
  // annule le défilement en cours dès qu'on le relance.
  sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export default function BarreAncres({ ancres, ariaLabel }: { ancres: Ancre[]; ariaLabel: string }) {
  const barreRef = useRef<HTMLElement>(null);
  const [deborde, setDeborde] = useState(false);
  // Aucune pastille n'est mise en valeur : la barre n'est plus sous les yeux
  // pendant la lecture, donc suivre la section courante ne montrait plus rien à
  // personne. Sa sortie de l'écran, elle, commande le bouton de remontée.
  const sortie = useSortieDeLEcran(barreRef);

  // Reste-t-il des pastilles à droite ? Mesuré plutôt que supposé : un voile
  // permanent rongerait la dernière pastille sur les fenêtres où tout tient.
  useEffect(() => {
    const barre = barreRef.current;
    if (!barre) return;
    const majDebordement = () => setDeborde(barre.scrollLeft + barre.clientWidth < barre.scrollWidth - 1);
    majDebordement();
    barre.addEventListener('scroll', majDebordement, { passive: true });
    window.addEventListener('resize', majDebordement);
    return () => {
      barre.removeEventListener('scroll', majDebordement);
      window.removeEventListener('resize', majDebordement);
    };
  }, [ancres.length]);

  return (
    <>
    {/* La boîte porte le fond et le voile de débordement ; la barre ne porte que
        le défilement, pour que le voile se fonde dans ce fond. */}
    <div className="fiche-ancres-boite">
      <nav
        ref={barreRef}
        className="fiche-ancres"
        aria-label={ariaLabel}
        style={{
          display: 'flex',
          gap: '0.25rem',
          overflowX: 'auto',
          padding: '0.375rem 0',
        }}
      >
        {/* Toutes les pastilles ont le même poids : rien ne dit plus « vous êtes
            ici », c'est le rôle du titre de la section qu'on lit. Le survol et
            l'appui, seuls signes qu'on peut cliquer, vivent dans `.fiche-ancres`
            (globals.css) : un état React par pastille ferait un rendu du
            composant entier à chaque passage de souris. */}
        {ancres.map(({ cle, label, icone }) => (
          <button
            key={cle}
            type="button"
            onClick={() => allerASection(cle)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              flex: 'none',
              padding: '0.4rem 0.875rem',
              borderRadius: '9999px',
              border: 0,
              cursor: 'pointer',
              fontSize: '0.8125rem',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              // Pas de `backgroundColor` ici : un style inline l'emporterait sur
              // le survol de `.fiche-ancres`, et le fond au repos est déjà
              // transparent (Preflight le pose sur tous les boutons).
              // L'icône hérite de currentColor : elle reste brune avec le texte,
              // jamais teal (BRAND_ID §8.2, le teal signale ce sur quoi on peut
              // agir, et ici c'est la pastille entière qui le signale).
              color: 'var(--foreground)',
            }}
          >
            {icone}
            {label}
          </button>
        ))}
      </nav>
      {deborde && <span className="fiche-ancres-voile" aria-hidden />}
    </div>
    {/* Le bouton est monté ici et non dans les deux pages : c'est la mesure
        de cette barre qui décide de son apparition. */}
    <BoutonRemonter visible={sortie} />
    </>
  );
}
