// Page `/about` : présentation du projet, de ses fondateurs et de ses sources, avec
// l'inscription à la newsletter.
// Aucune donnée ici, mais le badge du pied de page date le dernier run de nuit : sans
// minuterie, il garderait la date du déploiement.
export const revalidate = 86400

import { getTranslations, setRequestLocale } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import Image from "next/image"
import NewsletterForm from "@/components/NewsletterForm"
import { ShareIconLinkedIn } from "@/components/ShareIcons"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import type { Metadata } from "next"
import { buildAlternates, buildOpenGraph } from "@/lib/og-metadata"
import { FONDATEURS } from "@/lib/association"
import AdhesionBouton from "@/components/AdhesionBouton"
import { SOURCES_OFFICIELLES, SOURCES_TIERCES, type LogoSource, type Source } from "@/lib/sources"

/**
 * Où vérifier les deux chiffres du constat. Liés parce qu'un site qui vend la
 * vérification ne peut pas ouvrir sur un chiffre qu'on ne retrouve pas : la page
 * a affiché 54 % d'abstention aux législatives, quand le second tour de 2024 en
 * compte 33,37 %.
 */
const STATS_SOURCES = {
  a: "https://www.opinion-way.com/wp-content/uploads/2025/02/OpinionWay-pour-le-CEVIPOF-Barometre-de-la-confiance-en-politique-Vague-16-Fevrier-2025-1.pdf",
  b: "https://www.interieur.gouv.fr/second-tour-l%C3%A9gislatives-2024",
} as const

/**
 * Logo affiché devant chaque source. C'est celui de qui diffuse la donnée, pas
 * toujours celui de la source nommée (D-164) : Légifrance n'a pour marque que le
 * bloc-marque « République Française », réservé aux administrations, et prend donc le
 * logo de PISTE, le portail d'API par lequel l'import la lit (un PNG découpé de
 * `piste.gouv.fr/images/logo-Piste-large.png`, qui n'existe qu'accolé au bloc-marque).
 * Le Baromètre prend celui de l'Assemblée, qui publie ses CSV ; le RNE et l'API Géo
 * celui de data.gouv.fr. Wikipédia est servie par son wordmark : le globe est une
 * mosaïque de 165 Ko, illisible à cette taille. Wikidata et Google Actualités n'en
 * ont pas : leur ligne garde la place du logo vide, pour rester alignée. La liste des
 * sources elle-même vit dans `lib/sources.ts`.
 *
 * `invertOnDark` repasse en blanc les logos noirs ou bleu nuit, qui disparaissent sur
 * le fond sombre. `cropped` recadre le SVG du Sénat, qui porte des marges internes.
 */
type Logo = { src: string; width: number; height: number; cropped?: boolean; invertOnDark?: boolean }

const LOGOS = {
  an: { src: "/images/institutions/assemblee-nationale-logo.svg", width: 838, height: 741 },
  senat: { src: "/images/institutions/senat-logo.svg", width: 1, height: 1, cropped: true },
  cc: { src: "/images/institutions/conseil-constitutionnel-logo.svg", width: 1056, height: 604 },
  insee: { src: "/images/institutions/insee-logo.svg", width: 253, height: 85, invertOnDark: true },
  hatvp: { src: "/images/institutions/hatvp-logo.svg", width: 214, height: 50 },
  datagouv: { src: "/images/institutions/datagouv-logo.svg", width: 186, height: 59, invertOnDark: true },
  piste: { src: "/images/institutions/piste-logo.png", width: 409, height: 129, invertOnDark: true },
  wikipedia: { src: "/images/institutions/wikipedia-logo.svg", width: 500, height: 85, invertOnDark: true },
} satisfies Record<LogoSource, Logo>

/**
 * Boîte commune à tous les logos : chacun s'y inscrit au mieux, un logo carré
 * remplit la hauteur, un bandeau bute d'abord sur la largeur. Sa taille fixe aligne
 * les noms des sources d'une ligne à l'autre. En style inline : les tailles
 * numériques de Tailwind v4 sortent en `calc(var(--spacing) * N)`, que Safari ne
 * résout pas.
 */
const LOGO_BOX = { width: 64, height: 36, flexShrink: 0 } as const

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: "about" })
  const title = `${t('pageTitle')} — LoiClair`
  const description = t('pageDesc')
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/about'),
    openGraph: buildOpenGraph(locale, '/about', title, description),
  }
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "about" })

  // Une ligne de la grille des sources : logo, nom lié, description. Les deux grilles
  // (officielles, tierces) la partagent pour rester alignées.
  const ligneSource = ({ href, key, logo: logoId }: Source) => {
    const logo: Logo | null = logoId ? LOGOS[logoId] : null
    return (
      <div key={key} className="flex items-start border-t border-border" style={{ gap: 20, paddingBlock: 20 }}>
        <div className="flex items-center justify-center" style={LOGO_BOX}>
          {logo?.cropped ? (
            <div className="relative overflow-hidden" style={{ height: "100%", aspectRatio: "1" }}>
              <Image src={logo.src} alt="" fill className="object-contain scale-110" />
            </div>
          ) : logo ? (
            <Image
              src={logo.src}
              alt=""
              width={logo.width}
              height={logo.height}
              className={`object-contain${logo.invertOnDark ? " dark:brightness-0 dark:invert" : ""}`}
              style={{ maxWidth: "100%", maxHeight: "100%", width: "auto", height: "auto" }}
            />
          ) : null}
        </div>
        <div style={{ minWidth: 0 }}>
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-foreground text-base hover:text-primary"
          >
            {t(`sources.${key}Label`)}
          </Link>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(`sources.${key}Desc`)}
          </p>
        </div>
      </div>
    )
  }

  const stack = ["Next.js", "PostgreSQL", "Coolify", "Python", "GitHub Actions", "GPT-6 Luna (OpenAI, via Mammouth)", "Claude Haiku 5.5 (Anthropic)", "Claude Code"]

  // `q8` (ce qui quitte l'appareil) suit `q6` (les cookies) : les questions sur les
  // données du lecteur se lisent d'affilée.
  const faqKeys = ["how", "built", "q2", "q3", "q4", "q5", "q6", "q8", "q7"] as const

  return (
    <div style={{ width: "100vw", marginLeft: "calc(50% - 50vw)", marginBottom: "-8rem" }}>
      {/* 1. HERO */}
      <section className="bg-cream py-20 md:py-24">
        <div className="container mx-auto max-w-[1120px] px-6">
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] max-w-[18ch] mb-6">
            {t("hero.title")}
          </h1>
          <p className="text-lg md:text-xl lg:text-[23px] leading-[1.5] text-muted-foreground max-w-[60ch]">
            {t("hero.lede")}
          </p>
        </div>
      </section>

      {/* 2. LE CONSTAT — fond sombre */}
      <section className="bg-foreground text-background py-20 md:py-24">
        <div className="container mx-auto max-w-[1120px] px-6">
          <h2 className="text-[28px] md:text-4xl font-bold tracking-tight leading-[1.15] mb-4 max-w-[20ch] text-background">
            {t("stats.heading")}
          </h2>
          <p className="text-lg max-w-[60ch] mb-14 text-background/75">
            {t("stats.sub")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10">
            {(["a", "b"] as const).map((k) => (
              <div key={k} className="pt-7 border-t-[3px] border-background">
                <div className="text-[52px] md:text-[64px] font-bold leading-none tracking-[-0.03em]">
                  {t(`stats.${k}.value`)}
                </div>
                <div className="mt-3 text-[15px] max-w-[40ch] text-background/75">
                  {t(`stats.${k}.label`)}
                </div>
                <a
                  href={STATS_SOURCES[k]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-block text-xs uppercase tracking-[0.06em] text-background/50 underline underline-offset-2 hover:text-background"
                >
                  {t(`stats.${k}.source`)}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 3. ORIGINE — split image / texte */}
      <section className="bg-cream">
        <div className="grid md:grid-cols-2 items-stretch">
          <div className="relative h-[260px] md:h-auto md:min-h-[520px]">
            <Image
              src="https://images.unsplash.com/photo-1672673011039-3b2007c28852?w=1400&q=80"
              alt={t("imageFacadeAlt")}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
          <div className="flex items-center px-6 py-16 md:px-12 lg:px-16 md:py-24">
            <div className="max-w-[560px]">
              <h2 className="text-[28px] md:text-4xl font-bold tracking-tight leading-[1.15] mb-3">
                {t("origin.title")}
              </h2>
              <p className="text-muted-foreground text-lg mb-8">
                {t("origin.sub")}
              </p>
              <p className="text-base text-muted-foreground leading-[1.75] mb-7">
                {t("origin.p1")}
              </p>
              <blockquote className="my-8 text-lg md:text-xl leading-snug italic font-medium text-foreground">
                {t("origin.quote")}
              </blockquote>
              <p className="text-base text-muted-foreground leading-[1.75] mb-8">
                {t("origin.p2")}
              </p>
              <p className="text-base font-semibold text-foreground">
                {t("origin.finalLine")}
              </p>
              {/* Juste après le récit, écrit à la première personne : le président,
                  nommé en premier, est ce « je ». Une ligne par fondateur, sans
                  photo ni carte : nom, rôle, lien LinkedIn. */}
              <div className="mt-10 pt-6 border-t">
                <p className="text-xs uppercase tracking-[0.06em] text-muted-foreground mb-3">
                  {t("founders.title")}
                </p>
                <ul className="space-y-2">
                  {FONDATEURS.map((f) => (
                    <li key={f.linkedin} className="flex items-baseline justify-between gap-4 text-base">
                      <a
                        href={f.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={t("founders.linkedin", { nom: f.nom })}
                        className="inline-flex items-center gap-2 font-semibold text-foreground hover:opacity-80"
                      >
                        {f.nom}
                        <span className="text-muted-foreground" aria-hidden="true">
                          <ShareIconLinkedIn size={14} />
                        </span>
                      </a>
                      <span className="text-sm text-muted-foreground">{t(`founders.roles.${f.role}`)}</span>
                    </li>
                  ))}
                </ul>
                <AdhesionBouton className="mt-6 text-sm font-semibold text-primary hover:opacity-80 cursor-pointer">
                  {t("founders.rejoindre")}
                </AdhesionBouton>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. SOURCES : `id` visé par le lien « Le détail de chaque source » de la landing. */}
      <section id="sources" className="bg-background py-20 md:py-24">
        <div className="container mx-auto max-w-[1120px] px-6">
          <h2 className="text-[28px] md:text-4xl font-bold tracking-tight leading-[1.15] mb-4">
            {t("sources.heading")}
          </h2>
          <p className="text-muted-foreground text-lg max-w-[60ch] mb-4">
            {t("sources.sub")}
          </p>
          <p className="text-sm text-muted-foreground max-w-[60ch] mb-10">
            {t("sources.licenceNotice")}
            <br />
            <Link
              href="https://www.etalab.gouv.fr/wp-content/uploads/2017/04/ETALAB-Licence-Ouverte-v2.0.pdf"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              {t("sources.licenceLinkLabel")} →
            </Link>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
            {SOURCES_OFFICIELLES.map(ligneSource)}
          </div>
          <h3 className="font-bold tracking-tight" style={{ fontSize: "1.25rem", lineHeight: 1.3, marginTop: 48, marginBottom: 8 }}>
            {t("sources.tiercesHeading")}
          </h3>
          {/* Pas de lien vers la licence CC BY-SA de Wikipédia : le site ne fait que
            renvoyer vers les articles, sans en reprendre le contenu (choix d'Alex du
            2026-10-29). */}
          <p className="text-muted-foreground max-w-[60ch]" style={{ marginBottom: 16 }}>
            {t("sources.tiercesSub")}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12">
            {SOURCES_TIERCES.map(ligneSource)}
          </div>
          {/* Les logos identifient la provenance, jamais une caution : la licence des
            données interdit de suggérer un soutien de l'institution, d'où la mention
            sous la grille plutôt que le retrait des logos (D-164). */}
          <p className="border-t border-border text-sm text-muted-foreground" style={{ paddingTop: 20 }}>
            {t("sources.independanceNote")}
          </p>
        </div>
      </section>

      {/* 5. FAQ */}
      <section className="bg-cream py-20 md:py-24">
        <div className="container mx-auto max-w-[1120px] px-6">
          <h2 className="text-[28px] md:text-4xl font-bold tracking-tight leading-[1.15] mb-4">
            {t("faq.heading")}
          </h2>
          <p className="text-muted-foreground text-lg max-w-[60ch] mb-10">
            {t("faq.sub")}
          </p>
          {/* Questions repliées par défaut. Sans `forceMount`, Radix ne monte pas
              le contenu d'une question fermée, et les réponses manquaient au HTML
              que lisent les moteurs de recherche (constaté au `curl`). Montées de
              force, Radix ne les masque pas : la classe `[[data-state=closed]>&]:hidden`
              cache le contenu tant que son parent `AccordionContent` est fermé. */}
          <Accordion type="multiple" className="max-w-[780px]">
            {faqKeys.map((k) => (
              <AccordionItem key={k} value={k} className="border-t border-b-0 last:border-b border-foreground/15">
                <AccordionTrigger className="py-6 text-[19px] font-bold hover:no-underline">
                  {t(`faq.${k}.q`)}
                </AccordionTrigger>
                <AccordionContent forceMount className="pb-7 [[data-state=closed]>&]:hidden">
                  <p className="text-base text-muted-foreground">
                    {k === "q7"
                      ? t.rich("faq.q7.a", {
                          prompts: (chunks) => (
                            <Link href="/documentation/choix-modele-ia" className="underline hover:text-foreground">
                              {chunks}
                            </Link>
                          ),
                        })
                      : t(`faq.${k}.a`)}
                  </p>
                  {/* Deux listes plutôt qu'un paragraphe : le lecteur cherche d'un coup
                    d'œil si une donnée précise part ou reste. Chaque ligne décrit le
                    code tel qu'il est ; un envoi ajouté au site doit s'y ajouter. */}
                  {k === "q8" ? (
                    <div className="mt-4 space-y-4 text-base text-muted-foreground">
                      {(["reste", "part"] as const).map((liste) => (
                        <div key={liste}>
                          <p className="font-semibold text-foreground">{t(`faq.q8.${liste}Titre`)}</p>
                          <ul className="mt-2 list-disc space-y-1.5 pl-5">
                            {(t.raw(`faq.q8.${liste}`) as string[]).map((ligne) => (
                              <li key={ligne}>{ligne}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                      <p>
                        {t.rich("faq.q8.fin", {
                          confidentialite: (chunks) => (
                            <Link href="/confidentialite" className="underline hover:text-foreground">
                              {chunks}
                            </Link>
                          ),
                        })}
                      </p>
                    </div>
                  ) : null}
                  {k === "how" ? (
                    <ol className="mt-5 space-y-4">
                      {(t.raw("faq.how.steps") as { title: string; desc: string }[]).map((step, idx) => (
                        <li key={idx} className="flex gap-3.5">
                          <span className="shrink-0 mt-0.5 w-6 h-6 rounded-full bg-primary text-primary-foreground text-[13px] font-bold flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <p className="text-base text-muted-foreground">
                            <span className="font-semibold text-foreground">{step.title}</span> — {step.desc}
                          </p>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {k === "built" ? (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {stack.map((chip) => (
                        <span
                          key={chip}
                          className="text-xs px-2.5 py-1 rounded-full bg-background border border-border text-muted-foreground"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* 6. NEWSLETTER CTA */}
      <section className="bg-cream-deep py-20 md:py-24">
        <div className="container mx-auto max-w-[1120px] px-6">
          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-8 md:gap-14 items-center">
            <div>
              <h2 className="text-[30px] md:text-[44px] font-bold leading-[1.1] tracking-tight mb-5">
                {t("newsletterCta.heading")}
              </h2>
              <p className="text-[17px] text-muted-foreground max-w-[40ch]">
                {t("newsletterCta.desc")}
              </p>
            </div>
            <div>
              <NewsletterForm variant="light" />
            </div>
          </div>
        </div>
      </section>

      {/* 7. CLOSING — image + card */}
      <section className="relative min-h-[640px] flex items-center justify-center py-20 px-6">
        <Image
          src="https://images.unsplash.com/photo-1604595818635-a840f9028d56?w=2000&q=80"
          alt={t("imageCourAlt")}
          fill
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-foreground/30 to-foreground/45" />
        <div className="relative z-10 bg-background max-w-[720px] w-full px-7 py-12 md:px-12 md:py-[72px] rounded text-center shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
          <h2 className="text-[32px] md:text-[52px] font-bold leading-[1.05] tracking-tight mb-8">
            {t("closing.title")}
          </h2>
          <div className="flex flex-col gap-3.5 items-center">
            {/* `target="_blank"` comme tous les liens vers contact@loiclair.fr,
                pour qu'ils se comportent pareil. */}
            <a
              href="mailto:contact@loiclair.fr"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-semibold text-[17px] border-b-2 border-primary pb-0.5 hover:opacity-80"
            >
              {t("closing.contactBtn")}
            </a>
            {/* « Auditer le code » et non « Contribuer » : le dépôt se lit, il
                n'accepte pas de pull requests (« Statut du code » du README). */}
            <Link
              href="https://github.com/loiclair/LoiClair"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary font-semibold text-[17px] border-b-2 border-primary pb-0.5 hover:opacity-80"
            >
              {t("closing.githubBtn")}
            </Link>
            <Link
              href="/nous-aider"
              className="text-primary font-semibold text-[17px] border-b-2 border-primary pb-0.5 hover:opacity-80"
            >
              {t("closing.helpBtn")}
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
