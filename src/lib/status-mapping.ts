// src/lib/status-mapping.ts
//
// Couleur de badge d'un statut, lue sur sa valeur française en base : statut d'un
// dossier, sort d'un scrutin, décision du Conseil constitutionnel. Appelé par la
// fiche dossier (décisions, scrutins, Conseil constitutionnel) et par `/Month`.

// ── Badge classes pour statut_final (source de vérité unique) ──

export const STATUS_BADGE_CLASSES: Record<string, string> = {
  "Appliquée": "bg-[#DAA520]/15 text-[#DAA520] border-[#DAA520]/30 dark:bg-[#DAA520]/20 dark:text-[#F1C40F]",
  "Promulguée": "bg-[#27AE60]/15 text-[#27AE60] border-[#27AE60]/30 dark:bg-[#27AE60]/20 dark:text-[#2ECC71]",
  "Rejeté": "bg-[#E74C3C]/15 text-[#E74C3C] border-[#E74C3C]/30 dark:bg-[#E74C3C]/20",
  "Déposé - pas encore voté": "bg-[#F39C12]/15 text-[#F39C12] border-[#F39C12]/30 dark:bg-[#F39C12]/20 dark:text-[#F1C40F]",
  "Retiré": "bg-[#95A5A6]/15 text-[#7F8C8D] border-[#95A5A6]/30 dark:bg-[#95A5A6]/20 dark:text-[#BDC3C7]",
  "Publié": "bg-[#3498DB]/15 text-[#3498DB] border-[#3498DB]/30 dark:bg-[#3498DB]/20 dark:text-[#5DADE2]",
  "Adopté par le Parlement": "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300",
  "Adopté par l'Assemblée nationale": "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300",
  "Adopté par le Sénat": "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300",
  // Décisions du Conseil constitutionnel
  "Conforme": "bg-[#27AE60]/15 text-[#27AE60] border-[#27AE60]/30 dark:bg-[#27AE60]/20 dark:text-[#2ECC71]",
  "Conforme avec réserve": "bg-[#F39C12]/15 text-[#F39C12] border-[#F39C12]/30 dark:bg-[#F39C12]/20 dark:text-[#F1C40F]",
  "Partiellement conforme": "bg-[#E67E22]/15 text-[#E67E22] border-[#E67E22]/30 dark:bg-[#E67E22]/20 dark:text-[#F39C12]",
  "Non conforme": "bg-[#E74C3C]/15 text-[#E74C3C] border-[#E74C3C]/30 dark:bg-[#E74C3C]/20",
};

const FALLBACK_BADGE_CLASS = "bg-muted text-muted-foreground border-border";

/** Retourne la classe badge pour un statut donné (match exact, puis fallback par mot-clé) */
export function getStatusBadgeClass(statut: string | null | undefined): string {
  if (!statut) return FALLBACK_BADGE_CLASS;
  if (STATUS_BADGE_CLASSES[statut]) return STATUS_BADGE_CLASSES[statut];
  const l = statut.toLowerCase();
  if (l.includes("rejet") || l.includes("pas adopté")) return STATUS_BADGE_CLASSES["Rejeté"];
  if (l.includes("adopt") || l.includes("modifi")) return STATUS_BADGE_CLASSES["Promulguée"];
  return FALLBACK_BADGE_CLASS;
}
