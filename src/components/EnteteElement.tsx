// L'en-tête commun aux tiroirs d'un article, d'un amendement et d'un vote, et à la page d'un
// amendement : le nom de l'élément, puis des lignes étiquetées. Sans étiquette, on ne
// comprenait pas à quoi correspondait chaque ligne. Un amendement porte deux états : il peut
// être adopté alors que le texte qu'il modifie a ensuite été rejeté.
//
// Pas de `'use client'` : `articleEnEntier` et `LignesEntete` servent aussi à la page d'un
// amendement, rendue côté serveur.

import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import { BadgeStatut } from '@/app/[locale]/(app)/Scrutins/[uid]/ResultatVote';
import type { DetailAmendement, ReponseAmendement } from '@/lib/amendement-page';
import { SCRUTIN_COLORS } from '@/lib/scrutin-affichage';
import { seanceVersSlug } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/debats/seance-slug';

export type TexteEntete = { uid: string; titre: string; traduit: boolean };
/** Un statut : `statut`, la valeur française brute qui choisit la couleur de la pastille
 *  (comme pour un vote) ; `libelle`, sa traduction ; `complement`, ce qui le précise hors de
 *  la pastille (date, lieu d'adoption, étape du parcours). `enChargement` : une pastille
 *  d'attente de même hauteur tient la place, pour que l'en-tête ne bouge pas à l'arrivée. */
export type EtatEntete = { etiquette: string; statut: string | null; libelle: string | null; complement?: ReactNode; enChargement?: boolean };

const STYLE_ETIQUETTE = { fontSize: '0.75rem', color: 'var(--muted-foreground)' } as const;

/** « Art. 5 » écrit en entier pour un titre. Les autres formes (« Après art. 1 »,
 *  « État A ») restent telles quelles. */
export function articleEnEntier(libelle: string) {
  return libelle.replace(/^Art\.\s*/, 'Article ');
}

/** Le nom du texte, toujours cliquable vers sa fiche. Sur cette fiche, l'adresse ne
 *  changeant pas, `onFermer` referme le tiroir. */
export function LienTexte({ texte, onFermer }: { texte: TexteEntete; onFermer?: () => void }) {
  return (
    <span className="flex flex-wrap items-center" style={{ gap: '6px' }}>
      <Link href={`/dossiers-legislatifs/${texte.uid}/resume-ia`} prefetch={false} onClick={onFermer} className="text-sm text-primary hover:underline">{texte.titre}</Link>
      {texte.traduit && <AIBadgeTitre />}
    </span>
  );
}

/** Les lignes étiquetées. Des `span` et non une liste de définitions : la phrase du bandeau
 *  de `PageHero`, où la page les pose, est un paragraphe. */
export function LignesEntete({ etiquetteTexte, texte, etats }: {
  etiquetteTexte: string;
  /** `null` tant que le texte n'est pas connu. */
  texte: ReactNode;
  etats: EtatEntete[];
}) {
  return (
    <span style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '4px 12px', alignItems: 'baseline', marginTop: '2px' }}>
      {texte && (
        <>
          <span style={STYLE_ETIQUETTE}>{etiquetteTexte}</span>
          <span style={{ minWidth: 0 }}>{texte}</span>
        </>
      )}
      {etats.map((e) => (
        <Fragment key={e.etiquette}>
          <span style={STYLE_ETIQUETTE}>{e.etiquette}</span>
          <span style={{ ...STYLE_ETIQUETTE, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.4rem', lineHeight: 1.5 }}>
            {/* La boîte de `BadgeStatut`, avec une espace insécable : même hauteur et même
                ligne de base que la pastille qui la remplacera. */}
            {e.enChargement
              ? <span aria-hidden className="inline-block shrink-0 px-2 py-0.5 rounded-full font-semibold border border-transparent bg-accent animate-pulse" style={{ fontSize: '11px', width: '7rem' }}>{' '}</span>
              : <BadgeStatut statut={e.statut} statutLabel={e.libelle} />}
            {e.complement && <span>{e.complement}</span>}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/** L'en-tête d'un tiroir. Le vide flottant dégage « Partager » et la croix, posés en absolu
 *  à la hauteur de la première ligne, sans retirer de largeur aux lignes suivantes d'un
 *  titre long (celui d'un vote tient souvent sur quatre lignes à 390 px). */
export function EnteteTiroir({ nom, texte, etats, lignes, onFermer }: {
  nom: ReactNode;
  /** Remplace les lignes étiquetées (`texte`, `etats`) : l'amendement a son propre en-tête,
   *  `EnteteAmendement`. */
  lignes?: ReactNode;
  /** Absent tant que le détail charge, quand le texte n'est pas déjà connu. */
  texte?: TexteEntete | null;
  /** Ignoré quand `lignes` est donné. */
  etats?: EtatEntete[];
  onFermer: () => void;
}) {
  const t = useTranslations('amendementPage');
  return (
    <SheetHeader>
      <SheetTitle style={{ fontSize: '16px', lineHeight: 1.35 }}>
        <span aria-hidden style={{ float: 'right', width: 110, height: '1em' }} />
        {nom}
      </SheetTitle>
      {lignes ?? (
        <LignesEntete
          etiquetteTexte={t('enteteTexte')}
          texte={texte?.titre ? <LienTexte texte={texte} onFermer={onFermer} /> : null}
          etats={etats ?? []}
        />
      )}
    </SheetHeader>
  );
}

type Ton = 'oui' | 'non' | 'neutre';
const COULEUR_TON: Record<Ton, string> = { oui: SCRUTIN_COLORS.pour, non: SCRUTIN_COLORS.contre, neutre: 'var(--muted-foreground)' };
const ICONE_TON = { oui: Check, non: X, neutre: Clock };
const BLOC: CSSProperties = { display: 'block' };

/** Une réponse : icône ronde teintée, titre en gras, détail en gris dessous. Des `span` : la
 *  page pose l'en-tête dans la phrase de `PageHero`, un paragraphe. */
function Reponse({ ton, titre, detail }: { ton: Ton; titre: ReactNode; detail?: ReactNode }) {
  const Icone = ICONE_TON[ton];
  const couleur = COULEUR_TON[ton];
  return (
    <span style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr)', columnGap: '10px' }}>
      <span aria-hidden style={{ width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', marginTop: 1, color: couleur, backgroundColor: `color-mix(in oklab, ${couleur} 14%, transparent)` }}>
        <Icone size={14} strokeWidth={2.5} />
      </span>
      <span style={{ ...BLOC, minWidth: 0 }}>
        <span style={{ ...BLOC, fontSize: '1rem', fontWeight: 600, lineHeight: 1.4, color: 'var(--foreground)' }}>{titre}</span>
        {detail && <span style={{ ...BLOC, fontSize: '0.875rem', lineHeight: 1.5, marginTop: 1 }}>{detail}</span>}
      </span>
    </span>
  );
}

/** Ce que l'en-tête sait d'un amendement avant le chargement de son détail (tiroir). */
export type AmendementConnu = Pick<DetailAmendement, 'chambre' | 'lieu'> & { sort?: DetailAmendement['sort'] };

/** L'en-tête d'un amendement, sur sa page et dans son tiroir (prototype
 *  `mockups/entete-amendement`, v1 adoptée par Alex le 2026-11-21) : d'abord les deux
 *  réponses que cherche le lecteur, le vote sur l'amendement (date, décompte d'un scrutin
 *  public) puis s'il est dans le texte aujourd'hui (`reponseAmendement`) ; après un filet,
 *  le texte, son statut, la source et les débats, en gris. Une seule famille de styles, sans
 *  pastille. `detail` absent : le tiroir charge, la seconde réponse garde sa place. */
export function EnteteAmendement({ connu, detail, texte, onFermer }: {
  connu: AmendementConnu;
  detail: DetailAmendement | null;
  /** Le texte quand il est déjà connu, pour le nommer avant la fin du chargement. */
  texte?: TexteEntete | null;
  onFermer?: () => void;
}) {
  const t = useTranslations('amendementPage');
  const sort = detail?.sort ?? connu.sort ?? 'adopte';
  const chambre = connu.chambre;
  const v = detail?.vote;
  const titreVote = t(sort === 'rejete' ? 'voteRejete' : connu.lieu === 'commission' ? 'voteAdopteCommission' : 'voteAdopteSeance', { chambre });
  const detailVote = [
    detail?.date,
    v && t('voteDecompte', { pour: v.pour, contre: v.contre, abstentions: v.abstentions }),
  ].filter(Boolean).join(' · ');
  const r = detail?.reponse;
  const tonReponse: Ton = !r ? 'neutre' : r.cas === 'texte_rejete' || r.cas === 'rejete_scrutin' ? 'non' : r.cas.startsWith('oui') ? 'oui' : 'neutre';
  const leTexte = detail ? { uid: detail.dossier_uid, titre: detail.titre_texte, traduit: detail.titre_traduit } : texte;
  const seance = detail?.debats.length === 1 ? `/debats/${seanceVersSlug(detail.debats[0].seance_uid)}` : '/debats';
  const lien: CSSProperties = { color: 'inherit', textDecoration: 'none' };
  const etatTexte = detail?.etat_texte && [detail.etat_texte.libelle, detail.etat_texte.date && t('statutLe', { date: detail.etat_texte.date })].filter(Boolean).join(' ');
  return (
    // 18 px sous le titre, page comme tiroir (retour d'Alex, 2026-11-21 : trop serré à 6).
    <span style={{ ...BLOC, maxWidth: '46rem', marginTop: '18px', color: 'var(--muted-foreground)' }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Reponse ton={sort === 'rejete' ? 'non' : 'oui'} titre={titreVote} detail={detailVote || null} />
        {detail ? r && (
          <Reponse
            ton={tonReponse}
            titre={t('reponseTitre', { cas: r.cas })}
            detail={
              <>
                {phraseReponse(r, t)}
                {r.cas === 'oui_loi' && r.url_loi && (
                  <>
                    {' '}
                    <a href={r.url_loi} target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: 'var(--primary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {t('reponseLireLoi')} →
                    </a>
                  </>
                )}
              </>
            }
          />
        ) : (
          // Même hauteur que la réponse qui la remplacera.
          <span aria-hidden className="animate-pulse rounded-md bg-accent" style={{ display: 'block', height: '2.75rem', marginLeft: 32, maxWidth: '22rem' }} />
        )}
      </span>
      {leTexte?.titre && (
        <span style={{ ...BLOC, marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border)', fontSize: '0.875rem', lineHeight: 1.5 }}>
          <span className="inline-flex flex-wrap items-center" style={{ gap: '6px' }}>
            <Link href={`/dossiers-legislatifs/${leTexte.uid}/resume-ia`} prefetch={false} onClick={onFermer} className="hover:underline" style={{ color: 'var(--foreground)', fontWeight: 500 }}>
              {leTexte.titre} →
            </Link>
            {leTexte.traduit && <AIBadgeTitre />}
          </span>
          {detail && (
            <span style={{ ...BLOC, marginTop: 2 }}>
              {etatTexte && <>{etatTexte} · </>}
              <a href={detail.url} target="_blank" rel="noopener noreferrer" className="hover:underline" style={lien}>
                {t(chambre === 'SN' ? 'sourceSenat' : 'sourceAN')} ↗
              </a>
              {detail.debats.length > 0 && (
                <>
                  {' · '}
                  <Link href={`/dossiers-legislatifs/${detail.dossier_uid}${seance}`} prefetch={false} onClick={onFermer} className="hover:underline" style={lien}>
                    {t('lireDebats')}
                  </Link>
                </>
              )}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** La phrase de la réponse, celle de la ligne de recherche (`AmendementsTrouves`) complétée de
 *  ce qui a pu se passer ensuite. */
function phraseReponse(r: ReponseAmendement, t: ReturnType<typeof useTranslations<'amendementPage'>>): string {
  const { chambre } = r;
  const date = r.date ?? '';
  const oui = () => t('reponseOui', { chambre, date, commission: r.commission ? 'oui' : 'non' });
  switch (r.cas) {
    case 'rejete_scrutin': return t('reponseRejeteScrutin', { date });
    case 'texte_rejete': return t('reponseTexteRejete', { chambre, date });
    case 'pas_encore': return t('reponsePasEncore');
    case 'sans_vote': return t('reponseSansVote', { chambre });
    case 'oui': return oui();
    case 'oui_navette': return `${oui()} ${t('reponseSuiteNavette')}`;
    case 'oui_loi': return `${oui()} ${t('reponseSuiteLoi', { date: r.date_loi ?? '' })}`;
  }
}
