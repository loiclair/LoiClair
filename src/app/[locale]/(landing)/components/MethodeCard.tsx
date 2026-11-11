import type { CSSProperties, ReactNode } from "react"
import { getTranslations } from "next-intl/server"
import { ArrowDown, ArrowRight, Bookmark, ChartColumn, Cpu, Database, FileText, Landmark, ScrollText, Target, Zap, type LucideIcon } from "lucide-react"

import { Link } from "@/i18n/navigation"
import { getTauxPromulgation } from "@/lib/facts-queries"
import { FACTS_ARTICLES } from "@/lib/facts-registry"
import { BadgeIA, Carte, Ligne, SectionIllustree, STYLE_TITRE_SECTION, Surface } from "./Maquettes"
import { SOURCES_ACCUEIL, type CleAccueil } from "@/lib/sources"

/**
 * Sources officielles que la carte « Sources officielles » ne nomme pas : le Baromètre
 * et l'API Géo, retirées pour que la carte tienne sur deux lignes au bureau. Les
 * sources tierces (`officielle: false` dans `lib/sources.ts`) n'y figurent jamais.
 */
const HORS_CARTE_SOURCES = new Set<CleAccueil>(["s5LogoBarometreLabel", "s5LogoGeoLabel"])

/**
 * Les deux sections « méthode » de la landing, chacune illustrée et en texte libre :
 * « Comment on résume les lois », avec le chemin du texte officiel au résumé, puis
 * « Comment on arrive à nos chiffres », avec le chemin des sources officielles au
 * chiffre publié. Les deux chemins ont la même forme : une étape en haut, deux côte à
 * côte, une en bas, et la même mise en valeur qui passe d'étape en étape. Deux
 * composants, `MethodeResumes` et `MethodeChiffres`, parce que `(landing)/page.tsx`
 * pose la section des profils (`PourVousSection`) entre les deux : les trois
 * maquettes alternent, à droite, à gauche, à droite.
 *
 * Le texte des résumés décrit `api/resume-loi` (texte officiel, instructions, modèle)
 * et le badge `AIBadge`, présent sur chaque résumé, qui ouvre la page des
 * instructions, du modèle et des paramètres. Il dit « instructions », comme le titre
 * de cette page, et non « consignes » ni « prompt ». Il ne dit pas qu'un résumé est
 * réécrit quand les instructions changent : c'est vrai, mais l'ancien est écrasé sans
 * trace, et la phrase se lisait comme un moyen de faire disparaître un mauvais résumé
 * déjà lu. Il renvoie donc au texte officiel, que le lecteur peut vérifier lui-même.
 *
 * Le chiffre publié au bout du second chemin est le vrai taux de promulgation, lu dans
 * le helper de son article (D-014) : une maquette qui montrerait un nombre inventé se
 * lirait comme un fait.
 */

/**
 * Colonne de texte d'une section méthode : titre, paragraphe libre, lien. Reprise par
 * `PourVousSection`, pour que les sections illustrées qui se suivent aient le même texte.
 */
export function TexteMethode({ titre, texte, lien, href }: { titre: string; texte: string; lien: string; href: string }) {
  return (
    <>
      <h2 className="text-balance" style={STYLE_TITRE_SECTION}>
        {titre}
      </h2>
      <p className="text-muted-foreground" style={{ marginTop: "1rem", maxWidth: "32rem", fontSize: "1.0625rem", lineHeight: 1.65 }}>
        {texte}
      </p>
      <Link
        href={href}
        className="inline-flex items-center hover:underline"
        style={{ marginTop: "1.5rem", gap: 6, fontSize: "0.9375rem", fontWeight: 600, color: "var(--primary)" }}
      >
        {lien}
        <ArrowRight aria-hidden style={{ width: 16, height: 16 }} />
      </Link>
    </>
  )
}

/** En-tête d'une étape d'un chemin : pictogramme gris, intitulé, badge éventuel. */
function Etape({ icone: Icone, libelle, badge }: { icone: LucideIcon; libelle: string; badge?: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center" style={{ gap: "6px 10px", fontSize: 13, fontWeight: 600 }}>
      <span className="flex items-center" style={{ gap: 8 }}>
        <Icone style={{ width: 15, height: 15, flex: "none", color: "var(--muted-foreground)" }} />
        {libelle}
      </span>
      {badge}
    </span>
  )
}

/**
 * Flèche entre deux étapes du chemin, qui s'allume quand la mise en valeur la franchit.
 * `horizontale` pour celle qui relie les deux cartes posées sur une même rangée.
 */
function Fleche({ rang, horizontale }: { rang: number; horizontale?: boolean }) {
  const Icone = horizontale ? ArrowRight : ArrowDown
  return (
    <span className={`landing-fleche-${rang}`} style={{ justifySelf: "center", alignSelf: "center", display: "block", color: "var(--muted-foreground)" }}>
      <Icone style={{ width: 16, height: 16 }} />
    </span>
  )
}

/**
 * Les trois colonnes de la rangée du milieu d'un chemin (instructions et modèle, ou
 * données recoupées et analyses) : une carte, la flèche horizontale, une carte. Les flèches verticales s'y posent aussi, pour tomber
 * au-dessus de la carte qu'elles désignent et non au milieu de la rangée.
 */
const COLONNES_RANGEE: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 16px minmax(0, 1fr)", gap: 8 }

/** Flèche verticale posée au-dessus de la colonne `colonne` (1 ou 3) de la rangée. */
function FlecheVers({ rang, colonne }: { rang: number; colonne: 1 | 3 }) {
  return (
    <div style={COLONNES_RANGEE}>
      <span style={{ gridColumn: colonne, display: "grid" }}>
        <Fleche rang={rang} />
      </span>
    </div>
  )
}

/** Intitulé d'une ligne de maquette, en petites capitales grises. */
function Intitule({ children }: { children: ReactNode }) {
  return (
    <span className="text-muted-foreground" style={{ display: "block", fontSize: 10, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase" }}>
      {children}
    </span>
  )
}

/** Une ligne des données recoupées figurées : trois cellules, la première plus foncée (la clé). */
function RangeeBase({ largeurs }: { largeurs: [number, number, number] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: largeurs.map((l) => `${l}fr`).join(" "), gap: 4 }}>
      {largeurs.map((_, i) => (
        <Ligne key={i} largeur={100} hauteur={6} style={i === 0 ? { opacity: 1 } : { opacity: 0.6 }} />
      ))}
    </div>
  )
}

/** « Comment on résume les lois », maquette à droite. */
export async function MethodeResumes({ locale }: { locale: string }) {
  const [t, tMaquettes, tResume] = await Promise.all([
    getTranslations({ locale, namespace: "landing.methode" }),
    getTranslations({ locale, namespace: "landing.maquettes" }),
    getTranslations({ locale, namespace: "resumeIA" }),
  ])

  return (
    <SectionIllustree
      texte={<TexteMethode titre={t("loisTitre")} texte={t("loisTexte")} lien={t("loisLien")} href="/documentation/prompts-ia#loi" />}
      visuel={
        <Surface>
          {/* Le chemin d'un résumé : le texte officiel, les instructions publiques et le
            modèle avec ses paramètres publiés, côte à côte sur une même rangée pour que
            l'illustration reste basse, puis le résumé signalé comme écrit par une IA.
            Les deux étapes où l'IA intervient portent le badge doré. Une mise en valeur
            passe d'étape en étape (`rang`), et les lignes du modèle scintillent comme
            un traitement en cours. */}
          <div aria-hidden style={{ display: "grid", gap: 8 }}>
            <Carte rang={0}>
              <Etape icone={FileText} libelle={tMaquettes("texteOfficiel")} />
              <div style={{ display: "grid", gap: 4, marginTop: 10 }}>
                {[100, 97, 99, 62].map((l, i) => (
                  <Ligne key={i} largeur={l} hauteur={5} />
                ))}
              </div>
            </Carte>
            {/* Du texte officiel vers les instructions, à gauche. */}
            <FlecheVers rang={0} colonne={1} />
            {/* Les deux cartes s'étirent à la même hauteur, la flèche entre elles. */}
            <div style={{ ...COLONNES_RANGEE, alignItems: "stretch" }}>
              <Carte rang={1}>
                <Etape icone={ScrollText} libelle={tMaquettes("instructions")} />
                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  <Ligne largeur={86} hauteur={6} />
                  <Ligne largeur={58} hauteur={6} />
                </div>
              </Carte>
              <Fleche rang={1} horizontale />
              <Carte rang={2} bordure="rgba(212, 165, 74, 0.45)">
                <Etape icone={Cpu} libelle={tMaquettes("modele")} badge={<BadgeIA libelle={tMaquettes("parametresPublies")} />} />
                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  <Ligne largeur={88} hauteur={6} classe="landing-reflet" />
                  <Ligne largeur={60} hauteur={6} classe="landing-reflet" />
                </div>
              </Carte>
            </div>
            {/* Du modèle vers le résumé, à droite. */}
            <FlecheVers rang={2} colonne={3} />
            {/* Bordure dorée des cartes IA de la fiche (`AI_FRAME_STYLE`). */}
            <Carte rang={3} bordure="rgba(212, 165, 74, 0.45)">
              {/* L'intitulé et son badge sur une même ligne, tant que la largeur le permet. */}
              <div className="flex flex-wrap items-center" style={{ gap: "6px 10px" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{tMaquettes("resume")}</span>
                <BadgeIA libelle={tResume("aiBadge")} />
              </div>
              <div style={{ display: "grid", gap: 11, marginTop: 12 }}>
                {[Target, Zap, Bookmark].map((Icone, i) => (
                  <span key={i} className="flex items-center" style={{ gap: 10 }}>
                    <Icone style={{ width: 14, height: 14, flex: "none", color: "#06B6D4" }} />
                    <Ligne largeur={[78, 90, 64][i]} />
                  </span>
                ))}
              </div>
            </Carte>
          </div>
        </Surface>
      }
    />
  )
}

/**
 * « Comment on arrive à nos chiffres », maquette à droite : la section qui la précède,
 * `PourVousSection`, a la sienne à gauche. Seule section de la landing qui lit la base.
 */
export async function MethodeChiffres({ locale }: { locale: string }) {
  const [t, tMaquettes, tHub, tLanding, promulgation] = await Promise.all([
    getTranslations({ locale, namespace: "landing.methode" }),
    getTranslations({ locale, namespace: "landing.maquettes" }),
    getTranslations({ locale, namespace: "kpisHub" }),
    getTranslations({ locale, namespace: "landing" }),
    getTauxPromulgation(),
  ])

  // La couleur de l'article, comme son grand chiffre sur `/Facts/taux-promulgation`.
  const couleur = FACTS_ARTICLES.find((a) => a.href === "/Facts/taux-promulgation")?.color ?? "var(--primary)"
  // L'anglais colle le signe pour cent ; le français le sépare d'une espace fine insécable.
  const taux = `${promulgation.tauxPromulgation.toLocaleString(locale)}${locale === "en" ? "%" : " %"}`

  return (
    <SectionIllustree
      texte={<TexteMethode titre={t("chiffresTitre")} texte={t("chiffresTexte")} lien={t("chiffresLien")} href="/Facts" />}
      visuel={
        <Surface>
          {/* Le chemin d'un chiffre : les sources officielles, dont les données sont
            rassemblées et recoupées entre elles, puis analysées, et le chiffre publié
            avec son périmètre, sa méthode et ses limites. Même mise en valeur que le
            chemin d'un résumé (`rang`). */}
          <div aria-hidden style={{ display: "grid", gap: 8 }}>
            <Carte rang={0}>
              <Etape icone={Landmark} libelle={tMaquettes("sources")} />
              <div className="flex flex-wrap" style={{ gap: 6, marginTop: 10 }}>
                {SOURCES_ACCUEIL.filter((s) => s.officielle && !HORS_CARTE_SOURCES.has(s.cle)).map(({ cle }) => (
                  <span
                    key={cle}
                    className="text-muted-foreground"
                    style={{ fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--border)", whiteSpace: "nowrap" }}
                  >
                    {tLanding(cle)}
                  </span>
                ))}
              </div>
            </Carte>
            {/* Des sources vers la base, à gauche. */}
            <FlecheVers rang={0} colonne={1} />
            <div style={{ ...COLONNES_RANGEE, alignItems: "stretch" }}>
              <Carte rang={1}>
                <Etape icone={Database} libelle={tMaquettes("recoupees")} />
                <div style={{ display: "grid", gap: 5, marginTop: 10 }}>
                  <RangeeBase largeurs={[2, 3, 2]} />
                  <RangeeBase largeurs={[2, 2, 3]} />
                  <RangeeBase largeurs={[2, 3, 2]} />
                </div>
              </Carte>
              <Fleche rang={1} horizontale />
              <Carte rang={2}>
                <Etape icone={ChartColumn} libelle={tMaquettes("analyses")} />
                <div className="flex items-end" style={{ gap: 5, height: 30, marginTop: 10 }}>
                  {[40, 70, 52, 90, 62].map((h, i) => (
                    <span key={i} style={{ flex: 1, height: `${h}%`, borderRadius: 3, backgroundColor: couleur, opacity: i === 3 ? 0.9 : 0.3 }} />
                  ))}
                </div>
              </Carte>
            </div>
            {/* Des analyses vers le chiffre publié, à droite. */}
            <FlecheVers rang={2} colonne={3} />
            <Carte rang={3}>
              <p style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.4 }}>{tHub("q1")}</p>
              <p
                style={{
                  marginTop: 4,
                  fontSize: "clamp(2rem, 4vw, 2.5rem)",
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                  color: couleur,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {taux}
              </p>
              {/* Ce que chaque page de chiffre dit à côté du résultat. */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                {[tMaquettes("perimetre"), tMaquettes("methode"), tMaquettes("limites")].map((libelle, i) => (
                  <div key={libelle} style={{ minWidth: 0 }}>
                    <Intitule>{libelle}</Intitule>
                    <Ligne largeur={[88, 76, 82][i]} hauteur={6} style={{ marginTop: 7 }} />
                  </div>
                ))}
              </div>
            </Carte>
          </div>
        </Surface>
      }
    />
  )
}
