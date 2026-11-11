'use client'

/**
 * Portrait d'un élu en vignette : annuaire `/les-elus`, modale de recherche
 * et podium du Top 3 de `/Activite`. Le hero de la fiche a son propre composant
 * (`PhotoEluHero`), les deux contextes n'ayant ni les mêmes couleurs (fond
 * sombre contre fond clair) ni le même comportement de taille.
 *
 * Chaque vignette tient son propre repli : dans une liste, l'échec de l'image
 * d'une ligne ne regarde pas les voisines, et il n'y a pas de crédit à masquer
 * en même temps, contrairement au hero.
 *
 * `loading="lazy"` n'est pas une optimisation de confort : une liste peut
 * afficher plusieurs centaines d'élus, et chaque vignette est une requête vers
 * les serveurs de l'Assemblée ou du Sénat. Sans lui, ouvrir l'annuaire en
 * déclencherait autant d'un coup.
 *
 * `ancien` grise le portrait (et les initiales) d'un élu qui ne siège plus et n'est
 * pas ministre, avec le filtre du bandeau « Écrire à mes élus » de la fiche dossier
 * (`PhotoEluBandeau`) : un même élu se lit pareil partout. L'appelant le calcule par
 * `estAncienElu` (`lib/ancien-elu.ts`).
 */

import { useState } from 'react'
import { photoElu } from '@/lib/photo-elu'
import { STYLE_ANCIEN } from '@/lib/ancien-elu'

interface PhotoEluVignetteProps {
  acteur: { uid: string; url_profil_officiel: string | null; prenom: string | null; nom: string | null }
  /** Côté du carré, en pixels. */
  taille: number
  /** Ni député, ni sénateur, ni ministre en exercice : portrait grisé. */
  ancien?: boolean
}

export default function PhotoEluVignette({ acteur, taille, ancien = false }: PhotoEluVignetteProps) {
  const [echec, setEchec] = useState(false)
  const photo = echec ? null : photoElu(acteur)

  const cadre = {
    width: `${taille}px`,
    height: `${taille}px`,
    borderRadius: '8px',
    flexShrink: 0,
    ...(ancien ? STYLE_ANCIEN : {}),
  } as const

  if (!photo) {
    const initiales = [acteur.prenom, acteur.nom].map((p) => p?.[0] ?? '').join('')
    return (
      <div
        aria-hidden
        style={{
          ...cadre,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'var(--color-muted)',
          color: 'var(--color-muted-foreground)',
          fontSize: `${Math.round(taille * 0.34)}px`,
          fontWeight: 500,
        }}
      >
        {initiales}
      </div>
    )
  }

  return (
    // Décoratif : le nom de l'élu est déjà lu juste à côté, un `alt` le
    // répéterait à chaque ligne de la liste.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo.url}
      alt=""
      aria-hidden
      loading="lazy"
      width={taille}
      height={taille}
      onError={() => setEchec(true)}
      style={{ ...cadre, objectFit: 'cover', backgroundColor: 'var(--color-muted)' }}
    />
  )
}
