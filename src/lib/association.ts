// Identité de l'association qui édite le site, lue par la page `/about` (bloc des
// fondateurs), `/mentions-legales` (éditeur, directeur de la publication,
// documents), `/nous-aider` (lien vers les statuts), la fiche schema.org de la
// page d'accueil et le pied de la newsletter (adresse du siège). Un changement au
// bureau se reporte ici seul.
// Source : déclaration en préfecture du 5 octobre 2026, publiée au Journal
// officiel du 13 octobre 2026 (annonce n° 2090).

export const ASSOCIATION = {
  nom: "LoiClair",
  rna: "W751286466",
  /** Date de la déclaration en préfecture, pas celle de la publication au JO. */
  dateDeclaration: "2026-10-05",
  siege: { rue: "104, rue de Richelieu", codePostal: "75002", ville: "Paris" },
  email: "contact@loiclair.fr",
  /**
   * Documents publiés dans `public/`. Les statuts sont la version signée, dont
   * l'adresse personnelle de l'article 3 et les signatures ont été retirées du
   * fichier (pas seulement recouvertes), annotations et métadonnées comprises.
   */
  statuts: "/statuts-loiclair.pdf",
  annonceJo: "/jo-annonce-loiclair.pdf",
} as const

/**
 * Les quatre membres fondateurs, dans l'ordre du bureau. Chacun a accepté
 * d'apparaître sur le site. Le premier est le président, donc de droit le
 * directeur de la publication (LCEN, article 1-1).
 */
export const FONDATEURS = [
  { nom: "Alexandre Godin", role: "president", linkedin: "https://www.linkedin.com/in/alexandre-godin/" },
  { nom: "Émilie Boffo", role: "vicePresidente", linkedin: "https://www.linkedin.com/in/emilie-boffo/" },
  { nom: "Frédéric Godin", role: "tresorier", linkedin: "https://www.linkedin.com/in/frederic-godin/" },
  { nom: "Virgile Brohart", role: "secretaire", linkedin: "https://www.linkedin.com/in/vbrohart/" },
] as const

export const PRESIDENT = FONDATEURS[0]
