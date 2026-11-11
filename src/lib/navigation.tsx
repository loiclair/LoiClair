// Navigation du site : les entrées du menu du haut, l'en-tête commun de chaque
// page (`usePageHero`) et la rangée de pages sœurs sous cet en-tête
// (`usePagesSoeurs`). Lu par `TopNav` et `AppShell`.

import { useLocale, useTranslations } from "next-intl"
import { CalendarDays, Database } from "lucide-react"
import type { PageHeroMetaRow, PageHeroProps, PageHeroPill } from "@/components/PageHero"
import { FACTS_ARTICLES, type FactsHref } from "@/lib/facts-registry"
import { LEGAL_AN, LEGAL_SN } from "@/lib/parliament-constants"
import { buildShareUrl } from "@/lib/share-url"
import { couleurElement, elementDeRoute } from "@/lib/elements"
import { Element } from "@/components/ui/Element"
import { lienSource } from "@/lib/sources"

/**
 * Une entrée de menu déroulant, ou une pastille de la rangée de pages sœurs.
 * `description` ne s'affiche que dans le menu du bureau, sous le libellé.
 */
export interface SubLink {
  href: string
  label: string
  description?: string
}

/**
 * Une entrée du menu du haut. `prefixes` décide quand elle est surlignée ;
 * `subLinks` en fait un menu déroulant, dont le libellé n'est alors plus un lien.
 */
export interface NavCategory {
  key: string
  label: string
  href: string
  prefixes: string[]
  subLinks?: SubLink[]
}

/**
 * Les six entrées du menu du haut, libellés traduits. À appeler depuis un
 * composant client (`useTranslations`) : `TopNav` et `AppShell`.
 *
 * Regroupées par intention : suivre (Fil d'actu, Textes, Élus, Pour moi), mesurer
 * (Chiffres), apprendre (Comprendre). `/newsletter` n'appartient à aucune entrée,
 * le bouton « S'abonner » de l'en-tête y mène.
 */
export function useNavCategories(): NavCategory[] {
  const t = useTranslations("nav")

  return [
    {
      key: "newsfeed",
      label: t("newsFeedShort"),
      href: "/Month",
      prefixes: ["/Month"],
    },
    {
      key: "textes",
      label: t("textes"),
      href: "/dossiers-legislatifs",
      // Un vote se rattache à un texte : sa page (`/Scrutins/…`) allume « Textes ».
      prefixes: ["/dossiers-legislatifs", "/Scrutins", "/Amendements"],
    },
    {
      key: "elus",
      label: t("elus"),
      href: "/les-elus",
      prefixes: ["/les-elus"],
    },
    {
      // Libellé court (« Pour moi ») : le titre de la page, « Ce qui me concerne »,
      // ne tenait pas sur la ligne du menu à côté des cinq autres entrées.
      key: "pourMoi",
      label: t("pourMoi"),
      href: "/ce-qui-me-concerne",
      prefixes: ["/ce-qui-me-concerne"],
    },
    {
      key: "chiffres",
      label: t("chiffres"),
      href: "/etat-des-lieux",
      prefixes: ["/etat-des-lieux", "/Facts", "/Activite"],
      subLinks: [
        { href: "/etat-des-lieux", label: t("etatDesLieux"), description: t("etatDesLieuxDesc") },
        { href: "/Facts", label: t("dashboard"), description: t("dashboardDesc") },
        { href: "/Activite", label: t("activite"), description: t("activiteDesc") },
      ],
    },
    {
      key: "comprendre",
      label: t("comprendre"),
      href: "/processus-legislatif",
      // Pas « /documentation » entier : le journal des corrections et les quatre
      // pages sur l'IA y vivent aussi, sans entrée de menu (seul le pied de page y
      // mène), et « Comprendre » s'allumait sur elles sans aucune ligne active.
      prefixes: ["/processus-legislatif", "/documentation/glossaire", "/Quiz"],
      subLinks: [
        { href: "/processus-legislatif", label: t("legislativeProcess"), description: t("legislativeProcessDesc") },
        { href: "/documentation/glossaire", label: t("glossary"), description: t("glossaryDesc") },
        { href: "/Quiz", label: t("quiz"), description: t("quizDesc") },
      ],
    },
  ]
}

/**
 * Vrai quand `pathname` est la page du lien ou l'une de ses sous-pages. Sert au
 * surlignage d'une entrée de menu déroulant dans `TopNav`, bureau et mobile.
 */
export function isSubLinkActive(link: SubLink, pathname: string): boolean {
  return pathname === link.href || pathname.startsWith(link.href + "/")
}

/**
 * Returns the key of the category that should be highlighted for `pathname`.
 * Uses longest-prefix-wins so that more specific routes (e.g. /Facts/loyaute)
 * win over their parent (/Facts).
 */
export function getActiveCategoryKey(categories: NavCategory[], pathname: string): string | null {
  let bestKey: string | null = null
  let bestLen = -1
  for (const cat of categories) {
    for (const p of cat.prefixes) {
      if (pathname === p || pathname.startsWith(p + "/")) {
        if (p.length > bestLen) {
          bestLen = p.length
          bestKey = cat.key
        }
      }
    }
  }
  return bestKey
}

// ──────────────────────────────────────────────────────────
// En-tête des pages L1 et L2 (`PageHero`, rendu par `AppShell`)
// ──────────────────────────────────────────────────────────
//
// Les clés de traduction sont des chemins complets (`process.pageTitle`), lus
// par un seul traducteur sans namespace : les titres restent dans le namespace
// de leur page, où vivent aussi ses métadonnées.

/**
 * Une page d'accueil. `rubrique` : la route dont la page prend la case d'élément,
 * quand ce n'est pas la sienne (les étapes du parcours newsletter portent la case
 * Nl de `/newsletter`). `sansPartage` : pas de bouton Partager, pour une page qui
 * ne dit rien à qui la reçoit (un lien de confirmation, un désabonnement).
 */
interface PageAccueilConfig {
  titleKey: string
  ledeKey: string
  rubrique?: string
  sansPartage?: boolean
}

/** Le bandeau de la newsletter, le même à chaque étape du parcours : seul le corps
 *  de la page dit où l'on en est (inscrit, lien périmé, désabonné…). */
const ETAPE_NEWSLETTER: PageAccueilConfig = {
  titleKey: "newsletter.titrePage",
  ledeKey: "newsletter.ledePage",
  rubrique: "/newsletter",
  sansPartage: true,
}

/**
 * Pages d'accueil : bandeau grand format, titre et une phrase. Ce sont les
 * entrées du menu qui mènent à une page sans sœur, et la newsletter avec chaque
 * étape de son parcours. Les pages de Chiffres et de Comprendre ont des sœurs :
 * elles prennent l'en-tête de page, sans fil d'Ariane, leur case d'élément et la
 * rangée de pages sœurs disant où l'on est.
 */
const PAGES_ACCUEIL: Record<string, PageAccueilConfig> = {
  "/Month": { titleKey: "month.pageTitle", ledeKey: "pageHeaders.ledeMonth" },
  "/dossiers-legislatifs": { titleKey: "dossiers.pageTitle", ledeKey: "pageHeaders.ledeDossiers" },
  "/les-elus": { titleKey: "pageHeaders.elusTitle", ledeKey: "pageHeaders.ledeElus" },
  "/ce-qui-me-concerne": { titleKey: "ceQuiMeConcerne.titre", ledeKey: "ceQuiMeConcerne.lede" },
  "/newsletter": { titleKey: ETAPE_NEWSLETTER.titleKey, ledeKey: ETAPE_NEWSLETTER.ledeKey },
  "/newsletter/merci": ETAPE_NEWSLETTER,
  "/newsletter/confirmer": ETAPE_NEWSLETTER,
  "/newsletter/bienvenue": ETAPE_NEWSLETTER,
  "/newsletter/desabonner": ETAPE_NEWSLETTER,
  "/newsletter/desabonner/confirmer": ETAPE_NEWSLETTER,
  "/newsletter/desabonne": ETAPE_NEWSLETTER,
}

interface FactsRouteConfig {
  titleKey: string
  ledeKey: string
  /** Sources additionnelles (au-delà des sources par défaut) */
  sourcePills: { label: string; href: string }[]
  /**
   * Masque la pastille « Mise à jour : quotidienne ». Juste pour les pages lues en
   * base après l'import de chaque nuit, elle est fausse pour une page qui raconte
   * un exercice clos : ses chiffres ne changeront plus.
   */
  hideUpdated?: boolean
}

// Les sources qui pointent sur la même adresse que la liste unique du site s'y lisent.
// Les autres restent écrites ici : le baromètre mène à son propre site, que la liste
// remplace par la page de l'Assemblée, et les liens INSEE et des comptes visent la page
// précise d'un millésime ou d'un rapport, que la liste n'a pas.
const SRC_AN = lienSource("source1")
const SRC_BAROMETRE = { label: "barometre.assemblee-nationale.fr", href: "https://barometre.assemblee-nationale.fr/" }
const SRC_SENAT = lienSource("source2")
const SRC_RNE = lienSource("source9")
const SRC_GEO = lienSource("source11")
const SRC_INSEE_AGE = { label: "insee.fr", href: "https://www.insee.fr/fr/statistiques/2381476" }
const SRC_INSEE_METIERS = { label: "insee.fr", href: "https://www.insee.fr/fr/statistiques/2011101?geo=FRANCE-1" }
const SRC_INSEE_GENRE = { label: "insee.fr", href: "https://www.insee.fr/fr/statistiques/2381474" }
// Populations de référence 2023 des départements, le millésime de `population-departements.json`.
const SRC_INSEE_GEO = { label: "insee.fr", href: "https://www.insee.fr/fr/statistiques/8680659?sommaire=8681011" }
const SRC_AN_COMPTES = { label: "assemblee-nationale.fr", href: "https://www.assemblee-nationale.fr/dyn/compte-an" }
const SRC_SENAT_COMPTES = { label: "senat.fr", href: "https://www.senat.fr/connaitre-le-senat/role-et-fonctionnement/le-controle-des-comptes-du-senat.html" }

/**
 * Les pages Facts. Couleur, thème et chapitre ne sont pas ici : ils se lisent
 * dans `FACTS_ARTICLES`, qui les tient déjà pour le hub et ses cartes. Les clés
 * sont exactement les adresses du registre, `/Activite` exceptée (son en-tête
 * est dans `PAGES_L2`) : un article ajouté d'un seul côté ne compile pas, au
 * lieu de s'afficher sans en-tête.
 */
const FACTS_ROUTES: Record<Exclude<FactsHref, "/Activite">, FactsRouteConfig> = {
  "/Facts/taux-promulgation": { titleKey: "enactmentRateTitle", ledeKey: "ledePromulgation", sourcePills: [SRC_AN] },
  "/Facts/taux-application": { titleKey: "applicationRateTitle", ledeKey: "ledeApplication", sourcePills: [SRC_BAROMETRE, SRC_AN] },
  "/Facts/delais": { titleKey: "delaisTitle", ledeKey: "ledeDelais", sourcePills: [SRC_AN, SRC_BAROMETRE] },
  "/Facts/representativite/age": { titleKey: "representativiteAgeTitle", ledeKey: "ledeRepresentativiteAge", sourcePills: [SRC_AN, SRC_SENAT, SRC_INSEE_AGE] },
  "/Facts/representativite/metiers": { titleKey: "representativiteMetiersTitle", ledeKey: "ledeRepresentativiteMetiers", sourcePills: [SRC_AN, SRC_SENAT, SRC_INSEE_METIERS] },
  "/Facts/representativite/genre": { titleKey: "representativiteGenreTitle", ledeKey: "ledeRepresentativiteGenre", sourcePills: [SRC_AN, SRC_SENAT, SRC_INSEE_GENRE] },
  "/Facts/representativite/geographie": { titleKey: "representativiteGeographieTitle", ledeKey: "ledeRepresentativiteGeographie", sourcePills: [SRC_AN, SRC_SENAT, SRC_INSEE_GEO] },
  "/Facts/participation": { titleKey: "participationTitle", ledeKey: "ledeParticipation", sourcePills: [SRC_AN, SRC_SENAT] },
  "/Facts/loyaute": { titleKey: "loyauteTitle", ledeKey: "ledeLoyaute", sourcePills: [SRC_AN, SRC_SENAT] },
  "/Facts/cumul-des-mandats": { titleKey: "cumulMandatsTitle", ledeKey: "ledeCumulMandats", sourcePills: [SRC_RNE, SRC_GEO, SRC_AN, SRC_SENAT] },
  "/Facts/alliances": { titleKey: "alliancesTitle", ledeKey: "ledeAlliances", sourcePills: [SRC_AN, SRC_SENAT] },
  "/Facts/succes-legislatif/volume": { titleKey: "succesLegislatifTitle", ledeKey: "ledeSuccesLegislatif", sourcePills: [SRC_AN, SRC_SENAT] },
  "/Facts/succes-legislatif/efficacite": { titleKey: "succesLegislatifEfficaciteTitle", ledeKey: "ledeSuccesLegislatifEfficacite", sourcePills: [SRC_AN, SRC_SENAT] },
  "/Facts/succes-legislatif/victoires": { titleKey: "succesLegislatifVictoiresTitle", ledeKey: "ledeSuccesLegislatifVictoires", sourcePills: [SRC_AN, SRC_SENAT] },
  "/Facts/amendements": { titleKey: "amendementsTitle", ledeKey: "ledeAmendements", sourcePills: [SRC_AN, SRC_SENAT] },
  "/Facts/budget/assemblee-nationale": { titleKey: "budgetAssembleeTitle", ledeKey: "ledeBudgetAssemblee", sourcePills: [SRC_AN_COMPTES], hideUpdated: true },
  "/Facts/budget/senat": { titleKey: "budgetSenatTitle", ledeKey: "ledeBudgetSenat", sourcePills: [SRC_SENAT_COMPTES], hideUpdated: true },
}

interface PageL2Config {
  titleKey: string
  ledeKey: string
  /** La famille de la page, maillon par maillon ; le dernier est la page, sous
   *  son nom court. Le fil d'Ariane ne s'affiche plus sur ces pages : la liste ne
   *  sert qu'à `usePagesSoeurs`, qui y lit la famille et le nom de chaque pastille. */
  breadcrumb: { labelKey: string }[]
}

const CRUMB_CHIFFRES = { labelKey: "nav.chiffres" }
const CRUMB_COMPRENDRE = { labelKey: "nav.comprendre" }
const CRUMB_IA = { labelKey: "nav.transparenceIA" }
const CRUMB_PROJET = { labelKey: "footer.project" }

/**
 * Les pages L2 hors articles Facts et hors fiches : Chiffres, Comprendre,
 * Transparence IA, Le projet. Les pages qui partagent les mêmes maillons parents
 * forment une rangée de pages sœurs (`usePagesSoeurs`), dans l'ordre de cette table.
 */
const PAGES_L2: Record<string, PageL2Config> = {
  "/etat-des-lieux": { titleKey: "pageHeaders.titreEtatDesLieux", ledeKey: "pageHeaders.ledeEtatDesLieux", breadcrumb: [CRUMB_CHIFFRES, { labelKey: "nav.etatDesLieux" }] },
  "/Facts": { titleKey: "pageHeaders.titreFacts", ledeKey: "pageHeaders.ledeFacts", breadcrumb: [CRUMB_CHIFFRES, { labelKey: "kpis.pageTitle" }] },
  "/Activite": { titleKey: "pageHeaders.activiteTitle", ledeKey: "pageHeaders.ledeActivite", breadcrumb: [CRUMB_CHIFFRES, { labelKey: "nav.activite" }] },
  "/processus-legislatif": { titleKey: "pageHeaders.titreProcessus", ledeKey: "pageHeaders.ledeProcessus", breadcrumb: [CRUMB_COMPRENDRE, { labelKey: "nav.legislativeProcess" }] },
  "/documentation/glossaire": { titleKey: "pageHeaders.titreGlossaire", ledeKey: "pageHeaders.ledeGlossaire", breadcrumb: [CRUMB_COMPRENDRE, { labelKey: "nav.glossary" }] },
  "/Quiz": { titleKey: "pageHeaders.titreQuiz", ledeKey: "pageHeaders.ledeQuiz", breadcrumb: [CRUMB_COMPRENDRE, { labelKey: "nav.quiz" }] },
  "/documentation/choix-modele-ia": { titleKey: "pageHeaders.titreChoixModeleIA", ledeKey: "pageHeaders.ledeChoixModeleIA", breadcrumb: [CRUMB_COMPRENDRE, CRUMB_IA, { labelKey: "nav.choixModeleIA" }] },
  "/documentation/prompts-ia": { titleKey: "pageHeaders.titrePromptsIA", ledeKey: "promptsIA.introBody", breadcrumb: [CRUMB_COMPRENDRE, CRUMB_IA, { labelKey: "nav.promptsIA" }] },
  "/documentation/conformite-ia": { titleKey: "pageHeaders.titreConformiteIA", ledeKey: "pageHeaders.ledeConformiteIA", breadcrumb: [CRUMB_COMPRENDRE, CRUMB_IA, { labelKey: "nav.aiCompliance" }] },
  "/documentation/mcp": { titleKey: "mcp.titre", ledeKey: "pageHeaders.ledeMcp", breadcrumb: [CRUMB_COMPRENDRE, CRUMB_IA, { labelKey: "nav.mcp" }] },
  "/nous-aider": { titleKey: "nousAider.pageTitle", ledeKey: "nousAider.intro", breadcrumb: [CRUMB_PROJET, { labelKey: "footer.helpUs" }] },
  "/documentation/corrections": { titleKey: "pageHeaders.titreCorrections", ledeKey: "corrections.pageDescription", breadcrumb: [CRUMB_PROJET, { labelKey: "footer.corrections" }] },
  "/mentions-legales": { titleKey: "pageHeaders.titreMentionsLegales", ledeKey: "mentionsLegales.subtitle", breadcrumb: [CRUMB_PROJET, { labelKey: "footer.mentionsLegales" }] },
  "/confidentialite": { titleKey: "pageHeaders.titreConfidentialite", ledeKey: "confidentialite.pageDescription", breadcrumb: [CRUMB_PROJET, { labelKey: "footer.privacy" }] },
}

/**
 * Les clés de traduction que lisent `usePageHero` et `usePagesSoeurs` par nom
 * variable, tirées des tables ci-dessus. Le navigateur ne reçoit qu'une partie du
 * catalogue (`src/i18n/messages-client.ts`) : une page ajoutée à une table y emporte
 * ainsi ses clés, sans liste à tenir. Les clés écrites en dur dans ces deux fonctions
 * (`kpisHub.labelSource`…) sont couvertes par la liste de `messages-client.ts`, que
 * le contrôle de `lint:strict` vérifie.
 */
export function clesTraductionNavigation(): string[] {
  return [
    ...Object.values(PAGES_ACCUEIL).flatMap((p) => [p.titleKey, p.ledeKey]),
    ...Object.values(PAGES_L2).flatMap((p) => [p.titleKey, p.ledeKey, ...p.breadcrumb.map((c) => c.labelKey)]),
    ...Object.values(FACTS_ROUTES).flatMap((p) => [`pageHeaders.${p.titleKey}`, `pageHeaders.${p.ledeKey}`]),
  ]
}

/**
 * Les props de `PageHero` pour `pathname`, ou `null` si la page n'a pas d'en-tête
 * commun ou le rend elle-même (fiches élu et dossier, pages de débats).
 */
export function usePageHero(pathname: string): PageHeroProps | null {
  const locale = useLocale()
  const t = useTranslations()
  const shareUrl = buildShareUrl(locale, pathname)
  const accueil = PAGES_ACCUEIL[pathname]

  // La case de la rubrique, que `PageHero` pose dans la ligne du titre. Seule la
  // page même de l'élément en a une, ou une page d'accueil qui emprunte celle de sa
  // rubrique : ni les articles des faits, ni les pages sœurs qui n'ont pas
  // d'élément. Complète (numéro, symbole, nom) en 64 px dès 640 px ; en `sm` en
  // dessous, où elle écraserait un titre de 22 px.
  const el = elementDeRoute(accueil?.rubrique ?? pathname)
  const element = el ? (
    <>
      <span className="sm:hidden">
        <Element taille="sm" numero={el.numero} symbole={el.symbole} couleur={couleurElement(el.cle)} />
      </span>
      <span className="max-sm:hidden">
        <Element cote={64} numero={el.numero} symbole={el.symbole} nom={t(`elements.noms.${el.cle}`)} couleur={couleurElement(el.cle)} />
      </span>
    </>
  ) : undefined

  if (accueil) {
    return {
      format: "accueil",
      title: t(accueil.titleKey),
      // Seule la phrase des élus a des variables ; les autres les ignorent.
      lede: t(accueil.ledeKey, { an: LEGAL_AN, sn: LEGAL_SN }),
      element,
      shareUrl: accueil.sansPartage ? undefined : shareUrl,
    }
  }

  // Pastilles Sources, puis « Mise à jour : quotidienne » sauf `sansMiseAJour`.
  const metaSources = (sources: { label: string; href: string }[], sansMiseAJour = false): PageHeroMetaRow[] => [
    {
      icon: <Database className="h-3 w-3" />,
      label: sources.length > 1 ? t("kpisHub.labelSources") : t("kpisHub.labelSource"),
      pills: sources.map((src) => ({ children: src.label, href: src.href })),
    },
    ...(sansMiseAJour
      ? []
      : [
          {
            icon: <CalendarDays className="h-3 w-3" />,
            label: t("kpisHub.labelUpdated"),
            pills: [{ children: t("kpisHub.valueDaily") } as PageHeroPill],
          },
        ]),
  ]

  const page = PAGES_L2[pathname]
  if (page) {
    return {
      title: t(page.titleKey),
      lede: t(page.ledeKey),
      element,
      shareUrl,
    }
  }

  const config = (FACTS_ROUTES as Partial<Record<string, FactsRouteConfig>>)[pathname]
  const article = FACTS_ARTICLES.find((a) => a.href === pathname)
  if (!config || !article) return null

  const meta = metaSources(config.sourcePills, config.hideUpdated)

  // Le dernier maillon est le thème de l'article, qui est aussi le nom de sa
  // série : le numéro et le nom du chapitre passent dans le titre.
  const serie = article.serie
  const chapitre = serie
    ? {
        n: serie.chapter,
        total: FACTS_ARTICLES.filter((a) => a.serie?.key === serie.key).length,
        libelle: t(`kpisHub.${serie.labelKey}`),
      }
    : undefined

  return {
    breadcrumb: [
      { label: t("nav.chiffres") },
      { label: t("kpis.pageTitle"), href: "/Facts" },
      { label: t(`kpisHub.${article.categoryKey}`) },
    ],
    title: t(`pageHeaders.${config.titleKey}`),
    lede: t(`pageHeaders.${config.ledeKey}`),
    accent: article.color,
    chapitre,
    meta,
    shareUrl,
  }
}

// ──────────────────────────────────────────────────────────
// Rangée de pastilles des pages sœurs, sous l'en-tête
// ──────────────────────────────────────────────────────────

/**
 * Les pages sœurs de `pathname`, que `AppShell` affiche en pastilles sous
 * l'en-tête, ou `undefined` hors de `PAGES_L2`. Une famille, ce sont les pages
 * dont le fil d'Ariane a les mêmes maillons parents ; chaque pastille porte le
 * dernier maillon de sa page. Les articles des faits, les quiz eux-mêmes, les
 * fiches et `/about` ne sont pas dans `PAGES_L2`, donc sans rangée.
 */
export function usePagesSoeurs(pathname: string): SubLink[] | undefined {
  const t = useTranslations()
  const page = PAGES_L2[pathname]
  if (!page) return undefined
  const famille = (p: PageL2Config) => p.breadcrumb.slice(0, -1).map((c) => c.labelKey).join("/")
  const cle = famille(page)
  return Object.entries(PAGES_L2)
    .filter(([, p]) => famille(p) === cle)
    .map(([href, p]) => ({ href, label: t(p.breadcrumb[p.breadcrumb.length - 1].labelKey) }))
}
