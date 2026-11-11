// Échappement HTML des textes insérés dans le corps des emails (newsletter,
// confirmation d'inscription, signalement, adhésion). Une seule version : les
// quatre copies qui existaient avaient déjà divergé (l'une n'échappait pas les
// guillemets, une autre tronquait après l'échappement et pouvait couper une
// entité en deux). Tronquer, si besoin, se fait avant l'appel.

/** Rend `texte` sûr à placer dans du HTML, y compris dans un attribut entre guillemets. */
export function echapperHtml(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
