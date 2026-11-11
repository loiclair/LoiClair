// Page d'un amendement adopté, `/Amendements/[uid]` : Server Component qui donne une adresse
// à ce que dit l'amendement, à son auteur et, quand un scrutin public l'a tranché, à son
// vote. C'est elle que partagent les tiroirs de la fiche du texte (`AmendementSheet`) et de
// « Ce qui me concerne », et vers elle que mènent ces deux listes et la fiche d'un élu.
//
// Le corps est `SectionsAmendement`, le même que celui des tiroirs. Les 31 561 adoptés ont
// une page, mais seuls ceux de séance entrent au sitemap (`app/sitemap.ts`). Un amendement
// tranché par un scrutin public a l'image de partage d'un vote (`api/og/amendement`) ; les
// autres, sans aucun chiffre à montrer, gardent l'image commune (D-302).

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import PageHero, { type PageHeroMetaRow } from '@/components/PageHero';
import ContacterMesElusBanner from '@/components/ContacterMesElusBanner';
import { LienTexte, LignesEntete, articleEnEntier } from '@/components/EnteteElement';
import { chargerDetailAmendement, lireAmendement } from '@/lib/amendement-page';
import { chargerAuteur, droiteBandeau } from '@/lib/auteur-dossier';
import { buildAlternates, buildOpenGraph, ogImageAmendementUrl } from '@/lib/og-metadata';
import { amendementsAvecVote } from '@/lib/scrutin-votes';
import { buildShareUrl } from '@/lib/share-url';
import { titreDossier } from '@/lib/titre-dossier';
import { estUidAmendement } from '@/lib/uid-fiches';
import { dateDuVote } from '@/lib/vote-page';
import { seanceVersSlug } from '../../dossiers-legislatifs/[uid]/debats/seance-slug';
import SectionsAmendement from './SectionsAmendement';

// Même régime que la page d'un vote : générée à la première visite, gardée 24 h, et marquée
// par `/api/revalidate` à la fin du run de nuit.
export const revalidate = 86400;
export const dynamic = 'force-static';
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

// Clé `localStorage` des sections repliées, propre à cette page (voir `SectionRepliable`).
const CLE_PLI = 'amendement-fiche-plie';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; uid: string }> }): Promise<Metadata> {
  const { locale, uid } = await params;
  if (!estUidAmendement(uid)) notFound();
  setRequestLocale(locale);
  // Le vote ne se teste que par sa présence, une lecture sur l'index des uids : charger le
  // vote entier, noms des élus compris, ne servirait qu'à choisir l'image.
  const [a, avecVote] = await Promise.all([lireAmendement(uid), amendementsAvecVote([uid])]);
  if (!a) notFound();
  const t = await getTranslations({ locale, namespace: 'amendementPage' });
  const texte = titreDossier({ titre: a.dossier_titre, titre_en: a.dossier_titre_en }, locale);
  const date = a.date_amendement ? dateDuVote(locale, a.date_amendement) : '';
  const nom = t('nom', { numero: a.numero });
  const title = t('metaTitre', { nom, texte, date, avecDate: date ? 'oui' : 'non' });
  const description = t('metaDescription', {
    nom,
    texte,
    lieu: a.lieu,
    chambre: a.chambre === 'SN' ? 'sen' : 'an',
  });
  const chemin = `/Amendements/${uid}`;
  return {
    title,
    description,
    alternates: buildAlternates(locale, chemin),
    openGraph: buildOpenGraph(locale, chemin, title, description,
      avecVote.has(uid) ? ogImageAmendementUrl(locale, uid) : undefined),
  };
}

export default async function AmendementPage({ params }: { params: Promise<{ locale: string; uid: string }> }) {
  const { locale, uid } = await params;
  if (!estUidAmendement(uid)) notFound();
  setRequestLocale(locale);

  const a = await lireAmendement(uid);
  if (!a) notFound();

  const auteurBrutP = a.auteur_uid ? chargerAuteur(a.auteur_uid) : Promise.resolve(null);
  const [detail, auteurBrut, t, tResume] = await Promise.all([
    chargerDetailAmendement(a, locale),
    auteurBrutP,
    getTranslations({ locale, namespace: 'amendementPage' }),
    getTranslations({ locale, namespace: 'resumeIA' }),
  ]);

  const dossierHref = `/dossiers-legislatifs/${a.dossier_uid}/resume-ia`;
  const titreTexte = titreDossier({ titre: a.dossier_titre, titre_en: a.dossier_titre_en }, locale);
  const nom = t('nom', { numero: a.numero });
  const date = a.date_amendement ? dateDuVote(locale, a.date_amendement) : null;
  const { debats } = detail;
  const seanceCiblee = debats.length === 1 ? `/debats/${seanceVersSlug(debats[0].seance_uid)}` : '/debats';

  const meta: PageHeroMetaRow[] = [{
    icon: <CalendarDays className="h-3 w-3" />,
    label: t('metaLabel'),
    pills: [
      ...(date ? [{ children: date }] : []),
      ...(debats.length > 0 ? [{ children: t('lireDebats'), href: `/dossiers-legislatifs/${a.dossier_uid}${seanceCiblee}`, internal: true }] : []),
      { children: a.chambre === 'SN' ? t('sourceSenat') : t('sourceAN'), href: a.url },
    ],
  }];

  // Le bandeau cherche la position de chaque élu dans cette liste, au format de
  // `scrutins.votes_nominatifs` ; sans vote, il propose simplement de retrouver ses élus.
  const votesParPosition: Record<string, string[]> = {};
  for (const e of detail.vote?.votes.elus ?? []) (votesParPosition[e.position] ??= []).push(e.uid);

  return (
    <>
      <PageHero
        breadcrumb={[
          { label: tResume('allTexts'), href: '/dossiers-legislatifs' },
          { label: tResume('dossierLabel'), href: dossierHref },
          { label: t('fil') },
        ]}
        title={a.article ? `${nom} · ${articleEnEntier(a.article)}` : nom}
        lede={
          <LignesEntete
            etiquetteTexte={t('enteteTexte')}
            texte={titreTexte ? <LienTexte texte={{ uid: a.dossier_uid, titre: titreTexte, traduit: detail.titre_traduit }} /> : null}
            etats={[
              ...(detail.etat_texte ? [{
                etiquette: t('enteteEtatTexte'),
                statut: detail.etat_texte.statut,
                libelle: detail.etat_texte.libelle,
                complement: detail.etat_texte.date && t('statutLe', { date: detail.etat_texte.date }),
              }] : []),
              {
                etiquette: t('enteteEtatAmendement'),
                statut: 'Adopté',
                libelle: tResume('adopted'),
                complement: t(a.lieu === 'seance' ? 'complementSeance' : 'complementCommission', { chambre: tResume(a.chambre === 'AN' ? 'assemblee' : 'senat') }),
              },
            ]}
          />
        }
        meta={meta}
        footer={titreTexte ? (
          <ContacterMesElusBanner
            dossier={{ uid: a.dossier_uid, titre: a.dossier_titre, statut: null }}
            scrutins={detail.vote ? [{
              uid: detail.vote.uid,
              date_scrutin: detail.vote.date_scrutin,
              sort_code: 'adopté',
              chambre: detail.vote.chambre === 'SN' ? 'Sénat' : 'Assemblée Nationale',
              type_vote_code: null,
              titre: detail.vote.titre,
              votes_nominatifs: votesParPosition,
              lectureKey: null,
            }] : []}
            droite={droiteBandeau(a.auteur_type === 'gouvernement', auteurBrut)}
            chambreDuVote={a.chambre}
            titresDroite={{ joignable: t('ecrireAuteur'), sansContact: t('auteurSansContact') }}
          />
        ) : undefined}
        shareUrl={buildShareUrl(locale, `/Amendements/${uid}`)}
      />
      <div className="container mx-auto max-w-[90rem]" style={{ paddingTop: '1.5rem', paddingBottom: '2.5rem' }}>
        <div>
          <SectionsAmendement detail={detail} status="idle" cleStockage={CLE_PLI} />
        </div>
      </div>
    </>
  );
}
