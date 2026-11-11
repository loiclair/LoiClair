'use client';

// Section « Sources et acteurs » de la fiche dossier, rendue après la presse par
// ResumeIAClient. Rassemble ce qui était dispersé ailleurs : chaque version du
// texte, les pages officielles du dossier, la décision du Conseil constitutionnel,
// et les élus qui ont écrit, rapporté ou cosigné un texte. Le héros garde ses
// propres liens ; cette section les répète pour qu'un lecteur trouve tout au même
// endroit.
//
// Les élus arrivent déjà résolus et triés par nom depuis page.tsx, groupés par
// rôle. Chaque élu porte le badge de son rôle dans le texte (député, sénateur,
// gouvernement), calculé par page.tsx. Aucune liste ne s'allonge dans la carte
// (une proposition de loi compte jusqu'à 336 cosignataires) : dix documents
// sur ordinateur et six sur mobile, trois noms, puis « Voir les N » ouvre un
// panneau latéral qui porte la liste entière ; les cosignataires n'y sont que
// par leur nombre.
//
// Les amendements adoptés vivent dans la section « Modifications du texte »
// (ModificationsSection), qui reprend d'ici l'intertitre, les liens, les badges et
// le panneau : exportés pour qu'un même élément se dessine pareil dans les deux. La
// section « Les plus actifs dans ce dossier » (ElusActifsSection) reprend en plus la liste
// coupée et la ligne d'élu, dont le panneau montre en plus le score.

import { memo, useState, type ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import SectionRepliable from '@/components/SectionRepliable';
import { useEcranMobile } from '@/hooks/useEcranMobile';
import { CLE_PLI, IconeSection } from './SectionsDossier';

/** Rôle de l'élu dans le texte où il apparaît, pas sa fonction d'aujourd'hui.
 *  Seul un ancien élu le lit au passé (`BadgeRole`). */
export type BadgeElu = 'depute' | 'senateur' | 'gouvernement';

export interface EluSource {
  uid: string;
  prenom: string | null;
  nom: string | null;
  /** « Mme » ou « M. », qui accorde le badge d'un ancien élu. */
  civ: string | null;
  url_profil_officiel: string | null;
  /** Libellé du groupe politique, ou null hors groupe. */
  groupe: string | null;
  /** Ni député, ni sénateur, ni ministre en exercice : photo grisée, badge au passé. */
  ancien: boolean;
  badge: BadgeElu | null;
}

export interface SourcesDossier {
  lienAN: string | null;
  lienSenat: string | null;
  lienLegifrance: string | null;
  auteurs: EluSource[];
  rapporteurs: EluSource[];
  cosignataires: EluSource[];
}

/** Une version du texte, nommée comme la source du résumé. Sans `lien`, la ligne
 *  reste en gris ; la mention « non publié » ne s'ajoute que si `publie` est faux,
 *  un texte de Légifrance pouvant être publié sans lien enregistré. */
export interface DocumentSource {
  uid: string;
  label: string;
  lien: string | null;
  publie: boolean;
}

// Sur ordinateur, dix documents remplissent à peu près la colonne de gauche face à
// celle des élus, trois lignes de 50 px par bloc (une ligne de document en fait 31).
// Sur mobile, les colonnes s'empilent : des documents en plus n'y équilibreraient
// rien, ils allongeraient la carte.
const DOCUMENTS_VISIBLES = 10;
const DOCUMENTS_VISIBLES_MOBILE = 6;
const ELUS_VISIBLES = 3;

/** Cadre simple de la carte, repris par `ModificationsSection`. */
export const CARTE = { border: '1px solid var(--color-border)', backgroundColor: 'var(--card)', padding: '20px' };

/** Mémoïsée : ResumeIAClient se rend à chaque morceau du résumé en streaming, et
 *  cette section, qui peut porter des centaines de liens, n'en dépend pas. */
export default memo(function SourcesSection({
  sources,
  documents,
  urlDecisionCC,
}: {
  sources: SourcesDossier;
  documents: DocumentSource[];
  urlDecisionCC: string | null;
}) {
  const t = useTranslations('resumeIA');

  const pages = [
    sources.lienAN && { label: t('assemblee'), href: sources.lienAN },
    sources.lienSenat && { label: t('senat'), href: sources.lienSenat },
    sources.lienLegifrance && { label: t('legifrance'), href: sources.lienLegifrance },
    urlDecisionCC && { label: t('ccPill'), href: urlDecisionCC },
  ].filter((p): p is { label: string; href: string } => !!p);

  const aDesElus = sources.auteurs.length + sources.rapporteurs.length + sources.cosignataires.length > 0;

  return (
    <SectionRepliable
      cle="sources"
      cleStockage={CLE_PLI}
      icone={<IconeSection cle="sources" />}
      titre={t('sectionSources')}
    >
      <div className="rounded-xl grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6" style={CARTE}>
        <div className="space-y-6 min-w-0">
          {/* Sans aucun document (une mission ou une commission d'enquête en cours, le
              plus souvent : 21 des 45 dossiers à acte de nomination le 2026-10-20), la
              carte le dit, au-dessus des pages officielles s'il y en a, plutôt que de
              laisser cette colonne vide. */}
          {documents.length === 0 && (
            <p className="text-sm text-muted-foreground" style={{ margin: 0, lineHeight: 1.45 }}>{t('sourcesAucunDocument')}</p>
          )}
          {documents.length > 0 && (
            <Bloc titre={t('sourcesDocuments')}>
              <ListeCoupee
                titre={t('sourcesDocuments')}
                elements={documents}
                visibles={DOCUMENTS_VISIBLES}
                visiblesMobile={DOCUMENTS_VISIBLES_MOBILE}
                rendu={(d) => (
                  <li key={d.uid}>
                    {d.lien ? <LienExterne href={d.lien}>{d.label}</LienExterne> : (
                      <span className="block text-sm text-muted-foreground" style={{ padding: '4px 0', lineHeight: 1.45 }}>
                        {d.label}{!d.publie && ` · ${t('notPublishedYet')}`}
                      </span>
                    )}
                  </li>
                )}
              />
            </Bloc>
          )}
          {pages.length > 0 && (
            <Bloc titre={t('sourcesPagesOfficielles')}>
              <ul>
                {pages.map((p) => (
                  <li key={p.href}><LienExterne href={p.href}>{p.label}</LienExterne></li>
                ))}
              </ul>
            </Bloc>
          )}
        </div>

        {aDesElus && (
          <div className="space-y-6 min-w-0">
            {sources.auteurs.length > 0 && (
              <Bloc titre={t('sourcesAuteurs')}>
                <ListeCoupee titre={t('sourcesAuteurs')} elements={sources.auteurs} visibles={ELUS_VISIBLES} rendu={(e) => <LigneElu key={e.uid} elu={e} />} />
              </Bloc>
            )}
            {sources.rapporteurs.length > 0 && (
              <Bloc titre={t('sourcesRapporteurs')}>
                <ListeCoupee titre={t('sourcesRapporteurs')} elements={sources.rapporteurs} visibles={ELUS_VISIBLES} rendu={(e) => <LigneElu key={e.uid} elu={e} />} />
              </Bloc>
            )}
            {sources.cosignataires.length > 0 && <Cosignataires elus={sources.cosignataires} />}
          </div>
        )}
      </div>
    </SectionRepliable>
  );
});

/** Intertitre d'un bloc : petit et gris, la hiérarchie passe par la taille du texte. */
export function Bloc({ titre, id, children }: { titre: string; id?: string; children: ReactNode }) {
  return (
    // Même marge que `.fiche-section` : un saut d'ancre pose le bloc sous l'en-tête fixe.
    <div id={id} style={id ? { scrollMarginTop: 'var(--hauteur-entete)' } : undefined}>
      <h3 className="text-muted-foreground" style={{ fontSize: '0.75rem', fontWeight: 600, margin: '0 0 6px' }}>{titre}</h3>
      {children}
    </div>
  );
}

/** Affiche les `visibles` premiers éléments, puis « Voir les N », qui ouvre le
 *  panneau titré `titre` sur la liste entière : la carte ne s'allonge jamais.
 *  `visiblesMobile`, plus petit, s'applique sous 768 px : les éléments en plus et
 *  le bouton propre au mobile sont cachés en CSS, si bien que le rendu serveur est
 *  déjà le bon sur les deux largeurs.
 *
 *  Le panneau peut en dire plus que la carte : `renduPanneau` y remplace `rendu`
 *  (une ligne qui porte un chiffre que la carte tait), `entetePanneau` s'affiche
 *  au-dessus de la liste. Avec l'un des deux, le bouton reste même quand la liste
 *  tient dans la carte : c'est le seul chemin vers ce que le panneau ajoute.
 *
 *  Une liste chargée à la demande (`ElusActifsSection`) passe `total`, la taille de
 *  la liste entière quand `elements` n'en porte que le début, et `onOuvrir`, appelé à
 *  chaque ouverture du panneau pour lancer son chargement ; `etatPanneau` s'affiche
 *  alors au-dessus de la liste (chargement, échec). */
export function ListeCoupee<T>({ titre, elements, total = elements.length, visibles, visiblesMobile = visibles, rendu, renduPanneau, entetePanneau, onOuvrir, etatPanneau }: {
  titre: string;
  elements: T[];
  total?: number;
  visibles: number;
  visiblesMobile?: number;
  rendu: (e: T) => ReactNode;
  renduPanneau?: (e: T) => ReactNode;
  entetePanneau?: ReactNode;
  onOuvrir?: () => void;
  etatPanneau?: ReactNode;
}) {
  const t = useTranslations('resumeIA');
  const [ouvert, setOuvert] = useState(false);
  const panneauEnPlus = !!renduPanneau || !!entetePanneau;
  const coupeBureau = total > visibles || panneauEnPlus;
  return (
    <>
      <ul>{elements.slice(0, visiblesMobile).map(rendu)}</ul>
      {visibles > visiblesMobile && total > visiblesMobile && (
        // `max-md:hidden` et non `hidden md:block` : `hidden` y écrase l'affichage
        // responsive (ARCHITECTURE.md §Pièges Tailwind v4 sur Safari).
        <ul className="max-md:hidden">{elements.slice(visiblesMobile, visibles).map(rendu)}</ul>
      )}
      {(total > visiblesMobile || panneauEnPlus) && (
        <>
          <span className={coupeBureau ? undefined : 'md:hidden'}>
            <BoutonVoirTout onClick={() => { setOuvert(true); onOuvrir?.(); }}>{t('sourcesVoirTout', { count: total })}</BoutonVoirTout>
          </span>
          <Panneau titre={titre} ouvert={ouvert} onOpenChange={setOuvert}>
            {entetePanneau}
            {etatPanneau}
            <ul>{elements.map(renduPanneau ?? rendu)}</ul>
          </Panneau>
        </>
      )}
    </>
  );
}

/** Lien sortant. L'icône suit le texte en ligne : sur un libellé qui passe à la
 *  ligne (fréquent à 390 px), elle reste collée au dernier mot au lieu de partir
 *  au bord droit de la carte. */
export function LienExterne({ href, children }: { href: string; children: ReactNode }) {
  return (
    <div style={{ padding: '4px 0', lineHeight: 1.45 }}>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="group text-sm text-foreground hover:text-primary"
        style={{ textDecoration: 'none' }}
      >
        {children}
        <ExternalLink
          className="inline h-3 w-3 opacity-35 group-hover:opacity-70"
          style={{ marginLeft: '6px', verticalAlign: '-1px' }}
          aria-hidden
        />
      </a>
    </div>
  );
}

// Libellés de l'annuaire des élus, déjà traduits : un même rôle se nomme pareil partout.
const BADGE_CLE = { depute: 'roleDepute', senateur: 'roleSenateur', gouvernement: 'roleGouvernement' } as const;

/** Badge du rôle d'un élu dans le texte, pour `LigneElu` et les auteurs d'amendements
 *  (`ModificationsSection`). Un ancien élu, à la photo grisée, le lit au passé avec le
 *  libellé de sa fiche (`ancienMandat`), accordé à sa civilité : « Ancienne députée »,
 *  « Ancien membre du Gouvernement ». Le rôle reste celui du texte : un député devenu
 *  sénateur n'est pas un ancien élu et garde « Député ». */
export function BadgeRole({ role, elu }: { role: BadgeElu; elu: { ancien: boolean; civ: string | null } | null }) {
  const tElus = useTranslations('elus');
  return (
    <Badge>
      {elu?.ancien
        ? tElus('ancienMandat', { role, genre: elu.civ?.trim() === 'Mme' ? 'F' : 'M' })
        : tElus(BADGE_CLE[role])}
    </Badge>
  );
}

/** Badge de rôle : un petit texte encadré sans fond, qui ne se tronque jamais.
 *  `accent` le passe à la couleur du site, contour compris, toujours sans fond :
 *  c'est ce qui distingue « Rapporteur », posé à côté du rôle de l'élu. */
export function Badge({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      style={{
        flexShrink: 0,
        fontSize: '10.5px',
        fontWeight: 500,
        lineHeight: 1.4,
        padding: '0 5px',
        borderRadius: '4px',
        border: accent ? '1px solid var(--primary)' : '1px solid var(--border)',
        color: accent ? 'var(--primary)' : 'var(--muted-foreground)',
      }}
    >
      {children}
    </span>
  );
}

/** Ligne d'élu : même motif que les suggestions de `ElusSearchInput`. Le nom
 *  mène à la fiche, sans préchargement (D-095). Le badge, un petit texte encadré
 *  sans fond, suit le nom ; le nom seul se tronque sur un écran étroit.
 *  `rapporteur` ajoute le badge « Rapporteur » en couleur d'accent, et `nombre` la
 *  seule métrique de la ligne, alignée à droite comme dans `LigneAuteurAmendements`
 *  (les deux, pour la section « Les plus actifs dans ce dossier »).
 *  `decimales` fixe le nombre de chiffres après la virgule, toujours écrits pour que
 *  la colonne reste alignée (« 99,0 » sous « 99,8 »). */
export function LigneElu({ elu, rapporteur = false, nombre, decimales = 0 }: {
  elu: EluSource;
  rapporteur?: boolean;
  nombre?: number;
  decimales?: number;
}) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();
  return (
    <li>
      <Link
        href={`/les-elus/${elu.uid}`}
        prefetch={false}
        className="hover:bg-muted"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '0.375rem 0.5rem',
          margin: '0 -0.5rem',
          borderRadius: '0.5rem',
          color: 'var(--foreground)',
          textDecoration: 'none',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}
      >
        <PhotoEluVignette acteur={elu} taille={28} ancien={elu.ancien} />
        <span className="min-w-0" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {elu.prenom} {elu.nom}
            </span>
            {elu.badge && <BadgeRole role={elu.badge} elu={elu} />}
            {rapporteur && <Badge accent>{t('labelRapporteur', { count: 1 })}</Badge>}
          </span>
          {elu.groupe && (
            <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {elu.groupe}
            </span>
          )}
        </span>
        {nombre !== undefined && (
          <span className="text-muted-foreground" style={{ flexShrink: 0, fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' }}>
            {nombre.toLocaleString(locale, { minimumFractionDigits: decimales, maximumFractionDigits: decimales })}
          </span>
        )}
      </Link>
    </li>
  );
}

/** Lien « Voir les N » des listes coupées : il ouvre toujours un panneau, d'où
 *  `aria-haspopup`, comme la ligne des cosignataires. */
export function BoutonVoirTout({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className="text-xs font-medium text-primary hover:underline"
      style={{ marginTop: '4px', padding: '4px 0' }}
    >
      {children}
    </button>
  );
}

/** Panneau latéral des listes trop longues pour la carte, sur le modèle du volet
 *  des votes d'un scrutin (`ScrutinVotesSheet`) : à droite sur bureau, depuis le
 *  bas sur mobile, au même seuil de 767 px. Le retrait horizontal laisse déborder
 *  le survol des lignes d'élu, posées en marge négative. */
export function Panneau({ titre, ouvert, onOpenChange, children }: {
  titre: string;
  ouvert: boolean;
  onOpenChange: (ouvert: boolean) => void;
  children: ReactNode;
}) {
  const isMobile = useEcranMobile();

  return (
    <Sheet open={ouvert} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        size={isMobile ? 'content' : 'default'}
        className={isMobile ? 'max-h-[85vh] overflow-y-auto rounded-t-2xl' : 'overflow-y-auto'}
        style={isMobile ? { width: '100%' } : undefined}
      >
        <SheetHeader>
          <SheetTitle style={{ fontSize: '14px', lineHeight: 1.4, paddingRight: '24px' }}>
            {titre}
          </SheetTitle>
        </SheetHeader>
        <div style={{ padding: '0 0.5rem' }}>{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** Les cosignataires se comptent par dizaines (32 en médiane) : dans la carte,
 *  une seule ligne qui donne leur nombre ; dans le panneau, une ligne d'élu
 *  chacun, comme les auteurs. Le panneau défile seul, si bien que ses 336 lignes
 *  au plus n'allongent jamais la page. */
function Cosignataires({ elus }: { elus: EluSource[] }) {
  const t = useTranslations('resumeIA');
  const [ouvert, setOuvert] = useState(false);
  const titre = t('sourcesCosignataires', { count: elus.length });
  return (
    <div>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
        style={{ fontSize: '0.75rem', fontWeight: 600, padding: '4px 0' }}
      >
        {titre}
        <ChevronRight size={14} strokeWidth={1.5} aria-hidden />
      </button>
      <Panneau titre={titre} ouvert={ouvert} onOpenChange={setOuvert}>
        <ul>{elus.map((e) => <LigneElu key={e.uid} elu={e} />)}</ul>
      </Panneau>
    </div>
  );
}
