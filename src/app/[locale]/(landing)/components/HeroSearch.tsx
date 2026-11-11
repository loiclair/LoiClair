"use client"

import { Link, useRouter } from "@/i18n/navigation"
import { useEffect, useState, type FormEvent } from "react"
import { useTranslations } from "next-intl"
import { Search, CornerDownLeft, Landmark, RefreshCw, Code } from "lucide-react"

/**
 * Haut du hero de la landing, sur deux colonnes à partir de `lg` : à gauche le titre,
 * le paragraphe de présentation et trois preuves courtes ; à droite une barre de
 * recherche et trois raccourcis qui ouvrent `/dossiers-legislatifs`. Rendu par
 * `Hero.tsx`.
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

const PREUVES = [
  { key: "sources", icon: Landmark },
  { key: "nuit", icon: RefreshCw },
  { key: "openSource", icon: Code },
] as const

/**
 * Trois entrées vers la liste des textes, chacune pour une question de citoyen : ce qui
 * bouge, ce qui va probablement devenir loi, ce qui l'est devenu. Tout passe par le hash,
 * que `useHashFilter` lit au montage : rien à ajouter côté `/dossiers-legislatifs`.
 * « En ce moment » ouvre la liste sans hash, triée par défaut sur la dernière activité.
 * Les textes du gouvernement, à la différence des propositions des parlementaires,
 * deviennent presque tous des lois : une liste courte où chaque ligne compte, là où
 * les dépôts récents mêlaient des centaines de textes sans suite. Le filtre porte sur
 * l'auteur et non sur le type : budget et Sécurité sociale ont chacun leur propre type
 * de procédure, qu'un filtre sur « Projet de loi ordinaire » laissait de côté.
 * Chaque libellé est un `dossiers.quick*` ; la page des textes, elle, montre dans sa
 * rangée de filtres la valeur posée (« Gouvernement », « Statut · 2 »). « Textes promulgués »
 * coche Promulguée et Appliquée : une loi appliquée a d'abord été promulguée, et le statut
 * Promulguée seul ne garde que celles dont un décret d'application manque encore.
 */
const RACCOURCIS = [
  { key: "quickNow", hash: "" },
  { key: "quickGovBills", hash: "#groupe=gouvernement" },
  { key: "quickPromulgated", hash: "#statut=promulguee,appliquee" },
] as const

export function HeroSearch() {
  const t = useTranslations("landing.hero")
  const tLanding = useTranslations("landing")
  const tDossiers = useTranslations("dossiers")
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
    // Deux colonnes à partir de `lg` : le texte à gauche, la recherche en face à droite,
    // centrée sur la hauteur du bloc de gauche. En dessous, une seule colonne, et tout
    // reste aligné à gauche : un paragraphe de plusieurs lignes centré se lit mal.
    <div
      className="grid grid-cols-1 lg:grid-cols-2 lg:items-center"
      style={{ textAlign: "left", gap: "2.5rem 2rem" }}
    >
      <div>
        {/* La largeur est en `em`, donc en nombre de caractères par ligne : elle suit la
          taille du titre et coupe le français en trois lignes (« Ce qui se passe » / « au
          Parlement, traduit » / « en langage courant. ») à toutes les tailles d'écran.
          Pas de `<br>` dans le message : forcé, il déborderait sur un mobile étroit. */}
        <h1
          className="font-bold text-balance"
          style={{
            fontSize: "clamp(1.9rem, 3.8vw, 3.25rem)",
            lineHeight: 1.08,
            letterSpacing: "-0.03em",
            maxWidth: "11.5em",
          }}
        >
          {tLanding("heroTitle")}
        </h1>
        {/* Le paragraphe dit ce que contient le site ; les trois preuves qui le suivent
          disent d'où viennent les données, à quel rythme elles changent et que le code
          est ouvert, et ne se répètent donc pas ici. La signature
          de fin est la seule partie appuyée, d'où le `rich` sur la balise `b`. */}
        <p
          className="text-muted-foreground"
          style={{
            marginTop: "1.25rem",
            maxWidth: "34rem",
            fontSize: "clamp(0.875rem, 0.25vw + 0.79rem, 0.9375rem)",
            lineHeight: 1.6,
          }}
        >
          {tLanding.rich("heroPunchline", {
            // `display: block` plutôt qu'un `<br>` dans le message : la signature garde
            // sa propre ligne et son espace au-dessus dans les deux langues.
            b: (c) => (
              <strong
                className="font-medium text-foreground"
                style={{ display: "block", marginTop: "0.25rem" }}
              >
                {c}
              </strong>
            ),
          })}
        </p>
        {/* Les trois preuves décrivent LoiClair entier, pas la recherche : posées sous la
          barre, elles se lisaient comme ses conditions, et « Mis à jour chaque jour » n'a
          rien à voir avec le fait de chercher un texte. Elles suivent donc le paragraphe
          qu'elles appuient. */}
        <ul
          className="flex flex-wrap"
          style={{
            marginTop: "1.5rem",
            maxWidth: "34rem",
            gap: "0.4rem 1.25rem",
            fontSize: "0.875rem",
            color: "var(--card-foreground)",
          }}
        >
          {PREUVES.map(({ key, icon: Icon }) => (
            <li key={key} className="inline-flex items-center" style={{ gap: "0.4rem" }}>
              <Icon
                aria-hidden
                strokeWidth={1.5}
                style={{
                  width: 15,
                  height: 15,
                  color: "var(--muted-foreground)",
                }}
              />
              {tLanding(`preuves.${key}`)}
            </li>
          ))}
        </ul>
      </div>
      <div>
        {/* Dit ce que fait la barre : sans lui, le seul indice était le mot en train de
          s'écrire, qui se lit comme un texte déjà saisi. */}
        <p className="text-muted-foreground" style={{ fontSize: "0.8125rem" }}>
          {t("searchLabel")}
        </p>
        <form
          role="search"
          onSubmit={chercher}
          className="relative w-full"
          style={{ marginTop: "0.5rem", maxWidth: "34rem" }}
        >
          <Search
            aria-hidden
            className="absolute top-1/2 -translate-y-1/2 text-muted-foreground"
            style={{ left: 20, width: 20, height: 20, pointerEvents: "none" }}
          />
          {/* 16 px au moins : en dessous, Safari sur iPhone zoome toute la page dès qu'on
            touche le champ. La bordure suit le focus par un état, `focus-within` en classe
            Tailwind étant de ceux qui déraillent sur Safari. */}
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
              height: 58,
              paddingLeft: 52,
              paddingRight: 60,
              fontSize: 16,
              fontWeight: 500,
              borderColor: focus ? "var(--primary)" : undefined,
              transition: "border-color 150ms",
            }}
          />
          {/* Les exemples qui s'écrivent seuls n'occupent que le champ vide et sans focus :
            ils se liraient sinon comme un texte déjà saisi, qu'on chercherait à effacer.
            Alignement à gauche explicite : centré, le texte se recentrerait à chaque
            caractère tapé puis effacé. */}
          {!valeur && !focus && (
            <span
              aria-hidden
              className="absolute top-1/2 -translate-y-1/2 font-medium text-foreground"
              style={{ left: 52, right: 60, textAlign: "left", fontSize: 16, pointerEvents: "none", whiteSpace: "nowrap", overflow: "hidden" }}
            >
              {displayed}
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
            style={{ right: 8, width: 40, height: 40 }}
          >
            <CornerDownLeft aria-hidden style={{ width: 16, height: 16 }} />
          </button>
        </form>
        <ul className="flex flex-wrap" style={{ marginTop: "1rem", gap: "0.5rem", maxWidth: "34rem" }}>
          {RACCOURCIS.map(({ key, hash }) => (
            <li key={key}>
              <Link
                href={`/dossiers-legislatifs${hash}`}
                className="inline-flex items-center rounded-full border bg-card transition-colors hover:border-primary hover:text-primary"
                style={{ padding: "0.4rem 0.9rem", fontSize: "0.8125rem", fontWeight: 500 }}
              >
                {tDossiers(key)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
