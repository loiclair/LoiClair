'use client';

/**
 * Coquille repliable d'une section de fiche, partagée par la fiche élu (dix
 * sections) et la fiche dossier (neuf). Un `<section data-cle>` que
 * `BarreAncres` sait viser, un `<details>` qui porte le repli, un `<summary>`
 * qui porte l'icône, le surtitre en capitales, un badge optionnel et le chevron.
 *
 * Le surtitre reste dehors, sur le fond teinté que pose `AppShell` ; le contenu
 * entre dans une carte blanche quand l'appelant le demande. La fiche dossier ne
 * la demande pas : ses sections apportent déjà leur propre cadre (doré pour les
 * synthèses IA, simple pour le parcours et la presse).
 *
 * Toutes les sections sont rendues **ouvertes** côté serveur, et un effet
 * referme au montage celles que l'utilisateur avait fermées. Conséquence
 * assumée : une capture du seul rendu serveur montre ouverte une section
 * refermée à la main. C'est le prix pour garder la page lisible sans
 * JavaScript ; un script anti-flash coûterait plus cher que ce qu'il évite.
 *
 * Un clic sur le surtitre anime l'ouverture et la fermeture (`basculer`) : le
 * contenu d'un `<details>` ne s'anime pas en CSS dans Safari, faute de
 * `interpolate-size`, alors que l'iPhone est la cible première. La barre
 * d'ancres, elle, ouvre la section d'un coup, et c'est voulu : elle saute déjà
 * dessus.
 */

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { stockageLocal } from '@/lib/stockage-navigateur';

/** Durée de l'animation d'ouverture, la même que les panneaux `Depliable`. */
const DUREE_MS = 220;
/** Espace entre le surtitre et le contenu, porté par l'enveloppe animée. */
const ECART_PX = 14;

const CARTE: CSSProperties = {
  border: '1px solid var(--border)',
  backgroundColor: 'var(--card)',
  borderRadius: '12px',
  padding: '20px',
};

function lirePlie(cleStockage: string): Record<string, boolean> {
  // Le `try` ne couvre plus l'accès au stockage (`stockageLocal` ne lève jamais,
  // voir D-151) mais le `JSON.parse` d'une valeur corrompue, qui lève encore.
  try {
    return JSON.parse(stockageLocal.lire(cleStockage) || '{}');
  } catch {
    return {};
  }
}

export default function SectionRepliable({
  cle,
  cleStockage,
  icone,
  titre,
  badge,
  sousTitre,
  carte = false,
  children,
}: {
  cle: string;
  /** Clé `localStorage` du repli mémorisé. Propre à chaque fiche, sinon les deux partageraient leur état. */
  cleStockage: string;
  icone: ReactNode;
  titre: string;
  badge?: ReactNode;
  sousTitre?: ReactNode;
  carte?: boolean;
  children: ReactNode;
}) {
  // `ouvert` ne pilote que le chevron. Le repli lui-même appartient au DOM :
  // l'attribut `open` passé à React est constant, donc React l'écrit au montage
  // puis n'y touche plus, et le `<details>` garde l'état que lui donnent le clic
  // de l'utilisateur, l'effet ci-dessous ou la barre d'ancres.
  const [ouvert, setOuvert] = useState(true);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const contenuRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<Animation | null>(null);
  // État visé par l'animation en cours : un second clic part de lui, pas de
  // `details.open`, qui reste vrai pendant toute une fermeture.
  const viseRef = useRef(true);

  // Referme au montage ce qui était mémorisé fermé. Écrire `.open` déclenche
  // l'évènement `toggle`, donc `onToggle` remet le chevron d'aplomb.
  useEffect(() => {
    const el = detailsRef.current;
    if (el && lirePlie(cleStockage)[cle]) el.open = false;
  }, [cle, cleStockage]);

  // `onToggle` couvre les trois entrées : le clic sur le résumé, l'effet
  // ci-dessus, et la barre d'ancres qui force `details.open` pour ne pas sauter
  // sur un titre seul.
  const onToggle = () => {
    const open = detailsRef.current?.open ?? true;
    setOuvert(open);
    const plie = lirePlie(cleStockage);
    if (open) delete plie[cle]; else plie[cle] = true;
    stockageLocal.ecrire(cleStockage, JSON.stringify(plie));
  };

  // La bascule native du `<summary>` est toujours annulée : hors lien, `basculer`
  // la refait en l'animant. Un clic sur le badge « Généré par intelligence
  // artificielle » est aussi un clic dans le `<summary>` : il replierait la
  // section en même temps qu'il navigue, et le repli serait mémorisé. Là, rien
  // ne bascule, et le lien suit son cours.
  const auClic = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    if ((e.target as HTMLElement).closest('a')) return;
    basculer();
  };

  // Le repli natif est annulé (`auClic`) pour animer la hauteur de l'enveloppe.
  // À l'ouverture, `open` passe d'abord à vrai pour que le contenu ait une
  // hauteur à atteindre ; à la fermeture, il ne passe à faux qu'une fois
  // l'animation finie, sinon le contenu disparaîtrait avant de glisser. Le
  // chevron tourne tout de suite, `onToggle` confirmant ensuite. Un second clic
  // pendant l'animation l'interrompt et repart de l'état visé.
  const basculer = () => {
    const details = detailsRef.current;
    const contenu = contenuRef.current;
    if (!details || !contenu) return;
    const ouvrir = animRef.current ? !viseRef.current : !details.open;
    animRef.current?.cancel();
    viseRef.current = ouvrir;
    const sansAnimation = typeof contenu.animate !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (sansAnimation) {
      details.open = ouvrir;
      return;
    }
    setOuvert(ouvrir);
    if (ouvrir) details.open = true;
    const plein = { height: `${contenu.offsetHeight}px`, paddingTop: `${ECART_PX}px`, opacity: 1 };
    const vide = { height: '0px', paddingTop: '0px', opacity: 0 };
    contenu.style.overflow = 'hidden';
    const anim = contenu.animate(ouvrir ? [vide, plein] : [plein, vide], { duration: DUREE_MS, easing: 'ease' });
    animRef.current = anim;
    anim.onfinish = () => {
      if (!ouvrir) details.open = false;
      contenu.style.overflow = '';
      animRef.current = null;
    };
    anim.oncancel = () => { contenu.style.overflow = ''; };
  };

  return (
    <section data-cle={cle} className="fiche-section">
      <details ref={detailsRef} open onToggle={onToggle}>
        <summary onClick={auClic}>
          {icone}
          <h2
            className="fiche-section-titre"
            style={{
              margin: 0,
              fontSize: '12px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.115em',
              color: 'var(--foreground)',
            }}
          >
            {titre}
          </h2>
          {/* Enveloppé : c'est ce span qui devient l'élément flex, donc lui qui
              passe à la ligne sous 640 px, sans que la pastille s'étire. */}
          {badge && <span className="fiche-section-badge">{badge}</span>}
          <ChevronDown
            size={16}
            strokeWidth={1.5}
            aria-hidden
            style={{
              marginLeft: 'auto',
              flex: 'none',
              color: 'var(--muted-foreground)',
              transform: ouvert ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease',
            }}
          />
        </summary>
        <div ref={contenuRef} style={{ paddingTop: `${ECART_PX}px` }}>
        <div style={carte ? CARTE : undefined}>
          {sousTitre && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--muted-foreground)', margin: '0 0 1.125rem', maxWidth: '62ch', lineHeight: 1.55 }}>
              {sousTitre}
            </p>
          )}
          {children}
        </div>
        </div>
      </details>
    </section>
  );
}
