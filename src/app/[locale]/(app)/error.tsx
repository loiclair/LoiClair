"use client"

import { Link } from "@/i18n/navigation"
import { Button } from "@/components/ui/button"
import { buttonVariants } from "@/components/ui/button-variants"
import { cn } from "@/lib/utils"
import { Bug, Home, RefreshCw } from "lucide-react"
import { useTranslations } from "next-intl"

// Page d'erreur des pages du site, accueil compris (`(landing)/error.tsx` la
// ré-exporte). « Réessayer » appelle `retry` et non `reset` : `reset` réaffiche
// seulement la page avec les données déjà reçues, donc la même erreur quand c'est la
// base qui n'a pas répondu ; `retry` redemande la page au serveur avant de la
// réafficher (`error-boundary.js` de Next).
export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  const t = useTranslations('errors');

  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: "60vh" }}>
      <div className="space-y-6 max-w-lg">
        <div className="inline-flex items-center gap-2 rounded-full border bg-muted px-3.5 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">{t('errorBadge')}</span>
        </div>

        <h1 className="text-3xl md:text-4xl font-bold tracking-tight" style={{ lineHeight: 1.12 }}>
          {t.rich('errorTitle', {
            highlight: (chunks) => <span className="text-primary">{chunks}</span>,
            br: () => <br />,
          })}
        </h1>

        <p className="text-muted-foreground leading-relaxed">
          {t('errorSubtitle')}
        </p>
        <p className="text-sm italic" style={{ opacity: 0.5 }}>
          {t('errorJoke')}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Button size="lg" className="rounded-full gap-2 hover:scale-105" onClick={retry}>
            <RefreshCw className="h-4 w-4" />
            {t('retry')}
          </Button>
          {/* Le lien porte le style du bouton : un `<button>` dans un `<a>` est un
              élément interactif dans un autre, que le HTML interdit. */}
          <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "rounded-full gap-2 text-primary hover:text-primary")}>
            <Home className="h-4 w-4" />
            {t('home')}
          </Link>
        </div>

        <button
          onClick={() => window.dispatchEvent(new Event("open-signaler"))}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer"
        >
          <Bug className="h-3.5 w-3.5" />
          {t('reportBug')}
        </button>
      </div>
    </div>
  )
}
