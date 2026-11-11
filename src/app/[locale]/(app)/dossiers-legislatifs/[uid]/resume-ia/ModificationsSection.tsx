'use client';

// Section « Modifications du texte » de la fiche dossier, rendue après le parcours par
// ResumeIAClient, sur toute fiche : sans amendement déposé, une phrase le dit.
// Sinon, deux blocs dans une même carte, côte à côte sur ordinateur :
//
// - la répartition des amendements par auteur, une chambre après l'autre : une ligne
//   par groupe, dans l'ordre où il siège, puis le Gouvernement, la commission, les
//   amendements retirés avant la séance et ceux dont le groupe n'est pas connu. La
//   barre a la longueur des déposés, sa partie pleine celle des adoptés. Le groupe
//   est celui de l'auteur au jour du dépôt, que chaque chambre publie avec
//   l'amendement (`dossiers_legislatifs.amendements_par_groupe`, écrite par
//   `import_amendements.py`). Lignes déjà résolues et triées par page.tsx.
// - « Amendements adoptés par auteur », qui dit qui a modifié le texte : une ligne par auteur
//   (élu, Gouvernement, commission), regroupée par page.tsx, avec son nombre
//   d'amendements adoptés. La ligne déplie la liste de ses amendements : chacun est un
//   vrai lien vers sa page (`/Amendements/[uid]`), dont le clic simple ouvre le tiroir
//   (`AmendementSheet`), pour garder le lecteur dans la fiche. La carte s'arrête à dix auteurs et dix amendements par
//   auteur, et page.tsx n'envoie que cela ; le reste vit dans un panneau latéral, qui
//   charge la liste entière à sa première ouverture (`/api/dossiers/[uid]/amendements`) :
//   la loi de finances en compte plus de 3 000. Le groupe affiché
//   sous un élu est son groupe d'aujourd'hui, qui peut différer de celui du graphique
//   pour un élu qui en a changé depuis.

import { memo, useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { ChevronDown, Landmark, Users, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import Depliable from '@/components/ui/Depliable';
import SectionRepliable from '@/components/SectionRepliable';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import type { AuteurAmendement } from '@/lib/ce-qui-me-concerne';
import { ANCRE_AMENDEMENTS, CLE_PLI, IconeSection } from './SectionsDossier';
import { AMENDEMENTS_VISIBLES, AUTEURS_VISIBLES } from './amendements-carte';
import AmendementSheet from './AmendementSheet';
import { Badge, BadgeRole, Bloc, BoutonVoirTout, CARTE, Panneau } from './SourcesSection';

/** Un amendement adopté, tel que la ligne de lien l'affiche. `uid` sert de clé de
 *  liste : l'URL ne suffit pas, une seconde délibération de l'Assemblée (`…D2N…`)
 *  partageant celle de la première (40 URL en double au 2026-10-14). */
export interface AmendementAdopte {
  uid: string;
  numero: string;
  article: string | null;
  lieu: 'seance' | 'commission';
  chambre: 'AN' | 'SN';
  url: string;
  /** Vrai quand un vote public y est relié ; absent sinon, pour ne pas alourdir la fiche. */
  avecVote?: boolean;
}

/** Auteur d'amendements adoptés, avec ses amendements. `type`, `elu` et `libelle`
 *  viennent d'`AuteurAmendement`, l'auteur que montre aussi le tiroir de « Ce qui me
 *  concerne » : un même type d'auteur pour les deux. `elu` est rempli pour un député
 *  ou un sénateur résolu ; sinon la ligne affiche `libelle` (nom de la commission, nom
 *  brut d'un sénateur inconnu) ou, pour le Gouvernement, son nom.
 *  `role` : la chambre de l'élu, null pour le Gouvernement et une commission.
 *  `rapporteur` : vrai dès qu'un de ses amendements a été déposé à ce titre ; il
 *  s'ajoute au rôle, il ne le remplace pas.
 *  `nb` : son total d'amendements adoptés. Dans la carte, `amendements` n'en garde que
 *  les premiers (`carteAmendements`) ; dans le panneau, il les porte tous. */
export interface AuteurAmendements extends AuteurAmendement {
  cle: string;
  role: 'depute' | 'senateur' | null;
  rapporteur: boolean;
  nb: number;
  amendements: AmendementAdopte[];
}

/** Une ligne du graphique. `type` reprend celui de `amendements_par_groupe` ; seul
 *  « groupe » porte un libellé et une couleur, lus dans `organes` par page.tsx (la
 *  couleur manque aux non-inscrits du Sénat, qui restent gris, voir `resolveGroupeColor`). */
export interface LigneRepartition {
  cle: string;
  chambre: 'AN' | 'SN';
  type: 'groupe' | 'gouvernement' | 'commission' | 'non_publie' | 'sans_groupe';
  libelle: string | null;
  libelleLong: string | null;
  couleur: string | null;
  deposes: number;
  adoptes: number;
}

/** Ce que page.tsx passe à la section : les deux compteurs du dossier (la phrase
 *  d'en tête), les lignes du graphique, les auteurs d'amendements adoptés de la carte
 *  seulement (`carteAmendements`) et leur nombre total, `nbAuteurs`. */
export interface ModificationsDossier {
  deposes: number;
  adoptes: number;
  repartition: LigneRepartition[];
  auteurs: AuteurAmendements[];
  nbAuteurs: number;
}

/** Mémoïsée, comme SourcesSection : ResumeIAClient se rend à chaque morceau du
 *  résumé en streaming, et cette section, qui peut porter des centaines de liens,
 *  n'en dépend pas. `uid` sert au panneau à charger la liste entière ;
 *  `modifications` vaut null quand le dossier n'a aucun amendement déposé. */
export default memo(function ModificationsSection({ uid, modifications }: { uid: string; modifications: ModificationsDossier | null }) {
  const t = useTranslations('resumeIA');
  return (
    <SectionRepliable
      cle="modifications"
      cleStockage={CLE_PLI}
      icone={<IconeSection cle="modifications" />}
      titre={t('sectionModifications')}
    >
      {modifications ? <CarteModifications uid={uid} m={modifications} /> : (
        <p className="text-sm text-muted-foreground">{t('noModificationsData')}</p>
      )}
    </SectionRepliable>
  );
});

/** La carte : la phrase des deux compteurs, la répartition par chambre et par
 *  groupe, puis les auteurs d'amendements adoptés. */
function CarteModifications({ uid, m }: { uid: string; m: ModificationsDossier }) {
  const t = useTranslations('resumeIA');
  const parChambre = (['AN', 'SN'] as const)
    .map((chambre) => ({ chambre, lignes: m.repartition.filter((l) => l.chambre === chambre) }))
    .filter((c) => c.lignes.length > 0);
  // Une seule échelle pour les deux chambres : une barre de même longueur dit le même
  // nombre d'amendements, où qu'elle soit.
  const max = Math.max(0, ...m.repartition.map((l) => l.deposes));

  return (
    <div className="rounded-xl" style={CARTE}>
      <div className="text-sm text-muted-foreground mb-4">
        {t('modificationsTeaser', { deposes: m.deposes, adoptes: m.adoptes })}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
        {parChambre.length > 0 && (
          <div className="space-y-5 min-w-0">
            {parChambre.map(({ chambre, lignes }) => (
              <Bloc key={chambre} titre={t(chambre === 'AN' ? 'assemblee' : 'senat')}>
                <ul>
                  {lignes.map((l) => <LigneGraphique key={l.cle} ligne={l} max={max} />)}
                </ul>
              </Bloc>
            ))}
            <p className="text-muted-foreground" style={{ fontSize: '0.75rem', lineHeight: 1.45, margin: 0 }}>
              {t('modificationsLegende')}
            </p>
          </div>
        )}
        {m.auteurs.length > 0 && (
          <div className="min-w-0">
            <BlocAmendements uid={uid} auteurs={m.auteurs} nbAuteurs={m.nbAuteurs} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Une ligne du graphique : le nom, la barre, puis « adoptés / déposés », seule
 *  métrique écrite. Le nom a une largeur fixe pour que les barres partent toutes du
 *  même point, comme dans le volet d'un scrutin (`ScrutinVotesSheet`) ; un nom long
 *  (« Retirés avant la séance », « Les Indépendants ») passe sur deux lignes plutôt
 *  que d'être tronqué, ce qu'il était à 390 px. La barre n'a pas de rail : sa partie
 *  vide est sa propre couleur, éclaircie, ce qui garde sa longueur lisible sur les
 *  deux thèmes. Une phrase masquée à l'écran dit en toutes lettres ce que la barre
 *  montre : un `aria-label` sur le `<li>` n'est pas lu par tous les lecteurs d'écran,
 *  et la ligne, dont tout le reste est `aria-hidden`, resterait muette. */
function LigneGraphique({ ligne: l, max }: { ligne: LigneRepartition; max: number }) {
  const t = useTranslations('resumeIA');
  const tElus = useTranslations('elus');
  const locale = useLocale();
  const nom = l.type === 'groupe' ? l.libelle ?? l.libelleLong ?? t('modificationsSansGroupe')
    : l.type === 'gouvernement' ? tElus('roleGouvernement')
    : l.type === 'commission' ? t('modificationsCommission')
    : l.type === 'non_publie' ? t('modificationsNonPublie')
    : t('modificationsSansGroupe');
  const couleur = resolveGroupeColor(l.type === 'groupe' ? l.couleur : null);
  // `max` est le plus grand nombre de déposés, toujours au moins égal à celui-ci.
  const longueur = max > 0 ? l.deposes / max : 0;

  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', padding: '4px 0' }}>
      <span className="sr-only">{t('modificationsLigne', { nom, adoptes: l.adoptes, deposes: l.deposes })}</span>
      <span
        aria-hidden
        style={{ fontSize: '0.75rem', lineHeight: 1.3, flex: '0 0 96px', minWidth: 0, overflowWrap: 'anywhere' }}
        title={l.libelleLong ?? undefined}
      >
        {nom}
      </span>
      <span aria-hidden style={{ flex: '1 1 0', minWidth: '40px' }}>
        <span
          className="rounded-full overflow-hidden"
          style={{
            display: 'flex',
            height: '6px',
            width: `${longueur * 100}%`,
            minWidth: '2px',
            // Un hex à six chiffres, suivi de son opacité (un tiers) : `resolveGroupeColor`
            // ne rend que ce format (couleurs de l'open data, repli gris). À un quart, les
            // teintes déjà claires (HOR, LIOT) disparaissaient sur fond blanc.
            backgroundColor: `${couleur}55`,
          }}
        >
          {l.adoptes > 0 && (
            <span style={{ width: `${(l.adoptes / l.deposes) * 100}%`, minWidth: '2px', backgroundColor: couleur }} />
          )}
        </span>
      </span>
      <span
        aria-hidden
        className="text-muted-foreground text-right"
        style={{ flexShrink: 0, fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', minWidth: '72px' }}
      >
        {l.adoptes.toLocaleString(locale)} / {l.deposes.toLocaleString(locale)}
      </span>
    </li>
  );
}

/** Bloc « Amendements adoptés par auteur » de la carte. La carte garde une hauteur bornée
 *  quel que soit le dossier (une loi promulguée compte souvent plus de cent
 *  auteurs) : dix auteurs au plus, et dix amendements au plus par auteur ouvert.
 *  Au-delà, « Voir les N » ouvre le panneau, qui porte la liste entière ; ouvert
 *  depuis un auteur, il s'ouvre sur lui, liste dépliée.
 *  `auteurs` ne porte que la carte : la liste entière est chargée à la première
 *  ouverture du panneau, puis gardée pour les suivantes. Un panneau refermé avant la
 *  réponse la garde quand même : la réponse pèse jusqu'à 845 Ko, et la jeter obligeait
 *  à la retélécharger à la réouverture. Seul un échec relance la demande, à la
 *  réouverture suivante. */
function BlocAmendements({ uid, auteurs, nbAuteurs }: { uid: string; auteurs: AuteurAmendements[]; nbAuteurs: number }) {
  const t = useTranslations('resumeIA');
  const [panneau, setPanneau] = useState<{ ouvert: boolean; cle: string | null }>({ ouvert: false, cle: null });
  const [tous, setTous] = useState<AuteurAmendements[] | null>(null);
  const [echec, setEchec] = useState(false);
  // Une demande en vol : fermer puis rouvrir le panneau pendant le chargement ne
  // doit pas en lancer une seconde.
  const enCours = useRef(false);
  // Un seul tiroir pour toutes les lignes. L'amendement reste renseigné à la fermeture :
  // le contenu doit encore s'afficher pendant l'animation.
  const [tiroir, setTiroir] = useState<{ amendement: AmendementAdopte | null; ouvert: boolean }>({ amendement: null, ouvert: false });
  const ouvrirAmendement = (amendement: AmendementAdopte) => setTiroir({ amendement, ouvert: true });
  const ouvrir = (cle: string | null) => {
    setEchec(false);
    setPanneau({ ouvert: true, cle });
  };

  useEffect(() => {
    if (!panneau.ouvert || tous || enCours.current) return;
    enCours.current = true;
    fetch(`/api/dossiers/${encodeURIComponent(uid)}/amendements`)
      .then((r) => (r.ok ? r.json() as Promise<{ auteurs: AuteurAmendements[] }> : Promise.reject(new Error(String(r.status)))))
      .then((d) => setTous(d.auteurs))
      .catch(() => setEchec(true))
      .finally(() => { enCours.current = false; });
  }, [panneau.ouvert, tous, uid]);

  return (
    <Bloc titre={t('sourcesAmendements')} id={ANCRE_AMENDEMENTS}>
      <ul>
        {auteurs.slice(0, AUTEURS_VISIBLES).map((a) => (
          <LigneAuteurAmendements key={a.cle} auteur={a} onVoirTout={() => ouvrir(a.cle)} onOuvrirAmendement={ouvrirAmendement} />
        ))}
      </ul>
      {nbAuteurs > AUTEURS_VISIBLES && (
        <BoutonVoirTout onClick={() => ouvrir(null)}>{t('sourcesVoirTout', { count: nbAuteurs })}</BoutonVoirTout>
      )}
      <PanneauAmendements
        auteurs={tous ?? auteurs}
        etat={tous ? null : echec ? 'echec' : 'chargement'}
        ouvert={panneau.ouvert}
        cleOuverte={panneau.cle}
        onOpenChange={(ouvert) => setPanneau((p) => ({ ...p, ouvert }))}
        onOuvrirAmendement={ouvrirAmendement}
      />
      <AmendementSheet amendement={tiroir.amendement} ouvert={tiroir.ouvert} onFermer={() => setTiroir((v) => ({ ...v, ouvert: false }))} />
    </Bloc>
  );
}

/** Panneau de tous les auteurs et de tous leurs amendements. Le contenu de
 *  `Panneau` n'est monté qu'ouvert, si bien que `cleOuverte` est relue à chaque
 *  ouverture. Tant que la liste entière n'est pas arrivée (`etat`), il montre la
 *  carte et une ligne qui le dit. */
function PanneauAmendements({ auteurs, etat, ouvert, cleOuverte, onOpenChange, onOuvrirAmendement }: {
  auteurs: AuteurAmendements[];
  etat: 'chargement' | 'echec' | null;
  ouvert: boolean;
  cleOuverte: string | null;
  onOpenChange: (ouvert: boolean) => void;
  onOuvrirAmendement: (a: AmendementAdopte) => void;
}) {
  const t = useTranslations('resumeIA');
  return (
    <Panneau titre={t('sourcesAmendements')} ouvert={ouvert} onOpenChange={onOpenChange}>
      {etat && (
        <p role="status" className="text-muted-foreground" style={{ fontSize: '0.75rem', lineHeight: 1.45, margin: '0 0 0.5rem' }}>
          {t(etat === 'echec' ? 'amendementsEchec' : 'amendementsChargement')}
        </p>
      )}
      <ul>
        {auteurs.map((a) => (
          <LigneAuteurAmendements key={a.cle} auteur={a} ouvertAuDepart={a.cle === cleOuverte} onOuvrirAmendement={onOuvrirAmendement} />
        ))}
      </ul>
    </Panneau>
  );
}

/** Ligne d'un auteur d'amendements adoptés, sur le motif de `LigneElu`
 *  (SourcesSection) : photo, nom, badges, groupe, puis le nombre (seule métrique) et
 *  un chevron. Toute la ligne est un seul bouton qui déplie la liste : pas de lien
 *  vers la fiche de l'élu en plus, pour garder une seule cible tactile par ligne sur
 *  mobile. Le Gouvernement et une commission ont une vignette à leur icône
 *  (`VignetteIcone`), pour que leur ligne s'aligne sur celles des élus. Le badge
 *  « Rapporteur » s'ajoute à celui du rôle, en couleur d'accent. La liste n'est montée
 *  qu'à la première ouverture, puis reste montée pour que la refermer s'anime.
 *
 *  Dans la carte (`onVoirTout` fourni), la liste s'arrête à dix amendements et
 *  « Voir les N » ouvre le panneau ; dans le panneau, elle est entière. */
function LigneAuteurAmendements({ auteur, onVoirTout, ouvertAuDepart = false, onOuvrirAmendement }: {
  auteur: AuteurAmendements;
  onVoirTout?: () => void;
  ouvertAuDepart?: boolean;
  onOuvrirAmendement: (a: AmendementAdopte) => void;
}) {
  const t = useTranslations('resumeIA');
  const tElus = useTranslations('elus');
  const locale = useLocale();
  const idPanneau = useId();
  const bouton = useRef<HTMLButtonElement>(null);
  const [ouvert, setOuvert] = useState(ouvertAuDepart);
  const [monte, setMonte] = useState(ouvertAuDepart);

  // Le panneau ouvert depuis un auteur amène sa ligne à l'écran. Le bouton seul, sans
  // la liste qu'il déplie : centrer tout le `<li>` visait le milieu de ses 67
  // amendements. Au centre et non en haut : en haut, le premier auteur faisait défiler
  // le titre et la croix de fermeture hors du panneau.
  useEffect(() => {
    if (ouvertAuDepart) bouton.current?.scrollIntoView({ block: 'center' });
  }, [ouvertAuDepart]);

  const nb = auteur.nb;
  // Sans élu ni libellé (député absent d'`acteurs`), la ligne ne peut dire que la chambre.
  const nom = auteur.elu ? `${auteur.elu.prenom ?? ''} ${auteur.elu.nom ?? ''}`.trim()
    : auteur.type === 'gouvernement' ? tElus('roleGouvernement')
    : auteur.libelle ?? t(auteur.amendements[0]?.chambre === 'SN' ? 'senat' : 'assemblee');
  const coupe = onVoirTout && nb > AMENDEMENTS_VISIBLES;
  const amendements = coupe ? auteur.amendements.slice(0, AMENDEMENTS_VISIBLES) : auteur.amendements;
  // Sous le nom : la liste démarre là où le texte de la ligne commence.
  const vignette = !!auteur.elu || auteur.type === 'gouvernement' || auteur.type === 'commission';
  const retrait = vignette ? '38px' : '0';

  return (
    <li>
      <button
        ref={bouton}
        type="button"
        onClick={() => { setMonte(true); setOuvert((o) => !o); }}
        aria-expanded={ouvert}
        aria-controls={idPanneau}
        aria-label={t('sourcesAmendementsAuteur', { nom, count: nb })}
        className="hover:bg-muted"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          width: 'calc(100% + 1rem)',
          // La hauteur d'une ligne d'élu à deux lignes de texte (nom, groupe), mesurée
          // à 54 px : le Gouvernement et un élu sans groupe n'en ont qu'une, et leur
          // ligne tombait à 40 px au milieu des autres.
          minHeight: '54px',
          padding: '0.375rem 0.5rem',
          margin: '0 -0.5rem',
          borderRadius: '0.5rem',
          color: 'var(--foreground)',
          fontSize: '0.875rem',
          fontWeight: 500,
          textAlign: 'left',
        }}
      >
        {auteur.elu ? <PhotoEluVignette acteur={auteur.elu} taille={28} ancien={auteur.elu.ancien} />
          : auteur.type === 'gouvernement' ? <VignetteIcone icone={Landmark} />
          : auteur.type === 'commission' && <VignetteIcone icone={Users} />}
        <span className="min-w-0" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nom}</span>
            {auteur.role && <BadgeRole role={auteur.role} elu={auteur.elu} />}
            {auteur.rapporteur && <Badge accent>{t('labelRapporteur', { count: 1 })}</Badge>}
          </span>
          {auteur.elu?.groupe && (
            <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {auteur.elu.groupe}
            </span>
          )}
        </span>
        <span className="text-muted-foreground" style={{ flexShrink: 0, fontSize: '0.8125rem', fontVariantNumeric: 'tabular-nums' }}>
          {nb.toLocaleString(locale)}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          aria-hidden
          className="text-muted-foreground"
          style={{ flexShrink: 0, transform: ouvert ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
        />
      </button>
      <Depliable ouvert={ouvert} id={idPanneau} style={{ paddingLeft: retrait }}>
        {monte && (
          <>
            <ul>{amendements.map((a) => <LigneAmendement key={a.uid} amendement={a} onOuvrir={onOuvrirAmendement} />)}</ul>
            {coupe && <BoutonVoirTout onClick={onVoirTout}>{t('sourcesVoirTout', { count: nb })}</BoutonVoirTout>}
          </>
        )}
      </Depliable>
    </li>
  );
}

/** Vignette d'un auteur sans photo : le cadre de repli de `PhotoEluVignette` (28 px,
 *  coins de 8 px, fond gris), avec une icône. `Landmark` pour le Gouvernement, celle qui
 *  le désigne déjà dans le bandeau « Écrire à mes élus » (`ContacterMesElusBanner`) ;
 *  `Users` pour une commission, le site n'ayant pas d'icône à elle. */
function VignetteIcone({ icone: Icone }: { icone: LucideIcon }) {
  return (
    <span
      aria-hidden
      style={{
        width: '28px',
        height: '28px',
        borderRadius: '8px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--color-muted)',
        color: 'var(--color-muted-foreground)',
      }}
    >
      <Icone size={14} strokeWidth={1.5} />
    </span>
  );
}

/** Un amendement : « Amendement CF31 · Art. 2 », puis le lieu et la chambre en gris.
 *  Un vrai lien vers sa page, pour les robots et le cmd-clic ; seul le clic simple ouvre
 *  le tiroir. `prefetch` coupé : le panneau du budget en monte 3 306. */
function LigneAmendement({ amendement: a, onOuvrir }: { amendement: AmendementAdopte; onOuvrir: (a: AmendementAdopte) => void }) {
  const t = useTranslations('resumeIA');
  const tAmendement = useTranslations('amendementPage');
  const surClic = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onOuvrir(a);
  };
  return (
    <li style={{ paddingBottom: '4px' }}>
      <div style={{ padding: '4px 0', lineHeight: 1.45 }}>
        <Link
          href={`/Amendements/${a.uid}`}
          prefetch={false}
          onClick={surClic}
          data-sans-voile
          className="text-sm text-foreground hover:text-primary"
          style={{ textDecoration: 'none' }}
        >
          {t('sourcesAmendementLibelle', { numero: a.numero })}{a.article && ` · ${a.article}`}
        </Link>
      </div>
      <span className="block text-muted-foreground" style={{ fontSize: '0.75rem', marginTop: '-2px', lineHeight: 1.4 }}>
        {tAmendement(a.lieu === 'seance' ? 'adopteSeance' : 'adopteCommission', { chambre: t(a.chambre === 'AN' ? 'assemblee' : 'senat') })}{a.avecVote && ` · ${tAmendement('avecVote')}`}
      </span>
    </li>
  );
}
