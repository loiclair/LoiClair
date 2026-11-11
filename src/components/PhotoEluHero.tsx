'use client'

/**
 * Portrait officiel d'un élu, dans le hero de sa fiche.
 *
 * Le crédit n'est pas ici mais dans la bande meta, en dernière entrée : posé
 * sous le portrait, il chevauchait les meta dépliées sur mobile, puis, une fois
 * placé sur sa propre ligne, il décrochait du portrait dès que les meta
 * passaient sur trois lignes. En entrée meta il se replie comme les autres.
 *
 * La largeur vaut 132 px au-dessus de 768 px, 88 en dessous, où 132 mangeraient
 * le tiers de l'écran. La hauteur suit deux régimes selon la largeur, voir
 * `FEUILLE`. Media query et non `clamp()` sur `vw` : la bande meta se replie
 * par paliers, pas continûment, et un `clamp` donnait la plus petite photo
 * précisément aux largeurs où la bande occupe le plus de lignes.
 *
 * Répartition des styles : la feuille ne porte que les dimensions, parce
 * qu'elles seules ont besoin d'une media query ; tout le reste est inline.
 * Passer l'apparence en `<style jsx>` avait fait sauter l'arrondi des coins,
 * le scope de styled-jsx n'atteignant pas l'élément.
 *
 * `<img>` brut et non `next/image` : l'optimiseur de Next téléchargerait le
 * fichier sur notre serveur pour le re-servir depuis loiclair.fr, ce que les mentions
 * légales des deux chambres soumettent à un accord préalable. Voir
 * `src/lib/photo-elu.ts` pour le détail.
 *
 * `onErreur` remonte au parent, qui tient l'état : c'est lui qui construit
 * l'entrée meta du crédit et doit la retirer quand l'image ne charge pas. Deux
 * cas réels : les élus dont la chambre n'a pas encore publié le portrait (deux
 * sénateurs au 2026-09-05) et une rupture d'URL côté officiel, le Sénat ayant
 * déjà changé la sienne lors d'une refonte.
 *
 * `ancien` grise le portrait d'un élu qui ne siège plus, avec le filtre des
 * vignettes (`PhotoEluVignette`) et du bandeau de la fiche dossier.
 */

import { useTranslations } from 'next-intl'
import type { PhotoElu } from '@/lib/photo-elu'
import { STYLE_ANCIEN } from '@/lib/ancien-elu'

/** Largeur du portrait au-dessus de 768 px, et valeur des attributs
 *  `width`/`height` de l'image, qui ne servent qu'à réserver une place avant
 *  chargement : la taille affichée vient de la feuille ci-dessous. */
const TAILLE = 132

/** Dimensions seules : le reste de l'apparence est inline sur l'élément.
 *
 *  Au-dessus de 768 px, la hauteur est tirée du bloc voisin
 *  (`align-self: stretch`), parce que la bande meta s'y replie sur deux, trois
 *  ou quatre lignes selon la largeur ET la longueur des libellés — un nom de
 *  groupe va de « LFI - NFP » à « Les Indépendants - République et
 *  Territoires ». Toute hauteur fixe finit donc décalée à une largeur ou une
 *  autre. Contrepartie assumée : le portrait n'a pas la même proportion d'une
 *  fiche à l'autre. `min-height` couvre les fiches à une seule ligne de meta
 *  (ministres hors Parlement), où l'image s'écraserait.
 *
 *  En dessous, carré fixe : la bande meta y est repliée derrière « Voir plus de
 *  détails », et une hauteur tirée du voisin faisait grandir le portrait au
 *  dépliage. Safari iOS ne redescendait pas au repli et laissait la photo
 *  étirée sur toute la hauteur du hero. */
const FEUILLE = `
  .elu-portrait { width: 88px; height: 88px; }
  .elu-portrait-vide { font-size: 1.5rem; }
  @media (min-width: 768px) {
    .elu-portrait { width: ${TAILLE}px; height: auto; align-self: stretch; min-height: 88px; }
    .elu-portrait-vide { font-size: 2.25rem; }
  }
`

interface PhotoEluHeroProps {
  /** `null` quand aucune chambre ne publie de portrait, ou après un échec. */
  photo: PhotoElu | null
  /** Une ou deux lettres, déjà calculées par l'appelant. */
  initiales: string
  nomComplet: string
  /** Ancien élu : portrait grisé. */
  ancien?: boolean
  onErreur: () => void
}

export default function PhotoEluHero({ photo, initiales, nomComplet, ancien = false, onErreur }: PhotoEluHeroProps) {
  const t = useTranslations('elus')

  const cadre = {
    borderRadius: '10px',
    // Un liseré plutôt qu'une ombre : sur le bandeau, il détache le portrait
    // sans ajouter de relief à une page qui n'en a pas.
    border: '1px solid var(--bandeau-trait)',
    flexShrink: 0,
    ...(ancien ? STYLE_ANCIEN : {}),
  } as const

  if (!photo) {
    return (
      <>
        <style>{FEUILLE}</style>
        <div
          aria-hidden
          className="elu-portrait elu-portrait-vide"
          style={{
            ...cadre,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--bandeau-voile)',
            color: 'var(--bandeau-texte-doux)',
            fontWeight: 500,
            letterSpacing: '0.02em',
          }}
        >
          {initiales}
        </div>
      </>
    )
  }

  return (
    <>
      <style>{FEUILLE}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="elu-portrait"
        src={photo.url}
        alt={t('photoAlt', { nom: nomComplet })}
        width={TAILLE}
        height={TAILLE}
        onError={onErreur}
        style={{ ...cadre, objectFit: 'cover' }}
      />
    </>
  )
}
