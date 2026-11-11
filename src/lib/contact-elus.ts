// Ce que partagent les deux endroits qui font écrire le lecteur à ses élus gardés dans
// le navigateur : le bandeau de la fiche d'un texte (`ContacterMesElusBanner`) et le
// tiroir d'un changement de « Ce qui me concerne » (`ChangementsConcernes`). L'ordre
// des élus, le courriel « à tous » et les réseaux d'un élu sans courriel vivent ici,
// pour qu'une règle changée d'un côté ne diverge pas en silence de l'autre. Sans
// React : le tiroir n'a pas à charger les bulles et pastilles du bandeau pour s'en
// servir.

import type { IconType } from 'react-icons';
import { FaXTwitter, FaInstagram, FaFacebook, FaLinkedin } from 'react-icons/fa6';
import type { EluRef, MesElus } from '@/hooks/useMesElus';
import { buildMailto, type DossierContext, type ElementContext, type Locale } from '@/lib/mailto';

/** « Écrire au Premier ministre » : le seul moyen public d'écrire au Gouvernement, que
 *  le bandeau et le tiroir proposent pour un texte du Gouvernement. Vérifié le
 *  2026-10-19, en français seulement, d'où la mention dans le libellé anglais. */
export const FORMULAIRE_PREMIER_MINISTRE = 'https://www.info.gouv.fr/contact/premier-ministre';

/** « Écrire au Président de la République » : le formulaire de l'Élysée, que le bandeau
 *  propose quand l'auteur affiché d'un texte du Gouvernement est le Président (projet
 *  de révision de la Constitution). Vérifié le 2026-10-28, en français seulement :
 *  `/en/…` répond 404. */
export const FORMULAIRE_PRESIDENT = 'https://www.elysee.fr/ecrire-au-president-de-la-republique/';

export type EluEnregistre = { elu: EluRef; chambre: 'AN' | 'SN' };

/** Les élus gardés, le député en tête puis les sénateurs dans l'ordre enregistré. Le
 *  bandeau pose un trait là où la chambre change : un tri ajouté ici doit garder les
 *  chambres groupées, sinon le trait se répète. */
export function elusEnregistres(data: MesElus | null): EluEnregistre[] {
  if (!data) return [];
  return [
    ...(data.depute ? [{ elu: data.depute, chambre: 'AN' as const }] : []),
    ...data.senateurs.map((elu) => ({ elu, chambre: 'SN' as const })),
  ];
}

/** Le courriel « à tous » : un seul brouillon adressé à ceux qui publient une adresse,
 *  avec la formule collective ; adressé à l'élu, avec sa formule, quand il est le seul
 *  joignable (`seul`, que l'appelant nomme sur son bouton). `href` null quand aucun
 *  n'a d'adresse. `joignables` : combien le brouillon en compte. */
export function courrielMesElus(
  elus: EluEnregistre[],
  opts: { locale: Locale; dossier: DossierContext; element?: ElementContext },
): { href: string | null; seul: EluEnregistre | null; joignables: number } {
  const joignables = elus.filter((e) => e.elu.email);
  const seul = joignables.length === 1 ? joignables[0] : null;
  const href = seul
    ? buildMailto({ ...seul.elu, chambre: seul.chambre }, opts)
    : joignables.length > 1 ? buildMailto(joignables.map((e) => e.elu.email).join(','), opts) : null;
  return { href, seul, joignables: joignables.length };
}

export type SocialLink = { href: string; Icon: IconType; label: string };

function buildSocialHref(url: string | null | undefined, prefix: string): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `${prefix}${url}`;
}

/** Les réseaux publiés d'un élu, dans l'ordre d'affichage, adresse complète
 *  reconstruite quand la base n'a que l'identifiant. Montrés à la place du courriel
 *  quand l'élu n'en publie pas. */
export function getSocials(elu: Pick<EluRef, 'twitter_url' | 'linkedin_url' | 'facebook_url' | 'instagram_url'>): SocialLink[] {
  const candidates: { url: string | null | undefined; prefix: string; Icon: IconType; label: string }[] = [
    { url: elu.twitter_url, prefix: 'https://twitter.com/', Icon: FaXTwitter, label: 'X (Twitter)' },
    { url: elu.linkedin_url, prefix: 'https://linkedin.com/in/', Icon: FaLinkedin, label: 'LinkedIn' },
    { url: elu.facebook_url, prefix: 'https://facebook.com/', Icon: FaFacebook, label: 'Facebook' },
    { url: elu.instagram_url, prefix: 'https://instagram.com/', Icon: FaInstagram, label: 'Instagram' },
  ];
  const out: SocialLink[] = [];
  for (const c of candidates) {
    const href = buildSocialHref(c.url, c.prefix);
    if (href) out.push({ href, Icon: c.Icon, label: c.label });
  }
  return out;
}
