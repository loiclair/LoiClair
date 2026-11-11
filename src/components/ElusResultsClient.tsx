'use client';

// Liste de /les-elus : rangée de filtres (Mes élus, pastilles de rôle, Groupe, Département),
// barre de lettres, en-tête de résultats et lignes. Tout se calcule dans le
// navigateur à partir de l'index des élus ; filtres et requête sont lus dans le
// hash, sauf « Mes élus », gardé dans la session (`lib/search/filtre-mes-elus.ts`).
// `page.tsx` fournit les valeurs de chaque filtre ; la carte des départements du menu
// Département se charge depuis `public/` (`useCarteDepartements`).
//
// Le lien « Comparer » de l'en-tête change les lignes en cases à cocher : deux élus de la même
// chambre ouvrent `ComparerElusModal`. Ce mode vit dans l'état du composant et non dans
// le hash : il n'y a rien à partager, et un lien partagé ne doit pas ouvrir une modale.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeftRight, Check, Loader2, MapPin, Pencil, Trash2, X } from 'lucide-react';
import { DEPT_FILTER_VARIANTS, DEPT_NAME_TO_SVG_ID } from '@/lib/departements';
import { normalizeFr } from '@/lib/search/normalize';
import { loadActeurIndex, filterActeurs, libelleMandat, type ActeurFilters, type ActeurIndex, type ActeurMeta } from '@/lib/search/acteur-index';
import { useHashQuery } from '@/lib/search/use-hash-query';
import { ecrireListe, lireListe, useHashFilter, useHashParams, writeHashParam, writeHashParams } from '@/lib/search/use-hash-filter';
import { useLoadMoreWithRestore } from '@/hooks/useLoadMoreWithRestore';
import LoadMoreButton from '@/components/LoadMoreButton';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import DepartementMap from '@/components/DepartementMap';
import { chargerCarteDepartements } from '@/hooks/useCarteDepartements';
import FilterBar, { type FilterBarFacet } from '@/components/ui/FilterBar';
import { GroupLogoImage } from '@/components/ui/GroupLogoImage';
import { useMesElus } from '@/hooks/useMesElus';
import { openTrouverMonDeputeModal } from '@/components/TrouverMonDeputeModal';
import { abonnerFiltreMesElus, ecrireFiltreMesElus, lireFiltreMesElus } from '@/lib/search/filtre-mes-elus';
import ComparerElusModal, { chambreDe } from '@/components/ComparerElusModal';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Clés du hash que l'état vide peut proposer de retirer, la lettre comprise. */
const CLES_RETIRABLES = ['role', 'groupe', 'dept', 'letter'] as const;
type CleRetirable = typeof CLES_RETIRABLES[number];

function firstLetter(nom: string | null): string {
  return normalizeFr(nom ?? '').charAt(0).toUpperCase();
}

type Filtres = {
  role: string;
  /** Groupes et départements cochés, tous connus des choix ; vide : aucun filtre. */
  groupe: string[];
  dept: string[];
  query: string;
  letter: string;
  /** Élus mémorisés quand le filtre « Mes élus » est posé, `null` sinon. */
  uids: ReadonlySet<string> | null;
};

/** Élus qui passent les filtres (`resultats`, lettre comprise) et ceux d'avant la
 *  lettre (`base`), qui disent quelles lettres restent cliquables. */
function appliquer(idx: ActeurIndex, f: Filtres): { base: ActeurMeta[]; resultats: ActeurMeta[] } {
  const base = filterActeurs(idx, {
    role: (f.role || undefined) as ActeurFilters['role'],
    groupeSlug: f.groupe,
    dept: f.dept,
    query: f.query || undefined,
  }).filter((a) => !f.uids || f.uids.has(a.uid));
  const resultats = f.letter
    ? base.filter((a) => firstLetter(a.nom) === f.letter.toUpperCase())
    : base;
  return { base, resultats };
}

type Props = {
  filterLabels: Record<string, Record<string, string>>;
};

export default function ElusResultsClient({ filterLabels }: Props) {
  const t = useTranslations('elus');
  // La carte du menu Département part dès l'arrivée sur la page, pour être là à
  // l'ouverture du menu plutôt que de s'y dessiner.
  useEffect(() => { chargerCarteDepartements().catch(() => {}); }, []);
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const [hashQuery] = useHashQuery();
  const [role] = useHashFilter('role');
  // Listes brutes du hash (`#groupe=a,b`), lues par `lireListe`.
  const [groupeBrut] = useHashFilter('groupe');
  const [deptBrut] = useHashFilter('dept');
  const [letter, setLetter] = useHashFilter('letter');
  const hashParams = useHashParams();
  const [index, setIndex] = useState<ActeurIndex | null>(null);
  const [error, setError] = useState(false);
  // Incrémenté par « Réessayer » : relance l'effet de chargement de l'index.
  const [tentative, setTentative] = useState(0);
  const { data: mesElus, clear: oublierMesElus } = useMesElus();
  const filtreMesElus = useSyncExternalStore(abonnerFiltreMesElus, lireFiltreMesElus, () => null);

  // Mode comparaison. La sélection survit aux changements de filtre : on cherche le
  // second élu par son nom ou son groupe après avoir coché le premier.
  const [comparaison, setComparaison] = useState(false);
  // La modale est ouverte dès que deux élus sont cochés (deux élus ne servent qu'à ça),
  // et la fermer quitte le mode : il n'y a pas d'état « modale ouverte » à part.
  const [choisis, setChoisis] = useState<ActeurMeta[]>([]);
  const quitterComparaison = () => { setComparaison(false); setChoisis([]); };
  const chambreChoisie = choisis.length > 0 ? chambreDe(choisis[0]) : null;
  const basculerChoix = (a: ActeurMeta) =>
    setChoisis((c) => (c.some((x) => x.uid === a.uid) ? c.filter((x) => x.uid !== a.uid) : [...c, a].slice(0, 2)));

  // Vide tant qu'aucun élu n'est mémorisé : la pastille invite alors à les
  // identifier, et un filtre resté posé dans la session (élus oubliés depuis) ne
  // filtre rien.
  const mesUids = useMemo(() => {
    const uids = [mesElus?.depute?.uid, ...(mesElus?.senateurs ?? []).map((s) => s.uid)].filter((u): u is string => !!u);
    return uids.length > 0 ? new Set(uids) : null;
  }, [mesElus]);
  // Des élus mémorisés avant que la date existe n'en ont pas : une valeur fixe
  // leur tient lieu de version.
  const versionMesElus = mesElus?.updated_at ?? 'sans-date';
  const mesActif = mesUids !== null && filtreMesElus === versionMesElus;

  // Quand l'identification part de cette page (la pastille, ou « Changer » dans
  // son menu), le filtre se pose de lui-même sur les élus trouvés : on vient de
  // demander qui ils sont, la liste les montre. Le signal part du clic et non de
  // l'arrivée des élus, qui passent aussi de vide à rempli à chaque chargement de
  // la page, le serveur ne les connaissant pas.
  const activerALIdentification = useRef(false);
  useEffect(() => {
    if (mesUids && activerALIdentification.current) {
      activerALIdentification.current = false;
      ecrireFiltreMesElus(versionMesElus);
    }
  }, [mesUids, versionMesElus]);

  const filtersKey = `${mesActif}|${role}|${groupeBrut}|${deptBrut}|${hashQuery}|${letter}`;
  const { count, loadMore } = useLoadMoreWithRestore('elus-list-state', filtersKey);

  useEffect(() => {
    let cancelled = false;
    loadActeurIndex()
      .then((idx) => { if (!cancelled) setIndex(idx); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [tentative]);

  // Groupes qui comptent au moins un élu du rôle choisi : un groupe du Sénat
  // n'a aucun député, et le proposer sous « Députés » viderait la liste. `null`
  // quand aucun rôle n'est posé ou que l'index n'est pas encore là : tous les
  // groupes restent alors proposés.
  const roleConnu = filterLabels.role?.[role] ? role : '';
  const groupesDuRole = useMemo(() => {
    if (!index || !roleConnu) return null;
    return new Set(Object.keys(filterLabels.groupe ?? {}).filter((slug) =>
      filterActeurs(index, { role: roleConnu as ActeurFilters['role'], groupeSlug: [slug] }).length > 0
    ));
  }, [index, roleConnu, filterLabels.groupe]);

  // Une valeur absente des choix (lien ancien, groupe dissous, groupe de l'autre
  // chambre) est écartée seule, les autres valeurs de la liste restant appliquées :
  // la rangée de filtres ne la montre pas, et filtrer dessus viderait la liste sans recours.
  const filtres = useMemo<Filtres>(() => {
    const connues = (key: string, brut: string) => lireListe(brut).filter((v) => !!filterLabels[key]?.[v]);
    return {
      role: roleConnu,
      groupe: connues('groupe', groupeBrut).filter((g) => !groupesDuRole || groupesDuRole.has(g)),
      dept: connues('dept', deptBrut),
      query: hashQuery,
      letter,
      uids: mesActif ? mesUids : null,
    };
  }, [filterLabels, roleConnu, groupesDuRole, groupeBrut, deptBrut, hashQuery, letter, mesActif, mesUids]);

  const { base, resultats } = useMemo(
    () => (index ? appliquer(index, filtres) : { base: [], resultats: [] }),
    [index, filtres]
  );

  const availableLetters = useMemo(() => {
    const letters = new Set<string>();
    for (const a of base) {
      const l = firstLetter(a.nom);
      if (l >= 'A' && l <= 'Z') letters.add(l);
    }
    return letters;
  }, [base]);

  const comptesMesElus = useMemo(
    () => (index && mesUids ? appliquer(index, { ...filtres, uids: mesUids }).resultats.length : undefined),
    [index, filtres, mesUids]
  );

  const options = (key: string) =>
    Object.entries(filterLabels[key] ?? {}).map(([slug, libelle]) => ({ slug, libelle }));

  // Un seul rôle à la fois : deux pastilles allumées reviendraient à n'en poser
  // aucune. Chaque groupe coché part avec l'ancien rôle s'il n'a aucun élu du
  // nouveau, les autres restant cochés, dans la même écriture du hash, pour qu'aucun
  // rendu intermédiaire ne vide la liste. Les groupes du hash sont lus tels quels,
  // même ignorés sous l'ancien rôle (lien partagé) : sans élu du nouveau rôle ils
  // partent du hash au lieu d'y rester inertes ; avec, ils s'appliquent, comme le
  // lien le demandait.
  const choisirRole = (slug: string) => {
    const groupesHash = lireListe(groupeBrut).filter((g) => !!filterLabels.groupe?.[g]);
    const gardes = slug && index
      ? groupesHash.filter((g) => filterActeurs(index, { role: slug as ActeurFilters['role'], groupeSlug: [g] }).length > 0)
      : groupesHash;
    writeHashParams({ role: slug, ...(gardes.length < groupesHash.length ? { groupe: ecrireListe(gardes) } : {}) });
  };
  const optionsGroupe = options('groupe').filter((o) => !groupesDuRole || groupesDuRole.has(o.slug));

  const libelleMesElus = t('monDepute.cardFilledLabel');
  const iconeMesElus = <MapPin aria-hidden style={{ width: 14, height: 14, color: 'var(--primary)' }} />;
  const facets: FilterBarFacet[] = [
    // Toujours en tête de rangée, pour rester visible sur téléphone où elle défile.
    // Sans élus mémorisés, c'est la seule entrée vers la recherche par code postal ;
    // avec, c'est un filtre comme les autres, plus ses gestes Changer et Oublier.
    mesUids ? {
      key: 'mes',
      label: libelleMesElus,
      allLabel: t('quickAll'),
      options: [{ slug: '1', libelle: libelleMesElus, count: comptesMesElus }],
      value: mesActif ? ['1'] : [],
      onChange: (slugs: string[]) => ecrireFiltreMesElus(slugs.includes('1') ? versionMesElus : null),
      // Une seule valeur : cliquer « Mes élus » referme le menu, comme avant.
      choixUnique: true,
      actions: [
        {
          label: t('monDepute.cardChangeCta'),
          icon: <Pencil style={{ width: 14, height: 14 }} />,
          onSelect: () => {
            activerALIdentification.current = true;
            openTrouverMonDeputeModal();
          },
        },
        {
          label: t('monDepute.cardClearCta'),
          icon: <Trash2 style={{ width: 14, height: 14 }} />,
          onSelect: () => { ecrireFiltreMesElus(null); oublierMesElus(); },
        },
      ],
      icon: iconeMesElus,
    } : {
      key: 'mes',
      label: t('monDepute.identifyPill'),
      allLabel: '',
      options: [],
      onPress: () => {
        activerALIdentification.current = true;
        openTrouverMonDeputeModal();
      },
      icon: iconeMesElus,
    },
    // Le rôle se pose d'un clic, sans menu : deux valeurs se lisent mieux en
    // pastilles. Les deux écrivent la même clé `role` du hash, celle des liens partagés.
    ...options('role').map(({ slug, libelle }): FilterBarFacet => ({
      key: `role-${slug}`,
      label: libelle,
      allLabel: '',
      options: [{ slug, libelle }],
      value: filtres.role === slug ? [slug] : [],
      // Appelé avec une liste vide par le ✕ et « Tout effacer ».
      onChange: (slugs: string[]) => choisirRole(slugs[0] ?? ''),
      onPress: () => choisirRole(filtres.role === slug ? '' : slug),
    })),
    { key: 'groupe', label: t('filterGroupeLabel'), allLabel: t('filterGroupeAll'), options: optionsGroupe, toujoursFiltrable: true },
    {
      key: 'dept',
      label: t('filterDeptLabel'),
      allLabel: t('filterDeptAll'),
      options: options('dept'),
      aside: (choose) => (
        <DepartementMap
          selectedDepts={filtres.dept}
          // La carte rend son propre nom de département (« La Réunion »), qui
          // n'est pas toujours celui de la base : on choisit la variante présente
          // dans la liste, sans quoi le filtre serait ignoré comme inconnu. Une
          // graphie déjà cochée de la même zone passe d'abord (« Saint-Martin »
          // pour la zone « Saint-Barthélemy et Saint-Martin ») : sinon le clic sur
          // une zone surlignée en cocherait une autre au lieu de la décocher.
          onToggle={(d) => choose(
            filtres.dept.find((v) => DEPT_NAME_TO_SVG_ID[v] === DEPT_NAME_TO_SVG_ID[d])
              ?? (DEPT_FILTER_VARIANTS[d] ?? [d]).find((v) => filterLabels.dept?.[v])
              ?? d
          )}
        />
      ),
    },
  ];

  const badgeRole = (a: ActeurMeta): string => libelleMandat(a, t);

  const totalCount = resultats.length;
  const visibleResults = resultats.slice(0, count);
  const hasMore = count < totalCount;
  const hasActiveFilters = !!(mesActif || hashQuery || filtres.role || filtres.groupe.length || filtres.dept.length || letter);

  // Le dernier filtre posé, dans l'ordre du hash : c'est lui que l'état vide
  // propose de retirer, le plus souvent celui qui vient de vider la liste. La
  // lettre en fait partie : elle survit à un changement de filtre et peut, seule,
  // ne plus rien laisser passer.
  // Lu dans `filtres` et non dans les libellés : un groupe de l'autre chambre,
  // resté dans le hash mais ignoré, ne doit pas être proposé au retrait.
  const libelleDe = (k: CleRetirable): string | undefined => {
    if (k === 'letter') { const v = hashParams.get(k) ?? ''; return v ? v.toUpperCase() : undefined; }
    if (k === 'role') return filtres.role ? filterLabels.role?.[filtres.role] : undefined;
    return filtres[k].length ? filtres[k].map((v) => filterLabels[k]?.[v]).join(', ') : undefined;
  };
  const dernierFiltre = [...hashParams.keys()]
    .filter((k): k is CleRetirable => (CLES_RETIRABLES as readonly string[]).includes(k) && !!libelleDe(k as CleRetirable))
    .pop();
  // Calculé seulement quand la liste est vide, seul cas où il s'affiche, et
  // jamais sans index (chargement en échec) : le nombre annoncé serait faux.
  const sansDernier = dernierFiltre && index && resultats.length === 0
    ? appliquer(index, { ...filtres, [dernierFiltre]: dernierFiltre === 'groupe' || dernierFiltre === 'dept' ? [] : '' }).resultats.length
    : null;

  return (
    <div id="resultats">
      <FilterBar
        facets={facets}
        clearAllLabel={tCommon('clearAll')}
        removeLabel={tCommon('removeFilter')}
        filterPlaceholder={(n) => tCommon('filterChoices', { count: n })}
        // La lettre n'a pas de pastille mais filtre comme les autres : laissée
        // posée, « Tout effacer » rendrait une liste encore réduite à une initiale.
        onClearAll={() => setLetter('')}
      />

      {/* La rangée de filtres s'affiche dès l'arrivée ; seule la liste attend l'index.
          Sans index, ni en-tête ni lettres : « Aucun résultat » mentirait. */}
      {index === null && !error ? (
        <p className="text-sm text-muted-foreground py-8 flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" style={{ width: '14px', height: '14px' }} aria-hidden="true" />
          {t('loading')}
        </p>
      ) : index === null ? (
        <div className="py-8 text-center" style={{ fontSize: '0.9375rem' }}>
          <p className="text-muted-foreground">{tCommon('listeEchec')}</p>
          <button
            type="button"
            onClick={() => { setError(false); setTentative((n) => n + 1); }}
            style={{ marginTop: '0.875rem', border: 'none', background: 'none', padding: 0, color: 'var(--primary)', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}
          >
            {tErrors('retry')}
          </button>
        </div>
      ) : (<>
      {/* En-tête résultats. Sans filtre il nomme la liste ; avec, la rangée
          au-dessus dit déjà ce qui est posé, il ne reste que le nombre. */}
      <div className="fade-slide-in pb-2" style={{ paddingTop: '1.5rem', display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
        <span className="font-semibold" style={{ fontSize: '0.9375rem', flex: 1, minWidth: 0 }}>
          {!hasActiveFilters && t('quickAll')}
          {hasActiveFilters
            ? tCommon('resultsCount', { count: totalCount })
            : <span className="font-normal text-muted-foreground"> · {tCommon('resultsCount', { count: totalCount })}</span>}
        </span>
        {/* Tout le mode comparaison tient à cet endroit : un lien d'action sur la liste,
            et non une pastille de la rangée de filtres, dont il aurait pris la forme sans
            en être un. Il est un interrupteur, et rien d'autre : il entre dans le mode et
            en sort, son icône devenant une croix pendant le choix, le compte à sa gauche.
            Une barre fixée en bas d'écran faisait aller le regard ailleurs que là où l'on
            venait de cliquer. */}
        <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.75rem', flexShrink: 0 }}>
          {comparaison && (
            <span style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
              {/* La chambre du premier choix dit pourquoi l'autre est grisée. */}
              {t('comparer.compte', { count: choisis.length, chambre: chambreChoisie ?? 'aucune' })}
            </span>
          )}
          <button
            type="button"
            onClick={() => (comparaison ? quitterComparaison() : setComparaison(true))}
            aria-pressed={comparaison}
            title={comparaison ? t('comparer.quitter') : undefined}
            className="hover:underline"
            style={{
              // `baseline` et non `center` : centré, le bouton prenait pour ligne de
              // base le bas de son icône, et son texte se décalait de celui du compte
              // posé à côté. L'icône reste centrée par son propre `alignSelf`.
              display: 'inline-flex',
              alignItems: 'baseline',
              gap: '0.375rem',
              padding: 0,
              border: 'none',
              background: 'none',
              color: 'var(--primary)',
              fontSize: '0.875rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {comparaison
              ? <X aria-hidden style={{ width: 14, height: 14, alignSelf: 'center' }} />
              : <ArrowLeftRight aria-hidden style={{ width: 14, height: 14, alignSelf: 'center' }} />}
            {t('comparer.action')}
          </button>
        </span>
      </div>

      {/* Barre alphabétique */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.1875rem', marginBottom: '0.75rem' }}>
        {ALPHABET.map((l) => {
          const available = availableLetters.has(l);
          const active = letter.toUpperCase() === l;
          return (
            <button
              key={l}
              type="button"
              onClick={() => { if (available) setLetter(active ? '' : l); }}
              aria-pressed={active}
              className={available && !active ? 'hover:bg-muted' : ''}
              style={{
                width: '1.75rem',
                height: '1.75rem',
                borderRadius: '0.25rem',
                border: 'none',
                backgroundColor: active ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : undefined,
                color: active ? 'var(--primary)' : 'var(--foreground)',
                fontSize: '0.6875rem',
                fontWeight: active ? 600 : 400,
                cursor: available ? 'pointer' : 'default',
                opacity: available ? 1 : 0.25,
                flexShrink: 0,
                transition: 'background-color 0.15s',
              }}
            >
              {l}
            </button>
          );
        })}
      </div>

      {visibleResults.length === 0 ? (
        <div className="py-8 text-center" style={{ fontSize: '0.9375rem' }}>
          <p className="text-muted-foreground">{t('noResults')}</p>
          {dernierFiltre && sansDernier !== null && (
            <p style={{ marginTop: '0.875rem', fontSize: '0.875rem', color: 'var(--card-foreground)' }}>
              {tCommon('withoutFilter', { value: libelleDe(dernierFiltre) ?? '', count: sansDernier })}{' '}
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
        <>
          <ul className="liste-cascade">
            {visibleResults.map((a) => {
              const civPrefix = a.civ === 'Mme' ? 'Mme ' : a.civ === 'M.' ? 'M. ' : '';
              const subtitle = a.est_ministre_actuel ? a.ministere_libelle : a.groupe_libelle;
              const coche = choisis.some((c) => c.uid === a.uid);
              // Grisé : ministre (hors score), ou élu de l'autre chambre que le premier
              // coché (le score est un classement interne à une chambre). Une paire
              // complète n'a pas besoin de cas : la modale s'ouvre et couvre la liste.
              const bloque = !coche && (chambreDe(a) === null
                || (chambreChoisie !== null && chambreDe(a) !== chambreChoisie));
              const contenu = (
                    <div className="flex items-center gap-3" style={{ padding: '12px 16px' }}>
                      {comparaison && (
                        <span
                          aria-hidden
                          style={{
                            display: 'grid',
                            placeItems: 'center',
                            width: 20,
                            height: 20,
                            flexShrink: 0,
                            borderRadius: 9999,
                            border: `1.5px solid ${coche ? 'var(--primary)' : 'var(--border)'}`,
                            backgroundColor: coche ? 'var(--primary)' : 'transparent',
                            color: 'var(--primary-foreground)',
                          }}
                        >
                          {coche && <Check strokeWidth={3} style={{ width: 12, height: 12 }} />}
                        </span>
                      )}
                      <PhotoEluVignette acteur={a} taille={36} />
                      <div className="min-w-0 flex-1">
                      {/* Ligne 1 : nom, logo du groupe, badge rôle */}
                      <div className="flex items-center justify-between gap-2 min-w-0">
                        <h3 className="text-base font-semibold leading-snug min-w-0 truncate">
                          {civPrefix}{a.prenom} {a.nom}
                        </h3>
                        {/* Le logo va à droite, et non devant le nom, pour que les
                            noms restent alignés d'une ligne à l'autre. Un groupe
                            sans fichier de logo n'affiche rien (`GroupLogoImage`). */}
                        {a.groupe_uid && (
                          <span className="shrink-0 elu-logo-groupe" style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 'auto' }}>
                            <GroupLogoImage
                              key={a.groupe_uid}
                              groupeUid={a.groupe_uid}
                              imgStyle={{ height: 20, width: 'auto', maxWidth: 56 }}
                            />
                          </span>
                        )}
                        {badgeRole(a) && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                            {badgeRole(a)}
                          </span>
                        )}
                      </div>
                      {/* Ligne 2 : groupe · département */}
                      {(subtitle || a.departement_election) && (
                        <div className="flex items-center gap-1.5 min-w-0" style={{ marginTop: '0.125rem' }}>
                          {subtitle && (
                            <span className="text-xs text-muted-foreground min-w-0 truncate">{subtitle}</span>
                          )}
                          {subtitle && a.departement_election && (
                            <span className="text-border shrink-0 text-xs">·</span>
                          )}
                          {a.departement_election && (
                            <span className="text-xs text-muted-foreground shrink-0">{a.departement_election}</span>
                          )}
                        </div>
                      )}
                      </div>
                    </div>
              );
              return (
                <li
                  key={a.uid}
                  className={bloque ? undefined : 'transition-colors hover:bg-muted/50'}
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  {comparaison ? (
                    // Le bouton se pose par-dessus la ligne au lieu de l'envelopper : un
                    // bouton ne peut contenir ni titre ni bloc, et le nom de chaque élu
                    // doit rester un titre pour qui navigue par titres au lecteur d'écran.
                    <div style={{ position: 'relative', opacity: bloque ? 0.4 : 1 }}>
                      {contenu}
                      <button
                        type="button"
                        disabled={bloque}
                        aria-pressed={coche}
                        aria-label={`${civPrefix}${a.prenom ?? ''} ${a.nom ?? ''}`.trim()}
                        onClick={() => basculerChoix(a)}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          padding: 0,
                          border: 'none',
                          background: 'none',
                          cursor: bloque ? 'default' : 'pointer',
                        }}
                      />
                    </div>
                  ) : (
                    <Link href={`/les-elus/${a.uid}`} prefetch={false} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                      {contenu}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          {hasMore && <LoadMoreButton onClick={loadMore} />}
        </>
      )}
      </>)}

      <ComparerElusModal
        elus={choisis.length === 2 ? [choisis[0], choisis[1]] : null}
        onRemplacer={(rang, acteur) => setChoisis((c) => c.map((x, i) => (i === rang ? acteur : x)))}
        onClose={quitterComparaison}
      />
    </div>
  );
}
