// Résultats du banc d'essai de « Ce qui me concerne » (rattachement des articles et
// amendements aux profils du lecteur, fait par `pipeline/classer_articles.py`),
// affichés dans la section « Ce qui me concerne » de /documentation/choix-modele-ia.
//
// Recopiés à la main depuis le banc du 2026-10-17, mené hors du dépôt : aucun script
// ne les régénère, et ces chiffres restent ceux de `dateMesure` même si la consigne
// change ensuite. Les parts du test viennent de la majorité des trois `juges`, d'une
// autre famille que les deux modèles comparés. Les chiffres de la boucle de réglage
// (jugée par un jury moins cher) ne sont plus publiés : ils restent dans
// scripts/banc-ce-qui-me-concerne/resultats/versions.md.
// La justesse du test est aussi écrite en dur dans `ceQuiMeConcerne.methode` (84 %) :
// à relire si ces chiffres changent.

export const EVALUATION_CE_QUI_ME_CONCERNE = {
  dateMesure: '2026-10-17',
  retenu: 'claude-haiku-5-5',
  compare: 'gpt-6-luna',
  juges: ['deepseek-v4-pro', 'gemini-3.8-flash', 'mistral-medium-3-5'],
  // Articles et amendements réels : `reglage` sert à réécrire la consigne, `test`
  // reste de côté jusqu'à la mesure finale.
  elements: { reglage: 100, test: 50 },
  // Cas où les juges se divisaient, départagés par un membre de l'équipe : il a
  // rejoint la majorité chaque fois.
  casDepartages: 16,
  // Sur le test, consigne finale pour les deux modèles. `justesse` : justes /
  // affichés ; `certain` et `probable`, la même part selon la certitude donnée par
  // le modèle ; `rappel` : profils trouvés parmi ceux que les juges disent concernés ;
  // `fidelite` : phrases d'explication fidèles au texte.
  test: {
    retenu: { justesse: 0.837, certain: 0.947, probable: 0.767, rappel: 0.719, fidelite: 0.878 },
    compare: { justesse: 0.791, certain: 0.8, probable: 0.75, rappel: 0.642, fidelite: 0.791 },
  },
  // Dollars pour 1 000 textes. Haiku : facture réelle de la passe complète en lots avec
  // cette consigne (4,37 $ pour 14 077 textes, le 2026-10-18 en UTC, que suit la
  // facturation d'Anthropic : le 17 au soir à l'heure de Seattle). Luna : facture Mammouth
  // du banc, appels directs.
  coutPour1000: { retenu: 0.31, compare: 0.3 },
} as const;
