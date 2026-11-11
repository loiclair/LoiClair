'use client';

// Recherche d'un élu sur `/Activite` : jusqu'à six fiches résumées (score, rang,
// composantes), ou le motif de l'absence de score. Entrées et libellés viennent
// de `Activite/page.tsx`.

import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatScore } from '@/lib/activite-weights';

export type ActiviteSearchEntry = {
  uid: string;
  nom: string;
  prenom: string;
  chambre: 'AN' | 'SN';
  groupeLabel: string | null;
  score: number | null;
  rank: number | null;
  total: number;
  cpPart: number | null;
  cpDoss: number | null;
  cpCosign: number | null;
  cpRapp: number | null;
  cpRappCtrl: number | null;
  cpAmendAuteur: number | null;
  cpAmendCosign: number | null;
  cpQuestO: number | null;
  cpQuestE: number | null;
  cpPrisesParole: number | null;
  cpCommPres: number | null;
  joursActifs: number;
  // Voir ActiviteRow : le badge « non classé » doit nommer son motif (D-123).
  estPresidentChambre: boolean;
  estPresidentGroupe: boolean;
};

interface Labels {
  placeholder: string;
  noResult: string;
  colScore: string;
  colParticipation: string;
  colInities: string;
  colCosignes: string;
  colRapporteur: string;
  colRappCtrl: string;
  colAmendAuteur: string;
  colAmendCosign: string;
  colQuestO: string;
  colQuestE: string;
  colPrisesParole: string;
  colCommPres: string;
  rankLabel: string;
  outOfLabel: string;
  chambreAN: string;
  chambreSN: string;
  badgeMandatRecent: string;
  badgeMandatRecentTooltip: string;
  badgePresidentChambre: string;
  badgePresidentChambreTooltip: string;
  badgePresidentGroupe: string;
  badgePresidentGroupeTooltip: string;
  joursActifs: string;
  joursActifsTooltip: string;
}

export function ActiviteSearch({
  entries,
  color,
  labels,
}: {
  entries: ActiviteSearchEntry[];
  color: string;
  labels: Labels;
}) {
  const locale = useLocale();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return entries
      .filter((e) => `${e.prenom} ${e.nom}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [query, entries]);

  const components = (e: ActiviteSearchEntry) => [
    { label: labels.colParticipation, value: e.cpPart },
    { label: labels.colInities,       value: e.cpDoss },
    { label: labels.colCosignes,      value: e.cpCosign },
    { label: labels.colRapporteur,    value: e.cpRapp },
    { label: labels.colRappCtrl,      value: e.cpRappCtrl },
    { label: labels.colAmendAuteur,   value: e.cpAmendAuteur },
    { label: labels.colAmendCosign,   value: e.cpAmendCosign },
    { label: labels.colQuestO,        value: e.cpQuestO },
    { label: labels.colQuestE,        value: e.cpQuestE },
    { label: labels.colPrisesParole,  value: e.cpPrisesParole },
    { label: labels.colCommPres,      value: e.cpCommPres },
  ];

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={labels.placeholder}
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 w-full rounded-md border bg-transparent pl-9 pr-3 py-1 text-sm shadow-xs transition-[color,box-shadow] focus-visible:outline-none focus-visible:ring-[3px]"
        />
      </div>

      {query.trim().length >= 2 && (
        <div className="mt-2 border rounded-lg divide-y overflow-hidden bg-card shadow-sm">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{labels.noResult}</p>
          ) : (
            results.map((entry) => {
              const noScore = entry.score === null;
              const badge = entry.estPresidentChambre
                ? labels.badgePresidentChambre
                : entry.estPresidentGroupe ? labels.badgePresidentGroupe : labels.badgeMandatRecent;
              const badgeTooltip = entry.estPresidentChambre
                ? labels.badgePresidentChambreTooltip
                : entry.estPresidentGroupe ? labels.badgePresidentGroupeTooltip : labels.badgeMandatRecentTooltip;
              return (
                <div key={entry.uid} className="px-4 py-3">
                  {/* Header : nom + chambre badge */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/les-elus/${entry.uid}`}
                          prefetch={false}
                          className="text-sm font-semibold hover:underline hover:text-primary transition-colors"
                        >
                          {entry.prenom} {entry.nom}
                        </Link>
                        {noScore && (
                          <span
                            title={badgeTooltip}
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide"
                            style={{ backgroundColor: '#e5e7eb', color: '#374151' }}
                          >
                            {badge}
                          </span>
                        )}
                      </span>
                      {entry.groupeLabel && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{entry.groupeLabel}</p>
                      )}
                    </div>
                    <span
                      className="text-xs font-medium px-2 py-0.5 rounded shrink-0 whitespace-nowrap"
                      style={{
                        backgroundColor: entry.chambre === 'AN' ? '#dbeafe' : '#f3e8ff',
                        color: entry.chambre === 'AN' ? '#1d4ed8' : '#7c3aed',
                      }}
                    >
                      {entry.chambre === 'AN' ? labels.chambreAN : labels.chambreSN}
                    </span>
                  </div>

                  {noScore ? (
                    <p className="text-xs text-muted-foreground mb-3">
                      {/* Le nombre de jours n'éclaire que le motif « mandat trop court » :
                          l'afficher pour un président, de chambre ou de groupe, laisserait
                          croire que c'est la durée du mandat qui le prive de score. */}
                      {badgeTooltip}
                      {!entry.estPresidentChambre && !entry.estPresidentGroupe && ` (${entry.joursActifs} j)`}
                    </p>
                  ) : (
                    <>
                      {/* Score + rang */}
                      <div className="flex items-end gap-4 mb-3 flex-wrap">
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground">{labels.colScore}</span>
                          <span className="text-2xl font-bold tabular-nums leading-tight" style={{ color }}>
                            {entry.score != null && formatScore(entry.score, locale)}
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground">{labels.rankLabel}</span>
                          <span className="text-2xl font-bold tabular-nums leading-tight text-foreground">
                            #{entry.rank}
                            <span className="text-sm font-normal text-muted-foreground ml-1">{labels.outOfLabel}&nbsp;{entry.total}</span>
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground" title={labels.joursActifsTooltip}>
                            {labels.joursActifs}
                          </span>
                          <span className="text-2xl font-bold tabular-nums leading-tight text-muted-foreground">
                            {entry.joursActifs}
                          </span>
                        </div>
                      </div>

                      {/* Composantes */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                        {components(entry).map(({ label, value }) => (
                          <div key={label}>
                            <div className="flex justify-between text-xs mb-0.5">
                              <span className="text-muted-foreground truncate pr-1">{label}</span>
                              <span className="font-medium tabular-nums shrink-0">{value ?? '—'}</span>
                            </div>
                            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{ width: `${value ?? 0}%`, backgroundColor: color }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
