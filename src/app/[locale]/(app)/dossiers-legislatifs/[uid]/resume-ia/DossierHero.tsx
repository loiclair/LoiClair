// Server Component : rendu du <PageHero> à partir des données rapides (dossier + actes).
// Permet d'afficher le hero ~3× plus tôt que d'attendre tout le pipeline de la page.

import type { ReactNode } from 'react';
import { BadgeCheck, CalendarDays, Database, ScrollText, User } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import PageHero, { type PageHeroMetaRow, type PageHeroPill } from '@/components/PageHero';
import { getDefinition } from '@/lib/definitions';
import { translateStatut } from '@/lib/statut';
import { BadgeStatut } from '../../../Scrutins/[uid]/ResultatVote';
import { buildShareUrl } from '@/lib/share-url';
import { ANCRE_AMENDEMENTS } from './SectionsDossier';
import { AIBadge } from './AICardElements';
import type { FonctionElu } from '@/lib/ancien-elu';

type Auteur = {
  uid: string | null;
  prenom: string | null;
  nom: string | null;
  /** « Mme » ou « M. », qui accorde la fonction. */
  civ: string | null;
  fonction: FonctionElu;
  groupe: { uid: string; libelle: string } | null;
} | null;

type TElus = Awaited<ReturnType<typeof getTranslations<'elus'>>>;

/** Fonction d'aujourd'hui posée devant le nom, accordée à la civilité : « Députée »,
 *  « Membre du Gouvernement », « Ancien sénateur ». Rien pour un ancien élu dont
 *  `roles_text` ne dit aucun mandat (« Plus en fonction » ne se lit pas devant un
 *  nom). Lire le premier rôle de `roles_text`, comme avant, affichait un rôle passé
 *  (« Ministre » devant un député ancien ministre), et en français sur /en. */
function libelleFonction(a: NonNullable<Auteur>, tElus: TElus): string | null {
  const femme = a.civ?.trim() === 'Mme';
  const { fonction } = a;
  if (fonction.ancien) {
    return fonction.role === 'autre'
      ? null
      : tElus('ancienMandat', { role: fonction.role, genre: femme ? 'F' : 'M' });
  }
  switch (fonction.role) {
    case 'gouvernement': return tElus('roleMembreGouvernement');
    case 'depute': return tElus(femme ? 'roleDeputee' : 'roleDepute');
    case 'senateur': return tElus(femme ? 'roleSenatrice' : 'roleSenateur');
    case 'president': return tElus('banner.presidentNom');
  }
}

interface DossierHeroProps {
  uid: string;
  locale: string;
  titre: string;
  /** Titre officiel français, quand `titre` en est la traduction par l'IA (sur /en) :
   *  le badge IA et ce titre s'affichent sous le titre (D-002). */
  titreOfficiel?: string | null;
  statutFinal: string | null;
  procedureLibelle: string | null;
  hasProcedureAcceleree: boolean;
  dateDepot: string | null;
  lienAN: string | null;
  lienSenat: string | null;
  lienLegifrance: string | null;
  /** Décision du Conseil constitutionnel, quand le dossier lui a été déféré. */
  lienCC: string | null;
  nbAmendementsDeposes: number | null;
  nbAmendementsAdoptes: number | null;
  auteur: Auteur;
  /** Texte du Gouvernement (voir `lib/origine-gouvernementale.ts`) : l'auteur
   *  est présenté sous « Gouvernement », jamais sous son groupe actuel. */
  origineGouvernementale: boolean;
  /** Rapporteurs nommés (commission d'enquête, mission d'information) : les
   *  `RAPPORTEURS_AFFICHES` premiers, et le nombre total pour dire combien d'autres. */
  rapporteurs?: { liste: NonNullable<Auteur>[]; total: number } | null;
  footer?: ReactNode;
}

// Au plus deux noms dans la ligne des méta, une mission en comptant jusqu'à treize :
// les suivants se résument en « et N autres ».
export const RAPPORTEURS_AFFICHES = 2;

export default async function DossierHero({
  uid,
  locale,
  titre,
  titreOfficiel,
  statutFinal,
  procedureLibelle,
  hasProcedureAcceleree,
  dateDepot,
  lienAN,
  lienSenat,
  lienLegifrance,
  lienCC,
  nbAmendementsDeposes,
  nbAmendementsAdoptes,
  auteur,
  origineGouvernementale,
  rapporteurs,
  footer,
}: DossierHeroProps) {
  const t = await getTranslations({ locale, namespace: 'resumeIA' });
  const tDef = await getTranslations({ locale, namespace: 'definitions' });
  const tDossiers = await getTranslations({ locale, namespace: 'dossiers' });
  const tElus = await getTranslations({ locale, namespace: 'elus' });

  const dateDepotFmt = dateDepot
    ? new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(dateDepot))
    : null;

  const heroMeta: PageHeroMetaRow[] = [];

  if (statutFinal) {
    heroMeta.push({
      icon: <BadgeCheck className="h-3 w-3" />,
      label: t('labelStatus'),
      // La pastille colorée d'un vote, pour que le statut ressorte et se lise pareil que
      // dans les tiroirs.
      pills: [],
      trailing: <BadgeStatut statut={statutFinal} statutLabel={translateStatut(statutFinal, tDossiers)} />,
    });
  }

  if (auteur) {
    const prenom = auteur.prenom ?? '';
    const nom = auteur.nom ?? '';
    const role = libelleFonction(auteur, tElus);
    const fullName = `${prenom} ${nom}`.trim();
    const authorLabel = role ? `${role} ${fullName}` : fullName;
    const pills: PageHeroPill[] = [
      auteur.uid
        ? { children: authorLabel, href: `/les-elus/${auteur.uid}`, internal: true }
        : { children: authorLabel },
    ];
    // `auteur.groupe` est le groupe actuel de la personne, pas celui qu'elle avait
    // au dépôt : le budget 2025 du Premier ministre Barnier s'affichait sous
    // « Droite Républicaine ». Un texte du Gouvernement ne montre donc jamais ce
    // groupe.
    if (origineGouvernementale) pills.push({ children: t('auteurGouvernement') });
    else if (auteur.groupe?.libelle) pills.push({ children: auteur.groupe.libelle });
    heroMeta.push({
      icon: <User className="h-3 w-3" />,
      label: t('labelAuthor'),
      pills,
    });
  } else if (origineGouvernementale) {
    heroMeta.push({
      icon: <User className="h-3 w-3" />,
      label: t('labelAuthor'),
      pills: [{ children: t('auteurGouvernement') }],
    });
  }

  if (rapporteurs) {
    const pills: PageHeroPill[] = rapporteurs.liste.map((rapporteur) => {
      const fullName = `${rapporteur.prenom ?? ''} ${rapporteur.nom ?? ''}`.trim();
      const role = libelleFonction(rapporteur, tElus);
      const rapporteurLabel = role ? `${role} ${fullName}` : fullName;
      return rapporteur.uid
        ? { children: rapporteurLabel, href: `/les-elus/${rapporteur.uid}`, internal: true }
        : { children: rapporteurLabel };
    });
    // Le groupe ne suit qu'un rapporteur seul : à plusieurs, la ligne mêlerait noms
    // et groupes sans dire lequel va avec qui.
    const seul = rapporteurs.total === 1 ? rapporteurs.liste[0] : null;
    if (seul?.groupe?.libelle) pills.push({ children: seul.groupe.libelle });
    const autres = rapporteurs.total - rapporteurs.liste.length;
    if (autres > 0) pills.push({ children: t('rapporteursAutres', { count: autres }) });
    heroMeta.push({
      icon: <User className="h-3 w-3" />,
      label: t('labelRapporteur', { count: rapporteurs.total }),
      pills,
    });
  }

  if (procedureLibelle) {
    const def = getDefinition(procedureLibelle, tDef);
    const pills: PageHeroPill[] = [
      { children: def?.term ?? procedureLibelle, tooltip: def?.definition ?? null },
    ];
    if (hasProcedureAcceleree) {
      pills.push({
        children: t('procedureAccelereeShort'),
        tooltip: tDef('procedureAcceleree.definition'),
      });
    }
    heroMeta.push({
      icon: <ScrollText className="h-3 w-3" />,
      label: t('labelProcedure'),
      pills,
    });
  }

  if (nbAmendementsDeposes != null && nbAmendementsDeposes > 0) {
    const pills: PageHeroPill[] = [
      { children: t('amendementsDeposesShort', { count: nbAmendementsDeposes }) },
    ];
    if (nbAmendementsAdoptes != null && nbAmendementsAdoptes > 0) {
      // Mène au bloc « Amendements adoptés par auteur » de la section « Modifications du texte »,
      // qui dit qui les a écrits.
      pills.push({ children: t('amendementsAdoptesShort', { count: nbAmendementsAdoptes }), href: `#${ANCRE_AMENDEMENTS}` });
    }
    heroMeta.push({
      icon: <ScrollText className="h-3 w-3" />,
      label: t('labelVolume'),
      pills,
    });
  }

  if (lienAN || lienSenat || lienLegifrance || lienCC) {
    const pills: PageHeroPill[] = [];
    if (lienAN) pills.push({ children: t('assemblee'), href: lienAN });
    if (lienSenat) pills.push({ children: t('senat'), href: lienSenat });
    if (lienLegifrance) pills.push({ children: t('legifrance'), href: lienLegifrance });
    if (lienCC) pills.push({ children: t('ccPill'), href: lienCC });
    heroMeta.push({
      icon: <Database className="h-3 w-3" />,
      label: t('labelSources'),
      pills,
    });
  }

  heroMeta.push({
    icon: <CalendarDays className="h-3 w-3" />,
    label: t('labelFiledOn'),
    pills: dateDepotFmt ? [{ children: dateDepotFmt }] : [],
  });

  return (
    <PageHero
      breadcrumb={[
        { label: t('allTexts'), href: '/dossiers-legislatifs' },
        { label: t('dossierLabel') },
      ]}
      title={titre || `dossier ${uid}`}
      // Badge court : le titre, souvent long, porte déjà la ligne la plus lourde du hero.
      lede={titreOfficiel ? (
        <>
          <AIBadge usage="titres" court surBandeau infobulle={t('titreTraduitInfobulle')} />{' '}
          {t('titreOfficiel', { titre: titreOfficiel })}
        </>
      ) : undefined}
      meta={heroMeta}
      // La largeur coupe les méta avant le bord du hero, sinon la première
      // ligne se remplit et la date de dépôt reste seule sur la seconde.
      metaMaxWidth="62rem"
      footer={footer}
      shareUrl={buildShareUrl(locale, `/dossiers-legislatifs/${uid}/resume-ia`)}
    />
  );
}
