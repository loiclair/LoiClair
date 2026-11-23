import { domainToUnicode } from "node:url"
import { getTranslations } from "next-intl/server"
import { ArrowRight, Newspaper } from "lucide-react"

import { Link } from "@/i18n/navigation"
import { getLoisDansLActualite, JOURS_ACTUALITE } from "@/lib/landing-queries"
import { milestoneOf, STEP_CONFIG } from "@/lib/legislative-steps"
import { translateStatut } from "@/lib/statut"
import { getStatusBadgeClass } from "@/lib/status-mapping"
import { titreDossier, titreTraduit } from "@/lib/titre-dossier"
import { AIBadgeTitre } from "@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements"
import { CarrouselActualite } from "./CarrouselActualite"
import { STYLE_TITRE_SECTION } from "./Maquettes"

/**
 * « Les lois dans l'actualité », juste sous le hero : jusqu'à six vrais textes, ceux qui
 * ont franchi le plus d'étapes marquantes ces trente derniers jours
 * (`getLoisDansLActualite`), chacun en carte vers son résumé, dans une rangée défilante
 * (`CarrouselActualite`). Seule section de la landing qui montre du contenu réel
 * (D-373) : les autres sont des maquettes figurées (D-207). Rendue par
 * `(landing)/page.tsx`, côté serveur ; la page est statique et la liste se recalcule
 * chaque nuit avec elle.
 *
 * Une carte : le statut du texte, son titre, puis « Pourquoi ici » et la liste datée de
 * ses étapes de la fenêtre (trois au plus, puis « et N autres »), ce qui montre la règle
 * à l'œuvre, même pour une loi déjà promulguée dont seuls les décrets avancent. Enfin,
 * quand il en a, le nombre d'articles de presse et jusqu'à trois de leurs sources. Aucun
 * texte : la section disparaît.
 */

/** Étapes listées par carte ; au-delà, « et N autres ». */
const ETAPES_MONTREES = 3

type Traducteur = (cle: string, valeurs?: Record<string, string | number>) => string

/**
 * Libellé d'une étape de `ACTES_MARQUANTS`, lu sur son code et jamais sur `libelle_acte`,
 * qui varie selon la provenance (voir `ACTE_SUFFIX_LABELS`). La lecture vient du
 * namespace `steps`, celui du parcours de la fiche. Un code inconnu rend `null` : l'étape
 * compte, mais ne s'affiche pas sous un code brut.
 */
function libelleEtape(code: string, t: Traducteur, tSteps: Traducteur): string | null {
  if (code === "CC-CONCLUSION") return t("etapeCC")
  if (code === "PROM-PUB") return t("etapePromulgation")
  if (code === "DECAPP-PUB") return t("etapeDecret")
  if (code.endsWith("-DEPOT")) {
    const lecture = code.slice(0, -"-DEPOT".length)
    return STEP_CONFIG[lecture] ? t("etapeDepot", { lecture: tSteps(lecture) }) : null
  }
  const lecture = milestoneOf(code)
  if (!lecture) return null
  // La commission mixte paritaire se vote dans chaque chambre : la chambre le dit.
  if (lecture === "CMP") {
    const chambre = code.includes("-AN-") ? t("chambreAN") : t("chambreSenat")
    return t("etapeVote", { lecture: `${tSteps("CMP")} (${chambre})` })
  }
  return t("etapeVote", { lecture: tSteps(lecture) })
}

export async function ActualiteLois({ locale }: { locale: string }) {
  const [t, tDossiers, tSteps, lois] = await Promise.all([
    getTranslations({ locale, namespace: "landing.actualiteLois" }),
    getTranslations({ locale, namespace: "dossiers" }),
    getTranslations({ locale, namespace: "steps" }),
    getLoisDansLActualite(),
  ])
  if (lois.length === 0) return null

  // La date vient sans fuseau (`timestamp`) : lue en UTC, elle ne recule pas d'un jour
  // selon le fuseau du serveur qui rend la page.
  const formatDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" })
  const dateDe = (horodatage: string) => formatDate.format(new Date(`${horodatage.slice(0, 10)}T00:00:00Z`))
  // Un titre traduit par l'IA porte la mention IA ; chaque titre étant un lien, elle se
  // pose une fois, en tête de section (`lib/titre-dossier.ts`).
  const titresTraduits = lois.some((l) => titreTraduit(l, locale))
  // Le flux de presse donne parfois pour nom de source un domaine accentué encodé
  // (`xn--cfdt-retraits-mhb.fr`, constaté le 2026-11-22) : il s'affiche décodé.
  const nomSource = (nom: string) => (nom.includes("xn--") ? domainToUnicode(nom) || nom : nom)

  return (
    <section
      className="max-w-[90rem] mx-auto px-10 lg:px-20"
      style={{ paddingTop: "clamp(2rem, 4vw, 3rem)", paddingBottom: "clamp(2.5rem, 5vw, 4rem)" }}
    >
      <div className="flex flex-wrap items-end justify-between" style={{ gap: "0.75rem 2rem" }}>
        <div style={{ minWidth: 0 }}>
          <h2 className="text-balance flex flex-wrap items-center" style={{ ...STYLE_TITRE_SECTION, gap: "0.5rem 0.75rem" }}>
            {t("titre")}
            {titresTraduits && <AIBadgeTitre pluriel />}
          </h2>
          <p className="text-muted-foreground" style={{ marginTop: "0.6rem", maxWidth: "40rem", fontSize: "1.0625rem", lineHeight: 1.6 }}>
            {t("sousTitre", { jours: JOURS_ACTUALITE })}
          </p>
        </div>
        <Link
          href="/dossiers-legislatifs"
          className="inline-flex items-center hover:underline"
          style={{ gap: 6, fontSize: "0.9375rem", fontWeight: 600, color: "var(--primary)" }}
        >
          {t("lien")}
          <ArrowRight aria-hidden style={{ width: 16, height: 16 }} />
        </Link>
      </div>
      <CarrouselActualite precedent={t("precedent")} suivant={t("suivant")}>
        {lois.map((loi) => {
          const etapes = loi.liste_etapes
            .map((e) => ({ libelle: libelleEtape(e.code, t, tSteps), date: e.date }))
            .filter((e): e is { libelle: string; date: string } => e.libelle !== null)
          const autres = etapes.length - ETAPES_MONTREES
          return (
            <Link
              key={loi.uid}
              href={`/dossiers-legislatifs/${loi.uid}/resume-ia`}
              className="border bg-card transition-colors hover:border-primary"
              style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", padding: 18, borderRadius: 14 }}
            >
              {loi.statut_final && (
                <span
                  className={`self-start border ${getStatusBadgeClass(loi.statut_final)}`}
                  style={{ fontSize: 12, fontWeight: 600, padding: "2px 10px", borderRadius: 999 }}
                >
                  {translateStatut(loi.statut_final, tDossiers)}
                </span>
              )}
              {/* Trois lignes au plus : un titre officiel dépasse souvent les deux cents
                caractères. */}
              <span
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  fontSize: "1.0625rem",
                  fontWeight: 600,
                  lineHeight: 1.35,
                  letterSpacing: "-0.01em",
                }}
              >
                {titreDossier(loi, locale)}
              </span>
              {/* Pourquoi ce texte est là : ses étapes de la fenêtre, la plus récente
                d'abord, avec leur date. */}
              <span style={{ display: "block", fontSize: "0.8125rem", lineHeight: 1.5 }}>
                <span className="text-muted-foreground" style={{ display: "block", fontWeight: 600 }}>
                  {/* Le compte des étapes affichables, pas `nb_etapes` : un code sans
                    libellé est écarté de la liste, et le total doit rester égal aux
                    lignes montrées plus « et N autres ». */}
                  {t("pourquoi", { n: etapes.length, jours: JOURS_ACTUALITE })}
                </span>
                <span style={{ display: "grid", gap: 3, marginTop: 6 }}>
                  {etapes.slice(0, ETAPES_MONTREES).map((e, i) => (
                    <span key={i} className="flex items-baseline" style={{ gap: 8 }}>
                      <span aria-hidden style={{ width: 5, height: 5, flex: "none", borderRadius: 999, backgroundColor: "var(--primary)", transform: "translateY(-2px)" }} />
                      <span style={{ minWidth: 0 }}>
                        {e.libelle}
                        <span className="text-muted-foreground"> · {dateDe(e.date)}</span>
                      </span>
                    </span>
                  ))}
                  {autres > 0 && (
                    <span className="text-muted-foreground" style={{ paddingLeft: 13 }}>
                      {t("autresEtapes", { n: autres })}
                    </span>
                  )}
                </span>
              </span>
              {loi.nb_articles > 0 && (
                <span
                  className="flex items-start"
                  style={{ marginTop: "auto", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 13, lineHeight: 1.45 }}
                >
                  <Newspaper aria-hidden style={{ width: 15, height: 15, flex: "none", marginTop: 2, color: "var(--primary)" }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{t("articles", { n: loi.nb_articles })}</span>
                    {loi.sources.length > 0 && <span className="text-muted-foreground"> · {loi.sources.map(nomSource).join(", ")}</span>}
                  </span>
                </span>
              )}
            </Link>
          )
        })}
      </CarrouselActualite>
    </section>
  )
}
