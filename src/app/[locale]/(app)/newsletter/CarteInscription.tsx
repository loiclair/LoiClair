// La carte d'inscription de /newsletter : titre, phrase, compteur de lecteurs
// éventuel, puis le formulaire (classes `.carte-nl*` de `globals.css`). Composant
// serveur, appelé par `newsletter/page.tsx` ; le formulaire, composant client, arrive
// en `children`. Libellés en props : la page les lit dans le namespace `newsletter`.

import type { ReactNode } from "react"
import { UsersRound } from "lucide-react"

interface CarteInscriptionProps {
  titre: string
  sousTitre: string
  /** Phrase du nombre de lecteurs, absente sous le seuil d'affichage. */
  compteur?: ReactNode
  children: ReactNode
}

export default function CarteInscription({ titre, sousTitre, compteur, children }: CarteInscriptionProps) {
  return (
    <aside className="carte-nl">
      <h2 className="carte-nl-titre">{titre}</h2>
      <p className="carte-nl-sous">{sousTitre}</p>
      {compteur && (
        <p className="carte-nl-compteur">
          <UsersRound aria-hidden="true" style={{ width: 16, height: 16 }} />
          <span>{compteur}</span>
        </p>
      )}
      {children}
    </aside>
  )
}
