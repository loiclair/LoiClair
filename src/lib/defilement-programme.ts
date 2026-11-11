// src/lib/defilement-programme.ts
// Marque les défilements que la page déclenche elle-même, pour les distinguer
// d'un geste du lecteur.
//
// Deux comportements dépendent de cette distinction, et aucun ne peut la faire
// depuis un événement `scroll`, qui est identique dans les deux cas :
//
//   - `TopNav` replie son en-tête dès qu'on descend. Un saut d'ancre descend lui
//     aussi, et la section visée se posait alors sous un en-tête parti : le
//     `scroll-margin-top` réserve sa hauteur, qui restait une bande vide.
//   - `MonthFeedClient` réarme son défilement infini au premier `scroll` venu.
//     Un retour en haut depuis le bas du fil le réarmait donc alors que la
//     sentinelle était encore à portée, et chargeait un mois que personne
//     n'avait demandé.
//
// La marque dure ce que dure le défilement, et pas une durée devinée : les
// navigateurs dimensionnent leur défilement doux d'après la distance, et une
// constante assez longue pour un fil sans fin avalerait le geste qui suit un
// saut court. `scrollend` dirait exactement cela, mais son support est trop
// récent pour s'y fier seul ; le silence de `scroll` pendant 150 ms le remplace
// partout.

/** Vrai entre le déclenchement et l'arrêt constaté du défilement. */
let enCours = false;
let minuteur: ReturnType<typeof setTimeout> | undefined;
let ecoute = false;

const FIN_APRES_MS = 150;
/** Garde-fou : un défilement qui n'arrive jamais à destination (page trop courte
 *  pour bouger, geste qui l'interrompt) ne doit pas figer la marque. */
const DUREE_MAX_MS = 4000;

function terminer() {
  enCours = false;
  clearTimeout(minuteur);
  if (ecoute) {
    window.removeEventListener('scroll', repousser);
    ecoute = false;
  }
}

function repousser() {
  clearTimeout(minuteur);
  minuteur = setTimeout(terminer, FIN_APRES_MS);
}

/** À appeler juste avant un `scrollTo` ou un `scrollIntoView` de la page. */
export function marquerDefilementProgramme(): void {
  enCours = true;
  if (!ecoute) {
    window.addEventListener('scroll', repousser, { passive: true });
    ecoute = true;
  }
  // Le premier `scroll` peut tarder d'une image ; ce minuteur-ci couvre aussi le
  // cas où il ne vient jamais, faute de déplacement possible.
  clearTimeout(minuteur);
  minuteur = setTimeout(terminer, DUREE_MAX_MS);
}

/** Vrai tant que le défilement déclenché par la page n'est pas retombé. */
export function defilementProgramme(): boolean {
  return enCours;
}
