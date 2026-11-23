import { getTranslations } from "next-intl/server"
import { Landmark } from "lucide-react"

import { Link } from "@/i18n/navigation"
import PhotoEluVignette from "@/components/PhotoEluVignette"
import { estAncienElu } from "@/lib/ancien-elu"
import { ECHELLE_HEMICYCLE, pointsHemicycle, type PointHemicycle } from "@/lib/hemicycle"
import { getLoisDansLActualite, JOURS_ACTUALITE, type LoiActualite } from "@/lib/landing-queries"
import { SCRUTIN_COLORS, statutDuVote } from "@/lib/scrutin-affichage"
import { chargerVotesScrutin, type ScrutinVotesResponse } from "@/lib/scrutin-votes"
import { lireParcours } from "@/lib/vote-page"
import type { EtapeDuParcours } from "@/lib/legislative-steps"
import { milestoneOf, STEP_CONFIG } from "@/lib/legislative-steps"
import { initiateurAffiche, LIBELLE_GOUVERNEMENT } from "@/lib/origine-gouvernementale"
import { translateStatut } from "@/lib/statut"
import { getStatusBadgeClass } from "@/lib/status-mapping"
import { titreDossier, titreTraduit } from "@/lib/titre-dossier"
import { AIBadgeTitre } from "@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements"
import { CarrouselActualite } from "./CarrouselActualite"

/**
 * « Les lois dans l'actualité », juste sous le hero : jusqu'à dix vrais textes, ceux qui
 * ont franchi le plus d'étapes marquantes ces trente derniers jours
 * (`getLoisDansLActualite`), chacun en carte vers son résumé, dans une rangée défilante
 * (`CarrouselActualite`). Seule section de la landing qui montre du contenu réel
 * (D-373) : les autres sont des maquettes figurées (D-207). Rendue par
 * `(landing)/page.tsx`, côté serveur ; la page est statique et la liste se recalcule
 * chaque nuit avec elle.
 *
 * Une carte : le statut du texte, son titre, qui l'a proposé (portrait officiel, nom et
 * groupe, ou « Gouvernement »), puis son dernier événement et sa date ; quand cet
 * événement est un vote à liste nominative, son hémicycle, siège par siège comme sur la
 * page du vote, avec le résultat et le décompte ; sinon, la frise du parcours du texte
 * (`lireParcours`, celui de la page d'un vote), pour que chaque carte ait son visuel et
 * qu'aucune ne garde le vide laissé par la hauteur des autres. Alex a retiré la liste des étapes et la
 * presse de la première version (retour sur l'essai du 2026-11-22) : elles ne disaient
 * rien au lecteur. Aucun texte : la section disparaît.
 */

type Traducteur = (cle: string, valeurs?: Record<string, string | number>) => string

/**
 * Libellé d'une étape de `ACTES_MARQUANTS`, lu sur son code et jamais sur `libelle_acte`,
 * qui varie selon la provenance (voir `ACTE_SUFFIX_LABELS`). La lecture vient du
 * namespace `steps`, celui du parcours de la fiche. Un code inconnu rend `null` : la
 * carte n'affiche alors pas d'événement plutôt qu'un code brut.
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

/**
 * Qui a proposé le texte : le portrait officiel et le nom de l'élu à l'initiative, avec
 * son groupe, ou « Gouvernement » pour un projet de loi (`initiateurAffiche`, la même
 * règle que la liste des textes). Un projet de loi sans ministre nommé prend un rond à
 * l'icône d'institution. Un ancien élu a son portrait grisé, comme partout sur le site.
 * Rien quand l'auteur est inconnu.
 */
function Auteur({ loi, gouvernement }: { loi: LoiActualite; gouvernement: string }) {
  const { nom, groupe } = initiateurAffiche(loi)
  const acteur = loi.initiateur_acteur_ref
  const libelleGroupe = groupe === LIBELLE_GOUVERNEMENT ? gouvernement : groupe
  if (!nom && !libelleGroupe) return null
  return (
    <span className="flex items-center" style={{ gap: 10, minWidth: 0 }}>
      {acteur ? (
        <PhotoEluVignette acteur={acteur} taille={36} ancien={estAncienElu(acteur)} />
      ) : (
        <span
          aria-hidden
          className="flex items-center justify-center"
          style={{ width: 36, height: 36, flex: "none", borderRadius: 999, backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }}
        >
          <Landmark style={{ width: 17, height: 17 }} />
        </span>
      )}
      <span style={{ minWidth: 0, lineHeight: 1.3 }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {nom ?? libelleGroupe}
        </span>
        {nom && libelleGroupe && (
          <span className="text-muted-foreground" style={{ display: "block", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {libelleGroupe}
          </span>
        )}
      </span>
    </span>
  )
}

// Cadre du dessin, celui de `Scrutins/[uid]/HemicycleVote.tsx` : le plan normalisé tient
// dans un demi-cercle de rayon `ECHELLE_HEMICYCLE`, avec une marge de 3 %.
const MARGE_HEMI = ECHELLE_HEMICYCLE * 0.03
const VIEWBOX_HEMI = `${-ECHELLE_HEMICYCLE - MARGE_HEMI} ${-ECHELLE_HEMICYCLE - MARGE_HEMI} ${2 * (ECHELLE_HEMICYCLE + MARGE_HEMI)} ${ECHELLE_HEMICYCLE + 2 * MARGE_HEMI}`
const NEUTRE_HEMI = "color-mix(in oklab, var(--muted-foreground) 32%, var(--background))"

/** Teinte d'un siège, celle de la page du vote : pour, contre, abstention, non-votant ;
 *  les autres (absents, institutionnels) en gris neutre. */
function couleurSiege(position: string): string {
  if (position === "pour") return SCRUTIN_COLORS.pour
  if (position === "contre") return SCRUTIN_COLORS.contre
  if (position === "abstentions") return SCRUTIN_COLORS.abstentions
  if (position === "nonVotants") return SCRUTIN_COLORS.nonVotants
  return NEUTRE_HEMI
}

/**
 * L'hémicycle d'un vote, sans interaction : la carte entière est déjà un lien, et le
 * détail (noms au survol, groupes) vit sur la page du vote. Les points sont ceux de
 * `pointsHemicycle`, le même placement que `HemicycleVote` ; un siège que personne
 * n'occupe dans ce vote reste un cercle vide.
 */
function HemicycleCarte({ points, rayon }: { points: PointHemicycle[]; rayon: number }) {
  return (
    <svg aria-hidden viewBox={VIEWBOX_HEMI} style={{ display: "block", width: 132, height: "auto", flex: "none" }}>
      {points.map((p, i) =>
        p.position ? (
          <circle key={i} cx={p.x} cy={p.y} r={rayon} style={{ fill: couleurSiege(p.position) }} />
        ) : (
          <circle key={i} cx={p.x} cy={p.y} r={rayon * 0.8} style={{ fill: "none", stroke: NEUTRE_HEMI, strokeWidth: rayon * 0.35 }} />
        ),
      )}
    </svg>
  )
}

/**
 * Le parcours d'un texte en une ligne de points, du dépôt à la dernière étape prévue : les
 * étapes franchies en couleur, reliées par un trait plein, celles à venir en cercle vide,
 * et la dernière franchie, celle de l'événement de la carte, plus grosse. Sous la ligne,
 * le nom de la première et de la dernière étape : la place manque pour les autres, que
 * la fiche du texte détaille.
 */
function FriseCarte({ etapes, nom }: { etapes: EtapeDuParcours[]; nom: (code: string) => string }) {
  const derniere = etapes.reduce((n, e, i) => (e.done ? i : n), 0)
  return (
    <span aria-hidden style={{ display: "block", width: "100%" }}>
      <span className="flex items-center">
        {etapes.map((e, i) => (
          <span key={`${e.code}-${i}`} className="flex items-center" style={{ flex: i === 0 ? "none" : 1 }}>
            {i > 0 && (
              <span
                style={{
                  flex: 1,
                  height: 2,
                  marginInline: 3,
                  borderRadius: 999,
                  backgroundColor: e.done ? "var(--primary)" : "var(--border)",
                }}
              />
            )}
            <span
              style={{
                width: i === derniere ? 14 : 9,
                height: i === derniere ? 14 : 9,
                flex: "none",
                borderRadius: 999,
                backgroundColor: e.done ? "var(--primary)" : "transparent",
                border: e.done ? "none" : "2px solid var(--border)",
                boxShadow: i === derniere ? "0 0 0 3px color-mix(in srgb, var(--primary) 22%, transparent)" : undefined,
              }}
            />
          </span>
        ))}
      </span>
      <span className="flex justify-between text-muted-foreground" style={{ gap: 12, marginTop: 8, fontSize: 11.5, lineHeight: 1.3 }}>
        <span>{nom(etapes[0].code)}</span>
        {etapes.length > 1 && <span style={{ textAlign: "right" }}>{nom(etapes[etapes.length - 1].code)}</span>}
      </span>
    </span>
  )
}

export async function ActualiteLois({ locale }: { locale: string }) {
  const [t, tDossiers, tSteps, tResume, lois] = await Promise.all([
    getTranslations({ locale, namespace: "landing.actualiteLois" }),
    getTranslations({ locale, namespace: "dossiers" }),
    getTranslations({ locale, namespace: "steps" }),
    getTranslations({ locale, namespace: "resumeIA" }),
    getLoisDansLActualite(),
  ])
  if (lois.length === 0) return null

  // Les votes élu par élu des seuls textes dont la dernière étape est un vote nominatif :
  // dix au plus, lus une fois par nuit avec la page.
  const votes = new Map<string, ScrutinVotesResponse | null>(
    await Promise.all(
      lois
        .filter((l) => l.dernier_vote)
        .map(async (l) => [l.uid, await chargerVotesScrutin(l.dernier_vote!.uid)] as const),
    ),
  )
  // Le parcours des autres textes, celui de la frise d'une page de vote : sans décrets ni
  // application, que `lireParcours` lit sans le baromètre et montrerait « en attente »
  // même pour une loi sans échéancier (`friseDuVote` les retire de la même façon). Trois
  // lectures par texte, dix textes au plus, une fois par nuit.
  const parcours = new Map<string, EtapeDuParcours[]>(
    await Promise.all(
      lois
        .filter((l) => !(l.dernier_vote && votes.get(l.uid)))
        .map(async (l) => [l.uid, (await lireParcours(l.uid)).filter((e) => e.code !== "DECAPP" && e.code !== "AN-APPLI")] as const),
    ),
  )
  // Nom court d'une étape de la frise : « Dépôt », puis les intitulés du parcours de la fiche.
  const nomEtape = (code: string) => (code === "DEPOT" ? tSteps("depot") : tSteps(code))
  const libelleSort = (v: string | null) => (v === "Adopté" ? tResume("adopted") : v === "Rejeté" ? tResume("rejected") : null)

  // La date vient sans fuseau (`timestamp`) : lue en UTC, elle ne recule pas d'un jour
  // selon le fuseau du serveur qui rend la page.
  const formatDate = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" })
  const dateDe = (horodatage: string) => formatDate.format(new Date(`${horodatage.slice(0, 10)}T00:00:00Z`))
  // Un titre traduit par l'IA porte la mention IA ; chaque titre étant un lien, elle se
  // pose une fois, en tête de section (`lib/titre-dossier.ts`).
  const titresTraduits = lois.some((l) => titreTraduit(l, locale))

  return (
    <section
      className="max-w-[90rem] mx-auto px-10 lg:px-20"
      style={{ paddingTop: "clamp(2rem, 4vw, 3rem)", paddingBottom: "clamp(2.5rem, 5vw, 4rem)" }}
    >
      <CarrouselActualite
        precedent={t("precedent")}
        suivant={t("suivant")}
        point={t.raw("point") as string}
        arreter={t("arreter")}
        reprendre={t("reprendre")}
        // Le titre et sa règle sur une seule ligne, à gauche des flèches, plus discrets que
        // les titres des sections numérotées, qu'ils ne doivent pas concurrencer (retours
        // d'Alex du 2026-11-22). La ligne passe à la ligne sur un écran étroit.
        entete={
          <h2 style={{ fontSize: "1rem", lineHeight: 1.5, fontWeight: 400 }}>
            <span style={{ fontWeight: 700, fontSize: "1.0625rem", letterSpacing: "-0.01em" }}>{t("titre")}</span>
            {titresTraduits && (
              <span style={{ display: "inline-block", marginLeft: 8, verticalAlign: "1px" }}>
                <AIBadgeTitre pluriel />
              </span>
            )}
            <span className="text-muted-foreground"> · {t("sousTitre", { jours: JOURS_ACTUALITE })}</span>
          </h2>
        }
      >
        {lois.map((loi) => {
          const evenement = libelleEtape(loi.derniere_etape_code, t, tSteps)
          const vote = loi.dernier_vote
          const votesDuScrutin = votes.get(loi.uid)
          const hemicycle = vote && votesDuScrutin ? pointsHemicycle(votesDuScrutin, vote.uid.startsWith("VTSN") ? "SEN" : "AN") : null
          // Le résultat du vote, la même règle que sa page (`statutDuVote`).
          const statut = vote ? statutDuVote(vote.titre, vote.sort_libelle, null, true) : null
          const sort = libelleSort(statut)
          return (
            <Link
              key={loi.uid}
              href={`/dossiers-legislatifs/${loi.uid}/resume-ia`}
              className="border bg-card transition-colors hover:border-primary"
              style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%", padding: 18, borderRadius: 14 }}
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
              <Auteur loi={loi} gouvernement={tResume("auteurGouvernement")} />
              {evenement && (
                <span style={{ display: "block", marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border)", fontSize: 13, lineHeight: 1.45 }}>
                  <span className="text-muted-foreground" style={{ display: "block", fontSize: 12, fontWeight: 600 }}>
                    {t("dernierEvenement")}
                  </span>
                  <span style={{ display: "block", marginTop: 2 }}>
                    {evenement}
                    <span className="text-muted-foreground"> · {dateDe(loi.derniere_etape)}</span>
                  </span>
                  {!hemicycle && (parcours.get(loi.uid)?.length ?? 0) > 1 && (
                    <span style={{ display: "block", marginTop: 14 }}>
                      <FriseCarte etapes={parcours.get(loi.uid)!} nom={nomEtape} />
                    </span>
                  )}
                  {vote && hemicycle && (
                    <span className="flex items-center" style={{ gap: 12, marginTop: 10 }}>
                      <HemicycleCarte points={hemicycle.points} rayon={hemicycle.rayon} />
                      <span style={{ display: "grid", gap: 4, minWidth: 0, fontSize: 12.5, lineHeight: 1.35 }}>
                        {sort && (
                          <span
                            className={`self-start border ${getStatusBadgeClass(statut)}`}
                            style={{ justifySelf: "start", fontSize: 11, fontWeight: 600, padding: "1px 8px", borderRadius: 999 }}
                          >
                            {sort}
                          </span>
                        )}
                        <span style={{ color: SCRUTIN_COLORS.pour, fontWeight: 600 }}>{tResume("voteFor", { count: vote.pour ?? 0 })}</span>
                        <span style={{ color: SCRUTIN_COLORS.contre, fontWeight: 600 }}>{tResume("voteAgainst", { count: vote.contre ?? 0 })}</span>
                        <span className="text-muted-foreground">{tResume("voteAbstentions", { count: vote.abstentions ?? 0 })}</span>
                      </span>
                    </span>
                  )}
                </span>
              )}
            </Link>
          )
        })}
      </CarrouselActualite>
    </section>
  )
}
