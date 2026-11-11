'use client';

// Carte « Autres votes sur ce texte » de la page d'un vote, sur le modèle de la carte
// « Ce sujet dans la presse » de la fiche du texte (`ArticleItem` de `ResumeIAClient`) :
// une phrase d'accroche, puis une ligne par vote, fond teinté et titre en couleur au
// survol. Le point coloré tient la place du logo de la source : vert adopté, rouge rejeté.
// Les lignes arrivent prêtes de `page.tsx` (libellés traduits, dates formatées) : ce
// composant n'est client que pour l'état du survol.

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { SCRUTIN_COLORS } from '../../dossiers-legislatifs/[uid]/resume-ia/ScrutinScore';

export type LigneAutreVote = {
  uid: string;
  /** Intitulé officiel du vote, majuscule initiale. */
  intitule: string;
  etape: string | null;
  date: string | null;
  /** Valeur brute (« Adopté », « Rejeté ») pour la couleur du point, et sa traduction. */
  statut: string | null;
  statutLabel: string | null;
};

function Ligne({ v }: { v: LigneAutreVote }) {
  const [survol, setSurvol] = useState(false);
  const couleur = v.statut === 'Adopté' ? SCRUTIN_COLORS.pour : v.statut === 'Rejeté' ? SCRUTIN_COLORS.contre : 'var(--muted-foreground)';
  const meta = [v.etape, v.date].filter((x): x is string => !!x);
  return (
    <Link
      href={`/Scrutins/${v.uid}`}
      prefetch={false}
      className="flex items-start gap-3"
      style={{
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: survol ? 'var(--muted)' : 'transparent',
        transition: 'background-color 0.15s ease',
        WebkitTransition: 'background-color 0.15s ease',
        textDecoration: 'none',
      }}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
    >
      <span className="shrink-0" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: couleur, marginTop: '7px' }} />
      <div className="min-w-0 flex-1">
        <p
          className="text-sm font-medium line-clamp-2 m-0"
          style={{ color: survol ? 'var(--primary)' : 'var(--foreground)', transition: 'color 0.15s ease', WebkitTransition: 'color 0.15s ease' }}
        >
          {v.intitule}
        </p>
        <div className="flex flex-wrap items-center gap-1 mt-1 text-xs text-muted-foreground">
          {meta.map((m, i) => (
            <span key={m} className="inline-flex items-center gap-1">
              {i > 0 && <span style={{ opacity: 0.4 }}>·</span>}
              {m}
            </span>
          ))}
          {v.statutLabel && (
            <>
              {meta.length > 0 && <span style={{ opacity: 0.4 }}>·</span>}
              <span style={{ color: couleur, fontWeight: 600 }}>{v.statutLabel}</span>
            </>
          )}
          <ChevronRight className="h-3 w-3 shrink-0" style={{ opacity: survol ? 0.7 : 0.35, transition: 'opacity 0.15s ease' }} />
        </div>
      </div>
    </Link>
  );
}

export default function AutresVotes({ votes, accroche }: { votes: LigneAutreVote[]; accroche: string }) {
  return (
    <div className="rounded-xl" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--card)', padding: '20px' }}>
      <div className="text-sm text-muted-foreground mb-4">{accroche}</div>
      <div className="space-y-1">
        {votes.map((v) => <Ligne key={v.uid} v={v} />)}
      </div>
    </div>
  );
}
