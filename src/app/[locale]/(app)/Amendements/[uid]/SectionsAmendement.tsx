'use client';

// Les sections d'un amendement adopté, les mêmes partout : sa page (`page.tsx`), son tiroir
// sur la fiche du texte (`AmendementSheet`) et son tiroir dans « Ce qui me concerne »
// (`CorpsTiroirAmendement`). Résumé de l'IA ou, à défaut, texte officiel ; exposé des motifs,
// auteur, vote, débats, autres amendements de l'article. Les tiroirs, plus étroits, les
// prennent en `compact`, comme `SectionsVote`.
//
// Avec un résumé, le texte officiel se lit par le lien de source, en bas du résumé. Sans
// résumé (environ 90 % des amendements), la section le dit et donne le texte officiel.
//
// Une section vide le dit par une phrase, sous son titre et sans carte. Le détail du vote
// n'existe que pour environ 6 % des amendements adoptés : les autres gardent les mêmes
// sections de vote, avec le seul résultat connu (adopté) et une phrase qui dit pourquoi le
// reste manque, sans affirmer une main levée qu'aucune source ne prouve.
//
// Ce qui vient de l'IA et ce qui est officiel se distinguent au premier regard : le résumé
// porte le badge IA et le cadre doré, l'exposé le badge « Source officielle ».

import { useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { FileText, Landmark, Lightbulb, List, MessagesSquare, Rows3, ScrollText, UserRound, UserX, Users, Vote } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { BadgeSource, BoutonsPageSource } from '@/components/LiensSource';
import PhotoEluVignette from '@/components/PhotoEluVignette';
import TexteOfficiel from '@/components/TexteOfficiel';
import SectionRepliable from '@/components/SectionRepliable';
import type { AutreAmendement, DetailAmendement } from '@/lib/amendement-page';
import { seanceVersSlug } from '../../dossiers-legislatifs/[uid]/debats/seance-slug';
import { AI_FRAME_STYLE, AI_INNER_STYLE, AIBadge, AICardFooter } from '../../dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import type { ScrutinData } from '../../dossiers-legislatifs/[uid]/resume-ia/ResumeIAClient';
import { BadgeStatut } from '../../Scrutins/[uid]/ResultatVote';
import SectionsVote, { IconeSection } from '../../Scrutins/[uid]/SectionsVote';

/** Le vote au format que lit `SectionsVote`. */
function scrutinDuVote(v: NonNullable<DetailAmendement['vote']>): ScrutinData {
  return {
    uid: v.uid,
    sortLibelle: 'adopté',
    type: 'scrutin public',
    typeVoteCode: null,
    pour: v.pour,
    contre: v.contre,
    abstentions: v.abstentions,
    votants: v.votants,
    nonVotants: v.non_votants,
    suffragesRequis: v.suffrages_requis,
    date: v.date_scrutin ?? '',
    chambre: v.chambre === 'SN' ? 'Sénat' : 'Assemblée Nationale',
  };
}

/** Les autres amendements adoptés sur l'article : les premiers viennent avec la page, le
 *  reste à la demande, car un article de budget en compte jusqu'à 1 027 et chaque page reste
 *  en cache sur le disque. */
function AutresAmendements({ uid, premiers, total }: { uid: string; premiers: AutreAmendement[]; total: number }) {
  const t = useTranslations('amendementPage');
  const tResume = useTranslations('resumeIA');
  const [tous, setTous] = useState<AutreAmendement[] | null>(null);
  const [etat, setEtat] = useState<'idle' | 'loading' | 'error'>('idle');
  const liste = tous ?? premiers;
  const reste = total - liste.length;

  const voirPlus = () => {
    setEtat('loading');
    fetch(`/api/amendements/${encodeURIComponent(uid)}/autres`)
      .then((r) => (r.ok ? r.json() as Promise<AutreAmendement[]> : Promise.reject(new Error(String(r.status)))))
      .then((d) => { setTous(d); setEtat('idle'); })
      .catch(() => setEtat('error'));
  };

  return (
    <>
      <ul className="flex flex-col" style={{ gap: '6px' }}>
        {liste.map((x) => (
          <li key={x.uid} className="text-sm">
            <Link href={`/Amendements/${x.uid}`} prefetch={false} className="text-primary hover:underline">{t('nom', { numero: x.numero })}</Link>
            <span className="text-muted-foreground">{' · '}{t(x.lieu === 'seance' ? 'adopteSeance' : 'adopteCommission', { chambre: tResume(x.chambre === 'AN' ? 'assemblee' : 'senat') })}</span>
          </li>
        ))}
      </ul>
      {reste > 0 && (
        <button
          type="button"
          onClick={voirPlus}
          disabled={etat === 'loading'}
          className="text-sm text-primary hover:underline"
          style={{ background: 'none', border: 0, padding: 0, marginTop: '10px', cursor: 'pointer' }}
        >
          {t(etat === 'loading' ? 'autresChargement' : 'autresVoirPlus', { n: reste })}
        </button>
      )}
      {etat === 'error' && <p role="status" className="text-xs text-muted-foreground m-0" style={{ marginTop: '6px' }}>{t('autresErreur')}</p>}
    </>
  );
}

export default function SectionsAmendement({ detail, status, cleStockage, compact = false, lienPage = false, auteurContenu, apresAuteur }: {
  /** `null` tant que le tiroir charge ; la page l'a toujours. */
  detail: DetailAmendement | null;
  status: 'idle' | 'loading' | 'error';
  cleStockage: string;
  compact?: boolean;
  /** Dans les tiroirs : les boutons vers la page et vers la source officielle, en bas. */
  lienPage?: boolean;
  /** Remplace le contenu de « Qui l'a déposé » : les tiroirs y ajoutent « Écrire ». */
  auteurContenu?: ReactNode;
  /** Juste sous « Qui l'a déposé » : « Mes élus » dans les tiroirs, les deux façons d'écrire côte à côte. */
  apresAuteur?: ReactNode;
}) {
  const t = useTranslations('amendementPage');
  const tResume = useTranslations('resumeIA');
  const tVote = useTranslations('scrutinVotes');
  const locale = useLocale();

  if (!detail) {
    return (
      <p role="status" className="text-sm text-muted-foreground m-0" style={{ padding: '8px 0' }}>
        {t(status === 'error' ? 'erreur' : 'chargement')}
      </p>
    );
  }

  const { auteur, vote, debats, autres } = detail;
  const elu = auteur.elus[0];
  // Chaque citation sous les profils qu'elle concerne. Tous les profils de l'amendement :
  // la page est la même pour tous les lecteurs.
  const parProfil = detail.profils.length > 0 && (
    <div className="flex flex-col" style={{ gap: '10px', marginTop: '12px' }}>
      {detail.profils.map((g) => (
        <div key={g.noms.join()}>
          <p className="text-xs m-0" style={{ fontWeight: 600, lineHeight: 1.5 }}>{t('concerneProfils', { profils: g.noms.join(' · ') })}</p>
          {g.passage && (
            <p className="text-xs text-muted-foreground m-0" style={{ marginTop: '2px', lineHeight: 1.5, overflowWrap: 'anywhere' }}>
              {t('passageCite', { passage: g.passage })}
            </p>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <>
      {/* Avec un résumé, le cadre doré des synthèses de la fiche du texte, et le texte officiel
          derrière son lien. Sans résumé, le texte officiel prend la place. */}
      {detail.resume ? (
        <SectionRepliable
          cle="resume"
          cleStockage={cleStockage}
          icone={<IconeSection de={FileText} />}
          titre={t('sectionResume')}
          badge={<AIBadge usage="concerne" />}
        >
          <div style={{ ...AI_FRAME_STYLE, overflow: 'hidden' }}>
            <div style={{ ...AI_INNER_STYLE, padding: compact ? '16px 18px' : '20px 24px' }}>
              <p className="text-sm m-0" style={{ lineHeight: 1.6 }}>{detail.resume}</p>
              {parProfil}
              <AICardFooter>
                <a href={detail.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline font-medium">
                  {t('sourceResume')} →
                </a>
              </AICardFooter>
            </div>
          </div>
        </SectionRepliable>
      ) : (
        <SectionRepliable cle="texte" cleStockage={cleStockage} icone={<IconeSection de={ScrollText} />} titre={t('texteOfficiel')} carte>
          <div className="flex flex-col" style={{ gap: '12px' }}>
            <p className="text-sm text-muted-foreground m-0">{t('sansResume')}</p>
            {detail.dispositif
              ? <TexteOfficiel cadre={compact}>{detail.dispositif}</TexteOfficiel>
              : <p className="text-sm text-muted-foreground m-0">{t('sansTexte')}</p>}
            {locale !== 'fr' && detail.dispositif && <p className="text-xs text-muted-foreground m-0">{t('mentionFrancais')}</p>}
            {parProfil}
            <a href={detail.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline font-medium">
              {t('sourceResume')} →
            </a>
          </div>
        </SectionRepliable>
      )}

      <SectionRepliable
        cle="motifs"
        cleStockage={cleStockage}
        icone={<IconeSection de={Lightbulb} />}
        titre={t('sectionMotifs')}
        badge={<BadgeSource href={detail.url}>{t('badgeExpose')}</BadgeSource>}
        carte={!!detail.expose}
      >
        {detail.expose
          ? <TexteOfficiel cadre={compact}>{detail.expose}</TexteOfficiel>
          : <p className="text-sm text-muted-foreground m-0">{t('sansExpose')}</p>}
      </SectionRepliable>

      <SectionRepliable cle="auteur" cleStockage={cleStockage} icone={<IconeSection de={UserRound} />} titre={t('sectionAuteur')} carte={!!auteurContenu || !!elu || auteur.type === 'gouvernement' || !!auteur.libelle}>
        {auteurContenu ?? (elu ? (
          <div className="flex items-center" style={{ gap: '10px' }}>
            <PhotoEluVignette acteur={{ ...elu, url_profil_officiel: elu.url_profil_officiel ?? null }} taille={32} ancien={elu.ancien} />
            <div className="min-w-0">
              <Link href={`/les-elus/${elu.uid}`} className="text-sm text-primary hover:underline" style={{ fontWeight: 500 }}>
                {`${elu.prenom ?? ''} ${elu.nom ?? ''}`.trim()}
              </Link>
              <p className="text-xs text-muted-foreground m-0">
                {auteur.type === 'rapporteur' ? t('auteurRapporteur') : elu.groupe ?? ''}
              </p>
            </div>
          </div>
        ) : auteur.type === 'gouvernement' ? (
          <div className="flex items-center" style={{ gap: '8px' }}>
            <Landmark size={16} strokeWidth={1.5} aria-hidden className="text-muted-foreground" />
            <p className="text-sm m-0">{t('auteurGouvernement')}</p>
          </div>
        ) : auteur.libelle ? (
          <div className="flex items-center" style={{ gap: '8px' }}>
            <Users size={16} strokeWidth={1.5} aria-hidden className="text-muted-foreground" />
            <p className="text-sm m-0">{auteur.libelle}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground m-0">{t('sansAuteur')}</p>
        ))}
      </SectionRepliable>

      {apresAuteur}

      {vote ? (
        <SectionsVote
          scrutin={scrutinDuVote(vote)}
          chambreKey={vote.chambre === 'SN' ? 'SEN' : 'AN'}
          statut="Adopté"
          statutLabel={tResume('adopted')}
          votes={vote.votes}
          status="idle"
          sens={t(detail.portee)}
          cleStockage={cleStockage}
          compact={compact}
        />
      ) : (
        <>
          <SectionRepliable cle="resultat" cleStockage={cleStockage} icone={<IconeSection de={Vote} />} titre={tVote('sectionResultat')} carte>
            <div className="flex flex-col items-start" style={{ gap: '10px' }}>
              <BadgeStatut statut="Adopté" statutLabel={tResume('adopted')} />
              <p className="text-sm m-0" style={{ lineHeight: 1.5 }}>{t(detail.portee)}</p>
              <p className="text-sm text-muted-foreground m-0" style={{ lineHeight: 1.5 }}>
                {t(detail.lieu === 'commission' ? 'voteCommission' : 'voteSeance')}
              </p>
            </div>
          </SectionRepliable>
          <SectionRepliable cle="dissidents" cleStockage={cleStockage} icone={<IconeSection de={UserX} />} titre={tVote('sectionDissidents')}>
            <p className="text-sm text-muted-foreground m-0" style={{ lineHeight: 1.5 }}>{t('sansDetailVote')}</p>
          </SectionRepliable>
          <SectionRepliable cle="groupes" cleStockage={cleStockage} icone={<IconeSection de={List} />} titre={tVote('groupsTitle')}>
            <p className="text-sm text-muted-foreground m-0" style={{ lineHeight: 1.5 }}>{t('sansDetailVote')}</p>
          </SectionRepliable>
        </>
      )}

      <SectionRepliable cle="debats" cleStockage={cleStockage} icone={<IconeSection de={MessagesSquare} />} titre={t('sectionDebats')} carte={debats.length > 0}>
        {debats.length === 0 ? (
          <p className="text-sm text-muted-foreground m-0">{t(detail.chambre === 'AN' && detail.lieu === 'seance' ? 'debatsAucun' : 'debatsNonRapproches')}</p>
        ) : (
          <ul className="flex flex-col" style={{ gap: '6px' }}>
            {debats.map((d) => (
              <li key={d.seance_uid} className="text-sm">
                <Link href={`/dossiers-legislatifs/${detail.dossier_uid}/debats/${seanceVersSlug(d.seance_uid)}`} prefetch={false} className="text-primary hover:underline">
                  {d.date ?? t('seanceSansDate')}
                </Link>
                <span className="text-muted-foreground">{' · '}{t('interventions', { count: d.nb })}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionRepliable>

      <SectionRepliable cle="autres" cleStockage={cleStockage} icone={<IconeSection de={Rows3} />} titre={t('sectionAutres')} carte={autres.total > 0}>
        {autres.total === 0
          ? <p className="text-sm text-muted-foreground m-0">{t(detail.article ? 'autresAucun' : 'autresSansArticle')}</p>
          // La clé : un même tiroir sert à plusieurs amendements, la liste dépliée d'un
          // amendement ne doit pas rester affichée pour le suivant.
          : <AutresAmendements key={detail.uid} uid={detail.uid} premiers={autres.liste} total={autres.total} />}
      </SectionRepliable>

      {lienPage && <BoutonsPageSource page={{ href: `/Amendements/${detail.uid}`, libelle: t('voirPage') }} source={{ href: detail.url, libelle: t('badgeSource') }} />}
    </>
  );
}
