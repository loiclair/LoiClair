'use client';

import { useState, useMemo } from 'react';
import { useLocale } from 'next-intl';
import { Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';

export type ParticipationSearchEntry = {
  uid: string | null;
  nom: string;
  groupe: string | null;
  type: 'depute' | 'senateur';
  anFinal?: { value: number; rank: number; total: number; nbVotes?: number; nbScrutins?: number };
  anSolennel?: { value: number; rank: number; total: number; nbVotes?: number; nbScrutins?: number };
  /** Sans rang : au Sénat, l'écart entre deux taux ne classe personne (voir la page). */
  snFinal?: { value: number; nbVotes?: number; nbScrutins?: number };
};

type Labels = {
  placeholder: string;
  noResult: string;
  rankLabel: string;
  outOfLabel: string;
  deputeLabel: string;
  senateurLabel: string;
  anFinalLabel: string;
  anSolennelLabel: string;
  snFinalLabel: string;
  scrutinsLabel: string;
};

export function ParticipationSearch({
  entries,
  color = '#c2410c',
  labels,
}: {
  entries: ParticipationSearchEntry[];
  color?: string;
  labels: Labels;
}) {
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return entries.filter((e) => e.nom.toLowerCase().includes(q)).slice(0, 5);
  }, [query, entries]);

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
            results.map((entry) => (
              <div key={entry.uid ?? entry.nom} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 mb-2.5">
                  <div className="min-w-0">
                    {entry.uid ? (
                      <Link
                        href={`/les-elus/${entry.uid}`}
                        prefetch={false}
                        className="text-sm font-semibold hover:underline hover:text-primary transition-colors"
                      >
                        {entry.nom}
                      </Link>
                    ) : (
                      <span className="text-sm font-semibold">{entry.nom}</span>
                    )}
                    {entry.groupe && (
                      <p className="text-xs text-muted-foreground truncate">{entry.groupe}</p>
                    )}
                  </div>
                  <span
                    className="text-xs font-medium px-1.5 py-0.5 rounded bg-muted shrink-0"
                    style={{ color }}
                  >
                    {entry.type === 'depute' ? labels.deputeLabel : labels.senateurLabel}
                  </span>
                </div>
                {(entry.anFinal || entry.anSolennel || entry.snFinal) && (
                  <div className="flex flex-wrap gap-2">
                    {entry.anFinal && (
                      <StatBadge
                        label={labels.anFinalLabel}
                        rank={entry.anFinal.rank}
                        total={entry.anFinal.total}
                        value={entry.anFinal.value}
                        nbVotes={entry.anFinal.nbVotes}
                        nbScrutins={entry.anFinal.nbScrutins}
                        rankLabel={labels.rankLabel}
                        outOfLabel={labels.outOfLabel}
                        scrutinsLabel={labels.scrutinsLabel}
                        color={color}
                      />
                    )}
                    {entry.anSolennel && (
                      <StatBadge
                        label={labels.anSolennelLabel}
                        rank={entry.anSolennel.rank}
                        total={entry.anSolennel.total}
                        value={entry.anSolennel.value}
                        nbVotes={entry.anSolennel.nbVotes}
                        nbScrutins={entry.anSolennel.nbScrutins}
                        rankLabel={labels.rankLabel}
                        outOfLabel={labels.outOfLabel}
                        scrutinsLabel={labels.scrutinsLabel}
                        color={color}
                      />
                    )}
                    {entry.snFinal && (
                      <StatBadge
                        label={labels.snFinalLabel}
                        value={entry.snFinal.value}
                        nbVotes={entry.snFinal.nbVotes}
                        nbScrutins={entry.snFinal.nbScrutins}
                        rankLabel={labels.rankLabel}
                        outOfLabel={labels.outOfLabel}
                        scrutinsLabel={labels.scrutinsLabel}
                        color={color}
                      />
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StatBadge({
  label,
  rank,
  total,
  value,
  nbVotes,
  nbScrutins,
  rankLabel,
  outOfLabel,
  scrutinsLabel,
  color,
}: {
  label: string;
  rank?: number;
  total?: number;
  value: number;
  nbVotes?: number;
  nbScrutins?: number;
  rankLabel: string;
  outOfLabel: string;
  scrutinsLabel: string;
  color: string;
}) {
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const locale = useLocale();
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent' });

  return (
    <div className="flex flex-col gap-0.5 bg-muted/40 rounded-md px-2.5 py-2 flex-1 min-w-[140px]">
      <span className="text-xs text-muted-foreground leading-tight">{label}</span>
      <span className="text-xl font-bold tabular-nums leading-tight" style={{ color }}>
        {pourcent.format(value / 100)}
      </span>
      {rank !== undefined && total !== undefined && (
        <span className="text-xs text-muted-foreground">
          {rankLabel} {rank} {outOfLabel} {total}
        </span>
      )}
      {nbVotes !== undefined && nbScrutins !== undefined && (
        <span className="text-xs text-muted-foreground">
          {nbVotes}/{nbScrutins} {scrutinsLabel}
        </span>
      )}
    </div>
  );
}
