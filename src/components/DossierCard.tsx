'use client';

// Une ligne cliquable de la liste /dossiers-legislatifs, qui en est le seul appelant.
//
// Le survol passe par un état React plutôt que par `hover:` en Tailwind : sur
// Safari, la pipeline Tailwind v4 transforme ou supprime le CSS de survol
// (ARCHITECTURE.md §Pièges Tailwind v4, qui cite ce fichier comme référence du
// contournement). Ne pas « simplifier » en classe utilitaire, le survol
// disparaîtrait sur iPhone sans que rien ne le signale.
//
// Les lignes n'ont plus de filet : ce sont l'espace entre elles et le fond de
// survol qui les séparent.

import { useState } from 'react';
import { Link } from '@/i18n/navigation';

export default function DossierCard({
  href,
  target,
  children,
}: {
  href: string;
  target?: string;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Link
      href={href}
      target={target}
      prefetch={false}
      style={{
        display: 'block',
        backgroundColor: hovered ? 'var(--muted)' : 'transparent',
        borderRadius: '0.5rem',
        transition: 'background-color 0.15s ease',
        WebkitTransition: 'background-color 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ padding: '10px 16px' }}>
        {children}
      </div>
    </Link>
  );
}
