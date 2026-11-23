"use client"

import { Link, useRouter } from "@/i18n/navigation"
import { useEffect, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import {
  ArrowRight,
  Baby,
  BriefcaseBusiness,
  CircleCheck,
  Code,
  Euro,
  HeartPulse,
  House,
  Landmark,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"

/**
 * Contenu du hero de la landing, sur une colonne centrée : le titre, le paragraphe de
 * présentation, une grande barre de recherche, cinq sujets du quotidien qui ouvrent la
 * liste des textes filtrée par thème, puis quatre preuves courtes. Rendu par `Hero.tsx`,
 * qui lui passe les sujets avec leur libellé (`sujets`).
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

/** Un sujet du hero : son slug de filtre (`#theme=`), son pictogramme et son libellé traduit. */
export type SujetHero = { slug: string; icone: "logement" | "travail" | "sante" | "argent" | "famille"; libelle: string }

const ICONES_SUJETS: Record<SujetHero["icone"], LucideIcon> = {
  logement: House,
  travail: BriefcaseBusiness,
  sante: HeartPulse,
  argent: Euro,
  famille: Baby,
}

/** Les quatre preuves, chacune une clé de `landing.preuves`. */
const PREUVES = [
  { key: "gratuit", icon: CircleCheck },
  { key: "sources", icon: Landmark },
  { key: "nonPartisan", icon: ShieldCheck },
  { key: "openSource", icon: Code },
] as const

// Hauteur de la barre et taille du bouton, du téléphone au bureau : 60 px et 48 px
// jusqu'à 560 px de large, 70 px et 56 px à partir de 960 px. En `clamp` dans le style
// et non en classes responsives, que Safari lit mal (ARCHITECTURE.md §Pièges Tailwind v4
// sur Safari). La police, 16 px au moins : en dessous, Safari sur iPhone zoome toute la
// page dès qu'on touche le champ ; 18 px au bureau.
const HAUTEUR_BARRE = "clamp(60px, 2.5vw + 46px, 70px)"
const TAILLE_BOUTON = "clamp(48px, 2vw + 37px, 56px)"
const POLICE_BARRE = "clamp(16px, 0.5vw + 13.2px, 18px)"
const MARGE_DROITE = `calc(${TAILLE_BOUTON} + 16px)`

export function HeroSearch({ sujets }: { sujets: SujetHero[] }) {
  const t = useTranslations("landing.hero")
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
        {/* Champ vide et sans focus : l'invitation « Chercher un texte de loi… » puis un
          exemple qui s'écrit seul. L'invitation dit ce que fait la barre ; sans elle,
          l'exemple se lirait comme un texte déjà saisi. Elle est masquée sous `sm`, où
          elle ne laisserait presque plus de place à l'exemple. Alignement à gauche
          explicite : centré, le texte se recentrerait à chaque caractère. */}
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
            <span className="max-sm:hidden text-muted-foreground">{t("searchLabel")}… </span>
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
      <ul className="flex flex-wrap justify-center" style={{ marginTop: "1.25rem", gap: "0.5rem" }}>
        {sujets.map(({ slug, icone, libelle }) => {
          const Icone = ICONES_SUJETS[icone]
          return (
            <li key={slug}>
              <Link
                href={`/dossiers-legislatifs#theme=${slug}`}
                className="inline-flex items-center rounded-full border bg-card transition-colors hover:border-primary hover:text-primary"
                style={{ gap: "0.4rem", padding: "0.45rem 0.85rem", fontSize: "0.875rem", fontWeight: 500 }}
              >
                <Icone aria-hidden strokeWidth={1.5} style={{ width: 15, height: 15, flex: "none", color: "var(--muted-foreground)" }} />
                {libelle}
              </Link>
            </li>
          )
        })}
      </ul>
      {/* Les quatre preuves décrivent LoiClair entier, pas la recherche. */}
      <ul
        className="flex flex-wrap justify-center"
        style={{ marginTop: "1.5rem", gap: "0.45rem 1.25rem", fontSize: "0.875rem", color: "var(--card-foreground)" }}
      >
        {PREUVES.map(({ key, icon: Icon }) => (
          <li key={key} className="inline-flex items-center" style={{ gap: "0.4rem" }}>
            <Icon aria-hidden strokeWidth={1.5} style={{ width: 15, height: 15, color: "var(--primary)" }} />
            {tLanding(`preuves.${key}`)}
          </li>
        ))}
      </ul>
    </div>
  )
}
