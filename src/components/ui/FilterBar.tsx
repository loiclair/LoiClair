'use client';

// Rangée de filtres en menus déroulants, posée sous le champ de recherche de
// /dossiers-legislatifs, /les-elus et « Ce qui me concerne ». Un menu coche
// plusieurs valeurs, qui s'additionnent (« ou ») ; les menus entre eux se
// combinent (« et »), ce que font les pages appelantes. Un clic coche ou décoche
// sans refermer le menu ; `choixUnique` garde l'ancien geste (une valeur, menu
// refermé) pour les menus dont les valeurs s'emboîtent ou s'excluent.
// Un filtre est par défaut une clé du hash, ses valeurs séparées par une virgule
// (`#statut=promulguee,appliquee&age=moins_6m`, voir `lireListe` de
// `use-hash-filter`, D-021). Un filtre propre au navigateur passe par `value` et
// `onChange`, une pastille qui n'est qu'un geste par `onPress`.
// Les libellés arrivent en props, comme pour tout composant de `ui/` ; seul le
// format des nombres et de la ponctuation suit `useLocale`.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Check, ChevronDown, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { normalizeFr } from '@/lib/search/normalize';
import { ecrireListe, lireListe, useHashParams, writeHashParam, writeHashParams } from '@/lib/search/use-hash-filter';

export type FilterBarOption = {
  slug: string;
  libelle: string;
  /** Nombre de résultats de cette valeur seule, les autres menus restant posés. Ce
   *  n'est plus ce que donnerait le clic quand d'autres valeurs du même menu sont
   *  déjà cochées : elles s'additionnent. */
  count?: number;
  /** Croix au bout de la ligne, qui retire la valeur elle-même (un profil de « Ce qui
   *  me concerne ») sans refermer le menu. `label` est son nom accessible. */
  retirer?: { label: string; onSelect: () => void };
};

/** Geste d'un menu (Changer, Oublier). L'icône prend la colonne de la coche. */
export type FilterBarAction = { label: string; onSelect: () => void; icon?: ReactNode };

export type FilterBarFacet = {
  /** Clé du hash, ou simple identifiant d'un filtre piloté par `value` et `onChange`. */
  key: string;
  /** Nom court, affiché tant que le filtre est inactif, puis en infobulle. */
  label: string;
  /** Première ligne du menu, qui remet le filtre à zéro. */
  allLabel: string;
  options: FilterBarOption[];
  /** Contenu affiché à gauche de la liste, sur ordinateur seulement (la carte des
   *  départements). Reçoit le geste d'un clic sur une ligne : cocher ou décocher la
   *  valeur, ou la choisir et refermer le menu en `choixUnique`. */
  aside?: (choose: (slug: string) => void) => ReactNode;
  /** Valeurs cochées et écriture d'un filtre qui ne vit pas dans le hash (« Mes élus » :
   *  propre au navigateur, il n'a pas sa place dans un lien partagé). Les deux vont
   *  ensemble. Liste vide : aucun filtre. */
  value?: string[];
  onChange?: (slugs: string[]) => void;
  /** Une seule valeur à la fois : un clic la remplace et referme le menu. Pour les
   *  valeurs emboîtées (1, 3, 6, 12 derniers mois : en cocher deux vaut la plus
   *  large) ou dont le cumul vaut « Tous » (articles et amendements). */
  choixUnique?: boolean;
  /** Texte de la pastille quand plusieurs valeurs sont cochées, à la place de
   *  « {label} · n » : un `label` qui porte déjà un nombre (« Ma situation · 3 »)
   *  en aurait affiché deux. */
  libelleCoches?: (n: number) => string;
  /** Gestes affichés sous les valeurs, après un séparateur (Changer, Oublier). */
  actions?: FilterBarAction[];
  /** Pastille sans menu : un clic lance ce geste (« Identifier mes élus » ouvre la
   *  recherche par code postal). Elle s'affiche sans chevron, inactive sauf si
   *  `value` contient l'une de ses `options` : c'est alors un interrupteur (les
   *  pastilles Députés et Sénateurs), que son ✕ ou un second clic éteint. */
  onPress?: () => void;
  /** Petite icône devant le nom, pour une pastille qui n'est pas un filtre comme
   *  les autres. */
  icon?: ReactNode;
  /** Champ de filtrage même sous le seuil : une liste dont la longueur varie avec
   *  les autres filtres (les groupes, 12 à l'Assemblée et 10 au Sénat) le gardait
   *  d'un côté et le perdait de l'autre. */
  toujoursFiltrable?: boolean;
};

type Props = {
  facets: FilterBarFacet[];
  clearAllLabel: string;
  /** Nom accessible du ✕ d'un filtre actif. */
  removeLabel: string;
  /** Texte du champ qui filtre une liste longue, selon le nombre de choix. */
  filterPlaceholder: (count: number) => string;
  /** Appelé par « Tout effacer » en plus des filtres de la rangée, pour ceux qui
   *  vivent ailleurs sur la page (la lettre de /les-elus). */
  onClearAll?: () => void;
};

// Au-delà de dix valeurs, la liste ouvre sur un champ de filtrage (seuil de la
// maquette adoptée) : les départements en comptent plus de cent, les groupes une
// vingtaine, quand Statut et Date tiennent d'un coup d'œil.
const SEUIL_CHAMP = 10;

// Même seuil que le volet des votes d'un scrutin (`ScrutinVotesSheet`) : en
// dessous, le menu monte du bas, là où se trouve le pouce.
const REQUETE_MOBILE = '(max-width: 767px)';

// Place à garder sous un filtre pour que son menu s'y ouvre sans se tasser.
const PLACE_MENU = 360;

/**
 * Fait défiler la page si le filtre est trop bas pour que son menu s'ouvre dessous.
 * Les menus s'ouvrent toujours vers le bas (`avoidCollisions={false}`) : laissés à
 * eux-mêmes, ceux qui portent un champ de filtrage, plus hauts, se retournaient
 * vers le haut quand les menus courts tenaient dessous, et la rangée s'ouvrait
 * dans deux sens selon le filtre.
 */
function fairePlace(declencheur: HTMLElement) {
  const libre = window.innerHeight - declencheur.getBoundingClientRect().bottom;
  if (libre < PLACE_MENU) window.scrollBy({ top: PLACE_MENU - libre, behavior: 'smooth' });
}

// Écart minimal entre un menu et le bord de la fenêtre, celui du `maxWidth` du menu.
const MARGE_MENU = 8;

const largeurMenu = (facet: FilterBarFacet) => (facet.aside ? 640 : 300);

/**
 * Décalage vers la gauche d'un menu qui sortirait de la fenêtre par la droite.
 * `avoidCollisions={false}` coupe aussi le recalage horizontal de Radix : le menu
 * des départements, large de 640 px et accroché à la dernière pastille, dépassait
 * de 310 px dans une fenêtre de 1 000 px. Mesuré à l'ouverture, la rangée pouvant
 * avoir défilé ou la fenêtre changé de taille depuis.
 */
function decalageMenu(declencheur: HTMLElement, largeur: number): number {
  const gauche = declencheur.getBoundingClientRect().left;
  // `innerWidth` comme le `100vw` du `maxWidth`, barre de défilement comprise ;
  // le bord droit, lui, se lit sans elle. Le plancher garde le bord gauche à
  // MARGE_MENU quand le menu occupe presque toute la largeur.
  const effective = Math.min(largeur, window.innerWidth - 2 * MARGE_MENU);
  const decalage = Math.min(0, document.documentElement.clientWidth - MARGE_MENU - (gauche + effective));
  return Math.max(MARGE_MENU - gauche, decalage);
}

export default function FilterBar({ facets, clearAllLabel, removeLabel, filterPlaceholder, onClearAll }: Props) {
  const params = useHashParams();
  // Le deux-points prend une espace insécable en français et aucune en anglais.
  const deuxPoints = useLocale() === 'fr' ? '\u00a0:' : ':';
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [decalage, setDecalage] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(REQUETE_MOBILE);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync de l'état mobile avec la media query (système externe)
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => { setIsMobile(e.matches); setOpenKey(null); };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  // Les valeurs cochées d'un menu, dans l'ordre de ses options. Une valeur inconnue
  // (lien ancien, groupe dissous) est écartée seule : elle n'apparaît ni dans la
  // pastille ni dans le menu, et disparaît du hash à la prochaine écriture.
  const cochees = (facet: FilterBarFacet): FilterBarOption[] => {
    const brutes = new Set(facet.onChange ? facet.value ?? [] : lireListe(params.get(facet.key)));
    return facet.options.filter((o) => brutes.has(o.slug));
  };
  const ecrire = (facet: FilterBarFacet, slugs: string[]) => {
    if (facet.onChange) facet.onChange(slugs);
    else writeHashParam(facet.key, ecrireListe(slugs));
  };
  // Clic sur une ligne : « Tous les … » ('') vide le menu et le referme ; en choix
  // unique la valeur remplace la précédente et referme ; sinon elle se coche ou se
  // décoche, menu ouvert, la liste réécrite dans l'ordre des options pour qu'un
  // même choix donne toujours le même lien.
  const choose = (facet: FilterBarFacet, slug: string) => {
    if (!slug || facet.choixUnique) {
      ecrire(facet, slug ? [slug] : []);
      setOpenKey(null);
      return;
    }
    const suivantes = new Set(cochees(facet).map((o) => o.slug));
    if (!suivantes.delete(slug)) suivantes.add(slug);
    ecrire(facet, facet.options.map((o) => o.slug).filter((s) => suivantes.has(s)));
  };
  const agir = (action: FilterBarAction) => {
    setOpenKey(null);
    action.onSelect();
  };
  const toutEffacer = () => {
    writeHashParams(Object.fromEntries(facets.filter((f) => !f.onChange).map((f) => [f.key, ''])));
    for (const f of facets) if (f.onChange) f.onChange([]);
    onClearAll?.();
  };

  const actifs = facets.filter((f) => cochees(f).length > 0).length;
  const ouvert = facets.find((f) => f.key === openKey) ?? null;

  return (
    <div className="filter-bar">
      {facets.map((facet) => {
        const choisies = cochees(facet);
        const actif = choisies.length > 0;
        const libelles = choisies.map((o) => o.libelle).join(', ');
        // Une valeur : son libellé, comme avant le multi-choix. Plusieurs : le nom
        // du filtre et leur nombre (« Statut · 2 »), l'infobulle les nommant toutes.
        const texte = choisies.length === 1
          ? choisies[0].libelle
          : actif
            ? facet.libelleCoches?.(choisies.length) ?? `${facet.label} · ${choisies.length}`
            : facet.label;

        const bouton = (
          <button
            type="button"
            className="filter-bar-chip"
            title={actif && libelles !== facet.label ? `${facet.label}${deuxPoints} ${libelles}` : undefined}
            onClick={facet.onPress ?? (isMobile ? () => setOpenKey(facet.key) : (e) => {
              fairePlace(e.currentTarget);
              setDecalage(decalageMenu(e.currentTarget, largeurMenu(facet)));
            })}
            aria-pressed={facet.onPress && facet.options.length > 0 ? actif : undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              height: 34,
              padding: actif ? '0 2px 0 14px' : '0 12px 0 14px',
              border: 'none',
              background: 'transparent',
              color: 'inherit',
              fontSize: '0.875rem',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              cursor: 'pointer',
            }}
          >
            {facet.icon && <span aria-hidden style={{ display: 'inline-flex', flexShrink: 0 }}>{facet.icon}</span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {texte}
            </span>
            {!actif && !facet.onPress && <ChevronDown aria-hidden style={{ width: 14, height: 14, flexShrink: 0, color: 'var(--muted-foreground)' }} />}
          </button>
        );

        return (
          <span
            key={facet.key}
            className="filter-bar-pill"
            data-actif={actif || undefined}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              flex: 'none',
              maxWidth: 'var(--filter-bar-max, 240px)',
              borderRadius: 9999,
              border: `1px solid ${actif ? 'var(--primary)' : 'var(--border)'}`,
              backgroundColor: actif ? 'color-mix(in srgb, var(--primary) 10%, var(--card))' : 'var(--card)',
              color: actif ? 'var(--primary)' : 'var(--foreground)',
            }}
          >
            {isMobile || facet.onPress ? bouton : (
              <Popover open={openKey === facet.key} onOpenChange={(o) => setOpenKey(o ? facet.key : null)}>
                <PopoverTrigger asChild>{bouton}</PopoverTrigger>
                <PopoverContent
                  align="start"
                  alignOffset={decalage}
                  avoidCollisions={false}
                  sideOffset={6}
                  className="p-0"
                  style={{
                    width: largeurMenu(facet),
                    maxWidth: `calc(100vw - ${2 * MARGE_MENU}px)`,
                    // Borné par la place réellement libre sous le filtre : une liste
                    // de plus de cent départements sortait sinon du bas de l'écran.
                    maxHeight: 'min(420px, var(--radix-popover-content-available-height))',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: 0,
                    borderRadius: 12,
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'stretch', flex: '1 1 auto', minHeight: 0 }}>
                    {facet.aside && (
                      // L'aparté est posé en absolu : il prend la hauteur que la liste
                      // donne au menu sans jamais l'agrandir. La carte, haute de
                      // 535 px à sa taille propre, imposerait sinon la sienne.
                      <div style={{ flex: 1, minWidth: 0, position: 'relative', borderRight: '1px solid var(--border)' }}>
                        <div className="filter-bar-aside" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                          {facet.aside((slug) => choose(facet, slug))}
                        </div>
                      </div>
                    )}
                    <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                      <FacetMenu
                        facet={facet}
                        value={choisies.map((o) => o.slug)}
                        onChoose={(slug) => choose(facet, slug)}
                        onAction={agir}
                        filterPlaceholder={filterPlaceholder}
                      />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            )}
            {actif && (
              <button
                type="button"
                className="filter-bar-clear"
                aria-label={`${removeLabel}${deuxPoints} ${libelles}`}
                onClick={() => ecrire(facet, [])}
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 22,
                  height: 22,
                  margin: '0 8px 0 2px',
                  flexShrink: 0,
                  borderRadius: 9999,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <X aria-hidden style={{ width: 13, height: 13 }} />
              </button>
            )}
          </span>
        );
      })}

      {actifs >= 2 && (
        <button
          type="button"
          onClick={toutEffacer}
          className="filter-bar-clear-all"
          style={{
            flex: 'none',
            border: 'none',
            background: 'none',
            padding: '4px 2px',
            fontSize: '0.8125rem',
            color: 'var(--muted-foreground)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {clearAllLabel}
        </button>
      )}

      {isMobile && (
        <Sheet open={!!ouvert} onOpenChange={(o) => { if (!o) setOpenKey(null); }}>
          <SheetContent
            side="bottom"
            size="content"
            // Le clavier ne doit pas monter tout seul : sur téléphone il cacherait
            // la moitié de la liste avant même qu'on ait choisi de filtrer.
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="gap-0 p-0"
            style={{ width: '100%', maxHeight: '78vh', padding: 0, gap: 0, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}
          >
            {ouvert && (
              <>
                <SheetTitle style={{ padding: '16px 48px 8px 16px', fontSize: '0.9375rem', fontWeight: 600 }}>
                  {ouvert.label}
                </SheetTitle>
                <FacetMenu
                  facet={ouvert}
                  value={cochees(ouvert).map((o) => o.slug)}
                  onChoose={(slug) => choose(ouvert, slug)}
                  onAction={agir}
                  filterPlaceholder={filterPlaceholder}
                />
              </>
            )}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

/**
 * Contenu d'un menu : champ de filtrage pour les listes longues, ligne « Tous les … »,
 * puis une ligne par valeur avec son nombre de résultats quand il est connu, et enfin
 * les gestes du filtre s'il en a.
 * Monté à chaque ouverture, d'où un champ toujours vide en arrivant. Il remplit la
 * hauteur que lui laisse son conteneur (menu ou volet) et n'en fait défiler que la liste.
 */
function FacetMenu({
  facet,
  value,
  onChoose,
  onAction,
  filterPlaceholder,
}: {
  facet: FilterBarFacet;
  /** Valeurs cochées, toutes connues de `facet.options`. */
  value: string[];
  onChoose: (slug: string) => void;
  onAction: (action: FilterBarAction) => void;
  filterPlaceholder: (count: number) => string;
}) {
  const locale = useLocale();
  const [requete, setRequete] = useState('');
  const listeRef = useRef<HTMLDivElement>(null);
  const nf = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const long = facet.toujoursFiltrable || facet.options.length > SEUIL_CHAMP;

  const q = normalizeFr(requete.trim());
  const visibles = q
    ? facet.options.filter((o) => normalizeFr(o.libelle).includes(q))
    : facet.options;

  const ligne = (slug: string, libelle: string, count: number | undefined, tous: boolean, retirer?: FilterBarOption['retirer']) => {
    // « Tous les … » est coché quand aucune valeur ne l'est.
    const choisi = slug ? value.includes(slug) : value.length === 0;
    const bouton = (
      <button
        key={slug || '__tous'}
        type="button"
        className="filter-bar-opt"
        onClick={() => onChoose(slug)}
        aria-pressed={choisi}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          textAlign: 'left',
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          padding: '9px 10px',
          borderRadius: 8,
          fontSize: '0.875rem',
          lineHeight: 1.35,
          fontWeight: choisi ? 500 : 400,
          color: choisi ? 'var(--primary)' : tous ? 'var(--muted-foreground)' : 'var(--foreground)',
        }}
      >
        <span style={{ width: 16, flexShrink: 0, color: 'var(--primary)', display: 'inline-flex' }}>
          {choisi && <Check aria-hidden style={{ width: 16, height: 16 }} />}
        </span>
        <span style={{ minWidth: 0 }}>{libelle}</span>
        {count !== undefined && (
          <span style={{ marginLeft: 'auto', paddingLeft: 8, fontSize: '0.75rem', color: 'var(--muted-foreground)', fontVariantNumeric: 'tabular-nums' }}>
            {nf.format(count)}
          </span>
        )}
      </button>
    );
    if (!retirer) return bouton;
    // Deux boutons côte à côte : la croix ne peut pas vivre dans le bouton de la
    // ligne (un bouton n'en contient pas d'autre).
    return (
      <div key={slug} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {bouton}
        <button
          type="button"
          className="filter-bar-opt"
          onClick={() => {
            retirer.onSelect();
            // La croix disparaît avec sa ligne et le focus tomberait sur la page,
            // menu ouvert : on le pose sur la première ligne. Après le rendu, d'où
            // la frame ; si le menu s'est démonté (dernière valeur), la ref est vide.
            requestAnimationFrame(() => listeRef.current?.querySelector<HTMLElement>('.filter-bar-opt')?.focus());
          }}
          aria-label={retirer.label}
          title={retirer.label}
          style={{
            display: 'grid',
            placeItems: 'center',
            width: 36,
            height: 36,
            flexShrink: 0,
            border: 'none',
            background: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            color: 'var(--muted-foreground)',
          }}
        >
          <X aria-hidden style={{ width: 14, height: 14 }} />
        </button>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: '1 1 auto' }}>
      {long && (
        <div style={{ padding: '10px 10px 6px', borderBottom: '1px solid var(--border)' }}>
          <input
            type="search"
            value={requete}
            onChange={(e) => setRequete(e.target.value)}
            placeholder={filterPlaceholder(facet.options.length)}
            aria-label={filterPlaceholder(facet.options.length)}
            className="filter-bar-input"
            style={{
              width: '100%',
              height: 36,
              border: '1px solid var(--border)',
              borderRadius: 8,
              backgroundColor: 'var(--background)',
              color: 'var(--foreground)',
              padding: '0 10px',
              // 16 px sur téléphone : en dessous, Safari zoome la page à la saisie.
              fontSize: 16,
              outline: 'none',
            }}
          />
        </div>
      )}
      <div ref={listeRef} style={{ overflowY: 'auto', padding: 6, minHeight: 0 }}>
        {!q && ligne('', facet.allLabel, undefined, true)}
        {visibles.map((o) => ligne(o.slug, o.libelle, o.count, false, o.retirer))}
        {!q && facet.actions && facet.actions.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 6 }}>
            {facet.actions.map((a) => (
              <button
                key={a.label}
                type="button"
                className="filter-bar-opt"
                onClick={() => onAction(a)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  padding: '9px 10px',
                  borderRadius: 8,
                  fontSize: '0.875rem',
                  // Couleur du texte et non le gris secondaire : en gris, les gestes
                  // se lisaient comme des lignes désactivées.
                  color: 'var(--foreground)',
                }}
              >
                <span aria-hidden style={{ width: 16, flexShrink: 0, display: 'inline-flex', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
                  {a.icon}
                </span>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
