import type { CSSProperties, ReactNode } from 'react';

/**
 * Surligneur des chiffres de « La réponse », seul modèle de tous les articles
 * `/Facts` : on l'appelle depuis la balise `hl` de `t.rich`, avec la couleur de
 * la page (hex à 6 chiffres ou toute couleur CSS).
 *
 * Le rendu vit dans la classe `.surligne` de `globals.css` et non en style en
 * ligne : un style en ligne ne peut pas avoir de variante sombre, et le fond à
 * 12,5 % d'une teinte foncée ne se distinguait plus d'une page presque noire.
 * La couleur passe par la variable `--surligne`, que la classe mélange avec
 * `color-mix`, donc sans concaténer un suffixe d'opacité à un hex.
 */
export function Surligne({ couleur, children }: { couleur: string; children: ReactNode }) {
  return (
    <span className="surligne font-bold" style={{ '--surligne': couleur } as CSSProperties}>
      {children}
    </span>
  );
}
