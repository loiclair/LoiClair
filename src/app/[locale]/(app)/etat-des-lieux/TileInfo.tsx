'use client';

// La ⓘ d'une tuile de /etat-des-lieux : elle retourne la carte pour montrer, à
// la place des chiffres, ce que mesure chacun d'eux ; une croix au même endroit
// la retourne à nouveau. Une seule par tuile, jamais une par chiffre. Rendue
// directement dans la Card (positionnée) par `Tile` (page.tsx) et par
// `LegislativeFunnel`. La ⓘ et la croix occupent la même petite zone dessinée
// dans le coin haut droit de la carte, qui est tout entière le bouton.
//
// La première version ouvrait une bulle (Popover) par-dessus la tuile ; Alex a
// préféré que la carte elle-même change de contenu. Le verso est une couche
// `absolute inset-0` sur la carte, toujours rendue et seulement masquée côté
// recto : c'est ce qui permet à la carte de réserver sa hauteur (voir plus bas).

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';

export type InfoItem = { term: string; text: string };

/** Durée d'un demi-tour de carte, en millisecondes : la bascule entière en fait deux. */
const DEMI_TOUR_MS = 180;

/** Rotation de la carte autour de son axe vertical, perspective comprise. */
const rotation = (deg: number) => ({ transform: `perspective(1200px) rotateY(${deg}deg)` });

export function TileInfo({
  label,
  closeLabel,
  items,
  padding,
}: {
  /** Nom accessible de la ⓘ */
  label: string;
  /** Nom accessible de la croix */
  closeLabel: string;
  items: InfoItem[];
  /** Rembourrage du verso, celui de la carte, pour que le texte s'aligne sur le titre du recto */
  padding: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const openRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Ne rend le focus qu'après une vraie fermeture, pas au premier rendu.
  const wasOpen = useRef(false);

  // Le focus suit la bascule : sur la croix à l'ouverture, sur la ⓘ au retour.
  // Sans ça, un lecteur d'écran ou un clavier resterait sur un bouton qui
  // vient de disparaître.
  useEffect(() => {
    if (open) closeRef.current?.focus();
    else if (wasOpen.current) openRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // La carte réserve en permanence la hauteur de son verso, recto compris. La
  // tuile des délais n'a ni phrase ni graphique : son verso demandait 208 px
  // pour 132 au recto. Coupé, il se lisait sans que rien n'invite à faire
  // défiler ; agrandi le temps d'être retourné, il faisait sauter la colonne,
  // et Alex a préféré une carte plus haute qui ne bouge plus. Les autres tuiles
  // ne sont pas touchées tant que leur verso tient : `minHeight` ne rétrécit
  // jamais une carte. Recalculé quand une définition change de taille (largeur
  // de la carte, police web chargée après coup), puisque le texte se replie
  // alors autrement.
  const versoRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDListElement>(null);
  useEffect(() => {
    const verso = versoRef.current;
    const list = listRef.current;
    const card = verso?.parentElement;
    if (!verso || !list || !card) return;
    // On mesure le texte lui-même, par le bas de sa dernière définition. Ni
    // `scrollHeight` (la liste est étirée à la hauteur de la carte, la mesure
    // ne redescendrait jamais) ni `getBoundingClientRect` (faussé pendant que
    // la carte tourne) : `offsetTop` est relatif au verso, qui est positionné.
    const reserver = () => {
      const derniere = list.lastElementChild as HTMLElement | null;
      if (!derniere) return;
      const bordures = card.offsetHeight - card.clientHeight;
      const besoin =
        derniere.offsetTop + derniere.offsetHeight + parseFloat(getComputedStyle(verso).paddingBottom) + bordures;
      card.style.minHeight = `${Math.ceil(besoin)}px`;
    };
    reserver();
    // On observe les définitions, pas la liste : la liste est étirée à la
    // hauteur de la carte, que `reserver` modifie, ce qui relancerait
    // l'observateur dans la même frame ; et elle ne change pas de taille quand
    // seul le texte se replie à l'intérieur.
    const observateur = new ResizeObserver(reserver);
    for (const enfant of Array.from(list.children)) observateur.observe(enfant);
    return () => {
      observateur.disconnect();
      card.style.minHeight = '';
    };
  }, []);

  // La carte se retourne : un premier demi-tour l'amène sur la tranche, le
  // contenu change à ce moment, invisible, et le second demi-tour découvre
  // l'autre face. Le retour tourne dans l'autre sens, comme une vraie carte.
  // On fait tourner la Card elle-même (le parent), d'où l'API Web Animations
  // plutôt qu'une classe : ce composant ne rend pas la carte. Pas d'animation
  // si l'utilisateur les a coupées, ni dans un onglet caché, où Chrome gèle
  // l'animation et donc la bascule avec elle.
  const premierDemiTour = useRef<{ anim: Animation; sens: number } | null>(null);
  const basculer = (suivant: boolean) => {
    const card = versoRef.current?.parentElement;
    const sansAnimation =
      !card ||
      typeof card.animate !== 'function' ||
      document.hidden ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (sansAnimation) {
      setOpen(suivant);
      return;
    }
    // Un second tap pendant que la carte tourne ne relance rien.
    if (premierDemiTour.current) return;
    const sens = suivant ? 1 : -1;
    const anim = card.animate([rotation(0), rotation(90 * sens)], {
      duration: DEMI_TOUR_MS,
      easing: 'ease-in',
      fill: 'forwards',
    });
    premierDemiTour.current = { anim, sens };
    anim.onfinish = () => setOpen(suivant);
  };

  // Second demi-tour, une fois la nouvelle face dans le DOM. En layout effect,
  // donc avant que le navigateur ne peigne : la carte, tenue sur la tranche par
  // `fill: 'forwards'`, ne montre jamais la nouvelle face de plein fouet.
  useLayoutEffect(() => {
    const tour = premierDemiTour.current;
    if (!tour) return;
    premierDemiTour.current = null;
    const card = versoRef.current?.parentElement;
    tour.anim.cancel();
    card?.animate([rotation(-90 * tour.sens), rotation(0)], { duration: DEMI_TOUR_MS, easing: 'ease-out' });
  }, [open]);

  // La zone du coin : un carré de 24 px au fond atténué, collé au coin de la
  // carte dont il reprend l'arrondi (`inherit`), arrondi lui-même à l'angle
  // opposé. Toute la zone est la cible du tap. Géométrie en inline, cf.
  // pièges Safari d'ARCHITECTURE.md.
  const buttonClass =
    'absolute flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';
  const zoneStyle: React.CSSProperties = {
    top: 0,
    right: 0,
    width: '1.5rem',
    height: '1.5rem',
    backgroundColor: 'var(--muted)',
    borderTopRightRadius: 'inherit',
    borderBottomLeftRadius: '0.5rem',
  };
  const iconStyle = { width: '0.75rem', height: '0.75rem' };

  return (
    <>
      {!open && (
        // `z-10` : au-dessus du lien qui couvre la tuile, sinon le tap partirait vers l'article.
        <button
          ref={openRef}
          type="button"
          aria-label={label}
          aria-expanded={false}
          aria-controls={id}
          className={`${buttonClass} z-10`}
          style={zoneStyle}
          onClick={() => basculer(true)}
        >
          <Info aria-hidden style={iconStyle} />
        </button>
      )}
      {/* `z-20` : au-dessus du lien de la tuile, pour qu'un tap sur le texte
          ne navigue pas. Côté recto, `visibility: hidden` le rend transparent
          au tap et aux lecteurs d'écran, `inert` le sort du parcours clavier,
          sans le retirer du DOM où se mesure sa hauteur. Fond et rayon en
          inline, cf. pièges Safari d'ARCHITECTURE.md. */}
      <div
        ref={versoRef}
        id={id}
        role="region"
        aria-label={label}
        inert={!open}
        className="absolute inset-0 z-20 flex flex-col"
        style={{
          backgroundColor: 'var(--card)',
          borderRadius: 'inherit',
          padding,
          visibility: open ? 'visible' : 'hidden',
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') basculer(false);
        }}
      >
        <button
          ref={closeRef}
          type="button"
          aria-label={closeLabel}
          aria-expanded
          aria-controls={id}
          className={buttonClass}
          style={zoneStyle}
          onClick={() => basculer(false)}
        >
          <X aria-hidden style={iconStyle} />
        </button>
        {/* Tailles en inline : piège Tailwind v4 sur Safari, cf. ARCHITECTURE.md. */}
        <dl ref={listRef} className="min-h-0 flex-1 overflow-y-auto" style={{ fontSize: '0.75rem', lineHeight: 1.45 }}>
          {items.map((item, i) => (
            <div key={item.term} style={{ marginTop: i === 0 ? 0 : '0.5rem' }}>
              {/* Le premier terme s'écarte de la zone de la croix, qui déborde
                  de 8 px sur sa ligne dans les tuiles (marge de 16 px). */}
              <dt className="font-semibold" style={i === 0 ? { paddingRight: '0.75rem' } : undefined}>
                {item.term}
              </dt>
              <dd className="text-muted-foreground">{item.text}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
