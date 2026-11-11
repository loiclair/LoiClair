// Titre d'un dossier, d'une loi publiée (`application_lois`) ou d'un scrutin, à afficher
// selon la langue du lecteur.
//
// `titre_en` est la traduction par l'IA du titre officiel (`pipeline/traduire_titres.py`,
// prompt `lib/prompts/titres-en.json`). Il ne s'affiche que sur /en, et seulement quand il
// existe : un dossier déposé ou un scrutin tenu dans la journée n'est traduit que la nuit
// suivante, et garde d'ici là son titre français. Le français ne lit jamais `titre_en`.
//
// Restent en français quelle que soit la langue : la newsletter, le courriel aux élus
// (`lib/mailto.ts`), le MCP (`lib/mcp/lois.ts`, aucun texte produit par un modèle) et ce
// qu'on envoie aux IA. La mention IA (D-002) suit tout titre traduit affiché. Sur la
// fiche du dossier, badge court et titre officiel sous le titre. Ailleurs, le badge court
// (`AIBadgeTitre`) se pose à côté d'un titre seul et non cliquable (carte de vote et son
// volet, question du quiz, fil d'Ariane, tiroir de « Ce qui me concerne »), et en tête de
// la section quand elle liste des titres qui sont des liens ou des boutons, où un
// badge-lien ne peut pas entrer (liste des textes, fiche d'élu, Month, Facts, recherche).

type AvecTitres = { titre?: string | null; titre_en?: string | null };

export function titreDossier(d: AvecTitres, locale: string): string {
  return (locale === 'en' && d.titre_en) || d.titre || '';
}

/** Vrai quand le titre affiché est une traduction : le badge IA et le titre officiel suivent. */
export function titreTraduit(d: AvecTitres, locale: string): boolean {
  return locale === 'en' && !!d.titre_en;
}
