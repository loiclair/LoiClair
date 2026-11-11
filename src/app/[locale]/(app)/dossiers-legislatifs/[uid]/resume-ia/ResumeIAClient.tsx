"use client";

// Corps client de la fiche dossier (`/dossiers-legislatifs/[uid]/resume-ia`).
// Reçoit de page.tsx les textes, le parcours, les compteurs de débat et les
// résumés déjà en cache, puis rend les sections repliables : résumé du texte
// choisi (généré par /api/resume-loi s'il n'est pas en cache), ce qui change
// pour les profils du lecteur (PourVous), débat (ArgumentsPourContre), parcours,
// modifications du texte (ModificationsSection), contrôle du Conseil constitutionnel,
// élus les plus actifs (ElusActifsSection), sources et acteurs (SourcesSection), presse.
// Toutes figurent sur toute fiche, avec une phrase d'absence quand la donnée manque,
// sauf modifications et Conseil constitutionnel, retirés d'un dossier de contrôle.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLink, Check, Lightbulb, Bookmark, Zap, AlertCircle, Target, ChevronsUpDown,
  ChevronLeft, ChevronRight,
} from "lucide-react";
import { useCompletion } from '@ai-sdk/react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Carousel, CarouselContent, CarouselItem, useCarousel, type CarouselApi,
} from '@/components/ui/carousel';
import { useTranslations, useLocale } from 'next-intl';
import Timeline, { type TimelineStep } from './Timeline';
import ArgumentsPourContre from './ArgumentsPourContre';
import CCDecisionSection from './CCDecisionSection';
import SourcesSection, { type SourcesDossier } from './SourcesSection';
import ModificationsSection, { type ModificationsDossier } from './ModificationsSection';
import ElusActifsSection, { type ElusActifsChambre } from './ElusActifsSection';
import { AI_FRAME_STYLE, AI_INNER_STYLE, AIBadge, AICardFooter, AskAILinks, BusyNotice, RateLimitNotice } from './AICardElements';
import { CLE_PLI, IconeAncre, IconeSection, SECTIONS_HORS_CONTROLE } from './SectionsDossier';
import SectionRepliable from '@/components/SectionRepliable';
import BarreAncres from '@/components/BarreAncres';
import { stockageSession } from '@/lib/stockage-navigateur';
import { useAiErrorStatus } from './useAiErrorStatus';
import { translateStatut } from '@/lib/statut';
import { dateTexte } from '@/lib/texte-date';
import type { ResumeLoiIa } from '@/lib/ai-schemas';
import type { CcDecisionInfo } from './CCDecisionSection';
import type { DossierConcerne } from '@/lib/ce-qui-me-concerne';
import { PourVousSection } from './PourVous';
import { BadgeIA } from '@/components/ChangementsConcernes';
import { formatJourNu, formateurDate } from '@/lib/jour-paris';

interface Texte {
  uid: string;
  date_creation: string | null;
  date_publication: string | null;
  date_depot: string | null;
  /** Déjà traduite dans la langue de la page par `page.tsx` (`traduireDenomination`) :
   *  à afficher telle quelle, jamais à comparer à une valeur française de la base. */
  denomination: string | null;
  titre_principal_court: string | null;
  lien_texte: string | null;
  libelle_statut_adoption: string | null;
  provenance: string | null;
  url_accessible: boolean | null;
  organe_auteur: { libelle: string } | null;
  /** `contenu_legifrance` rempli en base, calculé par page.tsx sans transférer le contenu. */
  contenu_stocke: boolean;
}

// Texte lisible par /api/resume-loi sans lien : son contenu Légifrance est stocké,
// seul critère que lit la route. La provenance ne suffit pas : une loi parue au
// Journal officiel le jour même est déjà « Légifrance » alors que l'import nocturne
// n'a pas encore récupéré son texte.
const hasLegifrance = (tx: { contenu_stocke: boolean }) => tx.contenu_stocke;

export interface ScrutinData {
  uid: string;
  sortLibelle: string;
  type: string;
  /** `MOC`, `SPS`, `SPO` côté AN ; null côté Sénat, qui ne publie pas de type.
   *  Décide de ce que la barre a le droit de montrer (cf. `scrutin-affichage.ts`). */
  typeVoteCode: string | null;
  pour: number;
  contre: number;
  abstentions: number;
  votants: number;
  nonVotants: number;
  suffragesRequis: number;
  date: string;
  chambre: string | null;
}

/** Texte issu du vote (« Texte adopté n° 265 »), tel que publié par la chambre.
 *  Ce n'est pas la version soumise au vote mais celle qui en sort, d'où le libellé. */
export interface TexteVote {
  uid: string;
  lien: string;
  label: string;
}

export interface DecisionData {
  acteUid: string;
  date: string;
  chambreKey: 'AN' | 'SEN' | 'CMP' | 'CC' | null;
  scrutinTitre: string | null;
  /** Vrai quand `scrutinTitre` est la traduction de l'IA : la carte et son volet portent le badge. */
  scrutinTitreTraduit: boolean;
  statutConclusion: string | null;
  scrutin: ScrutinData | null;
  texteVote: TexteVote | null;
  urlConclusion?: string | null;
  /** Décision d'une chambre sans détail des voix : ce que la carte en dit à la place
   *  (`sansDetailDe`, page.tsx). Absent quand le scrutin est là, ou hors des chambres. */
  sansDetail?: SansDetail;
}

/** Pourquoi une décision n'a pas de détail des voix, quand la source le dit. */
export type SansDetail = '49-3' | '151-7' | 'inconnu';

export interface TexteEtape {
  label: string;
  texteUid: string;
  type: string;
}

interface ArticlePresse {
  titre: string;
  url: string;
  source_nom: string;
  source_url: string | null;
  date_publication: string | null;
}

interface ResumeIAClientProps {
  uid: string;
  initialTextes: Texte[];
  statutFinal: string | null;
  datePromulgation: string | null;
  dureeTotal: number | null;
  dureeApplication: number | null;
  isAppDirecte: boolean;
  timelineSteps: TimelineStep[];
  textesParEtape: Record<string, TexteEtape[]>;
  decisionsByMilestone: Record<string, DecisionData[]>;
  nbMesuresAttendues: number | null;
  nbMesuresAppliquees: number | null;
  ccSaisineCounts: Record<'PM' | 'AN' | 'SN' | 'DROIT', number>;
  /** Texte qui fait foi, ouvert par défaut : version consolidée, sinon loi
   *  promulguée, sinon le texte accessible le plus récent (voir page.tsx). */
  defaultTexteUid: string | null;
  cachedResumes: Record<string, string>;
  articlesPresse: ArticlePresse[];
  hasInterventions: boolean;
  nbInterventions: number;
  nbSeancesAN: number;
  nbSeancesSEN: number;
  derniereSeance: string | null;
  ccDecisionInfo: CcDecisionInfo | null;
  /** Pages officielles du dossier et élus déjà résolus, groupés par rôle (voir page.tsx). */
  sources: SourcesDossier;
  /** Amendements du dossier, par groupe et par auteur ; null sans amendement déposé,
   *  et la section n'affiche alors que sa phrase d'absence. */
  modifications: ModificationsDossier | null;
  /** Dossier de contrôle (rapport, pas loi) : les sections de `SECTIONS_HORS_CONTROLE`
   *  sont retirées, ancres comprises. */
  controle: boolean;
  /** Élus les plus actifs, une entrée par chambre qui a des données (voir page.tsx) ;
   *  vide, la section n'affiche que sa phrase d'absence. */
  elusActifs: ElusActifsChambre[];
  /** Le texte assemblé pour tous les profils de « Ce qui me concerne », et l'instant
   *  de rendu de la page (`v=` du tiroir) ; null pour un texte non classé, dont la
   *  section ne dit alors qu'une phrase d'absence, comme celle du débat. */
  pourVous: { dossier: DossierConcerne; version: string } | null;
}

// Étapes affichées pendant la génération du résumé IA — rotation toutes les 5s.
// Reflète le pipeline : récupération du texte → analyse → rédaction → exemples.
const RESUME_LOADING_STEPS_FR = [
  'Analyse du texte officiel…',
  'Identification des points clés…',
  'Rédaction en français accessible…',
  'Préparation des exemples concrets…',
];
const RESUME_LOADING_STEPS_EN = [
  'Analyzing the official text…',
  'Identifying key points…',
  'Drafting plain-language summary…',
  'Preparing concrete examples…',
];

/**
 * Lit le résumé rendu par la route, qui est un objet JSON contraint par schéma.
 *
 * La garde ne sert plus à rattraper une dérive de format, que le schéma interdit,
 * mais à couvrir les deux seuls cas où le corps n'est pas un objet complet : une
 * réponse encore en cours de transfert, et une ligne de cache écrite avant la
 * migration, restée en markdown. Les deux se traduisent par « pas encore de
 * contenu », c'est-à-dire le squelette de chargement.
 */
function lireResume(text: string): ResumeLoiIa | null {
  if (!text) return null;
  try {
    const objet = JSON.parse(text) as ResumeLoiIa;
    if (!Array.isArray(objet?.mesures) || !Array.isArray(objet?.exemples)) return null;
    // Un objet conforme au schéma peut être entièrement vide : rien n'impose de
    // longueur minimale, ni de `minItems`. Le rendre tel quel afficherait un
    // cadre doré vide, sans squelette, sans erreur et sans bouton pour relancer.
    // Aucun contenu vaut donc « pas de résumé », comme avant la migration.
    const vide = !objet.objectif && !objet.aRetenir && objet.mesures.length === 0 && objet.exemples.length === 0;
    return vide ? null : objet;
  } catch {
    return null;
  }
}

/** « Source : <version du texte> → » d'un pied de carte IA, lié au texte officiel
 *  quand il est publié, en gris sinon. Servi au résumé et à « Ce qui change pour
 *  vous », pour qu'une même version s'y présente de la même façon. */
function SourceTexte({ prefixe, label, lien }: { prefixe: string; label: string; lien: string | null }) {
  return lien ? (
    <a
      href={lien}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-primary hover:underline font-medium py-1 -my-1 truncate"
      title={label}
    >
      {prefixe} {label} →
    </a>
  ) : (
    <span className="font-medium text-foreground/70 truncate" title={label}>
      {prefixe} {label}
    </span>
  );
}

// Cadre IA — bordure dégradée dorée + halo (statique)
function AICard({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div style={{ ...AI_FRAME_STYLE, overflow: 'hidden' }}>
      <div style={{ ...AI_INNER_STYLE, padding: '20px 24px' }}>{children}</div>
      {footer}
    </div>
  );
}

export default function ResumeIAClient({ uid, initialTextes, statutFinal, datePromulgation, dureeTotal, dureeApplication, isAppDirecte, timelineSteps, textesParEtape, decisionsByMilestone, nbMesuresAttendues, nbMesuresAppliquees, ccSaisineCounts, defaultTexteUid, cachedResumes, articlesPresse, hasInterventions, nbInterventions, nbSeancesAN, nbSeancesSEN, derniereSeance, ccDecisionInfo, sources, modifications, controle, elusActifs, pourVous }: ResumeIAClientProps) {
  const t = useTranslations('resumeIA');
  const tDossiers = useTranslations('dossiers');
  const locale = useLocale();

  const [selectedUid, setSelectedUid] = useState<string | null>(defaultTexteUid);
  const liensStatus = useMemo(() => {
    const result: Record<string, 'valide' | 'invalide'> = {};
    for (const tx of initialTextes) {
      result[tx.uid] = (hasLegifrance(tx) || (tx.url_accessible === true && tx.lien_texte)) ? 'valide' : 'invalide';
    }
    return result;
  }, [initialTextes]);

  const textesByUid = useMemo(() => new Map(initialTextes.map(tx => [tx.uid, tx])), [initialTextes]);

  // Cache hit dès le premier rendu : SSR contient le résumé, pas de flash skeleton
  const initialCached = defaultTexteUid && cachedResumes[defaultTexteUid] ? cachedResumes[defaultTexteUid] : '';
  const completedForRef = useRef<string | null>(initialCached ? `${defaultTexteUid}:${locale}` : null);
  const [resumeRevealed, setResumeRevealed] = useState(!!initialCached);

  const { customFetch, errorKind, rateLimitResetMs, busyUntilMs, handleCompletionError, resetErrorKind } = useAiErrorStatus();

  const {
    completion: apiCompletion, complete, stop, isLoading: isLoadingResume, setCompletion,
  } = useCompletion({
    api: '/api/resume-loi',
    experimental_throttle: 50,
    fetch: customFetch,
    onError: handleCompletionError,
  });

  const [cachedCompletion, setCachedCompletion] = useState(initialCached);
  const completion = cachedCompletion || apiCompletion;

  // Label rotatif pendant la génération du résumé — change toutes les 4s
  const resumeSteps = locale === 'en' ? RESUME_LOADING_STEPS_EN : RESUME_LOADING_STEPS_FR;
  const [resumeLoadingStep, setResumeLoadingStep] = useState(0);
  const resumeLoadingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (isLoadingResume && !apiCompletion) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset du compteur d'étapes au démarrage du loading
      setResumeLoadingStep(0);
      resumeLoadingInterval.current = setInterval(() => {
        setResumeLoadingStep(prev => Math.min(prev + 1, resumeSteps.length - 1));
      }, 3500);
      return () => { if (resumeLoadingInterval.current) clearInterval(resumeLoadingInterval.current); };
    } else if (resumeLoadingInterval.current) {
      clearInterval(resumeLoadingInterval.current);
    }
  }, [isLoadingResume, apiCompletion, resumeSteps.length]);

  const fmtDate = (tx: Texte | undefined): string => {
    const raw = dateTexte(tx);
    return raw ? formateurDate(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(raw)) : '';
  };

  // Changer de texte pendant une génération : la requête en cours est abandonnée
  // côté client seulement (la route finit et écrit son cache, cf. useAiErrorStatus).
  // L'erreur du texte précédent ne doit pas survivre à la sélection : elle masque
  // tout le contenu du nouveau texte, cache compris, puisque le corps de la carte
  // ne se rend que sous `!errorKind`.
  //
  // Le nouveau résumé remplace l'ancien sous les yeux du lecteur, qui doit donc le
  // reprendre depuis son début. Le défilement vise la section du résumé et non le
  // haut de page : ses deux déclencheurs, le sélecteur de version en pied de carte
  // et le retour au texte de référence en tête de carte, sont à quelques lignes d'elle.
  // Rien ne bouge tant que son haut est dans la moitié supérieure de l'écran, cas
  // le plus fréquent puisqu'on vient de cliquer à quelques lignes de là.
  const handleTimelineSelectTexte = (texteUid: string) => {
    if (texteUid !== selectedUid) {
      stop();
      resetErrorKind();
      completedForRef.current = null;
      setCachedCompletion('');
      setCompletion('');
      setSelectedUid(texteUid);
      const section = document.querySelector<HTMLElement>('section[data-cle="resume"]');
      const haut = section?.getBoundingClientRect().top ?? 0;
      if (haut < 0 || haut > window.innerHeight * 0.5) {
        section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  useEffect(() => {
    if (!selectedUid) return;
    if (liensStatus[selectedUid] !== 'valide') return;

    const effectKey = `${selectedUid}:${locale}`;
    if (completedForRef.current === effectKey) return;

    completedForRef.current = effectKey;

    setCachedCompletion('');
    setCompletion('');
    setResumeRevealed(false);

    if (cachedResumes[selectedUid]) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset des états de complétion à chaque changement de texte sélectionné
      setCachedCompletion(cachedResumes[selectedUid]);
      setResumeRevealed(true);
      return;
    }

    complete(JSON.stringify({ texte_uid: selectedUid, locale }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUid, initialTextes, liensStatus, cachedResumes, locale]);

  // Relance du texte sélectionné, partagée par le bouton Réessayer de l'erreur
  // générique et par celui de l'attente du fournisseur (BusyNotice).
  const relancerResume = () => {
    completedForRef.current = null;
    const tx = textesByUid.get(selectedUid!);
    if (tx && (tx.lien_texte || hasLegifrance(tx))) {
      setCompletion('');
      complete(JSON.stringify({ texte_uid: selectedUid, locale }));
    }
  };

  useEffect(() => {
    const key = `viewed_${uid}`;
    if (stockageSession.lire(key)) return;
    stockageSession.ecrire(key, '1');
    fetch('/api/view-dossier', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid }),
    }).catch(() => {});
  }, [uid]);

  const prevLoadingResume = useRef(isLoadingResume);
  useEffect(() => {
    // On ne dévoile que ce qui se lit. Un corps illisible (ligne de cache restée
    // en markdown, objet tronqué) laisserait sinon le squelette derrière lui et
    // afficherait un cadre vide, sans message ni bouton pour relancer.
    if (prevLoadingResume.current && !isLoadingResume && apiCompletion && !resumeRevealed && lireResume(apiCompletion)) {
      setResumeRevealed(true);
    }
    prevLoadingResume.current = isLoadingResume;
  }, [isLoadingResume, apiCompletion, resumeRevealed]);

  const selectedTexte = selectedUid ? textesByUid.get(selectedUid) ?? null : null;
  const lienTexte = selectedTexte?.lien_texte ?? null;
  const resume = useMemo(() => lireResume(completion), [completion]);
  const hasContent = resume !== null;
  const needsLoad = !initialCached && !!defaultTexteUid && liensStatus[defaultTexteUid] === 'valide';
  const isLoading = (isLoadingResume || (needsLoad && !hasContent)) && !resumeRevealed;
  const isValid = selectedTexte && liensStatus[selectedTexte.uid] === 'valide';

  // Nom d'une version du texte : son rôle dans le parcours (« Texte adopté
  // (1re lecture) ») et sa date, sinon sa dénomination. Partagé par la source du
  // résumé, celle de « Ce qui change pour vous » et la liste de la section
  // « Sources et acteurs », pour qu'elles nomment
  // un même texte de la même façon. Le sélecteur de version compose ses propres
  // options : l'étape y est déjà dite par le groupe (`optgroup`) qui les range.
  const libelleTexte = (texteUid: string): string => {
    const fromEtape = Object.entries(textesParEtape).flatMap(([code, ts]) =>
      ts.filter(tx => tx.texteUid === texteUid).map(tx => {
        const stepItem = timelineSteps.find(s => s.code === code);
        const texteData = textesByUid.get(tx.texteUid);
        const dateStr = fmtDate(texteData);
        const shortStep = stepItem?.label.replace(/ \(.*\)$/, '') ?? code;
        const labelIncludesStep = tx.label.toLowerCase().includes(shortStep.toLowerCase()) || shortStep.toLowerCase().includes(tx.label.toLowerCase());
        return labelIncludesStep
          ? `${tx.label}${dateStr ? ` — ${dateStr}` : ''}`
          : `${tx.label} (${shortStep})${dateStr ? ` — ${dateStr}` : ''}`;
      })
    )[0];
    if (fromEtape) return fromEtape;
    const texte = textesByUid.get(texteUid);
    const name = texte?.denomination || texte?.titre_principal_court || t('text');
    const dateStr = fmtDate(texte);
    return `${name}${dateStr ? ` — ${dateStr}` : ''}`;
  };

  const selectedLabel = selectedUid ? libelleTexte(selectedUid) : '';

  // La version du texte que « Ce qui change pour vous » a classée, lue sur le premier
  // article : son pied de carte la nomme et la lie comme la source du résumé, avec
  // son étape du parcours. Introuvable, le pied ne garde que l'avertissement.
  const texteClasse = pourVous?.dossier.elements.flatMap(e => 'texte' in e.source ? [e.source.texte] : [])[0] ?? null;

  // Loi promulguée, rattachée à l'étape PROM par page.tsx (acte PROM-PUB). Seul
  // un texte publié a un lien, même critère que le sélecteur de version.
  const lienTextePromulgue = (textesParEtape.PROM ?? [])
    .filter(e => e.type === 'promulgue' && liensStatus[e.texteUid] === 'valide')
    .map(e => textesByUid.get(e.texteUid)?.lien_texte)
    .find(Boolean) ?? null;

  // Toutes les versions, dans l'ordre chronologique calculé par page.tsx. Un texte
  // n'a de lien que s'il est publié, même critère que le sélecteur de version ; un
  // texte dont le contenu Légifrance est stocké compte comme publié même sans `lien_texte`.
  // Mémoïsé : le composant se rend à chaque morceau du résumé en streaming (toutes
  // les 50 ms), et une liste neuve à chaque fois ferait rendre toute la section.
  const documentsSources = useMemo(() => initialTextes.map(tx => ({
    uid: tx.uid,
    label: libelleTexte(tx.uid),
    lien: liensStatus[tx.uid] === 'valide' ? tx.lien_texte : null,
    publie: liensStatus[tx.uid] === 'valide',
  })),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- libelleTexte ne lit que ces valeurs et `t`
  [initialTextes, liensStatus, textesParEtape, timelineSteps, textesByUid, locale]);

  const vcTextes = useMemo(() => {
    const mappedUids = new Set(Object.values(textesParEtape).flatMap(ts => ts.map(tx => tx.texteUid)));
    return initialTextes.filter(tx => tx.uid.endsWith('-VC') && tx.lien_texte && !mappedUids.has(tx.uid));
  }, [textesParEtape, initialTextes]);

  const otherTextes = useMemo(() => {
    const mappedUids = new Set(Object.values(textesParEtape).flatMap(ts => ts.map(tx => tx.texteUid)));
    return initialTextes.filter(tx =>
      !tx.uid.endsWith('-VC') &&
      !mappedUids.has(tx.uid) &&
      liensStatus[tx.uid] !== 'invalide'
    );
  }, [textesParEtape, initialTextes, liensStatus]);

  const hasMultipleSelectable = useMemo(
    () => initialTextes.filter(tx => liensStatus[tx.uid] === 'valide').length > 1,
    [initialTextes, liensStatus],
  );

  // Format duration helper for parcours teaser
  const formatDuree = (days: number): string => {
    if (days >= 30) return t('durationMonths', { count: Math.round(days / 30) });
    return t('durationDays', { count: days });
  };

  const parcoursTeaser = useMemo(() => {
    const count = timelineSteps.length;
    const statutLabel = translateStatut(statutFinal, tDossiers);
    if (statutFinal && dureeTotal != null) {
      return t('parcoursTeaser', { count, statut: statutLabel, duree: formatDuree(dureeTotal) });
    }
    if (dureeTotal != null) {
      return t('parcoursTeaserNoStatus', { count, duree: formatDuree(dureeTotal) });
    }
    return t('parcoursTeaserStepsOnly', { count });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineSteps.length, statutFinal, dureeTotal, locale]);

  // Avertissement de version, rendu en tête de la carte du résumé : celui-ci porte
  // sur une version figée du texte et le prompt ne reçoit jamais l'issue du dossier
  // (voir ETAPE_RESUME_LOI dans lib/prompts). Sans ce rappel, le résumé d'un texte
  // rejeté en nouvelle lecture se lisait comme la fin du dossier, sur une loi
  // pourtant promulguée.
  // Vrai quand le texte lu n'est pas celui qui fait foi, `defaultTexteUid` étant
  // précisément ce texte (voir page.tsx). C'est la seule condition de l'avertissement
  // rendu en tête de carte : il est donc toujours absent à l'ouverture, et apparaît
  // dès que le lecteur choisit une autre version dans le menu.
  const horsTexteDeReference = !!selectedTexte && !!defaultTexteUid && selectedUid !== defaultTexteUid;

  const presseSources = useMemo(
    () => Array.from(new Set(articlesPresse.map(a => a.source_nom))).slice(0, 3).join(', '),
    [articlesPresse],
  );

  // Question posée aux IA externes (bandeau du résumé, message de limite des
  // deux cartes). Sans lien officiel, rien à leur faire lire : pas de liens.
  const askAIPrompt = useMemo(() => {
    if (!selectedTexte?.lien_texte) return null;
    const titre = selectedTexte.titre_principal_court || selectedTexte.denomination || t('unknownText');
    return t('askAIPrompt', { title: titre, link: selectedTexte.lien_texte });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTexte, locale]);

  // Une ancre par section, dans l'ordre du rendu : toutes les sections figurent
  // sur toute fiche, une phrase d'absence remplaçant le contenu qui manque, sauf
  // celles de `SECTIONS_HORS_CONTROLE` sur un dossier de contrôle. La
  // barre est montée ici et non dans `page.tsx` : le corps de la page arrive
  // derrière un `<Suspense>`, une barre montée plus haut viserait des sections
  // absentes du DOM pendant tout le chargement.
  const ancres = [
    { cle: 'resume', label: t('anchorResume'), icone: <IconeAncre cle="resume" /> },
    { cle: 'pourVous', label: t('anchorPourVous'), icone: <IconeAncre cle="pourVous" /> },
    { cle: 'debat', label: t('anchorDebat'), icone: <IconeAncre cle="debat" /> },
    { cle: 'parcours', label: t('anchorParcours'), icone: <IconeAncre cle="parcours" /> },
    { cle: 'modifications', label: t('anchorModifications'), icone: <IconeAncre cle="modifications" /> },
    { cle: 'cc', label: t('anchorCC'), icone: <IconeAncre cle="cc" /> },
    { cle: 'elus', label: t('anchorElus'), icone: <IconeAncre cle="elus" /> },
    { cle: 'sources', label: t('anchorSources'), icone: <IconeAncre cle="sources" /> },
    { cle: 'presse', label: t('anchorPresse'), icone: <IconeAncre cle="presse" /> },
  ].filter(({ cle }) => !controle || !SECTIONS_HORS_CONTROLE.has(cle));

  // Source du texte résumé et sélecteur de version. Rendus dans le pied de la
  // carte quand un résumé s'affiche, et sous le message d'indisponibilité sinon :
  // le sélecteur y est le seul chemin de retour vers un texte publié, ce que le
  // message demande explicitement au lecteur.
  const ligneSource = selectedTexte && selectedUid && Object.values(liensStatus).some(s => s === 'valide') ? (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <SourceTexte prefixe={t('summarizedText')} label={selectedLabel} lien={lienTexte} />
      {/* Sélecteur de version — icône seule */}
      {hasMultipleSelectable && (
        <span
          className="relative inline-flex shrink-0 cursor-pointer rounded has-[select:focus-visible]:ring-2 has-[select:focus-visible]:ring-primary has-[select:focus-visible]:ring-offset-2"
          title={t('changeVersion')}
        >
          <ChevronsUpDown className="w-3.5 h-3.5 text-muted-foreground/50 hover:text-foreground" />
          <select
            value={selectedUid || ''}
            onChange={(e) => handleTimelineSelectTexte(e.target.value)}
            aria-label={t('changeVersion')}
            className="absolute inset-0 cursor-pointer opacity-0 w-full h-full"
          >
            {timelineSteps.filter(s => (textesParEtape[s.code]?.length ?? 0) > 0).map(stepItem => {
              const stepTextes = textesParEtape[stepItem.code]
                .slice()
                .sort((a, b) => {
                  const da = dateTexte(textesByUid.get(a.texteUid)) || '';
                  const db = dateTexte(textesByUid.get(b.texteUid)) || '';
                  return da.localeCompare(db);
                });
              return (
                <optgroup key={stepItem.code} label={stepItem.label}>
                  {stepTextes.map(tx => {
                    const texteData = textesByUid.get(tx.texteUid);
                    const dateStr = fmtDate(texteData);
                    const isInvalid = liensStatus[tx.texteUid] === 'invalide';
                    return (
                      <option key={tx.texteUid} value={tx.texteUid} disabled={isInvalid}>
                        {tx.label}{dateStr ? ` — ${dateStr}` : ''}{isInvalid ? ` — ${t('notPublishedYet')}` : ''}
                      </option>
                    );
                  })}
                </optgroup>
              );
            })}
            {otherTextes.length > 0 && (
              <optgroup label={t('otherTextes')}>
                {otherTextes.map(tx => {
                  const dateStr = fmtDate(tx);
                  return (
                    <option key={tx.uid} value={tx.uid}>
                      {tx.denomination || tx.titre_principal_court || t('text')}{dateStr ? ` — ${dateStr}` : ''}
                    </option>
                  );
                })}
              </optgroup>
            )}
            {vcTextes.length > 0 && (
              <optgroup label={t('consolidatedVersion')}>
                {vcTextes.map(tx => {
                  const dateStr = fmtDate(tx);
                  return (
                    <option key={tx.uid} value={tx.uid}>
                      {tx.denomination || t('consolidatedVersion')}{dateStr ? ` — ${dateStr}` : ''}
                    </option>
                  );
                })}
              </optgroup>
            )}
          </select>
        </span>
      )}
    </div>
  ) : null;

  return (
    <div className="container mx-auto pb-8 md:pb-10 max-w-[90rem]">

      <BarreAncres ancres={ancres} ariaLabel={t('anchorsNavLabel')} />

      {/* ──────────────────────────────────────────────── */}
      {/* Stack uniforme — toutes les sections             */}
      {/* ──────────────────────────────────────────────── */}
      <div>

        {/* SECTION — Le résumé */}
        <SectionRepliable
          cle="resume"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="resume" />}
          titre={t('sectionResume')}
          badge={<AIBadge usage="loi" />}
        >
          {!selectedTexte || liensStatus[selectedTexte.uid] === 'invalide' ? (
            <>
              <p className="text-sm font-normal text-muted-foreground">
                {!selectedTexte || !Object.values(liensStatus).some(s => s === 'valide') ? t('noTextAvailable') : t('textNotAvailable')}
              </p>
              {ligneSource && <div className="mt-3">{ligneSource}</div>}
            </>
          ) : (
            <>
            <AICard
              // Masqué pendant la limite horaire : le message porte déjà les
              // mêmes liens, juste au-dessus.
              footer={askAIPrompt && errorKind !== 'rate-limit' ? (
                <AskAIBand teaser={t('discussWithAITeaser')} label={t('askAILabel')} prompt={askAIPrompt} />
              ) : undefined}
            >

              {/* État : lien invalide — géré avant la carte */}

              {/* Avertissement : le texte lu n'est pas celui qui fait foi. En tête
                  de carte, pas au-dessus : le résumé et sa mise en garde forment un
                  bloc, et le pied de carte porte déjà la source, le sélecteur de
                  version et la mention IA. */}
              {horsTexteDeReference && (
                <p
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground border-b border-border/60 pb-3 mb-4"
                  style={{ fontSize: '0.75rem', lineHeight: 1.5 }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    {t('etapeBandeau')}
                  </span>
                  <button
                    type="button"
                    onClick={() => { if (defaultTexteUid) handleTimelineSelectTexte(defaultTexteUid); }}
                    className="font-medium text-primary hover:underline"
                  >
                    {t('viewLatestVersion')} →
                  </button>
                </p>
              )}

              {/* État : limite horaire atteinte */}
              {errorKind === 'rate-limit' && isValid && (
                <RateLimitNotice resetMs={rateLimitResetMs} askAIPrompt={askAIPrompt} />
              )}

              {/* État : le fournisseur IA demande d'attendre */}
              {errorKind === 'busy' && busyUntilMs && isValid && (
                <BusyNotice untilMs={busyUntilMs} onRetry={relancerResume} />
              )}

              {/* État : erreur */}
              {errorKind && errorKind !== 'rate-limit' && errorKind !== 'busy' && isValid && (
                <div className="flex items-start gap-3 text-sm">
                  <span className="flex items-start gap-1.5" style={{ color: '#B91C1C' }}>
                    <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>{errorKind === 'quota'
                      ? t('generationQuotaExceeded')
                      : errorKind === 'unavailable' ? t('generationUnavailable') : t('generationFailed')}</span>
                  </span>
                  {errorKind !== 'quota' && errorKind !== 'unavailable' && (
                    <button
                      type="button"
                      onClick={relancerResume}
                      className="text-xs leading-5 text-primary hover:underline shrink-0"
                    >
                      {t('retry')}
                    </button>
                  )}
                </div>
              )}

              {/* Contenu IA */}
              {isValid && !errorKind && (
                <>
                  {/* Loading : skeletons */}
                  {isLoading && !resumeRevealed && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin shrink-0" style={{ borderColor: '#06B6D4', borderTopColor: 'transparent' }} />
                        <span
                          className="text-sm"
                          style={{ color: '#0891B2' }}
                        >
                          {resumeSteps[resumeLoadingStep]}
                        </span>
                      </div>
                      <div className="space-y-2.5">
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-5 w-4/5" />
                        <Skeleton className="h-5 w-3/5" />
                      </div>
                      <div className="space-y-2.5">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-4 w-4/6" />
                      </div>
                      <div className="rounded-lg px-3.5 py-3" style={{ backgroundColor: 'rgba(6,182,212,0.06)' }}>
                        <Skeleton className="h-5 w-3/4" />
                      </div>
                    </div>
                  )}

                  {/* Résultat — fade-in (key force le re-mount à chaque changement de texte) */}
                  {/* Les champs sont rendus en texte nu, sans passe markdown : le
                      schéma et le prompt les veulent nus, et 70 tirages sur les
                      deux textes qui avaient cassé la page n'ont produit aucun
                      résidu. Une passe markdown masquerait un « ** » de retour,
                      alors qu'on veut précisément qu'une dérive se voie. */}
                  {resumeRevealed && resume && (
                    <div key={selectedUid} className="space-y-7 fade-slide-in">
                      {/* Bloc 1 : Objectif du texte */}
                      {resume.objectif && (
                        <div>
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                            <Target className="h-4 w-4" style={{ color: '#06B6D4' }} />
                            {t('textObjective')}
                          </h3>
                          <p className="text-sm text-foreground" style={{ lineHeight: 1.7 }}>{resume.objectif}</p>
                        </div>
                      )}

                      {/* Bloc 2 : Mesures principales */}
                      {resume.mesures.length > 0 && (
                        <div>
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                            <Zap className="h-4 w-4" style={{ color: '#06B6D4' }} />
                            {t('whatChanges')}
                          </h3>
                          <div className="space-y-2.5">
                            {resume.mesures.map((mesure, idx) => (
                              <div key={idx} className="flex items-start gap-3 text-sm">
                                <div
                                  className="flex items-center justify-center rounded-full shrink-0 mt-0.5"
                                  style={{ width: '20px', height: '20px', backgroundColor: 'rgba(6,182,212,0.12)' }}
                                >
                                  <Check className="h-3 w-3" style={{ color: '#06B6D4' }} strokeWidth={3} />
                                </div>
                                <span className="text-foreground" style={{ lineHeight: 1.55 }}>{mesure}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Bloc 3 : Exemples concrets multi-angles */}
                      {resume.exemples.length > 0 && (
                        <ConcreteExamples
                          examples={resume.exemples}
                          label={t('concreteExample')}
                          prevLabel={t('previousExample')}
                          nextLabel={t('nextExample')}
                        />
                      )}

                      {/* Bloc 4 : À retenir — section simple, sans fond */}
                      {resume.aRetenir && (
                        <div>
                          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
                            <Bookmark className="h-4 w-4" style={{ color: '#06B6D4' }} />
                            {t('keyTakeaway')}
                          </h3>
                          <p className="text-sm font-medium text-foreground" style={{ lineHeight: 1.7 }}>{resume.aRetenir}</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <AICardFooter>{ligneSource}</AICardFooter>
            </AICard>
            </>
          )}


        </SectionRepliable>

        {/* SECTION : Ce qui change pour vous, juste après le résumé (voir PourVous).
            Toujours présente, comme le débat : un texte non classé (rapport, texte
            que la chambre n'a pas encore mis en ligne, classement attendu) le dit
            au lieu de faire disparaître la section. */}
        <SectionRepliable
          cle="pourVous"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="pourVous" />}
          titre={t('sectionPourVous')}
          badge={<BadgeIA />}
        >
          {pourVous ? (
            <PourVousSection
              dossier={pourVous.dossier}
              version={pourVous.version}
              source={texteClasse && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <SourceTexte
                    prefixe={t('summarizedText')}
                    label={libelleTexte(texteClasse)}
                    lien={liensStatus[texteClasse] === 'valide' ? textesByUid.get(texteClasse)?.lien_texte ?? null : null}
                  />
                </div>
              )}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('noPourVousData')}</p>
          )}
        </SectionRepliable>

        {/* SECTION — Le débat */}
        <SectionRepliable
          cle="debat"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="debat" />}
          titre={t('sectionDebat')}
          badge={<AIBadge usage="debats" />}
        >
          <ArgumentsPourContre
            dossierUid={uid}
            hasInterventions={hasInterventions}
            nbInterventions={nbInterventions}
            nbSeancesAN={nbSeancesAN}
            nbSeancesSEN={nbSeancesSEN}
            derniereSeance={derniereSeance}
            askAIPrompt={askAIPrompt}
          />
        </SectionRepliable>

        {/* SECTION — Le parcours de la loi. page.tsx y met toujours au moins une
            étape (le dépôt, ou celle d'un rapport) : pas de cas vide à prévoir. */}
        <SectionRepliable
          cle="parcours"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="parcours" />}
          titre={t('sectionParcours')}
        >
          <div
            className="rounded-xl"
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--card)', padding: '20px' }}
          >
            <div className="text-sm text-muted-foreground mb-4">{parcoursTeaser}</div>
            <Timeline
              uid={uid}
              steps={timelineSteps}
              statutFinal={statutFinal}
              datePromulgation={datePromulgation}
              dureeTotal={dureeTotal}
              dureeApplication={dureeApplication}
              isAppDirecte={isAppDirecte}
              decisionsByMilestone={decisionsByMilestone}
              nbMesuresAttendues={nbMesuresAttendues}
              nbMesuresAppliquees={nbMesuresAppliquees}
              ccSaisineCounts={ccSaisineCounts}
              lienTextePromulgue={lienTextePromulgue}
            />
          </div>
        </SectionRepliable>

        {/* Les trois sections suivantes figurent sur toute fiche, une phrase
            d'absence tenant lieu de contenu quand la donnée manque. Les deux
            premières sont retirées d'un dossier de contrôle, où elles sont sans objet. */}

        {/* SECTION : Modifications du texte */}
        {!controle && <ModificationsSection uid={uid} modifications={modifications} />}

        {/* SECTION — Le contrôle du Conseil constitutionnel */}
        {!controle && <CCDecisionSection info={ccDecisionInfo} saisi={Object.values(ccSaisineCounts).some((n) => n > 0)} />}

        {/* SECTION : Les plus actifs dans ce dossier */}
        <ElusActifsSection uid={uid} chambres={elusActifs} rapporteurs={sources.rapporteurs} />

        {/* SECTION : Sources et acteurs */}
        <SourcesSection
          sources={sources}
          documents={documentsSources}
          urlDecisionCC={ccDecisionInfo?.urlConclusion ?? null}
        />

        {/* SECTION — Ce sujet dans la presse, en dernière position */}
        <SectionRepliable
          cle="presse"
          cleStockage={CLE_PLI}
          icone={<IconeSection cle="presse" />}
          titre={t('sectionPresse')}
        >
          {articlesPresse.length > 0 ? (
            <div
              className="rounded-xl"
              style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--card)', padding: '20px' }}
            >
              <div className="text-sm text-muted-foreground mb-4">
                {t('presseTeaser', { count: articlesPresse.length, sources: presseSources })}
              </div>
              <div className="space-y-1">
                {articlesPresse.map((article, i) => (
                  <ArticleItem key={i} article={article} locale={locale} />
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('noArticlesFound')}</p>
          )}
        </SectionRepliable>

      </div>
      {/* fin du stack uniforme */}

      </div>
  );
}

/** Exemples concrets — carrousel swipeable (embla), flèches + puces numérotées sous le texte */
function ConcreteExamples({ examples, label, prevLabel, nextLabel }: { examples: ResumeLoiIa['exemples']; label: string; prevLabel: string; nextLabel: string }) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!api) return;
    const onSelect = () => setCurrent(api.selectedScrollSnap());
    onSelect();
    api.on('select', onSelect);
    api.on('reInit', onSelect);
    return () => { api.off('select', onSelect); };
  }, [api]);

  // Reset au premier exemple si le texte source change (nouvelle génération)
  useEffect(() => { api?.scrollTo(0); }, [examples, api]);

  if (examples.length === 0) return null;
  const hasMultiple = examples.length > 1;

  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-3">
        <Lightbulb className="h-4 w-4" style={{ color: '#06B6D4' }} />
        {label}
      </h3>
      <Carousel setApi={setApi} opts={{ loop: false }} className="w-full">
        <div className="flex items-center gap-3">
          {hasMultiple && <ExampleArrowButton direction="prev" label={prevLabel} />}
          <CarouselContent className="-ml-0">
            {examples.map((ex, i) => (
              <CarouselItem key={i} className="pl-0">
                <p className="text-sm text-foreground" style={{ lineHeight: 1.7 }}>
                  {ex.acteur && (
                    <span style={{ color: '#0891B2' }}>{ex.acteur} — </span>
                  )}
                  {ex.recit}
                </p>
              </CarouselItem>
            ))}
          </CarouselContent>
          {hasMultiple && <ExampleArrowButton direction="next" label={nextLabel} />}
        </div>
      </Carousel>
      {hasMultiple && (
        <div className="flex items-center justify-center gap-1 mt-1.5">
          {examples.map((_, i) => (
            <ExampleNumberButton
              key={i}
              index={i}
              active={i === current}
              onClick={() => api?.scrollTo(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Flèche précédent/suivant du carrousel d'exemples — hover Safari-safe */
function ExampleArrowButton({ direction, label }: { direction: 'prev' | 'next'; label: string }) {
  const { scrollPrev, scrollNext, canScrollPrev, canScrollNext } = useCarousel();
  const [hovered, setHovered] = useState(false);
  const disabled = direction === 'prev' ? !canScrollPrev : !canScrollNext;
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={direction === 'prev' ? scrollPrev : scrollNext}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label={label}
      className="rounded-full inline-flex items-center justify-center shrink-0 border"
      style={{
        width: '26px',
        height: '26px',
        backgroundColor: !disabled && hovered ? 'rgba(8, 145, 178, 0.12)' : 'transparent',
        borderColor: !disabled && hovered ? '#0891B2' : 'rgba(8, 145, 178, 0.4)',
        color: '#0891B2',
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'background-color 0.15s ease, border-color 0.15s ease',
        WebkitTransition: 'background-color 0.15s ease, border-color 0.15s ease',
      }}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

/** Bouton numéroté de sélection d'exemple — hover Safari-safe */
function ExampleNumberButton({ index, active, onClick }: { index: number; active: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label={`Exemple ${index + 1}`}
      aria-current={active}
      className="rounded-full inline-flex items-center justify-center cursor-pointer border"
      style={{
        width: '22px',
        height: '22px',
        fontSize: '0.6875rem',
        fontWeight: 600,
        backgroundColor: active
          ? '#0891B2'
          : hovered
            ? 'rgba(8, 145, 178, 0.12)'
            : 'transparent',
        color: active ? '#ffffff' : '#0891B2',
        borderColor: active || hovered ? '#0891B2' : 'rgba(8, 145, 178, 0.4)',
        transition: 'background-color 0.15s ease, border-color 0.15s ease',
        WebkitTransition: 'background-color 0.15s ease, border-color 0.15s ease',
      }}
    >
      {index + 1}
    </button>
  );
}

/**
 * Bandeau en pied de la carte du résumé : prolonge la carte (fond doré, trait
 * de séparation) et propose de poser la question sur ce texte à l'une des IA
 * d'`AskAILinks`. Une phrase d'accroche, puis la rangée de liens dessous.
 */
function AskAIBand({ teaser, label, prompt }: { teaser: string; label: string; prompt: string }) {
  return (
    <div
      style={{
        padding: '14px 24px',
        borderTop: '1px solid rgba(212, 165, 74, 0.3)',
        backgroundColor: 'rgba(212, 165, 74, 0.07)',
      }}
    >
      <p className="text-sm" style={{ marginBottom: '6px' }}>
        <span className="font-semibold text-foreground">{teaser}</span>{' '}
        <span className="font-medium" style={{ color: '#D4A54A' }}>{label}</span>
      </p>
      <AskAILinks prompt={prompt} />
    </div>
  );
}

/** Article de presse — hover Safari-safe avec useState */
function ArticleItem({ article, locale }: { article: ArticlePresse; locale: string }) {
  const [hovered, setHovered] = useState(false);

  // `date_publication` est un jour nu : formaté hors UTC, un lecteur à l'ouest de
  // Greenwich verrait la veille.
  const dateStr = article.date_publication
    ? formatJourNu(article.date_publication, locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  return (
    <a
      href={article.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${article.titre} — ${article.source_nom}`}
      className="flex items-start gap-3"
      style={{
        display: 'flex',
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: hovered ? 'var(--muted)' : 'transparent',
        transition: 'background-color 0.15s ease',
        WebkitTransition: 'background-color 0.15s ease',
        textDecoration: 'none',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {article.source_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- favicon 16×16 d'un domaine arbitraire de presse, ne justifie pas une entrée remotePatterns par source
        <img
          src={`https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${new URL(article.source_url).hostname}&size=32`}
          alt=""
          width={16}
          height={16}
          className="shrink-0"
          style={{ marginTop: '3px', borderRadius: '2px' }}
        />
      ) : (
        <span
          className="shrink-0"
          style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            backgroundColor: 'var(--primary)',
            marginTop: '7px',
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        <p
          className="text-sm font-medium line-clamp-2"
          style={{
            color: hovered ? 'var(--primary)' : 'var(--foreground)',
            transition: 'color 0.15s ease',
            WebkitTransition: 'color 0.15s ease',
          }}
        >
          {article.titre}
        </p>
        <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
          <span>{article.source_nom}</span>
          {dateStr && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{dateStr}</span>
            </>
          )}
          <ExternalLink
            className="h-3 w-3 shrink-0"
            style={{
              opacity: hovered ? 0.7 : 0.35,
              transition: 'opacity 0.15s ease',
              WebkitTransition: 'opacity 0.15s ease',
            }}
          />
        </div>
      </div>
    </a>
  );
}
