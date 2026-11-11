'use client';

// Ce que contient chaque mesure du score d'activité : un tableau de onze lignes, où
// chacune se déplie sur cinq champs — ce que c'est, la source, la fenêtre, ce qui compte,
// ce qui ne compte pas.
//
// Les textes vivent dans `answerActivite.mesures.<MetricKey>` : un seul endroit à
// corriger quand une fenêtre bouge ou qu'une exclusion change.
//
// Le détail de chaque mesure reste **monté** quand la ligne est repliée, seulement réduit
// à une hauteur nulle. C'est ce qui fait marcher l'ancre `#mesure-<clé>` que vise le
// tiroir d'une fiche élu : le navigateur trouve toujours sa cible, sans qu'aucun code
// n'ait à l'attendre. Le texte reste par ailleurs lisible par un moteur de recherche.
//
// Une seule mesure ouverte à la fois : la comparaison entre mesures se fait sur le
// tableau, qui garde le poids des onze sous les yeux.

import { createContext, useContext, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import Depliable from '@/components/ui/Depliable';
import { ACTIVITE_FUNCTIONS, ACTIVITE_WEIGHTS, type FonctionKey, type MetricKey } from '@/lib/activite-weights';

/** Ordre d'affichage : celui des quatre fonctions, puis celui des métriques dans chacune. */
const FONCTION_ORDER: FonctionKey[] = ['legiferer', 'deliberer', 'controler', 'commission'];

export function ancreMesure(metric: MetricKey): string {
  return `mesure-${metric}`;
}

export function mesuresDansLOrdre(): { metric: MetricKey; fonction: FonctionKey }[] {
  return FONCTION_ORDER.flatMap((fonction) =>
    ACTIVITE_FUNCTIONS[fonction].metrics.map((metric) => ({ metric, fonction })),
  );
}

/**
 * La mesure dépliée, tenue par un composant qui survit au repliage du volet.
 *
 * Ce tableau vit dans un `AccordionContent`, dont Radix démonte le contenu dès qu'on le
 * replie. Un état local repartirait donc de zéro à chaque réouverture, et la lecture du
 * hash rouvrirait la mesure que l'URL désigne encore — c'était le cas jusqu'ici.
 * Sans fournisseur, le tableau retombe sur un état local : il reste utilisable seul.
 */
export const MesuresContext = createContext<{
  ouverte: MetricKey | null;
  setOuverte: (metric: MetricKey | null) => void;
} | null>(null);

/**
 * Les cinq champs d'une mesure. La définition vient en premier : c'est elle qui rend la
 * fiche lisible sans connaître le Parlement, les quatre autres disent d'où vient le
 * chiffre et ce qu'il laisse dehors.
 */
export function MesureFiche({ metric }: { metric: MetricKey }) {
  const t = useTranslations('answerActivite');
  const champs = ['quoi', 'source', 'fenetre', 'compte', 'exclut'] as const;

  return (
    <dl className="grid gap-x-4 gap-y-1.5" style={{ gridTemplateColumns: 'max-content 1fr' }}>
      {champs.map((champ) => (
        <div key={champ} className="contents">
          <dt
            className="text-muted-foreground"
            style={{ fontSize: '12px', lineHeight: 1.6, whiteSpace: 'nowrap' }}
          >
            {t(`mesureLabels.${champ}` as Parameters<typeof t>[0])}
          </dt>
          <dd style={{ fontSize: '13px', lineHeight: 1.6 }}>
            {t(`mesures.${metric}.${champ}` as Parameters<typeof t>[0])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Le tableau : une ligne par mesure, dépliable sur sa fiche. */
export function MesuresRecap({ accentColor }: { accentColor: string }) {
  const t = useTranslations('answerActivite');
  const tm = useTranslations('elus.activite.metrics');
  const tf = useTranslations('elus.activite.fonctions');
  const locale = useLocale();
  const partage = useContext(MesuresContext);
  const local = useState<MetricKey | null>(null);
  const [ouverte, setOuverte] = partage ? [partage.ouverte, partage.setOuverte] : local;

  return (
    <div>
      <p className="text-muted-foreground mb-4" style={{ fontSize: '13px', lineHeight: 1.6 }}>
        {t('mesureLabels.recapDesc')}
      </p>
      {/* Le conteneur défile si une traduction allonge les colonnes, sans jamais faire
          défiler la page entière. Le détail, lui, s'étale sur toute la largeur. */}
      <div style={{ overflowX: 'auto' }}>
        <table className="w-full border-collapse" style={{ fontSize: '13px' }}>
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
              {(['colMesure', 'colFonction', 'colPoids'] as const).map((col, i) => (
                <th
                  key={col}
                  className="text-muted-foreground font-normal py-2 pr-4"
                  style={{
                    fontSize: '11px',
                    textTransform: 'uppercase',
                    letterSpacing: '.08em',
                    textAlign: i === 2 ? 'right' : 'left',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t(`mesureLabels.${col}` as Parameters<typeof t>[0])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {mesuresDansLOrdre().map(({ metric, fonction }) => {
              const estOuverte = ouverte === metric;
              const idDetail = `${ancreMesure(metric)}-detail`;
              return [
                <tr
                  key={metric}
                  id={ancreMesure(metric)}
                  className="border-b scroll-mt-24"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => setOuverte(estOuverte ? null : metric)}
                      aria-expanded={estOuverte}
                      aria-controls={idDetail}
                      className="inline-flex items-center gap-1.5 hover:underline text-left"
                      style={{ color: accentColor }}
                    >
                      {tm(metric)}
                      <ChevronDown
                        size={13}
                        aria-hidden
                        style={{
                          transition: 'transform .2s ease',
                          transform: estOuverte ? 'rotate(180deg)' : 'none',
                          flexShrink: 0,
                        }}
                      />
                    </button>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{tf(fonction)}</td>
                  <td className="py-2 tabular-nums" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    ×{ACTIVITE_WEIGHTS[metric].toLocaleString(locale)}
                  </td>
                </tr>,
                // Toujours rendue, jamais `hidden` : c'est ce qui permet d'animer sa
                // hauteur, que `Depliable` réduit à zéro pixel une fois repliée. Pas de
                // bordure ici : celle de la ligne principale suffit, deux traits se
                // verraient une fois replié.
                <tr key={idDetail}>
                  <td colSpan={3} style={{ padding: 0 }}>
                    <Depliable id={idDetail} ouvert={estOuverte}>
                      <div style={{ paddingTop: '.25rem', paddingBottom: '1rem' }}>
                        <MesureFiche metric={metric} />
                      </div>
                    </Depliable>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
