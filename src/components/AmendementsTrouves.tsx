'use client';

// Les amendements et votes trouvés par une recherche, rangés sous leur texte dans la liste
// de /dossiers-legislatifs (`DossiersResultsClient`, seul appelant, LOI-83). Deux lignes
// d'abord, puis « Voir les N autres » déplie sur place, par lots.
//
// Une ligne par élément, sur le modèle des « Autres votes sur ce texte » de la page d'un
// vote (`Scrutins/[uid]/AutresVotes.tsx`) : point vert adopté, rouge rejeté, intitulé en
// couleur au survol.
//   - un amendement adopté : numéro et article, auteur, chambre et séance ou commission,
//     puis le résumé de l'IA (badge IA) ou le début du dispositif ; mène à sa page ;
//   - un vote sur un amendement : l'intitulé du scrutin, sa date et son sort ; mène à la
//     page du vote.
// Toute la ligne est cliquable par un lien étiré (`span` en `inset: 0` dans le lien) : le
// badge IA est lui-même un lien, qui ne peut pas entrer dans un autre, et passe au-dessus.
// Survol par état React et coupe à deux lignes en style en ligne, plutôt qu'en classes
// Tailwind : voir ARCHITECTURE.md §Pièges Tailwind v4 sur Safari.

import { useState, type CSSProperties } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { AIBadge } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements';
import { SCRUTIN_COLORS } from '@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/ScrutinScore';
import { titreDossier } from '@/lib/titre-dossier';
import type { AmendementIndex, AmendementMeta, VoteAmendementMeta } from '@/lib/search/amendement-index';

/** Lignes montrées sous un texte avant le premier clic. */
const PREMIERES = 2;
/** Lignes ajoutées par clic : un budget peut en trouver des centaines. */
const LOT = 20;

const DEUX_LIGNES: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

/** Le squelette commun aux deux sortes de ligne : point, intitulé lien, puis ce qui suit. */
function Ligne({ href, adopte, intitule, children }: { href: string; adopte: boolean; intitule: string; children: React.ReactNode }) {
  const [survol, setSurvol] = useState(false);
  const couleur = adopte ? SCRUTIN_COLORS.pour : SCRUTIN_COLORS.contre;
  return (
    <li
      className="flex items-start"
      style={{
        position: 'relative',
        gap: '10px',
        padding: '6px 12px',
        borderRadius: '8px',
        backgroundColor: survol ? 'var(--muted)' : 'transparent',
        transition: 'background-color 0.15s ease',
        WebkitTransition: 'background-color 0.15s ease',
      }}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
    >
      <span aria-hidden className="shrink-0" style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: couleur, marginTop: '7px' }} />
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          prefetch={false}
          className="text-sm font-medium"
          style={{ ...DEUX_LIGNES, color: survol ? 'var(--primary)' : 'var(--foreground)', transition: 'color 0.15s ease', WebkitTransition: 'color 0.15s ease', textDecoration: 'none' }}
        >
          {intitule}
          <span aria-hidden style={{ position: 'absolute', inset: 0 }} />
        </Link>
        {children}
      </div>
    </li>
  );
}

/** Morceaux d'une ligne de métadonnées, séparés d'un point médian ; le sort en couleur. */
function Meta({ morceaux, sort, adopte }: { morceaux: string[]; sort: string; adopte: boolean }) {
  return (
    <div className="flex flex-wrap items-center text-xs text-muted-foreground" style={{ gap: '4px', marginTop: '2px' }}>
      {morceaux.map((m, i) => (
        <span key={i} className="inline-flex items-center" style={{ gap: '4px' }}>
          {i > 0 && <span aria-hidden style={{ opacity: 0.4 }}>·</span>}
          {m}
        </span>
      ))}
      <span aria-hidden style={{ opacity: 0.4 }}>·</span>
      <span style={{ color: adopte ? SCRUTIN_COLORS.pour : SCRUTIN_COLORS.contre, fontWeight: 600 }}>{sort}</span>
    </div>
  );
}

/** Un formateur par langue pour toute la liste : construit dans chaque ligne, il
 *  apparaissait dans le profil du rendu (Chrome, 2026-11-20). */
const FORMATS_DATE = new Map<string, Intl.DateTimeFormat>();
function dateLongue(locale: string, jour: string): string {
  let f = FORMATS_DATE.get(locale);
  if (!f) FORMATS_DATE.set(locale, (f = new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'Europe/Paris' })));
  return f.format(new Date(jour));
}

export default function AmendementsTrouves({ uids, index }: { uids: string[]; index: AmendementIndex }) {
  const t = useTranslations('dossiers');
  const locale = useLocale();
  const [nombre, setNombre] = useState(PREMIERES);

  const ligneAmendement = (a: AmendementMeta) => {
    const extrait = index.extraits.get(a.uid);
    const resume = (locale === 'en' ? extrait?.resume_en : extrait?.resume_fr) || null;
    const auteur = a.auteur_type === 'gouvernement' ? t('amendementGouvernement') : a.auteur;
    const morceaux = [
      auteur,
      t(a.chambre === 'SN' ? 'amendementSenat' : 'amendementAssemblee'),
      t(a.lieu === 'commission' ? 'amendementCommission' : 'amendementSeance'),
    ].filter((m): m is string => !!m);
    return (
      <Ligne
        key={a.uid}
        href={`/Amendements/${a.uid}`}
        adopte
        intitule={[t('amendementTitre', { numero: a.numero }), a.article].filter(Boolean).join(' · ')}
      >
        <Meta morceaux={morceaux} sort={t('amendementAdopte')} adopte />
        {(resume || extrait?.dispositif) && (
          <p className="text-xs text-muted-foreground m-0" style={{ ...DEUX_LIGNES, marginTop: '4px', lineHeight: 1.5 }}>
            {resume && (
              // Au-dessus du lien étiré de la ligne : le badge mène aux instructions de l'IA.
              <span style={{ position: 'relative', zIndex: 1, marginRight: '6px', verticalAlign: 'middle' }}>
                <AIBadge usage="concerne" court />
              </span>
            )}
            {resume ?? extrait?.dispositif}
          </p>
        )}
      </Ligne>
    );
  };

  const ligneVote = (v: VoteAmendementMeta) => {
    // Comme l'intitulé de la page du vote : la phrase de la chambre, majuscule initiale.
    const titre = titreDossier(v, locale);
    const date = v.date ? dateLongue(locale, v.date) : null;
    return (
      <Ligne key={v.uid} href={`/Scrutins/${v.uid}`} adopte={v.adopte} intitule={titre.charAt(0).toUpperCase() + titre.slice(1)}>
        <Meta
          morceaux={[t('voteScrutinPublic'), date].filter((m): m is string => !!m)}
          sort={t(v.adopte ? 'amendementAdopte' : 'amendementRejete')}
          adopte={v.adopte}
        />
      </Ligne>
    );
  };

  const reste = uids.length - nombre;
  return (
    <div style={{ padding: '0 4px' }}>
      <ul aria-label={t('amendementsTrouves')} className="m-0 p-0" style={{ listStyle: 'none' }}>
        {uids.slice(0, nombre).map((uid) => {
          const el = index.elements.get(uid);
          if (!el) return null;
          return el.genre === 'amendement' ? ligneAmendement(el.meta) : ligneVote(el.meta);
        })}
      </ul>
      {reste > 0 && (
        <button
          type="button"
          onClick={() => setNombre((n) => n + LOT)}
          style={{ border: 'none', background: 'none', padding: '4px 12px 0 28px', color: 'var(--primary)', fontSize: '0.8125rem', fontWeight: 500, cursor: 'pointer' }}
        >
          {reste <= LOT ? t('amendementsVoirAutres', { count: reste }) : t('amendementsVoirSuivants', { lot: LOT, count: reste })}
        </button>
      )}
    </div>
  );
}
