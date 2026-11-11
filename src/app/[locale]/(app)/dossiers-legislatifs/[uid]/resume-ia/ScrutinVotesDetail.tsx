'use client';

// Liste des votes d'un scrutin : un rang par groupe, de gauche à droite comme dans
// l'hémicycle, portant sa barre de vote, son décompte et sa position, qui se déplie sur
// ses élus. Les élus identifiés par le lecteur sont épinglés au-dessus. Le même fichier
// porte la liste des élus qui ont voté contre leur groupe (`ScrutinDissidents`).
// Les deux sont montées par `Scrutins/[uid]/SectionsVote.tsx`, sur la page d'un vote
// comme dans le tiroir de la fiche du texte.
//
// Le tiroir charge les votes à l'ouverture et passe leur état ; la page d'un vote les
// lit côté serveur et les passe déjà chargés. Ce composant ne charge rien lui-même.

import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { Link } from '@/i18n/navigation';
import { BoutonsPageSource } from '@/components/LiensSource';
import { useTranslations } from 'next-intl';
import { ChevronRight, Loader2, Info, Search } from 'lucide-react';
import { resolveGroupeColor } from '@/lib/groupe-colors';
import { useMesElus } from '@/hooks/useMesElus';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import type { ScrutinVotesResponse, VoteElu, VoteGroupe } from '@/lib/scrutin-votes';
import { ScrutinBarGroupe, SCRUTIN_COLORS } from './ScrutinScore';
import { urlScrutinOfficiel } from '@/lib/scrutin-affichage';
import type { ScrutinData } from './ResumeIAClient';

/** Ce que porte la ligne d'un groupe : sa barre et ses quatre nombres. */
type Decompte = { pour: number; contre: number; abstentions: number; aucunVote: number };

// Décompte officiel d'un groupe qui a une position. Le reste neutre est l'effectif moins
// les votes exprimés : la base ne sépare pas non-votants et absents par groupe. Au Sénat,
// l'effectif est la somme des votants listés, ce reste y vaut donc presque toujours 0.
function decompteOfficiel(g: VoteGroupe): Decompte {
  const pour = g.nbPour ?? 0;
  const contre = g.nbContre ?? 0;
  const abstentions = g.nbAbstentions ?? 0;
  return { pour, contre, abstentions, aucunVote: Math.max((g.nbMembres ?? 0) - pour - contre - abstentions, 0) };
}

function effectif(d: Decompte): number {
  return d.pour + d.contre + d.abstentions + d.aucunVote;
}

// Palette partagée avec la barre et la légende de la carte de vote : une position garde la
// même teinte du parcours jusqu'au nom de l'élu.
const POSITION_COLOR: Record<string, string> = SCRUTIN_COLORS;

// Ordre de lecture des positions, repris de la légende de la carte de vote.
const POSITION_ORDER = ['pour', 'contre', 'abstentions', 'nonVotants', 'absents', 'institutionnels'] as const;

const POSITION_LABEL_KEY: Record<string, string> = {
  pour: 'votePositionPour',
  contre: 'votePositionContre',
  abstentions: 'votePositionAbstention',
  nonVotants: 'votePositionNonVotant',
  institutionnels: 'votePositionInstitutionnel',
  absents: 'votePositionAbsent',
};

// La position d'un groupe se dit « abstention » au singulier, les clés de
// `votes_nominatifs` disent « abstentions ». Comparer les deux demande ce pont.
const GROUPE_POSITION_TO_ELU: Record<string, string> = {
  pour: 'pour',
  contre: 'contre',
  abstention: 'abstentions',
};

// Un élu est signalé dissident quand il a voté activement (pour, contre, abstention) dans
// un sens différent de la position majoritaire de son groupe. Absents et non-votants sont
// exclus : ne pas voter n'est pas voter contre les siens. Sans position de groupe, aucun
// signalement, et trois cas y mènent : aucun membre du groupe n'a voté, ses options de tête
// sont à égalité (D-269), ou le scrutin, au Sénat, précède le 2 octobre 2023 et la base ne
// sait pas qui en était (D-308).
function isDissident(elu: VoteElu, groupe: VoteGroupe | undefined): boolean {
  if (!groupe?.position) return false;
  if (!['pour', 'contre', 'abstentions'].includes(elu.position)) return false;
  return GROUPE_POSITION_TO_ELU[groupe.position] !== elu.position;
}

// Recherche insensible aux accents : « Herve » doit trouver « Hervé ».
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function PositionPill({ position, label }: { position: string; label: string }) {
  const color = POSITION_COLOR[position] ?? '#6b7280';
  return (
    <span
      className="shrink-0 whitespace-nowrap"
      style={{
        padding: '0.1rem 0.45rem',
        borderRadius: '9999px',
        fontWeight: 700,
        fontSize: '10px',
        backgroundColor: color + '20',
        color,
      }}
    >
      {label}
    </span>
  );
}

/** Une ligne d'élu : son portrait, son nom (et « dissident » s'il a voté contre la ligne
 *  de son groupe), dessous son département et sa circonscription, puis sa position. Le
 *  portrait se charge à la demande (`PhotoEluVignette`, `loading="lazy"`) : les lignes
 *  d'un groupe replié sont dans le HTML mais masquées, et ne demandent aucune image. */
function EluRow({ elu, positionLabel, dissident, dissidentLabel, lieu }: {
  elu: VoteElu;
  positionLabel: string;
  dissident: boolean;
  dissidentLabel: string;
  /** « Ardennes, 3ᵉ circonscription », déjà traduit, ou `null`. */
  lieu: string | null;
}) {
  return (
    <Link
      href={`/les-elus/${elu.uid}`}
      prefetch={false}
      className="flex items-center gap-2.5 rounded hover:bg-muted/60 transition-colors"
      style={{ padding: '5px 6px', textDecoration: 'none', color: 'inherit' }}
    >
      <PhotoEluVignette acteur={{ uid: elu.uid, url_profil_officiel: elu.urlProfil, prenom: elu.prenom, nom: elu.nom }} taille={28} />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="truncate" style={{ fontSize: '13px', lineHeight: 1.35 }}>
          {elu.prenom} {elu.nom}
          {dissident && (
            <span className="ml-1.5" style={{ fontSize: '10px', color: '#b45309', fontWeight: 600 }}>
              {dissidentLabel}
            </span>
          )}
        </span>
        {lieu && <span className="truncate text-muted-foreground" style={{ fontSize: '11px', lineHeight: 1.35 }}>{lieu}</span>}
      </span>
      <PositionPill position={elu.position} label={positionLabel} />
    </Link>
  );
}

type Props = {
  scrutin: ScrutinData;
  chambreKey: string | null;
  /** Votes du scrutin, `null` tant qu'ils ne sont pas chargés. */
  votes: ScrutinVotesResponse | null;
  /** État du chargement, mené par le tiroir ; la page passe toujours `idle`. */
  status: 'idle' | 'loading' | 'error';
  /** Faux sur la page du vote, dont la section porte déjà ce titre. */
  titreGroupes?: boolean;
};

/** Les libellés d'une ligne d'élu, partagés par la liste des groupes et celle des
 *  dissidents. */
function useLibellesVote(typeVoteCode: string | null) {
  const t = useTranslations('scrutinVotes');
  const tElus = useTranslations('elus');
  // Sur une motion de censure, le seau « absents » ne contient pas des absents : la
  // Constitution ne fait recenser que les votes favorables, donc tous ceux qui n'ont pas
  // soutenu la motion y tombent, opposants compris. Même règle que la barre de la carte.
  const positionLabel = useCallback(
    (position: string) => {
      if (position === 'absents' && typeVoteCode === 'MOC') {
        return tElus('votePositionNonRecense');
      }
      const key = POSITION_LABEL_KEY[position];
      return key ? tElus(key as Parameters<typeof tElus>[0]) : position;
    },
    [tElus, typeVoteCode],
  );
  // Département d'élection, et circonscription pour un député : de quoi reconnaître un
  // élu d'un coup d'œil, et repérer ceux de son département.
  const lieuElu = useCallback((e: VoteElu) => {
    if (!e.departement) return null;
    return e.circo ? t('eluCirco', { dept: e.departement, circo: Number(e.circo) }) : e.departement;
  }, [t]);
  return { positionLabel, lieuElu };
}

/** Les groupes qui comptent au moins un dissident, avec ces élus, dans l'ordre de
 *  `votes.groupes`, celui de l'hémicycle. Vide si personne ne s'est écarté de son groupe, ou
 *  si aucun groupe n'a de position. Lu aussi par `SectionsVote`, qui ne met alors pas de carte. */
export function dissidentsParGroupe(votes: ScrutinVotesResponse) {
  return votes.groupes
    .map((g) => ({ groupe: g, elus: votes.elus.filter((e) => e.groupeUid === g.uid && isDissident(e, g)) }))
    .filter((x) => x.elus.length > 0);
}

/**
 * Les élus qui n'ont pas suivi la position de leur groupe (`isDissident` : un vote exprimé
 * autre que celle du groupe, abstention comprise), rangés sous leur groupe dans l'ordre de
 * l'hémicycle. « N'ont pas suivi » et non « contre » : s'abstenir quand son groupe vote pour
 * n'est pas voter contre. Quand aucun groupe n'a de position (motion de censure, scrutin
 * du Sénat d'avant octobre 2023, D-308), une phrase le dit à la place de la liste. Sinon une
 * phrase d'accroche, qui dit aussi quand personne n'a dévié.
 */
export function ScrutinDissidents({ scrutin, votes }: { scrutin: ScrutinData; votes: ScrutinVotesResponse }) {
  const t = useTranslations('scrutinVotes');
  const { positionLabel, lieuElu } = useLibellesVote(scrutin.typeVoteCode);
  // Un groupe sans dissident n'est pas listé, la liste complète étant dans la section des
  // groupes.
  const parGroupe = dissidentsParGroupe(votes);
  // Rien à lister : une phrase seule, au format de « Autres votes sur ce texte » quand il
  // n'y en a pas (`Scrutins/[uid]/page.tsx`).
  if (parGroupe.length === 0) {
    return <p className="text-muted-foreground m-0" style={{ fontSize: '14px', lineHeight: '20px' }}>{votes.groupes.some((g) => g.position) ? t('dissidentsAccroche', { count: 0 }) : t('dissidentsSansPosition')}</p>;
  }
  const total = parGroupe.reduce((n, x) => n + x.elus.length, 0);
  return (
    <div className="flex flex-col" style={{ gap: '14px' }}>
      <p className="text-muted-foreground m-0" style={{ fontSize: '13px', lineHeight: 1.5 }}>{t('dissidentsAccroche', { count: total })}</p>
      {parGroupe.map(({ groupe: g, elus }) => (
        <div key={g.uid} className="flex flex-col" style={{ gap: '2px' }}>
          {/* La position du groupe, dans la pastille des élus : ceux qui suivent s'en
              écartent, et la différence de couleur se voit d'un coup d'œil. */}
          <p className="m-0 flex flex-wrap items-center" style={{ gap: '6px', fontSize: '12px', fontWeight: 600, padding: '0 6px' }}>
            <span className="inline-block rounded-full shrink-0" style={{ width: '8px', height: '8px', backgroundColor: resolveGroupeColor(g.couleur) }} />
            {g.libelleAbrege || g.libelle}
            <span className="text-muted-foreground" style={{ fontWeight: 400 }}>· {t('dissidentsPositionGroupe')}</span>
            {g.position && (
              <PositionPill
                position={GROUPE_POSITION_TO_ELU[g.position] ?? g.position}
                label={positionLabel(GROUPE_POSITION_TO_ELU[g.position] ?? g.position)}
              />
            )}
          </p>
          {elus.map((e) => (
            <EluRow
              key={e.uid}
              elu={e}
              positionLabel={positionLabel(e.position)}
              dissident={false}
              dissidentLabel=""
              lieu={lieuElu(e)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ScrutinVotesDetail({ scrutin, chambreKey, votes, status, titreGroupes = true }: Props) {
  const votants = scrutin.votants;
  const t = useTranslations('scrutinVotes');
  const { data: mesElus } = useMesElus();

  const [query, setQuery] = useState('');
  const [positionFilter, setPositionFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleGroupe = useCallback((uid: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  }, []);

  const { positionLabel, lieuElu } = useLibellesVote(scrutin.typeVoteCode);

  const mesEluUids = useMemo(() => {
    const uids = new Set<string>();
    if (mesElus?.depute) uids.add(mesElus.depute.uid);
    for (const s of mesElus?.senateurs ?? []) uids.add(s.uid);
    return uids;
  }, [mesElus]);

  // Élus regroupés par groupe, filtrés par la recherche et par la position. Les élus sans
  // groupe connu tombent dans un seau à part (clé vide) rendu en fin de liste.
  const { elusParGroupe, nbFiltres } = useMemo(() => {
    const map = new Map<string, VoteElu[]>();
    const q = normalize(query.trim());
    let count = 0;
    for (const e of votes?.elus ?? []) {
      if (positionFilter && e.position !== positionFilter) continue;
      if (q && !normalize(`${e.prenom ?? ''} ${e.nom ?? ''}`).includes(q)) continue;
      count++;
      const key = e.groupeUid ?? '';
      const list = map.get(key);
      if (list) list.push(e);
      else map.set(key, [e]);
    }
    return { elusParGroupe: map, nbFiltres: count };
  }, [votes, query, positionFilter]);

  // Filtres proposés : uniquement les positions réellement présentes sur ce scrutin, dans
  // l'ordre de lecture habituel. Inutile d'offrir « Non-votant » quand il n'y en a aucun.
  // Pas de compteur sur la pastille : il porterait sur les noms retenus, à un ou deux près
  // de la synthèse officielle affichée juste au-dessus (les corrections de vote publiées
  // après coup entrent dans les listes nominatives, pas dans la synthèse). Deux nombres
  // voisins et différents pour la même chose se lisent comme une erreur.
  const filtresPosition = useMemo(() => {
    const presentes = new Set((votes?.elus ?? []).map((e) => e.position));
    return POSITION_ORDER.filter((p) => presentes.has(p));
  }, [votes]);

  const mesElusDuScrutin = useMemo(
    () => (votes?.elus ?? []).filter((e) => mesEluUids.has(e.uid)),
    [votes, mesEluUids],
  );

  // Au Sénat, la base ne nomme que les sénateurs ayant siégé depuis le 2 octobre 2023
  // (D-308) : sur un scrutin plus ancien, la liste nominative couvre moins de monde que
  // le nombre de votants.
  const nbNommes = votes?.elus.length ?? 0;
  const listeTronquee = !!votes && votants > 0 && nbNommes < votants;

  const groupeByUid = useMemo(
    () => new Map((votes?.groupes ?? []).map((g) => [g.uid, g])),
    [votes],
  );

  // Décompte d'un groupe qui n'a pas de position, tiré de ses élus. L'import ne lui en
  // donne pas quand aucun de ses membres n'a voté ou que ses options de tête sont à
  // égalité (`_positions_groupe.py`), ni aux non-inscrits, qui ne forment pas un groupe
  // (D-313), ni sur aucune motion de censure, où tous les groupes
  // passent donc par ici (`import_scrutins_cloud.py`) : il n'écrit alors aucune ligne, donc
  // aucun décompte non plus. Sans celui-ci, la ligne n'affichait que le nombre de noms
  // rattachés, que rien n'expliquait. Il se compte sur toute la liste, pas sur les noms filtrés, comme le
  // décompte officiel des autres groupes. Les élus y sont rangés sous leur groupe du jour
  // du vote (D-278, note en pied de volet). `aucunVote` y reçoit tous les autres noms (non-votants,
  // absents, institutionnels), comme le reste neutre des groupes qui ont une position.
  const decompteSansPosition = useMemo(() => {
    const map = new Map<string, Decompte>();
    for (const e of votes?.elus ?? []) {
      if (!e.groupeUid || groupeByUid.get(e.groupeUid)?.position) continue;
      const d = map.get(e.groupeUid) ?? { pour: 0, contre: 0, abstentions: 0, aucunVote: 0 };
      if (e.position === 'pour' || e.position === 'contre' || e.position === 'abstentions') d[e.position]++;
      else d.aucunVote++;
      map.set(e.groupeUid, d);
    }
    return map;
  }, [votes, groupeByUid]);

  // Effectif du plus gros groupe : il donne toute sa largeur à sa barre, les autres en
  // prennent leur part. Calculé sur tous les groupes du scrutin, pas sur ceux que laisse
  // un filtre, pour qu'une barre ne change pas de longueur quand le lecteur tape un nom.
  const effectifMax = useMemo(() => {
    let max = 0;
    for (const g of votes?.groupes ?? []) {
      const d = g.position ? decompteOfficiel(g) : decompteSansPosition.get(g.uid);
      if (d) max = Math.max(max, effectif(d));
    }
    return max;
  }, [votes, decompteSansPosition]);

  // Une seule liste : chaque groupe porte sa position, et se déplie sur ses élus.
  // Un groupe sans nom rattaché reste visible tant qu'il a une position officielle (son
  // vote est une information en soi), mais disparaît dès qu'une recherche est en cours.
  // Les élus dont le groupe est inconnu ferment la liste.
  const filtrageActif = query !== '' || positionFilter !== null;

  const rangs = useMemo(() => {
    const out: { groupe: VoteGroupe | null; membres: VoteElu[] }[] = [];
    for (const g of votes?.groupes ?? []) {
      const membres = elusParGroupe.get(g.uid) ?? [];
      if (membres.length === 0 && (filtrageActif || !g.position)) continue;
      out.push({ groupe: g, membres });
    }
    const sansGroupe = elusParGroupe.get('') ?? [];
    if (sansGroupe.length > 0) out.push({ groupe: null, membres: sansGroupe });
    return out;
  }, [votes, elusParGroupe, filtrageActif]);

  const sectionTitleStyle: CSSProperties = {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  };

  return (
    <>

        {status === 'loading' && (
          <div className="flex items-center gap-2 text-muted-foreground" style={{ fontSize: '12px' }}>
            <Loader2 className="animate-spin" style={{ width: '14px', height: '14px' }} />
            {t('loading')}
          </div>
        )}

        {status === 'error' && (
          <p className="text-muted-foreground m-0" style={{ fontSize: '12px' }}>{t('error')}</p>
        )}

        {votes && (
          <>
            {listeTronquee && (
              <div
                className="flex items-start gap-2 rounded-lg"
                style={{ padding: '8px 10px', background: 'var(--color-muted)', fontSize: '11px', lineHeight: 1.5 }}
              >
                <Info style={{ width: '12px', height: '12px', flexShrink: 0, marginTop: '2px', opacity: 0.7 }} />
                <span>{t('partialNotice', { count: nbNommes, total: votants })}</span>
              </div>
            )}

            <section className="flex flex-col gap-2">
              {titreGroupes && <h3 className="text-muted-foreground m-0" style={sectionTitleStyle}>{t('groupsTitle')}</h3>}

              {/* Bloc « mes élus » : au-dessus de la recherche et jamais filtré. C'est la
                  réponse que le lecteur est venu chercher, elle ne doit pas disparaître
                  parce qu'il tape un nom ou clique sur « Contre ». Teinte or reprise de la
                  bannière « mes élus » du hero, où il les a identifiés. */}
              {mesElusDuScrutin.length > 0 && (
                <div
                  className="flex flex-col gap-1 rounded-lg"
                  style={{
                    padding: '8px 8px 6px',
                    background: 'rgba(212,165,74,0.10)',
                    border: '1px solid rgba(212,165,74,0.40)',
                  }}
                >
                  <span className="text-muted-foreground" style={sectionTitleStyle}>{t('myElus')}</span>
                  {mesElusDuScrutin.map((e) => {
                    const g = e.groupeUid ? groupeByUid.get(e.groupeUid) : undefined;
                    return (
                      <EluRow
                        key={e.uid}
                        elu={e}
                        positionLabel={positionLabel(e.position)}
                        dissident={isDissident(e, g)}
                        dissidentLabel={t('dissident')}
                        lieu={lieuElu(e)}
                      />
                    );
                  })}
                </div>
              )}

              <div className="relative">
                <Search
                  className="absolute text-muted-foreground pointer-events-none"
                  style={{ width: '13px', height: '13px', left: '9px', top: '50%', transform: 'translateY(-50%)' }}
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  aria-label={t('searchPlaceholder')}
                  className="w-full rounded-md border bg-transparent focus:outline-none focus:ring-1 focus:ring-primary"
                  style={{ fontSize: '12px', padding: '6px 10px 6px 26px' }}
                />
              </div>

              {/* Filtres par position : « qui a voté contre ? » se lit d'un clic, sans
                  déplier les douze groupes un par un. */}
              {filtresPosition.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {filtresPosition.map((position) => {
                    const actif = positionFilter === position;
                    const couleur = POSITION_COLOR[position] ?? '#6b7280';
                    return (
                      <button
                        key={position}
                        type="button"
                        aria-pressed={actif}
                        onClick={() => setPositionFilter(actif ? null : position)}
                        className="inline-flex items-center gap-1.5 rounded-full border transition-colors"
                        style={{
                          fontSize: '10px',
                          fontWeight: 600,
                          padding: '3px 9px',
                          borderColor: actif ? couleur : 'var(--color-border)',
                          backgroundColor: actif ? couleur + '20' : 'transparent',
                          color: actif ? couleur : 'var(--muted-foreground)',
                        }}
                      >
                        <span className="inline-block rounded-full" style={{ width: '6px', height: '6px', backgroundColor: couleur }} />
                        {positionLabel(position)}
                      </button>
                    );
                  })}
                </div>
              )}

              {nbFiltres === 0 ? (
                <p className="text-muted-foreground m-0" style={{ fontSize: '12px' }}>{t('noResult')}</p>
              ) : (
                <ul className="flex flex-col" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {rangs.map(({ groupe: g, membres }) => {
                    const key = g?.uid ?? 'sans-groupe';
                    // Un filtre en cours déplie tout : sinon le lecteur devrait ouvrir les
                    // groupes un par un pour voir ce qu'il vient de demander.
                    const isOpen = filtrageActif || expanded.has(key);
                    const position = g?.position ? GROUPE_POSITION_TO_ELU[g.position] ?? g.position : null;
                    const decompte = !g ? null : position ? decompteOfficiel(g) : decompteSansPosition.get(g.uid) ?? null;
                    return (
                      <li key={key} className="border-b border-border/50">
                        <button
                          type="button"
                          onClick={() => toggleGroupe(key)}
                          aria-expanded={isOpen}
                          disabled={membres.length === 0}
                          className="w-full flex items-center gap-2 hover:bg-muted/60 transition-colors disabled:hover:bg-transparent"
                          style={{ padding: '7px 4px' }}
                        >
                          <ChevronRight
                            className="shrink-0 text-muted-foreground transition-transform"
                            style={{ width: '12px', height: '12px', opacity: membres.length === 0 ? 0.25 : 1, transform: isOpen ? 'rotate(90deg)' : undefined }}
                          />
                          <span
                            className="inline-block rounded-full shrink-0"
                            style={{ width: '8px', height: '8px', backgroundColor: resolveGroupeColor(g?.couleur) }}
                          />
                          {/* Largeur de base fixe pour que les barres partent toutes du même
                              point ; c'est le nom qui se tronque si la ligne manque de place,
                              la barre gardant sa largeur minimale. */}
                          <span
                            className="flex flex-col text-left"
                            style={{ flex: decompte ? '0 1 64px' : '1 1 0', minWidth: 0 }}
                            title={g?.libelle ?? undefined}
                          >
                            <span className="truncate" style={{ fontSize: '12px' }}>
                              {g?.libelleAbrege || g?.libelle || t('sansGroupe')}
                            </span>
                            {/* Sur téléphone, le décompte passe sous le nom : à sa place, il
                                ne laissait aux barres qu'une poignée de pixels à 390 px. */}
                            {decompte && (
                              <span className="sm:hidden text-muted-foreground tabular-nums whitespace-nowrap" style={{ fontSize: '10px' }}>
                                {decompte.pour}–{decompte.contre}–{decompte.abstentions}
                                <span style={{ opacity: 0.6 }}>–{decompte.aucunVote}</span>
                              </span>
                            )}
                          </span>
                          {/* Un groupe sans position garde sa barre et son décompte, sans
                              pastille : on voit qui a voté sans prêter au groupe une ligne
                              qu'il n'a pas. Seul le seau des élus sans groupe garde le
                              nombre de noms. Décompte et pastille ont une largeur minimale
                              pour que la case des barres soit la même d'une ligne à l'autre :
                              la longueur d'une barre ne doit dire que l'effectif du groupe. */}
                          {decompte ? (
                            <>
                              <ScrutinBarGroupe
                                {...decompte}
                                estMotion={scrutin.typeVoteCode === 'MOC'}
                                echelle={effectifMax > 0 ? effectif(decompte) / effectifMax : 0}
                              />
                              <span className="hidden sm:inline text-muted-foreground tabular-nums shrink-0 text-right" style={{ fontSize: '10px', minWidth: '66px' }}>
                                {decompte.pour}–{decompte.contre}–{decompte.abstentions}
                                <span style={{ opacity: 0.6 }}>–{decompte.aucunVote}</span>
                              </span>
                              <span className="shrink-0 flex justify-end" style={{ minWidth: '68px' }}>
                                {position && <PositionPill position={position} label={positionLabel(position)} />}
                              </span>
                            </>
                          ) : (
                            <span className="text-muted-foreground tabular-nums shrink-0" style={{ fontSize: '10px' }}>
                              {membres.length}
                            </span>
                          )}
                        </button>
                        {/* Les élus d'un groupe replié restent dans le HTML, masqués :
                            sur la page d'un vote, rendue côté serveur, la liste des noms
                            doit être lisible sans ouvrir les groupes, moteurs compris. */}
                        {membres.length > 0 && (
                          <div className="flex flex-col" hidden={!isOpen} style={{ paddingBottom: '6px' }}>
                            {/* Ce seau n'est pas le groupe des non-inscrits (qui a le sien) :
                                ce sont des élus que l'import du scrutin n'a rattachés à
                                aucun groupe ce jour-là (`scrutins.groupes_votants` à null :
                                sénateur sous le code AUCUN, absent de l'Assemblée que
                                l'historique de l'AMO ne place nulle part). Vide au
                                2026-10-27 sur les 567 scrutins à liste nominative. */}
                            {!g && (
                              <p className="text-muted-foreground m-0" style={{ fontSize: '10px', lineHeight: 1.5, padding: '2px 6px 6px' }}>
                                {t('sansGroupeExplication')}
                              </p>
                            )}
                            {membres.map((e) => (
                              <EluRow
                                key={e.uid}
                                elu={e}
                                positionLabel={positionLabel(e.position)}
                                dissident={isDissident(e, g ?? undefined)}
                                dissidentLabel={t('dissident')}
                                lieu={lieuElu(e)}
                              />
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <p className="text-muted-foreground m-0" style={{ fontSize: '10px', lineHeight: 1.5, opacity: 0.85 }}>
                {t('groupeAuJourNote')}
              </p>

              {/* La position affichée n'est pas celle que publie l'Assemblée : LoiClair la
                  recalcule depuis le décompte (D-269). Le dire là où la pastille se lit. Le
                  Sénat n'en publie aucune : sa variante ne parle pas de l'Assemblée. */}
              <p className="text-muted-foreground m-0" style={{ fontSize: '10px', lineHeight: 1.5, opacity: 0.85 }}>
                {chambreKey === 'SEN' || scrutin.chambre === 'Sénat' ? t('methodePositionSenat') : t('methodePosition')}
              </p>

            </section>
          </>
        )}
    </>
  );
}

/**
 * Les sorties d'un vote dans le tiroir, en pastilles sous la carte des groupes : la page du
 * vote (pleine : c'est la suite naturelle) et la page officielle du scrutin (en contour,
 * secondaire). En petits liens au pied des notes de la carte, elles s'y perdaient. La page
 * du vote, elle, porte la source officielle dans son en-tête.
 */
export function LiensVote({ scrutin, chambreKey, lienPage }: { scrutin: ScrutinData; chambreKey: string | null; lienPage: boolean }) {
  const t = useTranslations('scrutinVotes');
  const urlOfficielle = urlScrutinOfficiel(scrutin.uid);
  return (
    <BoutonsPageSource
      page={lienPage ? { href: `/Scrutins/${scrutin.uid}`, libelle: t('ouvrirPage') } : null}
      source={urlOfficielle ? { href: urlOfficielle, libelle: chambreKey === 'SEN' || scrutin.chambre === 'Sénat' ? t('sourceSenat') : t('sourceAN') } : null}
    />
  );
}
