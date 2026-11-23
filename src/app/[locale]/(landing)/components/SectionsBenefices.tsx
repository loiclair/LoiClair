import type { CSSProperties, ReactNode } from "react"
import { getTranslations } from "next-intl/server"
import { ChevronRight, CircleHelp, FileText, Mail, MapPin, Share2, ThumbsDown, ThumbsUp, type LucideIcon } from "lucide-react"

import { getTauxPromulgation } from "@/lib/facts-queries"
import { FACTS_ARTICLES } from "@/lib/facts-registry"
import { ECHELLE_HEMICYCLE } from "@/lib/hemicycle"
import { POSITIONS_SIEGES } from "@/lib/hemicycle-sieges"
import { getDernierScrutinNominatif } from "@/lib/landing-queries"
import { BadgeIA, Carte, Ligne, SectionIllustree, Surface, TexteSection } from "./Maquettes"

/**
 * Sections 03 à 06 de la landing, chacune un bénéfice pour le lecteur avec sa maquette
 * figurée (D-207) : « Les débats » (`DebatsSection`), « Les votes » (`VotesSection`),
 * « Les chiffres » (`ChiffresSection`) et « Vos élus » (`ElusSection`). Rendues par
 * `(landing)/page.tsx` après `PourVousSection` (01) et `LoiEnClair` (02), maquette à
 * droite pour les numéros impairs, à gauche pour les pairs.
 *
 * Les intitulés des maquettes sont ceux du site (`resumeIA`, `scrutinVotes`, `elus`,
 * `etatDesLieux`, `kpisHub`) ou de `landing.maquettes`, le contenu est figuré par des
 * lignes grises. Seuls deux éléments sont réels : le taux de promulgation de la section
 * des chiffres, lu dans le helper de son article (D-014), et l'adresse du dernier vote,
 * vers lequel mène le lien de la section des votes (`getDernierScrutinNominatif`).
 *
 * Dimensions en style inline, comme dans `Maquettes.tsx` : Safari lit mal les tailles
 * numériques de Tailwind v4.
 */

const VERT = "#27AE60"
const ROUGE = "#E74C3C"
const NEUTRE = "color-mix(in srgb, var(--muted-foreground) 45%, transparent)"

/** Teinte légère d'une couleur sur le fond de carte, valable en thème clair et sombre. */
const teinte = (couleur: string, part: number) => `color-mix(in srgb, ${couleur} ${part}%, transparent)`

/** Intitulé d'une carte de maquette, en petites capitales grises. */
function Intitule({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span
      className="text-muted-foreground"
      style={{ display: "block", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", ...style }}
    >
      {children}
    </span>
  )
}

/** Petite pastille à bord fin, comme les étiquettes de méthode des pages de chiffres. */
function Pastille({ children, icone: Icone }: { children: ReactNode; icone?: LucideIcon }) {
  return (
    <span
      className="inline-flex items-center"
      style={{ gap: 4, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, border: "1px solid var(--border)", whiteSpace: "nowrap" }}
    >
      {Icone && <Icone aria-hidden style={{ width: 11, height: 11, flex: "none" }} />}
      {children}
    </span>
  )
}

/** Étiquette de vote colorée (pour, contre), comme sur la fiche d'un élu. */
function Vote({ couleur, children }: { couleur: string; children: ReactNode }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, color: couleur, backgroundColor: teinte(couleur, 13), whiteSpace: "nowrap" }}>
      {children}
    </span>
  )
}

/** Portrait figuré : un disque de la couleur des formes de maquette. */
function Portrait({ taille }: { taille: number }) {
  return <span className="landing-carte-maquette" style={{ display: "block", width: taille, height: taille, flex: "none", borderRadius: 999 }} />
}

// ---------------------------------------------------------------------------
// 03 Les débats
// ---------------------------------------------------------------------------

/** Une colonne d'arguments figurés : l'icône du camp, son libellé, trois arguments. */
function Camp({ icone: Icone, couleur, libelle, lignes }: { icone: LucideIcon; couleur: string; libelle: string; lignes: [number, number][] }) {
  return (
    <Carte>
      <span className="flex items-center" style={{ gap: 6, fontSize: 12, fontWeight: 700, color: couleur }}>
        <Icone aria-hidden style={{ width: 15, height: 15, flex: "none" }} />
        {libelle}
      </span>
      <div style={{ display: "grid", gap: 12, marginTop: 10 }}>
        {lignes.map(([a, b], i) => (
          <span key={i} className="landing-mini-entree" style={{ display: "grid", gridTemplateColumns: "6px minmax(0, 1fr)", gap: 8, alignItems: "start", "--ordre": i * 2 } as CSSProperties}>
            <span style={{ width: 6, height: 6, marginTop: 1, borderRadius: 999, backgroundColor: couleur }} />
            <span style={{ display: "grid", gap: 5 }}>
              <Ligne largeur={a} hauteur={6} />
              <Ligne largeur={b} hauteur={6} />
            </span>
          </span>
        ))}
      </div>
    </Carte>
  )
}

export async function DebatsSection({ locale }: { locale: string }) {
  const [t, tResume, tElus, tVote] = await Promise.all([
    getTranslations({ locale, namespace: "landing.debats" }),
    getTranslations({ locale, namespace: "resumeIA" }),
    getTranslations({ locale, namespace: "elus" }),
    getTranslations({ locale, namespace: "scrutinVotes" }),
  ])
  return (
    <SectionIllustree
      numero={3}
      surTitre={t("surTitre")}
      texte={<TexteSection titre={t("titre")} texte={t("texte")} liens={[{ libelle: t("lien"), href: "/dossiers-legislatifs" }]} />}
      visuel={
        <Surface>
          {/* Les arguments pour et contre côte à côte, puis la carte du débat de la fiche,
            signalée comme écrite par une IA, avec son lien vers le compte rendu. */}
          <div aria-hidden style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            <Camp icone={ThumbsUp} couleur={VERT} libelle={tElus("votePositionPour")} lignes={[[92, 60], [85, 70], [90, 40]]} />
            <Camp icone={ThumbsDown} couleur={ROUGE} libelle={tElus("votePositionContre")} lignes={[[88, 66], [94, 52], [80, 45]]} />
            <div style={{ gridColumn: "1 / -1" }}>
              <Carte bordure="rgba(212, 165, 74, 0.45)">
                <div className="flex flex-wrap items-center justify-between" style={{ gap: 8 }}>
                  <span className="flex flex-wrap items-center" style={{ gap: "6px 10px" }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{tResume("sectionDebat")}</span>
                    <BadgeIA libelle={tResume("aiBadge")} />
                  </span>
                  <Pastille icone={FileText}>{tVote("pageLireDebats")}</Pastille>
                </div>
              </Carte>
            </div>
          </div>
        </Surface>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// 04 Les votes
// ---------------------------------------------------------------------------

// Cadre du dessin, celui de `Scrutins/[uid]/HemicycleVote.tsx` : le plan normalisé tient
// dans un demi-cercle de rayon `ECHELLE_HEMICYCLE`, avec une marge de 3 %.
const MARGE_HEMI = ECHELLE_HEMICYCLE * 0.03
const VIEWBOX_HEMI = `${-ECHELLE_HEMICYCLE - MARGE_HEMI} ${-ECHELLE_HEMICYCLE - MARGE_HEMI} ${2 * (ECHELLE_HEMICYCLE + MARGE_HEMI)} ${ECHELLE_HEMICYCLE + 2 * MARGE_HEMI}`

/**
 * Couleur figurée d'un siège, selon sa place de gauche à droite : un bloc pour, une
 * bande d'abstentions, un bloc contre, et quelques sièges vides semés sans motif. Ce
 * n'est aucun vote réel ; la forme, elle, est le vrai plan de l'Assemblée
 * (`hemicycle-sieges.ts`). Calcul entier sur l'indice : serveur et navigateur rendent le
 * même SVG.
 */
function couleurSiege(i: number, n: number): string {
  if ((i * 7) % 23 === 0) return "var(--border)"
  const part = (i * 100) / n
  if (part < 52) return VERT
  if (part < 60) return NEUTRE
  return ROUGE
}

export async function VotesSection({ locale }: { locale: string }) {
  const [t, tMaquettes, tElus, tVote, scrutin] = await Promise.all([
    getTranslations({ locale, namespace: "landing.votes" }),
    getTranslations({ locale, namespace: "landing.maquettes" }),
    getTranslations({ locale, namespace: "elus" }),
    getTranslations({ locale, namespace: "scrutinVotes" }),
    getDernierScrutinNominatif(),
  ])
  const plan = POSITIONS_SIEGES.AN
  return (
    <SectionIllustree
      numero={4}
      surTitre={t("surTitre")}
      inverse
      texte={
        <TexteSection
          titre={t("titre")}
          texte={t("texte")}
          liens={[{ libelle: t("lien"), href: scrutin ? `/Scrutins/${scrutin}` : "/dossiers-legislatifs" }]}
        />
      }
      visuel={
        <Surface>
          {/* L'hémicycle du résultat et ses trois positions, puis les élus qui ont voté
            contre leur groupe et le bouton de partage du vote. Une colonne sous 560 px. */}
          <div aria-hidden className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 8 }}>
            <Carte>
              <Intitule>{tMaquettes("resultat")}</Intitule>
              <svg viewBox={VIEWBOX_HEMI} style={{ display: "block", width: "100%", height: "auto", marginTop: 10 }}>
                {plan.points.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={plan.rayon} style={{ fill: couleurSiege(i, plan.points.length) }} />
                ))}
              </svg>
              <div className="flex flex-wrap" style={{ gap: 6, marginTop: 12 }}>
                <Vote couleur={VERT}>{tElus("votePositionPour")}</Vote>
                <Vote couleur={ROUGE}>{tElus("votePositionContre")}</Vote>
                <Pastille>{tElus("votePositionAbstention")}</Pastille>
              </div>
            </Carte>
            <Carte>
              <Intitule>{tMaquettes("dissidents")}</Intitule>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {[[70, 40], [62, 46], [76, 36]].map(([a, b], i) => (
                  <span key={i} className="landing-mini-entree flex items-center" style={{ gap: 10, "--ordre": 2 + i * 2 } as CSSProperties}>
                    <Portrait taille={30} />
                    <span style={{ flex: 1, display: "grid", gap: 5 }}>
                      <Ligne largeur={a} hauteur={6} />
                      <Ligne largeur={b} hauteur={5} />
                    </span>
                  </span>
                ))}
              </div>
              <span
                className="flex items-center justify-center"
                style={{ gap: 6, marginTop: 14, height: 34, borderRadius: 999, border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--primary)" }}
              >
                <Share2 aria-hidden style={{ width: 14, height: 14, flex: "none" }} />
                {tVote("partagerLabel")}
              </span>
            </Carte>
          </div>
        </Surface>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// 05 Les chiffres
// ---------------------------------------------------------------------------

/** Tuile du tableau de bord figuré : un contenu en haut, deux lignes dessous. */
function Tuile({ children, lignes }: { children: ReactNode; lignes: [number, number] }) {
  return (
    <div style={{ minWidth: 0, padding: 10, borderRadius: 10, border: "1px solid var(--border)" }}>
      {children}
      <span style={{ display: "grid", gap: 5, marginTop: 8 }}>
        <Ligne largeur={lignes[0]} hauteur={5} />
        <Ligne largeur={lignes[1]} hauteur={5} />
      </span>
    </div>
  )
}

/** Petit histogramme d'une tuile ; `fort` est l'indice de la barre mise en valeur. */
function MiniBarres({ hauteurs, fort }: { hauteurs: number[]; fort: number }) {
  return (
    <span className="flex items-end" style={{ gap: 3, height: 26 }}>
      {hauteurs.map((h, i) => (
        <span
          key={i}
          className="landing-mini-y"
          style={{ display: "block", flex: 1, height: `${h}%`, borderRadius: "2px 2px 0 0", backgroundColor: "var(--primary)", opacity: i === fort ? 1 : 0.3, "--ordre": i } as CSSProperties}
        />
      ))}
    </span>
  )
}

export async function ChiffresSection({ locale }: { locale: string }) {
  const [t, tMaquettes, tEdl, tHub, promulgation] = await Promise.all([
    getTranslations({ locale, namespace: "landing.chiffres" }),
    getTranslations({ locale, namespace: "landing.maquettes" }),
    getTranslations({ locale, namespace: "etatDesLieux" }),
    getTranslations({ locale, namespace: "kpisHub" }),
    getTauxPromulgation(),
  ])
  // La couleur de l'article, comme son grand chiffre sur `/Facts/taux-promulgation`.
  const couleur = FACTS_ARTICLES.find((a) => a.href === "/Facts/taux-promulgation")?.color ?? "var(--primary)"
  // L'anglais colle le signe pour cent ; le français le sépare d'une espace fine insécable.
  const taux = `${promulgation.tauxPromulgation.toLocaleString(locale)}${locale === "en" ? "%" : " %"}`

  return (
    <SectionIllustree
      numero={5}
      surTitre={t("surTitre")}
      texte={
        <TexteSection
          titre={t("titre")}
          texte={t("texte")}
          liens={[
            { libelle: t("lien"), href: "/etat-des-lieux" },
            { libelle: t("lien2"), href: "/Facts" },
          ]}
        />
      }
      visuel={
        <Surface>
          {/* À gauche le tableau de bord, dont la première tuile porte le vrai taux de
            promulgation, sa question au-dessus ; à droite la liste des faits, chacun une
            question, puis ce que chaque page de chiffre dit à côté du résultat. */}
          <div aria-hidden className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 8 }}>
            <Carte>
              <Intitule>{tEdl("pageTitle")}</Intitule>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginTop: 10 }}>
                <div style={{ gridColumn: "1 / -1", minWidth: 0, padding: 10, borderRadius: 10, border: "1px solid var(--border)" }}>
                  <span style={{ display: "block", fontSize: 12, fontWeight: 600, lineHeight: 1.35 }}>{tHub("q1")}</span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 6,
                      fontSize: "1.75rem",
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: "-0.03em",
                      color: couleur,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {taux}
                  </span>
                </div>
                <Tuile lignes={[85, 50]}>
                  <MiniBarres hauteurs={[40, 62, 50, 80, 58]} fort={3} />
                </Tuile>
                <Tuile lignes={[80, 60]}>
                  <MiniBarres hauteurs={[70, 45, 30, 22]} fort={0} />
                </Tuile>
              </div>
            </Carte>
            <Carte>
              <Intitule>{tHub("pageTitle")}</Intitule>
              <div style={{ marginTop: 4 }}>
                {[[92, 60], [86, 48], [90, 66], [80, 52]].map(([a, b], i) => (
                  <span key={i} className="flex items-center" style={{ gap: 10, padding: "10px 0", borderTop: i === 0 ? undefined : "1px solid var(--border)" }}>
                    <CircleHelp style={{ width: 15, height: 15, flex: "none", color: "var(--primary)" }} />
                    <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 5 }}>
                      <Ligne largeur={a} hauteur={6} />
                      <Ligne largeur={b} hauteur={5} />
                    </span>
                    <ChevronRight style={{ width: 14, height: 14, flex: "none", color: "var(--muted-foreground)" }} />
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap text-muted-foreground" style={{ gap: 6, marginTop: 6 }}>
                <Pastille>{tHub("labelSource")}</Pastille>
                <Pastille>{tMaquettes("methode")}</Pastille>
                <Pastille>{tMaquettes("limites")}</Pastille>
              </div>
            </Carte>
          </div>
        </Surface>
      }
    />
  )
}

// ---------------------------------------------------------------------------
// 06 Vos élus
// ---------------------------------------------------------------------------

export async function ElusSection({ locale }: { locale: string }) {
  const [t, tMaquettes, tElus] = await Promise.all([
    getTranslations({ locale, namespace: "landing.elus" }),
    getTranslations({ locale, namespace: "landing.maquettes" }),
    getTranslations({ locale, namespace: "elus" }),
  ])
  // Pour, contre, pour : trois votes figurés, sans texte réel en face.
  const votes = [
    { largeur: 78, couleur: VERT, libelle: tElus("votePositionPour") },
    { largeur: 64, couleur: ROUGE, libelle: tElus("votePositionContre") },
    { largeur: 84, couleur: VERT, libelle: tElus("votePositionPour") },
  ]
  return (
    <SectionIllustree
      numero={6}
      surTitre={t("surTitre")}
      inverse
      texte={
        <TexteSection
          titre={t("titre")}
          texte={t("texte")}
          garde={t("garde")}
          liens={[{ libelle: t("lien"), href: "/les-elus" }]}
        />
      }
      visuel={
        <Surface>
          {/* Le code postal qui se tape (cinq points, aucun vrai code), le député trouvé,
            ses derniers votes, puis le bouton qui ouvre la messagerie du lecteur. */}
          <div aria-hidden style={{ maxWidth: 440, marginInline: "auto" }}>
            <Carte>
              <span className="flex items-center" style={{ gap: 8, height: 38, padding: "0 6px 0 12px", borderRadius: 999, border: "1px solid var(--border)" }}>
                <MapPin style={{ width: 15, height: 15, flex: "none", color: "var(--muted-foreground)" }} />
                <span className="flex" style={{ gap: 5 }}>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className="landing-mini-entree"
                      style={{ display: "block", width: 7, height: 7, borderRadius: 999, backgroundColor: "var(--muted-foreground)", opacity: 0.55, "--ordre": i } as CSSProperties}
                    />
                  ))}
                </span>
                <span
                  className="flex items-center justify-center"
                  style={{ marginLeft: "auto", width: 28, height: 28, borderRadius: 999, backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }}
                >
                  <ChevronRight style={{ width: 15, height: 15 }} />
                </span>
              </span>
              <span className="landing-mini-entree flex items-center" style={{ gap: 12, marginTop: 14, "--ordre": 6 } as CSSProperties}>
                <Portrait taille={52} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>{tMaquettes("votreDepute")}</span>
                  <span style={{ display: "grid", gap: 5, marginTop: 7 }}>
                    <Ligne largeur={60} hauteur={6} />
                    <Ligne largeur={40} hauteur={5} />
                  </span>
                </span>
              </span>
              <Intitule style={{ marginTop: 16 }}>{tMaquettes("derniersVotes")}</Intitule>
              <div style={{ marginTop: 4 }}>
                {votes.map(({ largeur, couleur, libelle }, i) => (
                  <span
                    key={i}
                    className="flex items-center"
                    style={{ gap: 10, padding: "8px 0", borderTop: i === 0 ? undefined : "1px solid var(--border)" }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <Ligne largeur={largeur} hauteur={6} />
                    </span>
                    <Vote couleur={couleur}>{libelle}</Vote>
                  </span>
                ))}
              </div>
              <span
                className="flex items-center justify-center"
                style={{ gap: 6, marginTop: 10, height: 36, borderRadius: 999, backgroundColor: "var(--primary)", color: "var(--primary-foreground)", fontSize: 12.5, fontWeight: 600 }}
              >
                <Mail style={{ width: 14, height: 14, flex: "none" }} />
                {tMaquettes("ecrireDepute")}
              </span>
            </Carte>
          </div>
        </Surface>
      }
    />
  )
}
