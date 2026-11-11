import type { CSSProperties } from "react"
import Image from "next/image"
import { ArrowRight, Bookmark, Lightbulb, Target, UserRound, Zap, type LucideIcon } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"
import { ASK_AI_SEP_WIDTH, ASK_AI_TARGETS } from "@/lib/ask-ai-targets"
import { BadgeIA, Ligne, Surface } from "./Maquettes"

/**
 * Carte « avant / après » sous le hero de la landing, centrée, puis le lien vers la
 * liste des textes. Rendue par `(landing)/page.tsx`.
 *
 * La carte est posée dans une fenêtre de navigateur, et les deux pastilles « Texte
 * officiel » et « LoiClair » au-dessus d'elle, hors de la page figurée. L'avant est un
 * texte de loi figuré sur deux pages côte à côte, tirées d'une liasse (les feuilles
 * suivantes dépassent derrière, le numéro dit « 1 / 48 »), chacune avec l'en-tête de
 * l'Assemblée nationale, remplie jusqu'en bas, dense et serrée, avec ses articles, ses
 * alinéas imbriqués et ses passages cités. Un trait doré balaie la carte de haut en bas :
 * au-dessus de lui, le même contenu est déjà rangé dans la carte du résumé de la fiche
 * (objectif, mesures, exemples, à retenir, puis « Ce qui change pour vous », section
 * qui suit le résumé sur la fiche, et le bandeau pour poser une question sur le
 * texte), aéré et signalé comme écrit par une IA ; en dessous, le texte de loi reste
 * tel quel. Aucun vrai texte : les intitulés sont ceux de la fiche (`resumeIA`), le
 * contenu est figuré par des lignes grises.
 *
 * Les animations vivent dans `globals.css` (`.landing-avant`, `.landing-apres`,
 * `.landing-balayage`), pour que prefers-reduced-motion les coupe : seul l'après
 * s'affiche alors.
 */

/** Une section du résumé : pictogramme et intitulé de la fiche, puis des lignes. */
function BlocResume({ icone: Icone, libelle, lignes }: { icone: LucideIcon; libelle: string; lignes: number[] }) {
  return (
    <div>
      <p className="flex items-center" style={{ gap: 10, fontSize: 16, fontWeight: 600 }}>
        <Icone aria-hidden style={{ width: 18, height: 18, color: "#06B6D4" }} />
        {libelle}
      </p>
      <div style={{ display: "grid", gap: 9, marginTop: 12 }}>
        {lignes.map((l, i) => (
          <Ligne key={i} largeur={l} hauteur={10} />
        ))}
      </div>
    </div>
  )
}

/**
 * Un alinéa du texte officiel figuré : son repère (I., A., 1°, a)…), décalé selon son
 * niveau d'imbrication, puis des lignes très serrées. `cite` figure un passage cité
 * entre guillemets, la rédaction nouvelle d'un article de code, avec son filet.
 */
type AlineaFigure = { niveau: 0 | 1 | 2; repere: string; lignes: number[]; cite?: boolean }

function Alinea({ niveau, repere, lignes, cite }: AlineaFigure) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.5rem minmax(0, 1fr)", gap: 4, marginLeft: niveau * 16 }}>
      <span className="text-muted-foreground" style={{ fontSize: 10, fontWeight: 600, lineHeight: "5px" }}>
        {repere}
      </span>
      <div
        style={{
          display: "grid",
          gap: 3,
          ...(cite ? { paddingLeft: 8, borderLeft: "2px solid var(--border)" } : {}),
        }}
      >
        {lignes.map((l, i) => (
          <Ligne key={i} largeur={l} hauteur={4} />
        ))}
      </div>
    </div>
  )
}

/** Un bloc d'une page : un article, ou la suite sans titre de celui de la page d'avant. */
type BlocFigure = { article?: string; alineas: AlineaFigure[] }

/**
 * Une page du texte officiel : l'en-tête de l'Assemblée nationale (logo, nom, numéro de
 * page) puis ses articles. Le logo est celui qui identifie la provenance sur `/about`.
 *
 * La page prend la hauteur que lui donne la carte et coupe son texte au bord du bas
 * (`overflow: hidden`, `minHeight: 0`) : le texte continue hors de la feuille. Trois
 * feuilles décalées dépassent derrière elle, dessinées par des ombres sans flou (une
 * ombre couleur papier, puis une couleur filet, un pixel plus grande) : c'est la liasse.
 * Le filet est tiré de `--foreground`, car celui de `--border` disparaît sur le fond.
 */
const FILET_LIASSE = "color-mix(in srgb, var(--foreground) 16%, transparent)"
const OMBRE_LIASSE = [4, 8, 12]
  .map((d) => `${d}px ${d}px 0 -1px var(--card), ${d}px ${d}px 0 0 ${FILET_LIASSE}`)
  .concat("0 10px 24px -18px rgba(28, 25, 23, 0.35)")
  .join(", ")

function PageOfficielle({ institution, numero, blocs }: { institution: string; numero: string; blocs: BlocFigure[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
        borderRadius: 6,
        border: "1px solid var(--border)",
        backgroundColor: "var(--card)",
        padding: "12px 14px 0",
        boxShadow: OMBRE_LIASSE,
      }}
    >
      <div className="flex items-center" style={{ flex: "none", gap: 8, paddingBottom: 8, marginBottom: 10, borderBottom: "1px solid var(--border)" }}>
        <Image src="/images/institutions/assemblee-nationale-logo.svg" alt="" width={838} height={741} style={{ width: "auto", height: 18 }} />
        <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{institution}</span>
        <span className="text-muted-foreground" style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 600 }}>
          {numero}
        </span>
      </div>
      <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
        {blocs.map((a, i) => (
          <div key={i} style={{ display: "grid", gap: 6 }}>
            {a.article && <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>{a.article}</span>}
            {a.alineas.map((al, i) => (
              <Alinea key={i} {...al} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export async function LoiEnClair({ locale }: { locale: string }) {
  const [t, tMaquettes, tResume, tLanding] = await Promise.all([
    getTranslations({ locale, namespace: "landing.loiEnClair" }),
    getTranslations({ locale, namespace: "landing.maquettes" }),
    getTranslations({ locale, namespace: "resumeIA" }),
    getTranslations({ locale, namespace: "landing" }),
  ])

  const pastille: CSSProperties = { fontSize: 13, fontWeight: 600, padding: "5px 14px", borderRadius: 999 }

  // Des articles serrés, imbriqués sur trois niveaux (I., A., 1°, a)) et coupés de
  // passages cités : la forme d'une loi qui modifie un code, celle qui se lit le plus
  // mal. Les repères sont la numérotation de toute loi, pas un contenu. Chaque page en a
  // plus qu'elle ne peut montrer, pour que le texte aille jusqu'en bas même sur mobile,
  // où la page 1 est seule et la carte plus haute.
  const article = (n: number) => tMaquettes("articleN", { n })
  const page1: BlocFigure[] = [
    {
      article: tMaquettes("article1"),
      alineas: [
        { niveau: 0, repere: "I.", lignes: [100, 98, 99, 97, 100, 96, 71] },
        { niveau: 1, repere: "A.", lignes: [99, 100, 97, 58] },
        { niveau: 2, repere: "1°", lignes: [98, 100, 63] },
        { niveau: 2, repere: "2°", lignes: [100, 97, 99, 44] },
        { niveau: 2, repere: "«", lignes: [100, 98, 99, 100, 81], cite: true },
        { niveau: 2, repere: "3°", lignes: [99, 100, 96, 57] },
        { niveau: 1, repere: "B.", lignes: [97, 100, 52] },
        { niveau: 2, repere: "«", lignes: [100, 97, 99, 98, 64], cite: true },
        { niveau: 0, repere: "II.", lignes: [100, 99, 96, 100, 67] },
        { niveau: 0, repere: "III.", lignes: [98, 100, 97, 73] },
      ],
    },
    {
      article: article(2),
      alineas: [
        { niveau: 0, repere: "I.", lignes: [99, 100, 98, 74] },
        { niveau: 2, repere: "a)", lignes: [100, 96, 48] },
        { niveau: 2, repere: "b)", lignes: [98, 100, 61] },
        { niveau: 2, repere: "«", lignes: [100, 99, 97, 100, 55], cite: true },
        { niveau: 0, repere: "II.", lignes: [100, 98, 100, 39] },
        { niveau: 1, repere: "A.", lignes: [97, 100, 99, 62] },
        { niveau: 2, repere: "«", lignes: [100, 98, 99, 97, 68], cite: true },
        { niveau: 1, repere: "B.", lignes: [99, 100, 96, 57] },
        { niveau: 2, repere: "1°", lignes: [100, 97, 99, 46] },
        { niveau: 2, repere: "2°", lignes: [98, 100, 99, 61] },
        { niveau: 2, repere: "«", lignes: [100, 97, 99, 100, 58], cite: true },
        { niveau: 0, repere: "III.", lignes: [99, 100, 97, 66] },
      ],
    },
  ]
  // La page 2 reprend au milieu d'un article, sans titre, comme une vraie page suivante.
  const page2: BlocFigure[] = [
    {
      alineas: [
        { niveau: 1, repere: "", lignes: [100, 97, 99, 62] },
        { niveau: 1, repere: "B.", lignes: [99, 100, 96, 48] },
        { niveau: 2, repere: "«", lignes: [100, 98, 97, 100, 59], cite: true },
      ],
    },
    {
      article: article(3),
      alineas: [
        { niveau: 0, repere: "I.", lignes: [100, 98, 97, 100, 66] },
        { niveau: 2, repere: "1°", lignes: [99, 100, 57] },
        { niveau: 2, repere: "2°", lignes: [100, 96, 98, 41] },
        { niveau: 2, repere: "«", lignes: [100, 99, 100, 97, 72], cite: true },
        { niveau: 0, repere: "II.", lignes: [98, 100, 59] },
      ],
    },
    {
      article: article(4),
      alineas: [
        { niveau: 0, repere: "", lignes: [100, 99, 97, 100, 96, 58] },
        { niveau: 1, repere: "A.", lignes: [99, 100, 97, 52] },
        { niveau: 2, repere: "«", lignes: [100, 98, 99, 61], cite: true },
        { niveau: 1, repere: "B.", lignes: [100, 97, 99, 54] },
      ],
    },
    { article: article(5), alineas: [{ niveau: 0, repere: "", lignes: [100, 97, 99, 100, 98, 64] }] },
  ]
  // Le nombre de pages de la liasse : un ordre de grandeur, pas celui d'un texte réel.
  const totalPages = 48

  return (
    // Plus d'air en haut qu'en bas : l'illustration se détache de la recherche du hero.
    <section
      className="max-w-[90rem] mx-auto px-10 lg:px-20"
      style={{ paddingTop: "clamp(4rem, 8vw, 6.5rem)", paddingBottom: "clamp(2.5rem, 5vw, 4rem)", textAlign: "center" }}
    >
      <div style={{ maxWidth: 960, marginInline: "auto", textAlign: "left" }}>
        <Surface>
          {/* Les deux états, comme un interrupteur, au-dessus de la fenêtre et non dans la
            page figurée : la pastille active suit l'animation. */}
          <div aria-hidden className="flex justify-center" style={{ gap: 6, marginBottom: 16 }}>
            <span className="landing-pastille-avant" style={pastille}>
              {tMaquettes("texteOfficiel")}
            </span>
            <span className="landing-pastille-apres" style={pastille}>
              {tMaquettes("surLoiClair")}
            </span>
          </div>
          {/* Une fenêtre de navigateur ouverte sur une fiche : trois points, l'adresse,
            puis la carte. La barre est purement décorative. */}
          <figure
            aria-label={t("aria")}
            style={{
              margin: 0,
              borderRadius: 16,
              border: "1px solid var(--border)",
              backgroundColor: "var(--card)",
              boxShadow: "0 28px 56px -30px rgba(28, 25, 23, 0.28)",
              overflow: "hidden",
            }}
          >
            <div
              aria-hidden
              className="flex items-center"
              style={{ gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)", backgroundColor: "var(--muted)" }}
            >
              <span className="flex" style={{ gap: 6 }}>
                {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
                  <span key={c} style={{ width: 11, height: 11, borderRadius: 999, backgroundColor: c }} />
                ))}
              </span>
              <span
                className="text-muted-foreground"
                style={{
                  flex: 1,
                  maxWidth: 420,
                  marginInline: "auto",
                  textAlign: "center",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                  padding: "4px 12px",
                  borderRadius: 999,
                  backgroundColor: "var(--card)",
                }}
              >
                loiclair.fr/dossiers-legislatifs
              </span>
              {/* Contrepoids des trois points, pour que l'adresse tombe au centre. */}
              <span style={{ width: 45 }} />
            </div>
            {/* Le fond de la page se teinte, pour que les feuilles et la carte blanches
              s'en détachent. */}
            <div style={{ padding: "22px clamp(14px, 3vw, 28px) 26px", backgroundColor: "var(--muted)" }}>
              {/* L'avant et l'après occupent la même case de grille : la carte prend la
                hauteur du plus haut des deux, et rien ne saute quand ils se relaient. Le
                trait de balayage est posé au-dessus des deux, en position absolue. La
                colonne est bornée (`minmax(0, 1fr)`) : sinon le badge IA élargit la carte
                au-delà de la fenêtre sur un écran étroit. */}
              <div aria-hidden style={{ position: "relative", display: "grid", gridTemplateColumns: "minmax(0, 1fr)" }}>
                {/* Deux pages côte à côte ; sur un écran étroit, la première seule.
                  `contain: size` retire leur texte du calcul de la hauteur : c'est la carte
                  du résumé qui la fixe, et les pages s'y étirent puis coupent leur texte.
                  Les marges de droite et du bas laissent la place aux feuilles de la liasse,
                  qui sinon sortiraient de la découpe de l'animation (`clip-path`). */}
                <div
                  className="landing-avant grid grid-cols-1 sm:grid-cols-2"
                  style={{ gridArea: "1 / 1", contain: "size", gap: 22, alignItems: "stretch", paddingRight: 12, paddingBottom: 12 }}
                >
                  <PageOfficielle institution={tLanding("s5LogoAnLabel")} numero={tMaquettes("page", { n: 1, total: totalPages })} blocs={page1} />
                  {/* En grille, pour que la feuille s'étire à la hauteur de la première.
                    `max-sm:hidden grid` et non `hidden sm:grid` : sur Safari, `hidden` écrase
                    l'affichage responsive (ARCHITECTURE.md §Pièges Tailwind v4 sur Safari). */}
                  <div className="max-sm:hidden grid" style={{ minHeight: 0 }}>
                    <PageOfficielle institution={tLanding("s5LogoAnLabel")} numero={tMaquettes("page", { n: 2, total: totalPages })} blocs={page2} />
                  </div>
                </div>

                {/* La carte du résumé, au cadre doré des cartes IA de la fiche
                  (`AI_FRAME_STYLE`, recopié : un composant serveur ne peut pas lire une
                  constante d'un module client), et son bandeau de question en pied. */}
                <div
                  className="landing-apres"
                  style={{
                    gridArea: "1 / 1",
                    display: "flex",
                    flexDirection: "column",
                    borderRadius: 14,
                    border: "1px solid rgba(212, 165, 74, 0.45)",
                    backgroundColor: "var(--card)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ display: "grid", gap: 26, padding: "20px clamp(16px, 3vw, 28px) 24px" }}>
                    <div>
                      <BadgeIA libelle={tResume("aiBadge")} />
                    </div>
                    <BlocResume icone={Target} libelle={tResume("textObjective")} lignes={[94, 62]} />
                    <BlocResume icone={Zap} libelle={tResume("whatChanges")} lignes={[84, 72]} />
                    <BlocResume icone={Lightbulb} libelle={tResume("concreteExample")} lignes={[90]} />
                    <BlocResume icone={Bookmark} libelle={tResume("keyTakeaway")} lignes={[76]} />
                    {/* La section qui suit le résumé sur la fiche, avec l'icône de son
                      onglet (`SectionsDossier`). */}
                    <BlocResume icone={UserRound} libelle={tResume("sectionPourVous")} lignes={[82]} />
                  </div>
                  {/* Le bandeau « Une question sur ce texte ? » de la fiche
                    (`AskAIBand`), figuré : mêmes couleurs, mêmes libellés, mêmes
                    six IA, en texte simple et non en liens. Le point séparateur
                    est caché en début de ligne comme dans `AskAILinks`. */}
                  <div
                    style={{
                      marginTop: "auto",
                      padding: "14px clamp(16px, 3vw, 24px)",
                      borderTop: "1px solid rgba(212, 165, 74, 0.3)",
                      backgroundColor: "rgba(212, 165, 74, 0.07)",
                    }}
                  >
                    <p style={{ fontSize: 14, marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{tResume("discussWithAITeaser")}</span>{" "}
                      <span style={{ fontWeight: 500, color: "#D4A54A" }}>{tResume("askAILabel")}</span>
                    </p>
                    <span className="block text-muted-foreground" style={{ overflow: "hidden", fontSize: 13, fontWeight: 500 }}>
                      <span className="flex flex-wrap items-center" style={{ rowGap: 4, marginLeft: -ASK_AI_SEP_WIDTH }}>
                        {ASK_AI_TARGETS.map((ia) => (
                          <span key={ia.name} className="inline-flex items-center">
                            <span aria-hidden className="inline-block text-center" style={{ width: ASK_AI_SEP_WIDTH, opacity: 0.5 }}>·</span>
                            <span className="inline-flex items-center whitespace-nowrap" style={{ gap: 5 }}>
                              <ia.Icon aria-hidden style={{ width: 14, height: 14, flexShrink: 0 }} />
                              {ia.labelKey ? tResume(ia.labelKey) : ia.name}
                            </span>
                          </span>
                        ))}
                      </span>
                    </span>
                  </div>
                </div>

                <span className="landing-balayage" />
              </div>
            </div>
          </figure>
        </Surface>
      </div>

      <Link
        href="/dossiers-legislatifs"
        className="inline-flex items-center hover:underline"
        style={{ marginTop: "1.75rem", gap: 6, fontSize: "0.9375rem", fontWeight: 600, color: "var(--primary)" }}
      >
        {t("lien")}
        <ArrowRight aria-hidden style={{ width: 16, height: 16 }} />
      </Link>
    </section>
  )
}
