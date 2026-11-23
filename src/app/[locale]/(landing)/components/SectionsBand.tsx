"use client"

import { useState, type CSSProperties, type ReactNode } from "react"
import { Link } from "@/i18n/navigation"
import { memoriserLangue } from "@/i18n/choix-langue"
import { useLocale, useTranslations } from "next-intl"
import { ArrowRight, BadgeCheck, FileText, Mail, Minus, ThumbsDown, ThumbsUp } from "lucide-react"
import { RiSparkling2Fill } from "react-icons/ri"
import { couleurElement, element, type CleElement } from "@/lib/elements"
import { Element } from "@/components/ui/Element"
import { Ligne, STYLE_TITRE_SECTION } from "./Maquettes"

// Section « Aussi sur LoiClair », après la section Confiance de la landing : six cartes
// à mini-maquette animée, les usages que les sections numérotées ne présentent pas. Trois
// mènent aux sections du site et prennent le titre du menu (`nav`) : le fil
// d'actualité, le parcours d'une loi, les quiz. Trois montrent ce qui n'a pas d'entrée
// au menu : interroger son IA sur un texte, la newsletter, lire le site dans l'autre
// langue. Leur titre vient de `landing.aussi` (`titre`), comme toutes les descriptions :
// le namespace `newsletter` n'est pas envoyé au navigateur sur l'accueil.
//
// La grille se lit comme un petit tableau périodique : chaque carte porte la case de
// son élément (`lib/elements.ts`) devant son titre, et les cartes suivent l'ordre
// des numéros.
//
// Les mini-maquettes sont abstraites : des formes et des lignes grises, jamais un
// chiffre ni un nom, qui se liraient comme des faits (voir `Maquettes.tsx`). Leurs
// animations vivent dans `globals.css` (`.landing-mini-*`), pour que
// prefers-reduced-motion les coupe.

type Cle = "actualite" | "quiz" | "processus" | "ia" | "newsletter" | "langue"

// `autreLangue` envoie le lien dans l'autre locale au lieu de la courante. Le lien
// est la page de l'élément (`route` dans `lib/elements.ts`) : une seule adresse à
// tenir par rubrique.
type Carte = { key: Cle; element: CleElement; autreLangue?: true } & (
  | { nav: string }
  | { titre: "iaTitre" | "newsletterTitre" | "langueTitre" }
)

// Dans l'ordre des numéros d'élément. Les textes, les élus, l'état des lieux, les faits
// et « Pour moi » ont chacun leur section numérotée plus haut (01 à 06), et n'ont donc
// plus de carte ici (LOI-91).
const SECTIONS: Carte[] = [
  { key: "actualite", element: "fil", nav: "newsFeedShort" },
  { key: "processus", element: "processus", nav: "legislativeProcess" },
  { key: "quiz", element: "quiz", nav: "quiz" },
  // Les liens vers les IA sont sous chaque résumé ; la page MCP dit comment brancher
  // son assistant sur les données.
  { key: "ia", element: "ia", titre: "iaTitre" },
  { key: "newsletter", element: "newsletter", titre: "newsletterTitre" },
  // L'accueil dans l'autre langue, sans passer par la fenêtre de `LocaleToggle`. Elle
  // seule liste ce qui reste en français : la description de la carte reste générale
  // pour ne pas la contredire quand un contenu de plus est traduit.
  { key: "langue", element: "bilingue", titre: "langueTitre", autreLangue: true },
]

const PRIMAIRE = "var(--primary)"
const VERT = "#27AE60"
const ROUGE = "#E74C3C"

/** Teinte légère d'une couleur sur le fond de carte, valable en thème clair et sombre. */
const teinte = (couleur: string, part: number) => `color-mix(in srgb, ${couleur} ${part}%, transparent)`

/** Une forme animée : `classe` choisit le mouvement, `ordre` décale son entrée. */
function Anime({ classe, ordre, style, children }: { classe: string; ordre: number; style?: CSSProperties; children?: ReactNode }) {
  return (
    <span className={classe} style={{ display: "block", "--ordre": ordre, ...style } as CSSProperties}>
      {children}
    </span>
  )
}

/** Puce ronde pleine, pour les pastilles de statut et les étapes. */
function Pastille({ couleur, taille = 10 }: { couleur: string; taille?: number }) {
  return <span style={{ display: "block", width: taille, height: taille, borderRadius: 999, flex: "none", backgroundColor: couleur }} />
}

/**
 * Demi-cercle de sièges, pour figurer une chambre : deux arcs pointillés épais, chaque
 * tiret un siège. Gris, sans couleur de groupe, qui se lirait comme une composition.
 */
function Hemicycle() {
  return (
    <svg viewBox="0 0 40 22" style={{ width: 52, height: 29, flex: "none" }}>
      <path d="M3 21 A17 17 0 0 1 37 21" fill="none" stroke="var(--muted-foreground)" strokeOpacity="0.4" strokeWidth="4" strokeDasharray="2.6 1.6" />
      <path d="M10 21 A10 10 0 0 1 30 21" fill="none" stroke="var(--muted-foreground)" strokeOpacity="0.4" strokeWidth="4" strokeDasharray="2.4 1.6" />
    </svg>
  )
}

/** La mini-maquette de chaque section : une forme qui évoque sa page, sans donnée. */
const MAQUETTES: Record<Cle, ReactNode> = {
  // Trois événements datés qui arrivent l'un après l'autre, comme le fil.
  actualite: (
    <div style={{ display: "grid", gap: 12 }}>
      {[78, 90, 62].map((l, i) => (
        <Anime key={i} classe="landing-mini-entree" ordre={i * 2}>
          <span className="flex items-center" style={{ gap: 10 }}>
            <span className="landing-carte-maquette" style={{ width: 34, height: 18, borderRadius: 6, flex: "none" }} />
            <Ligne largeur={l} />
          </span>
        </Anime>
      ))}
    </div>
  ),
  // Une conversation avec une IA : la question du lecteur à droite, puis la réponse à
  // gauche, marquée de l'étincelle or des contenus écrits par une IA, celle du badge IA.
  ia: (
    <div style={{ display: "grid", gap: 10 }}>
      <Anime classe="landing-mini-entree" ordre={0} style={{ justifySelf: "end", width: "62%" }}>
        <span style={{ display: "grid", gap: 5, padding: "9px 11px", borderRadius: "12px 12px 4px 12px", backgroundColor: teinte(PRIMAIRE, 14) }}>
          <Ligne largeur={90} hauteur={5} />
          <Ligne largeur={60} hauteur={5} />
        </span>
      </Anime>
      <Anime classe="landing-mini-entree" ordre={4} style={{ width: "80%" }}>
        <span className="flex" style={{ gap: 8, padding: "9px 11px", borderRadius: "12px 12px 12px 4px", border: "1px solid var(--border)" }}>
          <RiSparkling2Fill aria-hidden size={13} style={{ flex: "none", color: "#D4A54A" }} />
          <span style={{ flex: 1, display: "grid", gap: 5 }}>
            <Ligne largeur={95} hauteur={5} />
            <Ligne largeur={82} hauteur={5} />
            <Ligne largeur={50} hauteur={5} />
          </span>
        </span>
      </Anime>
    </div>
  ),
  // Une partie en cours : la progression du quiz, une question, puis trois réponses
  // (pour, contre, abstention) dont l'une est choisie.
  quiz: (
    <div>
      <div className="flex" style={{ gap: 4 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} style={{ flex: 1, height: 5, borderRadius: 999, backgroundColor: "var(--border)", overflow: "hidden" }}>
            {i < 2 && <Anime classe="landing-mini-x" ordre={i * 2} style={{ height: "100%", backgroundColor: PRIMAIRE }} />}
          </span>
        ))}
      </div>
      <div className="flex items-center" style={{ gap: 10, marginTop: 12 }}>
        <span
          className="flex items-center justify-center"
          style={{ width: 28, height: 28, flex: "none", borderRadius: 999, backgroundColor: teinte(PRIMAIRE, 16), color: PRIMAIRE, fontSize: 15, fontWeight: 700 }}
        >
          ?
        </span>
        <span style={{ flex: 1, display: "grid", gap: 5 }}>
          <Ligne largeur={92} hauteur={6} />
          <Ligne largeur={64} hauteur={6} />
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 12 }}>
        {(
          [
            [ThumbsUp, VERT],
            [ThumbsDown, ROUGE],
            [Minus, "var(--muted-foreground)"],
          ] as const
        ).map(([Icone, c], i) => (
          <span
            key={i}
            className={`flex items-center justify-center${i === 0 ? " landing-mini-choix" : ""}`}
            style={{ "--choix": c, height: 28, borderRadius: 10, boxShadow: "inset 0 0 0 1px var(--border)", color: c } as CSSProperties}
          >
            <Icone style={{ width: 14, height: 14 }} />
          </span>
        ))}
      </div>
    </div>
  ),
  // La navette : un texte passe de l'Assemblée au Sénat et revient, puis reçoit le sceau
  // de la promulgation. Dessous, le parcours dont les étapes se valident l'une après
  // l'autre.
  processus: (
    <div>
      <div className="flex items-end" style={{ gap: 8 }}>
        <Hemicycle />
        <span style={{ position: "relative", flex: 1, height: 29 }}>
          <span style={{ position: "absolute", left: 0, right: 0, bottom: 8, borderTop: "2px dashed var(--border)" }} />
          {/* Le rail de la navette s'arrête à une largeur de document du bord : un
            `translateX(100%)` du rail porte alors le document jusqu'à l'autre hémicycle. */}
          <span className="landing-mini-navette" style={{ position: "absolute", left: 0, right: 22, bottom: 0, height: 18 }}>
            <span
              className="flex items-center justify-center"
              style={{ width: 22, height: 18, borderRadius: 4, backgroundColor: "var(--card)", border: `1px solid ${teinte(PRIMAIRE, 60)}`, color: PRIMAIRE }}
            >
              <FileText style={{ width: 11, height: 11 }} />
            </span>
          </span>
        </span>
        <Hemicycle />
        <span className="landing-mini-tampon" style={{ display: "block", flex: "none", marginLeft: 4, color: VERT }}>
          <BadgeCheck style={{ width: 24, height: 24 }} />
        </span>
      </div>
      <div className="flex items-center" style={{ marginTop: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="flex items-center" style={{ flex: i < 3 ? 1 : "none" }}>
            <Anime classe="landing-mini-entree" ordre={i * 2}>
              <Pastille couleur={i < 3 ? VERT : "var(--border)"} taille={12} />
            </Anime>
            {i < 3 && (
              <span style={{ flex: 1, height: 2, backgroundColor: "var(--border)" }}>
                {i < 2 && <Anime classe="landing-mini-x" ordre={i * 2 + 1} style={{ height: "100%", backgroundColor: VERT }} />}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  ),
  // Une boîte de réception : le numéro de la semaine arrive par le haut, avec sa
  // pastille de non-lu, au-dessus de deux numéros déjà lus, plus pâles.
  newsletter: (
    <div style={{ display: "grid", gap: 10 }}>
      {[0, 1, 2].map((i) => {
        const ligne = (
          <span className="flex items-center" style={{ gap: 10, opacity: i === 0 ? 1 : 0.55 }}>
            <span
              className="flex items-center justify-center"
              style={{ width: 26, height: 26, flex: "none", borderRadius: 8, backgroundColor: i === 0 ? teinte(PRIMAIRE, 16) : "var(--muted)", color: i === 0 ? PRIMAIRE : "var(--muted-foreground)" }}
            >
              <Mail style={{ width: 13, height: 13 }} />
            </span>
            <span style={{ flex: 1, display: "grid", gap: 4 }}>
              <Ligne largeur={[78, 66, 72][i]} hauteur={6} />
              <Ligne largeur={[52, 44, 48][i]} hauteur={5} />
            </span>
            <span style={{ width: 8, height: 8, flex: "none", borderRadius: 999, backgroundColor: i === 0 ? PRIMAIRE : "transparent" }} />
          </span>
        )
        return i === 0 ? (
          <Anime key={i} classe="landing-mini-arrivee" ordre={0}>
            {ligne}
          </Anime>
        ) : (
          <span key={i}>{ligne}</span>
        )
      })}
    </div>
  ),
  // Un sélecteur de langue dont la seconde moitié se remplit, puis le texte qui
  // arrive. « FR » et « EN » sont des libellés d'interface, pas des données.
  langue: (
    <div>
      <div
        className="flex"
        style={{ width: 96, height: 26, padding: 2, borderRadius: 999, border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}
      >
        <span className="flex items-center justify-center" style={{ flex: 1, color: "var(--muted-foreground)" }}>
          FR
        </span>
        <span style={{ position: "relative", flex: 1 }}>
          <Anime classe="landing-mini-x" ordre={0} style={{ position: "absolute", inset: 0, borderRadius: 999, backgroundColor: teinte(PRIMAIRE, 16) }} />
          <span className="flex items-center justify-center" style={{ position: "relative", height: "100%", color: PRIMAIRE }}>
            EN
          </span>
        </span>
      </div>
      <div style={{ display: "grid", gap: 7, marginTop: 16 }}>
        {[86, 70, 52].map((l, i) => (
          <Anime key={i} classe="landing-mini-entree" ordre={3 + i * 2}>
            <Ligne largeur={l} />
          </Anime>
        ))}
      </div>
    </div>
  ),
}

export function SectionsBand() {
  const t = useTranslations("landing.aussi")
  const tNav = useTranslations("nav")
  const autreLocale = useLocale() === "fr" ? "en" : "fr"
  // Le survol est piloté en JS et rendu en styles inline : sur Safari, Tailwind
  // v4 casse `group-hover:*` comme `.parent:hover .child` (ARCHITECTURE.md
  // §Pièges Tailwind v4 sur Safari).
  const [hovered, setHovered] = useState<string | null>(null)

  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: "clamp(3rem, 6vw, 5rem)" }}>
      <h2 className="text-balance" style={STYLE_TITRE_SECTION}>
        {t("titre")}
      </h2>
      <p className="text-muted-foreground" style={{ marginTop: "0.75rem", fontSize: "1.0625rem", lineHeight: 1.6 }}>
        {t("sousTitre")}
      </p>
      {/* Deux cartes par rangée à partir de `sm`, trois à partir de `lg` (six colonnes,
        deux par carte) : six cartes remplissent toutes les rangées. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6" style={{ gap: 16, marginTop: "1.75rem" }}>
        {SECTIONS.map((s) => {
          const on = hovered === s.key
          const el = element(s.element)
          return (
            <Link
              key={s.key}
              href={el.route}
              locale={s.autreLangue ? autreLocale : undefined}
              onClick={s.autreLangue ? () => memoriserLangue(autreLocale) : undefined}
              className="landing-surface lg:col-span-2"
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                display: "flex",
                flexDirection: "column",
                borderRadius: 28,
                padding: 24,
                boxShadow: on ? "inset 0 0 0 1px var(--primary)" : "inset 0 0 0 1px transparent",
                transition: "box-shadow 0.18s ease",
              }}
            >
              {/* La maquette sur une carte blanche, à hauteur fixe pour aligner les
                titres d'une même rangée. */}
              <div
                aria-hidden
                className="flex flex-col justify-center"
                style={{ height: 150, padding: 20, borderRadius: 18, backgroundColor: "var(--card)" }}
              >
                {MAQUETTES[s.key]}
              </div>
              {/* Une petite case de 28 px devant le titre, sur sa ligne ; la
                description garde toute la largeur de la carte. */}
              <span
                className="flex items-center"
                style={{ marginTop: 18, gap: 10, fontSize: "1.0625rem", fontWeight: 600, letterSpacing: "-0.01em", color: on ? "var(--primary)" : "var(--foreground)", transition: "color 0.18s ease" }}
              >
                <Element taille="titre" numero={el.numero} symbole={el.symbole} couleur={couleurElement(el.cle)} style={{ fontSize: 28 }} />
                {"titre" in s ? t(s.titre) : tNav(s.nav)}
                <ArrowRight
                  aria-hidden
                  style={{
                    width: 16,
                    height: 16,
                    flex: "none",
                    color: "var(--primary)",
                    opacity: on ? 1 : 0,
                    transform: on ? "translateX(0)" : "translateX(-4px)",
                    transition: "opacity 0.18s ease, transform 0.18s ease",
                  }}
                />
              </span>
              <span className="text-muted-foreground" style={{ marginTop: 8, fontSize: "0.875rem", lineHeight: 1.55 }}>
                {t(s.key)}
              </span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
