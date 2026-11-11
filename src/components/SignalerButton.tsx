"use client"

import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"

// Ouvre le tiroir `SignalerProbleme`, monté une fois pour toutes par
// `(app)/layout.tsx` et qui écoute l'événement `open-signaler`. Ce composant
// n'existe que parce qu'un Server Component ne peut pas porter d'`onClick` ;
// `FooterOuvreTiroir` fait la même chose mais porte les couleurs du pied de
// page, qui ne conviennent pas au corps d'une page.
//
// Le `detail` fait atterrir le visiteur sur le formulaire « donnée incorrecte »
// plutôt que sur le menu à trois choix : le libellé du bouton promet un
// signalement d'erreur, l'écran qui s'ouvre doit tenir cette promesse.
export default function SignalerButton({ label }: { label: string }) {
  return (
    <Button
      size="sm"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("open-signaler", {
            detail: { category: "probleme", type: "donnee-incorrecte" },
          }),
        )
      }
    >
      <AlertTriangle className="h-4 w-4" />
      {label}
    </Button>
  )
}
