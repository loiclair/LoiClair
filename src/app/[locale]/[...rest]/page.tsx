import { notFound } from 'next/navigation';

/**
 * Attrape toute URL préfixée d'une locale qui ne correspond à aucune route, et la
 * renvoie sur `[locale]/not-found.tsx`.
 *
 * Sans elle, Next considère l'URL comme non routée et rend le `not-found.tsx` de la
 * racine de `app/` : une page de secours en français seul, sans la mise en page du
 * site, réservée aux adresses qui n'atteignent aucune langue. Les `notFound()` levés
 * depuis une page existante, eux, trouvent déjà la bonne page ; c'est le seul cas
 * qui manquait.
 *
 * Le catch-all a la priorité la plus faible du routeur : il ne prend la main que
 * lorsqu'aucune autre route ne correspond.
 */
export default function PageIntrouvable() {
  notFound();
}
