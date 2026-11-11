'use client';

// Liste de /dossiers-legislatifs : rangée de filtres, en-tête de résultats et
// lignes. Tout se calcule dans le navigateur à partir de l'index des dossiers,
// les filtres et la requête étant lus dans le hash. `page.tsx` ne fournit que
// les valeurs possibles de chaque filtre (`filterLabels`).

import { useEffect, useState, useRef, useCallback, useMemo, Fragment } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { chargerIndexDossiers, filterDossiers, relancerIndexDossiers, type DossierIndex, type DossierMeta } from '@/lib/search/dossier-index';
import { searchDossiers } from '@/lib/search/search-dossiers';
import { useHashQuery } from '@/lib/search/use-hash-query';
import { lireListe, useHashFilter, useHashParams, readHashParams, writeHashParam } from '@/lib/search/use-hash-filter';
import { acteLabelKey } from '@/lib/legislative-steps';
import { statutBulletColor, translateStatut } from '@/lib/statut';
import { useLoadMoreWithRestore } from '@/hooks/useLoadMoreWithRestore';
import DossierCard from '@/components/DossierCard';
import LoadMoreButton from '@/components/LoadMoreButton';
import FilterBar, { type FilterBarFacet } from '@/components/ui/FilterBar';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { AIBadge } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import { titreDossier } from '@/lib/titre-dossier';
import { PROCEDURE_KEY } from '@/lib/facts-shared';
import { formateurDate } from '@/lib/jour-paris';

const MAX_SEARCH_RESULTS = 1000;

type Tri = 'pertinence' | 'depot' | 'activite';

/**
 * Tri effectif à partir de `#tri` et de `#q`. `#tri` vide vaut l'ordre par
 * défaut : pertinence pendant une recherche, dernière activité sinon. Lu au rendu
 * et au chargement de l'index, qui doivent s'accorder sur la recherche à lancer.
 */
function lireTri(triBrut: string | null, q: string | null): Tri {
  if (triBrut === 'activite' || triBrut === 'depot') return triBrut;
  return q ? 'pertinence' : 'activite';
}

/**
 * Plafond de résultats d'une recherche. Il ne coupe que les moins pertinents en
 * tri par pertinence ; en tri par date, il couperait au hasard de la pertinence
 * des dossiers récents qui devraient venir en tête, d'où aucun plafond.
 */
function limiteRecherche(exact: boolean): number {
  return exact ? Infinity : MAX_SEARCH_RESULTS;
}

/** Clés du hash portées par la rangée de filtres, dans l'ordre d'affichage. */
const FACET_KEYS = ['statut', 'age', 'type', 'groupe', 'theme'] as const;
type FacetKey = typeof FACET_KEYS[number];

/** Nom court du filtre et libellé de sa ligne « Tous les … », dans `dossiers`. */
const FACET_LIBELLES = {
  statut: ['filterStatutLabel', 'filterStatutAll'],
  age: ['filterAgeLabel', 'filterAgeAll'],
  type: ['filterTypeLabel', 'filterTypeAll'],
  groupe: ['filterGroupeLabel', 'filterGroupeAll'],
  theme: ['filterThemeLabel', 'filterThemeAll'],
} as const;

/** Filtres qui affichent un nombre à côté de chaque valeur : les deux listes courtes. */
const FACETS_COMPTEES: readonly FacetKey[] = ['statut', 'age'];

/**
 * Instant de référence des tranches de période et de la détection « à venir ».
 *
 * Figé au chargement du module plutôt que lu à chaque rendu : `Date.now()` appelé
 * pendant un rendu est refusé par la règle `react-hooks/purity`, et une liste dont
 * les tranches bougeraient d'un rendu à l'autre serait de toute façon instable.
 * Une page laissée ouverte plusieurs jours garde ses tranches d'origine, ce qui est
 * sans conséquence : l'index, lui, ne se recharge pas non plus.
 */
const MAINTENANT = Date.now();

type Props = {
  filterLabels: Record<string, Record<string, string>>;
};

export default function DossiersResultsClient({ filterLabels }: Props) {
  const t = useTranslations('dossiers');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const tTypes = useTranslations('textTypes');
  const locale = useLocale();
  // Type de texte d'une ligne : sur /en, la forme courte traduite (`textTypes.short`,
  // comme les pages /Facts) ; en français, le libellé officiel, inchangé. Un libellé
  // absent de `PROCEDURE_KEY` (procédure rare) sort tel quel.
  const typeAffiche = (libelle: string) => {
    const cle = PROCEDURE_KEY[libelle];
    return locale === 'en' && cle ? tTypes(`short.${cle}`) : libelle;
  };

  const [hashQuery] = useHashQuery();
  const [statutFilter] = useHashFilter('statut');
  const [ageFilter] = useHashFilter('age');
  const [typeFilter] = useHashFilter('type');
  const [groupeFilter] = useHashFilter('groupe');
  const [themeFilter] = useHashFilter('theme');
  // Le tri vit dans le hash, pas dans un état local : `useLoadMoreWithRestore`
  // restaure le nombre de lignes et la position de scroll au retour d'une fiche.
  // Avec un état local, on retrouverait 200 lignes et un scroll calés sur un tri
  // qui, lui, serait reparti au défaut.
  // Un choix explicite (`depot`, ou `activite` cliqué pendant une recherche, le
  // seul moment où il n'est pas le défaut) survit à l'ajout ou à l'effacement
  // d'une requête, voir `lireTri`.
  const [triFilter, setTri] = useHashFilter('tri');
  const tri = lireTri(triFilter, hashQuery);
  // Trier par date une recherche tolérante aux fautes ferait remonter en tête des
  // correspondances approchées que la pertinence reléguait en bas.
  const rechercheExacte = tri !== 'pertinence';

  const [allDossiers, setAllDossiers] = useState<DossierMeta[] | null>(null);
  const indexRef = useRef<DossierIndex | null>(null);
  // Incrémenté à chaque index publié par le chargeur, pour rejouer la recherche en
  // cours sur un index plus frais ou plus complet (résumés arrivés après la liste).
  const [revisionIndex, setRevisionIndex] = useState(0);
  const [indexError, setIndexError] = useState(false);

  const [searchResults, setSearchResults] = useState<DossierMeta[] | null>(null);
  const [searching, setSearching] = useState(false);

  const filtersKey = `${hashQuery}|${statutFilter}|${ageFilter}|${typeFilter}|${groupeFilter}|${themeFilter}`;
  const { count, loadMore } = useLoadMoreWithRestore('dossiers-list-state', filtersKey);

  // Abonnement à l'index, publié en plusieurs temps (copie locale, liste fraîche,
  // résumés : voir `chargerIndexDossiers`). Sans requête dans le hash à l'arrivée, la
  // liste s'affiche au premier index et se met à jour aux suivants.
  useEffect(() => {
    let cancelled = false;
    // Une requête déjà présente dans le hash au montage (retour sur la liste depuis
    // une fiche, lien partagé avec #q=) attend l'index final : publiée sur un index
    // partiel, la liste changerait ensuite sous la restauration du défilement. Elle
    // est jouée ici et non par l'effet de recherche, qui a tourné avant que l'index
    // existe et ne se relancera pas puisque le hash ne change plus. Les résultats
    // sont publiés avec l'index, dans le même rendu, sinon la liste complète
    // s'afficherait sous le mot-clé.
    const attendreFinal = !!readHashParams().get('q');
    let publie = false;
    const desabonner = chargerIndexDossiers(async (idx) => {
      const precedent = indexRef.current;
      indexRef.current = idx;
      if (!attendreFinal || publie) {
        publie = true;
        // La republication finale porte le même index : rien de neuf à chercher.
        if (idx.minisearch === precedent?.minisearch) return;
        setAllDossiers(idx.all);
        setRevisionIndex((n) => n + 1);
        return;
      }
      if (!idx.final) return;
      publie = true;
      // Le hash relu maintenant : il a pu changer pendant le chargement.
      const params = readHashParams();
      const q = params.get('q');
      const exact = lireTri(params.get('tri'), q) !== 'pertinence';
      const initiaux = q
        ? await searchDossiers(idx, q, limiteRecherche(exact), { exact }).catch(() => [])
        : null;
      if (cancelled) return;
      if (initiaux) setSearchResults(initiaux);
      setAllDossiers(idx.all);
    }, () => { if (!cancelled) setIndexError(true); });
    return () => { cancelled = true; desabonner(); };
  }, []);

  // Migrate legacy URL params (e.g. ?statut=promulguee) to hash params on first load
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const legacyKeys = ['statut', 'age', 'type', 'groupe', 'theme', 'q', 'show'];
    if (!legacyKeys.some((k) => urlParams.has(k))) return;
    import('@/lib/search/use-hash-filter').then(({ writeHashParams }) => {
      const updates: Record<string, string> = {};
      legacyKeys.forEach((k) => { const v = urlParams.get(k); if (v) updates[k === 'show' ? 'statut' : k] = v === 'all' ? '' : v; });
      writeHashParams(updates);
      window.history.replaceState(null, '', window.location.pathname);
    });
  }, []);

  const runSearch = useCallback(async (query: string, exact: boolean) => {
    if (!indexRef.current || !query) { setSearchResults(null); return; }
    setSearching(true);
    try {
      const results = await searchDossiers(indexRef.current, query, limiteRecherche(exact), { exact });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  // Rejoué aussi au passage de la pertinence à un tri par date (et retour) : les
  // deux ne cherchent pas la même chose, voir `rechercheExacte`.
  // Et à chaque nouvel index (`revisionIndex`), qui peut trouver davantage.
  useEffect(() => {
    if (hashQuery) runSearch(hashQuery, rechercheExacte);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- nettoie les résultats quand la requête est vidée (#q effacé)
    else setSearchResults(null);
  }, [hashQuery, rechercheExacte, runSearch, revisionIndex]);

  const pool = useMemo(() => searchResults ?? allDossiers ?? [], [searchResults, allDossiers]);
  // Valeurs cochées de chaque menu (`#statut=promulguee,appliquee`). Une valeur
  // absente des choix (lien ancien, groupe disparu) est écartée seule, les autres
  // de la liste restant appliquées : la rangée de filtres ne la montre pas, et
  // filtrer dessus viderait la liste sans recours.
  const filtresActifs = useMemo<Record<FacetKey, string[]>>(() => {
    const connues = (key: FacetKey, brut: string) => lireListe(brut).filter((v) => !!filterLabels[key]?.[v]);
    return {
      statut: connues('statut', statutFilter),
      age: connues('age', ageFilter),
      type: connues('type', typeFilter),
      groupe: connues('groupe', groupeFilter),
      theme: connues('theme', themeFilter),
    };
  }, [filterLabels, statutFilter, ageFilter, typeFilter, groupeFilter, themeFilter]);

  const filteredResults = useMemo(() => filterDossiers(pool, filtresActifs), [pool, filtresActifs]);

  // Nombre de résultats de chaque valeur de Statut et de Date prise seule, les
  // autres menus (et la requête) restant posés. C'est ce que donnerait le clic tant
  // que rien n'est coché dans le menu ; ensuite, les valeurs s'additionnent. Les trois
  // autres listes, longues, n'en affichent pas : une soixantaine de passes sur
  // l'index à chaque changement, pour des nombres que personne ne compare.
  // Aucun nombre pendant qu'une recherche tourne : `pool` porte encore les
  // résultats de la requête précédente, et les nombres en parleraient.
  const comptes = useMemo(() => {
    const parFacette: Partial<Record<FacetKey, Record<string, number>>> = {};
    if (allDossiers === null || searching) return parFacette;
    for (const key of FACETS_COMPTEES) {
      parFacette[key] = Object.fromEntries(
        Object.keys(filterLabels[key] ?? {}).map((slug) => [
          slug,
          filterDossiers(pool, { ...filtresActifs, [key]: [slug] }).length,
        ])
      );
    }
    return parFacette;
  }, [pool, filtresActifs, allDossiers, searching, filterLabels]);

  const facets: FilterBarFacet[] = FACET_KEYS.map((key) => ({
    key,
    label: t(FACET_LIBELLES[key][0]),
    allLabel: t(FACET_LIBELLES[key][1]),
    options: Object.entries(filterLabels[key] ?? {}).map(([slug, libelle]) => ({
      slug,
      libelle,
      count: comptes[key]?.[slug],
    })),
  }));

  // Le dernier filtre posé, dans l'ordre du hash : c'est lui que l'état vide
  // propose de retirer, le plus souvent celui qui vient de vider la liste.
  const hashParams = useHashParams();
  const dernierFiltre = [...hashParams.keys()]
    .filter((k): k is FacetKey => (FACET_KEYS as readonly string[]).includes(k) && filtresActifs[k as FacetKey].length > 0)
    .pop();
  // Calculé seulement quand la liste est vide, seul cas où il s'affiche : sinon
  // une passe de plus sur tout l'index à chaque rendu, pour rien.
  const sansDernier = dernierFiltre && filteredResults.length === 0
    ? filterDossiers(pool, { ...filtresActifs, [dernierFiltre]: [] }).length
    : 0;

  const parActivite = tri === 'activite';

  const sortedResults = useMemo(() => {
    if (parActivite) {
      // Tri par défaut, rejoué sur tout l'index à chaque filtre : des dates ISO se
      // comparent comme des chaînes, sans le coût de `localeCompare`.
      return [...filteredResults].sort((a, b) => {
        const da = a.derniere_activite ?? '';
        const db = b.derniere_activite ?? '';
        return da < db ? 1 : da > db ? -1 : 0;
      });
    }
    // Les résultats d'une recherche arrivent dans l'ordre de pertinence : en tri
    // dépôt, on reprend celui de l'index (`all` est trié date_depot desc, dates
    // absentes en dernier) plutôt que de recopier son comparateur.
    if (tri === 'depot' && searchResults && allDossiers) {
      const trouves = new Set(filteredResults.map((d) => d.uid));
      return allDossiers.filter((d) => trouves.has(d.uid));
    }
    // Pertinence, ou dépôt sans recherche : l'ordre est déjà le bon.
    return filteredResults;
  }, [filteredResults, parActivite, tri, searchResults, allDossiers]);

  const hasActiveFilters = !!(hashQuery || Object.values(filtresActifs).some((v) => v.length > 0));
  const totalCount = sortedResults.length;
  const visibleResults = sortedResults.slice(0, count);
  const hasMore = count < totalCount;

  // Les formateurs sont construits une fois par rendu, et non une fois par ligne.
  const formatters = useMemo(() => ({
    long: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'Europe/Paris' }),
    court: new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }),
    // Variantes à mois abrégé (« 28 sept. ») de la colonne de droite sur mobile.
    longAbrege: formateurDate(locale, { dateStyle: 'medium', timeZone: 'Europe/Paris' }),
    courtAbrege: formateurDate(locale, { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }),
    mois: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }),
    annee: new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Europe/Paris' }),
  }), [locale]);

  function formatDate(dateRaw: string | null, abrege = false): string {
    if (!dateRaw) return '';
    const d = new Date(dateRaw);
    if (isNaN(d.getTime())) return '';
    // L'année n'est répétée que si elle sort de l'année en cours. En tri dépôt
    // l'en-tête de période la porte déjà ; en tri activité, où les en-têtes sont
    // relatifs, c'est justement une date d'une autre année qui doit se signaler.
    // Année lue à l'heure de Paris, comme la date affichée : `getFullYear()` suit le
    // fuseau du navigateur, et un dépôt du 1er janvier vu de Seattle (encore le 31
    // décembre là-bas) recevait une année superflue.
    const memeAnnee = formatters.annee.format(d) === formatters.annee.format(MAINTENANT);
    if (abrege) return (memeAnnee ? formatters.courtAbrege : formatters.longAbrege).format(d);
    return (memeAnnee ? formatters.court : formatters.long).format(d);
  }

  /**
   * Libellé de la tranche à laquelle appartient un dossier : un mois en tri dépôt,
   * une fenêtre relative en tri activité, où ce qui compte est la fraîcheur.
   */
  function libellePeriode(dossier: DossierMeta): string {
    const brut = parActivite ? dossier.derniere_activite : dossier.date_depot;
    if (!brut) return '';
    const d = new Date(brut);
    if (isNaN(d.getTime())) return '';
    const jours = Math.round((MAINTENANT - d.getTime()) / 86400000);
    if (jours < 0) return t('periodUpcoming');
    if (!parActivite) {
      // `fr` rend « août 2026 » en minuscule là où un en-tête demande une capitale.
      const mois = formatters.mois.format(d);
      return mois.charAt(0).toUpperCase() + mois.slice(1);
    }
    if (jours <= 7) return t('periodThisWeek');
    if (jours <= 31) return t('periodThisMonth');
    if (jours <= 180) return t('periodSixMonths');
    return t('periodEarlier');
  }

  /**
   * Ce qui se lit à droite de la ligne : la date, précédée de l'acte en tri activité.
   * Les morceaux sont rendus à part pour que le mobile puisse masquer l'acte et
   * abréger le mois (`quandMobile`).
   */
  function colonneDroite(dossier: DossierMeta): { acte: string | null; quand: string; quandMobile: string } {
    if (!parActivite) {
      return { acte: null, quand: formatDate(dossier.date_depot), quandMobile: formatDate(dossier.date_depot, true) };
    }
    const enAttente = dossier.derniere_activite
      ? new Date(dossier.derniere_activite).getTime() > MAINTENANT
      : false;
    const quandDe = (date: string) => (enAttente ? t('scheduledOn', { date }) : date);
    const cle = acteLabelKey(dossier.dernier_acte_code);
    return {
      // Un code d'acte inconnu ne laisse que la date : jamais de code brut à l'écran.
      acte: cle ? t(cle as Parameters<typeof t>[0]) : null,
      quand: quandDe(formatDate(dossier.derniere_activite)),
      quandMobile: quandDe(formatDate(dossier.derniere_activite, true)),
    };
  }

  function reference(dossier: DossierMeta): string | null {
    if (!dossier.numero) return null;
    return dossier.chambre === 'Sénat'
      ? t('refSenat', { num: dossier.numero })
      : t('refAN', { num: dossier.numero });
  }

  return (
    <div id="resultats">
      <FilterBar
        facets={facets}
        clearAllLabel={tCommon('clearAll')}
        removeLabel={tCommon('removeFilter')}
        filterPlaceholder={(count) => tCommon('filterChoices', { count })}
      />

      {/* En-tête résultats. Sans filtre il nomme la liste ; avec, la rangée
          au-dessus dit déjà ce qui est posé, il ne reste que le nombre. */}
      <div className="fade-slide-in pb-2" style={{ paddingTop: '1.5rem' }}>
        {/* Le tri suit le compteur au lieu d'aller au bord droit : le nombre et
            l'ordre de la liste se lisent d'un seul coup d'œil. */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 0.75rem' }}>
          <span className="font-semibold shrink-0" style={{ fontSize: '0.9375rem' }}>
            {/* Rien tant que l'index charge : « Tous les dossiers » annoncerait une
                liste qui n'est pas encore là. */}
            {!hasActiveFilters && allDossiers !== null && t('quickAll')}
            {allDossiers !== null && (
              hasActiveFilters
                ? (searching ? '…' : tCommon('resultsCount', { count: totalCount }))
                : (
                  <span className="font-normal text-muted-foreground">
                    {' '}·{' '}{tCommon('resultsCount', { count: totalCount })}
                  </span>
                )
            )}
          </span>

          {/* Sur /en, les titres sont des traductions de l'IA (`lib/titre-dossier.ts`) :
              une seule mention pour toute la liste (D-002). Badge court : « Generated by
              AI from official sources » laisserait croire que l'IA a rédigé les textes,
              alors qu'elle n'a traduit que les titres ; l'infobulle le dit. La fiche de
              chaque dossier redit le titre officiel. */}
          {locale === 'en' && allDossiers !== null && <AIBadge usage="titres" court infobulle={t('titresTraduitsInfobulle')} />}

          {/* Pertinence n'est proposée que pendant une recherche. Le défaut s'écrit
              `#tri` vide, d'où « activité » qui ne s'écrit en toutes lettres que
              lorsqu'il n'est pas le défaut, c'est-à-dire pendant une recherche.
              Pas de cadre autour du groupe : bordé, il se lisait comme une
              seconde rangée de filtres, juste sous celle de la recherche. */}
          {allDossiers !== null && (
            // Radix rend une valeur vide quand on reclique la pastille active :
            // l'ignorer, sinon le tri se retrouverait sans aucune option cochée.
            // Les styles en ligne l'emportent sur ceux de `toggleVariants` (fond
            // au survol, fond actif, coins carrés entre deux pastilles), ce qui
            // garde le rendu d'avant et reste fiable sur Safari.
            <ToggleGroup
              type="single"
              value={tri}
              onValueChange={(valeur) => {
                if (!valeur) return;
                setTri(valeur === 'pertinence' || (valeur === 'activite' && !hashQuery) ? '' : valeur);
              }}
              aria-label={t('sortBy')}
              className="inline-flex shrink-0"
            >
              {(hashQuery ? ['pertinence', 'activite', 'depot'] as const : ['activite', 'depot'] as const).map((valeur) => {
                const actif = tri === valeur;
                return (
                  <ToggleGroupItem
                    key={valeur}
                    value={valeur}
                    className="h-auto min-w-0 transition-colors"
                    style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '9999px',
                      fontSize: '0.8125rem',
                      // `text-sm` de `toggleVariants` impose son propre interligne :
                      // on rétablit celui de la page pour garder la hauteur d'avant.
                      lineHeight: 1.6,
                      fontWeight: 500,
                      color: actif ? 'var(--primary)' : 'var(--muted-foreground)',
                      backgroundColor: actif ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
                    }}
                  >
                    {valeur === 'pertinence' ? t('sortRelevance') : valeur === 'depot' ? t('sortDeposit') : t('sortActivity')}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          )}
        </div>

      </div>

      {/* Chargement initial */}
      {allDossiers === null && !indexError && (
        <p className="text-sm text-muted-foreground py-8 flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" style={{ width: '14px', height: '14px' }} aria-hidden="true" />
          {t('loading')}
        </p>
      )}

      {/* Ni copie locale ni réseau : le dire, plutôt qu'un vide sous les filtres. */}
      {allDossiers === null && indexError && (
        <div className="py-8 text-center" style={{ fontSize: '0.9375rem' }}>
          <p className="text-muted-foreground">{tCommon('listeEchec')}</p>
          <button
            type="button"
            onClick={() => { setIndexError(false); relancerIndexDossiers(); }}
            style={{ marginTop: '0.875rem', border: 'none', background: 'none', padding: 0, color: 'var(--primary)', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
          >
            {tErrors('retry')}
          </button>
        </div>
      )}

      {/* Résultats. La liste n'existe qu'une fois l'index arrivé : créée vide
          pendant le chargement, elle jouait son animation d'entrée sur du vide,
          et les dossiers apparaissaient ensuite d'un coup. */}
      {allDossiers !== null && (visibleResults.length === 0 ? (
        <div className="py-8 text-center" style={{ fontSize: '0.9375rem' }}>
          <p className="text-muted-foreground">{t('noResults')}</p>
          {dernierFiltre && (
            <p style={{ marginTop: '0.875rem', fontSize: '0.875rem', color: 'var(--card-foreground)' }}>
              {tCommon('withoutFilter', {
                value: filtresActifs[dernierFiltre].map((v) => filterLabels[dernierFiltre][v]).join(', '),
                count: sansDernier,
              })}{' '}
              <button
                type="button"
                onClick={() => writeHashParam(dernierFiltre, '')}
                style={{ border: 'none', background: 'none', padding: 0, color: 'var(--primary)', fontWeight: 500, cursor: 'pointer' }}
              >
                {tCommon('removeFilter')}
              </button>
            </p>
          )}
        </div>
      ) : (
        <ul className="liste-cascade" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {visibleResults.map((dossier, i) => {
            const periode = libellePeriode(dossier);
            // L'en-tête ne s'affiche qu'au changement de tranche. Il porte l'ordre de
            // la liste, ce qu'un simple libellé de tri ne rend pas visible en défilant.
            // En tri par pertinence il disparaît : les dates y sont mêlées et chaque
            // ligne ouvrirait sa propre tranche.
            const nouvellePeriode = tri !== 'pertinence' && periode !== ''
              && (i === 0 || periode !== libellePeriode(visibleResults[i - 1]));
            const ref = reference(dossier);
            const droite = colonneDroite(dossier);
            return (
              <Fragment key={dossier.uid}>
                {nouvellePeriode && (
                  <li
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      backgroundColor: 'var(--background)',
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '0.625rem',
                      padding: '0.5rem 1rem 0.25rem',
                      fontSize: '0.71875rem',
                      // Eyebrow du BRAND_ID : c'est le gris clair qui écarte l'en-tête des
                      // titres, en `--foreground` il pesait autant qu'eux. La graisse
                      // reste haute pour qu'il ne se confonde pas non plus avec les
                      // métadonnées de ligne, du même gris mais en graisse normale.
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--muted-foreground)',
                    }}
                  >
                    {/* L'en-tête est collant, donc opaque, sinon la liste défile au travers.
                        Or AppShell tient tout le contenu sous un voile chaud (`--muted` à
                        30 %) : un fond blanc pur y ferait une bande plus claire que la page.
                        Le voile est donc rejoué à l'identique plutôt que mélangé en
                        `color-mix()`, absent de Safari avant la 16.2. */}
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        backgroundColor: 'var(--muted)',
                        opacity: 0.3,
                        pointerEvents: 'none',
                      }}
                    />
                    <span style={{ position: 'relative' }}>{periode}</span>
                    <span style={{ position: 'relative', flex: 1, height: 1, backgroundColor: 'var(--border)' }} />
                  </li>
                )}
                <li>
                  <DossierCard href={`/dossiers-legislatifs/${dossier.uid}/resume-ia`}>
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {ref && (
                          <span
                            className="shrink-0"
                            style={{
                              fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
                              fontSize: '0.75rem',
                              color: 'var(--muted-foreground)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {ref}
                          </span>
                        )}
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statutBulletColor(dossier.statut_final) }} />
                        {/* Le statut reste en français dans l'index, qui sert aussi la couleur de la
                            pastille : seul l'affichage passe par la traduction.
                            Il passe à la ligne plutôt que d'être coupé : à 390 px, en
                            anglais, 17 statuts sur 50 perdaient leur fin (« Adopted by
                            the Se… », mesuré le 2026-10-28). */}
                        <span className="text-xs text-muted-foreground" style={{ minWidth: 0, lineHeight: 1.35 }}>{dossier.statut_final ? translateStatut(dossier.statut_final, t) : t('statutInconnu')}</span>
                      </div>
                      <span
                        className="shrink-0"
                        style={{ fontSize: '0.75rem', color: 'var(--foreground)', whiteSpace: 'nowrap' }}
                      >
                        {/* Sur mobile, l'acte et la date ne laissaient plus au statut que
                            quelques lettres (« Déposé - p… »). Sous `sm`, l'acte s'efface et
                            le mois s'abrège. `max-sm:hidden` et non `hidden sm:inline` :
                            voir ARCHITECTURE.md §Pièges Tailwind v4 sur Safari. */}
                        <span className="max-sm:hidden">
                          {droite.acte && `${droite.acte} · `}
                          {droite.quand}
                        </span>
                        <span className="sm:hidden">{droite.quandMobile}</span>
                      </span>
                    </div>
                    <h2 className="text-base font-semibold leading-snug mb-1">{titreDossier(dossier, locale)}</h2>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {dossier.procedure_libelle && (
                        <span className="font-medium uppercase tracking-wide">{typeAffiche(dossier.procedure_libelle)}</span>
                      )}
                      {dossier.initiateur_nom && (
                        <>
                          {dossier.procedure_libelle && <span className="text-border">·</span>}
                          <span>{dossier.initiateur_nom}</span>
                        </>
                      )}
                      {dossier.initiateur_groupe && (
                        <>
                          <span className="text-border">·</span>
                          <span>{dossier.initiateur_groupe}</span>
                        </>
                      )}
                      {/* Le badge descend ici : la date lui a pris le côté droit de la ligne du haut. */}
                      {!dossier.has_texte && (
                        <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600 dark:bg-red-950 dark:text-red-400">
                          {t('textNotPublished')}
                        </span>
                      )}
                    </div>
                  </DossierCard>
                </li>
              </Fragment>
            );
          })}
        </ul>
      ))}

      {hasMore && <LoadMoreButton onClick={loadMore} />}
    </div>
  );
}
