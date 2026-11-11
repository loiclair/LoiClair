// Verbatim d'une seule séance de débat, pour un dossier donné.
//
// Le découpage par séance garde la page à un poids tenable : aucune séance du corpus ne
// dépasse 1 954 interventions, là où le dossier entier peut en compter 15 402 (670 Ko de
// texte pour la plus grosse séance, contre 7 Mo pour le dossier entier).
//
// Le texte des interventions ne vient pas de la base mais du fichier de la séance
// (`lib/debats-texte.ts`) : un seul fichier par page.
//
// Le groupe affiché à côté de chaque orateur est celui qu'il avait le jour de la
// séance (`lib/groupe-au-jour.ts`, D-278), pas son groupe actuel : un débat passé ne
// doit pas montrer un sénateur sous un groupe rejoint après coup.

export const revalidate = 86400;
export const dynamic = 'force-static';
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

import { notFound } from 'next/navigation';
import { estSlugSeance, estUidDossier } from '@/lib/uid-fiches';
import type { Metadata } from 'next';
import { auPlusUneLigne, sql } from '@/lib/db';
import { lecteurDeTextes, seanceSansEmpreinte, type RefSeanceTexte } from '@/lib/debats-texte';
import { lecteurDeGroupes } from '@/lib/groupe-au-jour';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { titreDossier } from '@/lib/titre-dossier';
import DebatsVerbatim from '../DebatsVerbatim';
import { slugVersSeance } from '../seance-slug';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; uid: string; seance: string }> }): Promise<Metadata> {
  const { locale, uid, seance } = await params;
  if (!estUidDossier(uid) || !estSlugSeance(seance)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'resumeIA' });
  // Lève sur une panne (D-136) : la régénération garde alors la page précédente au
  // lieu de figer le titre générique. Une fiche marquée par
  // `/api/revalidate` n'en a plus et rend une erreur le temps de la panne.
  const data = await auPlusUneLigne(sql<{ titre: string | null; titre_en: string | null }[]>`
    select titre, titre_en from dossiers_legislatifs where uid = ${uid}`, 'dossiers_legislatifs (métadonnées)');
  // Sur /en, le titre traduit par l'IA quand il existe (`lib/titre-dossier.ts`).
  const titre = data ? titreDossier(data, locale) : '';
  const title = titre
    ? `${t('debatsBreadcrumbDebats')} — ${titre} — LoiClair`
    : `${t('debatsTitle')} — LoiClair`;
  const description = titre ? t('debatsMetaDescription', { titre }) : t('debatsVerbatimIntro');
  return {
    title,
    description,
    alternates: buildAlternates(locale, `/dossiers-legislatifs/${uid}/debats/${seance}`),
    openGraph: buildOpenGraph(locale, `/dossiers-legislatifs/${uid}/debats/${seance}`, title, description),
  };
}

export default async function DebatsSeancePage({ params }: { params: Promise<{ locale: string; uid: string; seance: string }> }) {
  const { locale, uid, seance } = await params;
  if (!estUidDossier(uid) || !estSlugSeance(seance)) notFound();
  setRequestLocale(locale);
  const seanceUid = slugVersSeance(seance);

  type InterventionRow = {
    ordre: number;
    seance: unknown;
    acteur?: unknown;
  } & Record<string, unknown>;
  const [dossier, seanceStat, lignes] = await Promise.all([
    // `auPlusUneLigne` : une absence rend null, donc un 404, distinct d'une panne.
    auPlusUneLigne(sql<{ uid: string; titre: string | null; titre_en: string | null; statut_final: string | null; lien_an: string | null; lien_senat: string | null }[]>`
      select uid, titre, titre_en, statut_final, lien_an, lien_senat
      from dossiers_legislatifs where uid = ${uid}`, 'dossiers_legislatifs'),
    // La vue confirme que cette séance appartient bien au dossier : sans ce contrôle,
    // n'importe quel couple (dossier, séance) rendrait une page vide au lieu d'un 404.
    auPlusUneLigne(sql<{ date_seance: string }[]>`
      select date_seance from dossiers_seances_stats
      where dossier_uid = ${uid} and seance_uid = ${seanceUid}`, 'dossiers_seances_stats'),
    // `seance` et `acteur` sont des objets jsonb, la forme qu'attendent les appelants :
    // jsonb range ses clés par longueur de nom puis par ordre alphabétique, pas dans
    // l'ordre du select. `ordre` est unique dans une séance (index unique
    // `seance_uid, ordre`) : le tri est total.
    sql<InterventionRow[]>`
      select i.id, i.ordre, i.point_titre, i.article, i.amendement, i.stime,
        i.orateur_nom, i.orateur_qualite, i.role_debat, i.acteur_uid,
        (select jsonb_build_object('uid', s.uid, 'chambre', s.chambre, 'date_seance', s.date_seance, 'titre', s.titre,
            'url_source', s.url_source, 'legislature', s.legislature, 'texte_hash', s.texte_hash)
          from debat_seances s where s.uid = i.seance_uid) as seance,
        (select jsonb_build_object('uid', a.uid, 'nom', a.nom, 'prenom', a.prenom)
          from acteurs a where a.uid = i.acteur_uid) as acteur
      from debat_interventions i
      where i.dossier_uid = ${uid} and i.seance_uid = ${seanceUid}
      order by i.ordre asc`,
  ]);

  // Une panne lève (D-136) et ne devient plus un 404 mis en cache : seuls un
  // dossier absent ou une séance étrangère au dossier en méritent un.
  if (!dossier || !seanceStat) notFound();

  const [y, m, d] = seanceStat.date_seance.split('-').map(Number);
  const seanceLabel = new Date(y, m - 1, d).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const seanceDe = (r: InterventionRow) =>
    (Array.isArray(r.seance) ? r.seance[0] ?? null : r.seance) as (RefSeanceTexte & Record<string, unknown>) | null;
  // Indépendantes : les deux lectures partent ensemble. Chacune lève sur une panne, et
  // la régénération garde alors la page précédente (D-136), ou rend une erreur sur une
  // fiche marquée par `/api/revalidate`.
  const [texte, groupeDe] = await Promise.all([
    lecteurDeTextes(lignes.flatMap((r) => seanceDe(r) ?? [])),
    lecteurDeGroupes(lignes.flatMap((r) => (typeof r.acteur_uid === 'string' ? [r.acteur_uid] : []))),
  ]);
  const rows = lignes.map((r: InterventionRow) => {
    // `texte` reprend la place qu'il occupait dans la sélection, et `texte_hash` quitte
    // la séance : les données passées au composant restent celles d'avant le passage
    // du texte en fichiers.
    const { id, ordre, point_titre, article, amendement, ...reste } = r;
    // Même forme qu'au temps de la jointure sur `acteurs.groupe`, pour que
    // `DebatsVerbatim` n'ait pas à changer : le libellé long ne part pas au client.
    const groupe = r.acteur_uid
      ? groupeDe(r.acteur_uid as string, (seanceDe(r)?.date_seance as string | undefined) ?? '')
      : null;
    return {
      id, ordre, point_titre, article, amendement,
      texte: texte(seanceUid, ordre),
      ...reste,
      seance: seanceSansEmpreinte(seanceDe(r)),
      acteur: r.acteur
        ? {
            ...(Array.isArray(r.acteur) ? r.acteur[0] : r.acteur),
            groupe: groupe ? { libelle_abrege: groupe.libelle_abrege, couleur_associee: groupe.couleur_associee } : null,
          }
        : null,
    };
  });

  return (
    <DebatsVerbatim
      dossier={dossier}
      interventions={rows as unknown as React.ComponentProps<typeof DebatsVerbatim>['interventions']}
      seanceLabel={seanceLabel}
    />
  );
}
