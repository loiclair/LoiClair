/**
 * Accès au stockage du navigateur qui ne lève jamais.
 *
 * Safari réglé sur « bloquer tous les cookies », Firefox en protection stricte et
 * le partitionnement de stockage font échouer l'accès au *getter* `window.localStorage`
 * lui-même, avant toute lecture. Un accès nu placé dans un rendu React (le `getSnapshot`
 * d'un `useSyncExternalStore`, par exemple) emporte donc la page entière, pas seulement
 * le composant : c'est pour ça que tout passe par ici, y compris l'obtention de l'objet.
 *
 * Lecture ratée : `null`, indistinguable d'une clé absente, ce que tous les appelants
 * traitent déjà. Écriture ratée : `false`, que personne n'a besoin de tester aujourd'hui
 * mais qui laisse le choix à un appelant futur.
 */

type Stockage = {
  lire(cle: string): string | null
  ecrire(cle: string, valeur: string): boolean
  effacer(cle: string): boolean
}

/** `acces` n'est appelé qu'à l'intérieur d'un `try` : c'est lui qui peut lever. */
function fabriqueStockage(acces: () => Storage): Stockage {
  return {
    lire(cle) {
      try {
        return acces().getItem(cle)
      } catch {
        return null
      }
    },
    ecrire(cle, valeur) {
      try {
        acces().setItem(cle, valeur)
        return true
      } catch {
        return false
      }
    },
    effacer(cle) {
      try {
        acces().removeItem(cle)
        return true
      } catch {
        return false
      }
    },
  }
}

export const stockageLocal = fabriqueStockage(() => window.localStorage)
export const stockageSession = fabriqueStockage(() => window.sessionStorage)
