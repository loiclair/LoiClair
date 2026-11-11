"use client"

// Infobulle commune du site, sur la primitive Radix (composant shadcn).
// Toutes les infobulles textuelles passent par ici (les graphiques gardent
// celles de Recharts) : un réglage de rendu changé dans `TooltipContent` vaut
// pour chacune.

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

// Bulle affichée dans un portail. Largeur maximale commune de 320 px, en style
// inline (une classe `max-w-*` n'est pas fiable sous Safari, cf. CLAUDE.md) :
// chaque appelant fixait la sienne (260, 280, 300, 320 px) et deux bulles
// voisines n'avaient pas la même. Pour une autre largeur, passer un `style` :
// une classe `max-w-*` de l'appelant serait écrasée par ce style inline.
// Retour à la ligne normal, sans `text-balance` (défaut de shadcn) ni
// `text-pretty`. `balance` raccourcit les lignes pour les égaliser, mais la
// bulle garde sa largeur maximale, d'où une bande vide à droite d'un long texte.
// Avec `pretty`, Chrome remplissait bien les lignes, mais Safari (iPhone, le
// 2026-10-20) laissait le même vide qu'avec `balance`.
// `collisionPadding` de 16 px : à 0 (défaut de Radix), une bulle repoussée par
// le bord de l'écran s'y collait, ce qui arrivait à presque toutes en largeur
// téléphone. La largeur maximale retranche ces deux marges de l'écran : sur un
// écran de 320 px (iPhone SE en affichage agrandi), une bulle de 320 px ne
// tiendrait pas entre elles et déborderait.
// Interligne de 1,45 pour toutes les bulles, celui que portait déjà le ⓘ du
// bandeau de contact, en style inline comme la largeur. Un enfant en `text-xs`
// ou `leading-*` le remplacerait par le sien.
function TooltipContent({
  className,
  sideOffset = 0,
  collisionPadding = 16,
  style,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "bg-foreground text-background animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md px-3 py-1.5 text-xs",
          className
        )}
        style={{ maxWidth: "min(320px, calc(100vw - 32px))", lineHeight: 1.45, ...style }}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
