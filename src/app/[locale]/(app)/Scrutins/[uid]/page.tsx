// Page d'un vote, `/Scrutins/[uid]` : Server Component qui donne une adresse au détail
// d'un scrutin (position de chaque groupe, vote de chaque élu). C'est elle que partage le
// tiroir de la fiche d'un texte, et vers elle que mènent la fiche d'un élu, le fil
// Actualité, la newsletter et le quiz d'affinité.
//
// Seuls les scrutins à liste nominative (`scrutins.votes_nominatifs`) ont une page : les
// autres (surtout des amendements de l'Assemblée) rendent 404, comme `/api/scrutin-votes`.
// Le corps est `SectionsVote`, le même que celui du tiroir (résultat, dissidents, groupes),
// rendu ici avec des votes déjà lus côté serveur : les noms sont dans le HTML. La page y
// ajoute les autres votes du même texte, et son image de partage (`api/og/scrutin`).

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CalendarDays, Route, type LucideIcon } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import { cheminDebats, contexteDuVote, dateDuVote, friseDuVote, lireActe, lireParcours, lireScrutin, nomEtape, type ActeLigne, type ScrutinLigne } from '@/lib/vote-page';
import PageHero, { type PageHeroMetaRow } from '@/components/PageHero';
import { estUidScrutin } from '@/lib/uid-fiches';
import { chargerVotesScrutin } from '@/lib/scrutin-votes';
import { droiteDuDossier } from '@/lib/auteur-dossier';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { LECTURE_KEY_BY_MILESTONE, milestoneOf } from '@/lib/legislative-steps';
import ContacterMesElusBanner from '@/components/ContacterMesElusBanner';
import { deriveChambreKey, estMotionRejet, statutDuVote, urlScrutinOfficiel } from '@/lib/scrutin-affichage';
import { buildAlternates, buildOpenGraph, ogImageScrutinUrl } from '@/lib/og-metadata';
import { buildShareUrl } from '@/lib/share-url';
import { AIBadge } from '../../dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import type { ScrutinData } from '../../dossiers-legislatifs/[uid]/resume-ia/ResumeIAClient';
import { BadgeStatut } from './ResultatVote';
import SectionsVote from './SectionsVote';
import AutresVotes from './AutresVotes';
import FriseVote from './FriseVote';
import SectionRepliable from '@/components/SectionRepliable';

// Même régime que les autres fiches : générée à la première visite, gardée 24 h, et
// marquée par `/api/revalidate` à la fin du run de nuit.
export const revalidate = 86400;
export const dynamic = 'force-static';
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

// Clé `localStorage` des sections repliées de la page d'un vote, propre à elle :
// partagée avec une autre fiche, une section de même nom s'y replierait aussi.
const CLE_PLI = 'vote-fiche-plie';

/** Pictogramme d'un surtitre de section, au format de ceux de la fiche du texte
 *  (`IconeSection` de `SectionsDossier.tsx`). */
function Icone({ de: I }: { de: LucideIcon }) {
  return <I size={14} strokeWidth={1.5} aria-hidden style={{ flex: 'none', color: 'var(--muted-foreground)' }} />;
}

/** Intitulé officiel du vote. Les chambres l'écrivent comme la fin d'une phrase
 *  (« l'ensemble de la proposition de loi… ») : seule la majuscule initiale s'ajoute,
 *  comme sur la fiche d'un élu (`VoteRow`). */
function intitule(s: { titre: string | null; titre_en: string | null }, locale: string): string {
  const titre = titreDossier(s, locale);
  return titre.charAt(0).toUpperCase() + titre.slice(1);
}

type AutreVote = {
  uid: string;
  titre: string | null;
  titre_en: string | null;
  date_scrutin: string | null;
  sort_libelle: string | null;
  code_acte: string;
  statut_conclusion: string | null;
};

/** Les autres votes du même texte qui ont une page : ceux qu'un acte de décision du
 *  dossier cite et qui ont une liste nominative, du plus ancien au plus récent. Un vote
 *  cité par deux actes ne sort qu'une fois, sous le plus récent. */
async function lireAutresVotes(dossierUid: string, uid: string): Promise<AutreVote[]> {
  const lignes = await sql<AutreVote[]>`
    select s.uid, s.titre, s.titre_en, s.date_scrutin, s.sort_libelle, a.code_acte, a.statut_conclusion
    from actes_legislatifs a
    join scrutins s on s.uid = any(a.vote_refs)
    where a.dossier_uid = ${dossierUid} and a.date_acte is not null
      and s.votes_nominatifs is not null and s.uid <> ${uid}
    order by s.date_scrutin, s.uid, a.date_acte desc, a.uid desc`;
  const vus = new Set<string>();
  return lignes.filter((l) => milestoneOf(l.code_acte) && !vus.has(l.uid) && vus.add(l.uid));
}

/**
 * Ce que le vote décidait, en clé de traduction, ou `null` quand on ne sait pas le dire.
 * Lu dans l'intitulé officiel (en français, quelle que soit la langue de la page) et le
 * type de vote. Une motion de rejet d'abord : son intitulé parle aussi du texte entier, et
 * voter « pour » y veut dire voter contre le texte, ce que le lecteur doit savoir avant de
 * lire les chiffres.
 */
function sensDuVote(titre: string | null, typeVoteCode: string | null):
  'sensMotionCensure' | 'sensMotionRejet' | 'sensConfiance' | 'sensDeclaration' | 'sensEnsemble' | null {
  const t = titre ?? '';
  if (typeVoteCode === 'MOC') return 'sensMotionCensure';
  if (estMotionRejet(t)) return 'sensMotionRejet';
  if (/politique générale|49, alinéa premier/i.test(t)) return 'sensConfiance';
  if (/50-1/.test(t)) return 'sensDeclaration';
  // Trois apostrophes : droite, typographique (dix intitulés de l'Assemblée au 2026-11-08,
  // dont l'aide à mourir) et le `\u0092` que le Sénat écrit parfois (`estMotionRejet`).
  if (/l['’\u0092]ensemble/i.test(t)) return 'sensEnsemble';
  return null;
}

/** Le titre de la page : celui du texte voté, plus parlant que l'intitulé officiel du
 *  scrutin, qui passe dessous. Sans dossier (déclaration du Gouvernement), l'intitulé. */
function titreDePage(s: ScrutinLigne, dossier: ActeLigne | null, locale: string): string {
  const duTexte = dossier ? titreDossier({ titre: dossier.dossier_titre, titre_en: dossier.dossier_titre_en }, locale) : '';
  return duTexte || intitule(s, locale);
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; uid: string }> }): Promise<Metadata> {
  const { locale, uid } = await params;
  if (!estUidScrutin(uid)) notFound();
  setRequestLocale(locale);
  const [s, { decision, dossier }] = await Promise.all([lireScrutin(uid), lireActe(uid)]);
  if (!s) notFound();
  const t = await getTranslations({ locale, namespace: 'scrutinVotes' });
  const date = s.date_scrutin ? dateDuVote(locale, s.date_scrutin) : '';
  // Un texte compte souvent plusieurs votes : la date distingue leurs onglets et leurs
  // résultats de recherche, qui porteraient sinon le même titre.
  const titre = titreDePage(s, dossier, locale) || t('title');
  const title = `${dossier && date ? t('metaTitreVote', { titre, date }) : titre} — LoiClair`;
  // Le statut du badge et de l'image de partage, pas le sort brut du scrutin : une motion
  // de rejet adoptée y est « Rejeté » (le texte), et l'aperçu ne doit pas dire l'inverse.
  const sort = contexteDuVote(uid, s, decision).statut;
  const description = t('pageMetaDescription', {
    resultat: sort === 'Adopté' ? 'adopte' : sort === 'Rejeté' ? 'rejete' : 'autre',
    chambre: uid.startsWith('VTSN') ? 'sen' : 'an',
    // Une motion de censure ne recense que les voix favorables : « 0 contre » ne mesurerait rien.
    motion: s.type_vote_code === 'MOC' ? 'oui' : 'non',
    date,
    pour: s.synthese_pour ?? 0,
    contre: s.synthese_contre ?? 0,
  });
  return {
    title,
    description,
    alternates: buildAlternates(locale, `/Scrutins/${uid}`),
    // Une image propre au vote (hémicycle, résultat, chiffres), sans son titre, que les
    // réseaux affichent déjà dessous : c'est la raison de l'image commune ailleurs (D-302).
    openGraph: buildOpenGraph(locale, `/Scrutins/${uid}`, title, description, ogImageScrutinUrl(locale, uid)),
  };
}

export default async function ScrutinPage({ params }: { params: Promise<{ locale: string; uid: string }> }) {
  const { locale, uid } = await params;
  if (!estUidScrutin(uid)) notFound();
  setRequestLocale(locale);

  const [s, { decision, dossier }, votes, t, tResume, tSteps] = await Promise.all([
    lireScrutin(uid),
    lireActe(uid),
    chargerVotesScrutin(uid),
    getTranslations({ locale, namespace: 'scrutinVotes' }),
    getTranslations({ locale, namespace: 'resumeIA' }),
    getTranslations({ locale, namespace: 'steps' }),
  ]);
  if (!s || !votes) notFound();

  // Chambre, statut et étape : les règles partagées avec l'image de partage (`vote-page.ts`).
  const { chambreKey, statut, milestone } = contexteDuVote(uid, s, decision);
  const libelleStatut = (v: string | null) => (v === 'Adopté' ? tResume('adopted') : v === 'Rejeté' ? tResume('rejected') : v);
  const statutLabel = libelleStatut(statut);

  const scrutin: ScrutinData = {
    uid,
    sortLibelle: s.sort_libelle ?? '',
    type: s.type_vote_libelle ?? '',
    typeVoteCode: s.type_vote_code ?? null,
    pour: s.synthese_pour ?? 0,
    contre: s.synthese_contre ?? 0,
    abstentions: s.synthese_abstentions ?? 0,
    votants: s.synthese_nombre_votants ?? 0,
    nonVotants: s.synthese_non_votants ?? 0,
    suffragesRequis: s.synthese_suffrages_requis ?? 0,
    date: s.date_scrutin ?? decision?.date_acte ?? '',
    chambre: s.chambre ?? null,
  };

  // Étape du parcours, nommée comme sur la frise de la fiche du texte.
  const traduireEtape = (m: string | null, chambre: string | null) =>
    nomEtape(m, chambre, (k) => tSteps(k as Parameters<typeof tSteps>[0]), (k) => tResume(k as Parameters<typeof tResume>[0]));
  const etape = traduireEtape(milestone, chambreKey);
  const date = scrutin.date ? dateDuVote(locale, scrutin.date) : null;

  // Où le vote a eu lieu, pour la pastille d'un vote sans étape.
  const voteChambre = chambreKey === 'SEN' ? tResume('decisionLabelVoteSenat') : tResume('decisionLabelVoteAN');

  // À droite du bandeau, l'auteur du texte (ou le Gouvernement), comme sur sa fiche. Sous
  // le résultat, les autres votes du même texte.
  const [debats, parcours, droite, autresVotes] = dossier?.dossier_uid
    ? await Promise.all([
      cheminDebats(dossier.dossier_uid, uid, s.date_scrutin),
      lireParcours(dossier.dossier_uid),
      droiteDuDossier(dossier.dossier_uid),
      lireAutresVotes(dossier.dossier_uid, uid),
    ])
    : [null, [], null, [] as AutreVote[]];
  const frise = friseDuVote(parcours, milestone);

  // Une seule ligne de méta, toujours visible : sur téléphone, le hero replie les
  // suivantes derrière « Plus de détails ». Elle finit par le lien vers le texte voté.
  const meta: PageHeroMetaRow[] = [{
    icon: <CalendarDays className="h-3 w-3" />,
    label: t('pageMetaLabel'),
    // Le statut, à ses couleurs comme dans la carte du résultat : le lecteur qui arrive
    // par un lien sait dès le bandeau si le vote est passé.
    trailing: <BadgeStatut statut={statut} statutLabel={statutLabel} />,
    pills: [
      // La frise nomme déjà l'étape. Sans frise, la pastille ; sans étape (déclaration du
      // Gouvernement), la chambre : le bandeau dit toujours où le vote a eu lieu.
      ...[frise ? null : etape ?? voteChambre, date]
        .filter((x): x is string => !!x).map((x) => ({ children: x })),
      ...(dossier?.dossier_uid
        ? [{ children: t('pageVoirTexteBadge'), href: `/dossiers-legislatifs/${dossier.dossier_uid}/resume-ia`, internal: true }]
        : []),
      ...(debats ? [{ children: t('pageLireDebats'), href: debats, internal: true }] : []),
      // La page officielle du scrutin, ouverte dans un nouvel onglet (pastille externe).
      ...(urlScrutinOfficiel(uid)
        ? [{ children: chambreKey === 'SEN' ? t('sourceSenat') : t('sourceAN'), href: urlScrutinOfficiel(uid) }]
        : []),
    ],
  }];

  // La liste nominative sous la forme de `scrutins.votes_nominatifs`, pour le bandeau
  // des élus, qui y cherche la position de chacun.
  const votesParPosition: Record<string, string[]> = {};
  for (const e of votes.elus) (votesParPosition[e.position] ??= []).push(e.uid);

  const sens = sensDuVote(s.titre, s.type_vote_code);
  const dossierTitre = dossier ? titreDossier({ titre: dossier.dossier_titre, titre_en: dossier.dossier_titre_en }, locale) : '';
  const titrePage = titreDePage(s, dossier, locale) || t('title');

  return (
    <>
      <PageHero
        // Le vote se range sous son texte : « Tous les textes › Dossier LoiClair › Vote ».
        // Un vote sans dossier (déclaration du Gouvernement) saute le maillon du milieu.
        breadcrumb={[
          { label: tResume('allTexts'), href: '/dossiers-legislatifs' },
          ...(dossier?.dossier_uid ? [{ label: tResume('dossierLabel'), href: `/dossiers-legislatifs/${dossier.dossier_uid}/resume-ia` }] : []),
          { label: t('pageBreadcrumb') },
        ]}
        title={titrePage}
        // Sous le titre du texte, l'intitulé officiel du vote. Traduit, il porte le badge
        // court et le titre officiel en français, comme sur la fiche du texte. Sans
        // dossier, l'intitulé est déjà le titre : seul le titre officiel peut suivre.
        lede={dossierTitre || titreTraduit(s, locale) ? (
          <>
            {dossierTitre && <span className="block">{intitule(s, locale)}</span>}
            {titreTraduit(s, locale) && (
              <span className="block" style={{ marginTop: dossierTitre ? '4px' : 0 }}>
                <AIBadge usage="titres" court surBandeau infobulle={tResume('titreTraduitInfobulle')} />{' '}
                {tResume('titreOfficiel', { titre: s.titre ?? '' })}
              </span>
            )}
          </>
        ) : undefined}
        parcours={frise ? (
          <FriseVote
            etapes={frise.map((e) => ({
              code: e.code,
              // Seul le vote porte son nom complet : la ligne doit tenir sur un écran. En CMP,
              // il dit aussi la chambre, comme la pastille qu'il remplace, et sous la même
              // forme que les autres lectures pour que le nom tienne à 390 px.
              nom: t((e.code !== milestone ? `friseCourt.${e.code}` : e.code === 'CMP' ? `friseNom.CMP_${chambreKey}` : `friseNom.${e.code}`) as Parameters<typeof t>[0]),
              done: e.done,
              vote: e.code === milestone,
            }))}
            statut={statut}
            ceVote={t('friseCeVote')}
            libelle={t('friseLibelle')}
          />
        ) : undefined}
        meta={meta}
        // Le pied reprend celui de la fiche du texte : le bandeau de mes élus, qui dit
        // comment ils ont voté ici ou propose de les retrouver. Il ne vient qu'avec un
        // dossier, dont le courriel aux élus a besoin pour dire de quel texte il parle.
        // À droite, l'auteur du texte ou le Gouvernement (`droiteDuDossier`). Un élu de
        // l'autre chambre n'a pas voté ici, et sa bulle le dit (`chambreDuVote`).
        footer={dossier?.dossier_uid && dossierTitre ? (
          <ContacterMesElusBanner
            dossier={{ uid: dossier.dossier_uid, titre: dossier.dossier_titre, statut: null }}
            scrutins={[{
              uid,
              date_scrutin: s.date_scrutin,
              sort_code: s.sort_code,
              chambre: s.chambre,
              type_vote_code: s.type_vote_code,
              titre: s.titre,
              votes_nominatifs: votesParPosition,
              lectureKey: milestone ? LECTURE_KEY_BY_MILESTONE[milestone] ?? null : null,
            }]}
            droite={droite}
            chambreDuVote={uid.startsWith('VTSN') ? 'SN' : 'AN'}
          />
        ) : undefined}
        shareUrl={buildShareUrl(locale, `/Scrutins/${uid}`)}
      />
      <div className="container mx-auto max-w-[90rem]" style={{ paddingTop: '1.5rem', paddingBottom: '2.5rem' }}>
        {/* Toute la largeur du conteneur, comme la fiche du texte. */}
        <div>
          {/* Sections dans la forme de celles de la fiche du texte : surtitre en
              capitales, repli mémorisé dans le navigateur, une carte chacune, sauf pour une
              section qui n'a rien à lister. Les trois
              premières sont celles du tiroir (`SectionsVote`) ; les autres votes du texte
              n'appartiennent qu'à la page. L'étape est déjà dans le bandeau. */}
          <SectionsVote
            scrutin={scrutin}
            chambreKey={chambreKey}
            statut={statut}
            statutLabel={statutLabel}
            votes={votes}
            status="idle"
            sens={sens ? t(sens) : null}
            cleStockage={CLE_PLI}
            // Toujours présente, comme les sections de la fiche du texte : vide, une phrase le
            // dit (la presse fait de même), sans carte. Un vote sans dossier n'a pas de texte.
            apres={(
              <SectionRepliable cle="autres" cleStockage={CLE_PLI} icone={<Icone de={Route} />} titre={t('sectionAutresVotes')}>
                {autresVotes.length === 0 ? (
                  <p className="text-sm text-muted-foreground m-0">{t(dossier?.dossier_uid ? 'autresVotesAucun' : 'autresVotesSansTexte')}</p>
                ) : <AutresVotes
                  accroche={t('autresVotesAccroche', { count: autresVotes.length })}
                  votes={autresVotes.map((v) => {
                    const st = statutDuVote(v.titre, v.sort_libelle, v.statut_conclusion, true);
                    return {
                      uid: v.uid,
                      intitule: intitule(v, locale),
                      etape: traduireEtape(milestoneOf(v.code_acte), deriveChambreKey(v.code_acte)),
                      date: v.date_scrutin ? dateDuVote(locale, v.date_scrutin) : null,
                      statut: st,
                      statutLabel: libelleStatut(st),
                    };
                  })}
                />}
              </SectionRepliable>
            )}
          />
        </div>
      </div>
    </>
  );
}
