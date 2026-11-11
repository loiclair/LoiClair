/**
 * Petits blocs de mise en page partagés par les chapitres de « Budget des
 * chambres » (/Facts/budget/assemblee-nationale, /Facts/budget/senat) : grand
 * chiffre, ligne libellé / montant, liste de constats, et la teinte de la série.
 * Composants serveur sans état ; les pages leur passent des textes déjà traduits
 * et des montants déjà formatés.
 */

/**
 * Ardoise un cran plus clair que la teinte du chapitre au registre (#475569, D-212) : en thème
 * sombre, le #475569 posé en texte sur le fond de page tombait sous le contraste
 * lisible, alors que le #64748b tient sur fond clair comme sur fond sombre. Les
 * pages d'une même série partagent leur teinte.
 */
export const COLOR = '#64748b';

/** Un grand chiffre et sa légende, dans la teinte de la page. Taille en ligne :
 *  les classes `text-3xl md:text-4xl` ne s'appliquent pas toujours sur Safari.
 *  `petit` sert aux chiffres de détail, sous un total affiché en grand. */
export function Figure({ valeur, label, petit = false }: { valeur: string; label: string; petit?: boolean }) {
  return (
    <div>
      <div
        className="font-bold tabular-nums"
        style={{ color: COLOR, fontSize: petit ? 'clamp(1.2rem, 3.5vw, 1.45rem)' : 'clamp(1.5rem, 5vw, 2.1rem)', lineHeight: 1.15 }}
      >
        {valeur}
      </div>
      <p className="text-sm text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

/** Une ligne libellé / montant, séparée de la suivante par un filet fin. */
export function Ligne({ label, valeur }: { label: React.ReactNode; valeur: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4 border-b pb-2 last:border-0">
      <span className="text-sm">{label}</span>
      <span className="text-sm font-semibold tabular-nums shrink-0" style={{ color: COLOR }}>{valeur}</span>
    </li>
  );
}

/** Une suite de constats, chacun ouvert par son intitulé en gras (balise `b`). */
export function Constats({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="divide-y">
      {items.map((item, i) => (
        <li key={i} className="py-3 first:pt-0 last:pb-0 text-sm leading-relaxed text-foreground/80">
          {item}
        </li>
      ))}
    </ul>
  );
}
