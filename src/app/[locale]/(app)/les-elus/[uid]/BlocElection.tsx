'use client';

/**
 * Bloc élection de la fiche élu (D-298, D-289) : sous la ligne du siège dans la
 * colonne Mandats, ou en tête de la carte quand cette ligne n'existe pas.
 *
 * Reçoit `ElectionAffichee`, préparée et traduite par `preparerElection` dans
 * `page.tsx` : aucun texte ni calcul ici, seulement la mise en page et l'état du repli.
 * Rendu par `EluProfileClient`.
 *
 * Tailles, interlignes, largeurs et positions en `style={{}}`, pas en classes
 * Tailwind : Tailwind v4 est peu fiable sur Safari pour ces propriétés (CLAUDE.md).
 * Le survol, le focus et la rotation du chevron du bouton vivent dans la classe
 * `.elu-election-voir` du `<style>` d'`EluProfileClient` : un style en ligne ne
 * connaît ni `:hover`, ni `:focus-visible`, ni `prefers-reduced-motion`.
 */

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import Depliable from '@/components/ui/Depliable';
import type { ElectionAffichee, LigneElection } from '@/lib/election-affichage';

const TEXTE_CACHE = {
  position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap',
} as const;

/**
 * Une ligne : coche, nom et nuance à gauche, pourcentage à droite, et derrière, un
 * remplissage de la largeur du score. Le remplissage est un élément absolu et non un
 * dégradé en variable CSS, que les pièges Safari connus n'ont pas vérifié ; c'est le
 * principe des barres de vote du fil du mois (`MonthFeedClient`).
 */
function LigneScrutin({ ligne }: { ligne: LigneElection }) {
  return (
    <li style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: '0.75rem', padding: '0.5rem 0.375rem', borderRadius: '0.375rem' }}>
      <span
        aria-hidden
        style={{
          position: 'absolute', top: 0, bottom: 0, left: 0, width: `${ligne.part}%`,
          borderRadius: '0.375rem', pointerEvents: 'none',
          background: ligne.moi ? 'var(--election-fond-moi)' : 'var(--election-fond-autre)',
        }}
      />
      <span aria-hidden style={{ position: 'relative', flex: 'none', width: '1rem', color: 'var(--primary)', fontSize: '0.8125rem', fontWeight: 700 }}>
        {ligne.elu ? '✓' : ''}
      </span>
      <span style={{ position: 'relative', flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '0.875rem', lineHeight: 1.4 }}>
        <span style={{ color: ligne.moi ? 'var(--foreground)' : 'var(--card-foreground)', fontWeight: ligne.moi ? 600 : 400 }}>
          {ligne.nom}
        </span>
        {ligne.srElu && <span style={TEXTE_CACHE}>, {ligne.srElu}</span>}
        {/* Texte courant et non deux blocs flex : le point reste collé au nom, et une
            nuance renvoyée à la ligne ne commence pas par un point. */}
        {(ligne.nuance || ligne.sieges) && (
          <span style={{ fontSize: '0.75rem', color: 'var(--surtitre)' }}>
            {[ligne.nuance, ligne.sieges].filter(Boolean).map((morceau) => (
              <span key={morceau}><span aria-hidden style={{ color: 'var(--muted-foreground)' }}>{' · '}</span>{morceau}</span>
            ))}
          </span>
        )}
      </span>
      <span
        style={{
          position: 'relative', flex: 'none', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
          fontSize: '0.875rem', lineHeight: 1.4,
          color: ligne.moi ? 'var(--foreground)' : 'var(--card-foreground)', fontWeight: ligne.moi ? 600 : 400,
        }}
      >
        {ligne.pct}
      </span>
    </li>
  );
}

/** Les lignes se séparent par un écart de 3 px, pas par un trait : le remplissage touche les bords. */
function ListeLignes({ lignes }: { lignes: LigneElection[] }) {
  return (
    <ol role="list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {lignes.map((l) => <LigneScrutin key={l.cle} ligne={l} />)}
    </ol>
  );
}

const INTERTITRE = { fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.4, color: 'var(--muted-foreground)', margin: '0 0 0.375rem' } as const;

/**
 * `dansLigne` : le bloc est posé sous la ligne « Assemblée nationale » ou « Sénat »
 * de la colonne Mandats (`MandatRow`), d'où l'écart au-dessus. Sans cette ligne (un
 * ancien élu, un ministre), il ouvre la carte, et l'écart au-dessous est celui de
 * l'appelant, qui seul sait si quelque chose suit.
 */
export default function BlocElection({ election, dansLigne }: { election: ElectionAffichee; dansLigne: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const idRepli = useId();
  const marges = dansLigne ? { marginTop: '0.75rem' } : {};

  if (election.sorte === 'phrase') {
    return (
      <p style={{ fontSize: '0.8125rem', lineHeight: 1.45, color: 'var(--card-foreground)', margin: 0, ...marges }}>
        {election.texte}
        {election.lien && (
          <>
            {' '}
            {election.lien.uid ? (
              <Link
                href={`/les-elus/${election.lien.uid}`}
                prefetch={false}
                style={{ color: 'var(--foreground)', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                {election.lien.nom}
              </Link>
            ) : election.lien.nom}
          </>
        )}
      </p>
    );
  }

  // Largeur bornée : sur ordinateur, une ligne de toute la colonne Mandats (ou de
  // toute la carte, pour le bloc qui l'ouvre) laissait le pourcentage loin du nom.
  // Sur mobile, plus étroit, la borne ne joue pas.
  return (
    <div style={{ ...marges, maxWidth: '26rem' }}>
      <p style={INTERTITRE}>{election.intertitre}</p>
      <ListeLignes lignes={election.visibles} />
      {election.replie && (
        <>
          <button
            type="button"
            className="elu-election-voir"
            aria-expanded={ouvert}
            aria-controls={idRepli}
            onClick={() => setOuvert((o) => !o)}
          >
            <ChevronDown size={12} strokeWidth={2.5} aria-hidden />
            <span>{ouvert ? election.replie.fermer : election.replie.ouvrir}</span>
          </button>
          <Depliable id={idRepli} ouvert={ouvert}>
            {election.replie.blocs.map((bloc, i) => (
              <div key={i} style={{ marginTop: bloc.intertitre ? '0.75rem' : 0 }}>
                {bloc.intertitre && <p style={INTERTITRE}>{bloc.intertitre}</p>}
                <ListeLignes lignes={bloc.lignes} />
              </div>
            ))}
            {/* La mention vit dans la partie dépliée : visible sous les deux lignes du
                bloc replié, elle détonnait (D-298). Un bloc sans repli (trois
                entrées ou moins) ne l'affiche donc pas. */}
            <p style={{ fontSize: '0.6875rem', lineHeight: 1.4, color: 'var(--surtitre)', margin: '0.5rem 0 0' }}>{election.replie.mention}</p>
          </Depliable>
        </>
      )}
    </div>
  );
}
