"use client"

/**
 * Tiroir qui remonte du bas de l'écran, partagé par les deux formulaires montés
 * pour tout le site : le signalement (`SignalerProbleme`) et l'adhésion
 * (`AdhesionDialog`). Bâti sur `components/ui/sheet` (Radix Dialog : Échap,
 * voile et piège de focus fournis).
 *
 * Pleine largeur sur téléphone, centré et borné à 32rem au-delà, coins hauts
 * arrondis. La hauteur est plafonnée à 90dvh et le contenu défile à l'intérieur :
 * `dvh` suit la barre d'adresse de Safari, que `vh` ignore. La largeur maximale
 * passe en style inline, Tailwind v4 étant peu fiable sur Safari pour ce genre
 * de propriété (`CLAUDE.md` §Code).
 */

import type { ReactNode } from "react"
import { Sheet, SheetContent } from "@/components/ui/sheet"

export default function TiroirFormulaire({
  ouvert,
  onOpenChange,
  children,
}: {
  ouvert: boolean
  onOpenChange: (ouvert: boolean) => void
  children: ReactNode
}) {
  return (
    <Sheet open={ouvert} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        size="content"
        className="mx-auto w-full rounded-t-2xl overflow-y-auto gap-0 pt-3"
        style={{ maxWidth: "32rem", maxHeight: "90dvh" }}
      >
        {/* Poignée : signale que le tiroir vient du bas et se referme vers lui. */}
        <div aria-hidden className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />
        {children}
      </SheetContent>
    </Sheet>
  )
}
