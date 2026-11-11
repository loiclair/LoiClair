// L'en-tête commun aux tiroirs d'un article, d'un amendement et d'un vote, et à la page d'un
// amendement : le nom de l'élément, puis des lignes étiquetées. Sans étiquette, on ne
// comprenait pas à quoi correspondait chaque ligne. Un amendement porte deux états : il peut
// être adopté alors que le texte qu'il modifie a ensuite été rejeté.
//
// Pas de `'use client'` : `articleEnEntier` et `LignesEntete` servent aussi à la page d'un
// amendement, rendue côté serveur.

import { Fragment, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import { BadgeStatut } from '@/app/[locale]/(app)/Scrutins/[uid]/ResultatVote';

export type TexteEntete = { uid: string; titre: string; traduit: boolean };
/** Un statut : `statut`, la valeur française brute qui choisit la couleur de la pastille
 *  (comme pour un vote) ; `libelle`, sa traduction ; `complement`, ce qui le précise hors de
 *  la pastille (date, lieu d'adoption, étape du parcours). `enChargement` : une pastille
 *  d'attente de même hauteur tient la place, pour que l'en-tête ne bouge pas à l'arrivée. */
export type EtatEntete = { etiquette: string; statut: string | null; libelle: string | null; complement?: string | null; enChargement?: boolean };

const STYLE_ETIQUETTE = { fontSize: '0.75rem', color: 'var(--muted-foreground)' } as const;

/** « Art. 5 » écrit en entier pour un titre. Les autres formes (« Après art. 1 »,
 *  « État A ») restent telles quelles. */
export function articleEnEntier(libelle: string) {
  return libelle.replace(/^Art\.\s*/, 'Article ');
}

/** Le nom du texte, toujours cliquable vers sa fiche. Sur cette fiche, l'adresse ne
 *  changeant pas, `onFermer` referme le tiroir. */
export function LienTexte({ texte, onFermer }: { texte: TexteEntete; onFermer?: () => void }) {
  return (
    <span className="flex flex-wrap items-center" style={{ gap: '6px' }}>
      <Link href={`/dossiers-legislatifs/${texte.uid}/resume-ia`} prefetch={false} onClick={onFermer} className="text-sm text-primary hover:underline">{texte.titre}</Link>
      {texte.traduit && <AIBadgeTitre />}
    </span>
  );
}

/** Les lignes étiquetées. Des `span` et non une liste de définitions : la phrase du bandeau
 *  de `PageHero`, où la page les pose, est un paragraphe. */
export function LignesEntete({ etiquetteTexte, texte, etats }: {
  etiquetteTexte: string;
  /** `null` tant que le texte n'est pas connu. */
  texte: ReactNode;
  etats: EtatEntete[];
}) {
  return (
    <span style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '4px 12px', alignItems: 'baseline', marginTop: '2px' }}>
      {texte && (
        <>
          <span style={STYLE_ETIQUETTE}>{etiquetteTexte}</span>
          <span style={{ minWidth: 0 }}>{texte}</span>
        </>
      )}
      {etats.map((e) => (
        <Fragment key={e.etiquette}>
          <span style={STYLE_ETIQUETTE}>{e.etiquette}</span>
          <span style={{ ...STYLE_ETIQUETTE, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.4rem', lineHeight: 1.5 }}>
            {/* La boîte de `BadgeStatut`, avec une espace insécable : même hauteur et même
                ligne de base que la pastille qui la remplacera. */}
            {e.enChargement
              ? <span aria-hidden className="inline-block shrink-0 px-2 py-0.5 rounded-full font-semibold border border-transparent bg-accent animate-pulse" style={{ fontSize: '11px', width: '7rem' }}>{' '}</span>
              : <BadgeStatut statut={e.statut} statutLabel={e.libelle} />}
            {e.complement && <span>{e.complement}</span>}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/** L'en-tête d'un tiroir. Le vide flottant dégage « Partager » et la croix, posés en absolu
 *  à la hauteur de la première ligne, sans retirer de largeur aux lignes suivantes d'un
 *  titre long (celui d'un vote tient souvent sur quatre lignes à 390 px). */
export function EnteteTiroir({ nom, texte, etats, onFermer }: {
  nom: ReactNode;
  /** Absent tant que le détail charge, quand le texte n'est pas déjà connu. */
  texte?: TexteEntete | null;
  etats: EtatEntete[];
  onFermer: () => void;
}) {
  const t = useTranslations('amendementPage');
  return (
    <SheetHeader>
      <SheetTitle style={{ fontSize: '16px', lineHeight: 1.35 }}>
        <span aria-hidden style={{ float: 'right', width: 110, height: '1em' }} />
        {nom}
      </SheetTitle>
      <LignesEntete
        etiquetteTexte={t('enteteTexte')}
        texte={texte?.titre ? <LienTexte texte={texte} onFermer={onFermer} /> : null}
        etats={etats}
      />
    </SheetHeader>
  );
}
