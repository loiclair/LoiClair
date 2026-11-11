// src/app/[locale]/(app)/les-elus/page.tsx
// Recherche des élus — filtrage 100 % client-side via hash URL (zéro rechargement serveur).
// Le serveur fournit les valeurs des filtres et les élus les plus consultés ; la
// rangée de filtres vit dans `ElusResultsClient`, qui charge lui-même la carte des
// départements de son menu.

export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { sql } from '@/lib/db';
import ElusSearchInput from '@/components/ElusSearchInput';
import ElusResultsClient from '@/components/ElusResultsClient';
import { DEPT_NAME_TO_SVG_ID } from '@/lib/departements';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'elus' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDesc');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/les-elus'),
    openGraph: buildOpenGraph(locale, '/les-elus', title, description),
  };
}

export default async function LesElusPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'elus' });

  const toSlug = (str: string) =>
    str.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+$/, '');

  const acteurGroupesData = await sql<{ groupe: string | null }[]>`
    select groupe
    from acteurs
    where en_exercice = true
      and groupe is not null`;

  const uniqueGroupeUids = [...new Set(
    acteurGroupesData.map((a) => a.groupe).filter(Boolean)
  )] as string[];

  type OrganeOption = { uid: string; libelle: string };
  const organesData: OrganeOption[] = uniqueGroupeUids.length > 0
    ? await sql<OrganeOption[]>`select uid, libelle from organes where uid = any(${uniqueGroupeUids})`
    : [];

  const groupeOptions = organesData
    .filter((o) => o.libelle)
    .sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'))
    .map((o) => ({ slug: toSlug(o.libelle), libelle: o.libelle, uid: o.uid }));

  const deptData = await sql<{ departement_election: string | null }[]>`
    select departement_election
    from acteurs
    where en_exercice = true
      and departement_election is not null`;

  const uniqueDepts = [...new Set(
    deptData.map((a) => a.departement_election).filter(Boolean)
  )] as string[];

  const deptSortKey = (name: string): number => {
    const svgId = DEPT_NAME_TO_SVG_ID[name];
    if (!svgId) return 9999;
    const code = svgId.replace('d', '');
    if (code === '2A') return 20.1;
    if (code === '2B') return 20.2;
    const n = parseInt(code, 10);
    return isNaN(n) ? 9998 : n;
  };

  const deptOptions = uniqueDepts
    .sort((a, b) => deptSortKey(a) - deptSortKey(b))
    .map((d) => {
      const svgId = DEPT_NAME_TO_SVG_ID[d];
      const code = svgId ? svgId.replace('d', '') : '';
      return { slug: d, libelle: code ? `${code} — ${d}` : d };
    });

  const filterLabels = {
    role: Object.fromEntries([
      ['deputes', t('quickDeputes')],
      ['senateurs', t('quickSenateurs')],
    ]),
    groupe: Object.fromEntries(groupeOptions.map(o => [o.slug, o.libelle])),
    dept: Object.fromEntries(deptOptions.map(o => [o.slug, o.libelle])),
  };

  // `groupe` garde la forme et la place que la page attend : un objet
  // (ou `null` pour un élu sans groupe), rangé après les colonnes simples.
  const popularData = await sql<PopularRow[]>`
    select a.uid, a.prenom, a.nom, a.civ, a.est_depute_actuel, a.est_senateur_actuel, a.est_ministre_actuel,
      a.qualite_actuelle, a.url_profil_officiel, a.view_count_month,
      (select json_build_object('libelle', o.libelle) from organes o where o.uid = a.groupe) as groupe
    from acteurs a
    where a.view_count_month > 0
      -- La politique de confidentialité promet que seuls les élus en fonction
      -- figurent dans l'annuaire : une fiche d'ancien élu reste ouverte, pas listée.
      and a.en_exercice = true
    -- Départage par clé primaire : sans lui, les ex æquo au 5ᵉ rang suivent le plan
    -- d'exécution, et le bloc change de contenu d'un rendu à l'autre sans raison.
    order by a.view_count_month desc, a.uid
    limit 5`;

  type PopularRow = {
    uid: string;
    prenom: string | null;
    nom: string | null;
    civ: string | null;
    est_depute_actuel: boolean | null;
    est_senateur_actuel: boolean | null;
    est_ministre_actuel: boolean | null;
    qualite_actuelle: string | null;
    url_profil_officiel: string | null;
    groupe: { libelle: string | null } | null;
    view_count_month: number | null;
  };
  const popularElus = popularData.map((a) => {
    return {
      uid: a.uid,
      prenom: a.prenom,
      nom: a.nom,
      civ: a.civ,
      // Même règle que l'index de recherche : seuls les sénateurs ont besoin de
      // leur fiche officielle pour que `photoElu` trouve leur portrait.
      url_profil_officiel: a.est_senateur_actuel ? a.url_profil_officiel : null,
      role: a.est_ministre_actuel ? (a.qualite_actuelle ?? t('roleGouvernement'))
        : a.est_depute_actuel ? t(a.civ === 'Mme' ? 'roleDeputee' : 'roleDepute')
        : a.est_senateur_actuel ? t(a.civ === 'Mme' ? 'roleSenatrice' : 'roleSenateur')
        : '',
      groupe_libelle: a.groupe?.libelle ?? null,
      view_count_month: a.view_count_month,
    };
  });

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="fade-slide-in" style={{ paddingTop: '1rem', paddingBottom: 4, position: 'relative', zIndex: 10 }}>
        <ElusSearchInput placeholder={t('searchPlaceholder')} popularElus={popularElus} />
      </div>

      <ElusResultsClient filterLabels={filterLabels} />
    </div>
  );
}
