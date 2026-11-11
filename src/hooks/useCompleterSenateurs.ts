'use client';

// Complète une fois par page la fiche officielle des sénateurs gardés dans le
// navigateur. Appelé par tout ce qui montre leurs photos : le bandeau de la fiche d'un
// texte (`ContacterMesElusBanner`) et le tiroir de « Ce qui me concerne »
// (`ChangementsConcernes`), qui sans lui montrait des initiales sur une page où le
// bandeau n'est pas monté.
//
// Les sénateurs enregistrés avant que la liste des élus ne serve l'adresse de leur
// fiche (`url_profil_officiel` absent, et non null) n'auraient pas de photo : leur
// fichier se nomme d'après cette fiche (`photo-elu.ts`). On recharge une fois la
// liste, la même pour tous et sans paramètre, comme « Identifier mes élus » : LoiClair
// n'apprend toujours pas qui sont les élus du lecteur. Une fois l'adresse enregistrée
// (null si la liste n'en a pas), plus rien n'est demandé.

import { useEffect } from 'react';
import { useMesElus } from '@/hooks/useMesElus';
import { chargerElus } from '@/components/TrouverMonDeputeModal';
import type { ElusContact } from '@/lib/trouver-elus';

/** Vrai une fois la fiche complétée sur cette page. Au niveau du module : l'effet se
 *  relance à chaque écriture, un état React ne survivrait pas à un remontage, et deux
 *  appelants sur la même page (bandeau et tiroir) ne complètent qu'une fois. */
let completionFaite = false;

export function useCompleterSenateurs() {
  const { data, setAll } = useMesElus();
  // Une seule écriture par page (`completionFaite`) : quand le stockage lit mais
  // refuse d'écrire (quota plein), `setAll` rend l'ancienne valeur sous une nouvelle
  // référence, et l'effet relancé à chaque écriture tournerait sans fin. Un essai
  // interrompu (élus changés pendant le chargement) ou en échec reste permis au rendu
  // suivant.
  useEffect(() => {
    if (completionFaite || !data || !data.senateurs.some((s) => s.url_profil_officiel === undefined)) return;
    let annule = false;
    chargerElus()
      .then((liste: ElusContact) => {
        if (annule) return;
        completionFaite = true;
        const fiches = new Map(liste.senateurs.map((s) => [s.uid, s.url_profil_officiel]));
        setAll({ ...data, senateurs: data.senateurs.map((s) => ({ ...s, url_profil_officiel: fiches.get(s.uid) ?? null })) });
      })
      .catch(() => {});
    return () => { annule = true; };
  }, [data, setAll]);
}
