import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"

import { Link } from "@/i18n/navigation"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { STYLE_TITRE_SECTION } from "./Maquettes"

/**
 * FAQ de la landing : le titre et l'adresse de contact à gauche (collés en haut de
 * l'écran à partir de `md`), dix-sept questions en quatre catégories à droite.
 * Rendue par `(landing)/page.tsx`, après « Aussi sur LoiClair ».
 *
 * Les questions de méthode reprennent mot pour mot les textes de l'ancienne section
 * méthode (`landing.methode.loisTexte`, `landing.methode.chiffresTexte`), et deux
 * questions de neutralité ceux de « Ce que LoiClair n'est pas »
 * (`landing.nEstPas.officielTexte`, `landing.nEstPas.jugementTexte`), précédés d'un
 * « Non. » : une seule source pour un même engagement.
 *
 * Questions repliées par défaut, sauf la première. Sans `forceMount`, Radix ne monte pas
 * le contenu d'une question fermée, et les réponses manqueraient au HTML que lisent les
 * moteurs de recherche ; montées de force, la classe `[[data-state=closed]>&]:hidden`
 * les cache tant que leur `AccordionContent` est fermé (comme sur `/about`).
 */

type Question = { cle: string; reponse: ReactNode }

export async function FaqAccueil({ locale }: { locale: string }) {
  const [t, tLanding] = await Promise.all([
    getTranslations({ locale, namespace: "landing.faq" }),
    getTranslations({ locale, namespace: "landing" }),
  ])
  // Balise `lien` d'une réponse : un lien souligné vers `href`.
  const lien = (href: string) =>
    function LienReponse(chunks: ReactNode) {
      return (
        <Link href={href} className="underline hover:text-foreground">
          {chunks}
        </Link>
      )
    }
  const non = (texte: string) => `${t("non")} ${texte}`

  const categories: { titre: string; questions: Question[] }[] = [
    {
      titre: t("catLoiclair"),
      questions: [
        { cle: "gratuit", reponse: t("gratuitA") },
        { cle: "qui", reponse: t("quiA") },
        { cle: "pub", reponse: t("pubA") },
        { cle: "soutenir", reponse: t.rich("soutenirA", { lien: lien("/nous-aider") }) },
      ],
    },
    {
      titre: t("catMethode"),
      questions: [
        { cle: "sources", reponse: t("sourcesA") },
        { cle: "resume", reponse: tLanding("methode.loisTexte") },
        { cle: "iaErreur", reponse: t("iaErreurA") },
        { cle: "chiffres", reponse: tLanding("methode.chiffresTexte") },
        { cle: "modeles", reponse: t.rich("modelesA", { lien: lien("/documentation/choix-modele-ia") }) },
      ],
    },
    {
      titre: t("catNeutralite"),
      questions: [
        { cle: "camp", reponse: t("campA") },
        { cle: "officiel", reponse: non(tLanding("nEstPas.officielTexte")) },
        { cle: "jugement", reponse: non(tLanding("nEstPas.jugementTexte")) },
        { cle: "erreur", reponse: t.rich("erreurA", { lien: lien("/documentation/corrections") }) },
      ],
    },
    {
      titre: t("catDonnees"),
      questions: [
        { cle: "situation", reponse: t("situationA") },
        { cle: "ecrire", reponse: t("ecrireA") },
        { cle: "cookies", reponse: t("cookiesA") },
        { cle: "email", reponse: t("emailA") },
      ],
    },
  ]

  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: "clamp(3rem, 6vw, 5rem)" }}>
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: "2rem clamp(2rem, 5vw, 5rem)" }}>
        {/* Collé sous le menu pendant qu'on lit les réponses, à partir de `md` seulement :
          en une colonne, le titre défile avec le reste. `top` fixe : Safari ne recalcule
          pas la contrainte d'un `sticky` dont le `top` change (ARCHITECTURE.md §Pièges). */}
        <div className="md:sticky" style={{ top: "5.5rem", alignSelf: "start", minWidth: 0 }}>
          <h2 className="text-balance" style={STYLE_TITRE_SECTION}>
            {t("titre")}
          </h2>
          <p className="text-muted-foreground" style={{ marginTop: "0.9rem", fontSize: "1.0625rem", lineHeight: 1.6 }}>
            {t.rich("sousTitre", {
              mail: (chunks) => (
                <a href="mailto:contact@loiclair.fr" className="underline hover:text-foreground">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
        <div className="md:col-span-2" style={{ display: "flex", flexDirection: "column", gap: "2.25rem", minWidth: 0 }}>
          {categories.map(({ titre, questions }, ci) => (
            <div key={titre}>
              <h3 style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--primary)" }}>{titre}</h3>
              <Accordion type="multiple" defaultValue={ci === 0 ? [questions[0].cle] : undefined} style={{ marginTop: "0.6rem" }}>
                {questions.map(({ cle, reponse }) => (
                  <AccordionItem key={cle} value={cle} className="border-t border-b-0 last:border-b border-foreground/15">
                    <AccordionTrigger className="font-semibold hover:no-underline" style={{ paddingBlock: "1.05rem", fontSize: "1.0625rem", lineHeight: 1.4 }}>
                      {t(`${cle}Q`)}
                    </AccordionTrigger>
                    <AccordionContent forceMount className="[[data-state=closed]>&]:hidden">
                      <p className="text-muted-foreground" style={{ maxWidth: "44rem", paddingBottom: "0.6rem", fontSize: "0.9375rem", lineHeight: 1.6 }}>
                        {reponse}
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
