"use client"

import { Link, useRouter } from "@/i18n/navigation"
import { useEffect, useState, type FormEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowRight,
  Baby,
  BriefcaseBusiness,
  Ellipsis,
  Euro,
  HeartPulse,
  House,
  Search,
  type LucideIcon,
} from "lucide-react"

/**
 * Contenu du hero de la landing, sur une colonne centrée : le titre, le paragraphe de
 * présentation, une grande barre de recherche, puis cinq sujets du quotidien qui ouvrent
 * la liste des textes filtrée par thème, suivis de « Tous les thèmes » et de leur nombre
 * (`nbThemes`, `null` sans base), qui ouvre la liste menu Thème déplié. Les quatre
 * preuves courtes (gratuit, sources, non partisan, open source) sont dans la carte de
 * fin, `BandeFinale.tsx`. Rendu par `Hero.tsx`, qui lui passe les sujets (`sujets`) et
 * le nombre de thèmes (`nbThemes`).
 *
 * La recherche ne cherche rien ici : elle ouvre `/dossiers-legislatifs#q=…`, dont
 * `DossiersResultsClient` joue la requête au montage. La requête reste dans le hash,
 * jamais envoyé au serveur (D-021).
 *
 * Client pour la saisie et pour l'effet de frappe des exemples.
 */

/**
 * Les exemples qui s'écrivent seuls dans la barre. `enPause` arrête les minuteurs tant que
 * l'effet est masqué (champ rempli ou au focus) : sinon le composant se redessine toutes
 * les 30 à 60 ms pour un texte que personne ne voit.
 */
function useTypewriter(words: string[], enPause: boolean): string {
  const [displayed, setDisplayed] = useState("")
  const [i, setI] = useState(0)
  const [phase, setPhase] = useState<"typing" | "holding" | "deleting">("typing")
  useEffect(() => {
    if (!words.length || enPause) return
    const w = words[i % words.length]
    if (phase === "typing") {
      if (displayed.length < w.length) {
        const t = setTimeout(() => setDisplayed(w.slice(0, displayed.length + 1)), 60)
        return () => clearTimeout(t)
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- machine à états du typewriter : transition entre phases (typing → holding → deleting)
      setPhase("holding")
      return
    }
    if (phase === "holding") {
      const t = setTimeout(() => setPhase("deleting"), 1800)
      return () => clearTimeout(t)
    }
    if (displayed.length > 0) {
      const t = setTimeout(() => setDisplayed(displayed.slice(0, -1)), 30)
      return () => clearTimeout(t)
    }
    setI((x) => (x + 1) % words.length)
    setPhase("typing")
  }, [displayed, phase, i, words, enPause])
  return displayed
}

/**
 * Un sujet du hero : son slug de filtre (`#theme=`), son pictogramme, son libellé court
 * traduit et le nom complet du thème, montré en infobulle.
 */
export type SujetHero = {
  slug: string
  icone: "logement" | "travail" | "sante" | "argent" | "famille"
  libelle: string
  nomComplet: string
}

const ICONES_SUJETS: Record<SujetHero["icone"], LucideIcon> = {
  logement: House,
  travail: BriefcaseBusiness,
  sante: HeartPulse,
  argent: Euro,
  famille: Baby,
}

// Taille commune des pastilles de sujet et de « Tous les thèmes » : 14 px et marges
// serrées sur téléphone, pour en tenir deux par ligne dans les 310 px utiles d'un écran
// de 390 px ; 15 px au bureau. En `clamp`, pour la même raison que la barre ci-dessous.
const STYLE_PASTILLE = {
  gap: "0.4rem",
  padding: "0.5rem clamp(0.75rem, 1.2vw, 0.95rem)",
  fontSize: "clamp(0.875rem, 0.25vw + 0.8rem, 0.9375rem)",
  fontWeight: 500,
  lineHeight: 1.2,
} as const

// Hauteur de la barre et taille du bouton, du téléphone au bureau : 60 px et 48 px
// jusqu'à 560 px de large, 70 px et 56 px à partir de 960 px. En `clamp` dans le style
// et non en classes responsives, que Safari lit mal (ARCHITECTURE.md §Pièges Tailwind v4
// sur Safari). La police, 16 px au moins : en dessous, Safari sur iPhone zoome toute la
// page dès qu'on touche le champ ; 18 px au bureau.
const HAUTEUR_BARRE = "clamp(60px, 2.5vw + 46px, 70px)"
const TAILLE_BOUTON = "clamp(48px, 2vw + 37px, 56px)"
const POLICE_BARRE = "clamp(16px, 0.5vw + 13.2px, 18px)"
const MARGE_DROITE = `calc(${TAILLE_BOUTON} + 16px)`

export function HeroSearch({ sujets, nbThemes }: { sujets: SujetHero[]; nbThemes: number | null }) {
  const t = useTranslations("landing.hero")
  const locale = useLocale()
  const tLanding = useTranslations("landing")
  const words = [
    t("typewriter1"),
    t("typewriter2"),
    t("typewriter3"),
    t("typewriter4"),
    t("typewriter5"),
  ]
  const router = useRouter()
  const [valeur, setValeur] = useState("")
  const [focus, setFocus] = useState(false)
  const displayed = useTypewriter(words, !!valeur || focus)

  function chercher(e: FormEvent) {
    e.preventDefault()
    const q = valeur.trim()
    // Sans mot, la barre ouvre la liste complète, comme le faisait l'ancien lien.
    router.push(q ? `/dossiers-legislatifs#${new URLSearchParams({ q })}` : "/dossiers-legislatifs")
  }

  return (
    <div style={{ maxWidth: "56rem", marginInline: "auto", textAlign: "center" }}>
      {/* La largeur est en `em`, donc en nombre de caractères par ligne : elle suit la
        taille du titre. Pas de `<br>` dans le message : forcé, il déborderait sur un
        mobile étroit. */}
      <h1
        className="font-bold text-balance"
        style={{
          fontSize: "clamp(2.1rem, 4.6vw, 3.9rem)",
          lineHeight: 1.05,
          letterSpacing: "-0.035em",
          maxWidth: "15em",
          marginInline: "auto",
        }}
      >
        {tLanding("heroTitle")}
      </h1>
      {/* La signature de fin est la seule partie appuyée, d'où le `rich` sur la balise `b`. */}
      <p
        className="text-muted-foreground"
        style={{
          marginTop: "1.25rem",
          maxWidth: "40rem",
          marginInline: "auto",
          fontSize: "clamp(1rem, 0.35vw + 0.9rem, 1.125rem)",
          lineHeight: 1.6,
        }}
      >
        {tLanding.rich("heroPunchline", {
          // `display: block` plutôt qu'un `<br>` dans le message : la signature garde
          // sa propre ligne et son espace au-dessus dans les deux langues.
          b: (c) => (
            <strong className="font-semibold text-foreground" style={{ display: "block", marginTop: "0.75rem" }}>
              {c}
            </strong>
          ),
        })}
      </p>
      <form
        role="search"
        onSubmit={chercher}
        className="relative w-full"
        style={{ marginTop: "2rem", marginInline: "auto", maxWidth: "44rem", textAlign: "left" }}
      >
        <Search
          aria-hidden
          className="absolute top-1/2 -translate-y-1/2 text-muted-foreground"
          style={{ left: 22, width: 22, height: 22, pointerEvents: "none" }}
        />
        {/* La bordure suit le focus par un état, `focus-within` en classe Tailwind étant
          de ceux qui déraillent sur Safari. */}
        <input
          type="text"
          value={valeur}
          onChange={(e) => setValeur(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          aria-label={t("searchLabel")}
          enterKeyHint="search"
          autoComplete="off"
          className="w-full rounded-full border bg-card shadow-sm outline-none"
          style={{
            height: HAUTEUR_BARRE,
            paddingLeft: 58,
            paddingRight: MARGE_DROITE,
            fontSize: POLICE_BARRE,
            fontWeight: 500,
            borderColor: focus ? "var(--primary)" : undefined,
            transition: "border-color 150ms",
          }}
        />
        {/* Champ vide et sans focus : un exemple qui s'écrit seul, rien d'autre. Alex a
          retiré l'invitation « Chercher un texte de loi… » qui le précédait (retour sur
          l'essai du 2026-11-22) ; la loupe et le bouton disent ce que fait la barre, et
          son libellé reste lu par les lecteurs d'écran (`aria-label`). Alignement à
          gauche explicite : centré, le texte se recentrerait à chaque caractère. */}
        {!valeur && !focus && (
          <span
            aria-hidden
            className="absolute top-1/2 -translate-y-1/2"
            style={{
              left: 58,
              right: MARGE_DROITE,
              textAlign: "left",
              fontSize: POLICE_BARRE,
              pointerEvents: "none",
              whiteSpace: "nowrap",
              overflow: "hidden",
            }}
          >
            <span className="font-medium text-foreground">{displayed}</span>
            <span
              className="inline-block w-[2px] h-[1em] bg-primary align-text-bottom ml-px"
              style={{ animation: "blink-cursor 1s steps(1) infinite" }}
            />
          </span>
        )}
        <button
          type="submit"
          aria-label={t("searchLabel")}
          className="absolute top-1/2 -translate-y-1/2 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
          style={{ right: 7, width: TAILLE_BOUTON, height: TAILLE_BOUTON }}
        >
          <ArrowRight aria-hidden style={{ width: 21, height: 21 }} />
        </button>
      </form>
      {/* Cinq sujets du quotidien : chacun ouvre la liste des textes avec son thème coché,
        par le hash que `DossiersResultsClient` lit au montage. */}
      <ul className="flex flex-wrap justify-center" style={{ marginTop: "1.25rem", gap: "0.45rem" }}>
        {sujets.map(({ slug, icone, libelle, nomComplet }) => {
          const Icone = ICONES_SUJETS[icone]
          return (
            <li key={slug}>
              {/* Teinte et survol dans `.landing-sujet` (`globals.css`) ; la flèche dit
                qu'on part vers une liste, comme sur les autres liens de l'accueil. */}
              <Link
                href={`/dossiers-legislatifs#theme=${slug}`}
                title={nomComplet !== libelle ? nomComplet : undefined}
                className="landing-sujet inline-flex items-center rounded-full"
                style={{ ...STYLE_PASTILLE, paddingRight: "clamp(0.6rem, 1vw, 0.8rem)" }}
              >
                <Icone aria-hidden strokeWidth={1.75} style={{ width: 16, height: 16, flex: "none", color: "var(--primary)" }} />
                {libelle}
                <ArrowRight aria-hidden strokeWidth={2} style={{ width: 14, height: 14, flex: "none", color: "var(--primary)" }} />
              </Link>
            </li>
          )
        })}
        {/* Les autres thèmes : la liste des textes, menu Thème déplié par `#ouvrir=`
          (lu par `FilterBar`). Fond de carte et contour pointillé (`.landing-sujet-tous`)
          pour qu'on ne la prenne pas pour un sixième thème. */}
        <li>
          <Link
            href="/dossiers-legislatifs#ouvrir=theme"
            className="landing-sujet-tous inline-flex items-center rounded-full"
            style={STYLE_PASTILLE}
          >
            <Ellipsis aria-hidden strokeWidth={2} style={{ width: 16, height: 16, flex: "none", color: "var(--primary)" }} />
            {t("tousLesThemes")}
            {nbThemes !== null && (
              <span className="text-muted-foreground" style={{ fontVariantNumeric: "tabular-nums" }}>
                {nbThemes.toLocaleString(locale)}
              </span>
            )}
          </Link>
        </li>
      </ul>
    </div>
  )
}
