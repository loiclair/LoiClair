// src/i18n/layout-traductions.tsx
// Serveur uniquement. Fabrique le `layout.tsx` d'une route qui envoie au navigateur
// des traductions en plus du socle (`TRADUCTIONS_PAR_ROUTE` de `messages-client.ts`) :
// chacun de ces layouts n'est qu'un appel à cette fonction, avec le nom de sa route.
// Le provider n'entoure que les enfants : les routes en dessous en héritent.

import type { ReactNode } from 'react';
import { getMessages } from 'next-intl/server';
import TraductionsRoute from './TraductionsRoute';
import { messagesRoute } from './messages-client';

export function layoutTraductions(route: string) {
  return async function LayoutTraductions({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    return (
      <TraductionsRoute messages={messagesRoute(await getMessages({ locale }), route)}>
        {children}
      </TraductionsRoute>
    );
  };
}
