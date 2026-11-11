// Le catalogue des profils de « Ce qui me concerne » et leur ordre d'affichage, sans
// React. Il vit hors de `useMesProfils` (un module `'use client'`) pour que le serveur
// puisse le lire : la lettre du lundi range les profils de la semaine dans le même
// ordre que les pastilles (`api/newsletter/_context.ts`). Le hook le réexporte, ses
// appelants n'ont pas à savoir qu'il est ici.

import prompt from '@/lib/prompts/ce-qui-me-concerne.json';

// Les identifiants viennent du prompt lui-même : un profil ajouté au catalogue
// apparaît ici sans autre changement que ses deux libellés traduits.
export const PROFILS = prompt.profils.map((p) => p.id);
// Ordre d'affichage des thèmes, les plus courants d'abord. Il vit ici et pas dans le
// catalogue : l'ordre des thèmes du catalogue entre dans la consigne de l'IA
// (`classer_articles.py`), et le changer obligerait à reclasser tous les textes. Un
// thème absent de la liste (ajouté au catalogue) passe en dernier.
const ORDRE_THEMES = ['activite', 'secteur', 'logement', 'famille', 'couple', 'argent', 'lieu', 'commune', 'mobilite', 'sante', 'nationalite', 'loisirs', 'engagement'];
const rangTheme = (id: string) => {
  const r = ORDRE_THEMES.indexOf(id);
  return r < 0 ? ORDRE_THEMES.length : r;
};
// Les profils se rangent par thème, tous les thèmes ouverts et chaque profil en
// pastille : un seul geste pour tout le choix. Un thème à choix unique (lieu, couple,
// secteur) ne garde qu'un profil : en cocher un retire l'autre. Il n'a pas d'option
// neutre : aucune pastille cochée vaut « métropole », « autre secteur » ou « non
// précisé », réponses qu'aucune loi ne vise en propre.
export const THEMES = prompt.themes
  .map((t) => ({
    theme: t.id,
    choixUnique: t.choixUnique,
    profils: prompt.profils.filter((p) => p.theme === t.id).map((p) => p.id),
  }))
  .sort((a, b) => rangTheme(a.theme) - rangTheme(b.theme));
export type Theme = (typeof THEMES)[number];
// Ordre des sections de la liste, du menu « Ma situation », des profils sur la fiche
// d'un texte et des profils de la semaine dans la lettre : celui des pastilles, pour
// que tout se lise comme le choix. `PROFILS` garde l'ordre du catalogue, dont les
// rangs servent d'identifiants dans l'index de la page « Ce qui me concerne ».
export const ORDRE_PROFILS = THEMES.flatMap((th) => th.profils);
