// Les primitives graphiques du bento /etat-des-lieux.
//
// Aucun composant de `components/ui/*Chart.tsx` ne tient dans une cellule de
// bento (ils portent tous un CardHeader, une légende et des axes), d'où ces
// formes minimales.
//
// Quatre familles visuelles, choisies par le travail que la donnée demande au
// lecteur, et non pour varier :
//   - des unités qu'on peut compter  -> `Waffle`, une case par unité
//   - un pourcentage seul            -> `Donut`, un anneau qui porte son chiffre
//   - une valeur face à un repère    -> `DotPlot`, un axe et un trait
//   - une évolution dans le temps    -> `Sparkline`, une aire
// Une première version n'employait que des jauges horizontales : cinq données
// de natures différentes prenaient la même apparence, et la page se lisait à
// plat.
//
// Deux grandeurs simplement comparables (les deux chambres, dans la tuile de
// participation) n'ont pas de forme à elles : chacune porte sa jauge sous son
// propre chiffre (`Figure`, dans page.tsx), sur un rail qui vaut 100 %. Les
// deux colonnes côte à côte qu'elles avaient obligeaient à rattacher de tête
// chaque colonne au chiffre qui la précédait.
//
// `Waffle` se place à droite des chiffres ; `Donut` occupe seul le centre de
// la tuile ; `DotPlot` et `Sparkline` prennent toute la largeur.
//
// La couleur est celle de la section, passée en `tone`. Dans une forme donnée
// il n'y a qu'une teinte et un fond neutre, donc aucun couple de couleurs à
// départager pour les daltoniens ; et la couleur ne porte jamais l'information
// seule, le chiffre est toujours écrit à côté.

/**
 * Diamètre de l'anneau. Il porte à lui seul la réponse de sa tuile et occupe
 * le centre de la carte : sa taille est celle d'un chiffre de tête, pas celle
 * d'une vignette.
 *
 * Fluide, parce que la hauteur d'une cellule de bento suit celle de l'écran
 * alors qu'un diamètre figé, lui, ne bouge pas : à 110 px dans une fenêtre de
 * 1 280 px, où les titres passent à deux lignes, l'anneau débordait sur la
 * bande basse et le pourcentage s'imprimait par-dessus son étiquette. Le
 * plancher est dicté par le texte enfermé au centre, sous 76 px le
 * pourcentage passerait sous 16 px pour y tenir.
 */
const RING = 'clamp(5.5rem, 7vw, 6.875rem)';

// Les formes sont en `display: block` : en `inline`, un `span` ou un `svg`
// réserve l'espace de jambage sous la ligne de base, et sa hauteur réelle
// dépasse alors la hauteur déclarée. La cellule de bento compte ses pixels, on
// ne lui laisse pas cette marge d'incertitude.

/** Borne le ratio dans [0, 1] : une donnée aberrante ne doit pas déborder. */
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Gaufre : une case par unité réelle. À réserver aux effectifs qu'on peut
 * vraiment compter (103 lois promulguées), parce que sa promesse est justement
 * qu'une case vaut une chose. Au-delà, `Donut`.
 */
export function Waffle({
  filled,
  total,
  columns = 15,
  tone,
  label,
}: {
  filled: number;
  total: number;
  /** 15 colonnes par défaut : 103 lois tiennent alors en 7 rangées, soit 33 px,
   *  la hauteur que la cellule accorde. */
  columns?: number;
  tone: string;
  label: string;
}) {
  const cells = Array.from({ length: total }, (_, i) => i < filled);
  return (
    <div
      role="img"
      aria-label={label}
      className="grid shrink-0"
      style={{
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '2px',
        width: `${columns * 5}px`,
      }}
    >
      {cells.map((on, i) => (
        <span
          key={i}
          style={{
            display: 'block',
            width: '3px',
            height: '3px',
            borderRadius: '1px',
            backgroundColor: on ? tone : 'var(--muted)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * Anneau : un pourcentage seul, écrit en grand au centre, avec sous lui
 * l'étiquette de ce qu'il compte. Le chiffre est dans l'anneau plutôt qu'en
 * face de lui parce que la tuile ne dit qu'une chose : l'écrire à deux
 * endroits faisait chercher lequel des deux portait la réponse.
 *
 * Le tracé part de midi et tourne dans le sens horaire, via `strokeDasharray`
 * sur un cercle plutôt qu'un chemin d'arc, ce qui évite tout calcul
 * trigonométrique.
 */
export function Donut({
  ratio,
  value,
  caption,
  tone,
  label,
}: {
  ratio: number;
  /** Le pourcentage tel qu'il s'affiche, déjà formaté dans la locale */
  value: string;
  /** Ce que le pourcentage compte, en petites capitales sous l'anneau */
  caption: string;
  tone: string;
  label: string;
}) {
  const R = 20;
  const C = 2 * Math.PI * R;
  const on = clamp01(ratio) * C;

  return (
    // `inline-block` et non une largeur figée à `RING` : une légende plus large
    // que l'anneau (« MESURES JAMAIS PRISES ») tiendrait sinon sur trois lignes.
    // L'anneau reste centré dedans par sa marge automatique.
    <div className="shrink-0 text-center" style={{ display: 'inline-block', maxWidth: '100%' }}>
      <div style={{ position: 'relative', width: RING, height: RING, margin: '0 auto' }}>
        <svg
          role="img"
          aria-label={label}
          viewBox="0 0 48 48"
          className="block"
          style={{ width: RING, height: RING }}
        >
          <circle cx="24" cy="24" r={R} fill="none" stroke="var(--muted)" strokeWidth="6" />
          <circle
            cx="24"
            cy="24"
            r={R}
            fill="none"
            stroke={tone}
            strokeWidth="6"
            strokeDasharray={`${on} ${C - on}`}
            strokeLinecap="round"
            transform="rotate(-90 24 24)"
          />
        </svg>
        {/* Le chiffre est en HTML posé sur le SVG et non en <text> : la police
            du site s'y applique telle quelle, sans dépendre du rendu de texte
            SVG. Position en inline, comme partout dans ce fichier, parce que
            les utilitaires de placement sont peu fiables sur Safari
            (cf. ARCHITECTURE.md). `aria-hidden` : l'anneau porte déjà la
            phrase complète en `aria-label`. */}
        <span
          aria-hidden
          className="font-bold tabular-nums whitespace-nowrap"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 'clamp(1.125rem, 1.6vw, 1.375rem)',
            lineHeight: 1,
            color: tone,
          }}
        >
          {value}
        </span>
      </div>
      <p
        className="uppercase tracking-wide text-muted-foreground"
        style={{ fontSize: '0.625rem', lineHeight: 1.3, marginTop: '0.25rem' }}
      >
        {caption}
      </p>
    </div>
  );
}

/**
 * Points sur un axe, avec un trait de repère. C'est la forme des comparaisons
 * au pays : ce qui compte n'est pas la valeur mais l'écart au repère, et un
 * point posé sur un axe le montre mieux qu'une barre remplie depuis zéro.
 */
export function DotPlot({
  values,
  scale,
  reference,
  tone,
  label,
}: {
  values: number[];
  /** Borne haute de l'axe, commune aux points et au repère */
  scale: number;
  reference?: number;
  tone: string;
  label: string;
}) {
  const refPct = reference === undefined ? null : clamp01(reference / scale) * 100;

  return (
    <div role="img" aria-label={label} className="relative w-full" style={{ height: '14px' }}>
      {/* L'axe */}
      <div
        className="absolute w-full rounded-full bg-muted"
        style={{ top: '6px', height: '2px' }}
      />
      {refPct !== null && (
        // Repère en encre et non en teinte de série : il se lit comme une
        // graduation, pas comme une troisième valeur.
        <div
          className="absolute bg-foreground"
          style={{ left: `calc(${refPct}% - 1px)`, top: '1px', width: '2px', height: '12px', opacity: 0.55 }}
        />
      )}
      {values.map((v, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            // `clamp` : sans lui, un point en bout d'axe dépasse du cadre, et un
            // enfant absolu qui dépasse compte dans le `scrollHeight` du parent.
            left: `clamp(5px, ${clamp01(v / scale) * 100}%, calc(100% - 5px))`,
            top: '7px',
            width: '9px',
            height: '9px',
            transform: 'translate(-50%, -50%)',
            backgroundColor: tone,
            opacity: i === 0 ? 1 : 0.55,
            boxShadow: '0 0 0 2px var(--card)',
          }}
        />
      ))}
    </div>
  );
}

/**
 * Courbe d'aire sur une série mensuelle. Le dernier point est marqué : c'est
 * le mois en cours, celui que le chiffre de la tuile annonce.
 *
 * Le tracé est en coordonnées 0-100 × 0-100 avec `preserveAspectRatio="none"`,
 * donc la courbe s'étire à la largeur de la cellule sans calcul de layout.
 * `vectorEffect` garde le trait à 2 px malgré cet étirement.
 */
export function Sparkline({
  values,
  tone,
  label,
}: {
  values: number[];
  tone: string;
  label: string;
}) {
  if (values.length < 2) return null;

  const HEIGHT = 56;
  const max = Math.max(...values, 1);
  const stepX = 100 / (values.length - 1);
  const y = (v: number) => 100 - (v / max) * 100;
  const points = values.map((v, i) => `${i * stepX},${y(v)}`);
  const lastY = y(values[values.length - 1]);

  return (
    <div className="relative w-full" style={{ height: `${HEIGHT}px` }}>
      <svg
        role="img"
        aria-label={label}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="block w-full"
        style={{ height: `${HEIGHT}px` }}
      >
        <polygon points={`0,100 ${points.join(' ')} 100,100`} fill={tone} opacity={0.18} />
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={tone}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/*
        Le point du mois courant est en HTML et non en <circle> : le viewBox est
        étiré par `preserveAspectRatio="none"`, ce qui transformerait un cercle
        en ellipse écrasée. `clamp` sur la position verticale parce qu'un enfant
        absolu qui dépasse du cadre compte dans son `scrollHeight`.
      */}
      <span
        aria-hidden
        className="absolute rounded-full"
        style={{
          left: '100%',
          top: `clamp(3.5px, ${lastY}%, calc(100% - 3.5px))`,
          width: '7px',
          height: '7px',
          transform: 'translate(-50%, -50%)',
          backgroundColor: tone,
          boxShadow: '0 0 0 2px var(--card)',
        }}
      />
    </div>
  );
}
