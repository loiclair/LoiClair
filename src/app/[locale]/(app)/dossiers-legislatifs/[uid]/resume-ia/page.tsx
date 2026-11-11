// src/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/page.tsx
// Fast path : dossier + actes + auteur en parallèle (~300ms) → rend le hero immédiatement,
// et de quoi savoir si le texte touche au moins un profil de « Ce qui me concerne ».
// Heavy path streamé via <Suspense> : textes, articles, débats, scrutins, application,
// le texte assemblé pour tous les profils (section « Ce qui change pour vous »), les
// amendements de la section « Modifications du texte », les élus de la section « Les
// plus actifs dans ce dossier », puis ceux de la section « Sources et
// acteurs », résolus depuis les textes.

export const revalidate = 86400;
export const dynamic = 'force-static';
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

import { Suspense } from 'react';
import { auPlusUneLigne, sql } from '@/lib/db';
import { MODEL_RESUME_LOI, MODEL_RESUME_DEBATS, MODEL_CC_DECISION, getPromptVersion } from '@/lib/prompts';
import promptConcerne from '@/lib/prompts/ce-qui-me-concerne.json';
import promptTitres from '@/lib/prompts/titres-en.json';
import { STEP_CONFIG, MILESTONE_CODES, PARCOURS_ACTE_CODES, LECTURE_KEY_BY_MILESTONE, milestoneOf, parcoursDuDossier } from '@/lib/legislative-steps';
import ResumeIAClient from './ResumeIAClient';
import type { TimelineStep } from './Timeline';
import type { BadgeElu } from './SourcesSection';
import type { LigneRepartition, ModificationsDossier } from './ModificationsSection';
import type { SansDetail } from './ResumeIAClient';
import { amendementsAdoptes, COLONNES_ELU_SOURCE, versEluSource, type RawActeur } from './amendements-adoptes';
import { COLONNES_CONTACT, chargerAuteur, droiteBandeau, lireTextesDeRepli, versPersonneContact, type RawContact } from '@/lib/auteur-dossier';
import { carteAmendements } from './amendements-carte';
import { elusActifs } from './elus-actifs';
import { carteElusActifs, marquerRapporteurs } from './elus-actifs-carte';
import { rangsHemicycle } from '@/lib/groupes-ordre';
import { fonctionElu, type DrapeauxMandat, type FonctionElu } from '@/lib/ancien-elu';
import { completerGroupesAnciens } from '@/lib/groupe-ancien-elu';
import DossierHero, { RAPPORTEURS_AFFICHES } from './DossierHero';
import DossierBodySkeleton from './DossierBodySkeleton';
import ContacterMesElusBanner, { type PersonneContact } from '@/components/ContacterMesElusBanner';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { estUidDossier } from '@/lib/uid-fiches';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { traduireDenomination } from '@/lib/denomination';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import { estOrigineGouvernementale } from '@/lib/origine-gouvernementale';
import { dateTexte } from '@/lib/texte-date';
import { assemblerDossiers } from '@/lib/ce-qui-me-concerne';
import { titreDossier, titreTraduit } from '@/lib/titre-dossier';
import { deriveChambreKey, estMotionProcedure, parseSortLibelle, voteLePlusRecent } from '@/lib/scrutin-affichage';
import { ChoixProfilsModal } from '@/components/ChoixProfils';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; uid: string }> }): Promise<Metadata> {
  const { locale, uid } = await params;
  if (!estUidDossier(uid)) notFound();
  setRequestLocale(locale);
  // Lève sur une panne (D-136) : la régénération garde alors la page précédente au
  // lieu de figer le titre de repli. Une fiche marquée par
  // `/api/revalidate` n'en a plus et rend une erreur le temps de la panne.
  const data = await auPlusUneLigne(sql<{ titre: string | null; titre_en: string | null }[]>`
    select titre, titre_en from dossiers_legislatifs where uid = ${uid}`, 'dossiers_legislatifs (métadonnées)');
  const t = await getTranslations({ locale, namespace: 'resumeIA' });
  // Sur /en, le titre traduit par l'IA quand il existe (`lib/titre-dossier.ts`).
  const titre = data ? titreDossier(data, locale) : '';
  const title = titre ? `${titre} — LoiClair` : t('metaTitleFallback');
  const description = titre
    ? t('metaDescription', { titre })
    : t('metaDescriptionFallback');
  return {
    title,
    description,
    alternates: buildAlternates(locale, `/dossiers-legislatifs/${uid}/resume-ia`),
    openGraph: buildOpenGraph(locale, `/dossiers-legislatifs/${uid}/resume-ia`, title, description),
    other: {
      // Marquage machine-readable (Article 50 AI Act)
      'ai-generated': 'true',
      'ai-model': MODELES_FICHE,
      'ai-provider': [...new Set(MODELES_FICHE.map(fournisseurDe))],
    },
  };
}

// Modèles dont la fiche affiche du texte : le résumé (MODEL_RESUME_LOI), la synthèse des
// débats (MODEL_RESUME_DEBATS), la décision du Conseil constitutionnel (MODEL_CC_DECISION),
// « Ce qui change pour vous » (prompt « Ce qui me concerne ») et le titre anglais. Lus dans les mêmes
// constantes que /documentation/choix-modele-ia, pour que le marquage (article 50 de
// l'AI Act) ne déclare pas autre chose que ce qui est réellement affiché. Un tableau
// donne une balise <meta> par valeur.
const MODELES_FICHE = [...new Set([MODEL_RESUME_LOI, MODEL_RESUME_DEBATS, MODEL_CC_DECISION, promptConcerne.modele, promptTitres.modele])];

// Les modèles Claude sont appelés directement chez Anthropic ; les autres passent par Mammouth.
function fournisseurDe(modele: string): string {
  return modele.startsWith('claude-') ? 'Anthropic' : 'OpenAI (via Mammouth)';
}

type Auteur = {
  uid: string | null;
  prenom: string | null;
  nom: string | null;
  civ: string | null;
  fonction: FonctionElu;
  groupe: { uid: string; libelle: string } | null;
} | null;

type ActeRow = {
  uid: string;
  code_acte: string;
  libelle_acte?: string | null;
  date_acte: string | null;
  parent_uid: string | null;
  vote_refs: string[] | null;
  textes_associes: string[] | null;
  texte_adopte?: string | null;
  statut_conclusion?: string | null;
  url_conclusion?: string | null;
  resume_cc?: string | null;
  articles_censures?: unknown | null;
  resume_cc_en?: string | null;
  articles_censures_en?: unknown | null;
  rapporteurs?: unknown;
};

type TexteRow = {
  uid: string;
  date_creation: string | null;
  date_publication: string | null;
  date_depot: string | null;
  denomination: string | null;
  titre_principal_court: string | null;
  lien_texte: string | null;
  libelle_statut_adoption: string | null;
  provenance: string | null;
  url_accessible: boolean | null;
  date_accessible: string | null;
  is_version_consolidee: boolean | null;
  type_libelle: string | null;
  organe_auteur: { libelle: string } | null;
  resume_ia: string | null;
  resume_ia_en: string | null;
  resume_ia_prompt_version: string | null;
  resume_ia_prompt_version_en: string | null;
  /** Vrai quand `contenu_legifrance` est rempli, lu par une requête à part (voir
   *  `contenus`). Une loi prend sa provenance Légifrance avant que l'import
   *  nocturne n'ait récupéré son texte : sans contenu ni lien, `/api/resume-loi`
   *  n'a rien à lire et refuse. */
  contenu_stocke: boolean;
};

/** Ligne telle que lue en base : les références d'élus ne servent qu'au serveur. */
type TexteRowBrut = Omit<TexteRow, 'contenu_stocke'> & {
  auteurs_refs: string[] | null;
  cosignataires_refs: string[] | null;
  rapporteurs_refs: string[] | null;
};

type DossierRow = {
  initiateur_acteur_ref?: unknown;
  initiateur_groupe_libelle?: string | null;
  textes_associes_refs?: string[] | null;
  nb_amendements_deposes?: number | null;
  nb_amendements_adoptes?: number | null;
  /** jsonb, voir `repartitionDuDossier`. */
  amendements_par_groupe?: unknown;
  date_depot?: string | null;
  date_promulgation?: string | null;
  statut_final?: string | null;
  procedure_libelle?: string | null;
  titre?: string | null;
  titre_en?: string | null;
  lien_an?: string | null;
  lien_senat?: string | null;
  url_legifrance?: string | null;
};

// Dossiers de contrôle : leur produit est un rapport, pas une loi. Ce sont trois des
// procédures de `PROCEDURES_NON_VOTABLES` (import_dossiers_cloud.py), les pétitions et
// allocutions n'ayant pas de rapport.
const PROCEDURES_CONTROLE = new Set([
  "Commission d'enquête",
  "Mission d'information",
  "Rapport d'information sans mission",
]);

// Valeurs de `textes.type_libelle` des documents qui commentent un texte sans en
// être une version : la fiche ne les ouvre par défaut qu'à défaut d'autre chose.
// Le rapport d'un dossier de contrôle, lui, passe avant cette règle (`rapportDuDossier`).
const TYPES_ACCOMPAGNEMENT = new Set([
  'Rapport',
  "Rapport d'information",
  'Avis',
  "Avis du Conseil d'Etat",
  "Etude d'impact",
]);

type RapportControle<T> = { rapport: T; tomes: T[]; doublon: T | null };

/** Rapport d'un dossier de contrôle, à partir de l'acte qui en dit le dépôt.
 *
 *  À l'Assemblée, l'acte cite le rapport « parent » (`RAPPANR5L17B2698`), dont le lien
 *  mène déjà au tome 1 ; les tomes sont des textes à part, `<parent>-t1`, `-t2`, `-tI`,
 *  `-tII`… Celui qui partage le lien du parent est le même document vu deux fois
 *  (`doublon`). Au Sénat, l'acte `SN20-RAPPORT` ne cite rien, mais chacun de ces dossiers
 *  a exactement un texte (383 sur 383 le 2026-10-10) : c'est le rapport.
 *  Rend null tant que le rapport n'est pas déposé. */
function rapportDuDossier<T extends { uid: string; lien_texte: string | null }>(
  acteDepot: ActeRow | undefined,
  textes: T[],
): RapportControle<T> | null {
  if (!acteDepot) return null;
  const uidCite = acteDepot.textes_associes?.[0];
  const rapport = uidCite
    ? textes.find((t) => t.uid === uidCite)
    : textes.length === 1 ? textes[0] : undefined;
  if (!rapport) return null;
  const tomesBruts = textes.filter((t) => t.uid.startsWith(`${rapport.uid}-t`));
  const doublon = tomesBruts.find((t) => !!t.lien_texte && t.lien_texte === rapport.lien_texte) ?? null;
  // Tri explicite : la liste reçue est en `uid` décroissant (voir la requête `textes`),
  // le menu des versions doit lire Tome 2 avant Tome 3.
  const tomes = tomesBruts
    .filter((t) => t !== doublon)
    .sort((a, b) => a.uid.localeCompare(b.uid, undefined, { numeric: true }));
  return { rapport, tomes, doublon };
}

/** L'auteur ou un rapporteur tel que le hero le nomme, depuis une ligne lue avec
 *  `COLONNES_CONTACT` : sa fonction d'aujourd'hui (`fonctionElu`) et la civilité qui
 *  l'accorde. */
function normalizeActeur(raw: RawContact | RawContact[] | null | undefined): Auteur {
  if (!raw) return null;
  const a = Array.isArray(raw) ? raw[0] : raw;
  if (!a) return null;
  return {
    uid: a.uid ?? null,
    prenom: a.prenom ?? null,
    nom: a.nom ?? null,
    civ: a.civ ?? null,
    fonction: fonctionElu(a),
    groupe: Array.isArray(a.groupe) ? a.groupe[0] ?? null : a.groupe ?? null,
  };
}

export default async function ResumeIAPage({ params }: { params: Promise<{ locale: string; uid: string }> }) {
  const { locale, uid } = await params;
  if (!estUidDossier(uid)) notFound();
  setRequestLocale(locale);

  // FAST PATH — Hero data : dossier + actes en parallèle
  const [dossiers, actes, rapporteurActes, profils] = await Promise.all([
    // `initiateur_acteur_ref` est l'objet de l'acteur visé par la colonne du même nom,
    // ou null. `to_jsonb` et non `to_json` : les appelants attendent cet objet en jsonb,
    // clés rangées par longueur de nom puis par ordre alphabétique (`civ`, `nom`, `uid`,
    // `email`…), et non dans l'ordre de `COLONNES_CONTACT`.
    sql<(DossierRow & { initiateur_acteur_ref: RawContact | null })[]>`
      select d.titre, d.titre_en, d.statut_final, d.procedure_libelle, d.date_depot, d.date_promulgation, d.lien_an,
        d.lien_senat, d.url_legifrance, d.nb_amendements_deposes, d.nb_amendements_adoptes, d.amendements_par_groupe,
        d.initiateur_groupe_libelle, d.textes_associes_refs,
        (select to_jsonb(c) from (select ${COLONNES_CONTACT} from acteurs a where a.uid = d.initiateur_acteur_ref) c)
          as initiateur_acteur_ref
      from dossiers_legislatifs d
      where d.uid = ${uid}
      limit 1`,
    // Du plus ancien au plus récent, `uid` départageant les actes du même jour (D-329).
    // Les lectures qui en dépendent (`ccActe`, `cmpSaisie`, `promPub`, `acteByCode`)
    // prennent le premier trouvé : sans tri, ce premier suivait le plan d'exécution.
    sql<ActeRow[]>`
      select uid, code_acte, libelle_acte, date_acte, parent_uid, vote_refs, textes_associes, texte_adopte,
        statut_conclusion, organe_ref, url_conclusion, resume_cc, articles_censures, resume_cc_en, articles_censures_en
      from actes_legislatifs
      where dossier_uid = ${uid}
        and (code_acte = any(${PARCOURS_ACTE_CODES}) or vote_refs is not null or textes_associes is not null
          or texte_adopte is not null)
      order by date_acte asc nulls last, uid`,
    // Tous les actes, le plus récent en tête : voir `rapporteursNommes` plus bas pour
    // les dossiers qui en ont plusieurs.
    sql<{ rapporteurs: Rapporteurs | null }[]>`
      select rapporteurs
      from actes_legislatifs
      where dossier_uid = ${uid} and code_acte = any(${['AN20-COMENQ-NOMIN', 'AN20-MISINF-NOMIN']})
      order by date_acte desc, uid desc`,
    // Un des profils que le texte touche, n'importe lequel : seule compte la présence
    // d'une ligne. Aucune pour un texte que `classer_articles.py` n'a pas classé, dont
    // la section « Ce qui change pour vous » dit alors l'absence.
    sql<{ profil: string }[]>`
      select profil from impacts_profils_dossiers where dossier_uid = ${uid} limit 1`,
  ]);

  // Une panne lève (D-136) ; seul un dossier absent de la base rend un 404.
  const dossier = dossiers[0];
  if (!dossier) notFound();
  const classe = profils.length > 0;

  // hasProcedureAcceleree : seul calcul nécessaire pour le hero (le reste est fait dans DossierBody)
  const hasProcedureAcceleree = actes.some((a: ActeRow) =>
    a.code_acte === 'AN1-PROCACC' || a.code_acte === 'SN1-PROCACC'
  );

  // Scrutins avec votes nominatifs (pour le statut de vote de l'élu dans le footer du hero) —
  // requête légère et indépendante du heavy path streamé dans DossierBody.
  type ScrutinEluVote = {
    uid: string;
    date_scrutin: string | null;
    sort_code: string | null;
    chambre: string | null;
    type_vote_code: string | null;
    // L'intitulé ne sert qu'à reconnaître une motion de rejet (`estMotionRejet`).
    titre: string | null;
    votes_nominatifs: Record<string, string[]> | null;
  };
  // Scrutin → lecture, pour que la phrase du hero dise sur quel vote elle porte.
  const lectureKeyByScrutin: Record<string, string> = {};
  for (const a of actes as ActeRow[]) {
    const milestone = milestoneOf(a.code_acte);
    const lectureKey = milestone ? LECTURE_KEY_BY_MILESTONE[milestone] : undefined;
    if (!lectureKey) continue;
    for (const ref of a.vote_refs ?? []) lectureKeyByScrutin[ref] = lectureKey;
  }
  const voteRefsForElus = [...new Set(actes.flatMap((a: ActeRow) => a.vote_refs ?? []))];
  // Trié par `uid` pour que la page figée ne change pas avec le plan d'exécution
  // (D-329) ; le bandeau choisit lui-même son scrutin par date. La requête ne part
  // qu'à son `await`, plus bas.
  const scrutinsEluVotePromise = voteRefsForElus.length > 0
    ? sql<ScrutinEluVote[]>`
        select uid, date_scrutin, sort_code, chambre, type_vote_code, titre, votes_nominatifs
        from scrutins
        where uid = any(${voteRefsForElus}) and votes_nominatifs is not null
        order by uid`
    : null;

  // Rapporteur : présent uniquement pour les commissions d'enquête et les missions
  // d'information de l'Assemblée (AN20-COMENQ-NOMIN, AN20-MISINF-NOMIN)
  type RapporteurRef = { acteurRef?: string | null };
  type Rapporteurs = { rapporteur?: RapporteurRef | RapporteurRef[] };
  // Un acte nomme parfois plusieurs co-rapporteurs (20 missions d'information sur 26
  // le 2026-10-10, de deux à treize noms) : la source rend alors un tableau.
  const refsDeLActe = (r: Rapporteurs | null | undefined): string[] =>
    (Array.isArray(r?.rapporteur) ? r.rapporteur : r?.rapporteur ? [r.rapporteur] : [])
      .map((x) => x.acteurRef).filter((ref): ref is string => !!ref);
  const refsParActe = rapporteurActes.map((a) => refsDeLActe(a.rapporteurs));
  let rapporteursNommes: string[] = refsParActe[0] ?? [];
  // Trois dossiers ont deux actes de nomination, que rien dans la donnée ne distingue
  // (2026-10-20). Sur DLR5L17N53108, les deux nomment la même personne. Sur
  // DLR5L17N52420, le second remplace le premier, devenu ministre ; sur DLR5L17N52319,
  // ce sont deux co-rapporteurs. Quand les actes nomment des personnes différentes, le
  // rapport publié tranche : ses `rapporteurs_refs` disent qui l'a rendu (Bloch seul
  // sur 52420, Habib et Tabarot sur 52319). Sans rapport, l'acte le plus récent, seul
  // choix juste dans le cas d'un remplacement.
  const tousNommes = [...new Set(refsParActe.flat())];
  if (tousNommes.length > rapporteursNommes.length) {
    const rapports = await sql<{ rapporteurs_refs: string[] }[]>`
      select rapporteurs_refs
      from textes
      where dossier_ref = ${uid} and rapporteurs_refs is not null
      order by date_creation asc, uid desc`;
    const duRapport = [...new Set(rapports.flatMap((t) => t.rapporteurs_refs))].filter((ref) => tousNommes.includes(ref));
    if (duRapport.length > 0) rapporteursNommes = duRapport;
  }
  let rapporteurRefs = rapporteursNommes;

  // Auteur : initiateur direct ou fallback (rare, ~200-400ms supplémentaires si déclenché)
  // Pas de fallback quand un rapporteur est nommé (commission d'enquête, mission
  // d'information) : pas d'initiateur individuel. Mesuré le 2026-10-19 : aucun des 45
  // dossiers à acte de nomination n'a d'initiateur, l'auteur et les rapporteurs ne se
  // disputent donc jamais la bande du pied.
  let auteurBrut = dossier.initiateur_acteur_ref;
  const repli = !auteurBrut && rapporteurRefs.length === 0 ? await lireTextesDeRepli(uid) : null;
  if (repli?.auteurRef) auteurBrut = await chargerAuteur(repli.auteurRef);
  const auteur = normalizeActeur(auteurBrut);
  const origineGouvernementale = estOrigineGouvernementale(
    (dossier as DossierRow).textes_associes_refs,
    (dossier as DossierRow).initiateur_groupe_libelle,
  );

  // Ni nomination, ni auteur, ni Gouvernement : les rapporteurs se lisent dans les
  // textes, déjà lus avec l'auteur de repli, et le hero les nomme comme ceux d'une
  // commission d'enquête.
  if (rapporteurRefs.length === 0 && !auteurBrut && !origineGouvernementale) {
    rapporteurRefs = repli?.rapporteurRefs ?? [];
  }

  // Le hero n'en nomme que deux (voir DossierHero) : seules ces fiches sont chargées,
  // les autres ne comptent que dans le total. La bande du pied montre les mêmes.
  let rapporteurs: { liste: NonNullable<Auteur>[]; total: number } | null = null;
  let rapporteursContact: PersonneContact[] = [];
  if (rapporteurRefs.length > 0) {
    const affiches = rapporteurRefs.slice(0, RAPPORTEURS_AFFICHES);
    const rapporteurData = await sql<RawContact[]>`
      select ${COLONNES_CONTACT} from acteurs a where a.uid = any(${affiches}) order by a.uid`;
    // L'ordre de nomination est celui de la source, pas celui de la requête.
    const parUid = new Map(rapporteurData.map((a) => [a.uid, a]));
    const liste = affiches
      .map((ref) => normalizeActeur(parUid.get(ref)))
      .filter((a): a is NonNullable<Auteur> => a !== null);
    if (liste.length > 0) rapporteurs = { liste, total: rapporteurRefs.length };
    rapporteursContact = affiches
      .map((ref) => versPersonneContact(parUid.get(ref)))
      .filter((p): p is PersonneContact => p !== null);
  }

  // À droite des élus du lecteur : le Gouvernement pour ses textes, sinon l'auteur, sinon
  // les rapporteurs (`droiteBandeau`, la règle partagée avec la page d'un vote).
  const droite = droiteBandeau(origineGouvernementale, auteurBrut, { personnes: rapporteursContact, total: rapporteurRefs.length });

  // Décision du Conseil constitutionnel, cherchée une seule fois : l'en-tête en tire
  // sa pastille, le corps sa section et sa carte du parcours. Deux recherches
  // séparées pourraient un jour désigner deux décisions différentes.
  const ccActe = (actes as ActeRow[]).find((a) => a.code_acte === 'CC-CONCLUSION') ?? null;

  const scrutinsForEluVote = (scrutinsEluVotePromise ? await scrutinsEluVotePromise : [])
    .map((s) => ({ ...s, lectureKey: lectureKeyByScrutin[s.uid] ?? null }));

  return (
    <>
      <DossierHero
        uid={uid}
        locale={locale}
        titre={titreDossier(dossier, locale) || (locale === 'en' ? 'Title unavailable' : 'Titre indisponible')}
        // Le titre officiel, sous le titre traduit ; absent quand rien n'est traduit.
        titreOfficiel={titreTraduit(dossier, locale) ? dossier.titre ?? null : null}
        statutFinal={dossier.statut_final ?? null}
        procedureLibelle={dossier.procedure_libelle ?? null}
        hasProcedureAcceleree={hasProcedureAcceleree}
        dateDepot={dossier.date_depot ?? null}
        lienAN={dossier.lien_an ?? null}
        lienSenat={dossier.lien_senat ?? null}
        lienLegifrance={dossier.url_legifrance ?? null}
        lienCC={ccActe?.url_conclusion ?? null}
        nbAmendementsDeposes={(dossier as DossierRow).nb_amendements_deposes ?? null}
        nbAmendementsAdoptes={(dossier as DossierRow).nb_amendements_adoptes ?? null}
        auteur={auteur}
        origineGouvernementale={origineGouvernementale}
        rapporteurs={rapporteurs}
        footer={
          <ContacterMesElusBanner
            dossier={{
              uid,
              titre: dossier.titre ?? null,
              statut: dossier.statut_final ?? null,
            }}
            scrutins={scrutinsForEluVote}
            droite={droite}
          />
        }
      />
      {classe && <ChoixProfilsModal />}
      <Suspense fallback={<DossierBodySkeleton locale={locale} pourVous={classe} modifications={((dossier as DossierRow).nb_amendements_deposes ?? 0) > 0} cc={ccActe !== null} controle={PROCEDURES_CONTROLE.has(dossier.procedure_libelle ?? '')} />}>
        <DossierBody
          uid={uid}
          locale={locale}
          dossier={dossier}
          actes={actes}
          ccActe={ccActe}
          classe={classe}
          rapporteursNommes={rapporteursNommes}
        />
      </Suspense>
    </>
  );
}

/**
 * Élus de la section « Sources et acteurs », résolus depuis les références portées
 * par les textes du dossier, plus les rapporteurs nommés par l'acte de nomination
 * d'une mission ou d'une commission d'enquête (`rapporteursNommes`, que le hero
 * nomme aussi) : 21 des 45 dossiers à acte de nomination n'avaient aucun texte le
 * 2026-10-20, et la section restait vide sous un en-tête qui citait leurs
 * rapporteurs. Appelée par `DossierBody` sans attendre : sa requête `acteurs` court
 * pendant le calcul du parcours et la requête des scrutins, qui n'en dépendent pas.
 */
async function elusDesSources(textesBruts: TexteRowBrut[], rapporteursNommes: string[]) {
  // Élus de la section « Sources et acteurs », réunis sur tous les textes du dossier.
  // `auteurs_refs` n'existe que sur les textes de dépôt, et les rapports, avis et
  // annexes ne portent que `rapporteurs_refs` : l'union par colonne donne donc des
  // rôles propres. Un même élu peut être auteur et rapporteur, c'est fréquent sur une
  // proposition de loi. Un auteur est en revanche retiré des cosignataires : la ligne
  // repliée compte ceux qui ont rejoint le texte, pas ceux qui l'ont écrit.
  //
  // Le badge d'un élu, quel que soit son rôle, dit son rôle dans ce texte-là,
  // pas sa fonction d'aujourd'hui : un dossier ancien compte beaucoup d'élus sortis
  // depuis, et un député devenu ministre ne doit pas s'afficher « Gouvernement » sur
  // un texte écrit comme député. La chambre se lit dans l'identifiant du texte
  // (`PIONANR5…`, `RAPPSNR5…`), et l'auteur d'un projet de loi (`PRJL…`) est le
  // Gouvernement. Mesuré sur toute la base le 2026-10-10, d'après
  // `acteurs.roles_text` : 96,6 à 99,9 % des auteurs et rapporteurs d'un texte de
  // l'Assemblée ou du Sénat ont eu un mandat dans cette chambre (le plus bas : les
  // rapporteurs de l'Assemblée), et 97,6 à 100 % des auteurs d'un projet de loi ont
  // été ministres. Mesuré le 2026-10-16 sur les cosignataires, par paire dossier ×
  // élu : 98,7 % de ceux d'un texte de l'Assemblée ont eu un mandat de député, et
  // 99,3 % de ceux d'un texte du Sénat un mandat de sénateur. Les textes arrivent
  // dans l'ordre chronologique : un élu présent dans plusieurs garde le premier badge
  // connu, un texte dont la chambre ne se lit pas dans l'identifiant ne fixant rien.
  const badgesDe = (col: 'auteurs_refs' | 'rapporteurs_refs' | 'cosignataires_refs') => {
    const badges = new Map<string, BadgeElu | null>();
    for (const t of textesBruts) {
      const chambre = t.uid.match(/^[A-Z]+?(AN|SN)R\d/)?.[1];
      const badge: BadgeElu | null = col === 'auteurs_refs' && t.uid.startsWith('PRJL')
        ? 'gouvernement'
        : chambre === 'AN' ? 'depute' : chambre === 'SN' ? 'senateur' : null;
      for (const ref of t[col] ?? []) if (!badges.get(ref)) badges.set(ref, badge);
    }
    return badges;
  };
  const auteursRefs = badgesDe('auteurs_refs');
  const rapporteursRefs = badgesDe('rapporteurs_refs');
  // L'acte de nomination est un acte de l'Assemblée (`AN20-…-NOMIN`), d'où le badge
  // de député ; un rapporteur que ses textes nomment déjà garde le badge de son texte,
  // sauf si aucun de ces textes ne fixait de chambre (badge nul, comme dans `badgesDe`).
  for (const ref of rapporteursNommes) if (!rapporteursRefs.get(ref)) rapporteursRefs.set(ref, 'depute');
  const cosignatairesRefs = badgesDe('cosignataires_refs');
  for (const r of auteursRefs.keys()) cosignatairesRefs.delete(r);
  // `.keys()` sur les trois : déroulée, une Map rend des paires `[uid, badge]`, que le
  // SQL refuse (`any` attend une liste d'uid).
  const tousRefs = [...new Set([...auteursRefs.keys(), ...rapporteursRefs.keys(), ...cosignatairesRefs.keys()])];
  // Au plus quelques centaines de lignes (336 cosignataires au maximum mesuré).
  // La clé primaire départage les homonymes.
  const acteursSources = tousRefs.length > 0
    ? await sql<(RawActeur & DrapeauxMandat & { url_profil_officiel?: string | null })[]>`
        select ${COLONNES_ELU_SOURCE} from acteurs a where a.uid = any(${tousRefs}) order by a.nom, a.uid`
    : [];
  const elusSources = (await completerGroupesAnciens(acteursSources)).map(versEluSource);
  // Élus d'un rôle, triés par nom comme la requête, avec le badge de ce rôle.
  const avecBadge = (badges: Map<string, BadgeElu | null>) => elusSources
    .filter((e) => badges.has(e.uid))
    .map((e) => ({ ...e, badge: badges.get(e.uid) ?? null }));
  return {
    auteurs: avecBadge(auteursRefs),
    rapporteurs: avecBadge(rapporteursRefs),
    cosignataires: avecBadge(cosignatairesRefs),
  };
}

// Rang des lignes du graphique qui ne sont pas des groupes : après eux, dans cet ordre.
const RANG_TYPE: Record<LigneRepartition['type'], number> = {
  groupe: 0, gouvernement: 1, commission: 2, non_publie: 3, sans_groupe: 4,
};

/**
 * Lignes du graphique de la section « Modifications du texte », depuis la valeur
 * brute de `dossiers_legislatifs.amendements_par_groupe` (une entrée par chambre et
 * par auteur, voir `import_amendements.py`). Une lecture d'`organes` donne aux
 * groupes libellé et couleur ; `rangsHemicycle` les range dans l'ordre où ils siègent,
 * une lecture des élus par chambre. Puis le Gouvernement, la commission, les retirés
 * avant la séance et les sans groupe. Lancée par `DossierBody` avec les autres
 * requêtes ; lève sur une panne, comme elles (D-136).
 *
 * Le jsonb n'est filtré qu'à la forme : le schéma n'en contraint pas le contenu.
 */
async function repartitionDuDossier(brut: unknown): Promise<LigneRepartition[]> {
  type Brute = { chambre: 'AN' | 'SN'; type: LigneRepartition['type']; groupe: string | null; deposes: number; adoptes: number };
  const lignes = (Array.isArray(brut) ? brut : []).filter((l): l is Brute =>
    (l?.chambre === 'AN' || l?.chambre === 'SN') && Object.hasOwn(RANG_TYPE, l.type)
    && typeof l.deposes === 'number' && typeof l.adoptes === 'number' && l.deposes > 0);
  const uidsDe = (chambre: 'AN' | 'SN') => [...new Set(lignes
    .filter((l) => l.chambre === chambre && l.type === 'groupe' && l.groupe)
    .map((l) => l.groupe as string))];
  const uids = [...uidsDe('AN'), ...uidsDe('SN')];
  // Une vingtaine de groupes au plus.
  const organes = uids.length > 0
    ? await sql<{ uid: string; libelle: string | null; libelle_abrege: string | null; couleur_associee: string | null }[]>`
        select uid, libelle, libelle_abrege, couleur_associee from organes where uid = any(${uids}) order by uid`
    : [];
  const organe = new Map(organes.map((o) => [o.uid, o]));
  const pourRangs = (chambre: 'AN' | 'SN') => uidsDe(chambre).map((uid) => ({ uid, libelleAbrege: organe.get(uid)?.libelle_abrege ?? null }));
  const [rangsAN, rangsSN] = await Promise.all([rangsHemicycle('AN', pourRangs('AN')), rangsHemicycle('SEN', pourRangs('SN'))]);

  const resolues = lignes.map((l) => {
    const o = l.type === 'groupe' && l.groupe ? organe.get(l.groupe) : undefined;
    const ligne: LigneRepartition = {
      cle: `${l.chambre}:${l.type}:${l.groupe ?? ''}`,
      chambre: l.chambre,
      type: l.type,
      libelle: o?.libelle_abrege ?? null,
      libelleLong: o?.libelle ?? null,
      couleur: o?.couleur_associee ?? null,
      deposes: l.deposes,
      adoptes: l.adoptes,
    };
    const rang = l.groupe ? (l.chambre === 'AN' ? rangsAN : rangsSN).get(l.groupe) ?? 0 : 0;
    return { ligne, rang };
  });
  // L'AN d'abord, puis l'ordre des types ; un rang égal (groupe sans siège) se
  // départage par le nombre de déposés, la clé en dernier.
  return resolues.sort((a, b) =>
    (a.ligne.chambre === b.ligne.chambre ? 0 : a.ligne.chambre === 'AN' ? -1 : 1)
    || RANG_TYPE[a.ligne.type] - RANG_TYPE[b.ligne.type]
    || a.rang - b.rang
    || b.ligne.deposes - a.ligne.deposes
    || a.ligne.cle.localeCompare(b.ligne.cle)).map((r) => r.ligne);
}

/**
 * Le texte assemblé pour tous les profils de « Ce qui me concerne », pour la section
 * « Ce qui change pour vous », ou null s'il n'a aucun élément. Lancée par `DossierBody`
 * avec les autres requêtes. `version` suit la règle de l'index de « Ce qui me
 * concerne » : l'instant du rendu, ajouté (`v=`) à la requête du tiroir, pour que le
 * CDN ne serve pas le détail d'avant une régénération. Hors du composant :
 * `react-hooks/purity` y refuse `Date.now()`.
 */
async function texteParProfils(uid: string, locale: string) {
  const [d] = await assemblerDossiers([uid], locale);
  return d?.elements.length ? { dossier: d, version: Date.now().toString(36) } : null;
}

async function DossierBody({
  uid,
  locale,
  dossier,
  actes,
  ccActe,
  classe,
  rapporteursNommes,
}: {
  uid: string;
  locale: string;
  dossier: DossierRow & Record<string, unknown>;
  actes: ActeRow[];
  /** Acte `CC-CONCLUSION` du dossier, choisi par la page (voir `ccActe` plus haut). */
  ccActe: ActeRow | null;
  /** Vrai si le texte touche au moins un profil de « Ce qui me concerne ». */
  classe: boolean;
  /** Rapporteurs de l'acte de nomination, lus par la page pour le hero ; la section
   *  « Sources et acteurs » les liste aussi (`elusDesSources`). */
  rapporteursNommes: string[];
}) {
  const [tSteps, tMonth, tDenomination] = await Promise.all([
    getTranslations({ locale, namespace: 'steps' }),
    getTranslations({ locale, namespace: 'month' }),
    getTranslations({ locale, namespace: 'denomination' }),
  ]);
  const promptVersion = getPromptVersion(locale);

  // HEAVY PATH — toutes les requêtes du body en parallèle
  const [textesBruts, articlesPresse, debatsStats, application, contenus] = await Promise.all([
    // `organe_auteur` est l'objet `{ libelle }` de l'organe visé par `organe_auteur_ref`,
    // ou null. Il vient en dernier, après les colonnes simples : c'est l'ordre des clés
    // que reçoit le client.
    // Départage par `uid` : plusieurs textes d'un dossier partagent souvent la même
    // date, et sans lui leur ordre était arbitraire, donc aussi le texte ouvert par
    // défaut, pris en fin de liste (le tri JS ci-dessous est stable et garde cet
    // ordre). Le sens décroissant faisait passer le texte adopté en commission
    // (`PION…`, `PRJL…`) après son rapport (`RAPP…`, `-COMPA`) du même jour ; depuis
    // que la sélection écarte les documents d'accompagnement (`TYPES_ACCOMPAGNEMENT`),
    // il ne départage plus que des textes de même date et de même rang. La section
    // « Sources et acteurs » affiche aussi cet ordre.
    sql<TexteRowBrut[]>`
      select t.uid, t.date_creation, t.date_publication, t.date_depot, t.denomination, t.titre_principal_court,
        t.lien_texte, t.libelle_statut_adoption, t.provenance, t.url_accessible, t.date_accessible,
        t.is_version_consolidee, t.type_libelle, t.resume_ia, t.resume_ia_en, t.resume_ia_prompt_version,
        t.resume_ia_prompt_version_en, t.auteurs_refs, t.cosignataires_refs, t.rapporteurs_refs,
        (select jsonb_build_object('libelle', o.libelle) from organes o where o.uid = t.organe_auteur_ref) as organe_auteur
      from textes t
      where t.dossier_ref = ${uid}
        and not (t.uid ilike '%TAP%')
      order by t.date_creation asc, t.uid desc`,
    // Plusieurs articles tombent le même jour : `url` les départage (D-329), et
    // décide donc aussi lesquels entrent dans les cinq.
    sql<{ titre: string; url: string; source_nom: string; source_url: string | null; date_publication: string | null }[]>`
      select titre, url, source_nom, source_url, date_publication
      from articles_presse
      where dossier_uid = ${uid} and url_accessible = true
      order by date_publication desc, url
      limit 5`,
    // Vue d'agrégation : une ligne au lieu des interventions du dossier, qui montent
    // à 15 402 sur le plus gros.
    auPlusUneLigne(sql<{ nb_interventions: number | null; nb_seances_an: number | null; nb_seances_sen: number | null; derniere_seance: string | null }[]>`
      select nb_interventions, nb_seances_an, nb_seances_sen, derniere_seance
      from dossiers_debats_stats
      where dossier_uid = ${uid}`, 'dossiers_debats_stats'),
    // `dossier_uid` n'est pas unique (la clé est `jorftext_id`, une ligne par loi) :
    // sans `limit 1`, deux lois rattachées au même dossier feraient lever
    // `auPlusUneLigne`, et la page serait bloquée à chaque régénération.
    auPlusUneLigne(sql<{ nb_mesures_attendues: number | null; nb_mesures_appliquees: number | null; statut_application: string | null }[]>`
      select nb_mesures_attendues, nb_mesures_appliquees, statut_application
      from application_lois
      where dossier_uid = ${uid}
      order by jorftext_id
      limit 1`, 'application_lois'),
    // Les textes dont le contenu Légifrance est stocké, `uid` seul : le contenu monte
    // à 500 Ko par ligne et ne doit pas voyager pour savoir s'il existe. `<> ''`
    // écarte aussi les NULL, et la chaîne vide compte comme absente, comme dans
    // `/api/resume-loi` (test de vérité) et dans `import_legifrance_cloud.py`.
    sql<{ uid: string }[]>`
      select uid from textes where dossier_ref = ${uid} and contenu_legifrance <> '' order by uid`,
  ]);

  const uidsAvecContenu = new Set(contenus.map((r) => r.uid));

  // Lancée tout de suite, attendue au rendu : voir `elusDesSources`. Le `catch` vide
  // ne fait que marquer l'échec comme suivi, au cas où une autre requête lèverait
  // avant l'`await` : l'erreur ressort quand même à l'`await` plus bas.
  const elusSourcesPromise = elusDesSources(textesBruts, rapporteursNommes);
  elusSourcesPromise.catch(() => {});
  // Rien à lire pour un dossier sans amendement déposé, dont la section est absente.
  const nbDeposes = dossier.nb_amendements_deposes ?? 0;
  const amendementsPromise = nbDeposes > 0 ? amendementsAdoptes(uid) : Promise.resolve([]);
  amendementsPromise.catch(() => {});
  const repartitionPromise = nbDeposes > 0 ? repartitionDuDossier(dossier.amendements_par_groupe) : Promise.resolve([]);
  repartitionPromise.catch(() => {});
  const elusActifsPromise = elusActifs(uid);
  elusActifsPromise.catch(() => {});
  // Le texte pour tous les profils, que le navigateur filtre selon ceux du lecteur
  // (voir PourVous.tsx) : la page reste la même pour tous.
  const pourVousPromise = classe ? texteParProfils(uid, locale) : Promise.resolve(null);
  pourVousPromise.catch(() => {});

  // Les références d'élus sont retirées : elles montent à 336 identifiants par texte
  // et le client n'en a pas l'usage, `elusDesSources` les ayant déjà résolues.
  // La dénomination (« Proposition de loi », « Tome II ») est traduite ici, une fois :
  // sélecteur de documents, tomes d'un rapport, texte voté et lien du rapport la
  // reprennent tous, et le client n'a pas à recevoir le namespace `denomination`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- retirées par déstructuration
  const textes = textesBruts.map(({ auteurs_refs, cosignataires_refs, rapporteurs_refs, ...t }) => ({
    ...t,
    denomination: traduireDenomination(t.denomination, tDenomination),
    contenu_stocke: uidsAvecContenu.has(t.uid),
  })).sort((a: TexteRow, b: TexteRow) => {
    const dateA = dateTexte(a) || '';
    const dateB = dateTexte(b) || '';
    if (!dateA && dateB) return 1;
    if (dateA && !dateB) return -1;
    return dateA.localeCompare(dateB);
  });

  // Cache : map uid → résumé pour les textes dont le prompt est à jour. La
  // version se lit dans la colonne de la langue affichée, pas dans une colonne
  // partagée : voir api/resume-loi/route.ts.
  const cachedResumes: Record<string, string> = {};
  for (const t of textes) {
    if (locale === 'en' && t.resume_ia_en && t.resume_ia_prompt_version_en === promptVersion) {
      cachedResumes[t.uid] = t.resume_ia_en;
    } else if (locale !== 'en' && t.resume_ia && t.resume_ia_prompt_version === promptVersion) {
      cachedResumes[t.uid] = t.resume_ia;
    }
  }

  // Ce que la fiche lit seule dans les actes. Le parcours lui-même vient de
  // `parcoursDuDossier`, que la page d'un vote appelle aussi.
  const actesAvecVote: { vote_refs: string[]; textes_associes: string[] }[] = [];
  let derniereDateActe: Date | null = null;
  const ccSaisineCounts: Record<'PM' | 'AN' | 'SN' | 'DROIT', number> = { PM: 0, AN: 0, SN: 0, DROIT: 0 };
  const depotDate = dossier?.date_depot ? new Date(dossier.date_depot) : null;
  const datePromDate = dossier?.date_promulgation ? new Date(dossier.date_promulgation) : null;

  for (const acte of actes) {
    const code: string = acte.code_acte;

    if (code === 'CC-SAISIE-PM') ccSaisineCounts.PM++;
    else if (code === 'CC-SAISIE-AN') ccSaisineCounts.AN++;
    else if (code === 'CC-SAISIE-SN') ccSaisineCounts.SN++;
    else if (code === 'CC-SAISIE-DROIT') ccSaisineCounts.DROIT++;

    if (acte.vote_refs && acte.vote_refs.length > 0) {
      actesAvecVote.push({ vote_refs: acte.vote_refs, textes_associes: acte.textes_associes ?? [] });
    }

    if (!acte.date_acte) continue;
    const d = new Date(acte.date_acte);
    if (!derniereDateActe || d > derniereDateActe) derniereDateActe = d;
  }

  const {
    etapes: etapesParcours,
    milestoneDateMap,
    decappLastDate,
    dateJO,
    isAppDirecte,
    isAppAppliquee,
    isSansEcheancier,
  } = parcoursDuDossier(actes, dossier, textes, application?.statut_application ?? null);

  const toDays = (from: Date | null, to: Date | null) =>
    from && to && to >= from ? Math.round((to.getTime() - from.getTime()) / 86400000) : null;
  const today = new Date();
  const isRejected = dossier?.statut_final === 'Rejeté';
  // Jusqu'à la date que la frise donne à la promulgation, le Journal officiel (voir
  // `dateJO`), sinon la durée contredirait les dates affichées d'un jour ou deux.
  // Un texte rejeté s'arrête à son dernier acte, le vote qui l'a rejeté : compté jusqu'à
  // aujourd'hui, DLR5L17N53258, rejeté par le Sénat quatre mois après son dépôt,
  // affichait « 11 mois » et grandissait chaque jour. « Rejeté par l'Assemblée
  // nationale » ou « par le Sénat » laisse le texte en navette : il court toujours.
  const dureeTotal = toDays(
    depotDate,
    (dateJO ? new Date(dateJO) : datePromDate) ?? (isRejected ? derniereDateActe : null) ?? today,
  );

  const dureeApplication = isAppAppliquee && !isAppDirecte && depotDate && decappLastDate
    ? toDays(depotDate, decappLastDate)
    : null;

  const isDossierControle = PROCEDURES_CONTROLE.has(dossier?.procedure_libelle ?? '');

  let timelineSteps: TimelineStep[];
  // Rapport d'un dossier de contrôle, ses tomes, et l'étape du parcours qui les porte :
  // lus plus bas par le menu des versions et le choix du texte par défaut.
  let rapportControle: RapportControle<(typeof textes)[number]> | null = null;
  let etapeRapport: string | null = null;
  if (isDossierControle) {
    // Un code peut porter plusieurs actes : trois dossiers ont deux nominations de
    // rapporteur. L'étape garde le plus ancien, date de la première nomination ; un
    // simple `new Map(actes.map(…))` gardait le dernier de la liste, dont l'ordre n'est
    // pas défini.
    const acteByCode = new Map<string, ActeRow>();
    for (const a of actes as ActeRow[]) {
      const deja = acteByCode.get(a.code_acte);
      if (!deja || (a.date_acte ?? '9999') < (deja.date_acte ?? '9999')) acteByCode.set(a.code_acte, a);
    }
    // Commissions d'enquête et missions d'information de l'Assemblée : la source publie
    // la création, la nomination du rapporteur et le dépôt. Rapports d'information et
    // commissions d'enquête du Sénat : le dépôt seul. On n'invente pas d'étapes « en
    // attente » que la source ne publiera jamais : c'est ce qu'affichaient les 15
    // commissions du Sénat, rapport pourtant déposé, sous le parcours de l'Assemblée.
    const prefixe = ['AN20-COMENQ', 'AN20-MISINF'].find((p) => actes.some((a: ActeRow) => a.code_acte.startsWith(`${p}-`))) ?? null;
    const codeDepot = prefixe ? `${prefixe}-RAPPORT` : uid.startsWith('DSN') ? 'SN20-RAPPORT' : 'AN20-RAPPORT';
    const etapes = prefixe
      ? [
          { code: `${prefixe}-CREA`, label: tSteps('commEnqCreation') },
          { code: `${prefixe}-NOMIN`, label: tSteps('commEnqRapporteur') },
          { code: codeDepot, label: tSteps('commEnqRapport') },
        ]
      : [{ code: codeDepot, label: tSteps('commEnqRapport') }];
    timelineSteps = etapes.map(({ code, label }) => {
      const acte = acteByCode.get(code);
      return { code, label, date: acte?.date_acte?.slice(0, 10) ?? null, done: !!acte, detail: null };
    });

    // Étape « Rapport publié » : ajoutée quand le texte du rapport devient accessible
    // (D-222). Le lien vers le rapport s'y rattache ; à défaut, au dépôt.
    // Pas au Sénat : ces rapports n'entrent en base qu'avec `import_rapports_senat`
    // (sync_senat.py), et `date_accessible` y est la date de leur première vérification
    // d'URL, entre le 2026-09-10 et le 2026-10-05 pour tous. 370 sur 383 la portent
    // plus de 60 jours après le dépôt (mesuré le 2026-10-10) : l'étape daterait la
    // publication de l'import, avec des mois, voire des années, sur le trait.
    rapportControle = rapportDuDossier(acteByCode.get(codeDepot), textes);
    const rapport = rapportControle?.rapport;
    etapeRapport = codeDepot;
    if (codeDepot !== 'SN20-RAPPORT' && rapport?.url_accessible && rapport.date_accessible) {
      etapeRapport = 'RAPPORT-PUBLIE';
      timelineSteps.push({
        code: etapeRapport,
        label: tSteps('commEnqRapportPublie'),
        date: rapport.date_accessible.slice(0, 10),
        done: true,
        detail: null,
      });
    }
    if (rapport?.url_accessible && rapport.lien_texte) {
      const etape = timelineSteps.find((s) => s.code === etapeRapport);
      if (etape) etape.lien = { href: rapport.lien_texte, label: rapport.titre_principal_court || rapport.denomination || tSteps('rapport') };
    }
  } else {
    timelineSteps = etapesParcours.map(({ code, date, done }) => {
        if (code === 'DEPOT') return { code, label: tSteps('depot'), date, done, detail: null };
        let detail: string | null = null;
        if (code === 'PROM' && isSansEcheancier) detail = tSteps('aucunDecretAnnonce');
        if (code === 'DECAPP' && milestoneDateMap.has('DECAPP')) {
          const firstDecapp = milestoneDateMap.get('DECAPP')!;
          if (isAppAppliquee && decappLastDate && decappLastDate > firstDecapp) {
            const days = Math.round((decappLastDate.getTime() - firstDecapp.getTime()) / 86400000);
            detail = days > 60
              ? tSteps('decappAllPublished', { count: Math.round(days / 30), unit: tSteps('timeUnitMonth', { count: Math.round(days / 30) }) })
              : tSteps('decappAllPublished', { count: days, unit: tSteps('timeUnitDay', { count: days }) });
          } else if (!isAppAppliquee) {
            const days = Math.round((today.getTime() - firstDecapp.getTime()) / 86400000);
            detail = days > 60
              ? tSteps('decappInProgress', { count: Math.round(days / 30), unit: tSteps('timeUnitMonth', { count: Math.round(days / 30) }) })
              : tSteps('decappInProgress', { count: days, unit: tSteps('timeUnitDay', { count: days }) });
          }
        }
        const baseLabel = tSteps(STEP_CONFIG[code].labelKey as Parameters<typeof tSteps>[0]);
        return {
          code,
          label: code === 'PROM' && isAppDirecte ? `${baseLabel} (${tMonth('directApplication')})` : baseLabel,
          date,
          done,
          detail,
        };
      });
  }

  // Mapping textes → étapes timeline
  const texteUidSet = new Set(textes.map((t: TexteRow) => t.uid));
  // Le « texte adopté » qu'une chambre publie après le vote porte ce nom même quand le
  // vote a rejeté le texte : ce n'est alors qu'une page qui dit le refus (« L'Assemblée
  // nationale n'a pas adopté la proposition de résolution », 564 caractères sur
  // DLR5L17N54916). Seul le statut du texte le dit, l'acte de décision ne change pas.
  const estRejete = (tx: TexteRow | undefined) => tx?.libelle_statut_adoption === 'Rejeté en séance';
  const uidsRejetes = new Set(textes.filter(estRejete).map((t: TexteRow) => t.uid));
  const textesParEtape: Record<string, { label: string; texteUid: string; type: string }[]> = {};

  for (const acte of actes) {
    const code: string = acte.code_acte;
    let milestone: string | null = null;
    if (code === 'PROM-PUB') milestone = 'PROM';
    else {
      for (const m of MILESTONE_CODES) {
        if (code.startsWith(m + '-')) { milestone = m; break; }
      }
    }
    if (!milestone) continue;

    const entries: { uid: string; type: string; label: string }[] = [];
    if (code.endsWith('-DEPOT') && acte.textes_associes?.length) {
      for (const u of acte.textes_associes) entries.push({ uid: u, type: 'depot', label: tSteps('texteDepose') });
    } else if (code.includes('-COM-FOND-RAPPORT')) {
      if (acte.texte_adopte) entries.push({ uid: acte.texte_adopte, type: 'commission', label: tSteps('texteCommission') });
      if (acte.textes_associes?.length) {
        for (const u of acte.textes_associes) entries.push({ uid: u, type: 'rapport', label: tSteps('rapport') });
      }
    } else if (code.includes('-DEBATS-') && code.endsWith('-DEC') && acte.textes_associes?.length) {
      for (const u of acte.textes_associes) entries.push({ uid: u, type: 'adopte', label: tSteps(uidsRejetes.has(u) ? 'texteRejete' : 'texteAdopte') });
    } else if (code === 'PROM-PUB' && acte.textes_associes?.length) {
      for (const u of acte.textes_associes) entries.push({ uid: u, type: 'promulgue', label: tSteps('loiPromulguee') });
    } else if (code === 'DECAPP-PUB' && acte.texte_adopte) {
      entries.push({ uid: acte.texte_adopte, type: 'decret', label: tSteps('decretApplication') });
    }

    if (!textesParEtape[milestone]) textesParEtape[milestone] = [];
    for (const e of entries) {
      if (texteUidSet.has(e.uid) && !textesParEtape[milestone].some(x => x.texteUid === e.uid)) {
        textesParEtape[milestone].push({ label: e.label, texteUid: e.uid, type: e.type });
      }
    }
  }

  // Dossier de contrôle : le rapport et ses tomes se rangent sous l'étape qui porte le
  // lien, au lieu de tomber dans « Autres textes » du menu des versions. Un tome se
  // nomme par sa dénomination et son titre (« Tome 2 : Comptes rendus des auditions »),
  // son titre seul ne disant pas lequel des tomes c'est.
  if (rapportControle && etapeRapport) {
    const deuxPoints = locale === 'en' ? ': ' : '\u00a0: ';
    textesParEtape[etapeRapport] = [
      { label: tSteps('rapport'), texteUid: rapportControle.rapport.uid, type: 'rapport' },
      ...rapportControle.tomes.map((tx) => ({
        label: [tx.denomination, tx.titre_principal_court].filter(Boolean).join(deuxPoints) || tSteps('rapport'),
        texteUid: tx.uid,
        type: 'rapport',
      })),
    ];
  }

  // Le texte ouvert par défaut est celui qui fait foi : la version consolidée,
  // sinon la loi promulguée, sinon, sur un dossier de contrôle, le rapport lui-même
  // (ses tomes d'auditions, de même date, l'emportaient sinon), et en dernier
  // recours le texte accessible le plus récent, document d'accompagnement et texte
  // rejeté exclus tant qu'un autre texte s'offre. Le rapport de commission suit le texte qu'il
  // examine de plusieurs semaines : sans cette exclusion, 76 dossiers législatifs
  // sans version adoptée ouvraient sur un rapport ou un avis (mesuré le 2026-10-14). Un texte
  // sans aucune date ne peut pas être « le plus récent » : il était trié en fin de
  // liste et remportait la sélection sur 544 dossiers. Le client s'en sert aussi
  // pour le bandeau d'avertissement, qu'il montre dès que le lecteur choisit
  // autre chose dans le menu des versions.
  //
  // Rien ne le détourne : le texte lu ne vit pas dans l'adresse (le menu des
  // versions change l'état React, pas l'URL), et le `dynamic = 'force-static'` en
  // tête de ce fichier vide de toute façon `searchParams`. Partager la page
  // partage donc le dossier, pas une version.
  //
  // L'accessibilité reprend le critère du client (`liensStatus` dans
  // ResumeIAClient), sans quoi le texte ouvert par défaut pourrait y être marqué
  // « non publié » : un contenu Légifrance stocké vaut publié, même si le
  // vérificateur d'URL nocturne a reçu un 403 anti-bot et posé `url_accessible = false`,
  // et un `url_accessible` vrai ne vaut que s'il y a un lien à lire.
  // La version consolidée et la loi promulguée y passent aussi : une loi parue au
  // Journal officiel le jour même n'a pas encore son texte, et l'ouvrir par défaut
  // affichait un échec de génération que « Réessayer » ne pouvait que répéter
  // (dossier DLR5L17N54379, le 2026-10-20). La page s'ouvre alors sur le texte
  // accessible le plus récent, jusqu'à sa régénération après l'import : `/api/revalidate`
  // la marque à la fin du run de nuit, et sa minuterie de 24 h prend le relais les nuits
  // sans appel, où ce retard peut durer jusqu'à un jour après que le texte est en base.
  const estAccessible = (tx: TexteRow) => (tx.url_accessible === true && !!tx.lien_texte) || tx.contenu_stocke;
  const consolide = textes.find((t: TexteRow) => t.is_version_consolidee && estAccessible(t));
  const promulgue = textes.find((t: TexteRow) => t.libelle_statut_adoption === 'Promulguée' && estAccessible(t));
  const rapportParDefaut = rapportControle && estAccessible(rapportControle.rapport) ? rapportControle.rapport : null;
  // Le doublon du tome 1 (même lien que le rapport) est retiré du menu des versions,
  // où il aurait figuré deux fois le même document. Les replis ci-dessous lisent la
  // même liste, sans quoi ils pourraient ouvrir un texte absent du menu.
  const textesMenu = rapportControle?.doublon ? textes.filter((tx) => tx !== rapportControle?.doublon) : textes;
  // Le plus récent hors documents d'accompagnement et hors texte rejeté, sinon le plus
  // récent tout court : un dossier qui n'a que son rapport en ligne l'ouvre plutôt que
  // rien. Le texte rejeté (`estRejete`) est daté du vote, donc le plus récent d'un dossier
  // qui s'arrête là : 10 fiches s'ouvraient sur cette page de refus, et l'IA en tirait un
  // résumé reconstruit à partir du seul titre (mesuré le 2026-10-22).
  const ouvrables = textesMenu.filter((tx) => dateTexte(tx) && estAccessible(tx));
  const plusRecent = ouvrables.findLast((tx) => !TYPES_ACCOMPAGNEMENT.has(tx.type_libelle ?? '') && !estRejete(tx)) ?? ouvrables.at(-1);
  let defaultTexteUid: string | null = consolide?.uid || promulgue?.uid || rapportParDefaut?.uid || plusRecent?.uid || null;
  if (!defaultTexteUid && textesMenu.length > 0) {
    defaultTexteUid = textesMenu[textesMenu.length - 1].uid;
  }

  // Scrutins
  const voteRefsSet = new Set(actesAvecVote.flatMap(a => a.vote_refs));
  const voteRefs = [...voteRefsSet];

  type ScrutinLoaded = {
    titre: string | null;
    titre_en: string | null;
    sort_libelle: string | null;
    type_vote_libelle: string | null;
    type_vote_code: string | null;
    synthese_pour: number | null;
    synthese_contre: number | null;
    synthese_abstentions: number | null;
    synthese_nombre_votants: number | null;
    synthese_non_votants: number | null;
    synthese_suffrages_requis: number | null;
    date_scrutin: string | null;
    chambre: string | null;
  };

  const scrutinsMap = new Map<string, ScrutinLoaded>();
  if (voteRefs.length > 0) {
    const scrutinsData = await sql<(ScrutinLoaded & { uid: string })[]>`
      select uid, titre, titre_en, sort_libelle, type_vote_libelle, type_vote_code, synthese_pour, synthese_contre,
        synthese_abstentions, synthese_nombre_votants, synthese_non_votants, synthese_suffrages_requis, date_scrutin,
        chambre
      from scrutins
      where uid = any(${voteRefs})`;
    for (const s of scrutinsData) {
      scrutinsMap.set(s.uid, s);
    }
  }

  // Ce que la carte d'une décision de chambre dit quand elle n'a pas le détail des voix
  // (choix d'Alex du 2026-11-03). Le 49.3 et l'article 151-7 se lisent dans le statut de
  // l'acte, tel que le publie l'Assemblée : « considéré comme adopté … en application de
  // l'article 49, alinéa 3 de la Constitution » (5 actes de décision au 2026-11-03),
  // « considérée comme définitive en application de l'article 151-7 du Règlement » (30).
  // Ailleurs, une phrase qui ne dit pas pourquoi : vote à main levée, scrutin absent de
  // la base ou antérieur à l'import se ressemblent ici, et une raison précise serait
  // fausse pour une partie d'entre eux. Ni la CMP ni le Conseil constitutionnel ne votent
  // en scrutin public : pas de phrase.
  function sansDetailDe(chambreKey: ReturnType<typeof deriveChambreKey>, statut: string | null): SansDetail | undefined {
    if (chambreKey !== 'AN' && chambreKey !== 'SEN') return undefined;
    // `\s` couvre aussi l'espace insécable, que l'Assemblée peut écrire à la place.
    if (statut && /49,?\s+alinéa\s+3/.test(statut)) return '49-3';
    if (statut?.includes('151-7')) return '151-7';
    return 'inconnu';
  }

  // Texte issu du vote : l'acte de décision porte le « Texte adopté n° X » publié par la
  // chambre, y compris quand le vote a rejeté le texte. Ce n'est donc pas la version
  // soumise au vote mais celle qui en sort, d'où le libellé du lien côté carte.
  // La requête `textes` écarte déjà les variantes TAP (PDF provisoire) : il ne reste que
  // la version HTML lisible dans le navigateur.
  const texteByUid = new Map(textes.map((tx: TexteRow) => [tx.uid, tx]));
  function texteVoteFor(acte: ActeRow): { uid: string; lien: string; label: string } | null {
    for (const u of acte.textes_associes ?? []) {
      const tx = texteByUid.get(u);
      if (tx?.url_accessible && tx.lien_texte) {
        return {
          uid: tx.uid,
          lien: tx.lien_texte,
          label: tx.titre_principal_court || tx.denomination || tSteps(estRejete(tx) ? 'texteRejete' : 'texteAdopte'),
        };
      }
    }
    return null;
  }

  type DecisionData = {
    acteUid: string;
    date: string;
    chambreKey: 'AN' | 'SEN' | 'CMP' | 'CC' | null;
    scrutinTitre: string | null;
    scrutinTitreTraduit: boolean;
    statutConclusion: string | null;
    urlConclusion?: string | null;
    sansDetail?: SansDetail;
    texteVote: { uid: string; lien: string; label: string } | null;
    scrutin: {
      uid: string;
      sortLibelle: string;
      type: string;
      typeVoteCode: string | null;
      pour: number;
      contre: number;
      abstentions: number;
      votants: number;
      nonVotants: number;
      suffragesRequis: number;
      date: string;
      chambre: string | null;
    } | null;
  };

  const decisionsByMilestone: Record<string, DecisionData[]> = {};
  for (const acte of actes) {
    const code: string = acte.code_acte;
    const milestone = milestoneOf(code);
    if (!milestone) continue;
    if (!acte.date_acte) continue;

    const voteRef = voteLePlusRecent((acte.vote_refs ?? []).filter(r => scrutinsMap.has(r)));
    const s = voteRef ? scrutinsMap.get(voteRef) : undefined;

    const hasScrutinDetails = !!s && ((s.synthese_pour ?? null) !== null || (s.synthese_contre ?? null) !== null);

    // Sur /en, le titre traduit par l'IA quand il existe (`lib/titre-dossier.ts`).
    // `libelle_acte` reste en français : c'est le repli d'un acte sans scrutin.
    const scrutinTitre = (s && titreDossier(s, locale)) || acte.libelle_acte || null;
    // Une motion de procédure (`estMotionProcedure`) a pour sort celui de la motion : la
    // carte affichait « Adopté » sur une décision que l'acte dit « rejeté » (12 décisions de
    // l'Assemblée et 4 du Sénat au 2026-11-03, dont L17-VD232402DEC et la fin de vie). Le
    // statut se lit alors dans l'acte seul.
    const motion = estMotionProcedure(s?.titre);
    const statutConclusion =
      (motion ? null : parseSortLibelle(s?.sort_libelle ?? null))
      ?? parseSortLibelle(acte.statut_conclusion ?? null)
      ?? acte.statut_conclusion
      ?? null;

    const chambreKey = deriveChambreKey(code);
    const decision: DecisionData = {
      acteUid: acte.uid,
      date: acte.date_acte,
      chambreKey,
      scrutinTitre,
      // Faux pour le repli `libelle_acte`, qui reste en français.
      scrutinTitreTraduit: !!s && titreTraduit(s, locale),
      statutConclusion,
      urlConclusion: acte.url_conclusion ?? null,
      texteVote: texteVoteFor(acte),
      sansDetail: hasScrutinDetails ? undefined : sansDetailDe(chambreKey, acte.statut_conclusion ?? null),
      scrutin: hasScrutinDetails && s && voteRef ? {
        uid: voteRef,
        sortLibelle: s.sort_libelle ?? '',
        type: s.type_vote_libelle ?? '',
        typeVoteCode: s.type_vote_code ?? null,
        pour: s.synthese_pour ?? 0,
        contre: s.synthese_contre ?? 0,
        abstentions: s.synthese_abstentions ?? 0,
        votants: s.synthese_nombre_votants ?? 0,
        nonVotants: s.synthese_non_votants ?? 0,
        suffragesRequis: s.synthese_suffrages_requis ?? 0,
        date: s.date_scrutin ?? acte.date_acte,
        chambre: s.chambre ?? null,
      } : null,
    };

    (decisionsByMilestone[milestone] ??= []).push(decision);
  }
  for (const m of Object.keys(decisionsByMilestone)) {
    decisionsByMilestone[m].sort((a, b) => a.date.localeCompare(b.date));
  }

  // Stats débats — un dossier sans intervention n'a pas de ligne dans la vue
  const nbInterventions = debatsStats?.nb_interventions ?? 0;
  const hasInterventions = nbInterventions > 0;
  const nbSeancesAN = debatsStats?.nb_seances_an ?? 0;
  const nbSeancesSEN = debatsStats?.nb_seances_sen ?? 0;
  const derniereSeance: string | null = debatsStats?.derniere_seance ?? null;

  // Données de la décision CC (si le dossier a un acte CC-CONCLUSION).
  // Sur /en, la version anglaise que le même appel a écrite (`import_cc_decisions.py`),
  // résumé et censures ensemble : tant que la nuit ne l'a pas produite (décision du
  // jour), les deux restent en français plutôt que de mêler les langues.
  const ccEnAnglais = locale === 'en' && !!ccActe?.resume_cc_en;
  const resumeCc = ccEnAnglais ? ccActe?.resume_cc_en : ccActe?.resume_cc;
  const censures = ccEnAnglais ? ccActe?.articles_censures_en : ccActe?.articles_censures;
  // `articles_censures` est un JSONB : le schéma garantit la forme des lignes
  // écrites depuis la migration, pas celle des anciennes. Un filtre vaut mieux
  // qu'un cast non vérifié, qui laissait passer une entrée incomplète jusqu'au
  // rendu.
  const articlesBruts = Array.isArray(censures) ? censures : [];
  const articlesCensures = articlesBruts
    .filter((a): a is { texte: string; objet: string; raison: string } =>
      typeof a?.texte === 'string' && typeof a?.objet === 'string' && typeof a?.raison === 'string');
  // Une entrée écartée disparaît de l'écran sans que le lecteur puisse le savoir :
  // il croirait le Conseil moins sévère qu'il ne l'a été. Le cas ne peut plus
  // naître depuis le schéma, mais les lignes d'avant sont hors garantie, d'où la
  // trace, même traitement que le morceau surdimensionné de resume-loi.
  if (articlesCensures.length < articlesBruts.length) {
    console.warn(`articles_censures : ${articlesBruts.length - articlesCensures.length} entrée(s) hors forme écartée(s). acte=${ccActe?.uid}`);
  }
  const ccDecisionInfo = ccActe ? {
    statut:           ccActe.statut_conclusion ?? null,
    resumeCc:         resumeCc ?? null,
    articlesCensures: articlesCensures.length > 0 ? articlesCensures : null,
    urlConclusion:    ccActe.url_conclusion ?? null,
    date:             ccActe.date_acte ?? null,
  } : null;

  const elusSources = await elusSourcesPromise;
  const amendements = await amendementsPromise;
  const repartition = await repartitionPromise;
  // La carte seule, badges posés : la liste entière (217 Ko sur la loi de finances
  // 2026) partait avec la page, recopiée dans le HTML et le flux RSC de chaque
  // génération ISR. Le panneau la charge à l'ouverture.
  const elusActifsParChambre = carteElusActifs(marquerRapporteurs(await elusActifsPromise, elusSources.rapporteurs));
  const pourVous = await pourVousPromise;
  const modifications: ModificationsDossier | null = nbDeposes > 0 ? {
    deposes: nbDeposes,
    adoptes: dossier.nb_amendements_adoptes ?? 0,
    repartition,
    // La carte seule : la liste entière (3 306 amendements sur la loi de finances
    // 2026, 845 Ko) pesait plus que tout le reste de la fiche, recopiée dans le HTML
    // et le flux RSC de chaque génération ISR. Le panneau la charge à l'ouverture.
    auteurs: carteAmendements(amendements),
    nbAuteurs: amendements.length,
  } : null;

  return (
    <ResumeIAClient
      uid={uid}
      initialTextes={textesMenu}
      statutFinal={dossier?.statut_final ?? null}
      datePromulgation={dossier?.date_promulgation ?? null}
      dureeTotal={dureeTotal}
      dureeApplication={dureeApplication}
      isAppDirecte={isAppDirecte}
      timelineSteps={timelineSteps}
      textesParEtape={textesParEtape}
      decisionsByMilestone={decisionsByMilestone}
      nbMesuresAttendues={application?.nb_mesures_attendues ?? null}
      nbMesuresAppliquees={application?.nb_mesures_appliquees ?? null}
      ccSaisineCounts={ccSaisineCounts}
      defaultTexteUid={defaultTexteUid}
      cachedResumes={cachedResumes}
      articlesPresse={articlesPresse}
      hasInterventions={hasInterventions}
      nbInterventions={nbInterventions}
      nbSeancesAN={nbSeancesAN}
      nbSeancesSEN={nbSeancesSEN}
      derniereSeance={derniereSeance}
      ccDecisionInfo={ccDecisionInfo}
      sources={{
        lienAN: dossier?.lien_an ?? null,
        lienSenat: dossier?.lien_senat ?? null,
        lienLegifrance: dossier?.url_legifrance ?? null,
        ...elusSources,
      }}
      modifications={modifications}
      controle={isDossierControle}
      elusActifs={elusActifsParChambre}
      pourVous={pourVous}
    />
  );
}
