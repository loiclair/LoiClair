"use client"

// Bouton qui ouvre le tiroir d'adhésion (`AdhesionDialog`, monté par les
// mises en page). Il n'existe que parce qu'un Server Component ne peut pas
// porter d'`onClick` : /nous-aider et /about fournissent classes et contenu,
// pour qu'il ressemble aux liens voisins.
export default function AdhesionBouton({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event("open-adhesion"))}
    >
      {children}
    </button>
  )
}
