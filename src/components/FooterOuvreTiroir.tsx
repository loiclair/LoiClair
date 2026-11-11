"use client"

// Lien du pied de page qui ouvre un tiroir au lieu de naviguer : signalement
// (`open-signaler`) ou adhésion (`open-adhesion`), montées par les mises en page.
// Bouton stylé comme les `FooterLink` voisins.
export default function FooterOuvreTiroir({ label, evenement }: { label: string; evenement: "open-signaler" | "open-adhesion" }) {
  return (
    <button
      type="button"
      style={{
        color: "inherit",
        transition: "color 150ms",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        fontFamily: "inherit",
        fontSize: "inherit",
        textAlign: "left",
      }}
      onClick={() => window.dispatchEvent(new Event(evenement))}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--footer-heading)" }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "inherit" }}
    >
      {label}
    </button>
  )
}
