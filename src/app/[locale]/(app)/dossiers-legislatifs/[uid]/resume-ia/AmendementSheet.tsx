'use client';

// Tiroir d'un amendement adopté, ouvert depuis « Modifications du texte » : le lecteur garde
// sa place dans la fiche, et la même chose a une adresse (`/Amendements/[uid]`). Le contenu
// est celui du tiroir de « Ce qui me concerne » (`CorpsTiroirAmendement`) ; ce fichier ne
// porte que l'enveloppe et le chargement.
//
// Un seul tiroir par section, piloté par l'amendement ouvert : le panneau du budget compte
// 3 306 lignes. Chaque détail est gardé en mémoire après sa première lecture : refermer et
// rouvrir ne repaie pas la requête.

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { CorpsTiroirAmendement } from '@/components/ChangementsConcernes';
import { useEcranMobile } from '@/hooks/useEcranMobile';
import type { DetailAmendement } from '@/lib/amendement-page';
import type { AmendementAdopte } from './ModificationsSection';

export default function AmendementSheet({ amendement, ouvert, onFermer }: {
  /** Le dernier ouvert : il reste renseigné pendant l'animation de fermeture. */
  amendement: AmendementAdopte | null;
  ouvert: boolean;
  onFermer: () => void;
}) {
  const locale = useLocale();
  const isMobile = useEcranMobile();
  const [details, setDetails] = useState<Record<string, DetailAmendement>>({});
  const [echec, setEchec] = useState<string | null>(null);
  // Une demande en vol : rouvrir pendant le chargement n'en lance pas une seconde.
  const enCours = useRef(new Set<string>());

  const uid = amendement?.uid ?? null;

  useEffect(() => {
    if (!ouvert || !uid || details[uid] || enCours.current.has(uid)) return;
    enCours.current.add(uid);
    setEchec(null);
    fetch(`/api/amendements/${encodeURIComponent(uid)}?locale=${locale}`)
      .then((r) => (r.ok ? r.json() as Promise<DetailAmendement> : Promise.reject(new Error(String(r.status)))))
      .then((d) => setDetails((v) => ({ ...v, [uid]: d })))
      .catch(() => setEchec(uid))
      .finally(() => { enCours.current.delete(uid); });
  }, [ouvert, uid, details, locale]);

  return (
    <Sheet open={ouvert} onOpenChange={(o) => { if (!o) onFermer(); }}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        size={isMobile ? 'content' : 'default'}
        className={isMobile ? 'max-h-[85vh] overflow-y-auto rounded-t-2xl' : 'overflow-y-auto'}
        style={isMobile ? { width: '100%' } : undefined}
      >
        {amendement && (
          <CorpsTiroirAmendement
            amendement={amendement}
            detail={uid ? details[uid] ?? null : null}
            status={uid && echec === uid ? 'error' : 'loading'}
            onFermer={onFermer}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
