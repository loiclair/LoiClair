'use client';

// src/i18n/TraductionsRoute.tsx
// Ajoute aux traductions du provider parent celles qu'une route envoie en plus
// (`messagesRoute`, appelé par le `layout.tsx` de la route via `layoutTraductions`).
//
// Pourquoi une fusion : un `NextIntlClientProvider` imbriqué remplace les messages de
// son parent au lieu de les compléter (use-intl 4.14.9, `IntlProvider`), alors que la
// page lit aussi le socle (boutons communs, partage). Fusion en profondeur : une route
// peut ajouter un sous-arbre d'un namespace dont le socle porte déjà d'autres clés
// (`answerActivite`, dont le menu lit les titres). Locale, fuseau et formats restent
// ceux du parent.

import { useMemo, type ReactNode } from 'react';
import { NextIntlClientProvider, useLocale, useMessages, type AbstractIntlMessages } from 'next-intl';

function fusionner(a: AbstractIntlMessages, b: AbstractIntlMessages): AbstractIntlMessages {
  const sortie: AbstractIntlMessages = { ...a };
  for (const [cle, valeur] of Object.entries(b)) {
    const avant = sortie[cle];
    sortie[cle] = typeof valeur === 'object' && valeur !== null && typeof avant === 'object' && avant !== null
      ? fusionner(avant, valeur)
      : valeur;
  }
  return sortie;
}

export default function TraductionsRoute({ messages, children }: { messages: AbstractIntlMessages; children: ReactNode }) {
  const parent = useMessages();
  const locale = useLocale();
  const fusion = useMemo(() => fusionner(parent, messages), [parent, messages]);
  return <NextIntlClientProvider locale={locale} messages={fusion}>{children}</NextIntlClientProvider>;
}
