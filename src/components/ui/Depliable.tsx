// Panneau qui se déplie en glissant, partagé par tout ce qui se replie sans
// `<details>` : les fonctions du score sur la fiche élu (`EluRows`), le tableau
// des mesures de `/Activite` (`MesuresDetail`), les méta de l'en-tête sur mobile
// (`PageHero`) et les amendements adoptés de la fiche dossier (`ModificationsSection`).
//
// L'appelant porte le bouton (et son `aria-expanded`) ; ce composant ne porte que
// le panneau, sans aucun libellé. Le contenu reste toujours monté : une ancre qui
// vise une ligne repliée trouve sa cible, et rien n'a à attendre un montage.

import type { CSSProperties, ReactNode } from 'react';

/**
 * Une grille dont l'unique rangée passe de `0fr` à `1fr` : c'est la seule façon
 * d'animer vers une hauteur inconnue d'avance que tous les navigateurs savent
 * interpoler, là où une hauteur qui finit à `auto` ne s'anime nulle part de façon
 * fiable, et où le contenu d'un `<details>` ne s'anime pas sans
 * `::details-content`. L'animation vit dans la classe `.depliable` de
 * `globals.css`, pas en style inline : la règle `prefers-reduced-motion` doit
 * pouvoir la couper, et un style inline gagnerait sur elle.
 *
 * Replié, `inert` sort le contenu du parcours au clavier et des lecteurs d'écran,
 * comme le ferait un repli natif. `className` et `style` habillent l'enfant qui
 * porte l'`overflow`, celui qui coupe le contenu pendant l'animation.
 */
export default function Depliable({
  ouvert,
  id,
  className,
  style,
  children,
}: {
  ouvert: boolean;
  /** Cible de l'`aria-controls` du bouton qui ouvre le panneau. */
  id?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div id={id} className="depliable" data-ouvert={ouvert} inert={!ouvert}>
      <div className={className} style={style}>{children}</div>
    </div>
  );
}
