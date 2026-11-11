'use client';

/**
 * Tiroir de détail de la fiche élu. Sept des neuf sections du fil n'affichent
 * qu'un résumé (les premières lignes, les chiffres) ; leur détail complet
 * s'ouvre ici, sans quitter la page ni l'allonger. Les deux autres s'en
 * passent : le score d'activité se déplie sur place, son détail prolongeant la
 * ligne qu'on regarde au lieu d'ouvrir une liste, et le siège tient entier
 * dans sa carte.
 *
 * Il s'appuie sur `components/ui/sheet` (Radix Dialog), qui apporte déjà la
 * fermeture par Échap, le clic sur le voile, le piège de focus et le
 * verrouillage du défilement — tout ce que le prototype avait dû recoder.
 */

import { Fragment, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Info } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AIBadgeTitre } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ParolesTiroir from './ParolesTiroir';
import {
  AmendementRow,
  MandatRow,
  QuestionRow,
  TexteRow,
  TransparenceRow,
  VoteRow,
  type AmendementAdopte,
  type AmendementsParSort,
  type BlocMandats,
  type Dossier,
  type DossierGroup,
  type ParoleTexte,
  type Question,
  type TransparenceElement,
  type VoteNominatif,
  ORDRE_SORTS,
  ORDRE_TRANSPARENCE,
  TITRE_BLOC_MANDATS,
} from './EluRows';

export type DrawerCle = 'votes' | 'paroles' | 'textes' | 'amendements' | 'questions' | 'mandats' | 'transparence';

export default function EluDrawer({
  cle,
  onClose,
  eluUid,
  votes,
  dossierGroups,
  parolesDepuis,
  questions,
  questionsTotal,
  dossiersInities,
  dossiersCoauteur,
  amendements,
  amendementsParSort,
  blocsMandats,
  resumeMandats,
  notesMandats,
  transparence,
  titresTraduits,
}: {
  cle: DrawerCle | null;
  onClose: () => void;
  /** Sert à demander le texte des interventions, et en fragment sur les liens de séance. */
  eluUid: string;
  votes: VoteNominatif[];
  dossierGroups: DossierGroup[];
  /** Date d'où partent les prises de parole, la même que le fil (`debutParoles` dans
   *  `page.tsx`), sinon `null`. */
  parolesDepuis: string | null;
  questions: Question[];
  /** Total exact renvoyé par la vue d'activité, qui dépasse le tableau chargé. */
  questionsTotal: number;
  dossiersInities: Dossier[];
  dossiersCoauteur: Dossier[];
  /** Tous les amendements adoptés de l'élu, du plus récent au plus ancien. */
  amendements: AmendementAdopte[];
  /** Le sort de tous ses amendements, dont le fil ne montre que quatre regroupements. */
  amendementsParSort: AmendementsParSort | null;
  /** Les trois blocs de mandats au complet, le fil n'en montrant que deux, tronqués. */
  blocsMandats: BlocMandats[];
  /** « 1 mandat parlementaire, 3 fonctions et 17 appartenances », composé par le fil. */
  resumeMandats: string;
  /** Réserve du registre et date de ses données, les mêmes que sous la section du fil. */
  notesMandats: React.ReactNode;
  /** Tous les faits de transparence, le fil n'en montrant que quatre par colonne. */
  transparence: TransparenceElement[];
  /** Sections dont un titre est traduit par l'IA, calculées par le fil : le tiroir porte
   *  alors le même badge que la section. */
  titresTraduits: Partial<Record<DrawerCle, boolean>>;
}) {
  const t = useTranslations('elus');
  const locale = useLocale();
  const [votesFilter, setVotesFilter] = useState<'tous' | 'finaux' | 'importants'>('tous');

  // Le texte des interventions n'est demandé qu'à la première ouverture de ce tiroir,
  // et gardé ici : ce composant reste monté, donc le rouvrir ne relance rien. Seul un
  // échec se rejoue, à l'ouverture suivante, comme `ElusActifsSection` ; son message
  // s'efface à la fermeture, et non dans l'effet, où un `setState` ferait un rendu de plus.
  const [parolesTextes, setParolesTextes] = useState<ParoleTexte[] | null>(null);
  const [parolesEchec, setParolesEchec] = useState(false);
  const parolesEnCours = useRef(false);
  useEffect(() => {
    if (cle !== 'paroles' || parolesTextes || parolesEnCours.current) return;
    const dossiers = dossierGroups.flatMap((g) => (g.dossier?.uid ? [g.dossier.uid] : []));
    if (dossiers.length === 0) return;
    parolesEnCours.current = true;
    const parametres = new URLSearchParams({ dossiers: dossiers.join(',') });
    if (parolesDepuis) parametres.set('depuis', parolesDepuis);
    fetch(`/api/elus/${encodeURIComponent(eluUid)}/paroles?${parametres}`)
      .then((r) => (r.ok ? r.json() as Promise<{ interventions: ParoleTexte[] }> : Promise.reject(new Error(String(r.status)))))
      .then((d) => setParolesTextes(d.interventions))
      .catch(() => setParolesEchec(true))
      .finally(() => { parolesEnCours.current = false; });
  }, [cle, parolesTextes, dossierGroups, eluUid, parolesDepuis]);

  // Les trois pastilles comptent ce que comptent les deux barres de présence au-dessus :
  // une motion de censure n'est ni un vote final (elle vise le Gouvernement, pas un
  // texte) ni un vote solennel. Elle reste visible sous « Tous ».
  const finaux = votes.filter((v) => v.dossier_uid != null && v.type_vote_code !== 'MOC');
  const importants = votes.filter((v) => v.type_vote_code === 'SPS');
  const votesVus = votesFilter === 'tous' ? votes : votesFilter === 'finaux' ? finaux : importants;

  const enTeteColonnes = (
    <div
      className="hidden sm:grid"
      style={{
        gridTemplateColumns: '5.5rem 1fr 7rem 5.5rem',
        columnGap: '0.875rem',
        padding: '0 0.625rem 0.4rem',
        borderBottom: '1px solid var(--border)',
      }}
    >
      {[t('votesColDate'), t('votesColTitre'), t('votesColVote'), t('votesColResultat')].map((c) => (
        <span key={c} style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {c}
        </span>
      ))}
    </div>
  );

  const contenu = (): { titre: string; sous: string; corps: React.ReactNode } => {
    if (cle === 'votes') {
      return {
        titre: t('votesTitle'),
        sous: t('drawerVotesDesc', { count: votes.length }),
        corps: (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.125rem' }}>
              {(['tous', 'finaux', 'importants'] as const).map((f) => {
                const labels = {
                  tous: t('votesFilterTous', { count: votes.length }),
                  finaux: t('votesFilterFinaux', { count: finaux.length }),
                  importants: t('votesFilterImportants', { count: importants.length }),
                };
                // « Votes finaux » et « Votes solennels » ne parlent pas d'eux-mêmes :
                // chaque filtre porte la même définition que sa barre de présence.
                const infobulles = {
                  tous: null,
                  finaux: t('tooltipVotesFinaux'),
                  importants: t('tooltipVotesImportants'),
                };
                const actif = votesFilter === f;
                const infobulle = infobulles[f];
                return (
                  <button
                    key={f}
                    onClick={() => setVotesFilter(f)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.3rem 0.875rem',
                      borderRadius: '9999px',
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                      fontWeight: actif ? 600 : 400,
                      backgroundColor: actif ? 'var(--foreground)' : 'transparent',
                      color: actif ? 'var(--background)' : 'var(--muted-foreground)',
                    }}
                  >
                    {labels[f]}
                    {infobulle && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span style={{ display: 'inline-flex', opacity: 0.6 }}>
                            <Info size={12} aria-hidden />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent><p>{infobulle}</p></TooltipContent>
                      </Tooltip>
                    )}
                  </button>
                );
              })}
            </div>
            {votesVus.length > 0 ? (
              <>
                {enTeteColonnes}
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {votesVus.map((v) => <VoteRow key={v.uid} vote={v} avecResultat />)}
                </ul>
              </>
            ) : (
              <p className="elu-empty">{t('drawerVotesEmptyFilter')}</p>
            )}
          </>
        ),
      };
    }

    if (cle === 'paroles') {
      return {
        titre: t('speechesInChamber'),
        sous: t('drawerParolesDesc', { count: dossierGroups.length }),
        corps: dossierGroups.length > 0 ? (
          <>
            {!parolesTextes && (
              <p role="status" style={{ fontSize: '0.75rem', lineHeight: 1.45, color: 'var(--muted-foreground)', margin: '0 0 0.75rem' }}>
                {t(parolesEchec ? 'parolesEchec' : 'parolesChargement')}
              </p>
            )}
            {dossierGroups.map((g) => (
              <ParolesTiroir
                key={g.dossier?.uid ?? '__sans_dossier__'}
                group={g}
                eluUid={eluUid}
                textes={parolesTextes?.filter((l) => l.dossier_uid === g.dossier?.uid) ?? []}
              />
            ))}
          </>
        ) : <p className="elu-empty">{t('emptyParoles')}</p>,
      };
    }

    if (cle === 'textes') {
      return {
        titre: t('dossiersTitleLabel'),
        sous: t('drawerTextesDesc'),
        corps: (dossiersInities.length > 0 || dossiersCoauteur.length > 0) ? (
          <>
            {dossiersInities.length > 0 && (
              <>
                <p className="elu-drawer-intertitre">{t('tabInitiated')}</p>
                {dossiersInities.map((d) => <TexteRow key={d.texte_uid ?? d.uid} dossier={d} />)}
              </>
            )}
            {dossiersCoauteur.length > 0 && (
              <>
                <p className="elu-drawer-intertitre">{t('tabCoauthored')}</p>
                {dossiersCoauteur.map((d) => <TexteRow key={d.texte_uid ?? d.uid} dossier={d} montrerInitiateur />)}
              </>
            )}
          </>
        ) : <p className="elu-empty">{t('emptyTextes')}</p>,
      };
    }

    if (cle === 'amendements') {
      // Rangés sous leur dossier, dans l'ordre où chaque dossier apparaît : celui de
      // l'amendement adopté le plus récent d'abord, puisque la liste arrive triée.
      const parDossier = new Map<string, { dossier: AmendementAdopte['dossier']; lignes: AmendementAdopte[] }>();
      for (const a of amendements) {
        const k = a.dossier?.uid ?? '__sans_dossier__';
        const groupe = parDossier.get(k);
        if (groupe) groupe.lignes.push(a);
        else parDossier.set(k, { dossier: a.dossier, lignes: [a] });
      }
      const nf = new Intl.NumberFormat(locale);
      // Le détail des huit cases, la case « autre » seulement quand elle sert.
      const cases = amendementsParSort
        ? ORDRE_SORTS.filter((c) => c !== 'autre' || amendementsParSort.autre > 0)
        : [];
      return {
        titre: t('amendementsTitle'),
        sous: t('drawerAmendementsDesc', { count: amendements.length }),
        corps: (
          <>
            {amendementsParSort && (
              <>
                <p className="elu-drawer-intertitre">{t('drawerAmendementsSorts')}</p>
                {cases.map((c) => (
                  <div key={c} className="elu-mesure">
                    <span className="elu-mesure-n">{nf.format(amendementsParSort[c])}</span>
                    <span className="elu-mesure-l">{t(`caseSort.${c}` as Parameters<typeof t>[0], { count: amendementsParSort[c] })}</span>
                  </div>
                ))}
              </>
            )}
            <p className="elu-drawer-intertitre">{t('drawerAmendementsAdoptes')}</p>
            {amendements.length > 0 ? (
              [...parDossier.entries()].map(([k, g]) => (
                <div key={k}>
                  <p className="elu-amend-dossier">
                    {g.dossier?.uid ? (
                      <Link href={`/dossiers-legislatifs/${g.dossier.uid}/resume-ia`} prefetch={false} className="hover:underline" style={{ color: 'inherit' }}>
                        {g.dossier.titre ?? t('dossierSansTitre')}
                      </Link>
                    ) : t('unknownDossier')}
                  </p>
                  {g.lignes.map((a) => <AmendementRow key={a.uid} amendement={a} avecDossier={false} />)}
                </div>
              ))
            ) : (
              <p className="elu-empty">{t('aucunAmendementAdopte')}</p>
            )}
          </>
        ),
      };
    }

    if (cle === 'questions') {
      return {
        titre: t('questionsTitle'),
        // Au-delà du plafond de 100 lignes chargées, le sous-titre le dit
        // plutôt que de laisser croire que la liste est complète.
        sous: questionsTotal > questions.length
          ? t('drawerQuestionsDescTronque', { shown: questions.length, total: questionsTotal })
          : t('drawerQuestionsDesc', { count: questions.length }),
        corps: questions.length > 0
          ? questions.map((q) => <QuestionRow key={q.uid} question={q} />)
          : <p className="elu-empty">{t('emptyQuestions')}</p>,
      };
    }

    if (cle === 'transparence') {
      // Mêmes deux sources et mêmes groupes que le fil, dans le même ordre et
      // sans la troncature : le tiroir prolonge la lecture, il ne la réorganise
      // pas. Les colonnes du fil deviennent ici deux blocs successifs, la
      // largeur du tiroir ne les portant pas côte à côte.
      const bloc = (titreSource: string, garde: (e: TransparenceElement) => boolean) => {
        const lignesSource = transparence.filter(garde);
        if (lignesSource.length === 0) return null;
        return (
          <div>
            <p className="elu-drawer-intertitre">{titreSource}</p>
            {ORDRE_TRANSPARENCE.map((categorie) => {
              const lignes = lignesSource.filter((e) => e.categorie === categorie);
              if (lignes.length === 0) return null;
              return (
                <div key={categorie}>
                  <p className="elu-groupe-titre">
                    {t(`transparenceGroupe.${categorie}` as Parameters<typeof t>[0])}
                  </p>
                  {lignes.map((e) => (
                    <TransparenceRow key={`${e.source}-${e.identifiant}`} element={e} />
                  ))}
                </div>
              );
            })}
          </div>
        );
      };
      const auSenat = transparence.some((e) => e.source.startsWith('senat'));
      return {
        titre: t('transparenceTitle'),
        sous: t('drawerTransparenceDesc', { count: transparence.length }),
        corps: (
          <>
            {bloc(t('transparenceSourceHatvp'), (e) => e.source === 'hatvp')}
            {bloc(
              t(auSenat ? 'transparenceSourceSenat' : 'transparenceSourceAn'),
              (e) => e.source !== 'hatvp',
            )}
          </>
        ),
      };
    }

    return {
      titre: t('mandatsTitle'),
      sous: resumeMandats,
      // Des fragments et non des blocs : `.elu-drawer-intertitre:first-child`
      // annule la marge haute, que chaque intertitre perdrait dans son propre div.
      corps: (
        <>
          {blocsMandats.map((bloc) => (
            <Fragment key={bloc.cle}>
              <p className="elu-drawer-intertitre">{t(TITRE_BLOC_MANDATS[bloc.cle])}</p>
              {bloc.lignes.map((m) => <MandatRow key={m.id} mandat={m} />)}
            </Fragment>
          ))}
          {notesMandats}
        </>
      ),
    };
  };

  const { titre, sous, corps } = contenu();

  return (
    <Sheet open={cle !== null} onOpenChange={(ouvert) => { if (!ouvert) { setParolesEchec(false); onClose(); } }}>
      <SheetContent side="right" size="content" className="w-full sm:max-w-[720px] gap-0 p-0 sm:p-0 md:p-0">
        <SheetHeader className="border-b px-5 py-5 pr-14 sm:px-7">
          <SheetTitle style={{ fontSize: '1.125rem', letterSpacing: '-0.02em' }}>
            {titre}
            {cle !== null && titresTraduits[cle] && <span style={{ marginLeft: '8px', verticalAlign: '2px' }}><AIBadgeTitre pluriel /></span>}
          </SheetTitle>
          <SheetDescription style={{ fontSize: '0.8125rem', maxWidth: '56ch', lineHeight: 1.55 }}>{sous}</SheetDescription>
        </SheetHeader>
        {/* `elu-drawer-corps` lève les troncatures que le fil impose pour aligner
            ses deux colonnes : ici il n'y en a qu'une, et c'est le texte complet
            qu'on vient lire. */}
        <div className="elu-drawer-corps flex-1 overflow-y-auto px-5 pb-16 pt-4 sm:px-7">{corps}</div>
      </SheetContent>
    </Sheet>
  );
}
