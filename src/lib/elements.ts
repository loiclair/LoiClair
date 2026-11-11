// Le tableau des éléments de LoiClair : chaque grande rubrique du site devient un
// « élément », avec son numéro, son symbole et sa couleur, comme dans un tableau
// périodique dont le logo est l'élément Lc. Lu par la section « Aussi sur LoiClair »
// de l'accueil, l'en-tête des rubriques (`usePageHero`, qui porte aussi celui de la
// newsletter) et le panneau du menu mobile ; dessiné par `components/ui/Element`.
//
// Les noms ne sont pas ici : ils vivent dans le namespace `elements` des messages
// (`noms.<cle>`), envoyé au navigateur sur toutes les pages (`NAMESPACES_SOCLE`).
// Les symboles, eux, ne se traduisent pas, comme « Au » pour l'or : « Él » reste
// « Él » en anglais.

export type CleElement =
  | "fil"
  | "textes"
  | "activite"
  | "etatDesLieux"
  | "elus"
  | "contact"
  | "pourMoi"
  | "chiffres"
  | "processus"
  | "glossaire"
  | "quiz"
  | "ia"
  | "newsletter"
  | "bilingue"
  | "modele"
  | "prompts"
  | "conformite"
  | "nousAider"
  | "corrections"
  | "mentions"
  | "viePrivee"

export interface DonneesElement {
  cle: CleElement
  numero: number
  symbole: string
  /** La page de la rubrique, sans préfixe de langue. Deux éléments peuvent
   *  partager une page : « Co » n'a pas la sienne, on écrit à ses élus depuis
   *  leur liste. « Bi » mène à l'accueil dans l'autre langue. */
  route: string
}

/** Les vingt et un éléments, par numéro croissant. */
export const ELEMENTS: DonneesElement[] = [
  { cle: "fil", numero: 1, symbole: "Fa", route: "/Month" },
  { cle: "textes", numero: 2, symbole: "Tx", route: "/dossiers-legislatifs" },
  { cle: "activite", numero: 3, symbole: "Ac", route: "/Activite" },
  { cle: "etatDesLieux", numero: 4, symbole: "Et", route: "/etat-des-lieux" },
  { cle: "elus", numero: 5, symbole: "Él", route: "/les-elus" },
  { cle: "contact", numero: 6, symbole: "Co", route: "/les-elus" },
  { cle: "pourMoi", numero: 7, symbole: "Pm", route: "/ce-qui-me-concerne" },
  { cle: "chiffres", numero: 8, symbole: "Ch", route: "/Facts" },
  { cle: "processus", numero: 9, symbole: "Pl", route: "/processus-legislatif" },
  { cle: "glossaire", numero: 10, symbole: "Gl", route: "/documentation/glossaire" },
  { cle: "quiz", numero: 11, symbole: "Qz", route: "/Quiz" },
  { cle: "ia", numero: 12, symbole: "Ia", route: "/documentation/mcp" },
  { cle: "newsletter", numero: 13, symbole: "Nl", route: "/newsletter" },
  { cle: "bilingue", numero: 14, symbole: "Bi", route: "/" },
  // Transparence IA, puis Le projet : pages de pied de page, sans entrée de menu.
  { cle: "modele", numero: 15, symbole: "Mo", route: "/documentation/choix-modele-ia" },
  { cle: "prompts", numero: 16, symbole: "Pr", route: "/documentation/prompts-ia" },
  { cle: "conformite", numero: 17, symbole: "Cf", route: "/documentation/conformite-ia" },
  { cle: "nousAider", numero: 18, symbole: "Na", route: "/nous-aider" },
  { cle: "corrections", numero: 19, symbole: "Cr", route: "/documentation/corrections" },
  { cle: "mentions", numero: 20, symbole: "Ml", route: "/mentions-legales" },
  { cle: "viePrivee", numero: 21, symbole: "Vp", route: "/confidentialite" },
]

/** La couleur CSS de l'élément `cle`, le jeton `--element-<cle>` de globals.css
 *  (en kebab-case), qui change avec le thème. */
export function couleurElement(cle: CleElement): string {
  return `var(--element-${cle.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase())})`
}

/** L'élément de clé `cle`. */
export function element(cle: CleElement): DonneesElement {
  return ELEMENTS.find((e) => e.cle === cle)!
}

/** L'élément qui a pour page `route`, s'il y en a un. Quand deux éléments
 *  partagent une page (Élus et Contact), c'est le premier, celui de la rubrique.
 *  « Bi » est écarté : l'accueil n'est pas sa page, il y mène dans l'autre langue. */
export function elementDeRoute(route: string): DonneesElement | undefined {
  return ELEMENTS.find((e) => e.route === route && e.cle !== "bilingue")
}
