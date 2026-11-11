"use client"

// Ligne « Signaler une erreur ou proposer une idée » de /nous-aider. Elle
// ouvre le tiroir `SignalerProbleme`, monté par `(app)/layout.tsx`, et
// n'existe que parce qu'un Server Component ne peut pas porter d'`onClick`.
//
// L'événement part sans `detail`, contrairement à `SignalerButton` : le
// libellé promet une erreur *ou* une idée, donc le tiroir s'ouvre sur son
// menu à trois choix. La page fournit classes et contenu pour que cette ligne
// soit identique aux liens voisins.
export default function SignalerLigne({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event("open-signaler"))}
    >
      {children}
    </button>
  )
}
