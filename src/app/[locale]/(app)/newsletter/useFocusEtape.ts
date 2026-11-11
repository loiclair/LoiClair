"use client"

// Déplace le focus sur le titre de l'étape (`EtatParcours`, id `ID_TITRE_ETAPE`)
// quand une page client du parcours change d'étape sans navigation : le bouton qui
// avait le focus disparaît avec l'étape précédente, et le focus retombait au début
// du document, perdu pour qui navigue au clavier ou au lecteur d'écran. Appelé par
// `confirmer`, `desabonner` et `desabonner/confirmer` avec le titre affiché : rien au
// premier rendu, le focus ne bouge qu'au changement de titre. Fichier à part,
// marqué client : `EtatParcours` est aussi importé par des pages serveur.

import { useEffect, useRef } from "react"
import { ID_TITRE_ETAPE } from "./EtatParcours"

export function useFocusEtape(titre: string) {
  const precedent = useRef(titre)
  useEffect(() => {
    if (precedent.current === titre) return
    precedent.current = titre
    document.getElementById(ID_TITRE_ETAPE)?.focus()
  }, [titre])
}
