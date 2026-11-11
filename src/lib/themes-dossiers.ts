// Thème d'un dossier (valeur écrite en base par `generate_search_summaries.py`, prise
// dans la liste fermée de `lib/prompts/search-summary.json`) → clé stable du namespace
// `themesDossiers`, qui porte le libellé dans chaque langue.
//
// Une clé et non un texte : le thème brut reste ce qui filtre et agrège (slug du filtre
// Thème, `filterDossiers`), la traduction n'intervient qu'au rendu (CLAUDE.md,
// §Traductions). Un thème absent de la table (liste élargie côté prompt sans mise à jour
// ici) s'affiche tel quel, en français.

export const THEME_KEY: Record<string, string> = {
  'Sports': 'sports',
  'Énergie': 'energie',
  'Éducation': 'education',
  'Transports': 'transports',
  'Agriculture et pêche': 'agriculturePeche',
  'Travail': 'travail',
  'Environnement': 'environnement',
  'Justice': 'justice',
  'Logement et urbanisme': 'logementUrbanisme',
  'Questions sociales et santé': 'questionsSocialesSante',
  'Police et sécurité': 'policeSecurite',
  'Famille': 'famille',
  'Culture': 'culture',
  'Défense': 'defense',
  'Économie et finances, fiscalité': 'economieFinances',
  'Budget': 'budget',
  'Sécurité sociale': 'securiteSociale',
  'Collectivités territoriales': 'collectivites',
  'Pouvoirs publics et Constitution': 'pouvoirsPublics',
  'Affaires étrangères et coopération': 'affairesEtrangeres',
  'Traités et conventions': 'traites',
  'Union européenne': 'unionEuropeenne',
  'Outre-mer': 'outreMer',
  'Entreprises': 'entreprises',
  'Fonction publique': 'fonctionPublique',
  'Anciens combattants': 'ancienCombattants',
  'Recherche, sciences et techniques': 'recherche',
};

/** Libellé affiché d'un thème : `t` est un traducteur du namespace `themesDossiers`. */
export function libelleTheme(theme: string, t: (cle: string) => string): string {
  const cle = THEME_KEY[theme];
  return cle ? t(cle) : theme;
}
