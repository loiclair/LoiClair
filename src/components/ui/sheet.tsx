"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

import { cva } from "class-variance-authority"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className
      )}
      {...props}
    />
  )
}

// Extension de SheetContent pour supporter la prop 'size' comme dans la doc Shadcn.
// Optimisation : On utilise cva pour gérer dynamiquement les largeurs par size (sm compact, xl large), en remplaçant les conditions if par un système variante plus scalable.
// Ça permet des largeurs responsives (w-full sur mobile, élargies sur desktop pour résumés IA), sans max-width limitante par défaut.
// On garde les animations et shadows pour une UX fluide et élégante.
interface SheetContentProps
  extends React.ComponentProps<typeof SheetPrimitive.Content> {
  side?: "top" | "right" | "bottom" | "left"  // Prop existante pour side.
  size?: "sm" | "default" | "lg" | "xl" | "full" | "content"  // Nouvelle prop size ajoutée, typée comme dans l'exemple.
}

const sheetVariants = cva(  // Nouvelle constante cva pour gérer les variantes side et size.
  "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 p-4 sm:p-6 md:p-8",
  {
    variants: {  // Définition des variantes.
      side: {  // Variante pour side (comme avant, mais intégrée à cva pour combinaison avec size).
        top: "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 border-b",
        bottom: "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 border-t",
        left: "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full border-r",
        right: "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full border-l",
      },
size: {  // Mise à jour pour largeurs relatives au viewport (vw) : s'ajuste à l'écran disponible, avec max-w pour cap.
  sm: "w-[60vw] max-w-[500px] sm:w-[50vw] md:w-[40vw] lg:w-[30vw]",  // Compact, ajuste à 60% base, réduit sur grand écran.
  default: "w-[80vw] max-w-[700px] sm:w-[70vw] md:w-[60vw] lg:w-[50vw]",  // Équilibré, 80% base pour espace sans déborder.
  lg: "w-[85vw] max-w-[800px] sm:w-[70vw] md:w-[60vw] lg:w-[50vw]",  // Plus large, ajuste fluidement.
  xl: "w-[95vw] max-w-[1000px] sm:w-[90vw] md:w-[80vw] lg:w-[70vw]",  // Généreux pour résumés, cap à 1000px max.
  full: "w-full h-full",  // Plein écran, inchangé.
  content: "",  // Adapte au contenu, inchangé.
},
    },
    defaultVariants: {  // Defaults : right pour side, default pour size si non spécifié.
      side: "right",
      size: "default",
    },
  }
)

function SheetContent({
  className,
  children,
  side = "right",
  size,  // Prop size ajoutée aux params.
  ...props
}: SheetContentProps) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          sheetVariants({ side, size }),  // Passe side et size à cva pour générer les classes adaptées.
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
