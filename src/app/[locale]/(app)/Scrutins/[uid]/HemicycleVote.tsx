'use client';

// Hémicycle de la page d'un vote : un point par siège du vrai plan, coloré par la position
// de l'élu qui y est rangé. Monté par `SectionsVote` en tête de la section « Le résultat »,
// sur la page du vote comme dans le tiroir, à côté de la carte des chiffres, dont les
// couleurs disent ce que valent celles des points.
//
// Survoler un point (ou le toucher, sur téléphone) ouvre une bulle : nom, groupe, vote de
// l'élu. Un clic l'épingle, avec un lien vers sa fiche. Le point visé se cherche au plus
// près du pointeur, sur tout le dessin, plutôt que sur chaque cercle : les points font 2 à
// 3 px de rayon sur un téléphone, trop peu pour un doigt.
//
// Les places des points arrivent toutes calculées (`lib/hemicycle.ts`) : ce composant ne
// fait que les colorer et les dessiner.

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ECHELLE_HEMICYCLE, type PointHemicycle } from '@/lib/hemicycle';
import { SCRUTIN_COLORS } from '../../dossiers-legislatifs/[uid]/resume-ia/ScrutinScore';

// Teinte d'un point. Ceux qui n'ont pas voté (absents, institutionnels, et sur une motion
// de censure les « non recensés ») prennent le reste neutre, qui suit le thème : un gris
// mêlé au fond, comme le segment neutre de la barre. `color-mix` en style et non en classe,
// pour Safari (`ARCHITECTURE.md` §Pièges Tailwind v4 sur Safari).
const NEUTRE = 'color-mix(in oklab, var(--muted-foreground) 32%, var(--background))';
function couleurPosition(position: string): string {
  if (position === 'pour') return SCRUTIN_COLORS.pour;
  if (position === 'contre') return SCRUTIN_COLORS.contre;
  if (position === 'abstentions') return SCRUTIN_COLORS.abstentions;
  if (position === 'nonVotants') return SCRUTIN_COLORS.nonVotants;
  return NEUTRE;
}

// Libellé de chaque position dans la bulle, dans le namespace `elus`, comme les pastilles
// de la liste des élus (`ScrutinVotesDetail`).
const LIBELLE_POSITION: Record<string, string> = {
  pour: 'votePositionPour',
  contre: 'votePositionContre',
  abstentions: 'votePositionAbstention',
  nonVotants: 'votePositionNonVotant',
  institutionnels: 'votePositionInstitutionnel',
  absents: 'votePositionAbsent',
};

// Cadre du dessin : le plan normalisé tient dans un demi-cercle de rayon
// `ECHELLE_HEMICYCLE` ; une marge de 3 % garde entiers les points du bord.
const MARGE = ECHELLE_HEMICYCLE * 0.03;
const X0 = -ECHELLE_HEMICYCLE - MARGE;
const Y0 = -ECHELLE_HEMICYCLE - MARGE;
const LARGEUR = 2 * (ECHELLE_HEMICYCLE + MARGE);
const HAUTEUR = ECHELLE_HEMICYCLE + 2 * MARGE;
const VIEWBOX = `${X0} ${Y0} ${LARGEUR} ${HAUTEUR}`;
// Au-delà de cette distance (en unités du dessin), le pointeur ne vise aucun point.
const PORTEE = 4;

export default function HemicycleVote({ points, rayon, motion, ariaLabel, chargement = false }: {
  points: PointHemicycle[];
  rayon: number;
  /** Motion de censure : « absent » s'y dit « non recensé », comme dans la liste. */
  motion: boolean;
  /** Ce que montre le dessin, en toutes lettres, pour les lecteurs d'écran. */
  ariaLabel: string;
  /** Squelette du tiroir pendant le chargement (`planVide`) : sièges pleins en gris pâle
   *  qui pulsent, sans survol ni note. Le dessin prend sa place définitive d'emblée, et
   *  la carte des chiffres en dessous ne saute pas quand les votes arrivent. */
  chargement?: boolean;
}) {
  const t = useTranslations('scrutinVotes');
  const tElus = useTranslations('elus');
  const svgRef = useRef<SVGSVGElement>(null);
  const [survol, setSurvol] = useState<number | null>(null);
  const [epingle, setEpingle] = useState<number | null>(null);
  const actif = epingle ?? survol;

  // Le point occupé le plus proche du pointeur, en coordonnées du dessin, ou `null`.
  const viser = useCallback((e: { clientX: number; clientY: number }): number | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let meilleur: number | null = null;
    let distance = PORTEE;
    points.forEach((pt, i) => {
      if (!pt.elu) return;
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < distance) { distance = d; meilleur = i; }
    });
    return meilleur;
  }, [points]);

  const libellePosition = (position: string) => {
    if (position === 'absents' && motion) return tElus('votePositionNonRecense');
    const cle = LIBELLE_POSITION[position];
    return cle ? tElus(cle as Parameters<typeof tElus>[0]) : position;
  };

  const point = actif !== null ? points[actif] : null;
  // La bulle se pose au-dessus du point ; près d'un bord, elle s'aligne sur lui pour ne
  // pas sortir du cadre.
  const gauche = point ? ((point.x - X0) / LARGEUR) * 100 : 0;
  const haut = point ? ((point.y - Y0) / HAUTEUR) * 100 : 0;
  const decalage = gauche < 22 ? '0%' : gauche > 78 ? '-100%' : '-50%';

  return (
    <figure className="m-0 flex flex-col items-center" style={{ gap: '8px' }}>
      <div className="relative w-full" style={{ maxWidth: '40rem' }}>
        <svg
          ref={svgRef}
          viewBox={VIEWBOX}
          role="img"
          aria-label={ariaLabel}
          className={chargement ? 'animate-pulse' : undefined}
          style={{ width: '100%', height: 'auto', display: 'block', cursor: survol !== null ? 'pointer' : 'default', touchAction: 'manipulation' }}
          onPointerMove={(e) => { if (!chargement && e.pointerType === 'mouse') setSurvol(viser(e)); }}
          onPointerLeave={() => setSurvol(null)}
          onClick={(e) => {
            if (chargement) return;
            const i = viser(e);
            setEpingle(i === epingle ? null : i);
          }}
        >
          {/* Un siège que personne n'occupe dans ce vote (vacant, ou sénateur que la liste
              ne nomme pas) reste dessiné en creux : le plan garde sa forme. */}
          {points.map((p, i) => (p.position || chargement
            ? <circle key={i} cx={p.x} cy={p.y} r={rayon} style={{ fill: p.position ? couleurPosition(p.position) : NEUTRE }} />
            : <circle key={i} cx={p.x} cy={p.y} r={rayon * 0.8} style={{ fill: 'none', stroke: NEUTRE, strokeWidth: rayon * 0.35 }} />
          ))}
          {point && (
            <circle cx={point.x} cy={point.y} r={rayon * 1.9} style={{ fill: 'none', stroke: 'var(--foreground)', strokeWidth: rayon * 0.45 }} />
          )}
        </svg>
        {point?.elu && point.position && (
          <div
            className="absolute rounded-lg border"
            style={{
              left: `${gauche}%`,
              top: `${haut}%`,
              transform: `translate(${decalage}, calc(-100% - 10px))`,
              backgroundColor: 'var(--popover)',
              color: 'var(--popover-foreground)',
              padding: '8px 10px',
              boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
              whiteSpace: 'nowrap',
              zIndex: 2,
              // Une bulle de survol ne doit pas voler le pointeur ; épinglée, elle porte
              // un lien.
              pointerEvents: epingle !== null ? 'auto' : 'none',
            }}
          >
            <p className="m-0" style={{ fontSize: '13px', fontWeight: 600, lineHeight: 1.35 }}>{point.elu.nom}</p>
            <p className="m-0 text-muted-foreground" style={{ fontSize: '12px', lineHeight: 1.35 }}>
              {point.elu.groupe && <>{point.elu.groupe} · </>}
              <span style={{ color: point.position === 'pour' || point.position === 'contre' ? couleurPosition(point.position) : undefined, fontWeight: 600 }}>
                {libellePosition(point.position)}
              </span>
            </p>
            {epingle !== null && (
              <Link href={`/les-elus/${point.elu.uid}`} prefetch={false} className="text-primary hover:underline" style={{ fontSize: '12px', fontWeight: 500 }}>
                {t('hemicycleVoirFiche')}
              </Link>
            )}
          </div>
        )}
      </div>
      {/* Pendant le chargement, la note garde sa hauteur sans encore se lire. */}
      <figcaption className="text-muted-foreground" style={{ fontSize: '10px', lineHeight: 1.5, textAlign: 'center', visibility: chargement ? 'hidden' : 'visible' }}>
        {t('hemicycleNote')}
      </figcaption>
    </figure>
  );
}
