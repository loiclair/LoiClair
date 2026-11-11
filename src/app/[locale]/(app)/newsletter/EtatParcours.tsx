// Le corps des étapes du parcours newsletter (merci, confirmer, bienvenue,
// désabonnement) : sous le bandeau commun, qui ne change jamais, un titre de section
// et une phrase disent où en est le lecteur, puis viennent ses actions. Sans
// directive : les pages serveur comme les pages client (`confirmer`, `desabonner`)
// l'importent, donc ni hook ni traduction ici, les libellés arrivent en props.
// Styles en ligne : Tailwind v4 est peu fiable sur Safari pour les tailles et les
// marges (CLAUDE.md).

import type { CSSProperties, ReactNode } from "react"
import { Link } from "@/i18n/navigation"

/** Texte courant de la rubrique. `--foreground` mélangé et non `--muted-foreground` :
 *  ce gris pâle ne fait que 2,5:1 sur blanc, trop peu pour une phrase à lire. */
export const TEXTE_DOUX = "color-mix(in srgb, var(--foreground) 66%, transparent)"

/** Lien d'action principal (« Voir ce qui me concerne → »). */
export const STYLE_LIEN: CSSProperties = { color: "var(--primary)", fontWeight: 600, fontSize: "0.9375rem", textDecoration: "none" }
/** Flèche d'un lien d'action, décorative : insécable devant, pour ne jamais finir
 *  seule en début de ligne. */
export const FLECHE = <span aria-hidden="true">{" →"}</span>
/** Lien secondaire (« Retour à l'accueil »), souligné pour rester un lien en gris. */
export const STYLE_LIEN_DOUX: CSSProperties = { color: TEXTE_DOUX, fontSize: "0.875rem", textUnderlineOffset: 2 }

const BOUTON: CSSProperties = {
  height: 46, borderRadius: 9999, border: "none", padding: "0 18px",
  fontFamily: "inherit", fontSize: "0.9375rem", fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0,
}
/** Bouton or : réservé à « Réessayer », l'or étant la couleur de l'inscription. */
export const STYLE_BOUTON_OR: CSSProperties = { ...BOUTON, background: "#D4A54A", color: "#1C1917" }
/** Bouton neutre des désabonnements : pas d'or pour ce qu'on ne pousse pas à faire. */
export const STYLE_BOUTON_NEUTRE: CSSProperties = { ...BOUTON, background: "var(--foreground)", color: "var(--background)" }

/** Id du titre d'une étape, que `useFocusEtape` focalise au changement d'étape. */
export const ID_TITRE_ETAPE = "etape-titre"

/** Rangée d'actions sous la phrase (liens, bouton). */
export function Actions({ children, haut = 20 }: { children: ReactNode; haut?: number }) {
  return <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 20px", alignItems: "center", marginTop: haut }}>{children}</div>
}

/**
 * Une étape du parcours : `titre` en h2 (le h1 est celui du bandeau), `texte` sous
 * lui, puis `children`. `role="status"` sur les étapes que la page change sans
 * navigation (attente, échec), pour qu'un lecteur d'écran les annonce. Une page
 * client le passe à **tous** ses états, celui de départ compris : une zone annoncée
 * qui apparaît en même temps que son contenu n'est pas lue, la plupart des lecteurs
 * d'écran n'écoutant que les zones déjà présentes.
 */
export function EtatParcours({ titre, texte, children, annonce }: { titre: string; texte?: ReactNode; children?: ReactNode; annonce?: boolean }) {
  return (
    <div role={annonce ? "status" : undefined} style={{ maxWidth: 560, padding: "40px 0 64px" }}>
      {/* Focalisable par le code seulement (`useFocusEtape`), sans contour : ce
          n'est pas une commande, juste le point de reprise après un changement d'étape. */}
      <h2 id={ID_TITRE_ETAPE} tabIndex={-1} style={{ fontSize: "1.375rem", fontWeight: 600, lineHeight: 1.3, letterSpacing: "-0.015em", color: "var(--foreground)", margin: "0 0 8px", outline: "none" }}>
        {titre}
      </h2>
      {texte && <p style={{ fontSize: "0.96875rem", lineHeight: 1.6, color: "var(--card-foreground)", margin: "0 0 12px" }}>{texte}</p>}
      {children}
    </div>
  )
}

/** Paragraphe secondaire d'une étape (le second temps de la phrase). */
export function TexteEtape({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: "0.9375rem", lineHeight: 1.6, color: TEXTE_DOUX, margin: "0 0 12px" }}>{children}</p>
}

/**
 * Bloc séparé par un filet, sous l'étape : « En attendant lundi », « Partager avec
 * vos proches ».
 */
export function BlocSuite({ titre, children }: { titre: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid var(--border)" }}>
      <h3 style={{ fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.01em", color: "var(--foreground)", margin: "0 0 6px" }}>{titre}</h3>
      {children}
    </section>
  )
}

/**
 * « En attendant lundi » : la page merci et la bienvenue mènent vers Ce qui me
 * concerne, la lettre étant la même pour tous (D-243).
 */
export function EnAttendantLundi({ titre, texte, lien }: { titre: string; texte: string; lien: string }) {
  return (
    <BlocSuite titre={titre}>
      <TexteEtape>{texte}</TexteEtape>
      <Link href="/ce-qui-me-concerne" style={STYLE_LIEN}>{lien}{FLECHE}</Link>
    </BlocSuite>
  )
}
