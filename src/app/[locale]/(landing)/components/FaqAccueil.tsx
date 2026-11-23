import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"
import { ArrowRight } from "lucide-react"

import { Link } from "@/i18n/navigation"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { MARGE_SECTION, STYLE_TITRE_SECTION, SurTitre } from "./Maquettes"

/**
 * Section 08 de la landing, la FAQ, seule FAQ du site : le titre, l'adresse de contact et
 * le lien vers la méthode à gauche (collés en haut de l'écran à partir de `md`), les
 * questions en quatre catégories à droite. Rendue par `(landing)/page.tsx`, après « La
 * lettre du lundi ».
 *
 * Elle a repris la FAQ de `/about`, retirée de cette page (retour d'Alex du 2026-11-22) :
 * ses questions (`landing.faq.fonctionnement`, `equipe`, `campPolitique`, `gratuite`,
 * `publicite`, `newsletter`, `cookies`, `modelesIa`, `appareil`) remplacent leurs
 * doublons de l'accueil, avec leurs compléments (les sept étapes, les briques techniques,
 * ce qui reste sur l'appareil et ce qui le quitte). Elle porte aussi ce que disait la
 * section « Pourquoi nous faire confiance » : les textes de l'ancienne section méthode
 * (`landing.methode.*`), deux des règles (`landing.regles.ia*`, `landing.regles.calcul*`),
 * et « Ce que LoiClair n'est pas » (`landing.nEstPas.*Texte`). « Sans éditorialiser » vit
 * dans la réponse sur le camp politique (D-184).
 *
 * Questions repliées par défaut, sauf la première. Sans `forceMount`, Radix ne monte pas
 * le contenu d'une question fermée, et les réponses manqueraient au HTML que lisent les
 * moteurs de recherche ; montées de force, la classe `[[data-state=closed]>&]:hidden`
 * les cache tant que leur `AccordionContent` est fermé.
 */

/** Une question : sa clé, son intitulé, sa réponse, et un complément éventuel sous elle. */
type Question = { cle: string; question: string; reponse: ReactNode; complement?: ReactNode }

/** Les briques techniques citées par la réponse sur l'équipe, des noms propres. */
const BRIQUES = ["Next.js", "PostgreSQL", "Coolify", "Python", "GitHub Actions", "GPT-6 Luna (OpenAI, via Mammouth)", "Claude Haiku 5.5 (Anthropic)", "Claude Code"]

const STYLE_REPONSE = { fontSize: "0.9375rem", lineHeight: 1.6 } as const

export async function FaqAccueil({ locale }: { locale: string }) {
  const [t, tLanding] = await Promise.all([
    getTranslations({ locale, namespace: "landing.faq" }),
    getTranslations({ locale, namespace: "landing" }),
  ])
  // Balise d'une réponse qui devient un lien souligné vers `href`.
  const lien = (href: string) =>
    function LienReponse(chunks: ReactNode) {
      return (
        <Link href={href} className="underline hover:text-foreground">
          {chunks}
        </Link>
      )
    }
  const non = (texte: string) => `${t("non")} ${texte}`
  const oui = (texte: string) => `${t("oui")} ${texte}`
  // Une règle, son titre puis sa phrase d'appui (« Aucun chiffre n'est généré par une
  // IA. Une formule publiée… »).
  const regle = (cle: "ia" | "calcul") => `${tLanding(`regles.${cle}Titre`)} ${tLanding(`regles.${cle}Texte`)}`
  // Les questions venues de /about, un objet `{ q, a }` chacune.
  const venue = (cle: string, reponse?: ReactNode): Pick<Question, "cle" | "question" | "reponse"> => ({
    cle,
    question: t(`${cle}.q`),
    reponse: reponse ?? t(`${cle}.a`),
  })

  const etapes = t.raw("fonctionnement.steps") as { title: string; desc: string }[]
  const categories: { titre: string; questions: Question[] }[] = [
    {
      titre: t("catLoiclair"),
      questions: [
        venue("gratuite"),
        {
          ...venue("equipe"),
          complement: (
            <div className="flex flex-wrap" style={{ gap: 8, marginTop: 12 }}>
              {BRIQUES.map((brique) => (
                <span key={brique} className="border text-muted-foreground" style={{ fontSize: 12, padding: "3px 10px", borderRadius: 999 }}>
                  {brique}
                </span>
              ))}
            </div>
          ),
        },
        venue("publicite"),
        { cle: "soutenir", question: t("soutenirQ"), reponse: t.rich("soutenirA", { lien: lien("/nous-aider") }) },
      ],
    },
    {
      titre: t("catMethode"),
      questions: [
        {
          ...venue("fonctionnement"),
          // Les sept étapes, numérotées, de la donnée brute à l'information publiée.
          complement: (
            <ol style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {etapes.map((etape, i) => (
                <li key={i} className="flex" style={{ gap: 12 }}>
                  <span
                    className="flex items-center justify-center bg-primary text-primary-foreground"
                    style={{ width: 24, height: 24, flex: "none", marginTop: 1, borderRadius: 999, fontSize: 13, fontWeight: 700 }}
                  >
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground" style={STYLE_REPONSE}>
                    <span className="text-foreground" style={{ fontWeight: 600 }}>{etape.title}</span> — {etape.desc}
                  </span>
                </li>
              ))}
            </ol>
          ),
        },
        { cle: "sources", question: t("sourcesQ"), reponse: t("sourcesA") },
        { cle: "resume", question: t("resumeQ"), reponse: tLanding("methode.loisTexte") },
        { cle: "iaSignalee", question: t("iaSignaleeQ"), reponse: oui(regle("ia")) },
        { cle: "iaErreur", question: t("iaErreurQ"), reponse: t("iaErreurA") },
        { cle: "chiffres", question: t("chiffresQ"), reponse: tLanding("methode.chiffresTexte") },
        { cle: "calcul", question: t("calculQ"), reponse: non(regle("calcul")) },
        venue("modelesIa", t.rich("modelesIa.a", { prompts: lien("/documentation/choix-modele-ia") })),
      ],
    },
    {
      titre: t("catNeutralite"),
      questions: [
        venue("campPolitique", `${t("campPolitique.a")} ${tLanding("nEstPas.opinionTexte")}`),
        { cle: "officiel", question: t("officielQ"), reponse: non(tLanding("nEstPas.officielTexte")) },
        { cle: "jugement", question: t("jugementQ"), reponse: non(tLanding("nEstPas.jugementTexte")) },
        { cle: "erreur", question: t("erreurQ"), reponse: t.rich("erreurA", { lien: lien("/documentation/corrections") }) },
      ],
    },
    {
      titre: t("catDonnees"),
      questions: [
        {
          ...venue("appareil"),
          // Deux listes plutôt qu'un paragraphe : le lecteur cherche d'un coup d'œil si une
          // donnée précise part ou reste. Chaque ligne décrit le code tel qu'il est ; un
          // envoi ajouté au site doit s'y ajouter.
          complement: (
            <div className="text-muted-foreground" style={{ ...STYLE_REPONSE, display: "grid", gap: 14, marginTop: 12 }}>
              {(["reste", "part"] as const).map((liste) => (
                <div key={liste}>
                  <p className="text-foreground" style={{ fontWeight: 600 }}>{t(`appareil.${liste}Titre`)}</p>
                  <ul style={{ display: "grid", gap: 6, marginTop: 6, paddingLeft: 20, listStyle: "disc" }}>
                    {(t.raw(`appareil.${liste}`) as string[]).map((ligne) => (
                      <li key={ligne}>{ligne}</li>
                    ))}
                  </ul>
                </div>
              ))}
              <p>{t.rich("appareil.fin", { confidentialite: lien("/confidentialite") })}</p>
            </div>
          ),
        },
        { cle: "ecrire", question: t("ecrireQ"), reponse: t("ecrireA") },
        venue("cookies"),
        venue("newsletter"),
      ],
    },
  ]

  return (
    <section className="max-w-[90rem] mx-auto px-10 lg:px-20" style={{ paddingBlock: MARGE_SECTION }}>
      <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: "2rem clamp(2rem, 5vw, 5rem)" }}>
        {/* Collé sous le menu pendant qu'on lit les réponses, à partir de `md` seulement :
          en une colonne, le titre défile avec le reste. `top` fixe : Safari ne recalcule
          pas la contrainte d'un `sticky` dont le `top` change (ARCHITECTURE.md §Pièges). */}
        <div className="md:sticky" style={{ top: "5.5rem", alignSelf: "start", minWidth: 0 }}>
          {/* Section numérotée comme les autres (retour d'Alex du 2026-11-22). */}
          <SurTitre numero={8} libelle={t("surTitre")} />
          <h2 className="text-balance" style={{ ...STYLE_TITRE_SECTION, marginTop: "0.75rem" }}>
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
          {/* Le lien de l'ancienne section « Pourquoi nous faire confiance ». */}
          <Link
            href="/about"
            className="inline-flex items-center hover:underline"
            style={{ marginTop: "1rem", gap: 6, fontSize: "0.9375rem", fontWeight: 600, color: "var(--primary)" }}
          >
            {t("methodeLien")}
            <ArrowRight aria-hidden style={{ width: 16, height: 16 }} />
          </Link>
        </div>
        <div className="md:col-span-2" style={{ display: "flex", flexDirection: "column", gap: "2.25rem", minWidth: 0 }}>
          {categories.map(({ titre, questions }, ci) => (
            <div key={titre}>
              <h3 style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--primary)" }}>{titre}</h3>
              <Accordion type="multiple" defaultValue={ci === 0 ? [questions[0].cle] : undefined} style={{ marginTop: "0.6rem" }}>
                {questions.map(({ cle, question, reponse, complement }) => (
                  <AccordionItem key={cle} value={cle} className="border-t border-b-0 last:border-b border-foreground/15">
                    <AccordionTrigger className="font-semibold hover:no-underline" style={{ paddingBlock: "1.05rem", fontSize: "1.0625rem", lineHeight: 1.4 }}>
                      {question}
                    </AccordionTrigger>
                    <AccordionContent forceMount className="[[data-state=closed]>&]:hidden">
                      <div style={{ maxWidth: "44rem", paddingBottom: "0.6rem" }}>
                        <p className="text-muted-foreground" style={STYLE_REPONSE}>
                          {reponse}
                        </p>
                        {complement}
                      </div>
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
