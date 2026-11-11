'use client';

// Volet de détail d'un scrutin, ouvert depuis la carte de vote du parcours de la loi.
// Il garde le lecteur dans le contexte du texte ; la même chose a aussi sa page, avec une
// adresse (`/Scrutins/[uid]`), que « Partager » donne et qu'un lien en pied ouvre.
// Le corps reprend les sections de la page (`SectionsVote`, en `compact`) ; ce fichier ne
// porte que l'enveloppe, l'en-tête et le chargement.
//
// Les données sont chargées à la première ouverture via /api/scrutin-votes, puis gardées
// en mémoire : un lecteur qui referme et rouvre le même vote ne repaie pas la requête.

import { useCallback, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { EnteteTiroir } from '@/components/EnteteElement';
import ShareButton from '@/components/ShareButton';
import { buildShareUrl } from '@/lib/share-url';
import { useEcranMobile } from '@/hooks/useEcranMobile';
import type { ScrutinVotesResponse } from '@/lib/scrutin-votes';
import type { ScrutinData } from './ResumeIAClient';
import { AIBadgeTitre } from './AICardElements';
import SectionsVote from '../../../Scrutins/[uid]/SectionsVote';

type Props = {
  scrutin: ScrutinData;
  chambreKey: string | null;
  titre: string | null;
  /** Vrai quand `titre` est la traduction de l'IA : le badge le suit. */
  titreTraduit?: boolean;
  /** Étape du parcours à laquelle ce vote appartient (« Assemblée nationale — 1ʳᵉ lecture »).
   *  Le titre du scrutin est le libellé officiel, il ne dit pas de quelle lecture il s'agit. */
  etapeLabel: string | null;
  /** Valeur brute (« Adopté », « Rejeté ») : sert à choisir la couleur du badge. */
  statut: string | null;
  /** Libellé traduit du même statut, calculé par la carte qui ouvre le volet. */
  statutLabel: string | null;
};

export default function ScrutinVotesSheet({ scrutin, chambreKey, titre, titreTraduit, etapeLabel, statut, statutLabel }: Props) {
  const scrutinUid = scrutin.uid;
  const t = useTranslations('scrutinVotes');
  const tAmendement = useTranslations('amendementPage');
  const locale = useLocale();

  const [open, setOpen] = useState(false);
  const [votes, setVotes] = useState<ScrutinVotesResponse | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');

  // Sur mobile le volet monte du bas plutôt que d'arriver par la droite : le pouce est en
  // bas de l'écran, et un panneau latéral n'a de sens que là où il reste de la place à
  // côté.
  const isMobile = useEcranMobile();


  // Le chargement part de l'ouverture, pas d'un effet : le volet est une action du lecteur,
  // pas un état à synchroniser. Une fois `votes` rempli, rouvrir ne refait pas la requête.
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next || votes || status === 'loading') return;
    setStatus('loading');
    fetch(`/api/scrutin-votes?uid=${encodeURIComponent(scrutinUid)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: ScrutinVotesResponse) => {
        setVotes(data);
        setStatus('idle');
      })
      .catch(() => setStatus('error'));
  }, [votes, status, scrutinUid]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="self-start inline-flex items-center gap-1 text-primary hover:underline"
          style={{ fontSize: '11px', fontWeight: 500, padding: '2px 0' }}
        >
          {t('cta')}
          <ChevronRight style={{ width: '12px', height: '12px' }} />
        </button>
      </SheetTrigger>

      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        size={isMobile ? 'content' : 'default'}
        className={isMobile ? 'max-h-[85vh] overflow-y-auto rounded-t-2xl' : 'overflow-y-auto'}
        style={isMobile ? { width: '100%' } : undefined}
      >
        {/* Placé par rapport au volet (`SheetContent`, fixe), comme la croix, juste à sa
            gauche : même position que dans le tiroir d'un changement (`ChangementsConcernes`).
            L'adresse partagée est celle de la page du vote, pas de la fiche du texte. */}
        <span style={{ position: 'absolute', top: 10, right: 42 }}>
          <ShareButton
            discret
            url={buildShareUrl(locale, `/Scrutins/${scrutinUid}`)}
            message={t('partageMessage', { titre: titre || t('title') })}
            ariaLabel={t('partagerLabel')}
          />
        </span>
        <EnteteTiroir
          nom={(
            <>
              {titre || t('title')}
              {titre && titreTraduit && <span style={{ marginLeft: '6px', verticalAlign: '1px' }}><AIBadgeTitre /></span>}
            </>
          )}
          etats={statutLabel || etapeLabel ? [{ etiquette: tAmendement('enteteEtat'), statut, libelle: statutLabel, complement: etapeLabel }] : []}
          onFermer={() => setOpen(false)}
        />

        {/* Les sections de la page du vote, en plus petit : le tiroir est plus étroit. */}
        <div>
          <SectionsVote
            scrutin={scrutin}
            chambreKey={chambreKey}
            statut={statut}
            statutLabel={statutLabel}
            votes={votes}
            status={status}
            sens={null}
            cleStockage="vote-tiroir-plie"
            compact
            lienPage
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
