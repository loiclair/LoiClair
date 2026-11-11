"use client"

// En-tête commun des pages L1 et L2 : un même bandeau partout, crème en thème
// clair et brun en sombre. Deux formats, « page » (titre, phrase, pastilles de
// méta, et le fil d'Ariane des articles des faits et des pages de dossier) et
// « accueil » (titre plus grand, une phrase, sans fil d'Ariane).

import { Link } from "@/i18n/navigation"
import { useState, type CSSProperties, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import ShareButton from "@/components/ShareButton"
import Depliable from "@/components/ui/Depliable"
import { marquerDefilementProgramme } from "@/lib/defilement-programme"

export interface PageHeroPill {
  children: ReactNode
  /** Lien sortant (nouvel onglet), page du site avec `internal`, ou ancre de la
   *  page quand il commence par `#` (voir `sauterAAncre`). */
  href?: string | null
  tooltip?: string | null
  internal?: boolean
}

/** Saut vers un élément de la page, sur le modèle de `BarreAncres` : la section
 *  repliée qui le contient est rouverte d'abord, sinon le saut n'atteindrait
 *  qu'un titre, et le défilement est marqué comme programmé pour que l'en-tête
 *  ne se replie pas en route. */
function sauterAAncre(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
  const cible = document.getElementById(href.slice(1))
  if (!cible) return
  event.preventDefault()
  const details = cible.closest("details")
  if (details && !details.open) details.open = true
  marquerDefilementProgramme()
  cible.scrollIntoView({ behavior: "smooth", block: "start" })
}

export interface PageHeroMetaRow {
  icon: ReactNode
  label: string
  pills: PageHeroPill[]
  trailing?: ReactNode
}

export interface PageHeroBreadcrumb {
  label: string
  href?: string
  /** Posé après le maillon, hors de son lien : le badge IA d'un titre traduit en est un. */
  badge?: ReactNode
}

/** Chapitre d'une série Facts : seconde ligne du titre, puis les tirets de
 *  progression (`n` allumé sur `total`). */
export interface PageHeroChapitre {
  n: number
  total: number
  libelle: string
}

// Un seul bandeau pour toutes les pages L1 et L2 : crème en thème clair, brun
// en sombre. Toutes ses couleurs sont des jetons `--bandeau-*` de globals.css,
// qui changent avec le thème. La couleur propre à une page ne teinte plus le
// fond, elle passe par `accent`.
const BANDEAU = "var(--bandeau)"
const VAGUE = "var(--bandeau-vague)"
const TEXTE = "var(--bandeau-texte)"
const TEXTE_DOUX = "var(--bandeau-texte-doux)"

// Mêlée au noir sur la crème, au blanc sur le brun (`--bandeau-accent-*`), une
// couleur de page reste lisible sur les deux fonds. `color-mix` en style inline
// et non en classe, comme `Surligne`.
const teinter = (couleur: string, jeton: string) => `color-mix(in oklab, ${couleur}, var(${jeton}))`

// Taille et interligne du titre, par format, partagés avec la boîte qui centre
// Partager sur sa première ligne : changer l'un sans l'autre décentrerait le bouton.
const TITRE_ACCUEIL_TAILLE = "clamp(1.9rem, 4vw, 2.75rem)"
const TITRE_ACCUEIL_INTERLIGNE = 1.1
const TITRE_PAGE_TAILLE = "clamp(1.375rem, 3vw, 2rem)"
const TITRE_PAGE_INTERLIGNE = 1.2

// Un maillon du fil d'Ariane qui mène à une fiche (élu, dossier, ses débats) ne
// précharge pas : chaque préchargement d'une fiche encore jamais générée coûte une
// régénération ISR (D-095). Les listes `/les-elus` et `/dossiers-legislatifs`, sans
// barre finale, gardent leur préchargement.
const LIEN_FICHE = /^\/(les-elus|dossiers-legislatifs)\//

export interface PageHeroProps {
  breadcrumb?: PageHeroBreadcrumb[]
  title: string
  /** Couleur du chapitre, sur les articles Facts seulement. Elle teinte le
   *  dernier maillon du fil d'Ariane et la ligne de chapitre, jamais le fond. */
  accent?: string
  chapitre?: PageHeroChapitre
  /** Une phrase sous le titre, qui dit ce que la page contient. Un nœud et non une
   *  chaîne : la fiche dossier y met, sur /en, le badge IA suivi du titre officiel. */
  lede?: ReactNode
  /** « accueil » : Fil d'actu, Textes et Élus, les entrées du menu sans pages
   *  sœurs. Un titre plus grand et une phrase plus large. Sans fil d'Ariane, dans
   *  les deux formats, Partager se pose sur la ligne du titre. */
  format?: "page" | "accueil"
  subtitle?: string
  meta?: PageHeroMetaRow[]
  /** Largeur où les lignes de `meta` passent à la ligne, sur desktop
   *  seulement. Sans elle, elles courent jusqu'au bord du hero : la fiche
   *  dossier remplissait ainsi sa première ligne et laissait la date de dépôt
   *  seule sur la seconde. La fiche élu n'en passe pas, sa vignette et son logo
   *  de groupe la resserrant déjà. */
  metaMaxWidth?: string
  aside?: ReactNode
  /** Vignette posée à gauche du titre, sur sa ligne. La fiche élu y met le
   *  portrait officiel ; le titre reprend toute la largeur si elle est absente. */
  avatar?: ReactNode
  footer?: ReactNode
  shareUrl?: string
  /** Case d'élément des rubriques (`usePageHero`), posée dans la ligne du titre,
   *  comme une partie de lui. La phrase dessous repart de la marge gauche, sous la
   *  case : sa longueur ne décale rien. */
  element?: ReactNode
  /** Bloc posé entre la phrase d'intro et la ligne de pastilles : la frise du parcours sur
   *  la page d'un vote. */
  parcours?: ReactNode
}

function HeroPill({ children, href, tooltip, internal }: PageHeroPill) {
  const [hovered, setHovered] = useState(false)
  const interactive = !!href || !!tooltip
  const cursor = tooltip && !href ? "help" : href ? "pointer" : "default"

  // La pastille EST l'élément rendu : span, `<a>` ou `<Link>` selon le cas, mais
  // jamais un span enveloppé dans un lien. L'imbrication faisait diverger les
  // hauteurs — enfant direct d'une rangée flex, le span était blockifié en
  // `display: flex` et se calait sur son contenu ; dans un lien il restait
  // `inline-flex` et prenait la hauteur de sa boîte de ligne. Sur la fiche
  // dossier, la pastille du groupe (sans lien) dépassait donc celle du nom.
  const className = "inline-flex items-center gap-1 rounded-full font-medium"
  const style: CSSProperties = {
    fontSize: "0.6875rem",
    lineHeight: 1.4,
    // Un fond plein plutôt qu'un contour : sur le bandeau, la pastille se
    // détache d'un coup d'œil et le survol n'a plus qu'à renforcer son voile
    // pour signaler qu'on peut cliquer.
    padding: "2px 8px",
    backgroundColor: interactive && hovered ? "var(--bandeau-voile-fort)" : "var(--bandeau-voile)",
    color: TEXTE,
    textDecoration: "none",
    cursor,
    transition: "background-color 0.15s ease",
    WebkitTransition: "background-color 0.15s ease",
  }
  const survol = interactive
    ? { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) }
    : {}

  if (href) {
    if (href.startsWith("#")) {
      return (
        <a href={href} onClick={(e) => sauterAAncre(e, href)} className={className} style={style} {...survol}>
          {children}
        </a>
      )
    }
    if (internal) {
      // Les pastilles internes pointent vers une fiche : élu (auteur, rapporteur
      // de `DossierHero`) ou texte (« Voir le texte » de la page d'un vote),
      // visibles dès l'ouverture : pas de prefetch, comme tous les liens vers les
      // fiches.
      return (
        <Link href={href} prefetch={false} className={className} style={style} {...survol}>
          {children}
        </Link>
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className} style={style} {...survol}>
        {children}
      </a>
    )
  }

  const content = (
    <span className={className} style={style} {...survol}>
      {children}
    </span>
  )
  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="top">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    )
  }
  return content
}

function HeroMetaRow({ icon, label, pills, trailing }: PageHeroMetaRow) {
  return (
    <div className="flex flex-wrap items-center gap-1" style={{ color: TEXTE_DOUX }}>
      <span
        className="flex items-center gap-1 font-medium"
        style={{ fontSize: "0.6875rem", marginRight: "2px" }}
      >
        {icon}
        {label}
      </span>
      {pills.map((pill, idx) => (
        <HeroPill key={idx} {...pill} />
      ))}
      {trailing}
    </div>
  )
}

/** Pose la vignette à gauche du titre et de la bande meta. Sans vignette, rend
 *  ses enfants tels quels : les pages qui n'en passent pas gardent leur hero au
 *  pixel près, sans conteneur intermédiaire. */
function AvatarWrapper({ avatar, hasAside, children }: { avatar?: ReactNode; hasAside: boolean; children: ReactNode }) {
  if (!avatar) return <>{children}</>
  return (
    <div
      // Alignement en haut : sur mobile, la vignette de la fiche élu est un
      // carré fixe plus court que le bloc titre + meta, et centrée elle
      // décrochait de la ligne du titre. Sans effet sur desktop, où la vignette
      // porte un `align-self: stretch` qui l'emporte sur cet alignement.
      // Inline et non `flex items-start` : le positionnement est la première
      // chose que Safari rend mal en Tailwind v4, et c'est Safari que ce
      // correctif vise (`ARCHITECTURE.md` §Pièges Tailwind v4 sur Safari).
      style={{ display: "flex", alignItems: "flex-start", gap: "0.875rem" }}
    >
      {avatar}
      <div
        // L'aside est en position absolue à droite et n'écarte donc rien : sans
        // cette réserve, la bande meta lui passe dessous. Elle se replie alors
        // sur deux lignes, ce qui est le rendu voulu. `lg` et non `md` : le
        // logo de groupe de la fiche élu n'apparaît qu'à partir de 1024 px.
        className={hasAside ? "lg:pr-[17rem]" : undefined}
        // `minWidth: 0` : sans lui, une pastille meta longue (« La France
        // insoumise - Nouveau Front Populaire ») impose sa largeur à la colonne,
        // qui refuse alors de rétrécir et déborde du hero sur mobile.
        style={{ minWidth: 0, flex: 1 }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * L'en-tête commun des pages L1 et L2. `AppShell` le rend pour les pages que
 * `usePageHero` connaît ; les fiches élu et dossier, et les pages de débats, le
 * rendent elles-mêmes avec leurs données. Le fond est le même partout : une page
 * se distingue par `accent`.
 */
export default function PageHero({ breadcrumb = [], title, accent, chapitre, lede, format = "page", subtitle, meta, metaMaxWidth, aside, avatar, footer, shareUrl, element, parcours }: PageHeroProps) {
  const t = useTranslations("common")
  const [metaExpanded, setMetaExpanded] = useState(false)
  const accueil = format === "accueil"
  // Sans fil d'Ariane pour le porter, Partager prend la ligne du titre.
  const partageEnTitre = accueil || breadcrumb.length === 0
  // Sans accent, la ligne de chapitre et le dernier maillon prennent la couleur
  // du texte du bandeau plutôt que de disparaître.
  const teinteTexte = accent ? teinter(accent, "--bandeau-accent-texte") : TEXTE
  const teintePastille = accent ? teinter(accent, "--bandeau-accent-point") : TEXTE

  return (
    <div
      style={{
        backgroundColor: BANDEAU,
        paddingTop: accueil ? "2.625rem" : "1.5rem",
        paddingBottom: footer ? 0 : accueil ? "2.875rem" : "1.25rem",
        // Une hauteur commune à tous les formats, contenu centré dedans : sans
        // elle, le bandeau suivait la longueur de la phrase et changeait de
        // taille d'une page à l'autre. 15,5rem : la hauteur d'une page de série
        // Facts sur ordinateur, la plus haute des pages courantes (ligne de
        // chapitre et tirets en plus). Un plancher et non une hauteur fixe : un
        // titre long ou une fiche avec sa bande de contact le dépassent.
        minHeight: "15.5rem",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "stretch",
        position: "relative",
        overflow: "hidden",
        width: "100vw",
        marginLeft: "calc(-50vw + 50%)",
      }}
    >
      <div
        className="max-w-[90rem] mx-auto"
        style={{ width: "100%", position: "relative", zIndex: 1, paddingLeft: "clamp(1rem, calc(6vw - 0.5rem), 5rem)", paddingRight: "clamp(1rem, calc(6vw - 0.5rem), 5rem)" }}
      >
        {/* items-center : la pilule de partage est deux fois plus haute que le fil
            d'Ariane, un alignement par le haut la ferait flotter sous sa ligne.
            Rendue seulement quand il y a un fil (`partageEnTitre` sinon). */}
        {!partageEnTitre && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <nav
              className="flex flex-wrap items-center gap-1.5 text-xs"
              style={{ color: TEXTE_DOUX }}
            >
              {breadcrumb.map((item, idx) => {
                const isLast = idx === breadcrumb.length - 1
                return (
                  <span key={idx} className="flex items-center gap-1.5">
                    {/* Un maillon qui porte un lien le garde, même en dernier. */}
                    {item.href ? (
                      <Link
                        href={item.href}
                        prefetch={!LIEN_FICHE.test(item.href)}
                        style={{ color: TEXTE_DOUX, textDecoration: "none" }}
                      >
                        {item.label}
                      </Link>
                    ) : isLast && accent ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", color: teinteTexte, fontWeight: 500 }}>
                        <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: teintePastille, flexShrink: 0 }} />
                        {item.label}
                      </span>
                    ) : (
                      <span style={isLast ? { color: TEXTE, fontWeight: 500 } : undefined}>
                        {item.label}
                      </span>
                    )}
                    {item.badge}
                    {!isLast && <span>/</span>}
                  </span>
                )
              })}
            </nav>
            {shareUrl && <ShareButton url={shareUrl} message={title} compact />}
          </div>
        )}

        {/* Avec une vignette, le titre ET la bande meta passent à sa droite :
            la vignette borde les deux, au lieu de surplomber une bande qui
            repartait de la marge gauche. Sans vignette, `AvatarWrapper` rend
            ses enfants tels quels et le hero garde exactement son rendu. */}
        <AvatarWrapper avatar={avatar} hasAside={!!aside}>
          {/* Sans fil d'Ariane, Partager prend la ligne du titre. Aligné en haut,
              pour rester sur la première ligne d'un titre qui passe à la ligne sur
              téléphone. Avec une case d'élément, aligné en bas : la case est calée
              au bas du titre, et le bouton se centre sur elle, même quand le titre
              court sur plusieurs lignes. */}
          <div style={partageEnTitre ? { display: "flex", alignItems: element ? "flex-end" : "flex-start", justifyContent: "space-between", gap: "1rem" } : undefined}>
            <h1
              style={{
                fontSize: accueil ? TITRE_ACCUEIL_TAILLE : TITRE_PAGE_TAILLE,
                fontWeight: 500,
                lineHeight: accueil ? TITRE_ACCUEIL_INTERLIGNE : TITRE_PAGE_INTERLIGNE,
                letterSpacing: "-0.02em",
                margin: 0,
                color: TEXTE,
                // 60rem dans les deux formats : à 40rem, case comprise, « Le Parlement
                // en 5 min par semaine » passait sur deux lignes sur ordinateur.
                maxWidth: "60rem",
              }}
            >
              {element ? (
                // Titre calé sur le bas de la case, choix d'Alex : centré, il flottait
                // au milieu d'une case plus haute que sa ligne.
                <span style={{ display: "flex", alignItems: "flex-end", gap: "0.875rem" }}>
                  {element}
                  <span>{title}</span>
                </span>
              ) : (
                title
              )}
              {chapitre && (
                <span style={{ display: "block", color: teinteTexte }}>
                  {t("chapitreLigne", { n: chapitre.n, libelle: chapitre.libelle })}
                </span>
              )}
            </h1>
            {/* Une boîte de la hauteur exacte de la première ligne du titre, le
                bouton centré dedans : un décalage fixe ne valait que pour une
                taille, alors que le titre suit la largeur d'écran. Le bouton
                tombait 9 px sous le milieu de la ligne sur téléphone, 2 px sur
                ordinateur. Plus haut que la ligne sur téléphone (36 px contre
                33), il déborde à parts égales des deux côtés. Avec une case
                d'élément, la boîte prend la hauteur de la case (`.partage-case`,
                40 ou 64 px selon la largeur, dans `globals.css`). */}
            {partageEnTitre && shareUrl && (
              <div
                className={element ? "partage-case" : undefined}
                style={{
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  height: element
                    ? undefined
                    : accueil
                      ? `calc(${TITRE_ACCUEIL_TAILLE} * ${TITRE_ACCUEIL_INTERLIGNE})`
                      : `calc(${TITRE_PAGE_TAILLE} * ${TITRE_PAGE_INTERLIGNE})`,
                }}
              >
                <ShareButton url={shareUrl} message={title} compact />
              </div>
            )}
          </div>

        {chapitre && (
          <div aria-hidden="true" style={{ display: "flex", gap: "5px", marginTop: "12px" }}>
            {Array.from({ length: chapitre.total }, (_, i) => (
              <span
                key={i}
                style={{
                  width: "20px",
                  height: "3px",
                  borderRadius: "2px",
                  backgroundColor: i + 1 === chapitre.n ? teintePastille : "var(--bandeau-trait)",
                }}
              />
            ))}
          </div>
        )}

        {lede && (
          <p
            style={{
              margin: accueil ? "14px 0 0" : "8px 0 0",
              maxWidth: accueil ? "40rem" : "42rem",
              fontSize: accueil ? "1.0625rem" : "0.9375rem",
              lineHeight: 1.55,
              color: TEXTE_DOUX,
            }}
          >
            {lede}
          </p>
        )}

        {subtitle && (
          <p
            className="font-mono mt-2"
            style={{ fontSize: "0.6875rem", color: "var(--bandeau-texte-pale)" }}
          >
            {subtitle}
          </p>
        )}

        {parcours && <div style={{ marginTop: "14px" }}>{parcours}</div>}

        {meta && meta.length > 0 && (
          <>
            {/* Desktop : toutes les lignes visibles, à la suite et calées à
                gauche. Une grille de deux colonnes poussait « Mise à jour » loin
                à droite des sources, comme une colonne à part. */}
            <div
              className="hidden md:flex md:flex-wrap md:items-center mt-4"
              style={{ columnGap: "26px", rowGap: "8px", maxWidth: metaMaxWidth }}
            >
              {meta.map((row, idx) => (
                <HeroMetaRow key={idx} {...row} />
              ))}
            </div>

            {/* Mobile : 1ère ligne visible, le reste replié dans un seul bloc animé */}
            <div className="md:hidden mt-4 flex flex-col" style={{ gap: "6px" }}>
              <HeroMetaRow {...meta[0]} />
              {meta.length > 1 && (
                <Depliable ouvert={metaExpanded} className="flex flex-col" style={{ gap: "6px" }}>
                  {meta.slice(1).map((row, idx) => (
                    <HeroMetaRow key={idx} {...row} />
                  ))}
                </Depliable>
              )}
            </div>
            {meta.length > 1 && (
              <button
                type="button"
                onClick={() => setMetaExpanded((v) => !v)}
                aria-expanded={metaExpanded}
                className="md:hidden mt-2 text-left underline"
                style={{ fontSize: "0.6875rem", color: TEXTE_DOUX }}
              >
                {metaExpanded ? t("showLess") : t("showMoreDetails")}
              </button>
            )}
          </>
        )}
        </AvatarWrapper>

        {aside && (
          <div
            className="hero-aside"
            // Ancré en bas et non centré sur tout le hero : centré, l'aside remontait
            // au niveau de la ligne de partage et lui disputait le coin haut droit.
            // Le bas le pose dans la continuité de la bande meta.
            style={{
              position: "absolute",
              right: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
              bottom: 0,
              zIndex: 1,
              pointerEvents: "auto",
            }}
          >
            {aside}
          </div>
        )}
      </div>

      {footer && (
        <div
          style={{
            position: "relative",
            zIndex: 1,
            marginTop: "1.25rem",
            background: "var(--bandeau-pied)",
            borderTop: "1px solid var(--bandeau-filet)",
          }}
        >
          <div
            className="max-w-[90rem] mx-auto"
            style={{
              width: "100%",
              paddingLeft: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
              paddingRight: "clamp(1rem, calc(6vw - 0.5rem), 5rem)",
              paddingTop: "13px",
              paddingBottom: "13px",
            }}
          >
            {footer}
          </div>
        </div>
      )}

      <svg
        viewBox="0 0 1440 400"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M1200,0 L1440,0 L1440,400 L900,400 C950,400 1150,20 1200,0 Z"
          // Une variable CSS qui change avec le thème, posée en style comme
          // le fond du bandeau.
          style={{ fill: VAGUE }}
        />
      </svg>
    </div>
  )
}
