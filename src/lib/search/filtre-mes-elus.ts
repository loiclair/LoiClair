// src/lib/search/filtre-mes-elus.ts
// Le filtre « Mes élus » de `/les-elus`, lu et posé par `ElusResultsClient`, et
// retiré par `RechercheGlobale` quand « Voir les N élus » ouvre la liste : la
// recherche du menu porte sur tous les élus, et le filtre laissé posé ferait
// montrer à la liste moins d'élus que le nombre annoncé.
//
// Le filtre reste hors du hash : ses élus sont ceux du navigateur, un lien
// partagé montrerait ceux du destinataire, ou rien. Il vit dans la session
// plutôt que dans un état React pour survivre au retour depuis une fiche, comme
// les filtres du hash. La session garde l'`updated_at` des élus filtrés, et non
// un simple drapeau : des élus oubliés puis identifiés à nouveau sur une autre
// page changent de date, et le filtre ne se repose pas tout seul au retour.

import { stockageSession } from '@/lib/stockage-navigateur';

const CLE_FILTRE_MES_ELUS = 'loiclair-filtre-mes-elus';
const EVT_FILTRE_MES_ELUS = 'loiclair-filtre-mes-elus';

export function abonnerFiltreMesElus(cb: () => void) {
  window.addEventListener(EVT_FILTRE_MES_ELUS, cb);
  return () => window.removeEventListener(EVT_FILTRE_MES_ELUS, cb);
}

export function lireFiltreMesElus(): string | null {
  return stockageSession.lire(CLE_FILTRE_MES_ELUS);
}

/** `version` : l'`updated_at` des élus à filtrer, `null` pour retirer le filtre. */
export function ecrireFiltreMesElus(version: string | null) {
  if (version) stockageSession.ecrire(CLE_FILTRE_MES_ELUS, version);
  else stockageSession.effacer(CLE_FILTRE_MES_ELUS);
  window.dispatchEvent(new Event(EVT_FILTRE_MES_ELUS));
}
