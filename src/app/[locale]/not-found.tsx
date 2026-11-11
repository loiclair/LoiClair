"use client"

import { Link } from "@/i18n/navigation"
import { motion } from "framer-motion"
import { ArrowRight, Bug, Home } from "lucide-react"
import { buttonVariants } from "@/components/ui/button-variants"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"
import SignalerProbleme from "@/components/SignalerProbleme"
import LogoLc from "@/components/LogoLc"

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: "easeOut" as const } },
}

export default function NotFound() {
  const t = useTranslations('errors');

  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: "100dvh" }}>
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="visible"
        className="space-y-6 max-w-lg"
      >
        {/* La case Lc complète : la page est un « élément introuvable » du tableau
            dont LoiClair est l'élément Lc (voir le badge). */}
        <LogoLc variante="complet" taille={120} style={{ color: "var(--logo)", marginLeft: "auto", marginRight: "auto" }} />

        {/* Badge */}
        <div className="inline-flex items-center gap-2 rounded-full border bg-muted px-3.5 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {t('notFoundBadge')}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.12]">
          {t.rich('notFoundTitle', {
            highlight: (chunks) => <span className="text-primary">{chunks}</span>,
          })}
        </h1>

        {/* Subtitle */}
        <p className="text-lg text-muted-foreground leading-relaxed">
          {t('notFoundSubtitle')}
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed italic" style={{ opacity: 0.6 }}>
          {t('notFoundJoke')}
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed" style={{ opacity: 0.7 }}>
          {t('notFoundHelp')}
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          {/* Les liens portent le style du bouton : un `<button>` dans un `<a>` est un
              élément interactif dans un autre, que le HTML interdit. */}
          <Link href="/" className={cn(buttonVariants({ size: "lg" }), "rounded-full gap-2 hover:scale-105")}>
            <Home className="h-4 w-4" />
            {t('home')}
          </Link>
          <Link href="/dossiers-legislatifs" className={cn(buttonVariants({ variant: "ghost", size: "lg" }), "rounded-full gap-2 text-primary hover:text-primary")}>
            {t('viewDossiers')}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <button
          onClick={() => window.dispatchEvent(new Event("open-signaler"))}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer"
        >
          <Bug className="h-3.5 w-3.5" />
          {t('reportBug')}
        </button>
      </motion.div>
      <SignalerProbleme />
    </div>
  )
}
