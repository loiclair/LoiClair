'use client';

/**
 * Un dossier dans le tiroir « Ses prises de parole » de la fiche élu (`EluDrawer`) :
 * son en-tête, puis ses séances, chacune avec le texte des interventions de l'élu et
 * un seul lien vers son compte rendu. Une ligne par intervention répétait ce lien des
 * dizaines de fois.
 *
 * `textes` : les interventions du dossier, lues par `EluDrawer` à l'ouverture. Tant
 * qu'elles manquent (chargement, échec), les séances s'affichent quand même d'après
 * les lignes de la fiche : le lecteur garde les liens vers les comptes rendus.
 *
 * Le texte reste en français sur /en, tel que publié par les chambres : `lang="fr"`
 * le dit aux lecteurs d'écran.
 */

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { fragmentElu, seanceVersSlug } from '../../dossiers-legislatifs/[uid]/debats/seance-slug';
import { ParoleEntete, formatDateCourte, type DossierGroup, type ParoleTexte } from './EluRows';

const INTERVENTIONS_INITIALES = 10;
const INTERVENTIONS_PAR_LOT = 20;

// Environ 7 lignes à 390 px. L'extrait se coupe par longueur et non par `line-clamp` :
// le rendu est le même dans Safari et Chrome, sans mesurer de hauteur.
const LONGUEUR_EXTRAIT = 320;
// Un texte à peine plus long que l'extrait s'affiche entier : un « Lire la suite »
// pour trois mots coûterait un geste de plus que de les montrer.
const MARGE_EXTRAIT = 80;

const boutonTexte: React.CSSProperties = {
  background: 'none',
  border: 0,
  cursor: 'pointer',
  padding: '0.25rem 0',
  fontSize: '0.8125rem',
  fontWeight: 500,
  color: 'var(--primary)',
};

/** Le début du texte coupé au dernier mot entier, ou `null` s'il s'affiche en entier. */
function extraitDe(texte: string): string | null {
  if (texte.length <= LONGUEUR_EXTRAIT + MARGE_EXTRAIT) return null;
  const coupe = texte.lastIndexOf(' ', LONGUEUR_EXTRAIT);
  return texte.slice(0, coupe > 0 ? coupe : LONGUEUR_EXTRAIT).trimEnd();
}

/**
 * Lit la colonne `article` des comptes rendus, écrite sous des dizaines de formes
 * (`3`, `Après_ 1er`, `Après_13`, `après l’article 13`, `Après Après l’article 2`,
 * `Après art.28`, `Article 2`, `Avant_ article unique`, relevées en base le 2026-11-05).
 * Une forme qui ne désigne pas un article nommé ainsi (`Titre`, `nonies A`) se rend
 * telle quelle, sans ses `_`.
 */
function lireArticle(brut: string): { cle: 'parolesArticle' | 'parolesApresArticle' | 'parolesAvantArticle'; article: string } | string | null {
  const propre = brut.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /^(après|avant)? ?(?:après )?(?:l[’']article |article |art\. ?)?(.*)$/i.exec(propre);
  const reste = m?.[2] ?? '';
  if (reste === '') return null;
  if (!/^(\d|unique|premier|liminaire)/i.test(reste)) return propre;
  const position = m?.[1]?.toLowerCase();
  return {
    cle: position === 'après' ? 'parolesApresArticle' : position === 'avant' ? 'parolesAvantArticle' : 'parolesArticle',
    article: reste,
  };
}

/**
 * Lit la colonne `amendement` des comptes rendus : un numéro (`603`, `603 rectifié`) ou
 * une liste (`1870, 1872`, `12 et 13`, 1 336 lignes le 2026-11-05). Huit lignes y gardent
 * un `&#10;` de la source, qui s'afficherait tel quel.
 */
function lireAmendement(brut: string): { cle: 'amendementNumero' | 'parolesAmendements'; numero: string } | null {
  const numero = brut.replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
  if (numero === '') return null;
  return { cle: /,| et /.test(numero) ? 'parolesAmendements' : 'amendementNumero', numero };
}

/** Une intervention : ce qui était discuté s'il est connu, puis le texte, en extrait s'il est long. */
function Intervention({ ligne }: { ligne: ParoleTexte }) {
  const t = useTranslations('elus');
  const [deplie, setDeplie] = useState(false);
  const bloc = useRef<HTMLLIElement>(null);

  const extrait = extraitDe(ligne.texte);
  const article = ligne.article ? lireArticle(ligne.article) : null;
  const amendement = ligne.amendement ? lireAmendement(ligne.amendement) : null;
  const sujet = [
    typeof article === 'string' ? article : article && t(article.cle, { article: article.article }),
    amendement && t(amendement.cle, { numero: amendement.numero }),
  ].filter(Boolean).join(' · ');

  return (
    <li ref={bloc} style={{ marginTop: '0.75rem' }}>
      {sujet && (
        <span style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500, color: 'var(--muted-foreground)', marginBottom: '0.2rem' }}>
          {sujet}
        </span>
      )}
      <p lang="fr" style={{ margin: 0, fontSize: '0.875rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', color: 'var(--foreground)' }}>
        {deplie || !extrait ? ligne.texte : `${extrait}…`}
      </p>
      {extrait && (
        <button
          type="button"
          aria-expanded={deplie}
          style={boutonTexte}
          onClick={() => {
            setDeplie(!deplie);
            // Replier un long texte laisserait le lecteur plus bas, dans l'intervention
            // suivante : on le ramène au début de celle qu'il vient de refermer.
            if (deplie) requestAnimationFrame(() => bloc.current?.scrollIntoView({ block: 'nearest' }));
          }}
        >
          {t(deplie ? 'reduire' : 'lireLaSuite')}
        </button>
      )}
    </li>
  );
}

export default function ParolesTiroir({ group, eluUid, textes }: {
  group: DossierGroup;
  /** Posé en fragment sur les liens de séance, pour n'y montrer que cet élu. */
  eluUid: string;
  textes: ParoleTexte[];
}) {
  const t = useTranslations('elus');
  const locale = useLocale();
  const [visibles, setVisibles] = useState(INTERVENTIONS_INITIALES);

  // Une `Map` garde l'ordre de première apparition, et non un regroupement par
  // voisinage : deux séances du même jour s'entremêlent dans le tri des interventions,
  // qui départage par `ordre` et non par séance.
  const parSeance = new Map<string, { uid: string; date: string | null; nombre: number; lignes: ParoleTexte[] }>();
  if (textes.length > 0) {
    for (const l of textes) {
      const s = parSeance.get(l.seance_uid);
      if (s) { s.nombre++; s.lignes.push(l); }
      else parSeance.set(l.seance_uid, { uid: l.seance_uid, date: l.date_seance, nombre: 1, lignes: [l] });
    }
  } else {
    for (const iv of group.interventions) {
      if (!iv.seance?.uid) continue;
      const s = parSeance.get(iv.seance.uid);
      if (s) s.nombre++;
      else parSeance.set(iv.seance.uid, { uid: iv.seance.uid, date: iv.seance.date_seance, nombre: 1, lignes: [] });
    }
  }

  // Le plafond se répartit séance par séance dans l'ordre d'affichage. Sans texte chargé,
  // toutes les séances restent : il n'y a que leurs liens, rien à plafonner.
  let reste = visibles;
  const seances = [...parSeance.values()].flatMap((s) => {
    if (textes.length > 0 && reste <= 0) return [];
    const lignes = s.lignes.slice(0, reste);
    reste -= lignes.length;
    return [{ ...s, lignes }];
  });

  return (
    <div className="elu-row">
      <ParoleEntete group={group} nombre={textes.length || group.interventions.length} lienDossier={null} />

      {seances.map((s) => (
        <div
          key={s.uid}
          style={{ borderTop: '1px solid var(--border)', padding: '0.7rem 0 0.7rem 1rem', marginTop: '0.7rem', fontSize: '0.8125rem', lineHeight: 1.55, color: 'var(--card-foreground)' }}
        >
          <span style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--muted-foreground)', marginBottom: '0.2rem' }}>
            {formatDateCourte(s.date, locale)} · {t('interventionCount', { count: s.nombre })}
          </span>
          {s.lignes.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 0.75rem' }}>
              {s.lignes.map((l) => <Intervention key={l.id} ligne={l} />)}
            </ul>
          )}
          {group.dossier?.uid && (
            <Link
              href={`/dossiers-legislatifs/${group.dossier.uid}/debats/${seanceVersSlug(s.uid)}${fragmentElu(eluUid)}`}
              prefetch={false}
              className="hover:underline"
              style={{ color: 'var(--primary)' }}
            >
              {t('lireSeance')}
            </Link>
          )}
        </div>
      ))}

      {textes.length > visibles && (
        <button
          type="button"
          style={{ ...boutonTexte, display: 'block', marginTop: '0.25rem' }}
          onClick={() => setVisibles(visibles + INTERVENTIONS_PAR_LOT)}
        >
          {t('voirSuivantes')}
        </button>
      )}

      {group.dossier?.uid && (
        <Link
          href={`/dossiers-legislatifs/${group.dossier.uid}/debats`}
          prefetch={false}
          className="hover:underline"
          style={{ display: 'inline-block', marginTop: '0.75rem', fontSize: '0.8125rem', fontWeight: 500, color: 'var(--primary)' }}
        >
          {t('viewFullDebate')}
        </Link>
      )}
    </div>
  );
}
