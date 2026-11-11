'use client';

// Les sections d'un vote, communes à sa page (`page.tsx`) et au tiroir de la fiche du
// texte (`ScrutinVotesSheet`) : « Le résultat » (hémicycle et chiffres), « Ont voté contre
// leur groupe », puis « Le vote, groupe par groupe ». Chacune dans sa carte, comme sur la
// fiche du texte (`SectionRepliable`), sauf les dissidents quand il n'y en a aucun : une
// phrase seule n'a pas besoin de cadre. Le tiroir, plus étroit, les prend en `compact` :
// chiffres plus petits, hémicycle et chiffres toujours l'un sous l'autre.
//
// Les places des points de l'hémicycle se calculent ici, des deux côtés du rendu : elles
// viennent d'un plan figé (`hemicycle-sieges.ts`) rempli dans l'ordre, sans calcul
// flottant, donc serveur et navigateur tombent sur les mêmes valeurs.

import { useMemo, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { List, UserX, Vote, type LucideIcon } from 'lucide-react';
import SectionRepliable from '@/components/SectionRepliable';
import { planVide, pointsHemicycle } from '@/lib/hemicycle';
import type { ScrutinVotesResponse } from '@/lib/scrutin-votes';
import ScrutinVotesDetail, { LiensVote, ScrutinDissidents, dissidentsParGroupe } from '../../dossiers-legislatifs/[uid]/resume-ia/ScrutinVotesDetail';
import type { ScrutinData } from '../../dossiers-legislatifs/[uid]/resume-ia/ResumeIAClient';
import HemicycleVote from './HemicycleVote';
import { CarteChiffres } from './ResultatVote';

/** Pictogramme d'un surtitre de section, au format de ceux de la fiche du texte
 *  (`IconeSection` de `SectionsDossier.tsx`). */
export function IconeSection({ de: I }: { de: LucideIcon }) {
  return <I size={14} strokeWidth={1.5} aria-hidden style={{ flex: 'none', color: 'var(--muted-foreground)' }} />;
}

export default function SectionsVote({
  scrutin, chambreKey, statut, statutLabel, votes, status, sens, cleStockage, compact = false, lienPage = false, apres,
}: {
  scrutin: ScrutinData;
  chambreKey: string | null;
  /** Valeur brute (« Adopté », « Rejeté ») et sa traduction, pour le badge de la carte. */
  statut: string | null;
  statutLabel: string | null;
  /** `null` tant que le tiroir charge les votes ; la page les a toujours. */
  votes: ScrutinVotesResponse | null;
  status: 'idle' | 'loading' | 'error';
  /** Ce que le vote décidait, en une phrase, ou `null`. */
  sens: string | null;
  /** Clé `localStorage` du repli des sections : une par contexte (page, tiroir). */
  cleStockage: string;
  compact?: boolean;
  /** Dans le tiroir : le lien vers la page du vote, sous la carte des groupes. */
  lienPage?: boolean;
  /** Sections propres à l'appelant, posées après les autres (les autres votes du texte). */
  apres?: ReactNode;
}) {
  const t = useTranslations('scrutinVotes');
  const chambre = scrutin.uid.startsWith('VTSN') ? 'SEN' : 'AN';
  // Sans votes (le tiroir charge), le plan vide en squelette, à la place de l'hémicycle.
  const hemicycle = useMemo(() => (votes ? pointsHemicycle(votes, chambre) : planVide(chambre)), [votes, chambre]);
  // Chargement échoué dans le tiroir : pas d'hémicycle, sinon le squelette pulserait sans
  // fin au-dessus du message d'erreur de la section des groupes.
  const avecHemicycle = !!votes || status !== 'error';

  return (
    <>
      <SectionRepliable cle="resultat" cleStockage={cleStockage} icone={<IconeSection de={Vote} />} titre={t('sectionResultat')} carte>
        {/* Sur grand écran, l'hémicycle et les chiffres côte à côte ; empilés (et toujours
            dans le tiroir), un trait les sépare. */}
        <div className={compact ? 'grid grid-cols-1' : 'grid grid-cols-1 lg:grid-cols-2 items-center'} style={{ gap: compact ? '16px' : '20px 40px' }}>
          {avecHemicycle && (
            <HemicycleVote
              points={hemicycle.points}
              rayon={hemicycle.rayon}
              motion={scrutin.typeVoteCode === 'MOC'}
              ariaLabel={t('hemicycleAria', { pour: scrutin.pour, contre: scrutin.contre, abstentions: scrutin.abstentions })}
              chargement={!votes}
            />
          )}
          <div className="flex flex-col" style={{ gap: compact ? '16px' : '20px' }}>
            {avecHemicycle && <div aria-hidden className={compact ? '' : 'lg:hidden'} style={{ height: '1px', backgroundColor: 'var(--border)' }} />}
            <CarteChiffres scrutin={scrutin} chambreKey={chambreKey} statut={statut} statutLabel={statutLabel} sens={sens} compact={compact} />
          </div>
        </div>
      </SectionRepliable>
      {/* Toujours présente une fois les votes chargés : sans position de groupe, une
          phrase dit pourquoi il n'y a rien à montrer. */}
      {votes && (
        <SectionRepliable cle="dissidents" cleStockage={cleStockage} icone={<IconeSection de={UserX} />} titre={t('sectionDissidents')} carte={dissidentsParGroupe(votes).length > 0}>
          <ScrutinDissidents scrutin={scrutin} votes={votes} />
        </SectionRepliable>
      )}
      <SectionRepliable cle="groupes" cleStockage={cleStockage} icone={<IconeSection de={List} />} titre={t('groupsTitle')} carte>
        <div className="flex flex-col gap-4">
          <ScrutinVotesDetail scrutin={scrutin} chambreKey={chambreKey} votes={votes} status={status} titreGroupes={false} />
        </div>
      </SectionRepliable>
      {/* Dans le tiroir, hors de la carte pour qu'elles se voient : la page du vote et la
          source officielle. La page du vote porte la source dans son en-tête. */}
      {lienPage && <LiensVote scrutin={scrutin} chambreKey={chambreKey} lienPage />}
      {apres}
    </>
  );
}
