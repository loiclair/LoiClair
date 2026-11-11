import type { CSSProperties } from "react"
import { getTranslations } from "next-intl/server"
import { LockKeyhole } from "lucide-react"

import { ACTIVE_BASE, BASE_PILL_STYLE } from "@/lib/pastille-or"
import { BadgeIA, Carte, Ligne, SectionIllustree, Surface } from "./Maquettes"
import { TexteMethode } from "./MethodeCard"

/**
 * Section « Ce que les lois changent pour vous, selon votre situation » de la landing :
 * le titre dit le croisement des textes avec la situation du lecteur, pas seulement
 * leur résumé. Placée entre les deux sections méthode (`MethodeResumes`,
 * `MethodeChiffres`), elle présente la page « Ce qui me concerne » et la section « Ce
 * qui change pour vous » de chaque fiche de texte. Rendue par `(landing)/page.tsx`,
 * maquette à gauche quand ses deux voisines ont la leur à droite.
 *
 * Le texte porte la promesse de confidentialité (D-243) : les profils restent dans le
 * navigateur, le site ne les reçoit jamais. Il ne dit pas « chaque loi » : seuls les
 * textes en cours et les lois récentes sont classés (D-184).
 *
 * La maquette montre des pastilles de profils sous leurs vrais libellés (ce sont des
 * intitulés du site, pas des faits), deux choisies, puis la synthèse de l'IA pour ces
 * deux profils, en lignes grises : aucun titre de texte, aucun chiffre (D-207). Les
 * blocs entrent l'un après l'autre par `.landing-mini-entree` (globals.css), que
 * prefers-reduced-motion coupe pour montrer l'état final.
 */

/** Profils figurés dans la rangée de pastilles, et lesquels sont choisis. */
const PROFILS_FIGURES = ["locataire", "parent", "retraite", "etudiant", "salarie_prive"] as const
const PROFILS_CHOISIS = [
  { profil: "locataire", lignes: [92, 70] },
  { profil: "parent", lignes: [86, 94, 58] },
] as const

const PASTILLE_NEUTRE: CSSProperties = { border: "1px solid var(--border)", color: "var(--muted-foreground)" }

export async function PourVousSection({ locale }: { locale: string }) {
  const [t, tResume, tProfils] = await Promise.all([
    getTranslations({ locale, namespace: "landing.pourVous" }),
    getTranslations({ locale, namespace: "resumeIA" }),
    getTranslations({ locale, namespace: "ceQuiMeConcerne.profils" }),
  ])
  const choisis = new Set<string>(PROFILS_CHOISIS.map((p) => p.profil))

  return (
    <SectionIllustree
      inverse
      texte={<TexteMethode titre={t("titre")} texte={t("texte")} lien={t("lien")} href="/ce-qui-me-concerne" />}
      visuel={
        <Surface>
          <div aria-hidden style={{ display: "grid", gap: 8 }}>
            <Carte>
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {PROFILS_FIGURES.map((p) => (
                  <span key={p} style={{ ...BASE_PILL_STYLE, ...(choisis.has(p) ? ACTIVE_BASE : PASTILLE_NEUTRE) }}>
                    {tProfils(p)}
                  </span>
                ))}
              </div>
            </Carte>
            <Carte bordure="rgba(212, 165, 74, 0.45)">
              <BadgeIA libelle={tResume("aiBadge")} />
              <div style={{ display: "grid", gap: 16, marginTop: 14 }}>
                {PROFILS_CHOISIS.map(({ profil, lignes }, i) => (
                  <span key={profil} className="landing-mini-entree" style={{ display: "block", "--ordre": 2 + i * 4 } as CSSProperties}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{tProfils(profil)}</span>
                    <span style={{ display: "grid", gap: 6, marginTop: 8 }}>
                      {lignes.map((l, j) => (
                        <Ligne key={j} largeur={l} hauteur={6} />
                      ))}
                    </span>
                  </span>
                ))}
              </div>
            </Carte>
          </div>
          <p className="flex items-center text-muted-foreground" style={{ gap: 6, marginTop: 14, fontSize: 13, fontWeight: 500 }}>
            <LockKeyhole aria-hidden style={{ width: 14, height: 14, flex: "none" }} />
            {t("appareil")}
          </p>
        </Surface>
      }
    />
  )
}
