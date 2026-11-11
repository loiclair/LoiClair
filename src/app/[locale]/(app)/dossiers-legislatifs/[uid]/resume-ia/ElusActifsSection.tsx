'use client';

// Section « Les plus actifs dans ce dossier » de la fiche dossier, rendue juste avant
// « Sources et acteurs » par ResumeIAClient, sur toute fiche. Une colonne par chambre, l'Assemblée à
// gauche et le Sénat à droite, empilées sous 768 px ; une chambre sans aucune donnée
// n'a pas de colonne, et l'autre prend toute la largeur. Les deux chambres ne se
// comparent jamais.
//
// Dans chaque colonne, une seule liste, triée par un score sur 100 qui fond les
// prises de parole en séance, les amendements déposés et, à l'Assemblée, les
// présences en commission (calcul dans page.tsx, `elusActifs`). La carte ne montre que
// l'ordre : ni score ni explication, qui chargeraient chaque ligne d'un chiffre que le
// lecteur ne sait pas lire sans sa méthode. Les deux vivent dans le panneau, la phrase
// de méthode en tête (poids compris), le score à droite de chaque ligne. Le bouton du panneau reste
// donc même sur une liste courte, qui tient dans la carte.
//
// Cinq élus par chambre, puis « Voir les N » ouvre le panneau de SourcesSection, dont
// la section reprend la liste coupée et la ligne d'élu. page.tsx n'envoie que ces
// cinq élus et le total de chaque chambre : le panneau charge la liste entière à sa
// première ouverture (`/api/dossiers/[uid]/elus-actifs`), la garde ensuite, et y pose
// le badge « Rapporteur » d'après les rapporteurs que la fiche connaît déjà.

import { memo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ACTIVITE_WEIGHTS } from '@/lib/activite-weights';
import SectionRepliable from '@/components/SectionRepliable';
import { CLE_PLI, IconeSection } from './SectionsDossier';
import { Bloc, CARTE, LigneElu, ListeCoupee, type BadgeElu, type EluSource } from './SourcesSection';
import { ELUS_VISIBLES, marquerRapporteurs } from './elus-actifs-carte';

/** Un élu classé : sa ligne de SourcesSection (badge de chambre à null, la colonne la
 *  dit déjà), son score sur 100 à une décimale, et s'il a rapporté le texte dans
 *  cette chambre. */
export interface EluActif extends EluSource {
  score: number;
  rapporteur: boolean;
}

/** Les élus d'une chambre, triés par score décroissant. `nb` est le total de la
 *  chambre : dans la carte, `elus` n'en garde que les premiers (`carteElusActifs`). */
export interface ElusActifsChambre {
  chambre: 'AN' | 'SN';
  nb: number;
  elus: EluActif[];
}

/** Mémoïsée, comme SourcesSection : ResumeIAClient se rend à chaque morceau du
 *  résumé en streaming, et cette section n'en dépend pas. Présente sur toute fiche :
 *  sans aucune chambre, elle le dit en une phrase. `uid` sert au panneau à charger la liste entière,
 *  `rapporteurs` (ceux de « Sources et acteurs ») à y poser le badge. */
export default memo(function ElusActifsSection({ uid, chambres, rapporteurs }: {
  uid: string;
  chambres: ElusActifsChambre[];
  rapporteurs: { uid: string; badge: BadgeElu | null }[];
}) {
  const t = useTranslations('resumeIA');
  const locale = useLocale();
  // Une seule demande pour les deux chambres, gardée une fois arrivée ; un panneau
  // refermé avant la réponse la garde quand même. Seul un échec se rejoue, à
  // l'ouverture suivante.
  const [tous, setTous] = useState<ElusActifsChambre[] | null>(null);
  const [echec, setEchec] = useState(false);
  const enCours = useRef(false);
  const charger = () => {
    if (tous || enCours.current) return;
    enCours.current = true;
    setEchec(false);
    fetch(`/api/dossiers/${encodeURIComponent(uid)}/elus-actifs`)
      .then((r) => (r.ok ? r.json() as Promise<{ chambres: ElusActifsChambre[] }> : Promise.reject(new Error(String(r.status)))))
      .then((d) => setTous(marquerRapporteurs(d.chambres, rapporteurs)))
      .catch(() => setEchec(true))
      .finally(() => { enCours.current = false; });
  };
  const etat = tous ? null : (
    <p role="status" className="text-muted-foreground" style={{ fontSize: '0.75rem', lineHeight: 1.45, margin: '0 0 0.5rem' }}>
      {t(echec ? 'elusEchec' : 'elusChargement')}
    </p>
  );
  // Les poids sont lus là où page.tsx les lit, et où /Activite lit les siens : la
  // phrase ne peut pas annoncer d'autres poids que ceux du calcul.
  const poids = (v: number) => v.toLocaleString(locale);
  const methode = (
    <p className="text-muted-foreground" style={{ fontSize: '0.75rem', lineHeight: 1.45, margin: '0 0 12px' }}>
      {t.rich('elusMethode', {
        presences: poids(ACTIVITE_WEIGHTS.cpCommPres),
        amendements: poids(ACTIVITE_WEIGHTS.cpAmendAuteur),
        parole: poids(ACTIVITE_WEIGHTS.cpPrisesParole),
        lien: (morceau) => (
          <Link href="/Activite#methodologie" prefetch={false} className="underline hover:text-foreground">
            {morceau}
          </Link>
        ),
      })}
    </p>
  );

  return (
    <SectionRepliable
      cle="elus"
      cleStockage={CLE_PLI}
      icone={<IconeSection cle="elus" />}
      titre={t('sectionElus')}
    >
      {chambres.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noElusData')}</p>
      ) : (
        <div
          className={`rounded-xl grid grid-cols-1 ${chambres.length > 1 ? 'md:grid-cols-2' : ''} gap-x-10 gap-y-6`}
          style={CARTE}
        >
          {chambres.map((c) => {
            const nomChambre = t(c.chambre === 'AN' ? 'assemblee' : 'senat');
            return (
              <div key={c.chambre} className="min-w-0">
                <Bloc titre={nomChambre}>
                  <ListeCoupee
                    titre={`${t('sectionElus')} · ${nomChambre}`}
                    elements={tous?.find((x) => x.chambre === c.chambre)?.elus ?? c.elus}
                    total={c.nb}
                    visibles={ELUS_VISIBLES}
                    onOuvrir={charger}
                    etatPanneau={etat}
                    rendu={(e) => <LigneElu key={e.uid} elu={e} rapporteur={e.rapporteur} />}
                    renduPanneau={(e) => <LigneElu key={e.uid} elu={e} rapporteur={e.rapporteur} nombre={e.score} decimales={1} />}
                    entetePanneau={methode}
                  />
                </Bloc>
              </div>
            );
          })}
        </div>
      )}
    </SectionRepliable>
  );
});
