"use client"

// Voile flouté posé sur la page pendant une navigation lente.
//
// Pourquoi : D-095 coupe le prefetch sur tout lien de fiche, donc rien n'est
// préparé avant le clic. Une fiche encore jamais générée met 1 à 2,6 s à
// répondre (mesuré en prod le 2026-08-30), et React garde l'ancienne page
// affichée pendant ce temps : le clic semble perdu. Un `loading.tsx` ne
// pouvait rien y faire et les deux ont été supprimés : les fiches sont en
// `force-static`, donc leur réponse part d'un bloc, squelette compris.
//
// Depuis la page d'accueil, qui a sa propre mise en page, même une fiche déjà
// en cache était refabriquée à chaque clic, en 1,8 à 3 s, contre 0,25 s pour la
// même fiche depuis une page d'AppShell (mesuré en prod le 2026-10-10, sur
// l'ancien hébergement, cause exacte non établie). Le voile y sert donc à chaque fois.
//
// Monté une seule fois, par le layout de locale (`[locale]/layout.tsx`), qui
// enveloppe l'accueil, les pages d'AppShell et la 404 : chacune a sa propre
// mise en page, et un montage par mise en page en oubliait une. Il écoute les
// clics au niveau du document plutôt que d'envelopper les vingt-cinq <Link> de
// fiche, qui ont chacun leur propre mise en forme.
//
// Ce fichier ne porte que le déclencheur : le voile lui-même est dans
// `VoileFlou`, partagé avec le saut de mois du fil d'actualité.

import { useEffect, useRef, useState } from "react"
import { usePathname } from "@/i18n/navigation"
import { useTranslations } from "next-intl"
import VoileFlou from "@/components/VoileFlou"

// Une fiche déjà en cache répond en ~0,2 s. Sans cette attente, le voile
// clignoterait à chaque clic, ce qui est plus gênant que le vide qu'il corrige.
const DELAI_AVANT_VOILE_MS = 150

// Filet de sécurité : si la navigation n'aboutit jamais (réseau coupé, route
// en erreur), `pathname` ne change pas et le voile resterait collé à l'écran.
const DUREE_MAX_MS = 8000

export default function NavigationOverlay() {
  const pathname = usePathname()
  const t = useTranslations("common")

  // Pathname d'où part la navigation en cours. Le voile ne s'affiche que tant
  // qu'on y est encore : dès que `pathname` change, la nouvelle page est là.
  const [departEnCours, setDepartEnCours] = useState<string | null>(null)
  const [dernierPathname, setDernierPathname] = useState(pathname)

  // Ajustement d'état pendant le rendu (pattern React) plutôt que dans un
  // effet : sans ce reset, un retour arrière vers la page de départ ferait
  // réapparaître le voile, puisque `departEnCours` y correspondrait de nouveau.
  if (pathname !== dernierPathname) {
    setDernierPathname(pathname)
    setDepartEnCours(null)
  }

  const minuteurVoile = useRef<number | null>(null)
  const minuteurSecurite = useRef<number | null>(null)

  useEffect(() => {
    function annulerMinuteurs() {
      if (minuteurVoile.current !== null) {
        window.clearTimeout(minuteurVoile.current)
        minuteurVoile.current = null
      }
      if (minuteurSecurite.current !== null) {
        window.clearTimeout(minuteurSecurite.current)
        minuteurSecurite.current = null
      }
    }

    function auClic(e: MouseEvent) {
      // `defaultPrevented` ne vaut ici que pour un ancêtre qui aurait annulé
      // le clic en phase de capture : le <Link> de Next, lui, n'a pas encore
      // vu l'événement (voir la phase de capture à l'inscription).
      // Un modificateur ou un bouton secondaire ouvre un onglet : la page
      // courante ne bouge pas, il n'y a rien à signaler.
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const cible = e.target
      if (!(cible instanceof Element)) return
      const lien = cible.closest("a")
      if (!lien) return
      if (lien.target && lien.target !== "_self") return
      if (lien.hasAttribute("download")) return
      // Un lien dont le clic simple ouvre un tiroir (`LigneAmendement`) ne change pas de
      // page : `pathname` ne bougerait pas, et le voile resterait les 8 s du filet.
      if (lien.hasAttribute("data-sans-voile")) return

      const href = lien.getAttribute("href")
      if (!href) return

      let url: URL
      try {
        url = new URL(href, window.location.href)
      } catch {
        return
      }
      // Lien externe, ancre interne, ou lien vers la page déjà ouverte.
      // Le pathname comparé ici porte le préfixe de locale, contrairement à
      // celui de next-intl utilisé plus haut : seul un lien qui changerait la
      // locale sans changer de page les mettrait en désaccord, et il n'en
      // existe pas (LocaleToggle passe par des boutons). Le filet de sécurité
      // couvrirait ce cas s'il apparaissait un jour.
      if (url.origin !== window.location.origin) return
      if (url.pathname === window.location.pathname) return

      annulerMinuteurs()
      minuteurVoile.current = window.setTimeout(
        () => setDepartEnCours(pathname),
        DELAI_AVANT_VOILE_MS
      )
      minuteurSecurite.current = window.setTimeout(
        () => setDepartEnCours(null),
        DUREE_MAX_MS
      )
    }

    // En phase de capture, sinon rien ne se déclenche jamais : le <Link> de
    // Next annule le clic (`preventDefault`) pour naviguer côté client, et
    // React écoute à la racine de l'application. Un écouteur en phase de
    // remontée verrait donc toujours un événement déjà annulé.
    document.addEventListener("click", auClic, true)
    // Le nettoyage tourne aussi à chaque changement de `pathname`, ce qui
    // désarme le minuteur quand la page est arrivée avant les 150 ms.
    return () => {
      document.removeEventListener("click", auClic, true)
      annulerMinuteurs()
    }
  }, [pathname])

  if (departEnCours !== pathname) return null

  return <VoileFlou label={t("navigationLoading")} />
}
