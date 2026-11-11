/**
 * L'extension de chaque logo vient de `LOGOS`, table générée depuis
 * `public/images/groupes/` par `scripts/generate-logos-groupes.mjs` avant chaque
 * `dev`, `build` et `typecheck`. **Ajouter un logo, c'est déposer son fichier dans
 * ce dossier** : rien à écrire ici.
 *
 * Une table plutôt qu'un sondage : le composant essayait avant chaque extension
 * (svg, png, jpg, webp, jpeg) jusqu'à trouver le fichier, ce qui coûtait 21 réponses
 * 404 à chaque chargement de /fr/les-elus, soit 235 Ko en production (mesuré le
 * 2026-10-29), et rendait le logo seulement après coup, côté navigateur.
 */
import { LOGOS } from '@/lib/logos-groupes';

/**
 * Logo d'un groupe politique, servi depuis `public/images/groupes/{uid}.{ext}`,
 * l'extension lue dans `LOGOS`. Rien ne s'affiche pour un groupe sans logo.
 * Appelé par la liste des élus, la fiche élu et le résultat du quiz d'affinité.
 */
export function GroupLogoImage({ groupeUid, imgStyle }: { groupeUid: string; imgStyle?: React.CSSProperties }) {
  const ext = LOGOS[groupeUid];
  if (!ext) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- logos de proportions très diverses affichés en hauteur fixe et largeur libre, que next/image exigerait de connaître d'avance
    <img src={`/images/groupes/${groupeUid}.${ext}`} alt="" loading="lazy" style={{ objectFit: 'contain', ...imgStyle }} />
  );
}
