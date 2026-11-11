'use client';

import { useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { GroupeScatterChart } from '@/components/ui/GroupeScatterChart';
import { GroupeButterflyChart, type ButterflyRow } from '@/components/ui/GroupeButterflyChart';

export interface GroupeStatSerialized {
  key: string;
  libelle: string;
  libelleAbrege: string;
  color: string;
  chambre: 'AN' | 'SN' | 'GOUV';
  taille: number | null;
  /** Non-inscrits (D-313) : une barre dans les graphiques, mais pas un groupe classé par membre. */
  nonInscrit: boolean;
  nbInities: number;
  nbAdoptes: number;
  nbPromulges: number;
}

type Filter = 'AN' | 'SN';

const COLOR = '#ca8a04';

interface Props {
  stats: GroupeStatSerialized[];
  /**
   * Textes dont l'auteur n'a pas de groupe en base, par étape : absents des
   * graphiques par groupe, comptés dans la réponse, annoncés dans chaque légende.
   */
  sansGroupe: { nbInities: number; nbAdoptes: number; nbPromulges: number };
}

export function SuccesLegislatifCharts({ stats, sansGroupe }: Props) {
  const t = useTranslations('answerSuccesLegislatif');
  const locale = useLocale();
  const [filter, setFilter] = useState<Filter>('AN');

  // Les trois papillons partagent le même vocabulaire d'infobulles ; le
  // composant générique ne le connaît pas et le reçoit en props.
  const butterflyLabels = {
    sortTitle: (colonne: string) => t('butterflySortTitle', { colonne }),
    chambreLabels: {
      AN: t('butterflyChambreAN'),
      SN: t('butterflyChambreSN'),
      Gouv: t('butterflyChambreGouv'),
    },
    membresTitle: (count: number) => t('butterflyMembresTitle', { count }),
  };

  // Gouvernement est un point de repère pertinent pour les deux chambres :
  // on l'inclut dans chaque vue (mais toujours sans « par membre »).
  const filteredStats = useMemo(() => {
    return stats.filter((s) => s.chambre === filter || s.chambre === 'GOUV');
  }, [stats, filter]);

  // La légende d'un graphique, suivie du nombre de textes sans groupe qui n'y
  // figurent pas, quand il y en a.
  const note = (base: string, absents: number) =>
    absents > 0 ? `${base} ${t('butterflySansGroupeNote', { count: absents })}` : base;

  // Exemple pédagogique : on prend le top « absolu » et le top « par membre »
  // parmi les groupes parlementaires (hors Gouvernement et non-inscrits, comme la
  // réponse de la page) ayant au moins une loi promulguée. Si le même groupe domine les deux classements, on n'affiche
  // qu'un seul exemple.
  const example = useMemo(() => {
    const withPromulg = filteredStats.filter(
      (s) => s.chambre !== 'GOUV' && !s.nonInscrit && s.taille && s.taille > 0 && s.nbPromulges > 0,
    );
    if (withPromulg.length === 0) return null;

    const byAbs = [...withPromulg].sort((a, b) => b.nbPromulges - a.nbPromulges);
    const byPer = [...withPromulg].sort(
      (a, b) =>
        b.nbPromulges / (b.taille as number) - a.nbPromulges / (a.taille as number),
    );
    const big = byAbs[0];
    const top = byPer[0];

    const fmt = (n: number) => n.toLocaleString(locale);
    const fmtPer = (s: GroupeStatSerialized) =>
      (s.nbPromulges / (s.taille as number)).toLocaleString(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    return {
      sameGroup: big.key === top.key,
      big: {
        name: big.libelle,
        size: fmt(big.taille as number),
        abs: fmt(big.nbPromulges),
        per: fmtPer(big),
      },
      top: {
        name: top.libelle,
        size: fmt(top.taille as number),
        abs: fmt(top.nbPromulges),
        per: fmtPer(top),
      },
    };
  }, [filteredStats, locale]);

  const { scatterData, rowsDepot, rowsAdoption, rowsPromulg } = useMemo(() => {
    const parMembre = (n: number, taille: number | null): number | null =>
      taille && taille > 0 ? Math.round((n / taille) * 100) / 100 : null;

    const toRow = (s: GroupeStatSerialized, value: number): ButterflyRow => ({
      groupe: s.libelle,
      leftValue: value,
      rightValue: parMembre(value, s.taille),
      // Gris pour les non-inscrits : ce n'est pas un groupe politique (D-313).
      color: s.nonInscrit ? '#94a3b8' : s.color,
      nonInscrit: s.nonInscrit,
      membres: s.taille,
      chambre: s.chambre === 'GOUV' ? 'Gouv' : s.chambre,
    });

    // Le tri est désormais géré par chaque butterfly individuellement —
    // on passe les données non triées, la carte trie selon la colonne
    // cliquée par le lecteur.
    return {
      // Scatter : tous les groupes parlementaires de la chambre sélectionnée,
      // y compris ceux à 0 loi. L'abréviation affichée dans chaque bulle
      // permet de les distinguer même quand ils s'empilent sur l'axe X.
      scatterData: filteredStats
        .filter((s) => s.chambre !== 'GOUV' && !s.nonInscrit && s.taille && s.taille > 0)
        .map((s) => ({
          groupe: s.libelle,
          abbr: s.libelleAbrege,
          taille: s.taille as number,
          valeur: s.nbPromulges,
          poids: s.nbInities,
          color: s.color,
        })),
      rowsDepot: filteredStats.map((s) => toRow(s, s.nbInities)),
      rowsAdoption: filteredStats.map((s) => toRow(s, s.nbAdoptes)),
      rowsPromulg: filteredStats.map((s) => toRow(s, s.nbPromulges)),
    };
  }, [filteredStats]);

  const filterButtons: { key: Filter; label: string }[] = [
    { key: 'AN', label: t('filterAN') },
    { key: 'SN', label: t('filterSN') },
  ];

  const pillBtn = (active: boolean, onClick: () => void, label: string, key: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors"
      style={{
        backgroundColor: active ? COLOR : 'transparent',
        color: active ? '#fff' : 'var(--muted-foreground)',
        borderColor: active ? COLOR : 'var(--border)',
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      {/* Filtre chambre — affecte scatter et butterflies */}
      <div className="flex flex-wrap items-center gap-2 mb-6">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mr-1">
          {t('filterLabel')}
        </span>
        {filterButtons.map(({ key, label }) =>
          pillBtn(filter === key, () => setFilter(key), label, `f-${key}`),
        )}
      </div>

      {/* Scatter hero */}
      {scatterData.length > 0 && (
        <div className="mb-12">
          <GroupeScatterChart
            data={scatterData}
            title={t('scatterTitle')}
            description={t('scatterDesc')}
            xLabel={t('scatterXLabel')}
            yLabel={t('scatterYLabel')}
            poidsLabel={t('scatterPoidsLabel')}
            note={t('scatterNote')}
          />
        </div>
      )}

      {/* ② EN CHIFFRES */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-6" style={{ color: COLOR }}>
        {t('sectionInNumbers')}
      </h2>

      {/* Encart pédagogique — comment lire les graphes papillon */}
      <div className="rounded-lg border bg-muted/40 p-4 sm:p-5 mb-6">
        <h3 className="text-sm font-semibold mb-2" style={{ color: COLOR }}>
          {t('howToReadTitle')}
        </h3>
        <p className="text-sm text-foreground/80 leading-relaxed">
          {t('howToReadLead')}
        </p>
        {example && (
          <p className="text-sm text-foreground/80 leading-relaxed mt-3">
            {example.sameGroup
              ? t.rich('howToReadExampleSingle', {
                  name: example.top.name,
                  size: example.top.size,
                  abs: example.top.abs,
                  per: example.top.per,
                  hl: (chunks) => (
                    <span
                      className="font-bold"
                      style={{
                        backgroundColor: `${COLOR}20`,
                        color: COLOR,
                        padding: '0.05em 0.3em',
                        borderRadius: '0.2em',
                      }}
                    >
                      {chunks}
                    </span>
                  ),
                })
              : t.rich('howToReadExampleBoth', {
                  bigName: example.big.name,
                  bigSize: example.big.size,
                  bigAbs: example.big.abs,
                  bigPer: example.big.per,
                  topName: example.top.name,
                  topSize: example.top.size,
                  topAbs: example.top.abs,
                  topPer: example.top.per,
                  hl: (chunks) => (
                    <span
                      className="font-bold"
                      style={{
                        backgroundColor: `${COLOR}20`,
                        color: COLOR,
                        padding: '0.05em 0.3em',
                        borderRadius: '0.2em',
                      }}
                    >
                      {chunks}
                    </span>
                  ),
                })}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 mb-16">
        <GroupeButterflyChart
          data={rowsDepot}
          title={t('butterflyDepotTitle')}
          description={t('butterflyDepotDesc')}
          leftLabel={t('butterflyDepotLeft')}
          middleLabel={t('butterflyMiddleLabel')}
          rightLabel={t('butterflyDepotRight')}
          accentColor={COLOR}
          locale={locale}
          {...butterflyLabels}
          note={note(t('butterflyDepotNote'), sansGroupe.nbInities)}        />
        <GroupeButterflyChart
          data={rowsAdoption}
          title={t('butterflyAdoptionTitle')}
          description={t('butterflyAdoptionDesc')}
          leftLabel={t('butterflyAdoptionLeft')}
          middleLabel={t('butterflyMiddleLabel')}
          rightLabel={t('butterflyAdoptionRight')}
          accentColor={COLOR}
          locale={locale}
          {...butterflyLabels}
          note={note(t('butterflyAdoptionNote'), sansGroupe.nbAdoptes)}        />
        <GroupeButterflyChart
          data={rowsPromulg}
          title={t('butterflyPromulgTitle')}
          description={t('butterflyPromulgDesc')}
          leftLabel={t('butterflyPromulgLeft')}
          middleLabel={t('butterflyMiddleLabel')}
          rightLabel={t('butterflyPromulgRight')}
          accentColor={COLOR}
          locale={locale}
          {...butterflyLabels}
          note={note(t('butterflyPromulgNote'), sansGroupe.nbPromulges)}        />
      </div>
    </>
  );
}
