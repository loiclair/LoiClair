import { getTranslations } from "next-intl/server"
import { Calculator, Check, ExternalLink, History, Link2, Tag, type LucideIcon } from "lucide-react"
import { BadgeIA, Carte, Ligne, SectionIllustree, STYLE_TITRE_SECTION, Surface } from "./Maquettes"

/**
 * Section des règles de la landing, illustrée : le titre et les quatre règles que
 * LoiClair s'impose d'un côté, de l'autre une maquette qui en montre trois sur le site
 * (une ligne du journal des corrections, la source sous un chiffre, un résumé signalé
 * comme écrit par une IA avec son texte officiel). Appelé par `(landing)/page.tsx`.
 * Maquette à gauche (`inverse`) : celle de `MethodeChiffres`, juste avant, est à droite.
 *
 * Sans fond propre, sur le crème de la page comme les autres sections : Alex a
 * retiré l'ancien dégradé teal pour que toute la page ait une seule couleur.
 *
 * Chaque règle doit rester vérifiable sur le site (D-184) : une formule qu'un
 * lecteur pourrait démentir en une capture décrédibilise toute la section.
 */

const REGLES: Array<{ key: "calcul" | "source" | "corrections" | "ia"; icon: LucideIcon }> = [
  { key: "calcul", icon: Calculator },
  { key: "source", icon: Link2 },
  { key: "corrections", icon: History },
  { key: "ia", icon: Tag },
]

export async function ReglesBand({ locale }: { locale: string }) {
  const [t, tMaquettes, tResume] = await Promise.all([
    getTranslations({ locale, namespace: "landing" }),
    getTranslations({ locale, namespace: "landing.maquettes" }),
    getTranslations({ locale, namespace: "resumeIA" }),
  ])

  return (
    <SectionIllustree
      inverse
      texte={
        <>
          <h2 className="text-balance" style={STYLE_TITRE_SECTION}>
            {t("regles.titre")}
          </h2>
          <p className="text-muted-foreground" style={{ marginTop: "1rem", maxWidth: "34rem", fontSize: "1.0625rem", lineHeight: 1.6 }}>
            {t("regles.description")}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "1.5rem 0 0", maxWidth: "34rem" }}>
            {REGLES.map(({ key, icon: Icon }) => (
              <li
                key={key}
                style={{ display: "grid", gridTemplateColumns: "2.25rem minmax(0, 1fr)", gap: "0.2rem", padding: "0.6rem 0" }}
              >
                <Icon aria-hidden strokeWidth={1.5} style={{ width: 20, height: 20, marginTop: 1, color: "var(--primary)" }} />
                <div>
                  <strong style={{ display: "block", fontSize: "0.9375rem", fontWeight: 600, lineHeight: 1.4 }}>
                    {t(`regles.${key}Titre`)}
                  </strong>
                  <span className="text-muted-foreground" style={{ display: "block", marginTop: "0.15rem", fontSize: "0.875rem", lineHeight: 1.5 }}>
                    {t(`regles.${key}Texte`)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      }
      visuel={
        <Surface>
          {/* Trois preuves que le lecteur retrouve sur le site. Le domaine affiché est
            celui de l'open data de l'Assemblée, première source du site. */}
          <div aria-hidden style={{ display: "grid", gap: 14 }}>
            {/* Tout texte rédigé par une IA est signalé, et accompagné de son texte
              officiel : le badge doré et le lien du texte, mis en avant. */}
            <Carte bordure="rgba(212, 165, 74, 0.45)">
              <BadgeIA libelle={tResume("aiBadge")} />
              <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
                <Ligne largeur={94} />
                <Ligne largeur={68} />
              </div>
              <span
                className="flex items-center"
                style={{ gap: 6, marginTop: 12, fontSize: 12, fontWeight: 600, color: "var(--primary)" }}
              >
                {tMaquettes("texteOfficiel")}
                <ExternalLink style={{ width: 12, height: 12 }} />
              </span>
            </Carte>
            <Carte>
              <span className="flex items-center" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
                <History style={{ width: 15, height: 15, color: "var(--muted-foreground)" }} />
                {tMaquettes("journal")}
              </span>
              <div style={{ display: "grid", gridTemplateColumns: "3.5rem minmax(0, 1fr) auto", gap: 12, alignItems: "start", marginTop: 12 }}>
                <Ligne largeur={100} style={{ marginTop: 4 }} />
                <div style={{ display: "grid", gap: 6 }}>
                  <Ligne largeur={88} />
                  <Ligne largeur={60} />
                </div>
                <span
                  className="inline-flex items-center"
                  style={{ gap: 4, fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 999, color: "#27AE60", backgroundColor: "rgba(39, 174, 96, 0.12)" }}
                >
                  <Check style={{ width: 11, height: 11 }} strokeWidth={3} />
                  {tMaquettes("corrige")}
                </span>
              </div>
            </Carte>
            <Carte>
              <div style={{ display: "grid", gap: 6 }}>
                <Ligne largeur={92} />
                <Ligne largeur={70} />
              </div>
              <span
                className="flex flex-wrap items-center"
                style={{ gap: "4px 8px", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 12 }}
              >
                <Link2 style={{ width: 14, height: 14, color: "var(--primary)" }} />
                <span style={{ fontWeight: 600 }}>{tMaquettes("source")}</span>
                <span style={{ color: "var(--primary)" }}>data.assemblee-nationale.fr</span>
              </span>
            </Carte>
          </div>
        </Surface>
      }
    />
  )
}
