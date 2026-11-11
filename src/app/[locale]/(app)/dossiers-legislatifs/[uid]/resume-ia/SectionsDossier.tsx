/**
 * Les neuf sections de la fiche dossier : leur clé, leur pictogramme et la clé
 * du repli mémorisé. Servi deux fois par icône — devant le surtitre de la
 * section, et dans sa pastille d'ancre — et par deux fichiers : le rendu réel
 * (`ResumeIAClient`) et le squelette d'attente (`DossierBodySkeleton`). Sans ce
 * module commun, les deux dérivent et le basculement du `<Suspense>` saute.
 *
 * Volontairement sans `'use client'` : le squelette est un composant serveur, et
 * un composant serveur ne peut pas lire une valeur exportée par un module client.
 */

import { FileText, UserRound, MessagesSquare, Milestone, FilePen, Landmark, Newspaper, Users, FolderOpen } from 'lucide-react';

export const ICONES = {
  resume: FileText,
  // L'icône du profil sur la page « Ce qui me concerne ».
  pourVous: UserRound,
  debat: MessagesSquare,
  parcours: Milestone,
  modifications: FilePen,
  cc: Landmark,
  presse: Newspaper,
  elus: Users,
  sources: FolderOpen,
} as const;

export type SectionCle = keyof typeof ICONES;

/** Sections sans objet sur un dossier de contrôle (commission d'enquête, mission ou
 *  rapport d'information) : un rapport n'est ni amendé ni déféré au Conseil
 *  constitutionnel. Seule exception à « toutes les sections sur toute fiche » ; le
 *  rendu réel et le squelette les retirent, ancres comprises. */
export const SECTIONS_HORS_CONTROLE: ReadonlySet<string> = new Set<SectionCle>(['modifications', 'cc']);

/** Clé du repli mémorisé, propre à cette fiche : la fiche élu a la sienne. */
export const CLE_PLI = 'dossier-fiche-plie';

/** Ancre du bloc « Amendements adoptés par auteur » de la section « Modifications du texte »,
 *  visée par la pastille « N adoptés » de l'en-tête (`DossierHero`, composant serveur). */
export const ANCRE_AMENDEMENTS = 'amendements-adoptes';

/** Le pictogramme devant le surtitre d'une section, en gris pour rester derrière lui. */
export function IconeSection({ cle }: { cle: SectionCle }) {
  const Icone = ICONES[cle];
  return <Icone size={14} strokeWidth={1.5} aria-hidden style={{ flex: 'none', color: 'var(--muted-foreground)' }} />;
}

/** Le même pictogramme dans la pastille d'ancre : l'ancre cliquée se reconnaît
 *  dans le surtitre vers lequel elle mène. Il hérite de `currentColor`, donc il
 *  passe au brun avec le texte sur l'ancre active. */
export function IconeAncre({ cle }: { cle: SectionCle }) {
  const Icone = ICONES[cle];
  return <Icone size={15} strokeWidth={1.5} aria-hidden style={{ flex: 'none' }} />;
}
