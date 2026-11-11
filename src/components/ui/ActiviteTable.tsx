'use client';

// Tableau du classement d'activité de `/Activite` : filtre par chambre, vue par
// score global ou par fonction, tooltip des composantes. Lignes et libellés
// viennent de `Activite/page.tsx`, qui lit `activite_elus_mv`.

import { useState, useMemo } from 'react';
import { useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowUpDown, ArrowUp, ArrowDown, Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ACTIVITE_FUNCTIONS, ACTIVITE_WEIGHTS, formatPoids, formatScore, type FonctionKey, type MetricKey } from '@/lib/activite-weights';

export type ActiviteRow = {
  uid: string;
  prenom: string;
  nom: string;
  groupe: string | null;
  groupeLabel: string | null;
  chambre: 'AN' | 'SN';
  rang: number | null;
  taux_participation_votes_finaux: number | null;
  nb_dossiers_inities: number;
  nb_textes_cosignes: number;
  nb_rapporteur: number;
  nb_rapports_controle: number;
  nb_amendements_auteur: number;
  nb_amendements_cosignataire: number;
  nb_questions_orales: number;
  nb_questions_ecrites: number;
  nb_prises_parole: number;
  nb_commission_presences: number | null;
  score: number | null;
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
  // Sous-score et rang de chaque fonction, calculés par la vue (même convention
  // `RANK()` que `rang`, D-029) ; null hors classement.
  sousScores: Record<FonctionKey, number | null>;
  rangsFonctions: Record<FonctionKey, number | null>;
  // Trois motifs mènent à un score NULL, et le badge doit dire lequel : mandat de
  // moins de 180 jours, présidence de la chambre (D-123), présidence d'un groupe.
  estPresidentChambre: boolean;
  estPresidentGroupe: boolean;
};

type SortKey = 'rang' | 'score' | 'nom' | 'groupe';
type ChambreFilter = 'AN' | 'SN';
type ViewMode = 'score' | FonctionKey;

interface ActiviteTableProps {
  rows: ActiviteRow[];
  color: string;
  labels: {
    tableTitle: string;
    tableDesc: string;
    tableNote: string;
    tableCount: string; // template "{count} parlementaires affichés"
    tableCountWithMinisters: string; // template "{count} affichés ({excluded} ministre{plural} ...)"
    tableCountRanked: string; // template "{ranked} classés, {unranked} sans score (motifs)"
    ministersExcludedAN: number;
    ministersExcludedSN: number;
    colRangTooltip: string;
    filterAN: string;
    filterSN: string;
    joursActifs: string;
    joursActifsTooltip: string;
    badgeNonClasse: string;
    badgeNonClasseTooltip: string;
    badgePresidentChambre: string;
    badgePresidentChambreTooltip: string;
    badgePresidentGroupe: string;
    badgePresidentGroupeTooltip: string;
    colRang: string;
    colNom: string;
    colScore: string;
    colGroupe: string;
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
    viewLabelPrefix: string;
    viewScoreGlobal: string;
    fonctionLabelLegiferer: string;
    fonctionLabelDeliberer: string;
    fonctionLabelControler: string;
    fonctionLabelCommission: string;
    tooltipComposantes: string;
  };
}

function PillButton({ active, color, onClick, children }: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
      style={{
        backgroundColor: active ? color : hovered ? `${color}18` : 'transparent',
        color: active ? '#fff' : hovered ? color : 'var(--muted-foreground)',
        borderColor: active || hovered ? color : 'var(--border)',
      }}
    >
      {children}
    </button>
  );
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc' }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />;
}

const FONCTION_ORDER: FonctionKey[] = ['legiferer', 'deliberer', 'controler', 'commission'];


const WIDTH_CLASS_FOR: Record<'rang' | 'nom' | 'score', string> = {
  rang: 'w-14 sm:w-[9%]',
  nom: 'sm:w-[50%]',
  score: 'w-14 sm:w-[10%]',
};

/** Un élu sans score garde sa ligne, en fin de classement, avec un badge qui
 *  nomme le motif ; le tri et le compte des classés en tiennent compte. */
export function ActiviteTable({ rows, color, labels }: ActiviteTableProps) {
  const locale = useLocale();
  const fonctionLabels: Record<FonctionKey, string> = {
    legiferer: labels.fonctionLabelLegiferer,
    deliberer: labels.fonctionLabelDeliberer,
    controler: labels.fonctionLabelControler,
    commission: labels.fonctionLabelCommission,
  };

  // Même ordre que `FONCTION_ORDER`, qui gouverne le tooltip juste en dessous et les
  // quatre barres de la fiche élu : les pills l'inversaient, et lire « Contrôler » en
  // troisième ici et en quatrième là-bas ne s'explique par rien.
  const viewPills: { key: ViewMode; label: string }[] = [
    { key: 'score',      label: labels.viewScoreGlobal },
    { key: 'legiferer',  label: fonctionLabels.legiferer },
    { key: 'deliberer',  label: fonctionLabels.deliberer },
    { key: 'controler',  label: fonctionLabels.controler },
    { key: 'commission', label: fonctionLabels.commission },
  ];

  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [chambreFilter, setChambreFilter] = useState<ChambreFilter>('AN');
  const [viewMode, setViewMode] = useState<ViewMode>('score');

  const filtered = useMemo(
    () => rows.filter((r) => r.chambre === chambreFilter),
    [rows, chambreFilter],
  );

  const displayScores = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const row of filtered) {
      map.set(row.uid, viewMode === 'score' ? row.score : row.sousScores[viewMode]);
    }
    return map;
  }, [filtered, viewMode]);

  // Total des élus classés dans la chambre — pour l'affichage « #X / N ».
  const classes = useMemo(
    () => filtered.filter((r) => (displayScores.get(r.uid) ?? null) !== null),
    [filtered, displayScores],
  );

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const da = displayScores.get(a.uid) ?? null;
      const db = displayScores.get(b.uid) ?? null;
      if ((sortKey === 'rang' || sortKey === 'score') && (da === null) !== (db === null)) {
        return da === null ? 1 : -1;
      }
      // Entre deux non-classés, les présidents (de chambre ou de groupe) ferment la
      // marche : leur cas dure autant que la fonction, là où un mandat trop récent
      // rejoindra le classement dans quelques mois (D-123).
      const presideA = a.estPresidentChambre || a.estPresidentGroupe;
      const presideB = b.estPresidentChambre || b.estPresidentGroupe;
      if ((sortKey === 'rang' || sortKey === 'score') && da === null && db === null
          && presideA !== presideB) {
        return presideA ? 1 : -1;
      }
      if (sortKey === 'nom') {
        const cmp = `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr');
        return sortDir === 'asc' ? cmp : -cmp;
      }
      if (sortKey === 'groupe') {
        const ga = a.groupeLabel ?? '';
        const gb = b.groupeLabel ?? '';
        const cmp = ga.localeCompare(gb, 'fr');
        if (cmp !== 0) return sortDir === 'asc' ? cmp : -cmp;
        return (db ?? 0) - (da ?? 0);
      }
      if (sortKey === 'rang') {
        if (viewMode === 'score') {
          const ra = a.rang ?? 999999;
          const rb = b.rang ?? 999999;
          return ra - rb;
        }
        return (db ?? 0) - (da ?? 0);
      }
      // score
      return sortDir === 'desc' ? (db ?? 0) - (da ?? 0) : (da ?? 0) - (db ?? 0);
    });
  }, [filtered, sortKey, sortDir, displayScores, viewMode]);

  const handleViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    setSortKey('score');
    setSortDir('desc');
  };

  const handleSort = (key: SortKey) => {
    if (key === 'rang') return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // Largeurs serrées en mobile (table-fixed) pour éviter le scroll horizontal.
  // Le header Groupe est rendu directement (pas via TH) et n'apparaît qu'à partir de sm.
  const renderTH = (col: 'rang' | 'nom' | 'score', children: React.ReactNode) => (
    <th
      className={`px-2 sm:px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap select-none ${WIDTH_CLASS_FOR[col]} ${col !== 'rang' ? 'cursor-pointer hover:text-foreground' : ''}`}
      onClick={() => handleSort(col)}
    >
      {col === 'rang' ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 cursor-help">
              {children}
              <Info className="h-3 w-3 opacity-60" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{labels.colRangTooltip}</p>
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="inline-flex items-center gap-1">
          {children}
          <SortIcon col={col} sortKey={sortKey} sortDir={sortDir} />
        </span>
      )}
    </th>
  );

  const filterButtons: { key: ChambreFilter; label: string }[] = [
    { key: 'AN', label: labels.filterAN },
    { key: 'SN', label: labels.filterSN },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.tableTitle}</CardTitle>
        <CardDescription>{labels.tableDesc}</CardDescription>
        <div className="flex gap-2 mt-3 flex-wrap">
          {filterButtons.map(({ key, label }) => (
            <PillButton key={key} active={chambreFilter === key} color={color} onClick={() => setChambreFilter(key)}>
              {label}
            </PillButton>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">{labels.viewLabelPrefix}</span>
          {viewPills.map(({ key, label }) => (
            <PillButton key={key} active={viewMode === key} color={color} onClick={() => handleViewMode(key)}>
              {label}
            </PillButton>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {/* Scrollable container — sticky thead, ~16 rows visible */}
        <div style={{ maxHeight: '640px', overflowY: 'auto', overflowX: 'hidden' }}>
          <table className="w-full text-sm table-fixed sm:table-auto">
            <thead className="border-b border-border bg-card" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr>
                {renderTH('rang', labels.colRang)}
                {renderTH('score', labels.colScore)}
                {renderTH('nom', labels.colNom)}
                {/* Groupe — visible dès sm, triable */}
                <th
                  className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap hidden sm:table-cell sm:w-[31%] cursor-pointer hover:text-foreground select-none"
                  onClick={() => handleSort('groupe')}
                >
                  <span className="inline-flex items-center gap-1">
                    {labels.colGroupe}
                    <SortIcon col="groupe" sortKey={sortKey} sortDir={sortDir} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((row) => {
                const displayScore = displayScores.get(row.uid) ?? null;
                const rang = viewMode === 'score' ? row.rang : row.rangsFonctions[viewMode];
                const isUnranked = displayScore === null;
                return (
                  <tr key={row.uid} className="hover:bg-muted/40 transition-colors">
                    <td className="px-2 sm:px-3 py-2 tabular-nums text-xs text-muted-foreground">
                      {isUnranked
                        ? <span className="opacity-50">—</span>
                        : <>#{rang}<span className="opacity-50 hidden sm:inline">/{classes.length}</span></>}
                    </td>
                    {/* Score avec tooltip des composantes */}
                    <td className="px-2 sm:px-3 py-2">
                      {isUnranked ? (
                        <span className="tabular-nums text-sm text-muted-foreground">—</span>
                      ) : (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="tabular-nums font-semibold text-sm cursor-help underline decoration-dotted"
                              style={{ color }}
                            >
                              {displayScore != null && formatScore(displayScore, locale)}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="w-64 p-3">
                            <p className="text-xs font-semibold mb-2 text-foreground">{labels.tooltipComposantes}</p>
                            <div className="space-y-3">
                              {(() => {
                                const metricLabels: Record<MetricKey, string> = {
                                  cpPart: labels.colParticipation,
                                  cpDoss: labels.colInities,
                                  cpCosign: labels.colCosignes,
                                  cpRapp: labels.colRapporteur,
                                  cpRappCtrl: labels.colRappCtrl,
                                  cpAmendAuteur: labels.colAmendAuteur,
                                  cpAmendCosign: labels.colAmendCosign,
                                  cpQuestO: labels.colQuestO,
                                  cpQuestE: labels.colQuestE,
                                  cpPrisesParole: labels.colPrisesParole,
                                  cpCommPres: labels.colCommPres,
                                };
                                const metricValues: Record<MetricKey, number | null> = {
                                  cpPart: row.cpPart,
                                  cpDoss: row.cpDoss,
                                  cpCosign: row.cpCosign,
                                  cpRapp: row.cpRapp,
                                  cpRappCtrl: row.cpRappCtrl,
                                  cpAmendAuteur: row.cpAmendAuteur,
                                  cpAmendCosign: row.cpAmendCosign,
                                  cpQuestO: row.cpQuestO,
                                  cpQuestE: row.cpQuestE,
                                  cpPrisesParole: row.cpPrisesParole,
                                  cpCommPres: row.cpCommPres,
                                };
                                return FONCTION_ORDER.map((fk) => {
                                  const f = ACTIVITE_FUNCTIONS[fk];
                                  return (
                                    <div key={fk}>
                                      <div className="flex items-baseline justify-between gap-2 mb-1.5">
                                        <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>{fonctionLabels[fk]}</span>
                                        <span className="text-[10px] text-muted-foreground tabular-nums">{f.percent}&nbsp;%</span>
                                      </div>
                                      <div className="space-y-1.5">
                                        {f.metrics.map((m) => {
                                          const w = ACTIVITE_WEIGHTS[m];
                                          const value = metricValues[m];
                                          return (
                                            <div key={m}>
                                              <div className="flex items-baseline text-xs gap-1.5 mb-0.5">
                                                <span className="text-muted-foreground truncate min-w-0">{metricLabels[m]}</span>
                                                {w !== 1 && (
                                                  <span className="text-[10px] font-semibold text-foreground/70 tabular-nums shrink-0 px-1 rounded bg-muted/40">×&nbsp;{formatPoids(w, locale)}</span>
                                                )}
                                                <span className="font-medium tabular-nums shrink-0 ml-auto pl-1">{value ?? '—'}</span>
                                              </div>
                                              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                                                <div className="h-full rounded-full" style={{ width: `${value ?? 0}%`, backgroundColor: color }} />
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                });
                              })()}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </td>
                    <td className="px-2 sm:px-3 py-2 font-medium min-w-0">
                      <span className="inline-flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/les-elus/${row.uid}`}
                          prefetch={false}
                          className="hover:underline transition-colors leading-tight break-words"
                          style={{ color: 'inherit' }}
                        >
                          {row.prenom} {row.nom}
                        </Link>
                        {viewMode === 'score' && row.score === null && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide cursor-help"
                                style={{ backgroundColor: '#e5e7eb', color: '#374151' }}
                              >
                                {row.estPresidentChambre
                                  ? labels.badgePresidentChambre
                                  : row.estPresidentGroupe ? labels.badgePresidentGroupe : labels.badgeNonClasse}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              <p>
                                {row.estPresidentChambre
                                  ? labels.badgePresidentChambreTooltip
                                  : row.estPresidentGroupe ? labels.badgePresidentGroupeTooltip : labels.badgeNonClasseTooltip}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </span>
                    </td>
                    {/* Groupe visible dès sm */}
                    <td className="hidden sm:table-cell px-3 py-2 text-xs text-muted-foreground">
                      <span className="block truncate">{row.groupeLabel ?? '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Trois effectifs différents cohabitent sur cette page : l'effectif légal de la
            chambre, le nombre de lignes du tableau (moins les ministres en fonction) et
            le nombre d'élus classés, qui est le dénominateur des rangs. Sans cette ligne,
            un « #554 / 554 » à côté d'un badge « (577) » se lit comme une erreur. */}
        <div className="px-4 py-3 border-t text-xs text-muted-foreground">
          {(() => {
            const excluded = chambreFilter === 'AN' ? labels.ministersExcludedAN : labels.ministersExcludedSN;
            const base = excluded > 0
              ? labels.tableCountWithMinisters
                  .replace('{count}', String(filtered.length))
                  .replace('{excluded}', String(excluded))
                  .replace(/\{plural\}/g, excluded > 1 ? 's' : '')
              : labels.tableCount.replace('{count}', String(filtered.length));
            const nonClasses = filtered.length - classes.length;
            if (nonClasses <= 0) return base;
            return `${base} ${labels.tableCountRanked
              .replace('{ranked}', String(classes.length))
              .replace('{unranked}', String(nonClasses))}`;
          })()}
        </div>
      </CardContent>
      {labels.tableNote && (
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{labels.tableNote}</p>
        </div>
      )}
    </Card>
  );
}
