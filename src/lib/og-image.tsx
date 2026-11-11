// Gabarit de l'image de partage (Open Graph) du site, une par langue. Mesures en
// pixels d'une image de 1200 × 630, reprises de la maquette v9 adoptée par Alex le
// 2026-10-27, sans ses images propres à chaque page (retirées le 2026-10-28).
//
// Rendu par `ImageResponse` (Satori), qui n'est pas un navigateur : flexbox
// partout, `rgba()` au lieu de `color-mix()`, interlettrage en pixels. Appelé par
// `src/app/api/og/route.tsx` ; `CaseLcCoin` sert aussi aux images des quiz,
// `CaseLcNomCoin` à celles d'un vote et d'un amendement (`lib/og-vote.tsx`).

import LogoLc from '@/components/LogoLc';

export const OG_TAILLE = { width: 1200, height: 630 };

// Couleurs du kit de marque Lc (session identite-lc) : fond et trait de la vague.
const FOND = '#00babb';
const TRAIT = '#00787d';

// Tracé de la vague : part du coin bas gauche et traverse l'image.
const VAGUE_D =
  'M-40,650 C180,650 360,560 520,480 C640,420 700,392 780,392 C880,392 960,470 1050,470 C1120,470 1170,440 1240,405';

/**
 * La case Lc en haut à gauche des images des quiz, sur le résultat comme sur
 * l'image de secours. Le parent doit être en `position: relative`.
 */
export function CaseLcCoin() {
  return (
    <div style={{ position: 'absolute', top: 48, left: 56, display: 'flex' }}>
      <LogoLc taille={64} style={{ color: TRAIT }} />
    </div>
  );
}

/**
 * La case Lc suivie du nom, en haut à gauche des images d'un vote et d'un amendement
 * (`lib/og-vote.tsx`), comme l'image commune écrit le nom à côté de sa case : la case
 * seule ne nommait pas le site. Proportions de l'image commune (nom à 90 % de la case,
 * même écart relatif), à la couleur de la case. Le parent doit être en `position: relative`.
 */
export function CaseLcNomCoin() {
  return (
    <div style={{ position: 'absolute', top: 48, left: 56, display: 'flex', alignItems: 'center', gap: 15 }}>
      <LogoLc taille={64} style={{ color: TRAIT }} />
      <span style={{ fontSize: 58, fontWeight: 700, letterSpacing: -2, lineHeight: 1, color: TRAIT }}>LoiClair</span>
    </div>
  );
}

function Vague() {
  return (
    <svg
      width={OG_TAILLE.width}
      height={OG_TAILLE.height}
      viewBox="0 0 1200 630"
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <path
        d={VAGUE_D}
        fill="none"
        stroke={TRAIT}
        strokeWidth="46"
        strokeLinecap="round"
      />
    </svg>
  );
}

const cadre: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  position: 'relative',
  backgroundColor: FOND,
  color: '#fff',
  fontFamily: 'IBM Plex Sans',
  lineHeight: 1.3,
};

/**
 * L'image de toutes les pages d'une langue : case Lc et nom, la
 * tagline officielle (D-007) sur deux lignes, puis l'offre en trois éléments dans
 * un voile clair que la vague traverse.
 */
export function imageGenerique({ tagline, offre }: { tagline: string[]; offre: string[] }) {
  return (
    <div style={cadre}>
      <Vague />
      <div
        style={{
          position: 'absolute',
          left: 80,
          top: 84,
          display: 'flex',
          alignItems: 'center',
          gap: 27,
          fontSize: 104,
          fontWeight: 700,
          letterSpacing: -3.64,
          lineHeight: 1,
        }}
      >
        <LogoLc taille={116} style={{ color: '#fff' }} />
        LoiClair
      </div>
      <div
        style={{
          position: 'absolute',
          left: 84,
          top: 238,
          display: 'flex',
          flexDirection: 'column',
          fontSize: 44,
          fontWeight: 500,
          lineHeight: 1.22,
          letterSpacing: -0.66,
        }}
      >
        {tagline.map((ligne, i) => (
          <span key={i} style={{ color: i === 0 ? '#fff' : 'rgba(255,255,255,0.78)' }}>
            {ligne}
          </span>
        ))}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 72,
          top: 372,
          display: 'flex',
          alignItems: 'center',
          padding: '18px 28px',
          borderRadius: 20,
          backgroundColor: 'rgba(255,255,255,0.18)',
          fontSize: 36,
          fontWeight: 600,
        }}
      >
        {offre.flatMap((element, i) => [
          ...(i > 0 ? [<span key={`s${i}`} style={{ opacity: 0.6, margin: '0 16px' }}>·</span>] : []),
          <span key={i}>{element}</span>,
        ])}
      </div>
    </div>
  );
}
