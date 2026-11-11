"use client"

// Coquille des pages de l'app : menu du haut, en-tête commun de la page quand
// `usePageHero` la connaît, rangée de pages sœurs, puis le contenu.

import { useEffect } from "react"
import { Link, usePathname } from "@/i18n/navigation"
import TopNav from "@/components/TopNav"
import PageHero from "@/components/PageHero"
import {
  usePagesSoeurs,
  usePageHero,
} from "@/lib/navigation"
import { cn } from "@/lib/utils"

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const subLinks = usePagesSoeurs(pathname)
  const hero = usePageHero(pathname)

  // Scroll to top on route change (fixes cross-layout-group navigation).
  // Sauf si le hash nomme un élément de la page (`/about#sources`) : la remise en haut
  // passe après le défilement du navigateur vers l'ancre et l'annulait. Un hash d'état
  // (`#q=…` de la liste des textes) ne nomme aucun élément et garde la remise en haut.
  // Un hash mal encodé (`#q=100%` tapé à la main) fait lever `decodeURIComponent` : il ne
  // nomme alors rien, au lieu de faire planter l'effet et la page avec lui.
  useEffect(() => {
    let ancre = ""
    try {
      ancre = decodeURIComponent(window.location.hash.slice(1))
    } catch {}
    const cible = ancre ? document.getElementById(ancre) : null
    if (cible) cible.scrollIntoView({ block: "start" })
    else window.scrollTo(0, 0)
  }, [pathname])


  return (
    <>
      <TopNav />
      <div
        style={{
          minHeight: "100vh",
          paddingTop: "calc(4.5rem + 6px)",
          position: "relative",
        }}
      >
        {/* Subtle warm background tint */}
        <div style={{
          position: "absolute",
          inset: 0,
          backgroundColor: "var(--muted)",
          opacity: 0.3,
          pointerEvents: "none",
        }} />

        {/* Page header + sub-navigation */}
        <div style={{ position: "relative" }}>
          {hero && <PageHero {...hero} />}
          {subLinks && (
            <nav
              className="max-w-[90rem] mx-auto"
              style={{
                display: "flex",
                gap: "0.25rem",
                // Collée au bandeau : toute page qui a une rangée de pages sœurs
                // a aussi un en-tête (`PAGES_L2`).
                paddingTop: "0.625rem",
                paddingBottom: "0.5rem",
                overflowX: "auto",
                paddingLeft: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
                paddingRight: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
              }}
            >
              {subLinks.map((link) => {
                const isActive = pathname === link.href
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "rounded-full no-underline whitespace-nowrap transition-[color,background-color] duration-150",
                      isActive
                        ? "font-semibold text-foreground bg-muted"
                        : "font-normal text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                    style={{
                      padding: "0.375rem 0.75rem",
                      fontSize: "0.8125rem",
                    }}
                  >
                    {link.label}
                  </Link>
                )
              })}
            </nav>
          )}
        </div>

        {/* Main content */}
        <main
          className={cn("mx-auto", pathname === "/Month" ? "w-full max-w-[640px] xl:max-w-[912px] sm:min-h-[calc(100vh-4rem)]" : "max-w-[90rem]")}
          style={{
            position: "relative",
            ...(pathname !== "/Month" && {
              paddingLeft: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
              paddingRight: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
            }),
          }}
        >
          {children}
        </main>
      </div>
    </>
  )
}
