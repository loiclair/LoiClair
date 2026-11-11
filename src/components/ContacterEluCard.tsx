'use client';

import { useState, type ComponentType, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Mail, Phone, ExternalLink } from 'lucide-react';
import { FaXTwitter, FaInstagram, FaFacebook, FaLinkedin } from 'react-icons/fa6';
import { appellation, buildMailto, type ActeurCible, type Locale } from '@/lib/mailto';
import { ACTIVE_BASE, ACTIVE_HOVER, BASE_PILL_STYLE } from '@/lib/pastille-or';
import CestMonEluToggle from '@/components/CestMonEluToggle';

type Acteur = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  /** « M. » ou « Mme » : nomme l'élu sur le bouton et choisit la formule du brouillon. */
  civ: string | null;
  email: string | null;
  telephone: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  url_profil_officiel: string | null;
  num_circo: string | null;
  num_departement: string | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  groupe: { libelle: string | null; libelle_abrege: string | null } | null;
};

// Canaux secondaires : des icônes fantômes sur le bandeau, assez discrètes
// pour que la pastille or reste la seule action qui se voit de loin.
const iconLinkClass =
  'inline-flex items-center justify-center size-7 rounded-full text-[color:var(--bandeau-texte-doux)] hover:bg-[color:var(--bandeau-voile)] hover:text-[color:var(--bandeau-texte)] transition-colors';

/** L'action principale de la bande, dans l'or partagé avec la fiche dossier. */
function PastilleOr({ href, children }: { href: string; children: ReactNode }) {
  const [survol, setSurvol] = useState(false);
  return (
    <a
      href={href}
      style={{ ...BASE_PILL_STYLE, ...(survol ? ACTIVE_HOVER : ACTIVE_BASE) }}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
    >
      {children}
    </a>
  );
}

function buildSocialHref(url: string | null, prefix: string): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : `${prefix}${url}`;
}

/**
 * Bande de contact au pied du hero de la fiche élu : le bouton « Écrire à
 * M. Ciotti », les canaux secondaires et le marque-page « c'est mon élu ».
 * Rendue par `EluProfileClient`.
 */
export default function ContacterEluCard({ acteur }: { acteur: Acteur }) {
  const t = useTranslations('elus.contact');
  const locale = (useLocale() === 'en' ? 'en' : 'fr') as Locale;

  const cible: ActeurCible = {
    prenom: acteur.prenom,
    nom: acteur.nom,
    civ: acteur.civ,
    email: acteur.email,
    chambre: acteur.est_depute_actuel ? 'AN' : acteur.est_senateur_actuel ? 'SN' : null,
  };
  const mailtoHref = buildMailto(cible, { locale });

  type SocialIcon = ComponentType<{ size?: number }>;
  const socials: { href: string; Icon: SocialIcon; label: string }[] = [
    { href: buildSocialHref(acteur.twitter_url, 'https://twitter.com/')!, Icon: FaXTwitter, label: 'X (Twitter)' },
    { href: buildSocialHref(acteur.instagram_url, 'https://instagram.com/')!, Icon: FaInstagram, label: 'Instagram' },
    { href: buildSocialHref(acteur.facebook_url, 'https://facebook.com/')!, Icon: FaFacebook, label: 'Facebook' },
    { href: buildSocialHref(acteur.linkedin_url, 'https://linkedin.com/in/')!, Icon: FaLinkedin, label: 'LinkedIn' },
  ].filter((s) => !!s.href);

  const hasSecondary = !!(acteur.telephone || socials.length > 0 || acteur.url_profil_officiel);

  // Une bande dans le pied du hero, pas une carte dans la page : la grammaire de
  // la bande « contacter mes élus » de la fiche dossier (D-213). Le fond, le
  // filet du haut et les marges viennent du slot `footer` de `PageHero`.
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        {mailtoHref ? (
          <PastilleOr href={mailtoHref}>
            <Mail size={13} />
            {t('writeBtn', { nom: appellation(cible, locale) })}
          </PastilleOr>
        ) : (
          <span className="text-xs italic text-[color:var(--bandeau-texte-doux)]">{t('noEmail')}</span>
        )}

        {hasSecondary && (
          <div className="flex items-center gap-1">
            {acteur.telephone && (
              <a href={`tel:${acteur.telephone.replace(/\s+/g, '')}`} className={iconLinkClass} aria-label={t('phoneAria')}>
                <Phone size={14} />
              </a>
            )}
            {socials.map(({ href, Icon, label }) => (
              <a key={label} href={href} target="_blank" rel="noopener noreferrer" className={iconLinkClass} aria-label={label}>
                <Icon size={13} />
              </a>
            ))}
            {acteur.url_profil_officiel && (
              <a
                href={acteur.url_profil_officiel}
                target="_blank"
                rel="noopener noreferrer"
                className={iconLinkClass}
                aria-label={acteur.est_depute_actuel ? t('officialAN') : t('officialSN')}
                title={acteur.est_depute_actuel ? t('officialAN') : t('officialSN')}
              >
                <ExternalLink size={13} />
              </a>
            )}
          </div>
        )}

        {/* Le bouton et les canaux secondaires se suivent à gauche ; seul le
            marque-page part à droite, comme dans le prototype. Sous 640 px il
            passe à la ligne : poussé à droite il s'y retrouvait seul et
            décroché du reste, alors il reste calé à gauche sous les actions. */}
        <div className="sm:ml-auto">
          <CestMonEluToggle acteur={acteur} />
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-snug text-[color:var(--bandeau-texte-pale)]">
        {t('disclaimer')}
      </p>
    </>
  );
}
