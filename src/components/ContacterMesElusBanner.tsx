'use client';

// Bloc « Écrire à mes élus sur ce texte » du pied du bandeau de la fiche dossier
// (`page.tsx` de `resume-ia`). Lit les élus gardés dans le navigateur (`useMesElus`) et
// les scrutins du dossier : une photo par élu avec sa position au dernier vote, la phrase
// complète et le contact dans une bulle, puis un courriel à tous ceux qui en publient un.
// Sans élu enregistré, il propose de les retrouver (`TrouverMonDeputeModal`).
// À côté, un second groupe montre ce que le serveur pose à droite (`droite`, voir
// `versPersonneContact` de la page) : le Gouvernement (ou le Président), l'auteur du texte ou ses
// rapporteurs, avec la même photo et la même bulle. Un auteur qui est aussi un des élus
// du lecteur apparaît des deux côtés : chaque groupe dit un rôle différent.

import { Fragment, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Info, Landmark, Mail, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useMesElus, type EluRef, type PeriodeMandat } from '@/hooks/useMesElus';
import { useCompleterSenateurs } from '@/hooks/useCompleterSenateurs';
import { appellation, buildMailto, genre, type Locale } from '@/lib/mailto';
import { FORMULAIRE_PREMIER_MINISTRE, FORMULAIRE_PRESIDENT, courrielMesElus, elusEnregistres, getSocials, type SocialLink } from '@/lib/contact-elus';
import { ACTIVE_BASE, ACTIVE_HOVER, BASE_PILL_STYLE } from '@/lib/pastille-or';
import { openTrouverMonDeputeModal } from '@/components/TrouverMonDeputeModal';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { photoElu } from '@/lib/photo-elu';
import { STYLE_ANCIEN } from '@/lib/ancien-elu';
import { estMotionRejet, voteLePlusRecent } from '@/lib/scrutin-affichage';

type ScrutinEluVote = {
  uid: string;
  date_scrutin: string | null;
  sort_code: string | null;
  chambre: string | null;
  // `MOC` pour une motion de censure : la Constitution n'y fait recenser que les votes
  // favorables, donc « pas dans la liste » n'y veut pas dire « absent ».
  type_vote_code?: string | null;
  // Intitulé du scrutin : seul indice d'une motion de rejet (`estMotionRejet`).
  titre?: string | null;
  votes_nominatifs: Record<string, string[]> | null;
  // Clé de traduction de la lecture (« 1ʳᵉ lecture », « CMP »…), calculée côté serveur
  // depuis le code de l'acte qui porte le scrutin. `null` si l'acte n'est pas une étape
  // de lecture connue.
  lectureKey?: string | null;
};

/** L'auteur ou un rapporteur du texte, avec sa chambre d'aujourd'hui (null hors mandat)
 *  et la façon de lui écrire : `mandat` par courriel ou réseau, `ministre` par le
 *  formulaire du Premier ministre, `ancien` et `sansContact` pas du tout. */
export type PersonneContact = EluRef & {
  chambre: 'AN' | 'SN' | null;
  statut: 'mandat' | 'ministre' | 'ancien' | 'sansContact';
};

/** Ce que la bande pose à droite des élus du lecteur, ou rien. Des rapporteurs, la
 *  bande ne montre que ceux que le hero nomme ; `total` les compte tous, fiche
 *  introuvable comprise, pour accorder le titre et dire combien d'autres. `president` :
 *  un texte du Gouvernement dont l'auteur affiché est le Président de la République. */
export type DroiteBandeau =
  | { kind: 'gouvernement' }
  | { kind: 'president' }
  | { kind: 'auteur'; personnes: PersonneContact[] }
  | { kind: 'rapporteurs'; personnes: PersonneContact[]; total: number }
  | null;

type Props = {
  dossier: {
    uid: string;
    titre: string | null;
    statut: string | null;
  };
  scrutins?: ScrutinEluVote[];
  droite?: DroiteBandeau;
  /** Sur la page d'un vote seulement : la chambre qui a voté. Un élu de l'autre chambre
   *  n'y a pas de vote, et sa bulle le dit au lieu de rester muette. Absent sur la fiche
   *  du texte, qui montre le dernier vote de chaque élu dans sa chambre. */
  chambreDuVote?: 'AN' | 'SN';
  /** Sur la page d'un amendement : la personne de droite en est l'auteur, pas celui du
   *  texte. Remplace le titre du groupe de droite, déjà traduit par la page. */
  titresDroite?: { joignable: string; sansContact: string };
};

/** De quel vote la phrase parle. Un dossier compte souvent plusieurs scrutins : sans ce
 *  contexte, « a voté POUR » ne dit pas sur quelle lecture, et un député et un sénateur
 *  affichés côte à côte semblent parler du même vote alors qu'ils parlent de deux. */
type VoteContexte = { lectureKey: string | null; date: string | null };

/** `estMotion` : motion de censure, qui ne recense que les votes favorables.
 *  `estRejet` : motion de rejet, sur laquelle voter « pour » revient à voter contre le texte. */
type EluVoteStatus =
  | { kind: 'position'; position: string; contexte: VoteContexte; estMotion: boolean; estRejet: boolean }
  | { kind: 'pasEnFonction'; contexte: VoteContexte; estMotion: boolean; estRejet: boolean }
  | { kind: 'nonDisponible'; contexte: VoteContexte; estMotion: boolean; estRejet: boolean };

// La colonne `chambre` des scrutins est parfois vide (trou de données côté import) —
// on retombe sur le préfixe de l'uid (VTANR = Assemblée, VTSNR = Sénat), fiable dans tous les cas.
function resolveChambre(s: ScrutinEluVote): 'Assemblée Nationale' | 'Sénat' | null {
  if (s.chambre === 'Assemblée Nationale' || s.chambre === 'Sénat') return s.chambre;
  if (s.uid.startsWith('VTAN')) return 'Assemblée Nationale';
  if (s.uid.startsWith('VTSN')) return 'Sénat';
  return null;
}

// L'élu siégeait-il dans sa chambre le jour du vote ? Les périodes en décident : la date
// de début ne part que du dernier retour d'un élu dont le mandat a été interrompu, et
// un vote manqué avant sa sortie se lirait sinon « pas en fonction ». Sans périodes
// (élu enregistré dans le navigateur avant leur ajout), repli sur la date. Dates ISO
// coupées au jour, donc comparables comme des chaînes, fin de période comprise.
function siegeaitLe(
  jour: string,
  dateDebutMandat: string | null | undefined,
  periodes: PeriodeMandat[] | null | undefined,
): boolean {
  if (periodes?.length) {
    return periodes.some((p) => (!p.debut || p.debut.slice(0, 10) <= jour) && (!p.fin || jour <= p.fin.slice(0, 10)));
  }
  return !dateDebutMandat || jour >= dateDebutMandat.slice(0, 10);
}

// Statut de vote de l'élu sur le scrutin final le plus récent de sa chambre pour ce dossier.
// null = aucun scrutin final trouvé pour cette chambre → on n'affiche rien (pas de régression).
// Ce dernier scrutin est parfois une motion de rejet : adoptée, elle clôt la lecture et
// le texte n'est jamais voté ; rejetée, elle reste le dernier vote tant que l'ensemble
// ne l'est pas. La position de l'élu est alors celle qu'il a prise sur la motion, et
// `estRejet` le signale pour que la photo et la phrase la retournent.
function computeVoteStatus(
  eluUid: string,
  dateDebutMandat: string | null | undefined,
  periodes: PeriodeMandat[] | null | undefined,
  chambre: 'Assemblée Nationale' | 'Sénat',
  scrutins: ScrutinEluVote[],
): EluVoteStatus | null {
  const candidats = scrutins
    .filter((s) => resolveChambre(s) === chambre && s.sort_code)
    .sort((a, b) => (b.date_scrutin ?? '').localeCompare(a.date_scrutin ?? ''));
  // Les scrutins sont datés à minuit : deux votes du même jour sont ex æquo, et le tri
  // seul en rendait un au hasard (au 2026-11-03, six dossiers dont DLR5L17N50588, où le
  // Sénat vote V194 puis V195 le même jour). Le numéro départage, comme sur la fiche.
  const memeJour = candidats.filter((s) => s.date_scrutin === candidats[0]?.date_scrutin);
  const dernierUid = voteLePlusRecent(memeJour.map((s) => s.uid));
  const finalScrutin = memeJour.find((s) => s.uid === dernierUid);
  if (!finalScrutin) return null;

  const contexte: VoteContexte = {
    lectureKey: finalScrutin.lectureKey ?? null,
    date: finalScrutin.date_scrutin,
  };
  const estMotion = finalScrutin.type_vote_code === 'MOC';
  const estRejet = estMotionRejet(finalScrutin.titre);

  const vn = finalScrutin.votes_nominatifs;
  const position = vn
    ? (Object.entries(vn).find(([, uids]) => uids.includes(eluUid))?.[0] ?? null)
    : null;

  if (position) {
    return { kind: 'position', position, contexte, estMotion, estRejet };
  }

  if (finalScrutin.date_scrutin && !siegeaitLe(finalScrutin.date_scrutin.slice(0, 10), dateDebutMandat, periodes)) {
    return { kind: 'pasEnFonction', contexte, estMotion, estRejet };
  }

  return { kind: 'nonDisponible', contexte, estMotion, estRejet };
}

const POSITION_COLOR: Record<'pour' | 'contre', string> = {
  pour: 'var(--bandeau-pour)',
  contre: 'var(--bandeau-contre)',
};

// Positions sans verbe "voter" naturel (absent, non-votant, institutionnel) → phrase dédiée
// au lieu de "a voté ABSENT", qui n'a pas de sens en français.
const POSITION_SENTENCE_KEY: Record<string, string> = {
  abstentions: 'eluAbstentionSentence',
  absents: 'eluAbsentSentence',
  nonVotants: 'eluNonVotantSentence',
  institutionnels: 'eluInstitutionnelSentence',
};

type Translator = (key: string, values?: Record<string, string>) => string;

// « en 1ʳᵉ lecture, le 21 juillet 2026 ». Les deux moitiés sont indépendantes : la date est
// toujours renseignée sur un scrutin porteur de votes nominatifs, la lecture peut manquer
// si l'acte n'est pas une étape connue. Le repli générique couvre le cas où les deux
// tombent, pour que la phrase reste grammaticale.
function formatContexte(contexte: VoteContexte, locale: Locale, tBanner: Translator): string {
  const parts: string[] = [];
  if (contexte.lectureKey) {
    parts.push(tBanner('voteContextLecture', { lecture: tBanner(contexte.lectureKey) }));
  }
  if (contexte.date) {
    const date = new Date(contexte.date).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
    });
    parts.push(tBanner('voteContextDate', { date }));
  }
  return parts.length > 0 ? parts.join(', ') : tBanner('voteContextFallback');
}

// Phrase narrative "M. Ciotti, mon député, a voté POUR en 1ʳᵉ lecture, le 21 juillet 2026."
// rendue dans la bulle de la photo de l'élu (`PhotoEluBandeau`), au-dessus du bouton de
// contact. `nom` est l'appellation (`appellation`), pas le prénom.
// Sur une motion de rejet, la bulle dit le vote exact (« a voté POUR le rejet du texte »)
// pendant que le mot sous la photo dit la position sur le texte (voir `marqueVote`) : le
// mot en majuscules prend donc la couleur de l'effet sur le texte, rouge pour le rejet,
// vert contre, la même que l'anneau. Une abstention sur la motion le dit aussi
// (« s'est abstenu sur le rejet du texte ») : « a choisi l'abstention » laissait croire à
// une abstention sur le texte. `genreElu` accorde ce participe.
function buildVoteSentence(
  nom: string,
  role: string,
  genreElu: 'F' | 'M',
  status: EluVoteStatus,
  locale: Locale,
  tElus: Translator,
  tBanner: Translator,
): ReactNode {
  const contexte = formatContexte(status.contexte, locale, tBanner);
  // Sans lecture ni date, le contexte retombe sur « sur ce texte », redondant après
  // « le rejet du texte » : les phrases de motion de rejet l'omettent alors.
  const contexteRejet = status.contexte.lectureKey || status.contexte.date ? `, ${contexte}` : '';
  if (status.kind === 'pasEnFonction') {
    return tBanner('eluPasEnFonctionSentence', { nom, role, contexte });
  }
  if (status.kind === 'nonDisponible') {
    const key = status.estMotion ? 'eluMotionNonRecenseSentence' : 'eluVoteNonDisponibleSentence';
    return tBanner(key, { nom, role, contexte });
  }
  if (status.estRejet && status.position === 'abstentions') {
    return tBanner('eluAbstentionRejetSentence', { nom, role, genre: genreElu, contexte: contexteRejet });
  }
  if (status.position !== 'pour' && status.position !== 'contre') {
    // Sur une motion de censure, tout ce qui n'est pas un vote favorable arrive ici :
    // la Constitution ne fait recenser que les « pour ». Dire « aucun vote enregistré »
    // laisserait croire au silence des centaines de députés qui ont voté contre, d'où
    // la phrase dédiée qui explique la règle.
    const key = status.estMotion
      ? 'eluMotionNonRecenseSentence'
      : (POSITION_SENTENCE_KEY[status.position] ?? 'eluVoteNonDisponibleSentence');
    return tBanner(key, { nom, role, contexte });
  }
  const couleur = status.estRejet
    ? POSITION_COLOR[status.position === 'pour' ? 'contre' : 'pour']
    : POSITION_COLOR[status.position];
  return (
    <>
      {tBanner('eluVotedPrefix', { nom, role })}{' '}
      <strong style={{ textTransform: 'uppercase', color: couleur }}>
        {tElus(status.position === 'pour' ? 'votePositionPour' : 'votePositionContre')}
      </strong>{' '}
      {status.estRejet
        ? <>{tBanner('voteRejetTexte')}{contexteRejet}.</>
        : <>{contexte}.</>}
    </>
  );
}

// « Écrire à mes N élus » a le contour or de la pastille « Ce qui change pour vous »
// voisine : depuis que les élus sont des photos, il n'a plus de pastilles par élu dont
// se distinguer, et son ancien remplissage plein pesait plus que tout le bandeau.
type PillVariant = 'active' | 'dashed';

const DASHED_BASE: CSSProperties = {
  border: '1px dashed rgba(212,165,74,0.55)',
  background: 'transparent',
  color: 'var(--bandeau-or)',
};
const DASHED_HOVER: CSSProperties = {
  border: '1px dashed rgba(212,165,74,0.85)',
  background: 'rgba(212,165,74,0.10)',
  color: 'var(--bandeau-or-fort)',
};

/** Bouton pilule de la bande. Un `href` en fait un lien, ouvert dans un nouvel onglet
 *  quand il est `externe` (le formulaire du Premier ministre ou de l'Élysée ; un `mailto:` reste sur place). */
function Pill({
  variant,
  href,
  externe,
  onClick,
  ariaLabel,
  children,
}: {
  variant: PillVariant;
  href?: string;
  externe?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);

  const themed =
    variant === 'dashed'
      ? (hovered ? DASHED_HOVER : DASHED_BASE)
      : (hovered ? ACTIVE_HOVER : ACTIVE_BASE);
  const style: CSSProperties = { ...BASE_PILL_STYLE, ...themed, cursor: 'pointer' };

  const handlers = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  };

  if (href) {
    return (
      <a
        href={href}
        aria-label={ariaLabel}
        style={style}
        {...(externe ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        {...handlers}
      >
        {children}
      </a>
    );
  }
  return (
    <button type="button" aria-label={ariaLabel} onClick={onClick} style={style} {...handlers}>
      {children}
    </button>
  );
}

function SocialPill({ label, socials }: { label: ReactNode; socials: SocialLink[] }) {
  const [hovered, setHovered] = useState(false);
  const themed = hovered ? ACTIVE_HOVER : ACTIVE_BASE;
  const style: CSSProperties = { ...BASE_PILL_STYLE, ...themed, cursor: 'default' };

  return (
    <span
      style={style}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginLeft: '6px', verticalAlign: '-3px' }}>
        {socials.map(({ href, Icon, label: aria }) => (
          <a
            key={aria}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={aria}
            title={aria}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              color: 'inherit',
              opacity: 0.85,
              transition: 'opacity 0.15s ease',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.85')}
          >
            <Icon size={13} />
          </a>
        ))}
      </span>
    </span>
  );
}

/** Lien discret « Modifier » ou « Oublier » à droite du titre d'un bloc du pied du
 *  bandeau, icône seule sous 640 px. Servi aussi à la section « Ce qui change pour
 *  vous » de la fiche dossier (`PourVousSection`). */
export function HintIconButton({
  onClick,
  ariaLabel,
  icon,
  label,
}: {
  onClick: () => void;
  ariaLabel: string;
  icon: ReactNode;
  label: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '11px',
        color: hovered ? 'var(--bandeau-texte)' : 'var(--bandeau-texte-pale)',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        transition: 'color 0.15s ease',
      }}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** Icône « i » posée après le titre de la bande, dont la bulle porte les mentions de
 *  confidentialité (`texte`). Appelée par les deux états de la bande, avec le même texte,
 *  et par la section « Ce qui change pour vous » de la fiche dossier (`PourVousSection`).
 *  Le tooltip Radix ignore le toucher : sur iPhone, un tap ne l'ouvrirait jamais. Il est donc
 *  piloté ici : le survol l'ouvre à la souris, un tap le bascule au doigt. Les `preventDefault`
 *  court-circuitent les gestionnaires internes de Radix (`composeEventHandlers` les saute), qui
 *  sinon refermeraient la bulle au même tap : appui, sortie du doigt et clic la ferment tous.
 *  `couleurs` sert hors du bandeau sombre (cartes Activité et « Ses votes » de la fiche élu) :
 *  sans elle, l'icône garde les couleurs du bandeau, pâles sur fond clair. */
export function InfoBulle({ ariaLabel, texte, couleurs = { repos: 'var(--bandeau-texte-pale)', actif: 'var(--bandeau-texte)' } }: {
  ariaLabel: string;
  texte: string;
  couleurs?: { repos: string; actif: string };
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Type du dernier appui sur l'icône, vidé au clic qui le suit. Sert aussi à reconnaître le
  // focus provoqué par cet appui, que Radix traiterait comme un focus clavier et ouvrirait.
  const pointerRef = useRef<string | null>(null);
  const [hovered, setHovered] = useState(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={ariaLabel}
          onPointerDown={(e) => {
            pointerRef.current = e.pointerType;
            e.preventDefault();
          }}
          onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
          onPointerLeave={(e) => {
            setHovered(false);
            if (e.pointerType === 'touch') e.preventDefault();
          }}
          onFocus={(e) => {
            if (pointerRef.current) e.preventDefault();
          }}
          onClick={(e) => {
            e.preventDefault();
            // À la souris, le survol a déjà ouvert la bulle : un clic ne doit pas la refermer.
            if (pointerRef.current === 'mouse') setOpen(true);
            else setOpen((o) => !o);
            pointerRef.current = null;
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            // Zone de tap élargie sans décaler le titre : le padding est repris par la marge.
            padding: '4px',
            margin: '-4px',
            color: hovered || open ? couleurs.actif : couleurs.repos,
            background: 'transparent',
            border: 'none',
            cursor: 'help',
            transition: 'color 0.15s ease',
          }}
        >
          <Info size={12} />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        // Le tap sur l'icône est « hors de la bulle » pour Radix, qui la fermerait avant que
        // le clic ne la bascule, et elle se rouvrirait aussitôt.
        onPointerDownOutside={(e) => {
          if (triggerRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        {texte}
      </TooltipContent>
    </Tooltip>
  );
}

/** Une photo du bandeau, préparée par `versEluPhoto` (ou, pour le Gouvernement, par le
 *  composant) : sa phrase de vote (ou son nom et son rôle, sans scrutin), et de quoi
 *  écrire. Ce que demande `PhotoEluBandeau`. */
type EluPhoto = {
  key: string;
  /** Null pour le Gouvernement et le Président, montrés par une icône à la place d'un portrait. */
  elu: EluRef | null;
  /** Sa chambre : le trait de la bande se pose là où elle change d'une photo à l'autre.
   *  Null hors mandat. */
  chambre: 'AN' | 'SN' | null;
  nom: string;
  voteStatus: EluVoteStatus | null;
  phrase: ReactNode;
  mailHref: string | null;
  socials: SocialLink[];
  /** Un formulaire officiel et le libellé de son bouton : celui du Premier ministre pour
   *  le Gouvernement et un auteur devenu ministre, celui de l'Élysée pour le Président. */
  formulaire: { href: string; libelle: string } | null;
  /** Portrait grisé, sans anneau ni action : ancien élu, ou élu qui ne publie aucun contact. */
  estompe: boolean;
};

/** Un des élus du lecteur, toujours en mandat, qui peut aussi porter l'action
 *  principale de la rangée. */
type EluBandeau = EluPhoto & {
  elu: EluRef;
  chambre: 'AN' | 'SN';
  /** « Écrire à mon sénateur, M. X » : l'action principale quand il est le seul joignable. */
  libelleEcrire: string;
};

/** Prépare la photo d'un élu, pour les élus du lecteur comme pour l'auteur et les
 *  rapporteurs du texte. `role` est le rôle dans la phrase (« mon député », « auteur du
 *  texte ») ; `statut` dit comment le joindre (voir `PersonneContact`) ; `roleMail`
 *  adapte le courriel à celui qui a déposé le texte ou qui le rapporte. Ministre, ancien
 *  élu et élu sans contact n'ont pas de vote affiché : ils ne votent plus dans une
 *  chambre, ou le lecteur ne peut rien en faire. */
function versEluPhoto(
  elu: EluRef,
  chambre: 'AN' | 'SN' | null,
  role: string,
  ctx: {
    locale: Locale;
    dossier: Props['dossier'];
    scrutins: ScrutinEluVote[];
    chambreDuVote?: 'AN' | 'SN';
    tElus: Translator;
    tBanner: Translator;
  },
  statut: PersonneContact['statut'] = 'mandat',
  roleMail?: 'auteur' | 'rapporteur',
): EluPhoto {
  const nom = appellation(elu, ctx.locale);
  const base = {
    key: `${chambre ?? 'hors'}-${elu.uid}`,
    elu,
    chambre,
    nom,
    voteStatus: null,
    mailHref: null,
    socials: [],
    formulaire: null,
    estompe: false,
  };
  if (statut === 'ministre') {
    return {
      ...base,
      phrase: ctx.tBanner('phraseMinistre', { nom, role }),
      formulaire: { href: FORMULAIRE_PREMIER_MINISTRE, libelle: ctx.tBanner('ecrirePremierMinistre') },
    };
  }
  if (statut !== 'mandat' || !chambre) {
    return { ...base, phrase: ctx.tBanner(statut === 'sansContact' ? 'phraseSansContact' : 'phraseAncien', { nom, role }), estompe: true };
  }
  const voteStatus = computeVoteStatus(elu.uid, elu.date_debut_mandat, elu.periodes_mandat_assemblee, chambre ==='AN' ? 'Assemblée Nationale' : 'Sénat', ctx.scrutins);
  const autreChambre = !!ctx.chambreDuVote && ctx.chambreDuVote !== chambre;
  return {
    ...base,
    voteStatus,
    phrase: voteStatus ? buildVoteSentence(nom, role, genre(elu.civ) ?? 'M', voteStatus, ctx.locale, ctx.tElus, ctx.tBanner)
      : autreChambre ? ctx.tBanner('eluAutreChambreSentence', { nom, role, chambre: ctx.chambreDuVote === 'SN' ? 'sen' : 'an' })
      : `${nom}, ${role}`,
    mailHref: elu.email ? buildMailto({ ...elu, chambre }, { locale: ctx.locale, dossier: ctx.dossier, role: roleMail }) : null,
    socials: elu.email ? [] : getSocials(elu),
  };
}

/** La position de l'élu au dernier vote, sous sa photo : un mot court en couleur et un
 *  anneau de la même couleur autour du portrait. Vert « Pour », rouge « Contre », gris
 *  « Abst. », et « Sans vote » en gris pâle pour tout le reste (pas de vote enregistré,
 *  pas en fonction, motion non recensée), dont la nuance est dans la phrase de la bulle. Un mot et non une
 *  icône : une coche ou une croix sur une photo se lisaient comme « élu validé » ou
 *  « élu refusé ». Rien sans scrutin.
 *  Sur une motion de rejet, le mot dit la position sur le texte, pas sur la motion :
 *  adoptée, elle clôt la lecture et le texte n'est jamais voté, donc voter pour la motion
 *  donne « Contre », voter contre donne « Pour ». La bulle garde le vote exact. */
function marqueVote(s: EluVoteStatus | null): { couleur: string; cle: 'voteCourtPour' | 'voteCourtContre' | 'voteCourtAbstention' | 'voteCourtSans' } | null {
  if (!s) return null;
  if (s.kind === 'position' && s.estRejet && (s.position === 'pour' || s.position === 'contre')) {
    return s.position === 'pour'
      ? { couleur: 'var(--bandeau-contre)', cle: 'voteCourtContre' }
      : { couleur: 'var(--bandeau-pour)', cle: 'voteCourtPour' };
  }
  if (s.kind === 'position' && s.position === 'pour') return { couleur: 'var(--bandeau-pour)', cle: 'voteCourtPour' };
  // Une motion ne recense que les votes favorables : ce qui n'y est pas « Pour » n'est
  // ni un « Contre » ni une abstention (voir `buildVoteSentence`), d'où « Sans vote ».
  if (s.kind === 'position' && !s.estMotion && s.position === 'contre') return { couleur: 'var(--bandeau-contre)', cle: 'voteCourtContre' };
  if (s.kind === 'position' && !s.estMotion && s.position === 'abstentions') return { couleur: 'var(--bandeau-texte-doux)', cle: 'voteCourtAbstention' };
  return { couleur: 'var(--bandeau-texte-pale)', cle: 'voteCourtSans' };
}

const TAILLE_PHOTO = 36;

/** Photo ronde d'un élu, sa position au dernier vote dessous, et au toucher une bulle
 *  avec la phrase complète, le moyen de le contacter et le lien vers sa fiche. La photo vient du site de
 *  l'Assemblée ou du Sénat, jamais copiée chez nous (voir `photo-elu.ts`) ; à défaut, ou
 *  si elle ne charge pas, les initiales. Une bulle et non un survol : le toucher n'en a
 *  pas. Le survol, sur ordinateur, soulève la photo et renforce son anneau (état React,
 *  pas `hover:` : voir ARCHITECTURE.md §Pièges Tailwind v4). Sans `elu` (le
 *  Gouvernement, le Président), une icône de bâtiment tient la place du portrait ; `estompe` grise le
 *  portrait et retire l'anneau. */
function PhotoEluBandeau({ e, libelleContacter }: { e: EluPhoto; libelleContacter: string }) {
  const t = useTranslations('elus.banner');
  const [echec, setEchec] = useState(false);
  const [survole, setSurvole] = useState(false);
  const photo = echec || !e.elu ? null : photoElu({ uid: e.elu.uid, url_profil_officiel: e.elu.url_profil_officiel ?? null });
  const marque = marqueVote(e.voteStatus);
  const anneau = marque ? marque.couleur : 'var(--bandeau-filet)';
  const rond: CSSProperties = {
    width: TAILLE_PHOTO, height: TAILLE_PHOTO, borderRadius: '50%', display: 'block',
    boxShadow: e.estompe ? 'none' : `0 0 0 2px var(--bandeau), 0 0 0 ${survole ? 4 : 3.5}px ${survole && !marque ? 'var(--bandeau-trait-fort)' : anneau}`,
    ...(e.estompe ? STYLE_ANCIEN : {}),
    transform: survole ? 'translateY(-2px)' : 'none',
    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
  };
  return (
    <Popover>
      <PopoverTrigger
        aria-label={marque ? `${e.nom} · ${t(marque.cle)}` : e.nom}
        title={e.nom}
        onMouseEnter={() => setSurvole(true)}
        onMouseLeave={() => setSurvole(false)}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
          padding: '4px 2px 0', border: 0, background: 'none', cursor: 'pointer', flex: 'none', minWidth: TAILLE_PHOTO + 8,
        }}
      >
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- portrait servi par l'Assemblée ou le Sénat, jamais par l'optimiseur (voir photo-elu.ts)
          <img
            src={photo.url}
            alt=""
            width={TAILLE_PHOTO}
            height={TAILLE_PHOTO}
            onError={() => setEchec(true)}
            // Le groupe de droite est rendu par le serveur : une photo en 404 (ancien
            // député, l'Assemblée ne garde que la législature en cours) peut échouer
            // avant que React ne prenne la main, et `onError` ne part alors jamais.
            // L'image déjà finie sans pixel est le même échec, constaté au montage.
            ref={(img) => { if (img?.complete && img.naturalWidth === 0) setEchec(true); }}
            style={{ ...rond, objectFit: 'cover', backgroundColor: 'var(--bandeau-voile)' }}
          />
        ) : (
          <span
            aria-hidden
            style={{
              ...rond, display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'var(--bandeau-voile-fort)', color: 'var(--bandeau-texte)', fontSize: '12px', fontWeight: 600,
            }}
          >
            {e.elu ? [e.elu.prenom, e.elu.nom].map((p) => p?.[0] ?? '').join('') : <Landmark size={16} />}
          </span>
        )}
        {/* La ligne existe aussi sans scrutin (espace insécable) : les photos restent
            alignées quand le député a voté et pas les sénateurs, ou l'inverse. */}
        <span
          aria-hidden
          style={{
            fontSize: '10px', lineHeight: 1.2, fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap',
            color: marque?.couleur ?? 'transparent',
          }}
        >
          {marque ? t(marque.cle) : '\u00a0'}
        </span>
      </PopoverTrigger>
      <PopoverContent collisionPadding={16} style={{ maxWidth: 300, padding: '0.75rem 0.875rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        <p style={{ fontSize: '13px', lineHeight: 1.5, margin: 0 }}>{e.phrase}</p>
        {e.mailHref ? (
          <span style={{ display: 'flex' }}>
            <Pill variant="active" href={e.mailHref}>
              <Mail size={12} />
              <span>{libelleContacter}</span>
              <span style={{ opacity: 0.6 }}>→</span>
            </Pill>
          </span>
        ) : e.socials.length > 0 ? (
          <span style={{ display: 'flex' }}>
            <SocialPill label={libelleContacter} socials={e.socials} />
          </span>
        ) : e.formulaire ? (
          <span style={{ display: 'flex' }}>
            <Pill variant="active" href={e.formulaire.href} externe>
              <span>{e.formulaire.libelle}</span>
              <span style={{ opacity: 0.6 }}>↗</span>
            </Pill>
          </span>
        ) : null}
        {/* La fiche LoiClair de la personne, discrète sous l'action : elle existe aussi
            pour un ancien élu. Le Gouvernement et le Président n'en ont pas. */}
        {e.elu && (
          <Link href={`/les-elus/${e.elu.uid}`} prefetch={false} className="text-xs text-muted-foreground underline underline-offset-2" style={{ alignSelf: 'flex-start' }}>
            {t('voirFiche')}
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Titre d'un groupe de la bande (« Écrire à mes élus… », « Écrire à l'auteur… »). */
const TITRE_GROUPE: CSSProperties = { fontSize: '13px', fontWeight: 500, color: 'var(--bandeau-texte)' };

/** Pose le groupe de droite (Gouvernement, auteur ou rapporteurs) à côté de celui des
 *  élus du lecteur, séparé par un trait fin. Sous 640 px, il passe dessous et le trait
 *  disparaît : la rangée des élus prend déjà toute la largeur d'un téléphone. Sans
 *  photo à droite, le groupe des élus seul. `autres` : les rapporteurs que la bande ne
 *  montre pas, dits après les photos avec les mots du hero (« et 11 autres »). */
function AvecDroite({ mesElus, photos, titre, autres = 0 }: { mesElus: ReactNode; photos: EluPhoto[]; titre: string; autres?: number }) {
  const t = useTranslations('elus.banner');
  const tResume = useTranslations('resumeIA');
  if (photos.length === 0) return <>{mesElus}</>;
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>{mesElus}</div>
      <span aria-hidden className="max-sm:hidden" style={{ width: 1, flex: 'none', alignSelf: 'stretch', backgroundColor: 'var(--bandeau-filet)' }} />
      <div style={{ flex: 'none' }}>
        <div className="flex items-center gap-2 mb-2">
          <span style={TITRE_GROUPE}>{titre}</span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {photos.map((p) => <PhotoEluBandeau key={p.key} e={p} libelleContacter={t('contactCta')} />)}
          {autres > 0 && (
            // Centré sur la hauteur des photos (4 px de marge haute, comme leur bouton),
            // pas sur celle de leur mot de vote.
            <span style={{ height: TAILLE_PHOTO, marginTop: 4, display: 'flex', alignItems: 'center', fontSize: '12px', whiteSpace: 'nowrap', color: 'var(--bandeau-texte-doux)' }}>
              {tResume('rapporteursAutres', { count: autres })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ContacterMesElusBanner({ dossier, scrutins = [], droite = null, chambreDuVote, titresDroite }: Props) {
  const t = useTranslations('elus.banner');
  const tElus = useTranslations('elus');
  const locale = (useLocale() === 'en' ? 'en' : 'fr') as Locale;
  const { data, clear } = useMesElus();

  // Photos des sénateurs enregistrés avant que la liste ne serve leur fiche officielle.
  useCompleterSenateurs();

  const hasDepute = !!data?.depute;
  const hasSenateurs = (data?.senateurs.length ?? 0) > 0;

  const ctx = { locale, dossier, scrutins, chambreDuVote, tElus, tBanner: t };

  // Le groupe de droite. Son titre invite à écrire tant qu'une des personnes est
  // joignable (courriel, réseau ou formulaire), et ne fait que la nommer sinon.
  // Gouvernement et Président sont l'auteur du texte : même titre qu'un député auteur.
  const photosDroite: EluPhoto[] = !droite ? []
    : droite.kind === 'gouvernement'
      ? [{
          key: 'gouvernement', elu: null, chambre: null, nom: t('gouvernementNom'), voteStatus: null,
          phrase: t('phraseGouvernement'), mailHref: null, socials: [], estompe: false,
          formulaire: { href: FORMULAIRE_PREMIER_MINISTRE, libelle: t('ecrirePremierMinistre') },
        }]
    : droite.kind === 'president'
      ? [{
          key: 'president', elu: null, chambre: null, nom: t('presidentNom'), voteStatus: null,
          phrase: t('phrasePresident'), mailHref: null, socials: [], estompe: false,
          formulaire: { href: FORMULAIRE_PRESIDENT, libelle: t('ecrirePresident') },
        }]
      : droite.personnes.map((p) => versEluPhoto(
          p,
          p.chambre,
          droite.kind === 'auteur' ? t('roleAuteur') : t('roleRapporteur', { genre: genre(p.civ) ?? 'M' }),
          ctx,
          p.statut,
          droite.kind === 'auteur' ? 'auteur' : 'rapporteur',
        ));
  const droiteJoignable = photosDroite.some((p) => !p.estompe);
  const titreDroite = !droite ? ''
    : titresDroite ? (droiteJoignable ? titresDroite.joignable : titresDroite.sansContact)
    : droite.kind === 'gouvernement' || droite.kind === 'president' ? t('auteurTitle')
    : droite.kind === 'auteur' ? t(droiteJoignable ? 'auteurTitle' : 'auteurSansContactTitle')
    : t(droiteJoignable ? 'rapporteursTitle' : 'rapporteursSansContactTitle', {
        count: droite.total,
        genre: (droite.total === 1 && genre(droite.personnes[0].civ)) || 'M',
      });
  const autresDroite = droite?.kind === 'rapporteurs' ? droite.total - photosDroite.length : 0;

  // ─── Empty state ───────────────────────────────────────────────────────────
  if (!data || (!hasDepute && !hasSenateurs)) {
    return (
      <AvecDroite photos={photosDroite} titre={titreDroite} autres={autresDroite} mesElus={
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span style={TITRE_GROUPE}>
            {t('emptyTitle')}
          </span>
          <InfoBulle ariaLabel={t('infoAria')} texte={t('infoBulle')} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Pill variant="active" onClick={() => openTrouverMonDeputeModal()}>
            {t('emptyCta')}
            <span style={{ opacity: 0.6 }}>→</span>
          </Pill>
        </div>
      </div>
      } />
    );
  }

  // ─── Filled state ──────────────────────────────────────────────────────────
  // Une photo ronde par élu, sa position au dernier vote marquée d'une pastille de
  // couleur, et toute la phrase dans une bulle au toucher : six élus tiennent sur une
  // rangée, là où six phrases complètes prenaient la moitié d'un écran de téléphone.
  // Le député toujours en tête, puis les sénateurs dans l'ordre enregistré
  // (`elusEnregistres`), chambres groupées pour le trait qui les sépare.
  const enregistres = elusEnregistres(data);
  const elus: EluBandeau[] = enregistres.map(({ elu, chambre }) => {
    const photo = versEluPhoto(elu, chambre, t(chambre === 'AN' ? 'roleDepute' : 'roleSenateur'), ctx);
    return {
      ...photo,
      elu,
      chambre,
      libelleEcrire: t(chambre === 'AN' ? 'writeBtnDepute' : 'writeBtnSenateur', { nom: photo.nom, genre: genre(elu.civ) ?? 'M' }),
    };
  });

  // L'action principale à côté des photos : écrire à tous d'un coup, ou à l'unique élu
  // joignable par courriel. Avec un seul élu, elle évite d'avoir à ouvrir sa bulle.
  const tous = courrielMesElus(enregistres, { locale, dossier });
  // L'élu du bandeau qui est le seul joignable, dont le bouton porte le nom.
  const seul = tous.seul && elus.find((e) => e.elu.uid === tous.seul?.elu.uid && e.chambre === tous.seul?.chambre);

  return (
    <AvecDroite photos={photosDroite} titre={titreDroite} autres={autresDroite} mesElus={
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span style={TITRE_GROUPE}>
          {t('filledTitle')}
        </span>
        <InfoBulle ariaLabel={t('infoAria')} texte={t('infoBulle')} />
        <div className="ml-auto flex items-center gap-3">
          <HintIconButton
            ariaLabel={t('changeLink')}
            onClick={() => openTrouverMonDeputeModal()}
            icon={<Pencil size={11} />}
            label={t('changeLink')}
          />
          <HintIconButton
            ariaLabel={t('forgetLink')}
            onClick={() => clear()}
            icon={<Trash2 size={11} />}
            label={t('forgetLink')}
          />
        </div>
      </div>

      {/* L'action suit la dernière photo et ne passe à la ligne que faute de place. Elle
          se centre sur la hauteur des photos, pas sur celle de leur mot de vote. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: '6px' }}>
        {elus.map((e, i) => (
          <Fragment key={e.key}>
            {/* Un trait fin sépare le député des sénateurs, sans titre ni pastille sur la
                photo : l'anneau et le mot disent déjà le vote, une marque de chambre de
                plus chargerait le portrait. Il se pose au changement de chambre, donc
                n'existe que si les deux chambres sont là. */}
            {i > 0 && e.chambre !== elus[i - 1].chambre && (
              <span
                aria-hidden
                style={{ width: 1, height: TAILLE_PHOTO, marginTop: 4, marginInline: 3, flex: 'none', backgroundColor: 'var(--bandeau-filet)' }}
              />
            )}
            <PhotoEluBandeau e={e} libelleContacter={t('contactCta')} />
          </Fragment>
        ))}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', minHeight: TAILLE_PHOTO + 8, marginLeft: '6px' }}>
        {tous.href && !seul ? (
          <Pill variant="active" href={tous.href}>
            <Users size={12} />
            {/* Le bouton n'écrit qu'aux élus qui publient un courriel : quand d'autres
                n'en ont pas (joignables par leurs réseaux, dans leur bulle), le libellé
                le dit, sinon « 9 » sous 13 photos ne s'expliquait pas. */}
            <span>
              {tous.joignables < elus.length
                ? t('writeSomeBtn', { count: tous.joignables, total: elus.length })
                : t('writeAllBtn', { count: tous.joignables })}
            </span>
            <span style={{ opacity: 0.6 }}>→</span>
          </Pill>
        ) : tous.href && seul ? (
          <Pill variant="active" href={tous.href}>
            <Mail size={12} />
            <span>{seul.libelleEcrire}</span>
            <span style={{ opacity: 0.6 }}>→</span>
          </Pill>
        ) : null}
        {/* La chambre manquante, en pointillés. */}
        {!hasDepute && hasSenateurs && (
          <Pill variant="dashed" onClick={() => openTrouverMonDeputeModal()}>
            <Plus size={12} />
            <span>{t('addDeputeLink')}</span>
          </Pill>
        )}
        {hasDepute && !hasSenateurs && (
          <Pill variant="dashed" onClick={() => openTrouverMonDeputeModal()}>
            <Plus size={12} />
            <span>{t('addSenateursLink')}</span>
          </Pill>
        )}
      </div>
      </div>
    </div>
    } />
  );
}
