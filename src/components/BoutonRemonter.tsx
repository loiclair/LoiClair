'use client';

/**
 * Le rond teal qui ramène en haut de page, partagé par les deux fiches de
 * détail et le fil d'actualité.
 *
 * Il prend le relais de la barre de navigation interne de la page (onglets de
 * section, barre de mois) une fois qu'elle est sortie de l'écran : aucune ne
 * colle, parce qu'une barre collante ne peut pas suivre l'en-tête qui se replie
 * sans se décaler, et que Safari ne recalcule jamais le `top` d'un
 * `position: sticky` une fois la contrainte posée. Sans ce bouton, il faudrait
 * remonter toute la page à la main pour retrouver cette barre.
 *
 * C'est l'appelant qui dit quand le montrer : il mesure déjà sa propre barre au
 * défilement, et lui seul sait ce qui compte comme « sortie de l'écran ».
 */

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ChevronUp } from 'lucide-react';
import { marquerDefilementProgramme } from '@/lib/defilement-programme';

/** Rien à écouter : `document.body` ne change pas en cours de vie de la page. */
const SANS_ABONNEMENT = () => () => {};

export default function BoutonRemonter({ visible }: { visible: boolean }) {
  const t = useTranslations('common');
  // Cible du portail. `useSyncExternalStore` plutôt qu'un état posé dans un
  // effet : c'est un nœud du DOM, pas un état React, et la règle
  // `set-state-in-effect` refuse à juste titre le second. Le rendu serveur donne
  // `null`, donc rien n'est projeté avant l'hydratation.
  const corps = useSyncExternalStore(SANS_ABONNEMENT, () => document.body, () => null);
  if (!corps) return null;

  // La marque ne sert pas à l'en-tête, qui se redéploie tout seul dès la
  // première image d'un défilement vers le haut : elle sert au fil d'actualité,
  // qui réarme son défilement infini au premier `scroll` venu et chargeait un
  // mois de plus au moment même où le lecteur demandait à partir.
  const remonter = () => {
    marquerDefilementProgramme();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return createPortal(
    // Rendu dans `document.body` et non à sa place dans la page : constaté au
    // simulateur, rendu au milieu de la fiche il se posait dans le flux sous la
    // barre d'ancres, sans un seul de ses styles, alors que la règle était bien
    // servie. Le portail met le bouton hors de portée de ce que ses ancêtres
    // lui font. L'habillage est en style inline pour la même raison que partout
    // ailleurs (Tailwind v4 peu fiable sur Safari) ; seuls le fond, la glissade
    // et le survol vivent dans `.fiche-remonter`.
    <button
      type="button"
      onClick={remonter}
      aria-label={t('backToTop')}
      className="fiche-remonter"
      style={{
        position: 'fixed',
        right: '1rem',
        bottom: 'calc(1rem + env(safe-area-inset-bottom))',
        zIndex: 40,
        display: 'grid',
        placeItems: 'center',
        width: '3rem',
        height: '3rem',
        border: 0,
        borderRadius: '9999px',
        // Pas de `backgroundColor` ici : un style inline l'emporterait sur le
        // survol de `.fiche-remonter`, qui ne s'appliquerait jamais. Le fond
        // teal plein, et non un rond pâle, y est posé avec lui : le bouton
        // flotte au-dessus d'un texte long, où un contour fin se perdait, et le
        // teal signale ce sur quoi on peut agir (BRAND_ID §8.2).
        color: 'var(--primary-foreground)',
        boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
        cursor: 'pointer',
        opacity: visible ? 1 : 0,
        visibility: visible ? 'visible' : 'hidden',
        transform: visible ? 'translateY(0)' : 'translateY(0.5rem)',
      }}
    >
      <ChevronUp size={20} strokeWidth={2.25} aria-hidden />
    </button>,
    corps,
  );
}
