'use client';

// Les changements de « Ce qui me concerne » et leur tiroir, partagés par la page « Ce
// qui me concerne » (tous les textes, une section par profil) et par la section « Ce
// qui change pour vous » de la fiche d'un texte (ce texte seul). Une ligne par
// changement, et un tiroir qui en donne le détail : texte et statut, article (et
// amendement), sa rédaction à défaut de résumé, qui l'a proposé ou déposé, phrases de chaque profil et
// passage cité, les élus du lecteur à qui écrire, amendements liés. Pour un amendement,
// le tiroir est celui de « Modifications du texte » (`CorpsTiroirAmendement`). Seul le tiroir
// demande quelque chose au serveur (`/api/ce-qui-me-concerne/element`), et la même
// chose pour tous les lecteurs (D-243) : les élus du lecteur se lisent dans son
// navigateur (`useMesElus`), et les courriels sont des `mailto:` (D-019).
//
// Le tiroir d'un article se partage (celui d'un amendement donne l'adresse de sa page) :
// le lien mène à la fiche du texte, et son ancre
// `#changement=<id>` y rouvre le tiroir (`lienChangement` l'écrit,
// `changementDuFragment` et `elementDepuisAncre` la lisent pour `PourVous.tsx`). Il ne
// porte jamais les profils de l'expéditeur. Le destinataire voit donc, dans le
// « Résumé », ses propres profils si l'élément en touche un, sinon tous ceux que
// l'élément touche (`profilsVus`). Les titres du tiroir ne disent pas « vous » : ces
// profils peuvent ne pas être les siens.
//
// Les survols passent par un état React, pas par `hover:` en Tailwind : sur Safari,
// la pipeline Tailwind v4 transforme ou supprime le CSS de survol (même contournement
// que `DossierCard`, voir ARCHITECTURE.md §Pièges Tailwind v4).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useLocale, useTranslations } from 'next-intl';
import { ExternalLink, FileText, Mail, Pencil, Rows3, ScrollText, Trash2, UserRound, UsersRound, type LucideIcon } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import { BoutonsPageSource } from '@/components/LiensSource';
import { EnteteTiroir, articleEnEntier } from '@/components/EnteteElement';
import TexteOfficiel from '@/components/TexteOfficiel';
import SectionRepliable from '@/components/SectionRepliable';
import ShareButton from '@/components/ShareButton';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { HintIconButton } from '@/components/ContacterMesElusBanner';
import { openTrouverMonDeputeModal } from '@/components/TrouverMonDeputeModal';
import { useEcranMobile } from '@/hooks/useEcranMobile';
import { useCompleterSenateurs } from '@/hooks/useCompleterSenateurs';
import { useMesElus, type EluRef } from '@/hooks/useMesElus';
import { FORMULAIRE_PREMIER_MINISTRE, courrielMesElus, elusEnregistres, getSocials } from '@/lib/contact-elus';
import { appellation, buildMailto, type DossierContext, type ElementContext, type Locale } from '@/lib/mailto';
import { sansGuillemetsExterieurs } from '@/lib/passage-cite';
import { buildShareUrl } from '@/lib/share-url';
import { formateurDate } from '@/lib/jour-paris';
import type { AmendementLie, AuteurElement, DossierConcerne, ElementConcerne, EluContactable } from '@/lib/ce-qui-me-concerne';
import type { DetailAmendement } from '@/lib/amendement-page';
import { AI_FRAME_STYLE, AI_INNER_STYLE, AIBadge, AICardFooter } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';

// Chargé à part, à l'ouverture d'un amendement : la liste de la page n'a pas à porter
// l'hémicycle et les tableaux de groupes, ni les tiroirs d'articles.
const SectionsAmendement = dynamic(() => import('@/app/[locale]/(app)/Amendements/[uid]/SectionsAmendement'));

/** Réponse de `/api/ce-qui-me-concerne/element`. `auteur` est facultatif, et ses
 *  `elus` aussi : une réponse que le CDN a gardée d'avant leur ajout à la route ne les
 *  porte pas (l'ancienne forme avait un `elu` seul, ignoré ici). */
type Detail = {
  /** `null` quand le tiroir l'a dit inutile (`sansTexte`) et qu'un lien source le remplace,
   *  et toujours pour un amendement, dont `fiche` porte le dispositif. */
  texte: string | null;
  passages: Record<string, string>;
  amendements: AmendementLie[];
  auteur?: (Omit<AuteurElement, 'elus'> & { elus?: EluContactable[] }) | null;
  fiche: DetailAmendement | null;
  /** Adresse officielle du texte d'un article, quand elle est publiée. */
  source: string | null;
};

/** Détail d'un élément (texte, passage cité pour chaque profil, amendements de
 *  l'article, auteur de l'amendement ou du texte de l'article), chargé à l'ouverture
 *  du tiroir. `sansTexte` : le texte d'un article résumé ne s'affiche pas, la route ne
 *  l'envoie alors que si aucun lien source ne le remplace (un article du budget pèse
 *  jusqu'à 255 Ko). */
function useDetail(source: ElementConcerne['source'], locale: string, version: string, sansTexte = false) {
  const [etat, setEtat] = useState<{ detail: Detail | null; erreur: boolean }>({ detail: null, erreur: false });
  const cle = ('texte' in source ? `texte=${encodeURIComponent(source.texte)}&ordre=${source.ordre}` : `amendement=${encodeURIComponent(source.amendement)}`)
    + (sansTexte ? '&sans_texte=1' : '');
  useEffect(() => {
    let annule = false;
    // `forme` rend l'adresse neuve pour le CDN : une réponse gardée d'avant `fiche` ne
    // laisserait aucun corps à afficher au tiroir d'un amendement.
    fetch(`/api/ce-qui-me-concerne/element?${cle}&locale=${locale}&v=${version}&forme=3`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: Detail) => { if (!annule) setEtat({ detail: d, erreur: false }); })
      .catch(() => { if (!annule) setEtat({ detail: null, erreur: true }); });
    return () => { annule = true; };
  }, [cle, locale, version]);
  return etat;
}

/** Survol par état React (voir l'en-tête du fichier). */
export function useSurvol() {
  const [survole, setSurvole] = useState(false);
  return { survole, surSurvol: { onMouseEnter: () => setSurvole(true), onMouseLeave: () => setSurvole(false) } };
}

export const STYLE_PETIT = { fontSize: '0.75rem', color: 'var(--muted-foreground)' } as const;
export const STYLE_SURTITRE = { ...STYLE_PETIT, color: 'var(--surtitre)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' } as const;

/** Bouton texte en couleur d'accent, hors du tiroir (« Voir les N autres lignes »). */
export function BoutonLien({ onClick, children, ...aria }: { onClick: () => void; children: ReactNode; 'aria-expanded'?: boolean }) {
  const { survole, surSurvol } = useSurvol();
  return (
    <button
      type="button"
      onClick={onClick}
      {...aria}
      {...surSurvol}
      style={{ fontSize: '0.875rem', background: 'none', border: 0, padding: '0.3rem 0.25rem', color: 'var(--primary)', cursor: 'pointer', textDecoration: survole ? 'underline' : 'none', textUnderlineOffset: 3 }}
    >
      {children}
    </button>
  );
}

/** Mention IA (D-002) : le badge visible, qui mène aux instructions publiées, et
 *  en infobulle l'avertissement propre à « Ce qui me concerne » (le tri par profil et les
 *  explications qui l'accompagnent), plus précis que celui que le badge porte par défaut.
 *  `liste` : la liste de la page, qui parle de « chaque texte » lu dans sa dernière
 *  version et ses amendements adoptés. Chaque ligne y porte le titre de son texte : sur
 *  /en, la bulle dit alors aussi que ces titres sont traduits, la ligne, tout entière un
 *  bouton, ne pouvant pas recevoir de badge. Le lien suit la bulle : il ouvre alors aussi
 *  les instructions de traduction des titres.
 *  Sans `liste` : la fiche d'un texte, sans titre dans ses lignes. Sa bulle parle de ce
 *  seul texte, et couvre les deux versions qu'il peut classer (D-244) : la loi parue au
 *  Journal officiel, qui ne montre aucun amendement, sinon sa dernière version déposée
 *  ou votée et ses amendements adoptés. Elle ne dit pas « qui fait foi » : un texte
 *  jamais voté n'a aucune valeur juridique. Une bulle unique plutôt qu'une par cas, choix d'Alex : le
 *  squelette de chargement, qui ignore la version, peut la porter aussi. */
export function BadgeIA({ liste }: { liste?: boolean }) {
  const t = useTranslations('ceQuiMeConcerne');
  const locale = useLocale();
  const avecTitres = liste && locale === 'en';
  const cle = !liste ? 'avertissementFiche' : avecTitres ? 'avertissementTitresTraduits' : 'avertissement';
  return <AIBadge usage={avecTitres ? ['concerne', 'titres'] : 'concerne'} infobulle={t(cle)} />;
}

/** Les amendements de l'élément qui concernent un des profils `vus`. */
function amendementsConcernes(e: ElementConcerne, vus: string[]) {
  return e.sous.filter((s) => s.impacts.some((i) => vus.includes(i.profil)));
}

/** Les profils que le tiroir montre : ceux du lecteur quand l'élément ou un de ses
 *  amendements en touche un, sinon tous ceux qu'il touche. Le repli ne sert qu'au
 *  destinataire d'un lien partagé : partout ailleurs, une ligne ne s'ouvre que si
 *  elle touche un profil de `choisis`, où la fiche d'un texte ajoute le profil d'un
 *  bloc ouvert par son nom (`ProfilsNommes` de `PourVous.tsx`). */
function profilsVus(e: ElementConcerne, choisis: string[]): string[] {
  const touches = [...e.impacts, ...e.sous.flatMap((s) => s.impacts)].map((i) => i.profil);
  return touches.some((p) => choisis.includes(p)) ? choisis : [...new Set(touches)];
}

/** Début de l'ancre d'un changement partagé, écrite par `lienChangement` et lue par
 *  `changementDuFragment` : un seul endroit, pour que les deux ne divergent pas. */
const PREFIXE_CHANGEMENT = '#changement=';

/** Adresse partageable d'un changement : la fiche du texte, et une ancre qui y
 *  rouvre son tiroir. L'ancre ne part jamais au serveur (D-243). L'id porte `:` et
 *  `#` (`article:<texte>#<ordre>`), d'où l'encodage. */
export function lienChangement(locale: string, dossierUid: string, elementId: string): string {
  return buildShareUrl(locale, `/dossiers-legislatifs/${dossierUid}/resume-ia${PREFIXE_CHANGEMENT}${encodeURIComponent(elementId)}`);
}

/** L'id d'élément porté par `window.location.hash`, ou null. Un fragment mal encodé,
 *  tapé à la main, fait lever `decodeURIComponent` : il ne nomme rien. */
export function changementDuFragment(hash: string): string | null {
  if (!hash.startsWith(PREFIXE_CHANGEMENT)) return null;
  try {
    return decodeURIComponent(hash.slice(PREFIXE_CHANGEMENT.length)) || null;
  } catch {
    return null;
  }
}

/** L'article d'un texte nommé par l'ancre d'un lien partagé. `undefined` quand il n'y
 *  est plus (texte promulgué, nouvelle version classée). Jamais un amendement : le sien
 *  se partage par l'adresse de sa page. */
export function elementDepuisAncre(dossier: DossierConcerne, id: string): ElementConcerne | undefined {
  return dossier.elements.find((x) => x.id === id && !x.propre);
}

/** Les petits liens du tiroir (amendements liés, texte de l'article visé) : en gris,
 *  soulignés au survol. Pas en couleur d'accent : les surtitres du tiroir sont en teal
 *  (`--surtitre`), et deux teals voisins brouillaient ce qui se clique. */
function styleLien(survole: boolean) {
  return { color: 'var(--muted-foreground)', textDecoration: survole ? 'underline' : 'none', textUnderlineOffset: 3, display: 'inline-flex', alignItems: 'center', gap: '0.2rem' } as const;
}

/** Clé `localStorage` des sections repliées du tiroir d'un amendement, depuis ses deux entrées. */
const CLE_PLI_TIROIR_AMENDEMENT = 'amendement-tiroir-plie';
/** La même chose pour le tiroir d'un article. */
const CLE_PLI_TIROIR_ARTICLE = 'article-tiroir-plie';

/** De quoi parle le brouillon de courriel du tiroir : le texte, et l'article ou
 *  l'amendement ouvert (`buildMailto`). */
type ContexteCourriel = { dossier: DossierContext; element: ElementContext };

/** La langue du brouillon, celle de la page. */
function useLocaleCourriel(): Locale {
  return useLocale() === 'en' ? 'en' : 'fr';
}

/** Un petit lien en couleur d'accent, à droite d'une ligne : « Écrire » (un `mailto:`),
 *  « Écrire au Premier ministre » (son formulaire, `externe`, dans un autre onglet) ou
 *  « Identifier mes élus » (un bouton). Seuls gestes du tiroir à porter l'accent : ce
 *  sont des actions, les autres liens mènent à une page. */
function LienAction({ href, externe, onClick, ariaLabel, children }: { href?: string; externe?: boolean; onClick?: () => void; ariaLabel?: string; children: ReactNode }) {
  const { survole, surSurvol } = useSurvol();
  const style = {
    flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontFamily: 'inherit', fontSize: '0.8125rem', lineHeight: 1.4,
    color: 'var(--primary)', textDecoration: survole ? 'underline' : 'none', textUnderlineOffset: 3,
    background: 'none', border: 0, padding: 0, cursor: 'pointer',
  } as const;
  return href
    ? <a href={href} aria-label={ariaLabel} {...(externe ? { target: '_blank', rel: 'noopener noreferrer' } : {})} {...surSurvol} style={style}>{children}</a>
    : <button type="button" onClick={onClick} aria-label={ariaLabel} {...surSurvol} style={style}>{children}</button>;
}

/** Un élu à qui écrire : photo, nom et groupe (lien vers sa fiche), et à droite
 *  « Écrire », ou ses réseaux quand il ne publie pas de courriel (14 des 922 élus en
 *  exercice au 2026-10-19). Rien à droite s'il n'a ni l'un ni l'autre, ce qui est le
 *  cas de tout ancien élu (la route vide son contact). */
function LigneEluContact({ elu, courriel }: { elu: EluContactable; courriel: ContexteCourriel }) {
  const t = useTranslations('ceQuiMeConcerne');
  const locale = useLocaleCourriel();
  const { survole, surSurvol } = useSurvol();
  const nom = `${elu.prenom ?? ''} ${elu.nom ?? ''}`.trim();
  const href = buildMailto(elu, { locale, ...courriel });
  const reseaux = href ? [] : getSocials(elu);
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
      <Link href={`/les-elus/${elu.uid}`} prefetch={false} {...surSurvol} style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.625rem', color: 'var(--foreground)', textDecoration: 'none' }}>
        <PhotoEluVignette acteur={elu} taille={32} ancien={elu.ancien} />
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.35, textDecoration: survole ? 'underline' : 'none', textUnderlineOffset: 3 }}>{nom}</span>
          {elu.groupe && <span style={STYLE_PETIT}>{elu.groupe}</span>}
        </span>
      </Link>
      {href ? (
        <LienAction href={href} ariaLabel={t('ecrireA', { nom: appellation(elu, locale) })}>
          <Mail size={13} strokeWidth={1.75} aria-hidden />
          {t('ecrire')}
        </LienAction>
      ) : reseaux.length > 0 && (
        <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '0.625rem' }}>
          {reseaux.map(({ href: lien, Icon, label }) => (
            <a key={label} href={lien} target="_blank" rel="noopener noreferrer" aria-label={label} title={label} style={{ display: 'inline-flex', color: 'var(--muted-foreground)' }}>
              <Icon size={14} aria-hidden />
            </a>
          ))}
        </span>
      )}
    </div>
  );
}

/** Qui a proposé l'amendement du tiroir, ou déposé le texte de son article : l'élu
 *  (`LigneEluContact`), le Gouvernement avec le formulaire du Premier ministre (comme
 *  le bandeau de la fiche du texte), ou le nom d'une commission. Un texte du
 *  Gouvernement nomme dessous ses rapporteurs, au plus un par chambre, à qui écrire
 *  aussi. L'auteur arrive avec le détail de l'élément, après l'ouverture : la
 *  section est là dès l'ouverture, un squelette à la place de l'élu (`chargement`),
 *  pour que les sections du dessous ne sautent pas à son arrivée. Rien quand l'auteur
 *  n'a ni fiche ni nom (député absent d'`acteurs`), ni quand le détail n'a pas pu être
 *  chargé. */
function SectionAuteur({ auteur, chargement, courriel }: {
  auteur: Detail['auteur'];
  chargement: boolean;
  courriel: ContexteCourriel;
}) {
  const t = useTranslations('ceQuiMeConcerne');
  const gouvernement = auteur?.type === 'gouvernement';
  const elus = auteur?.elus ?? [];
  // Le nom affiché sans ligne d'élu : le Gouvernement, ou une commission.
  const nomSeul = gouvernement ? t('gouvernement') : elus.length ? null : auteur?.libelle;
  if (!chargement && !nomSeul && !elus.length) return null;
  const listeElus = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
      {elus.map((elu) => <LigneEluContact key={elu.uid} elu={elu} courriel={courriel} />)}
    </div>
  );
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {chargement ? (
        // Même encombrement que la ligne d'un élu : photo de 32 px, nom et groupe.
        <span aria-hidden style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <Skeleton style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0 }} />
          <span style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <Skeleton style={{ width: '9rem', height: '0.875rem' }} />
            <Skeleton style={{ width: '6rem', height: '0.625rem' }} />
          </span>
        </span>
      ) : nomSeul ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
          <span style={{ fontSize: '0.9375rem', fontWeight: 500, color: 'var(--foreground)' }}>{nomSeul}</span>
          {gouvernement && (
            <LienAction href={FORMULAIRE_PREMIER_MINISTRE} externe>
              {t('ecrirePremierMinistre')}
              <ExternalLink size={12} strokeWidth={1.75} aria-hidden />
            </LienAction>
          )}
        </div>
      ) : listeElus}
      {!chargement && gouvernement && elus.length > 0 && (
        <>
          <h3 style={{ ...STYLE_SURTITRE, margin: '0.75rem 0 0' }}>{t('rapporteurs', { n: elus.length })}</h3>
          {listeElus}
        </>
      )}
    </section>
  );
}

/** Même taille que la photo de l'auteur (`LigneEluContact`). */
const TAILLE_PHOTO_MES_ELUS = 32;

/** Une photo de « Mes élus », dont la bulle donne le nom. Le tooltip Radix ignore le
 *  toucher : comme `InfoBulle` du bandeau, il est piloté ici, le survol l'ouvre à la
 *  souris et un tap le bascule au doigt. Les `preventDefault` sautent les gestionnaires
 *  internes de Radix, qui sinon refermeraient la bulle au même tap. */
function PhotoMonElu({ elu }: { elu: EluRef }) {
  const [ouvert, setOuvert] = useState(false);
  const declencheurRef = useRef<HTMLButtonElement>(null);
  // Type du dernier appui, vidé au clic qui le suit : le focus qu'il provoque n'ouvre rien.
  const appuiRef = useRef<string | null>(null);
  const nom = `${elu.prenom ?? ''} ${elu.nom ?? ''}`.trim();
  return (
    <Tooltip open={ouvert} onOpenChange={setOuvert}>
      <TooltipTrigger asChild>
        <button
          ref={declencheurRef}
          type="button"
          aria-label={nom}
          onPointerDown={(e) => {
            appuiRef.current = e.pointerType;
            e.preventDefault();
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === 'touch') e.preventDefault();
          }}
          onFocus={(e) => {
            if (appuiRef.current) e.preventDefault();
          }}
          onClick={(e) => {
            e.preventDefault();
            if (appuiRef.current === 'mouse') setOuvert(true);
            else setOuvert((o) => !o);
            appuiRef.current = null;
          }}
          style={{ display: 'inline-flex', padding: 0, border: 0, background: 'none', cursor: 'default' }}
        >
          <PhotoEluVignette acteur={{ ...elu, url_profil_officiel: elu.url_profil_officiel ?? null }} taille={TAILLE_PHOTO_MES_ELUS} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        onPointerDownOutside={(e) => {
          if (declencheurRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        {nom}
      </TooltipContent>
    </Tooltip>
  );
}

/** Les élus que le lecteur a gardés dans son navigateur : leurs photos (le nom en
 *  bulle), et un courriel à tous ceux qui publient une adresse (à l'unique élu
 *  joignable, nommé, s'il n'y en a qu'un), comme le bandeau de la fiche du texte
 *  (`contact-elus.ts`). « Modifier » rouvre la recherche par code postal
 *  (`TrouverMonDeputeModal`, montée une fois par le layout `(app)`), « Oublier » vide la
 *  liste, comme dans le bandeau. Sans élu enregistré, « Identifier mes élus » ouvre la
 *  même recherche. Rien ne part vers le serveur : la liste vient du navigateur. */
function MesElusTiroir({ courriel, cleStockage }: { courriel: ContexteCourriel; cleStockage: string }) {
  const t = useTranslations('ceQuiMeConcerne');
  const locale = useLocaleCourriel();
  const { data, clear } = useMesElus();
  // Le bandeau qui le fait d'ordinaire n'est pas monté sur « Ce qui me concerne ».
  useCompleterSenateurs();
  const elus = elusEnregistres(data);
  const { href, seul } = courrielMesElus(elus, { locale, ...courriel });
  const actions = elus.length > 0 && (
    <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
      <HintIconButton ariaLabel={t('modifierCourt')} onClick={() => openTrouverMonDeputeModal()} icon={<Pencil size={11} />} label={t('modifierCourt')} />
      <HintIconButton ariaLabel={t('oublierCourt')} onClick={clear} icon={<Trash2 size={11} />} label={t('oublierCourt')} />
    </span>
  );
  const ligne = (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem 0.75rem' }}>
        {elus.length > 0 && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            {elus.map(({ elu, chambre }) => <PhotoMonElu key={`${chambre}-${elu.uid}`} elu={elu} />)}
          </span>
        )}
        {elus.length === 0 ? (
          <LienAction onClick={() => openTrouverMonDeputeModal()}>{t('identifierMesElus')}</LienAction>
        ) : href && (
          <LienAction href={href}>
            <Mail size={13} strokeWidth={1.75} aria-hidden />
            {seul ? t('ecrireA', { nom: appellation(seul.elu, locale) }) : t('ecrireMesElus')}
          </LienAction>
        )}
      </div>
  );
  // Sans carte tant qu'aucun élu n'est connu : il n'y a alors qu'un lien à montrer.
  return (
    <SectionRepliable
      cle="mes-elus"
      cleStockage={cleStockage}
      icone={<UsersRound size={14} strokeWidth={1.5} aria-hidden style={{ flex: 'none', color: 'var(--muted-foreground)' }} />}
      titre={t('mesElus')}
      carte={elus.length > 0}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>{ligne}{actions}</div>
    </SectionRepliable>
  );
}

/** Un amendement lié, en bas du tiroir : numéro (lien vers sa page), lieu et, s'il existe, son résumé. */
function LigneAmendement({ a }: { a: AmendementLie }) {
  const t = useTranslations('ceQuiMeConcerne');
  const tAmendement = useTranslations('amendementPage');
  const tResume = useTranslations('resumeIA');
  const { survole, surSurvol } = useSurvol();
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
      <span style={STYLE_PETIT}>
        <Link href={`/Amendements/${a.uid}`} prefetch={false} {...surSurvol} style={styleLien(survole)}>
          {t('amendementNumero', { numero: a.numero })}
        </Link>
        {' · '}
        {tAmendement(a.lieu === 'seance' ? 'adopteSeance' : 'adopteCommission', { chambre: tResume(a.chambre === 'SN' ? 'senat' : 'assemblee') })}
      </span>
      {a.resume && <span style={{ fontSize: '0.875rem', lineHeight: 1.5, color: 'var(--card-foreground)' }}>{a.resume}</span>}
    </li>
  );
}

/** Vrai quand « Qui l'a déposé » a quelqu'un à montrer. */
function aUnAuteur(auteur: Detail['auteur']): boolean {
  return !!auteur && (auteur.type === 'gouvernement' || !!auteur.libelle || !!auteur.elus?.length);
}

/** Les premiers « autres amendements » montrés à l'ouverture, comme sur la page d'un amendement. */
const AUTRES_PREMIERS = 10;

/** Pictogramme d'un titre de section, au format de `SectionRepliable`. */
function iconeSection(I: LucideIcon) {
  return <I size={14} strokeWidth={1.5} aria-hidden style={{ flex: 'none', color: 'var(--muted-foreground)' }} />;
}

/** Contenu du tiroir d'un article, au format de celui d'un amendement
 *  (`CorpsTiroirAmendement`) : en-tête, résumé pour chaque profil montré (`profilsVus`),
 *  auteur, élus du lecteur, puis les amendements : ceux qui
 *  concernent ces profils, et les autres. Un article n'a ni exposé des motifs, ni vote, ni
 *  débats rattachés : ces sections n'y figurent pas. « Partager » donne le lien vers ce
 *  tiroir (`lienChangement`), un article n'ayant pas de page. Monté seulement quand le
 *  tiroir est ouvert, donc replié à chaque ouverture.
 *
 *  Tout article du tiroir a un résumé : la liste ne montre que les articles classés pour au
 *  moins un profil. Le texte officiel se lit donc par le lien de source, et ne s'affiche que
 *  si ce lien manque (site officiel signalé inaccessible ; aucun cas au 2026-11-09). */
function ContenuTiroir({ dossier, e, choisis, version, onFermer }: { dossier: DossierConcerne; e: ElementConcerne; choisis: string[]; version: string; onFermer: () => void }) {
  const t = useTranslations('ceQuiMeConcerne');
  const tAmendement = useTranslations('amendementPage');
  const tPartage = useTranslations('share');
  const locale = useLocale();
  // Les profils montrés que l'élément concerne.
  const vus = profilsVus(e, choisis);
  const impactsChoisis = e.impacts.filter((i) => vus.includes(i.profil));
  const { detail, erreur } = useDetail(e.source, locale, version, true);
  const concernes = amendementsConcernes(e, vus);
  const uidsConcernes = new Set(concernes.map((s) => s.propre?.uid));
  const lies = detail?.amendements ?? [];
  const autres = lies.filter((a) => !uidsConcernes.has(a.uid));
  const [autresDeplies, setAutresDeplies] = useState(false);
  const autresMontres = autresDeplies ? autres : autres.slice(0, AUTRES_PREMIERS);
  const stades = new Set(lies.map((a) => a.lieu));
  // Au budget, la séance repart du texte du Gouvernement (art. 42 de la
  // Constitution) : un amendement de commission doit y être revoté. Ailleurs, il est
  // déjà dans le texte que la séance examine.
  const noteCommission = dossier.budget ? 'noteCommission' : 'noteCommissionTexte';
  const courriel: ContexteCourriel = {
    // Le titre officiel français : le courriel aux élus ne cite jamais une traduction.
    dossier: { uid: dossier.uid, titre: dossier.titreOfficiel ?? dossier.titre, statut: dossier.statut },
    element: { type: 'article', numero: e.libelle },
  };
  const source = detail?.source ?? null;
  const chargement = !detail && !erreur;
  // Une loi publiée contient déjà ses amendements : la route n'en classe aucun pour elle.
  const estLoi = 'texte' in e.source && e.source.loi;
  const phraseVide = (cle: string) => (
    <p className="text-sm text-muted-foreground m-0" style={{ lineHeight: 1.5 }}>
      {chargement ? t('chargement') : estLoi ? tAmendement('amendementsLoi') : tAmendement(cle)}
    </p>
  );
  const auteurVisible = chargement || aUnAuteur(detail?.auteur);
  return (
    <>
      {/* À gauche de la croix, comme dans le tiroir d'un amendement. */}
      <span style={{ position: 'absolute', top: 10, right: 42 }}>
        <ShareButton
          discret
          url={lienChangement(locale, dossier.uid, e.id)}
          message={t('partageMessage', { element: e.libelle, texte: dossier.titre })}
          ariaLabel={tPartage('shareChangeLabel')}
        />
      </span>
      <EnteteTiroir
        nom={articleEnEntier(e.libelle)}
        texte={{ uid: dossier.uid, titre: dossier.titre, traduit: !!dossier.titreOfficiel }}
        etats={[{
          etiquette: tAmendement('enteteEtatTexte'),
          statut: dossier.statutFinal,
          libelle: dossier.statut,
          complement: dossier.date && tAmendement('statutLe', { date: dossier.date }),
        }]}
        onFermer={onFermer}
      />
      <div>
        <SectionRepliable
          cle="pour-vous"
          cleStockage={CLE_PLI_TIROIR_ARTICLE}
          icone={iconeSection(FileText)}
          titre={tAmendement('sectionResume')}
          badge={<AIBadge usage="concerne" />}
        >
          <div style={{ ...AI_FRAME_STYLE, overflow: 'hidden' }}>
            <div style={{ ...AI_INNER_STYLE, padding: '16px 18px' }}>
              <div className="flex flex-col" style={{ gap: '14px' }}>
                {impactsChoisis.map((i) => (
                  <div key={i.profil}>
                    <p className="text-xs m-0" style={{ fontWeight: 600, lineHeight: 1.5 }}>{tAmendement('concerneProfils', { profils: t(`profils.${i.profil}`) })}</p>
                    <p className="text-sm m-0" style={{ marginTop: '4px', lineHeight: 1.6 }}>{i.phrase}</p>
                    {/* Vide quand le passage cité n'a pas été retrouvé dans le texte : la
                        page ne montre jamais une citation que le texte ne contient pas. */}
                    {detail?.passages[i.profil] ? (
                      <p className="text-xs text-muted-foreground m-0" style={{ marginTop: '2px', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
                        {tAmendement('passageCite', { passage: sansGuillemetsExterieurs(detail.passages[i.profil]) })}
                      </p>
                    ) : chargement && <Skeleton style={{ width: '70%', height: 12, marginTop: 6 }} />}
                  </div>
                ))}
              </div>
              <AICardFooter>
                {source && (
                  <a href={source} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline font-medium">
                    {tAmendement('sourceArticle')} →
                  </a>
                )}
              </AICardFooter>
            </div>
          </div>
        </SectionRepliable>

        {/* Seulement sans lien source : il n'y aurait plus d'autre accès au texte. La route
            n'envoie le texte que dans ce cas (`sans_texte`). */}
        {detail?.texte && !source && (
          <SectionRepliable cle="texte" cleStockage={CLE_PLI_TIROIR_ARTICLE} icone={iconeSection(ScrollText)} titre={tAmendement('texteOfficiel')} carte>
            <div className="flex flex-col" style={{ gap: '12px' }}>
              <TexteOfficiel cadre>{detail.texte}</TexteOfficiel>
              {locale !== 'fr' && <p className="text-xs text-muted-foreground m-0">{tAmendement('mentionFrancais')}</p>}
            </div>
          </SectionRepliable>
        )}

        <SectionRepliable cle="auteur" cleStockage={CLE_PLI_TIROIR_ARTICLE} icone={iconeSection(UserRound)} titre={tAmendement('sectionAuteurTexte')} carte={auteurVisible}>
          {auteurVisible
            ? <SectionAuteur auteur={detail?.auteur} chargement={chargement} courriel={courriel} />
            : <p className="text-sm text-muted-foreground m-0">{tAmendement('sansAuteur')}</p>}
        </SectionRepliable>

        <MesElusTiroir courriel={courriel} cleStockage={CLE_PLI_TIROIR_ARTICLE} />

        {/* `n` à 2 sans amendement : le titre reste au pluriel, 0 prenant le singulier en français. */}
        <SectionRepliable
          cle="amendements-concernes"
          cleStockage={CLE_PLI_TIROIR_ARTICLE}
          icone={iconeSection(Rows3)}
          titre={t('amendementsConcernent', { n: concernes.length || 2 })}
          badge={concernes.some((s) => s.propre?.resume) ? <AIBadge usage="concerne" court /> : undefined}
          carte={concernes.length > 0}
        >
          {concernes.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {concernes.map((s) => s.propre && (
                <li key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  {/* Même résumé que dans la liste, et les profils montrés (`profilsVus`) qu'il touche. */}
                  <span style={{ ...STYLE_PETIT, fontWeight: 600 }}>
                    {s.impacts.filter((i) => vus.includes(i.profil)).map((i) => t(`profils.${i.profil}`)).join(' · ')}
                  </span>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}><LigneAmendement a={s.propre} /></ul>
                </li>
              ))}
            </ul>
          ) : phraseVide('sansAmendementProfil')}
        </SectionRepliable>

        <SectionRepliable
          cle="amendements-autres"
          cleStockage={CLE_PLI_TIROIR_ARTICLE}
          icone={iconeSection(Rows3)}
          titre={tAmendement('sectionAutres')}
          badge={autres.some((a) => a.resume) ? <AIBadge usage="concerne" court /> : undefined}
          carte={autres.length > 0}
        >
          {autres.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {autresMontres.map((a) => <LigneAmendement key={a.uid} a={a} />)}
              {autresMontres.length < autres.length && (
                <li>
                  <button type="button" onClick={() => setAutresDeplies(true)} className="text-sm text-primary hover:underline" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>
                    {tAmendement('autresVoirPlus', { n: autres.length - autresMontres.length })}
                  </button>
                </li>
              )}
            </ul>
          ) : phraseVide('autresAucun')}
        </SectionRepliable>

        {/* La note de chaque stade présent, une fois pour tous les amendements de l'article. */}
        {lies.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.75rem' }}>
            {stades.has('seance') && <span style={STYLE_PETIT}>{t('noteSeance')}</span>}
            {stades.has('commission') && <span style={STYLE_PETIT}>{t(noteCommission)}</span>}
          </div>
        )}

        <BoutonsPageSource
          page={{ href: `/dossiers-legislatifs/${dossier.uid}/resume-ia`, libelle: tAmendement('ouvrirTexte'), onClick: onFermer }}
          source={source ? { href: source, libelle: tAmendement('badgeSource') } : null}
        />
        <div style={{ height: '1rem' }} />
      </div>
    </>
  );
}

/** Ce qu'il faut savoir d'un amendement avant d'avoir chargé son détail. */
type AmendementTiroir = Pick<AmendementLie, 'uid' | 'numero' | 'lieu' | 'chambre'> & { article: string | null };

/** Le corps du tiroir d'un amendement, le même depuis « Modifications du texte »
 *  (`AmendementSheet`) et depuis « Ce qui me concerne » : en-tête, sections de la page
 *  (`SectionsAmendement`), « Écrire » à l'auteur et, juste dessous, « Mes élus ». L'en-tête nomme
 *  toujours le texte, avec un lien vers sa fiche ; sur cette fiche, le lien referme le
 *  tiroir, l'adresse ne changeant pas. « Partager » donne l'adresse de la page de
 *  l'amendement. */
export function CorpsTiroirAmendement({ amendement, detail, status, texte, onFermer }: {
  amendement: AmendementTiroir;
  /** `null` tant que le détail charge. */
  detail: DetailAmendement | null;
  status: 'loading' | 'error';
  /** Le texte quand il est déjà connu, pour le nommer avant la fin du chargement. */
  texte?: { uid: string; titre: string; traduit: boolean };
  onFermer: () => void;
}) {
  const t = useTranslations('amendementPage');
  const tResume = useTranslations('resumeIA');
  const locale = useLocale();
  const nom = t('nom', { numero: amendement.numero });
  const chemin = `/Amendements/${amendement.uid}`;
  const leTexte = detail ? { uid: detail.dossier_uid, titre: detail.titre_texte, traduit: detail.titre_traduit } : texte;
  // Le titre officiel français : le courriel aux élus ne cite jamais une traduction.
  const courriel: ContexteCourriel | null = detail && {
    dossier: { uid: detail.dossier_uid, titre: detail.dossier_titre ?? '', statut: detail.statut_final },
    element: { type: 'amendement', numero: detail.numero, url: detail.url },
  };
  // Sans auteur à montrer, « Qui l'a déposé » garde la phrase de `SectionsAmendement`.
  const auteurConnu = aUnAuteur(detail?.auteur);
  return (
    <>
      {/* À gauche de la croix, comme dans le tiroir d'un vote. */}
      <span style={{ position: 'absolute', top: 10, right: 42 }}>
        <ShareButton
          discret
          url={buildShareUrl(locale, chemin)}
          message={t('partageMessage', { nom })}
          ariaLabel={t('partagerLabel')}
        />
      </span>
      <EnteteTiroir
        nom={amendement.article ? `${nom} · ${articleEnEntier(amendement.article)}` : nom}
        texte={leTexte}
        etats={[
          // Tant que le détail charge, la ligne garde sa place (voir `EtatEntete`).
          ...(detail?.etat_texte ? [{
            etiquette: t('enteteEtatTexte'),
            statut: detail.etat_texte.statut,
            libelle: detail.etat_texte.libelle,
            complement: detail.etat_texte.date && t('statutLe', { date: detail.etat_texte.date }),
          }] : !detail && status === 'loading' ? [{ etiquette: t('enteteEtatTexte'), statut: null, libelle: null, enChargement: true }] : []),
          {
            etiquette: t('enteteEtatAmendement'),
            statut: 'Adopté',
            libelle: tResume('adopted'),
            complement: t(amendement.lieu === 'seance' ? 'complementSeance' : 'complementCommission', { chambre: tResume(amendement.chambre === 'AN' ? 'assemblee' : 'senat') }),
          },
        ]}
        onFermer={onFermer}
      />
      <div>
        <SectionsAmendement
          detail={detail}
          status={status}
          cleStockage={CLE_PLI_TIROIR_AMENDEMENT}
          compact
          lienPage
          auteurContenu={courriel && auteurConnu ? <SectionAuteur auteur={detail?.auteur} chargement={false} courriel={courriel} /> : undefined}
          apresAuteur={courriel ? <MesElusTiroir courriel={courriel} cleStockage={CLE_PLI_TIROIR_AMENDEMENT} /> : undefined}
        />
      </div>
    </>
  );
}

/** Le tiroir d'un amendement ouvert depuis « Ce qui me concerne » : le corps commun, avec
 *  le titre de son texte et son article, connus avant le chargement. */
function ContenuTiroirAmendement({ dossier, e, propre, version, onFermer }: {
  dossier: DossierConcerne;
  e: ElementConcerne;
  propre: AmendementLie;
  version: string;
  onFermer: () => void;
}) {
  const { detail, erreur } = useDetail(e.source, useLocale(), version);
  // L'article sous lequel `ce-qui-me-concerne.ts` l'a rangé. Un amendement qui ajoute un
  // article n'en a pas : le sien arrive avec le détail.
  const article = dossier.elements.find((p) => p.sous.some((s) => s.id === e.id))?.libelle ?? detail?.fiche?.article ?? null;
  return (
    <CorpsTiroirAmendement
      amendement={{ uid: propre.uid, numero: propre.numero, lieu: propre.lieu, chambre: propre.chambre, article }}
      detail={detail?.fiche ?? null}
      status={erreur ? 'error' : 'loading'}
      texte={{ uid: dossier.uid, titre: dossier.titre, traduit: !!dossier.titreOfficiel }}
      onFermer={onFermer}
    />
  );
}

/** Un changement pour un profil : ce qui change, puis, dessous en petit, d'où ça
 *  vient (l'article, ou l'amendement et son stade) et de quel texte. Le lecteur
 *  cherche l'effet, pas l'article : la source n'est là que pour remonter au texte,
 *  par le tiroir. */
export type Changement = {
  dossier: DossierConcerne;
  e: ElementConcerne;
  phrase: string;
  /** « Art. 7 · texte en discussion », « Amendement I-CF1741 à l'art. 7 · adopté en commission »… */
  source: string;
  /** Un amendement dont l'article est aussi dans la section, juste au-dessus : décalé
   *  sous lui pour se lire comme sa modification, pas comme un changement de plus. */
  sousArticle: boolean;
};

/** D'où vient un changement, dit sous sa phrase. Un amendement décalé sous son
 *  article n'a pas à le renommer ; seul, il dit lequel il modifie : « Amendement
 *  I-CF1741 à l'art. 7 ». Rendu par un hook pour lire les traductions. */
export function useSourceDe() {
  const t = useTranslations('ceQuiMeConcerne');
  const stade = (a: AmendementLie) => t(a.lieu === 'seance' ? 'stadeSeance' : 'stadeCommission');
  return (e: ElementConcerne, parent: ElementConcerne | undefined, sousArticle: boolean): string => {
    if (e.propre && sousArticle) return `${t('sourceAmendement', { numero: e.propre.numero })} · ${stade(e.propre)}`;
    if (e.propre && parent) {
      return `${t('sourceAmendementArticle', { numero: e.propre.numero, article: parent.libelle.replace(/^Art\./, 'art.') })} · ${stade(e.propre)}`;
    }
    if (e.propre) return `${e.libelle} · ${stade(e.propre)}`;
    return 'texte' in e.source && e.source.loi ? e.libelle : t('sourceTexte', { article: e.libelle });
  };
}
export type SourceDe = ReturnType<typeof useSourceDe>;

/** Les lignes d'un texte pour un profil, dans l'ordre du texte, chaque amendement
 *  juste après l'article qu'il modifie.
 *
 *  `filtre` (la recherche de la page « Ce qui me concerne ») reçoit le titre du texte,
 *  la phrase et la source de chaque ligne ; sans lui, ni la source ni sa vérification
 *  ne sont calculées, ce calcul tournant sur tous les textes chargés à chaque rendu.
 *
 *  `retrait` décale un amendement sous son article quand l'article concerne aussi le
 *  profil (et passe le filtre) : il se lit comme sa modification. Sinon l'amendement
 *  reste seul, sans retrait, et dit quel article il modifie. La fiche d'un texte le
 *  désactive : elle range les amendements à part, sous leurs articles. */
export function lignesDe(
  d: DossierConcerne,
  profil: string,
  sourceDe: SourceDe,
  { filtre, retrait = true }: { filtre?: (titre: string, phrase: string, source: string) => boolean; retrait?: boolean } = {},
): Changement[] {
  const retenus = d.elements
    .flatMap((e) => [{ e, parent: undefined as ElementConcerne | undefined }, ...e.sous.map((s) => ({ e: s, parent: e }))])
    .flatMap(({ e, parent }) => {
      const i = e.impacts.find((x) => x.profil === profil);
      const phrase = e.propre?.resume ?? i?.phrase;
      // Sur /en, la recherche trouve aussi le texte par son titre officiel français.
      const titres = d.titreOfficiel ? `${d.titre} ${d.titreOfficiel}` : d.titre;
      return i && phrase && (!filtre || filtre(titres, phrase, sourceDe(e, parent, false))) ? [{ e, parent, phrase }] : [];
    });
  const ids = new Set(retenus.map((r) => r.e.id));
  return retenus.map(({ e, parent, phrase }): Changement => {
    const sousArticle = retrait && !!parent && ids.has(parent.id);
    return { dossier: d, e, phrase, source: sourceDe(e, parent, sousArticle), sousArticle };
  });
}

/** Format des dates de ligne (« 12 oct. 2026 »), créé une fois par langue : la page
 *  rend des centaines de lignes. `timeZone: 'UTC'` parce que `jour` est un jour civil
 *  sans heure, que `new Date` lit à minuit UTC : dans un autre fuseau, le jour
 *  affiché pourrait reculer d'un cran. */
const formatsDate = new Map<string, ReturnType<typeof formateurDate>>();
function dateCourte(jour: string, locale: string): string {
  let f = formatsDate.get(locale);
  if (!f) {
    f = formateurDate(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    formatsDate.set(locale, f);
  }
  return f.format(new Date(jour));
}

/** Une ligne de section, sur deux rangs comme les cartes de la page Textes : ce qui
 *  change, puis en petit la pastille du statut du texte, la source, sa date et le
 *  titre du texte. Le second rang tient sur une ligne et se coupe en points de
 *  suspension : source et date viennent d'abord, c'est le titre, déjà lisible dans le
 *  tiroir, qui cède. `dansLeTexte` (la fiche du texte) ne garde que la source et la
 *  date : statut et titre y sont déjà en tête de page. La date est seule, sans verbe
 *  (voir `ElementConcerne.date`). */
export function LigneChangement({ c, onOuvrir, dansLeTexte = false }: { c: Changement; onOuvrir: () => void; dansLeTexte?: boolean }) {
  const { survole, surSurvol } = useSurvol();
  const locale = useLocale();
  const tAmendement = useTranslations('amendementPage');
  const date = c.e.date ? dateCourte(c.e.date, locale) : null;
  const vote = c.e.propre?.avecVote ? tAmendement('avecVote') : null;
  const rang = [c.source, vote, date, dansLeTexte ? null : c.dossier.titre].filter(Boolean).join(' · ');
  return (
    <li style={c.sousArticle ? { marginLeft: '1.5rem', borderLeft: '1px solid var(--border)' } : undefined}>
      <button
        type="button"
        onClick={onOuvrir}
        aria-haspopup="dialog"
        {...surSurvol}
        style={{
          width: '100%', textAlign: 'left', border: 0, cursor: 'pointer', color: 'inherit', font: 'inherit',
          display: 'flex', flexDirection: 'column', gap: '0.3rem', padding: '10px 16px', borderRadius: '0.5rem',
          backgroundColor: survole ? 'var(--muted)' : 'transparent', transition: 'background-color 0.15s ease',
        }}
      >
        <span style={{ fontSize: '0.9375rem', lineHeight: 1.55, color: 'var(--foreground)' }}>{c.phrase}</span>
        <span style={{ ...STYLE_PETIT, display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0, maxWidth: '100%' }}>
          {!dansLeTexte && <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: c.dossier.couleurStatut, flexShrink: 0 }} />}
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rang}
          </span>
        </span>
      </button>
    </li>
  );
}

/** Le tiroir d'un changement, ouvert à droite sur bureau et par le bas sur téléphone,
 *  comme les volets de la fiche dossier. `version` entre dans l'adresse de la requête
 *  du détail (`v=`), pour que le CDN ne serve pas la réponse d'une version passée. */
export function TiroirChangement({ ouvert, onFermer, choisis, version }: {
  ouvert: { dossier: DossierConcerne; e: ElementConcerne } | null;
  onFermer: () => void;
  choisis: string[];
  version: string;
}) {
  const mobile = useEcranMobile();
  return (
    <Sheet open={ouvert !== null} onOpenChange={(o) => { if (!o) onFermer(); }}>
      <SheetContent
        side={mobile ? 'bottom' : 'right'}
        size={mobile ? 'content' : 'default'}
        className={mobile ? 'max-h-[85vh] overflow-y-auto rounded-t-2xl' : 'overflow-y-auto'}
        style={mobile ? { width: '100%' } : undefined}
      >
        {ouvert && (ouvert.e.propre
          ? <ContenuTiroirAmendement dossier={ouvert.dossier} e={ouvert.e} propre={ouvert.e.propre} version={version} onFermer={onFermer} />
          : <ContenuTiroir dossier={ouvert.dossier} e={ouvert.e} choisis={choisis} version={version} onFermer={onFermer} />)}
      </SheetContent>
    </Sheet>
  );
}
