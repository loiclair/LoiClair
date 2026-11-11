'use client';

// Recherche globale du menu du haut : une loupe ronde et une fenêtre plein écran,
// posée sur la page floutée, qui cherche à la fois dans les pages du site, les
// élus et les textes. Champ vide, elle propose quatre exemples d'analyses. Rendu
// deux fois par `TopNav`, une fois dans le cluster du bureau et une fois à côté
// du burger mobile ; seule l'instance visible répond au clavier.
//
// Tout se cherche dans le navigateur (D-020, D-021) : la requête ne part jamais
// sur le réseau, ni dans `?q=`. « Voir les N élus / textes » passe la requête en
// fragment (`#q=`), que le navigateur n'envoie pas au serveur. Les deux index ne
// se chargent qu'à la première ouverture, pour qu'aucune page ne s'alourdisse ;
// leurs promesses restant en mémoire, aller ensuite sur Textes ou Élus ne
// retélécharge rien.

import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ArrowRight, ChartColumn, FileText, Loader2, Search, X } from 'lucide-react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import { FACTS_ARTICLES, type FactsArticle, type FactsHref } from '@/lib/facts-registry';
import { loadActeurIndex, filterActeurs, libelleMandat, type ActeurIndex, type ActeurMeta } from '@/lib/search/acteur-index';
import { ecrireFiltreMesElus } from '@/lib/search/filtre-mes-elus';
import { chargerIndexDossiers, relancerIndexDossiers, type DossierIndex, type DossierMeta } from '@/lib/search/dossier-index';
import { searchDossiers } from '@/lib/search/search-dossiers';
import { useSitePages } from '@/lib/search/site-pages';
import { translateStatut } from '@/lib/statut';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';

const MAX_PAGES = 3;
const MAX_ELUS = 5;
const MAX_TEXTES = 5;
// Même plafond que la liste de `/dossiers-legislatifs` (`MAX_SEARCH_RESULTS`),
// pour que « Voir les N textes » annonce le nombre que la page affichera.
const PLAFOND_TEXTES = 1000;
const LONGUEUR_MIN = 2;
const DELAI_FRAPPE_MS = 100;
const TAILLE_VIGNETTE = 32;

// Exemples d'analyses montrés sous le champ vide, choisis à la main. On garde
// l'adresse et non le titre : la question se lit dans le registre des faits, déjà
// traduite, et un article renommé ou déplacé casse `typecheck` au lieu de laisser
// une carte morte.
const EXEMPLES = [
  '/Facts/taux-application',
  '/Facts/budget/assemblee-nationale',
  '/Facts/participation',
  '/Facts/cumul-des-mandats',
] as const satisfies readonly FactsHref[];
const ARTICLES_EXEMPLES: FactsArticle[] = EXEMPLES.flatMap((href) => FACTS_ARTICLES.filter((a) => a.href === href));

/** Recadre une photo Unsplash du registre (800 × 500) en carré de `cote` px,
 *  densité double, pour ne pas télécharger la photo de la une dans une vignette.
 *  Le recadrage se fait dans l'adresse source : l'optimiseur de Next ne réduit
 *  que la largeur et garderait le format 16:10. */
function vignetteUnsplash(url: string, cote: number): string {
  const u = new URL(url);
  u.searchParams.set('w', String(cote * 2));
  u.searchParams.set('h', String(cote * 2));
  u.searchParams.set('fit', 'crop');
  return u.toString();
}

/** Un index en cours de chargement (`null`), prêt, ou en échec. */
type EtatIndex<T> = T | null | 'erreur';

/** Une ligne de résultat, dans l'ordre où les flèches la parcourent. */
type Entree = {
  id: string;
  href: string;
  /** Fragment à poser quand la liste visée est déjà la page ouverte. */
  fragment?: string;
  /** « Voir les N élus » : retire le filtre « Mes élus » en ouvrant la liste. */
  retireMesElus?: boolean;
  contenu: ReactNode;
};

/** Vrai quand la frappe vise déjà un champ : `/` doit alors s'y écrire. */
function saisieEnCours(cible: EventTarget | null): boolean {
  if (!(cible instanceof HTMLElement)) return false;
  return cible.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(cible.tagName);
}

/**
 * Loupe et fenêtre de recherche. Les deux instances de `TopNav` (cluster du
 * bureau, à côté du burger) rendent la même fenêtre, et c'est la visibilité de
 * la loupe qui dit laquelle répond aux raccourcis clavier. `compacte` réduit la
 * loupe à 32 px pour le bureau, à côté de la pill « S'abonner » de 31 px (les
 * deux tailles reprises d'USAFacts) ; le mobile garde 40 px, la cible se visant
 * au doigt.
 */
export default function RechercheGlobale({ compacte = false }: { compacte?: boolean }) {
  const t = useTranslations('rechercheGlobale');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tailleLoupe = compacte ? '2rem' : '2.5rem';
  const tailleIcone = compacte ? 16 : 18;
  const tElus = useTranslations('elus');
  const tDossiers = useTranslations('dossiers');
  // Sur /en, le titre d'un texte est sa traduction par l'IA quand elle existe.
  const locale = useLocale();
  const tKpisHub = useTranslations('kpisHub');
  const pathname = usePathname();
  const router = useRouter();
  const sitePages = useSitePages();

  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [requete, setRequete] = useState('');
  const [actif, setActif] = useState(0);
  const [acteurs, setActeurs] = useState<EtatIndex<ActeurIndex>>(null);
  const [dossiers, setDossiers] = useState<EtatIndex<DossierIndex>>(null);
  const [textes, setTextes] = useState<{ q: string; liste: DossierMeta[] } | null>(null);
  const declencheurRef = useRef<HTMLSpanElement>(null);
  const champRef = useRef<HTMLInputElement>(null);
  const chargementLance = useRef(false);
  // Vrai entre un appui commencé dans le vide de la fenêtre et son `click`.
  const appuiDansLeVide = useRef(false);

  // L'index des textes arrive en plusieurs temps (liste, puis résumés) : chaque
  // version publiée relance la recherche en cours, par la dépendance `dossiers`.
  const desabonnerDossiers = useRef<(() => void) | null>(null);
  function chargerIndex() {
    // Réouverture après un échec : seul l'index en erreur est retenté, une fois par
    // ouverture. Rien ne relance de lui-même, un réseau absent ne boucle donc pas.
    // L'abonnement aux dossiers reste en place et reçoit le nouvel index.
    if (chargementLance.current) {
      if (acteurs === 'erreur') {
        setActeurs(null);
        loadActeurIndex().then(setActeurs, () => setActeurs('erreur'));
      }
      if (dossiers === 'erreur') {
        setDossiers(null);
        relancerIndexDossiers();
      }
      return;
    }
    chargementLance.current = true;
    loadActeurIndex().then(setActeurs, () => setActeurs('erreur'));
    // La liste des textes a pu échouer avant cette première ouverture : retentée
    // tout de suite, avant l'abonnement, qui recevrait sinon l'échec passé. Sans
    // effet si rien n'a échoué.
    relancerIndexDossiers();
    // La republication finale porte le même index sous un autre objet : l'état
    // précédent est gardé, pour ne pas relancer la recherche pour rien.
    desabonnerDossiers.current = chargerIndexDossiers(
      (idx) => setDossiers((p) => (p && p !== 'erreur' && p.minisearch === idx.minisearch ? p : idx)),
      () => setDossiers('erreur')
    );
  }
  useEffect(() => () => desabonnerDossiers.current?.(), []);

  function changerOuverture(v: boolean) {
    if (v) chargerIndex();
    else { setSaisie(''); setRequete(''); }
    setOuvert(v);
  }

  // Fermée à chaque changement de page, retour arrière compris. Ajustement
  // pendant le rendu plutôt qu'en effet, comme `NavigationOverlay`.
  const [dernierPathname, setDernierPathname] = useState(pathname);
  if (pathname !== dernierPathname) {
    setDernierPathname(pathname);
    setOuvert(false);
    setSaisie('');
    setRequete('');
  }

  // ⌘K / Ctrl K bascule, `/` ouvre : raccourcis usuels des sites, laissés sans
  // indice à l'écran pour garder la loupe du menu épurée. Les deux instances
  // écoutent ; celle dont le déclencheur est masqué (bureau sur mobile, ou
  // l'inverse) s'abstient, sinon deux fenêtres s'ouvriraient l'une sur l'autre.
  // `useEffectEvent` lit l'état courant sans réinscrire l'écouteur à chaque rendu.
  const auClavier = useEffectEvent((e: KeyboardEvent) => {
    if (!declencheurRef.current || declencheurRef.current.getClientRects().length === 0) return;
    const touche = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && touche === 'k') {
      e.preventDefault();
      changerOuverture(!ouvert);
    } else if (touche === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !ouvert && !saisieEnCours(e.target)) {
      e.preventDefault();
      changerOuverture(true);
    }
  });
  useEffect(() => {
    const ecouteur = (e: KeyboardEvent) => auClavier(e);
    window.addEventListener('keydown', ecouteur);
    return () => window.removeEventListener('keydown', ecouteur);
  }, []);

  // La requête suit la frappe avec un léger retard : chaque touche ne relance pas
  // trois recherches, et le résultat reste instantané à l'œil.
  useEffect(() => {
    const id = window.setTimeout(() => setRequete(saisie.trim()), DELAI_FRAPPE_MS);
    return () => window.clearTimeout(id);
  }, [saisie]);

  const assezLongue = requete.length >= LONGUEUR_MIN;
  // Lus sur la saisie brute, pas sur `requete` qui la suit avec 100 ms de retard :
  // les exemples s'effacent dès la première lettre, et les résultats d'une
  // requête précédente ne restent pas affichés le temps que `requete` rattrape
  // un champ qu'on vient de vider ou de raccourcir sous deux lettres.
  const champVide = saisie.trim() === '';
  const afficheResultats = assezLongue && saisie.trim().length >= LONGUEUR_MIN;

  // `searchDossiers` est asynchrone : le résultat garde la requête qui l'a
  // produit, pour ne jamais afficher les textes d'une frappe précédente.
  useEffect(() => {
    if (!assezLongue || !dossiers || dossiers === 'erreur') return;
    let annule = false;
    searchDossiers(dossiers, requete, PLAFOND_TEXTES)
      .then((liste) => { if (!annule) setTextes({ q: requete, liste }); })
      .catch(() => { if (!annule) setTextes({ q: requete, liste: [] }); });
    return () => { annule = true; };
  }, [dossiers, requete, assezLongue]);

  // Mémorisés : le survol d'une ligne relance un rendu (`setActif`), et chaque
  // rendu referait sinon deux recherches MiniSearch pour la même requête.
  const pages = useMemo(
    () => (assezLongue ? sitePages.chercher(requete).slice(0, MAX_PAGES) : []),
    [sitePages, requete, assezLongue]
  );
  // `filterActeurs` écarte déjà les élus sans mandat en cours.
  const elus: ActeurMeta[] | null = useMemo(
    () => (!assezLongue || acteurs === 'erreur' ? [] : acteurs ? filterActeurs(acteurs, { query: requete }) : null),
    [acteurs, requete, assezLongue]
  );
  const textesTrouves: DossierMeta[] | null =
    !assezLongue ? [] : dossiers === 'erreur' ? [] : textes?.q === requete ? textes.liste : null;

  // Nouvelle requête : la sélection revient en tête.
  const [requeteActive, setRequeteActive] = useState(requete);
  if (requete !== requeteActive) {
    setRequeteActive(requete);
    setActif(0);
  }

  const fragmentQ = new URLSearchParams({ q: requete }).toString();
  const voirTout = (chemin: string, libelle: string): Entree => ({
    id: `voir-${chemin}`,
    href: `${chemin}#${fragmentQ}`,
    fragment: pathname === chemin ? fragmentQ : undefined,
    contenu: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--primary)' }}>
        {libelle}
        <ArrowRight aria-hidden style={{ width: 14, height: 14 }} />
      </span>
    ),
  });

  // Vignette au même gabarit que la photo d'un élu : la photo de l'article pour
  // les pages du registre des faits, un carré neutre pour les autres, pour que
  // les titres restent alignés d'une ligne à l'autre.
  const cadreVignette: React.CSSProperties = {
    width: TAILLE_VIGNETTE,
    height: TAILLE_VIGNETTE,
    borderRadius: '8px',
    flexShrink: 0,
    backgroundColor: 'var(--muted)',
  };
  const entreesPages: Entree[] = pages.map((p) => ({
    id: `page-${p.href}`,
    href: p.href,
    contenu: (
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
        {p.image ? (
          // Décorative, comme la photo d'un élu : le titre est lu juste à côté.
          // `next/image` et non `<img>` : l'optimiseur télécharge la photo côté serveur
          // et la sert depuis notre domaine. Un `<img>` direct enverrait l'adresse IP du
          // lecteur à Unsplash dès qu'une page Faits correspond à sa recherche, ce que
          // la politique de confidentialité exclut (la recherche ne quitte pas l'appareil).
          // Le carré est recadré dans l'adresse source (`vignetteUnsplash`) ; Next le sert tel quel.
          <Image
            src={vignetteUnsplash(p.image, TAILLE_VIGNETTE)}
            alt=""
            aria-hidden
            width={TAILLE_VIGNETTE}
            height={TAILLE_VIGNETTE}
            style={{ ...cadreVignette, objectFit: 'cover' }}
          />
        ) : (
          <span aria-hidden style={{ ...cadreVignette, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted-foreground)' }}>
            <FileText style={{ width: 16, height: 16 }} />
          </span>
        )}
        <span style={{ display: 'block', minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.35 }}>{p.titre}</span>
          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: '0.125rem' }}>{p.famille}</span>
        </span>
      </span>
    ),
  }));

  const entreesElus: Entree[] = (elus ?? []).slice(0, MAX_ELUS).map((a) => ({
    id: `elu-${a.uid}`,
    href: `/les-elus/${a.uid}`,
    contenu: (
      <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
        <PhotoEluVignette acteur={a} taille={32} />
        <span style={{ display: 'block', minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.35, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {a.prenom} {a.nom}
          </span>
          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: '0.125rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {libelleMandat(a, tElus)}{a.departement_election ? ` · ${a.departement_election}` : ''}
          </span>
        </span>
      </span>
    ),
  }));
  if (elus && elus.length > MAX_ELUS) {
    entreesElus.push({ ...voirTout('/les-elus', t('voirElus', { count: elus.length })), retireMesElus: true });
  }

  const entreesTextes: Entree[] = (textesTrouves ?? []).slice(0, MAX_TEXTES).map((d) => ({
    id: `texte-${d.uid}`,
    href: `/dossiers-legislatifs/${d.uid}/resume-ia`,
    contenu: (
      <span style={{ display: 'block', minWidth: 0 }}>
        <span
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            fontSize: '0.9375rem',
            fontWeight: 500,
            lineHeight: 1.35,
          }}
        >
          {titreDossier(d, locale)}
        </span>
        {d.statut_final && (
          <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--muted-foreground)', marginTop: '0.125rem' }}>
            {translateStatut(d.statut_final, tDossiers)}
          </span>
        )}
      </span>
    ),
  }));
  if (textesTrouves && textesTrouves.length > MAX_TEXTES) {
    entreesTextes.push(voirTout('/dossiers-legislatifs', t('voirTextes', { count: textesTrouves.length })));
  }

  const toutes = [...entreesPages, ...entreesElus, ...entreesTextes];
  const toutCharge = elus !== null && textesTrouves !== null;
  // Un index en échec rend une liste vide : sans cette garde, « Aucun résultat »
  // masquerait le « Recherche indisponible » de son groupe.
  const aucunResultat =
    afficheResultats && toutCharge && toutes.length === 0 && acteurs !== 'erreur' && dossiers !== 'erreur';

  function aller(e: Entree) {
    changerOuverture(false);
    // La liste doit montrer les N annoncés : « Mes élus », gardé hors du hash, se
    // retire à part, et le fragment remplace les filtres du hash.
    if (e.retireMesElus) ecrireFiltreMesElus(null);
    // Liste déjà ouverte : seul le fragment change. `pushState` n'émet pas
    // le `hashchange` que la liste écoute (`useHashQuery`) : on l'émet à la main,
    // comme `writeHashParam`. Un `router.push` ne l'émettrait pas non plus.
    if (e.fragment) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}#${e.fragment}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      router.push(e.href);
    }
  }

  function auClavierChamp(ev: React.KeyboardEvent<HTMLInputElement>) {
    if (!afficheResultats || toutes.length === 0) return;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActif((i) => (i + 1) % toutes.length); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActif((i) => (i - 1 + toutes.length) % toutes.length); }
    else if (ev.key === 'Enter' && !ev.nativeEvent.isComposing) { ev.preventDefault(); aller(toutes[Math.min(actif, toutes.length - 1)]); }
  }

  // La ligne choisie au clavier reste visible quand la liste défile.
  const idActif = toutes[actif]?.id;
  useEffect(() => {
    if (idActif) document.getElementById(`rg-${idActif}`)?.scrollIntoView({ block: 'nearest' });
  }, [idActif]);

  let rang = 0;
  // `badge` suit l'intitulé du groupe : chaque entrée est un lien, où il ne peut pas entrer.
  const groupe = (titre: string, entrees: Entree[], enChargement: boolean, enErreur: boolean, badge?: ReactNode) => {
    if (entrees.length === 0 && !enChargement && !enErreur) return null;
    return (
      <div role="group" aria-label={titre} style={{ paddingBottom: '0.5rem' }}>
        <div style={{ padding: '0.5rem 0.75rem 0.25rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--muted-foreground)' }}>
          {titre}
          {badge && <span style={{ marginLeft: '6px' }}>{badge}</span>}
        </div>
        {(enChargement || enErreur) && (
          <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.375rem 0.75rem', fontSize: '0.8125rem', color: 'var(--muted-foreground)', margin: 0 }}>
            {enChargement && <Loader2 className="animate-spin" aria-hidden style={{ width: 14, height: 14 }} />}
            {enChargement ? t('chargement') : t('indisponible')}
          </p>
        )}
        {entrees.map((e) => {
          const i = rang++;
          const estActif = i === actif;
          return (
            <Link
              key={e.id}
              id={`rg-${e.id}`}
              role="option"
              aria-selected={estActif}
              href={e.href}
              prefetch={false}
              onMouseMove={() => { if (!estActif) setActif(i); }}
              onClick={(ev) => {
                if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
                ev.preventDefault();
                aller(e);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0.5rem 0.75rem',
                borderRadius: '0.5rem',
                backgroundColor: estActif ? 'var(--muted)' : 'transparent',
                color: 'var(--foreground)',
                textDecoration: 'none',
              }}
            >
              {e.contenu}
            </Link>
          );
        })}
      </div>
    );
  };

  // Pilule, comme les champs de recherche de l'accueil, de Textes et d'Élus.
  const stylePilule: React.CSSProperties = {
    alignItems: 'center',
    backgroundColor: 'var(--color-card)',
    border: '1px solid var(--border)',
    borderRadius: '9999px',
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  };

  const carteExemple = (a: FactsArticle, numero: number) => {
    const entree: Entree = { id: `exemple-${a.href}`, href: a.href, contenu: null };
    return (
      <li key={a.href} style={{ display: 'flex' }}>
        <Link
          href={a.href}
          prefetch={false}
          onClick={(ev) => {
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
            ev.preventDefault();
            aller(entree);
          }}
          // Ligne compacte sur téléphone (numéro, question, flèche à droite) pour
          // que les quatre tiennent sans défiler ; carte en colonne au-dessus,
          // la flèche poussée en bas par la question qui prend la place libre.
          className="flex flex-row items-center sm:flex-col sm:items-start"
          style={{
            flex: 1,
            gap: '0.75rem',
            padding: '1rem 1.125rem',
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: '1rem',
            color: 'var(--foreground)',
            textDecoration: 'none',
            transition: 'border-color 150ms',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          <span aria-hidden style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--primary)', flexShrink: 0, minWidth: '1rem' }}>
            {numero}
          </span>
          <span style={{ flex: 1, fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.35 }}>
            {tKpisHub(a.titleKey)}
          </span>
          <span
            aria-hidden
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              width: '2rem', height: '2rem', borderRadius: '9999px',
              backgroundColor: 'var(--primary)', color: 'var(--primary-foreground)',
            }}
          >
            <ArrowRight style={{ width: 16, height: 16 }} />
          </span>
        </Link>
      </li>
    );
  };

  return (
    <Dialog open={ouvert} onOpenChange={changerOuverture}>
      <span ref={declencheurRef} style={{ display: 'inline-flex', alignItems: 'center' }}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={t('ouvrir')}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: tailleLoupe, height: tailleLoupe, borderRadius: '9999px',
              backgroundColor: 'var(--muted)', color: 'var(--foreground)',
              border: 'none', cursor: 'pointer', transition: 'background-color 150ms',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--muted)'; }}
          >
            <Search aria-hidden style={{ width: tailleIcone, height: tailleIcone }} />
          </button>
        </DialogTrigger>
      </span>

      {/* Pas `DialogContent` : il impose son voile noir et sa boîte centrée. On
          compose les primitives pour une fenêtre plein écran, transparente. */}
      <DialogPortal>
        {/* Flou et voile sur un seul élément, qui porte aussi le fondu de Radix.
            Deux couches dans un parent animé en opacité casseraient le flou
            (cf. `VoileFlou`) ; ici rien ne s'anime au-dessus du `backdrop-filter`. */}
        <DialogOverlay
          className="bg-transparent duration-300"
          style={{
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            backgroundColor: 'color-mix(in srgb, var(--background) 75%, transparent)',
          }}
        />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => { e.preventDefault(); champRef.current?.focus(); }}
          // Le voile est sous cette boîte plein écran : un clic dans le vide ne
          // l'atteint jamais. On ferme donc au clic sur la boîte elle-même, et
          // au `click`, pas au `pointerdown` : sur téléphone, un doigt posé dans
          // le vide pour faire défiler les résultats fermerait la fenêtre (le
          // défilement annule le `click`, pas le `pointerdown`). L'appui doit
          // aussi avoir commencé dans le vide, hors de la barre de défilement
          // (`offsetX` au-delà de `clientWidth`) : sinon saisir la barre, ou
          // sélectionner le texte du champ en relâchant à côté, fermerait aussi.
          onPointerDown={(e) => {
            appuiDansLeVide.current = e.target === e.currentTarget && e.nativeEvent.offsetX < e.currentTarget.clientWidth;
          }}
          onClick={(e) => {
            if (appuiDansLeVide.current && e.target === e.currentTarget) changerOuverture(false);
            appuiDansLeVide.current = false;
          }}
          // Fondu sur 0,3 s et léger glissement vers le bas : à 0,2 s sans
          // mouvement, l'ouverture se lisait comme une apparition sèche. Avec le
          // mouvement réduit demandé par le système, il ne reste que le fondu.
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-4 data-[state=closed]:slide-out-to-top-4 motion-reduce:data-[state=open]:slide-in-from-top-0 motion-reduce:data-[state=closed]:slide-out-to-top-0 duration-300 ease-out outline-none"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '1.25rem 1rem 2rem',
            overflowY: 'auto',
          }}
        >
          <DialogTitle className="sr-only">{t('titre')}</DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label={tCommon('close')}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                width: '2.75rem', height: '2.75rem', borderRadius: '9999px',
                backgroundColor: 'var(--card)', color: 'var(--foreground)',
                border: '1px solid var(--border)', boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.08)',
                cursor: 'pointer',
              }}
            >
              <X aria-hidden style={{ width: 18, height: 18 }} />
            </button>
          </DialogClose>

          <div style={{ width: '100%', maxWidth: '56rem', marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ ...stylePilule, display: 'flex', gap: '0.75rem', height: '3.5rem', padding: '0 1.25rem 0 1.5rem' }}>
              <input
                ref={champRef}
                type="text"
                role="combobox"
                aria-expanded={afficheResultats && toutes.length > 0}
                aria-controls="rg-resultats"
                aria-activedescendant={afficheResultats && idActif ? `rg-${idActif}` : undefined}
                aria-autocomplete="list"
                aria-label={t('titre')}
                placeholder={t('champ')}
                value={saisie}
                onChange={(e) => setSaisie(e.target.value)}
                onKeyDown={auClavierChamp}
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                // 16 px au moins : en dessous, Safari iOS zoome la page à la mise au point.
                style={{ flex: 1, minWidth: 0, fontSize: '1.0625rem', border: 'none', outline: 'none', background: 'transparent', color: 'var(--foreground)' }}
              />
              <Search aria-hidden style={{ width: 20, height: 20, flexShrink: 0, color: 'var(--muted-foreground)' }} />
            </div>

            {champVide && (
              <section aria-labelledby="rg-exemples">
                <h2
                  id="rg-exemples"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0 0 0.75rem', fontSize: '0.875rem', fontWeight: 600, color: 'var(--muted-foreground)' }}
                >
                  <ChartColumn aria-hidden style={{ width: 16, height: 16 }} />
                  {t('exemples')}
                </h2>
                <ul className="grid grid-cols-1 sm:grid-cols-4" style={{ gap: '0.75rem', listStyle: 'none', margin: 0, padding: 0 }}>
                  {ARTICLES_EXEMPLES.map((a, i) => carteExemple(a, i + 1))}
                </ul>
              </section>
            )}

            {afficheResultats && (
              <div
                id="rg-resultats"
                role="listbox"
                aria-label={t('titre')}
                style={{
                  padding: '0.5rem',
                  backgroundColor: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: '1rem',
                  boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.08)',
                }}
              >
                {aucunResultat ? (
                  <p style={{ padding: '1.5rem 0.75rem', margin: 0, textAlign: 'center', fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
                    {t('aucunResultat', { q: requete })}
                  </p>
                ) : (
                  <>
                    {groupe(t('groupePages'), entreesPages, false, false)}
                    {groupe(tNav('elus'), entreesElus, elus === null, acteurs === 'erreur')}
                    {groupe(tNav('textes'), entreesTextes, textesTrouves === null, dossiers === 'erreur',
                      textesTrouves?.slice(0, MAX_TEXTES).some((d) => titreTraduit(d, locale)) ? <AIBadgeTitre pluriel /> : undefined)}
                  </>
                )}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
