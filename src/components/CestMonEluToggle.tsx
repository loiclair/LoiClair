'use client';

import { useTranslations } from 'next-intl';
import { Star } from 'lucide-react';
import { useMesElus, type DeputeRef, type SenateurRef } from '@/hooks/useMesElus';

type ActeurInput = {
  uid: string;
  prenom: string | null;
  nom: string | null;
  civ: string | null;
  email: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
  /** Fiche officielle : un sénateur enregistré en a besoin pour sa photo dans la bande
   *  des élus de la fiche dossier (`photo-elu.ts`). */
  url_profil_officiel: string | null;
  num_circo: string | null;
  num_departement: string | null;
  est_depute_actuel: boolean | null;
  est_senateur_actuel: boolean | null;
  groupe: { libelle: string | null; libelle_abrege: string | null } | null;
};

// Le marque-page vit dans la bande de contact, au pied du bandeau : ses deux
// états se peignent sur les jetons `--bandeau-*`, crème en thème clair et brun
// en sombre, jamais sur les jetons de page, calculés pour le fond de la page.
const classeToggle = (active: boolean) => [
  'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors border',
  active
    ? 'bg-amber-400/15 text-[color:var(--bandeau-or)] border-amber-400/45'
    : 'text-[color:var(--bandeau-texte-doux)] border-[color:var(--bandeau-trait)] hover:bg-[color:var(--bandeau-voile)] hover:text-[color:var(--bandeau-texte)]',
].join(' ');

export default function CestMonEluToggle({ acteur }: { acteur: ActeurInput }) {
  const t = useTranslations('elus.monDepute');
  const { data, setDepute, toggleSenateur, clearDepute } = useMesElus();

  if (!acteur.est_depute_actuel && !acteur.est_senateur_actuel) return null;
  if (!acteur.num_departement) return null;

  const isDepute = !!acteur.est_depute_actuel;
  const groupeAbrege = acteur.groupe?.libelle_abrege ?? null;
  const groupeLib = acteur.groupe?.libelle ?? null;

  if (isDepute) {
    const active = data?.depute?.uid === acteur.uid;
    const previous = data?.depute && data.depute.uid !== acteur.uid ? data.depute : null;
    return (
      <button
        type="button"
        onClick={() => {
          if (active) {
            clearDepute();
          } else {
            const ref: DeputeRef = {
              uid: acteur.uid,
              prenom: acteur.prenom,
              nom: acteur.nom,
              civ: acteur.civ,
              email: acteur.email,
              twitter_url: acteur.twitter_url,
              instagram_url: acteur.instagram_url,
              facebook_url: acteur.facebook_url,
              linkedin_url: acteur.linkedin_url,
              groupe_libelle: groupeLib,
              groupe_abrege: groupeAbrege,
              num_circo: acteur.num_circo,
              num_dept: acteur.num_departement!,
            };
            setDepute(ref);
          }
        }}
        title={previous ? t('toggleReplaceDepute', { name: `${previous.prenom ?? ''} ${previous.nom ?? ''}`.trim() }) : undefined}
        aria-pressed={active}
        className={classeToggle(active)}
      >
        <Star size={13} fill={active ? 'currentColor' : 'none'} />
        {active ? t('toggleDeputeActive') : t('toggleDepute')}
      </button>
    );
  }

  // Sénateur (additif, multi-département possible)
  const active = data?.senateurs.some((s) => s.uid === acteur.uid) ?? false;
  return (
    <button
      type="button"
      onClick={() => {
        const ref: SenateurRef = {
          uid: acteur.uid,
          prenom: acteur.prenom,
          nom: acteur.nom,
          civ: acteur.civ,
          email: acteur.email,
          twitter_url: acteur.twitter_url,
          instagram_url: acteur.instagram_url,
          facebook_url: acteur.facebook_url,
          linkedin_url: acteur.linkedin_url,
          groupe_libelle: groupeLib,
          groupe_abrege: groupeAbrege,
          url_profil_officiel: acteur.url_profil_officiel,
          num_dept: acteur.num_departement!,
        };
        toggleSenateur(ref);
      }}
      aria-pressed={active}
      className={classeToggle(active)}
    >
      <Star size={13} fill={active ? 'currentColor' : 'none'} />
      {active ? t('toggleSenateurActive') : t('toggleSenateur')}
    </button>
  );
}
