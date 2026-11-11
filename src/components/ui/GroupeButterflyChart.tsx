'use client';

import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export interface ButterflyRow {
  groupe: string;
  /** Valeur de gauche (ex. nombre brut). Toujours affichée. */
  leftValue: number;
  /**
   * Valeur de droite (ex. par membre). Si null, la ligne est masquée à
   * droite avec un tiret — utile pour le Gouvernement qui n'a pas de
   * « taille » parlementaire.
   */
  rightValue: number | null;
  /** Couleur officielle du groupe (ou couleur de repli). */
  color: string;
  /** Taille du groupe, clé de tri de la colonne centrale. */
  membres?: number | null;
  /** Pastille d'origine : « AN », « SN », « Gouv ». */
  chambre?: 'AN' | 'SN' | 'Gouv';
  /** Non-inscrits (D-313) : rangés après tous les groupes, quel que soit le tri de colonne. */
  nonInscrit?: boolean;
}

type SortBy = 'left' | 'middle' | 'right';

interface Props {
  data: ButterflyRow[];
  title: string;
  description: string;
  /** Libellé cliquable de la colonne de gauche (ex. « Nombre absolu »). */
  leftLabel: string;
  /**
   * Libellé cliquable de la colonne centrale (ex. « Taille du groupe »).
   * Si absent, la colonne n'est pas triable et reste vide.
   */
  middleLabel?: string;
  /** Libellé cliquable de la colonne de droite (ex. « Par membre »). */
  rightLabel: string;
  /** Tri initial (défaut : 'left'). */
  defaultSort?: SortBy;
  /** Couleur d'accent pour l'en-tête actif (défaut : teinte de la page). */
  accentColor?: string;
  locale: string;
  /**
   * Infobulle d'un en-tête de colonne, construite à partir de son libellé
   * (ex. « Trier par nombre absolu »). Une fonction plutôt qu'une chaîne : le
   * composant ne connaît pas l'ordre des mots de la langue d'affichage.
   */
  sortTitle: (colonne: string) => string;
  /** Infobulle des trois pastilles d'origine. */
  chambreLabels: Record<'AN' | 'SN' | 'Gouv', string>;
  /** Infobulle de la taille du groupe (ex. « 72 membres »). */
  membresTitle: (count: number) => string;
  /** Nombre de décimales pour la colonne de droite (défaut : 2). */
  rightDecimals?: number;
  note?: string;
  /** Libellé affiché quand rightValue est null (défaut : « — »). */
  rightNullPlaceholder?: string;
}

export function GroupeButterflyChart({
  data,
  title,
  description,
  leftLabel,
  middleLabel,
  rightLabel,
  defaultSort = 'left',
  accentColor = '#7c3aed',
  locale,
  sortTitle,
  chambreLabels,
  membresTitle,
  rightDecimals = 2,
  note,
  rightNullPlaceholder = '—',
}: Props) {
  const [sortBy, setSortBy] = useState<SortBy>(defaultSort);

  const sortedData = useMemo(() => {
    const key = (r: ButterflyRow) => {
      if (sortBy === 'right') return r.rightValue ?? -1;
      if (sortBy === 'middle') return r.membres ?? -1;
      return r.leftValue;
    };
    return [...data].sort((a, b) => Number(a.nonInscrit ?? false) - Number(b.nonInscrit ?? false) || key(b) - key(a));
  }, [data, sortBy]);

  const maxLeft = Math.max(...data.map((d) => d.leftValue), 1);
  const maxRight = Math.max(...data.map((d) => d.rightValue ?? 0), 0.01);

  const formatRight = (v: number) =>
    v.toLocaleString(locale, {
      minimumFractionDigits: rightDecimals,
      maximumFractionDigits: rightDecimals,
    });

  const headerBtn = (
    side: SortBy,
    label: string,
    align: 'left' | 'center' | 'right',
  ) => {
    const active = sortBy === side;
    const alignCls =
      align === 'right' ? 'text-right justify-end' : align === 'left' ? 'text-left justify-start' : 'text-center justify-center';
    const prefix = align === 'right' ? '← ' : '';
    const suffix = align === 'left' ? ' →' : '';
    return (
      <button
        type="button"
        onClick={() => setSortBy(side)}
        className={`flex items-center gap-1 text-[0.65rem] uppercase tracking-wider font-semibold transition-colors cursor-pointer hover:text-foreground ${alignCls}`}
        style={{
          color: active ? accentColor : 'var(--muted-foreground)',
        }}
        title={sortTitle(label.toLowerCase())}
      >
        <span>
          {prefix}
          {label}
          {suffix}
        </span>
        {active && <span aria-hidden="true">↓</span>}
      </button>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {/* En-têtes de colonnes cliquables — un tri par colonne */}
        <div className="grid grid-cols-[1fr_7.5rem_1fr] sm:grid-cols-[1fr_12rem_1fr] gap-2 sm:gap-3 pb-3 border-b mb-3">
          {headerBtn('left', leftLabel, 'right')}
          {middleLabel ? (
            headerBtn('middle', middleLabel, 'center')
          ) : (
            <div className="invisible">.</div>
          )}
          {headerBtn('right', rightLabel, 'left')}
        </div>

        {/* Lignes */}
        <div className="space-y-3">
          {sortedData.map((row, i) => {
            const leftPct = (row.leftValue / maxLeft) * 100;
            const rightPct =
              row.rightValue !== null ? (row.rightValue / maxRight) * 100 : 0;

            return (
              <div
                key={i}
                className="grid grid-cols-[1fr_7.5rem_1fr] sm:grid-cols-[1fr_12rem_1fr] gap-2 sm:gap-3 items-center"
              >
                {/* Barre gauche */}
                <div className="flex items-center justify-end gap-2 h-5">
                  <span className="text-[0.7rem] tabular-nums font-semibold shrink-0">
                    {row.leftValue.toLocaleString(locale)}
                  </span>
                  <div
                    className="h-4 rounded-l"
                    style={{
                      width: `${leftPct}%`,
                      backgroundColor: row.color,
                      minWidth: row.leftValue > 0 ? '2px' : '0',
                    }}
                  />
                </div>

                {/* Libellé du groupe + pastille chambre + taille */}
                <div className="px-1.5 text-[0.7rem] sm:text-[0.75rem] font-medium flex items-center justify-center gap-1.5 overflow-hidden">
                  {row.chambre && (
                    <span
                      className="shrink-0 inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.55rem] font-bold tracking-wide uppercase bg-muted text-muted-foreground"
                      title={chambreLabels[row.chambre]}
                    >
                      {row.chambre}
                    </span>
                  )}
                  <span className="truncate" title={row.groupe}>
                    {row.groupe}
                  </span>
                  {row.membres != null && row.membres > 0 && (
                    <span
                      className="shrink-0 text-[0.65rem] tabular-nums text-muted-foreground"
                      title={membresTitle(row.membres)}
                    >
                      {row.membres.toLocaleString(locale)}
                    </span>
                  )}
                </div>

                {/* Barre droite */}
                <div className="flex items-center justify-start gap-2 h-5">
                  {row.rightValue !== null ? (
                    <>
                      <div
                        className="h-4 rounded-r"
                        style={{
                          width: `${rightPct}%`,
                          backgroundColor: row.color,
                          minWidth: row.rightValue > 0 ? '2px' : '0',
                        }}
                      />
                      <span className="text-[0.7rem] tabular-nums font-semibold shrink-0">
                        {formatRight(row.rightValue)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[0.7rem] tabular-nums text-muted-foreground pl-1">
                      {rightNullPlaceholder}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
      {note && (
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{note}</p>
        </div>
      )}
    </Card>
  );
}
