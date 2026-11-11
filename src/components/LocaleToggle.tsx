"use client"

// Bascule FR / EN du pied de page. Passer en anglais ouvre d'abord un dialogue qui ne
// dit que l'exception : ce que l'IA écrit ou traduit (avec ses erreurs possibles) et ce
// qui reste en français. Ses textes sont en anglais en dur, dans les deux langues : il
// s'adresse à qui veut quitter le français. À tenir à jour quand un contenu est traduit
// (titres des dossiers, des lois et des scrutins : `pipeline/traduire_titres.py` ;
// résumés du Conseil constitutionnel : `import_cc_decisions.py`) ou cesse de l'être.

import { useState, useTransition } from "react"
import { useLocale } from "next-intl"
import { useRouter, usePathname } from "@/i18n/navigation"
import { memoriserLangue } from "@/i18n/choix-langue"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"
import { RiSparkling2Fill } from "react-icons/ri"

export default function LocaleToggle() {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  // La requête et le fragment suivent : sans eux, un résultat de quiz (`?g=…`) ou une
  // recherche (`#q=…`) se perdaient au changement de langue. Lus sur `window` au
  // clic, `usePathname` ne portant ni l'un ni l'autre.
  function applyLocale(next: "fr" | "en") {
    memoriserLangue(next)
    startTransition(() => {
      router.replace(`${pathname}${window.location.search}${window.location.hash}`, { locale: next })
    })
  }

  function handleClick(next: "fr" | "en") {
    if (next === locale) return
    if (next === "en") {
      setOpen(true)
    } else {
      applyLocale(next)
    }
  }

  function handleConfirm() {
    setOpen(false)
    applyLocale("en")
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontSize: "0.75rem", fontWeight: 500 }}>
        <button
          type="button"
          onClick={() => handleClick("fr")}
          disabled={isPending}
          aria-pressed={locale === "fr"}
          lang="fr"
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontFamily: "inherit", fontSize: "inherit",
            fontWeight: locale === "fr" ? 600 : 500,
            color: locale === "fr" ? "var(--footer-heading)" : "var(--footer-fg)",
            opacity: isPending ? 0.5 : 1,
            transition: "color 150ms",
          }}
        >
          FR
        </button>
        <span aria-hidden="true" style={{ color: "var(--footer-fg)", opacity: 0.4 }}>·</span>
        <button
          type="button"
          onClick={() => handleClick("en")}
          disabled={isPending}
          aria-pressed={locale === "en"}
          lang="en"
          style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontFamily: "inherit", fontSize: "inherit",
            fontWeight: locale === "en" ? 600 : 500,
            color: locale === "en" ? "var(--footer-heading)" : "var(--footer-fg)",
            opacity: isPending ? 0.5 : 1,
            transition: "color 150ms",
          }}
        >
          EN
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent largeurMax="24rem">
          <DialogHeader>
            <DialogTitle>Switch to English?</DialogTitle>
            <DialogDescription>
              The whole site is available in English, except the content listed below.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-sm">
            <div>
              <p className="flex items-center gap-1.5 font-medium text-foreground mb-1.5">
                <RiSparkling2Fill aria-hidden size={14} className="text-amber-500 shrink-0" />
                Translated by AI
              </p>
              <p className="text-muted-foreground">
                Bill, law and vote titles, summaries and analyses are written or translated by AI and may contain errors.
                The official French title, which alone is authoritative, is shown on each bill&apos;s page.
              </p>
            </div>

            <div>
              <p className="flex items-center gap-1.5 font-medium text-foreground mb-1.5">
                <AlertTriangle className="size-3.5 text-amber-500 shrink-0" />
                Will stay in French
              </p>
              <ul className="space-y-1 pl-5 text-muted-foreground">
                <li>Verbatim parliamentary debate transcripts</li>
                <li>Political group names</li>
                <li>Committee and delegation names</li>
                <li>Press articles and the weekly newsletter</li>
              </ul>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirm}>
              Switch to English
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
