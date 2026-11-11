"use client"

import { useState, useEffect, useRef } from "react"
import { Link, usePathname } from "@/i18n/navigation"
import { defilementProgramme } from "@/lib/defilement-programme"
import { Menu, ChevronDown, Mail } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { useNavCategories, getActiveCategoryKey, isSubLinkActive, type NavCategory } from "@/lib/navigation"
import RechercheGlobale from "@/components/RechercheGlobale"
import LogoLc from "@/components/LogoLc"
import { Element } from "@/components/ui/Element"
import { couleurElement, elementDeRoute } from "@/lib/elements"

/**
 * Style d'un sous-lien de menu, commun au menu déroulant du bureau et au panneau
 * mobile pour que les deux ne divergent plus. Titre en couleur pleine : tout en
 * gris, le menu ouvert paraissait éteint. La page active se distingue par le fond
 * teinté. Chaque appelant ajoute son padding, et le bureau son survol.
 */
function styleSousLien(isSubActive: boolean): React.CSSProperties {
  return {
    display: "block",
    fontSize: "0.875rem",
    borderRadius: "0.375rem",
    color: "var(--foreground)",
    backgroundColor: isSubActive ? "var(--accent)" : "transparent",
    fontWeight: 500,
    textDecoration: "none",
  }
}

/**
 * La case de l'élément de `href` dans le panneau mobile, pleine comme dans les
 * en-têtes. 28 px, la taille du logo de l'en-tête : à 40 px, les cases prenaient
 * le pas sur les libellés et la liste se lisait mal. Taille `titre`, mesurée en
 * `em`, d'où le `fontSize`. Rien pour une page sans élément.
 */
function CaseMenu({ href }: { href: string }) {
  const el = elementDeRoute(href)
  if (!el) return null
  return <Element taille="titre" numero={el.numero} symbole={el.symbole} couleur={couleurElement(el.cle)} style={{ fontSize: 28 }} />
}

/**
 * Une entrée du menu dans le panneau mobile : un lien simple, ou un groupe
 * repliable, ouvert d'office quand on est sur l'une de ses pages. Chaque lien qui
 * mène à la page d'un élément porte sa case (`CaseMenu`).
 */
function MobileCategory({ category, activeKey, onNavigation }: { category: NavCategory; activeKey: string | null; onNavigation: () => void }) {
  const pathname = usePathname()
  const isActive = activeKey === category.key
  const [open, setOpen] = useState(isActive)

  // No sub-links — single link
  if (!category.subLinks || category.subLinks.length === 0) {
    return (
      <Link
        href={category.href}
        onClick={onNavigation}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          padding: "0.375rem 0",
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
          textDecoration: "none",
        }}
      >
        <CaseMenu href={category.href} />
        {category.label}
      </Link>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
          width: "100%",
          padding: "0.5rem 0",
          fontSize: "0.9375rem",
          fontWeight: 500,
          color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        {category.label}
        <ChevronDown
          style={{
            width: "0.875rem",
            height: "0.875rem",
            transition: "transform 200ms",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            opacity: 0.5,
          }}
        />
      </button>
      {open && (
        <div style={{ paddingLeft: "0.75rem", display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          {category.subLinks.map((link) => {
            const isSubActive = isSubLinkActive(link, pathname)
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onNavigation}
                style={{ ...styleSousLien(isSubActive), display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.375rem 0.75rem" }}
              >
                <CaseMenu href={link.href} />
                {link.label}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * Replie le menu quand on descend, le redéploie dès qu'on remonte.
 *
 * Rend `true` quand le menu doit être caché. Quatre garde-fous : les 100 premiers pixels
 * ne replient jamais (sinon le menu sautille au moindre geste en haut de page), un
 * mouvement doit dépasser 6 px pour compter (le rebond élastique d'iOS en produit de
 * plus petits en continu), `menuOuvert` gèle tout, pour ne pas emporter le panneau
 * mobile avec l'en-tête qui le porte, et un défilement que la page a déclenché
 * elle-même force l'affichage (`lib/defilement-programme.ts`).
 *
 * La position se lit dans un `requestAnimationFrame` : l'événement `scroll` part à
 * chaque frame pendant un défilement, et un `setState` par événement rendrait le
 * composant entier autant de fois.
 */
function useMenuReplie(menuOuvert: boolean): boolean {
  const [replie, setReplie] = useState(false)
  const dernierY = useRef(0)
  const enAttente = useRef(false)

  useEffect(() => {
    // Menu ouvert : aucun écouteur, et c'est le retour du hook qui force l'affichage.
    // L'état n'est pas remis à zéro ici, un `setState` dans un effet étant refusé par
    // `react-hooks/set-state-in-effect` ; il n'en a pas besoin, puisqu'on ne peut
    // ouvrir le menu que lorsqu'il est déjà visible.
    if (menuOuvert) return
    dernierY.current = window.scrollY

    function onScroll() {
      if (enAttente.current) return
      enAttente.current = true
      requestAnimationFrame(() => {
        enAttente.current = false
        const y = window.scrollY
        const delta = y - dernierY.current
        if (Math.abs(delta) < 6) return
        dernierY.current = y
        // Un défilement que la page a déclenché elle-même ne replie pas l'en-tête
        // et le redéploie : un saut d'ancre descend, et la section visée arrivait
        // sinon sous la bande de 78 px que `scroll-margin-top` lui réserve, vide.
        // Le suivi de `dernierY` continue, donc le premier geste qui suit repart
        // de la bonne position.
        if (defilementProgramme()) { setReplie(false); return }
        setReplie(y > 100 && delta > 0)
      })
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [menuOuvert])

  return replie && !menuOuvert
}

/**
 * En-tête fixe du site : logo, les six entrées de `useNavCategories()`, puis à
 * droite le lien « À propos », un trait fin, le bouton « S'abonner » vers
 * `/newsletter` (ni l'un ni l'autre n'a d'entrée de menu) et la loupe ronde de la
 * recherche globale (`RechercheGlobale`). Sous `lg`, le menu, « À propos » et
 * « S'abonner » passent dans un panneau latéral, la loupe reste à côté du burger.
 * Rendu par `AppShell` et par le layout de l'accueil.
 */
export default function TopNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const t = useTranslations("common")
  const tFooter = useTranslations("footer")
  const replie = useMenuReplie(open)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- ferme le menu mobile à chaque changement de route
  useEffect(() => { setOpen(false) }, [pathname])

  const categories = useNavCategories()
  const activeKey = getActiveCategoryKey(categories, pathname)

  return (
    <header
      className="topnav-repli"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        // Le `transform` déplace la boîte peinte sans toucher au flux : rien ne bouge
        // sous l'en-tête, qui reste fixe. La transition qui l'accompagne est dans
        // `.topnav-repli` (globals.css), pour que prefers-reduced-motion puisse la couper.
        transform: replie ? "translateY(-100%)" : "translateY(0)",
      }}
    >
      {/* Color bar */}
      <div style={{ height: "6px", backgroundColor: "var(--primary)" }} />
      <div
        style={{
          height: "4.5rem",
          display: "flex",
          alignItems: "center",
          backgroundColor: "var(--background)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "none",
        }}
      >
      <div
        className="max-w-[90rem] mx-auto"
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          paddingLeft: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
          paddingRight: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
        }}
      >
      {/* Logo + Desktop nav links — grouped together */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        {/* La case Lc puis le nom, gardé en texte : un lecteur d'écran lit le
            libellé du lien, la case étant décorative. Elle coûte ~38 px de la
            largeur du menu, dont il ne reste que ~156 px de libre à 1024 px (D-225). */}
        <Link
          href="/"
          aria-label={t("homeLabel")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.625rem",
            fontWeight: 700,
            fontSize: "1.125rem",
            letterSpacing: "-0.01em",
            color: "var(--foreground)",
            textDecoration: "none",
            marginRight: "0.5rem",
          }}
        >
          <LogoLc taille={28} style={{ color: "var(--logo)" }} />
          {t("appName")}
        </Link>

        <nav
          style={{ alignItems: "center", gap: "0.25rem" }}
          className="max-lg:hidden flex"
        >
          {categories.map((cat) => {
            const isActive = activeKey === cat.key
            const linkStyle: React.CSSProperties = {
              padding: "0.375rem 0.75rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: isActive ? "var(--foreground)" : "var(--muted-foreground)",
              textDecoration: "none",
              background: "transparent",
              transition: "color 150ms",
            }
            if (cat.subLinks && cat.subLinks.length > 0) {
              return (
                <NavigationMenu key={cat.key}>
                  <NavigationMenuList>
                    <NavigationMenuItem>
                      <NavigationMenuTrigger
                        className="bg-transparent hover:bg-transparent focus:bg-transparent data-[state=open]:bg-transparent"
                        style={linkStyle}
                        onPointerMove={(e) => e.preventDefault()}
                        onPointerLeave={(e) => e.preventDefault()}
                        onMouseEnter={(e) => {
                          if (!isActive) e.currentTarget.style.color = "var(--primary)"
                        }}
                        onMouseLeave={(e) => {
                          if (!isActive) e.currentTarget.style.color = "var(--muted-foreground)"
                        }}
                      >
                        {cat.label}
                      </NavigationMenuTrigger>
                      <NavigationMenuContent
                        onPointerEnter={(e) => e.preventDefault()}
                        onPointerLeave={(e) => e.preventDefault()}
                      >
                        <ul style={{ display: "flex", flexDirection: "column", gap: "0.125rem", minWidth: "18rem", padding: "0.25rem" }}>
                          {cat.subLinks.map((link) => {
                            const isSubActive = isSubLinkActive(link, pathname)
                            return (
                              <li key={link.href}>
                                <NavigationMenuLink asChild>
                                  <Link
                                    href={link.href}
                                    // Survol en teal, comme les entrées du menu du haut,
                                    // et non par le fond teinté, réservé à la page active.
                                    // La description garde son gris : elle porte sa
                                    // propre couleur.
                                    style={{ ...styleSousLien(isSubActive), padding: "0.5rem 0.75rem", transition: "color 150ms" }}
                                    onMouseEnter={(e) => {
                                      if (!isSubActive) e.currentTarget.style.color = "var(--primary)"
                                    }}
                                    onMouseLeave={(e) => {
                                      if (!isSubActive) e.currentTarget.style.color = "var(--foreground)"
                                    }}
                                  >
                                    {link.label}
                                    {link.description && (
                                      <span style={{ display: "block", fontSize: "0.75rem",
                                        color: "var(--muted-foreground)", marginTop: "0.125rem" }}>
                                        {link.description}
                                      </span>
                                    )}
                                  </Link>
                                </NavigationMenuLink>
                              </li>
                            )
                          })}
                        </ul>
                      </NavigationMenuContent>
                    </NavigationMenuItem>
                  </NavigationMenuList>
                </NavigationMenu>
              )
            }
            return (
              <Link
                key={cat.key}
                href={cat.href}
                style={linkStyle}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.color = "var(--primary)"
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.color = "var(--muted-foreground)"
                }}
              >
                {cat.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Côté droit (bureau) : À propos, trait, S'abonner, loupe ronde */}
      <div
        className="max-lg:hidden flex"
        style={{
          marginLeft: "auto",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <Link
          href="/about"
          style={{
            padding: "0.375rem 0.25rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            color: pathname === "/about" ? "var(--foreground)" : "var(--muted-foreground)",
            textDecoration: "none",
            whiteSpace: "nowrap",
            transition: "color 150ms",
          }}
          onMouseEnter={(e) => { if (pathname !== "/about") e.currentTarget.style.color = "var(--primary)" }}
          onMouseLeave={(e) => { if (pathname !== "/about") e.currentTarget.style.color = "var(--muted-foreground)" }}
        >
          {tFooter("about")}
        </Link>
        <span aria-hidden style={{ width: "1px", height: "1.75rem", backgroundColor: "var(--border)" }} />
        <Link
          href="/newsletter"
          style={{
            display: "inline-flex", alignItems: "center",
            height: "1.9375rem",
            padding: "0 1rem",
            fontSize: "0.875rem", fontWeight: 600,
            whiteSpace: "nowrap",
            color: "var(--primary-foreground)",
            backgroundColor: "var(--primary)",
            borderRadius: "9999px",
            textDecoration: "none",
            transition: "opacity 150ms",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.85" }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1" }}
        >
          {t("subscribe")}
        </Link>
        <RechercheGlobale compacte />
      </div>

      {/* Mobile : loupe + burger */}
      <div className="lg:hidden flex" style={{ marginLeft: "auto", alignItems: "center", gap: "0.25rem" }}>
        <RechercheGlobale />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("openMenu")}>
              <Menu style={{ width: "1.25rem", height: "1.25rem" }} />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" style={{ width: "16rem", padding: "1.5rem" }}>
            <SheetTitle className="sr-only">{t("navMenu")}</SheetTitle>
            <nav style={{ display: "flex", flexDirection: "column", gap: "0.25rem", paddingTop: "1.5rem" }}>
              {categories.map((cat) => (
                <MobileCategory key={cat.key} category={cat} activeKey={activeKey} onNavigation={() => setOpen(false)} />
              ))}
              <Link
                href="/about"
                onClick={() => setOpen(false)}
                style={{
                  display: "block",
                  padding: "0.5rem 0",
                  fontSize: "0.9375rem",
                  fontWeight: 500,
                  color: pathname === "/about" ? "var(--foreground)" : "var(--muted-foreground)",
                  textDecoration: "none",
                }}
              >
                {tFooter("about")}
              </Link>
              <div style={{ marginTop: "0.5rem" }}>
                <Link
                  href="/newsletter"
                  onClick={() => setOpen(false)}
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.375rem",
                    padding: "0.5rem 1rem",
                    fontSize: "0.8125rem", fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    color: "var(--foreground)",
                    border: "1px solid var(--border)",
                    borderRadius: "9999px",
                    textDecoration: "none",
                    width: "100%",
                  }}
                >
                  <Mail style={{ width: "0.75rem", height: "0.75rem" }} />
                  {t("subscribe")}
                </Link>
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
      </div>
      </div>
    </header>
  )
}
