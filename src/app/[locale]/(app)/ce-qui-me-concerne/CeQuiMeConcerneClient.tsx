'use client';

// Partie interactive de « Ce qui me concerne » : le champ de recherche de
// /dossiers-legislatifs (`#q=` dans l'adresse), la rangée de filtres de /les-elus
// et /dossiers-legislatifs (`FilterBar`), avec « Ma situation » (profils gardés dans le
// navigateur comme « Mes élus », choisis dans la même fenêtre que « Identifier mes
// élus », et dont le menu restreint la liste à certains d'entre eux), Statut, Type,
// Groupe, Période et Thème (non gardés), le tri de la page Textes, puis la liste.
// Comme sur les autres pages, un menu coche plusieurs valeurs, sauf Type et Période
// (`choixUnique`, voir leurs constantes). À la première
// visite, un accueil montre le choix des profils à la place de la liste : tous les
// thèmes ouverts, une pastille par profil, et un bouton vers la liste. La liste a
// une section par profil choisi, dans l'ordre des pastilles, qui réunit ses
// changements de tous les textes : une ligne par changement, avec dessous sa source
// et le titre du texte. Tout le détail (phrases de chaque profil, passage cité,
// texte, amendements liés) est dans un tiroir qui s'ouvre au clic. Lignes et tiroir
// vivent dans `ChangementsConcernes`, le choix des profils dans `ChoixProfils`, les
// profils gardés dans `useMesProfils` : la fiche d'un texte s'en sert aussi (« Ce qui
// change pour vous »).
//
// Reçoit du server component l'index de tous les dossiers classés (statut, dates,
// groupe, profils, thèmes) : filtres, comptes et tri se font ici. Le contenu de tous les
// dossiers se charge en blocs fixes (`/api/ce-qui-me-concerne/tout`), avec les phrases
// de tous les profils, et la recherche se fait dessus, ici : aucune requête ne dit ce
// que le lecteur a coché ni ce qu'il cherche (D-243). Seul le tiroir demande le détail
// d'un élément, comme l'ouverture de la fiche d'une loi.
//
// Les survols passent par un état React, pas par `hover:` en Tailwind : sur Safari,
// la pipeline Tailwind v4 transforme ou supprime le CSS de survol (même contournement
// que `DossierCard`, voir ARCHITECTURE.md §Pièges Tailwind v4).

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ListFilter, Loader2, Pencil, Trash2, UserRound } from 'lucide-react';
import FilterBar, { type FilterBarFacet } from '@/components/ui/FilterBar';
import VoileFlou from '@/components/VoileFlou';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import DossiersSearchInput from '@/components/DossiersSearchInput';
import { Link } from '@/i18n/navigation';
import {
  BadgeIA, BoutonLien, LigneChangement, TiroirChangement, lignesDe, useSourceDe, type Changement,
} from '@/components/ChangementsConcernes';
import { FenetreProfils, FormulaireProfils, IntroProfils, PiedProfils } from '@/components/ChoixProfils';
import { ORDRE_PROFILS, PROFILS, lire, useMesProfils } from '@/hooks/useMesProfils';
import { useHashQuery } from '@/lib/search/use-hash-query';
import { normalizeFr } from '@/lib/search/normalize';
import type { DossierConcerne, ElementConcerne } from '@/lib/ce-qui-me-concerne';

/** L'index de la page, en tableaux pour peser peu dans le HTML : par dossier,
 *  [uid, état (0 aucun, 1 pas encore voté, 2 adopté, 3 promulgué), date de dépôt,
 *  dernière activité (AAAA-MM-JJ, vides si inconnues), rang du groupe dans `groupes`
 *  (-1 sans groupe), rangs des profils dans le catalogue, rangs des thèmes dans
 *  `themes`]. */
export type IndexConcerne = {
  /** Instant de construction de l'index, ajouté (`v=`) à l'adresse de chaque requête
   *  aux routes de la page : le CDN garde leurs réponses une journée, et sans lui un
   *  index régénéré la nuit lisait encore les blocs de la veille. */
  version: string;
  /** Nombre de blocs de `/api/ce-qui-me-concerne/tout`, tous chargés. */
  blocs: number;
  groupes: string[];
  /** Thèmes des dossiers classés, libellés déjà traduits côté serveur et triés sur
   *  eux. Le thème brut sert de valeur au filtre, jamais le libellé (CLAUDE.md
   *  §Traductions). */
  themes: { theme: string; libelle: string }[];
  dossiers: [string, number, string, string, number, number[], number[]][];
};
type LigneIndex = IndexConcerne['dossiers'][number];

const ETATS = ['aVoter', 'adopte', 'promulgue'] as const;
// Type d'une ligne : un article est dans le texte, un amendement n'en est qu'une
// modification proposée. Contrairement aux autres filtres, il écarte des lignes, pas
// des textes : il se lit sur le contenu chargé, comme la recherche.
// Une seule valeur à la fois : cocher les deux vaudrait « Tous ».
const TYPES = ['articles', 'amendements'] as const;
// Période en mois, selon la dernière activité du texte ; '' (« Toute période »)
// n'en exclut aucun. Une seule valeur à la fois : les périodes s'emboîtent, et en
// cocher deux vaudrait la plus longue.
const PERIODES = ['1', '3', '6', '12'] as const;
// Dans l'ordre des pastilles, le premier étant le tri par défaut, comme sur la page Textes.
const TRIS = ['activite', 'depot'] as const;
// Figé au chargement du module, comme `MAINTENANT` de `DossiersResultsClient` :
// `Date.now()` pendant un rendu est refusé par `react-hooks/purity`.
const MAINTENANT = Date.now();
/** Rien à écouter : seul compte le passage du rendu serveur au navigateur. */
const SANS_ABONNEMENT = () => () => {};

function dansLaPeriode(d: LigneIndex, periode: string): boolean {
  if (!periode) return true;
  if (!d[3]) return false;
  const debut = new Date(MAINTENANT);
  debut.setMonth(debut.getMonth() - Number(periode));
  return new Date(d[3]).getTime() >= debut.getTime();
}

// Une section de profil ne montre d'abord que ses premières lignes : elle réunit les
// changements de tous les textes.
const LIGNES_VISIBLES = 5;

/** Tous les dossiers classés, par uid, chargés en blocs fixes
 *  (`/api/ce-qui-me-concerne/tout`) dès que la liste s'affiche, une seule fois. Les
 *  blocs sont tous demandés et les mêmes pour tout le monde : le serveur n'apprend ni
 *  les profils cochés ni la recherche (D-243). Un bloc en échec laisse ses dossiers
 *  absents de la liste et affiche l'erreur en tête de liste. La liste n'apparaît
 *  qu'une fois tous les blocs reçus, réussis ou non (`chargement` à faux). */
function useTout(blocs: number, locale: string, version: string, actif: boolean) {
  const [charges, setCharges] = useState<Map<string, DossierConcerne>>(() => new Map());
  const [recus, setRecus] = useState(0);
  const [erreur, setErreur] = useState(false);
  // Une fois lancé, le chargement va à son terme : revenir à l'accueil puis à la liste
  // ne le relance pas.
  const [lance, setLance] = useState(false);
  if (actif && !lance) setLance(true);
  useEffect(() => {
    if (!lance) return;
    let demonte = false;
    for (let k = 0; k < blocs; k++) {
      fetch(`/api/ce-qui-me-concerne/tout?locale=${locale}&bloc=${k}&v=${version}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((d: { dossiers: DossierConcerne[] }) => {
          if (!demonte) setCharges((m) => new Map([...m, ...d.dossiers.map((x) => [x.uid, x] as const)]));
        })
        .catch(() => { if (!demonte) setErreur(true); })
        .finally(() => { if (!demonte) setRecus((n) => n + 1); });
    }
    return () => { demonte = true; };
  }, [lance, blocs, locale, version]);
  return { charges, chargement: lance && recus < blocs, erreur };
}

export default function CeQuiMeConcerneClient({ index }: { index: IndexConcerne }) {
  const t = useTranslations('ceQuiMeConcerne');
  const tDossiers = useTranslations('dossiers');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const [choisis, ecrireProfils] = useMesProfils();
  const [requete] = useHashQuery();
  // Accueil : un lecteur sans profil voit les pastilles à la place de la liste, et
  // les garde sous les yeux tant qu'il en coche (la liste qui remplaçait l'accueil
  // dès le premier clic l'empêchait d'en choisir plusieurs). Il en sort par le bouton
  // du bas (« Voir la liste complète »). Un lecteur qui revient avec des profils arrive sur la liste.
  // `null` tant que rien n'a été demandé : la vue suit alors les profils gardés, lus
  // dès que le navigateur les connaît (après l'hydratation, voir `navigateur`). Un
  // accueil posé d'office puis retiré après lecture du stockage s'affichait un
  // instant chez le lecteur qui revient avec des profils.
  const [accueil, setAccueil] = useState<boolean | null>(null);
  const accueilVisible = accueil === true || choisis.length === 0;
  // Faux au rendu serveur et pendant l'hydratation, qui ne connaissent pas les
  // profils gardés (`useMesProfils` y rend une liste vide) : la page n'affiche alors
  // que le voile de chargement, ni accueil ni liste. Vrai d'emblée quand on arrive
  // par le menu, sans hydratation.
  const navigateur = useSyncExternalStore(SANS_ABONNEMENT, () => true, () => false);
  const [fenetreProfils, setFenetreProfils] = useState(false);
  // Retirer le dernier profil réarme l'accueil : sans cela, un lecteur arrivé avec
  // des profils puis les retirant tous retombait sur un accueil que le premier clic
  // refermait, sans pouvoir en cocher d'autres. La fenêtre du choix, elle, reste
  // ouverte : la refermer d'office (« Tout effacer », ou la dernière pastille
  // décochée) renvoyait sur l'accueil au milieu d'un changement de sélection.
  // L'accueil n'apparaît qu'en la refermant sans profil. Le premier changement fige
  // la vue où il a lieu : sans cela, cocher un premier profil sur l'accueil donnait
  // une liste non vide, donc la liste.
  const changerProfils = (suivants: string[]) => {
    if (suivants.length === 0) setAccueil(true);
    else if (accueil === null) setAccueil(accueilVisible);
    setProfilFiltre((f) => f.filter((p) => suivants.includes(p)));
    ecrireProfils(suivants);
  };
  // Profils cochés dans le menu « Ma situation » (vide : tous). Lus à travers
  // `profilsActifs` : un profil retiré, ici ou dans un autre onglet, sort du filtre.
  const [profilFiltre, setProfilFiltre] = useState<string[]>([]);
  // Valeurs cochées des menus à plusieurs choix ; vide : aucun filtre.
  const [etat, setEtat] = useState<string[]>([]);
  const [type, setType] = useState('');
  const [groupe, setGroupe] = useState<string[]>([]);
  const [periode, setPeriode] = useState('');
  const [theme, setTheme] = useState<string[]>([]);
  const [tri, setTri] = useState<(typeof TRIS)[number]>(TRIS[0]);
  // Profils dont la section est dépliée en entier ; les autres montrent `LIGNES_VISIBLES`.
  const [entieres, setEntieres] = useState<Set<string>>(() => new Set());
  const [ouvert, setOuvert] = useState<{ dossier: DossierConcerne; e: ElementConcerne } | null>(null);
  const { charges, chargement, erreur } = useTout(index.blocs, locale, index.version, !accueilVisible);
  const sourceDe = useSourceDe();
  // Bas du choix (`PiedProfils`), sur l'accueil comme dans la fenêtre : sa sortie mène
  // à la liste, et n'a rien à montrer sans profil. Depuis l'accueil, elle remonte en
  // haut de la page : le lecteur est descendu pour cocher ses profils, et la liste
  // qui remplace l'accueil s'ouvrait sinon au milieu. Depuis la fenêtre, la page
  // reste où il l'a laissée.
  const pied = (dansFenetre: boolean) => (
    <PiedProfils
      dansFenetre={dansFenetre}
      onChanger={changerProfils}
      onValider={() => {
        if (!dansFenetre) window.scrollTo({ top: 0 });
        setAccueil(false);
        setFenetreProfils(false);
      }}
      libelle={t('voirListe')}
      desactiveSansProfil
    />
  );

  // Recherche, faite ici sur les dossiers chargés : chaque mot tapé doit figurer,
  // accents ignorés, dans le titre du texte, la phrase ou la provenance d'une ligne
  // d'un profil coché. Un titre qui correspond garde donc toutes ses lignes.
  const mots = normalizeFr(requete).split(/\s+/).filter(Boolean);
  const trouve = (...champs: string[]) => {
    const botte = normalizeFr(champs.join(' '));
    return mots.every((m) => botte.includes(m));
  };

  // Les lignes d'un texte pour un profil (`lignesDe`), la recherche appliquée avant le
  // retrait, puis le type (`typeV`, celui du menu sauf pour compter ses options).
  // Gardées le temps du rendu : filtres, comptes des menus et sections relisent les
  // mêmes.
  const lignesCalculees = new Map<string, Changement[]>();
  const filtre = mots.length ? trouve : undefined;
  const estDuType = (c: Changement, typeV: string) => !typeV || ('amendement' in c.e.source) === (typeV === 'amendements');
  const lignesDuTexte = (d: DossierConcerne, profil: string, typeV: string = type): Changement[] => {
    const cle = `${d.uid}|${profil}|${typeV}`;
    const dejaVues = lignesCalculees.get(cle);
    if (dejaVues) return dejaVues;
    // Articles seuls : les lignes de « Tous », triées, le retrait n'y changeant rien.
    // Amendements seuls : recalculées, car leur article n'est plus au-dessus d'eux,
    // donc pas de retrait, et leur source redit quel article ils modifient.
    const lignes = typeV === 'amendements'
      ? lignesDe(d, profil, sourceDe, { filtre, retrait: false }).filter((c) => estDuType(c, typeV))
      : typeV
        ? lignesDuTexte(d, profil, '').filter((c) => estDuType(c, typeV))
        : lignesDe(d, profil, sourceDe, { filtre });
    lignesCalculees.set(cle, lignes);
    return lignes;
  };

  // Les profils choisis dans l'ordre des pastilles, et ceux que la liste montre : tous,
  // ou ceux cochés dans le menu « Ma situation ».
  const profilsChoisis = ORDRE_PROFILS.filter((p) => choisis.includes(p));
  const profilsActifs = profilsChoisis.filter((p) => profilFiltre.includes(p));
  const profilsAffiches = profilsActifs.length ? profilsActifs : profilsChoisis;

  // Index : les dossiers d'au moins un des profils, puis, pendant une recherche ou
  // avec un type choisi, ceux qui ont une ligne qui correspond (le contenu doit donc
  // être chargé), puis les filtres. Chaque valeur d'un filtre se compte seule, les
  // autres menus appliqués : « Promulgué · 12 » dit ce que donnerait un clic tant que
  // rien n'est coché dans ce menu ; ensuite, les valeurs cochées s'additionnent.
  const okProfils = (d: LigneIndex, profils: string[]) => profils.some((p) => d[5].includes(PROFILS.indexOf(p)));
  const retenu = (d: LigneIndex, profils: string[], typeV: string = type) => {
    if (!okProfils(d, profils)) return false;
    if (!mots.length && !typeV) return true;
    const c = charges.get(d[0]);
    // Seule l'existence d'une ligne compte, et le retrait n'y change rien : les lignes
    // de « Tous » suffisent, sans recalculer celles de chaque type pour leurs comptes.
    return !!c && profils.some((p) => lignesDuTexte(c, p, '').some((l) => estDuType(l, typeV)));
  };
  const candidats = index.dossiers.filter((d) => retenu(d, profilsAffiches));
  // Chaque test reçoit les valeurs cochées d'un menu : une seule suffit à retenir le
  // texte, et une liste vide ne filtre rien.
  const okEtat = (d: LigneIndex, vs: string[]) => !vs.length || vs.some((v) => d[1] === ETATS.indexOf(v as (typeof ETATS)[number]) + 1);
  const okGroupe = (d: LigneIndex, gs: string[]) => !gs.length || gs.includes(index.groupes[d[4]]);
  // Rangs dans `index.themes`, déjà trié sur le libellé : trier les rangs suffit.
  const themesPresents = [...new Set(candidats.flatMap((d) => d[6]))].sort((a, b) => a - b);
  // Un thème coché qu'aucun texte retenu ne porte plus (situation retirée, recherche)
  // est ignoré seul, comme un profil retiré : sinon la liste se viderait derrière
  // une valeur que `FilterBar` ne montre plus, faute d'option correspondante.
  const rangsTheme = themesPresents.filter((i) => theme.includes(index.themes[i].theme));
  const okTheme = (d: LigneIndex, rs: number[]) => !rs.length || rs.some((r) => d[6].includes(r));
  const groupesPresents = [...new Set(candidats.map((d) => d[4]).filter((i) => i >= 0))]
    .map((i) => index.groupes[i]).sort((a, b) => a.localeCompare(b, locale));
  // Même règle pour le groupe : un groupe qu'aucun texte retenu ne porte plus est ignoré.
  const groupesActifs = groupe.filter((g) => groupesPresents.includes(g));
  const filtres = candidats.filter((d) => okEtat(d, etat) && okGroupe(d, groupesActifs) && dansLaPeriode(d, periode) && okTheme(d, rangsTheme));
  // Même tri que la page Textes : le plus récent d'abord, l'uid départageant les ex
  // æquo (sinon leur ordre varierait d'un rendu à l'autre).
  const colonne = tri === 'depot' ? 2 : 3;
  const tries = [...filtres].sort((a, b) => b[colonne].localeCompare(a[colonne]) || a[0].localeCompare(b[0]));
  // Une section par profil montré, ses lignes texte par texte dans l'ordre du tri :
  // les lignes d'un même texte se suivent, et un amendement reste sous son article.
  // Un article qui touche deux profils figure dans les deux sections, avec la phrase
  // propre à chacun.
  const sections = profilsAffiches.map((profil) => ({
    profil,
    lignes: tries.flatMap(([uid]) => {
      const d = charges.get(uid);
      return d ? lignesDuTexte(d, profil) : [];
    }),
  }));
  // Une autre liste ramène chaque section à ses premières lignes.
  const cleListe = `${profilsAffiches.join()}|${etat.join()}|${type}|${groupesActifs.join()}|${periode}|${rangsTheme.join()}|${tri}|${requete}`;
  const [cleVue, setCleVue] = useState(cleListe);
  if (cleVue !== cleListe) {
    setCleVue(cleListe);
    setEntieres(new Set());
  }

  // Compte de l'en-tête de liste : les articles et amendements de toutes les
  // sections, lignes repliées comprises, chacun une fois même s'il touche plusieurs
  // profils. Il ne s'affiche qu'une fois tous les blocs reçus, comme la liste.
  const nbElements = { articles: 0, amendements: 0 };
  const comptes = new Set<string>();
  for (const { lignes } of sections) {
    for (const { dossier, e } of lignes) {
      const cle = `${dossier.uid}|${e.id}`;
      if (comptes.has(cle)) continue;
      comptes.add(cle);
      nbElements['amendement' in e.source ? 'amendements' : 'articles']++;
    }
  }

  const iconeProfils = <UserRound aria-hidden style={{ width: 14, height: 14, color: 'var(--primary)' }} />;
  const facets: FilterBarFacet[] = [
    // Sur le modèle de « Mes élus » : un menu qui restreint la liste à certains des
    // profils choisis, chacun avec son nombre de textes et une croix qui le retire, et
    // sous un séparateur ses gestes : ouvrir la fenêtre du choix, ou tout oublier sans
    // l'ouvrir. Retirer le dernier profil, d'une croix ou de l'autre geste, ramène
    // l'accueil (`changerProfils`). Cocher un profil ici ne fait que filtrer la liste ;
    // le choisir ou le retirer passe par la fenêtre ou par sa croix.
    {
      // La pastille dit combien de profils la liste montre : tous, ou ceux cochés.
      key: 'profils', label: t('mesProfils', { n: choisis.length }), allLabel: t('tousMesProfils'), value: profilsActifs, onChange: setProfilFiltre,
      libelleCoches: (n) => t('mesProfils', { n }),
      options: profilsChoisis.map((p) => {
        const libelle = t(`profils.${p}`);
        return {
          slug: p,
          libelle,
          count: index.dossiers.filter((d) => okEtat(d, etat) && okGroupe(d, groupesActifs) && dansLaPeriode(d, periode) && okTheme(d, rangsTheme) && retenu(d, [p])).length,
          retirer: { label: t('retirerProfil', { profil: libelle }), onSelect: () => changerProfils(choisis.filter((c) => c !== p)) },
        };
      }),
      actions: [
        { label: t('modifierProfils'), icon: <Pencil style={{ width: 14, height: 14 }} />, onSelect: () => setFenetreProfils(true) },
        { label: t('oublierProfils'), icon: <Trash2 style={{ width: 14, height: 14 }} />, onSelect: () => changerProfils([]) },
      ],
      icon: iconeProfils,
    },
    {
      key: 'statut', label: t('filtreStatut'), allLabel: t('etatTous'), value: etat, onChange: setEtat,
      options: ETATS.map((v) => ({ slug: v, libelle: t(`etat.${v}`), count: candidats.filter((d) => okEtat(d, [v]) && okGroupe(d, groupesActifs) && dansLaPeriode(d, periode) && okTheme(d, rangsTheme)).length })),
    },
    // Compté en textes comme les autres menus, pas en lignes : l'en-tête de liste dit
    // déjà combien d'articles et d'amendements la vue montre. Sans compte pendant le
    // chargement : lu sur le contenu, il afficherait 0 puis grimperait, quand les
    // autres menus, lus sur l'index, ont déjà leur valeur.
    {
      key: 'type', label: t('filtreType'), allLabel: t('typeTous'), value: type ? [type] : [], onChange: (v) => setType(v[0] ?? ''), choixUnique: true,
      options: TYPES.map((v) => ({ slug: v, libelle: t(`type.${v}`), count: chargement ? undefined : index.dossiers.filter((d) => retenu(d, profilsAffiches, v) && okEtat(d, etat) && okGroupe(d, groupesActifs) && dansLaPeriode(d, periode) && okTheme(d, rangsTheme)).length })),
    },
    {
      key: 'groupe', label: tDossiers('filterGroupeLabel'), allLabel: tDossiers('filterGroupeAll'), value: groupe, onChange: setGroupe,
      options: groupesPresents.map((g) => ({ slug: g, libelle: g, count: candidats.filter((d) => okEtat(d, etat) && okGroupe(d, [g]) && dansLaPeriode(d, periode) && okTheme(d, rangsTheme)).length })),
    },
    {
      key: 'periode', label: t('filtrePeriode'), allLabel: t('periodeTout'), value: periode ? [periode] : [], onChange: (v) => setPeriode(v[0] ?? ''), choixUnique: true,
      options: PERIODES.map((v) => ({ slug: v, libelle: t(`periode.${v}`), count: candidats.filter((d) => okEtat(d, etat) && okGroupe(d, groupesActifs) && dansLaPeriode(d, v) && okTheme(d, rangsTheme)).length })),
    },
    // En dernier, comme sur la page Textes. Seuls les thèmes des textes retenus (situations
    // choisies, recherche et type compris) sont proposés.
    {
      key: 'theme', label: tDossiers('filterThemeLabel'), allLabel: tDossiers('filterThemeAll'), value: theme, onChange: setTheme,
      options: themesPresents.map((r) => ({ slug: index.themes[r].theme, libelle: index.themes[r].libelle, count: candidats.filter((d) => okEtat(d, etat) && okGroupe(d, groupesActifs) && dansLaPeriode(d, periode) && okTheme(d, [r])).length })),
    },
  ];

  // Le même voile que les navigations lentes vers une fiche (`NavigationOverlay`).
  if (!navigateur) return <VoileFlou label={t('chargement')} />;

  return (
    <div style={{ paddingBlock: '1.5rem 4rem' }}>
      {accueilVisible ? (
        // Pleine largeur, celle de la liste qui le remplace. Sans le badge IA :
        // l'accueil ne montre encore rien qu'elle ait produit, la liste le porte.
        // La consigne pleine largeur, en trois cartes côte à côte dès 1024 px
        // (`IntroProfils`) : la largeur n'est plus laissée vide à droite.
        <section aria-labelledby="accueil-titre" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div id="accueil-titre" style={{ fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--muted-foreground)', margin: 0 }}>
            <IntroProfils />
          </div>
          <FormulaireProfils dansFenetre={false} onChanger={changerProfils} />
          {pied(false)}
        </section>
      ) : (<>
        <div style={{ paddingTop: '1rem', paddingBottom: '1rem' }}>
          <DossiersSearchInput placeholder={t('recherchePlaceholder')} icon={ListFilter} clearLabel={tCommon('removeFilter')} />
        </div>
        <FilterBar
          facets={facets}
          clearAllLabel={tCommon('clearAll')}
          removeLabel={tCommon('removeFilter')}
          filterPlaceholder={(n) => tCommon('filterChoices', { count: n })}
        />
        {/* Recherche et filtres s'affichent dès l'arrivée ; en-tête et liste attendent
            tous les blocs, comme sur les pages Textes et Élus. Remplie à mesure, la
            liste changeait sous les yeux et ses compteurs grimpaient. */}
        {chargement ? (
          // Styles en ligne plutôt que `text-sm py-8` : Tailwind v4 est peu fiable sur
          // Safari pour la taille de police et les marges (CLAUDE.md).
          <p role="status" style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', padding: '2rem 0', margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
            <Loader2 className="animate-spin" style={{ width: '14px', height: '14px' }} aria-hidden="true" />
            {t('chargement')}
          </p>
        ) : (<>
        {/* En-tête de liste sur deux lignes : le nom de la liste et son badge IA, puis
            le nombre d'articles et d'amendements et le tri, qui suit le compteur. Le libellé du badge,
            imposé par D-002, est long : sur une seule ligne avec le compteur et le
            tri, elle devenait trop longue. */}
        <div className="fade-slide-in" style={{ paddingTop: '1.5rem', paddingBottom: '0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 0.75rem' }}>
            <span style={{ fontSize: '0.9375rem', fontWeight: 600 }}>{t('titreListe')}</span>
            <BadgeIA liste />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem 0.75rem' }}>
            {/* Rien si tous les blocs ont échoué : « 0 article » s'y lirait comme une liste vide.
                Le message tait la partie à zéro (« 82 amendements » sous le filtre
                Amendements), et rien ne s'affiche quand les deux le sont : la liste vide
                le dit déjà. */}
            {charges.size > 0 && nbElements.articles + nbElements.amendements > 0 && <span style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>{t('resumeElements', nbElements)}</span>}
            {/* Même rendu que le tri de `DossiersResultsClient`. Radix rend une valeur
                vide quand on reclique la pastille active : l'ignorer. */}
            <ToggleGroup
              type="single"
              value={tri}
              onValueChange={(v) => { if (v) setTri(v as (typeof TRIS)[number]); }}
              aria-label={tDossiers('sortBy')}
              className="inline-flex shrink-0"
            >
              {TRIS.map((v) => (
                <ToggleGroupItem
                  key={v}
                  value={v}
                  className="h-auto min-w-0 transition-colors"
                  style={{
                    padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.8125rem', lineHeight: 1.6, fontWeight: 500,
                    color: tri === v ? 'var(--primary)' : 'var(--muted-foreground)',
                    backgroundColor: tri === v ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
                  }}
                >
                  {v === 'depot' ? tDossiers('sortDeposit') : tDossiers('sortActivity')}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
        {/* L'échec d'un bloc se dit avant la liste : en bas, il restait invisible sous
            une longue liste, et absent quand la recherche la vidait (ses dossiers
            n'étant pas chargés, aucun ne peut correspondre). */}
        {erreur && (
          <p role="alert" style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', margin: '0.5rem 0 0' }}>{t('erreurChargement')}</p>
        )}
        {tries.length === 0 ? (
          <p style={{ fontSize: '0.9375rem', color: 'var(--muted-foreground)', margin: '1.5rem 0 0' }}>
            {t(profilsActifs.length || etat.length || type || groupesActifs.length || periode || rangsTheme.length || mots.length > 0 ? 'rienAvecFiltres' : 'rienTrouve')}
          </p>
        ) : (
          <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem', paddingTop: '1rem' }}>
            {sections.map(({ profil, lignes }) => {
              const entiere = entieres.has(profil);
              const montre = entiere ? lignes.length : LIGNES_VISIBLES;
              // Replier une section longue laisse la page là où était le bouton, soit
              // plusieurs sections plus bas : on remonte à son titre.
              const basculer = () => {
                setEntieres((s) => {
                  const n = new Set(s);
                  if (!n.delete(profil)) n.add(profil);
                  return n;
                });
                if (entiere) document.getElementById(`profil-${profil}`)?.scrollIntoView({ block: 'start' });
              };
              return (
                <section key={profil} aria-labelledby={`profil-${profil}`} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  {/* Marge de défilement : remonté par « Réduire », le titre se pose
                      sous l'en-tête fixe du site (`--hauteur-entete`, comme `.fiche-section`). */}
                  <h2 id={`profil-${profil}`} style={{ fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.35, margin: '0 0 0.25rem', paddingInline: 16, scrollMarginTop: 'calc(var(--hauteur-entete) + 1rem)' }}>
                    {t(`profils.${profil}`)}{' '}
                    <span style={{ fontWeight: 400, color: 'var(--muted-foreground)' }}>{t('nbLignesProfil', { n: lignes.length })}</span>
                  </h2>
                  {/* La section reste quand filtres ou recherche la vident : le
                      lecteur voit que son profil a bien été pris en compte. */}
                  {lignes.length === 0 ? (
                    <p style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)', margin: 0, paddingInline: 16 }}>
                      {t(etat.length || type || groupesActifs.length || periode || rangsTheme.length || mots.length > 0 ? 'rienPourProfil' : 'aucunPourProfil')}
                    </p>
                  ) : (
                    // Même entrée en cascade que les listes Textes et Élus (`globals.css`).
                    <ul className="liste-cascade" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                      {lignes.slice(0, montre).map((c) => (
                        <LigneChangement key={`${c.dossier.uid}|${c.e.id}`} c={c} onOuvrir={() => setOuvert({ dossier: c.dossier, e: c.e })} />
                      ))}
                    </ul>
                  )}
                  {lignes.length > LIGNES_VISIBLES && (
                    <span style={{ paddingLeft: 12 }}>
                      <BoutonLien onClick={basculer} aria-expanded={entiere}>
                        {entiere ? t('voirMoins') : t('voirAutres', { n: lignes.length - LIGNES_VISIBLES })}
                      </BoutonLien>
                    </span>
                  )}
                </section>
              );
            })}
          </section>
        )}
        {/* La lettre est la même pour tous (D-243) : elle ne lit pas les situations
            choisies ici, mais dit lesquelles les textes de la semaine touchent le
            plus. D'où une ligne sous la liste, et rien sur l'écran de choix. Texte
            mélangé à 66 % et non `--muted-foreground`, qui ne fait que 2,5:1 sur
            blanc : la phrase est à lire, pas une note de bas de page. */}
        <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'color-mix(in srgb, var(--foreground) 66%, transparent)', margin: '2.5rem 0 0' }}>
          {t.rich('newsletterLigne', {
            lien: (chunks) => <Link href="/newsletter" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>{chunks}</Link>,
          })}
        </p>
        </>)}
      </>)}

      {/* Choix des profils, ouvert par la pastille « Ma situation » : la même fenêtre
          centrée que « Identifier mes élus » (`TrouverMonDeputeModal`), le même
          formulaire et le même bas que l'accueil. Chaque clic s'applique tout de
          suite, la liste se met à jour derrière ; le bouton du bas referme. La
          refermer autrement (croix, Échap) mène aussi à la liste s'il reste des
          profils : vider puis recocher dans la fenêtre a réarmé l'accueil, qui
          serait sinon revenu avec des profils déjà choisis. */}
      <FenetreProfils
        ouverte={fenetreProfils}
        onOuverture={(o) => {
          setFenetreProfils(o);
          if (!o) setAccueil(lire().length === 0);
        }}
        onChanger={changerProfils}
        pied={pied(true)}
      />

      <TiroirChangement ouvert={ouvert} onFermer={() => setOuvert(null)} choisis={choisis} version={index.version} />
    </div>
  );
}
