import { ArrowDown, ArrowRight } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { BadgeIA, Carte, Ligne, SectionIllustree, Surface, TexteSection } from "./Maquettes"

/**
 * Section 02 « Les lois » de la landing : « Comprendre une loi en deux minutes », maquette
 * à gauche. Rendue par `(landing)/page.tsx`, après `PourVousSection`.
 *
 * La maquette est celle de la v8 approuvée (`mockups/landing-benefices/`), retenue par
 * Alex après l'essai du 2026-11-22 à la place de la carte animée avant / après : le texte
 * officiel, dense, une flèche dorée, puis le résumé de la fiche, aéré et signalé comme
 * écrit par une IA, en trois blocs aux intitulés du site (`resumeIA`) : l'objectif, les
 * mesures, et le parcours en barre de progression. Aucun vrai texte (D-207) : le contenu
 * est figuré par des lignes grises. Les deux cartes se suivent en colonne sous `sm`, la
 * flèche pointant alors vers le bas.
 */

/** Intitulé d'un bloc du résumé, en petit et gris, comme les sous-titres de la fiche. */
function Bloc({ libelle, children }: { libelle: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-muted-foreground" style={{ fontSize: 12, fontWeight: 700, marginBottom: 7 }}>
        {libelle}
      </p>
      {children}
    </div>
  )
}

export async function LoiEnClair({ locale }: { locale: string }) {
  const [t, tMaquettes, tResume] = await Promise.all([
    getTranslations({ locale, namespace: "landing.loiEnClair" }),
    getTranslations({ locale, namespace: "landing.maquettes" }),
    getTranslations({ locale, namespace: "resumeIA" }),
  ])

  // Le texte officiel : quinze lignes serrées, dont une courte, comme un alinéa qui finit.
  const lignesOfficielles = [100, 96, 100, 92, 98, 100, 88, 97, 100, 94, 60, 100, 95, 99, 72]

  return (
    <SectionIllustree
      numero={2}
      surTitre={t("surTitre")}
      inverse
      texte={<TexteSection titre={t("titre")} texte={t("texte")} liens={[{ libelle: t("lien"), href: "/dossiers-legislatifs" }]} />}
      visuel={
        <Surface>
          <figure
            aria-label={t("aria")}
            className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.9fr)_auto_minmax(0,1.1fr)]"
            style={{ margin: 0, gap: 12, alignItems: "center" }}
          >
            <Carte>
              {/* Pas de petites capitales : elles écrivaient « ARTICLE 1ER ». */}
              <p className="text-muted-foreground" style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
                {tMaquettes("texteOfficiel")} · {tMaquettes("article1")}
              </p>
              <div aria-hidden style={{ display: "grid", gap: 5 }}>
                {lignesOfficielles.map((l, i) => (
                  <Ligne key={i} largeur={l} hauteur={5} />
                ))}
              </div>
            </Carte>
            {/* La flèche dorée, celle des contenus écrits par une IA : vers la droite au
              bureau, vers le bas quand les cartes passent en colonne. */}
            <span
              aria-hidden
              className="flex items-center justify-center"
              style={{ justifySelf: "center", width: 30, height: 30, borderRadius: 999, backgroundColor: "var(--card)", color: "#D4A54A", boxShadow: "0 16px 32px -24px rgba(28, 25, 23, 0.25)" }}
            >
              <ArrowRight className="max-sm:hidden" style={{ width: 15, height: 15 }} />
              <ArrowDown className="sm:hidden" style={{ width: 15, height: 15 }} />
            </span>
            {/* Bordure dorée des cartes IA de la fiche (`AI_FRAME_STYLE`). */}
            <Carte bordure="rgba(212, 165, 74, 0.45)">
              <div style={{ marginBottom: 12 }}>
                <BadgeIA libelle={tResume("aiBadge")} />
              </div>
              <div aria-hidden style={{ display: "grid", gap: 14 }}>
                <Bloc libelle={tResume("textObjective")}>
                  <span style={{ display: "grid", gap: 6 }}>
                    <Ligne largeur={95} hauteur={7} />
                    <Ligne largeur={70} hauteur={7} />
                  </span>
                </Bloc>
                <Bloc libelle={tResume("whatChanges")}>
                  <span style={{ display: "grid", gap: 6 }}>
                    <Ligne largeur={88} hauteur={7} />
                    <Ligne largeur={92} hauteur={7} />
                    <Ligne largeur={54} hauteur={7} />
                  </span>
                </Bloc>
                {/* Le parcours en cinq étapes, trois franchies : une forme, pas un état réel. */}
                <Bloc libelle={tResume("anchorParcours")}>
                  <span className="flex" style={{ gap: 4 }}>
                    {[true, true, true, false, false].map((franchie, i) => (
                      <span
                        key={i}
                        className={franchie ? undefined : "landing-ligne"}
                        style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: franchie ? "var(--primary)" : undefined }}
                      />
                    ))}
                  </span>
                </Bloc>
              </div>
            </Carte>
          </figure>
        </Surface>
      }
    />
  )
}
