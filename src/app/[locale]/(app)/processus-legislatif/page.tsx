// src/app/[locale]/(app)/processus-legislatif/page.tsx
// Page pédagogique sur le processus législatif en France

export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDashboardKpis } from "@/lib/organes-queries";
import ProcessClient from "./ProcessClient";
import { getParliamentCounts, LEGAL_AN } from "@/lib/parliament-counts";
import type { Metadata } from "next";
import { buildAlternates, buildOpenGraph } from "@/lib/og-metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "process" });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDesc');
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/processus-legislatif'),
    openGraph: buildOpenGraph(locale, '/processus-legislatif', title, description),
  };
}

const INSTITUTION_KEYS = [
  "assemblee",
  "senat",
  "gouvernement",
  "president",
  "conseil",
] as const;

const INSTITUTION_SITE_URLS: Record<string, string> = {
  assemblee: "https://www.assemblee-nationale.fr",
  senat: "https://www.senat.fr",
  gouvernement: "https://www.gouvernement.fr",
  president: "https://www.elysee.fr",
  conseil: "https://www.conseil-constitutionnel.fr",
};

// Chaque entrée porte une clé de `process.factsLinks`, pas son libellé : quatre
// des liens sont communs aux deux chambres et doivent afficher le même texte.
const FACTS_LINKS: Record<string, Array<{ href: string; cle: string }>> = {
  assemblee: [
    { href: "/les-elus#role=deputes", cle: "deputes" },
    { href: "/Facts/participation", cle: "participation" },
    { href: "/Activite", cle: "activite" },
    { href: "/Facts/representativite/age", cle: "age" },
    { href: "/Facts/representativite/genre", cle: "parite" },
    { href: "/Facts/representativite/metiers", cle: "metiers" },
    { href: "/Facts/representativite/geographie", cle: "geographie" },
  ],
  senat: [
    { href: "/les-elus#role=senateurs", cle: "senateurs" },
    { href: "/Facts/representativite/age", cle: "age" },
    { href: "/Facts/representativite/genre", cle: "parite" },
    { href: "/Facts/representativite/metiers", cle: "metiers" },
    { href: "/Facts/representativite/geographie", cle: "geographie" },
  ],
};

type GroupeDetailed = { nom: string; effectif: number; pctRepresentation?: number; couleur?: string };
type GroupesMap = Partial<Record<"assemblee" | "senat", GroupeDetailed[]>>;

async function fetchGroupes(): Promise<GroupesMap> {
  const result: GroupesMap = {};

  // Une panne de lecture lève (D-136) et remonte jusqu'à Next : une régénération
  // ISR qui lève garde la page précédente. Rattrapée ici, elle figeait une page sans
  // la composition des groupes jusqu'à la régénération suivante. Le prix : une panne
  // pendant `next build` fait échouer le déploiement au lieu de publier la page amputée.
  const fetchOne = async (institution: "AN" | "Senat", key: "assemblee" | "senat") => {
    const data = await getDashboardKpis(institution);
    if (!data.groupes) return;
    const total = data.membres;
    result[key] = data.groupes.map((g) => ({
      nom: g.name,
      effectif: g.value,
      pctRepresentation: total > 0 ? Math.round((g.value / total) * 1000) / 10 : undefined,
      couleur: g.fill,
    }));
  };

  await Promise.all([fetchOne("AN", "assemblee"), fetchOne("Senat", "senat")]);
  return result;
}

export default async function ProcessusLegislatif({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "process" });

  const [groupesByOrgane, counts] = await Promise.all([
    fetchGroupes(),
    getParliamentCounts(),
  ]);

  const institutions = INSTITUTION_KEYS.map((key) => ({
    key,
    name: t(`organes.${key}.trigger`),
    // `an` compte les députés en exercice, qui peuvent être moins nombreux
    // que les sièges (574 pour 577 le 2026-10-29) : le rôle affiche alors les
    // deux, le nombre de sièges venant de la constante légale. Au complet (ou
    // sur le repli légal de `getParliamentCounts`), `complet` retire la
    // parenthèse, qui répéterait le même nombre.
    role: t(`organes.${key}.role`, {
      an: counts.an,
      sn: counts.sn,
      siegesAn: LEGAL_AN,
      complet: counts.an === LEGAL_AN ? "oui" : "non",
    }),
    content: t(`organes.${key}.content`),
    modeElection: t(`organes.${key}.modeElection`),
    siteOfficielUrl: INSTITUTION_SITE_URLS[key],
    groupes:
      key === "assemblee" ? groupesByOrgane.assemblee
      : key === "senat" ? groupesByOrgane.senat
      : undefined,
    factsLinks: FACTS_LINKS[key]?.map(({ href, cle }) => ({
      href,
      label: t(`factsLinks.${cle}`),
    })),
  }));

  // L'affiche n'existe qu'en francais : on ne la propose donc pas aux lecteurs
  // anglophones, a qui elle ne servirait a rien. Retirer la condition le jour
  // ou une version anglaise du PDF existe.
  const poster =
    locale === "fr"
      ? {
          heading: t("poster.heading"),
          desc: t("poster.desc"),
          cta: t("poster.cta"),
        }
      : undefined;

  const steps = Array.from({ length: 8 }, (_, i) => ({
    number: i + 1,
    label: t("parcours.stepLabel", { number: i + 1 }),
    title: t(`parcours.step${i + 1}Title`),
    description: t(`parcours.step${i + 1}Desc`),
    details: t(`parcours.step${i + 1}Details`),
  }));

  return (
    <div className="py-6">
      <ProcessClient
        institutions={institutions}
        acteursHeading={t("organes.heading")}
        acteursIntro={t("organes.intro")}
        parcoursHeading={t("parcours.heading")}
        parcoursIntro={t("parcours.intro")}
        steps={steps}
        roleHeading={t("roleHeading")}
        modeElectionHeading={t("modeElectionHeading")}
        groupesHeading={t("groupesHeading")}
        factsLinksHeading={t("factsLinksHeading")}
        siteOfficielLabel={t("siteOfficielLabel")}
        typesHeading={t("typesHeading")}
        poster={poster}
      />
    </div>
  );
}
