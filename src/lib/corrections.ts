// Journal public des corrections de données, rendu par
// `/documentation/corrections`. Les entrées s'écrivent à la main, et le fichier
// grossit d'une entrée à chaque erreur constatée.
//
// Les textes vivent ici plutôt que dans `src/messages/*.json` pour deux
// raisons. Un namespace du catalogue qu'un composant client vient à lire part
// au navigateur sur chaque page du site, landing comprise
// (`src/i18n/messages-client.ts`), et un journal qui n'a pas de fin n'y a pas
// sa place : ici, il n'en court pas le risque. Et les deux langues tenues dans la même
// entrée rendent la parité FR/EN impossible à oublier, là où le catalogue ne la
// vérifie qu'après coup.
//
// Contrainte d'import : seul un Server Component lit ce module, sans quoi les
// deux langues partiraient chez tous les visiteurs.
//
// Trois règles de rédaction, qui comptent plus que le format :
//   1. Aucun nom propre. On décrit la classe d'erreur, jamais la personne
//      qu'elle a touchée : republier le nom d'un élu à qui on a attribué le
//      mandat d'un homonyme referait l'erreur sur la page qui la corrige.
//   2. Une date d'entrée corrigée est celle du correctif, jamais celle où
//      l'affichage a changé : un correctif de pipeline ne se voit qu'au run
//      nocturne suivant.
//   3. Rien n'entre ici sur la seule foi d'un signalement. Une entrée
//      `en-cours` dit une erreur que l'on a soi-même reproduite : publier un
//      doute non vérifié sur une donnée qui s'avère juste coûte plus cher que
//      d'attendre une journée de plus.

export type CorrectionScope = 'score' | 'fiche-elu' | 'votes' | 'faits' | 'textes'

// `en-cours` : erreur constatée et reconnue, correctif pas encore en ligne. Le
// statut change ce que la page écrit autour des deux colonnes, pas leur rôle :
// `before` reste ce qui s'affiche ou s'affichait, `after` ce qui le remplace ou
// va le remplacer.
export type CorrectionStatus = 'corrige' | 'en-cours'

type CorrectionTexte = {
  title: string
  before: string
  after: string
}

export type Correction = {
  id: string
  // Entrée corrigée : date du correctif. Entrée en cours : date du constat.
  date: string
  status: CorrectionStatus
  scope: CorrectionScope
  // Page du site où la donnée corrigée se lit, sans préfixe de langue : le
  // `Link` de `@/i18n/navigation` pose celui de la locale courante. Une
  // correction qui touche plusieurs pages désigne la plus représentative, celle
  // où le lecteur pourra constater le changement lui-même.
  href: string
  fr: CorrectionTexte
  en: CorrectionTexte
}

// Vide tant que le lancement officiel n'a pas eu lieu (décision d'Alex, 2026-10-29) :
// `/documentation/corrections` rend alors son état vide (clé `corrections.empty`).
export const CORRECTIONS: Correction[] = []
