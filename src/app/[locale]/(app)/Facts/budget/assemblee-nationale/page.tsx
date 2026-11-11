export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

/**
 * /Facts/budget/assemblee-nationale : d'où est venu l'argent de l'Assemblée
 * nationale en 2025, où il est allé, qui y travaille, comment les députés
 * utilisent leurs frais, qui contrôle et avec quelles failles, ce qui reste
 * invisible et ce qui attend l'institution.
 * Chapitre 1 de la série « Budget des chambres » (chapitre 2 : /Facts/budget/senat ;
 * coût d'un siège à venir). Aucune requête : tous les chiffres viennent de
 * `lib/budget-assemblee.ts`, saisis depuis les documents officiels sur les comptes 2025.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { Fragment } from 'react';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import {
  AGENTS,
  AVANCE_MENSUELLE_2025,
  AVENIR,
  COMPTABILITE,
  CONTROLE,
  COUT_DISSOLUTION,
  DOCUMENTS,
  DOTATION_LCP,
  DOTATION_MENSUELLE,
  ERREURS_SOURCE,
  EXERCICE,
  GROUPES,
  HISTORIQUE,
  INDEMNITE_BRUTE,
  INDEMNITE_SPECIALE,
  INFORMATIQUE_RAPPORT,
  MANDAT,
  PLACEMENTS,
  POPULATION,
  POSTES,
  REFORME,
  RESERVES,
  RETOUR_EMPLOI,
  RETRAITES,
  SIEGES,
  TOTAUX,
  TRANSPARENCE,
} from '@/lib/budget-assemblee';
import { Separator } from '@/components/ui/separator';
import { ExploreSection } from '@/components/ui/ExploreSection';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import { Target, Calculator, Scale, Filter, FileSearch } from 'lucide-react';
import { PostesBarre } from '../PostesBarre';
import { HistoriqueGraphique } from '../HistoriqueGraphique';
import { COLOR, Constats, Figure, Ligne } from '../BlocsBudget';
import { Surligne } from '@/components/ui/Surligne';

const PATH = '/Facts/budget/assemblee-nationale';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerBudgetAssemblee' });
  const title = `${t('pageTitle')} — LoiClair`;
  const description = t('pageDescription');
  return {
    title,
    description,
    alternates: buildAlternates(locale, PATH),
    openGraph: buildOpenGraph(locale, PATH, title, description),
  };
}

/**
 * Couleur de chaque poste, dans la barre d'ensemble et sur la barre de sa ligne.
 * Les huit plus gros postes ont chacun leur teinte : ce jeu et cet ordre passent
 * le validateur de la skill `dataviz` sur le fond clair (#ffffff) comme sur le
 * fond sombre (#181513), mêmes hex dans les deux thèmes (séparation daltonienne
 * ΔE 11,5, contraste >= 3:1). Ne pas changer une teinte ni l'ordre sans le
 * relancer. Les quatre derniers postes pèsent chacun moins de 1,1 % du total :
 * quelques pixels de large, une teinte propre ne s'y verrait pas, ils partagent
 * un gris et se distinguent par l'infobulle. Clé par poste et non par rang, pour
 * qu'une couleur suive son poste si l'ordre des montants change.
 */
const COULEURS_POSTES: Record<string, string> = {
  personnel: '#e8590c',
  collaborateurs: '#6366f1',
  retraites: '#db2777',
  fraisMandat: '#b8862b',
  deputes: '#0891b2',
  batiments: '#dc2626',
  groupes: '#8b5cf6',
  informatique: '#2f9e44',
};
const GRIS_PETITS_POSTES = '#8a847e';
const couleurPoste = (cle: string) => COULEURS_POSTES[cle] ?? GRIS_PETITS_POSTES;

/**
 * Les documents que la page cite, liés à leur PDF : un lecteur doit pouvoir
 * retrouver chaque chiffre à la source. `t.rich` ignore les balises absentes
 * d'un message, la même table sert donc à tous les textes. `b` met en gras
 * l'intitulé d'un constat.
 */
const BALISES = {
  ...Object.fromEntries(
    (['comptes', 'questeurs', 'commission', 'certification', 'etatsFinanciers', 'deontologue', 'csv', 'fiche', 'arrete', 'insee', 'conseilEtat', 'plf2026'] as const).map((cle) => [
      cle,
      (chunks: React.ReactNode) => (
        <a
          href={DOCUMENTS[cle]}
          target={cle === 'csv' ? undefined : '_blank'}
          rel={cle === 'csv' ? undefined : 'noopener noreferrer'}
          download={cle === 'csv' ? true : undefined}
          className="underline underline-offset-2 hover:no-underline"
          style={{ color: COLOR }}
        >
          {chunks}
        </a>
      ),
    ]),
  ),
  b: (chunks: React.ReactNode) => <strong className="font-semibold text-foreground">{chunks}</strong>,
};

export default async function BudgetAssembleePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerBudgetAssemblee' });
  type Cle = Parameters<typeof t>[0];

  // Au-dessus du million, la notation compacte (« 629,26 M € », « €629.26M »)
  // se lit d'un coup d'œil ; en dessous, l'euro exact reste plus parlant
  // (« 83 742 € » plutôt que « 83,74 k € »).
  const compact = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 2 });
  const exact = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const centimes = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = (n: number) => (Math.abs(n) >= 1_000_000 ? compact.format(n) : exact.format(n));
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const nombre = new Intl.NumberFormat(locale);

  // Les parts se calculent sur la somme des articles, pour que les douze postes
  // fassent 100 % ; l'écart de 5 € avec le total officiel est dit dans la
  // méthodologie. En pourcentage et non en « euros sur 100 € » : la réponse donne
  // aussi un coût par habitant en euros, et les deux se confondaient.
  const partFormat = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const part = (montant: number) => partFormat.format(montant / TOTAUX.sommeArticles);
  const poste = (cle: string) => POSTES.find((p) => p.cle === cle)!;
  const sousPoste = (posteCle: string, cle: string) => poste(posteCle).sousPostes.find((s) => s.cle === cle)!.montant;
  const dotationMaterielle = sousPoste('fraisMandat', 'dotationMaterielle');
  const fraisCourants2025 = sousPoste('fraisMandat', 'afm') + dotationMaterielle;
  // Enveloppe 1 (frais courants) et enveloppe 3 (payé directement) forment à
  // elles deux le poste « Frais de mandat » ; le crédit collaborateur ne couvre
  // qu'une partie du poste « Collaborateurs », le reste est payé en plus.
  const enveloppe1 = fraisCourants2025 + sousPoste('fraisMandat', 'expertiseComptable');
  const enveloppe3 = poste('fraisMandat').montant - enveloppe1;
  const collabCredit = sousPoste('collaborateurs', 'salairesCredit');
  const collabEnPlus = poste('collaborateurs').montant - collabCredit;
  // Montant 2025 ramené à un député et à un mois : la dotation matérielle, le
  // coût réel des collaborateurs et les trajets n'ont pas de montant fixe publié,
  // la carte des députés en montre donc la moyenne, dite comme telle.
  const parSiegeMois = (montant: number) => montant / SIEGES / 12;
  // Moyens de la fonction par mois : les trois enveloppes telles que la carte
  // les affiche (avance officielle et moyennes par siège).
  const moyensFonction =
    AVANCE_MENSUELLE_2025.metropoleOutreMer +
    parSiegeMois(dotationMaterielle) +
    parSiegeMois(poste('collaborateurs').montant) +
    parSiegeMois(enveloppe3);

  const ressources = [
    { cle: 'ressourceEtat', montant: TOTAUX.dotationEtat, opacite: 1 },
    { cle: 'ressourcePropres', montant: TOTAUX.recettesPropres, opacite: 0.55 },
    { cle: 'ressourceDeficit', montant: -TOTAUX.solde, opacite: 0.22 },
  ];

  // Chiffres de la réponse surlignés par le composant commun à tous les articles Facts.
  const hl = (chunks: React.ReactNode) => (
    <Surligne couleur={COLOR}>{chunks}</Surligne>
  );

  const titreSection = (cle: Cle) => (
    <h2 className="text-xs font-bold uppercase tracking-widest mb-5" style={{ color: COLOR }}>
      {t(cle)}
    </h2>
  );

  // Valeurs communes à plusieurs textes : `t.rich` ignore celles qu'un message
  // n'utilise pas.
  const valeurs = {
    ...BALISES,
    vote: eur(TOTAUX.budgetVote),
    demande: eur(TOTAUX.dotationDemandee),
    verse: eur(TOTAUX.dotationEtat),
    depense: eur(TOTAUX.depense),
    deficit: eur(-TOTAUX.solde),
    contrats: nombre.format(MANDAT.contratsCollaborateurs),
    fonctionnaires: nombre.format(AGENTS.fonctionnaires),
    contractuels: nombre.format(AGENTS.contractuels),
    credit: exact.format(MANDAT.creditCollaborateurMensuel),
    cout: eur(COUT_DISSOLUTION),
    caisse: eur(sousPoste('retraites', 'anciensFonctionnaires')),
    surCredit: eur(collabCredit),
    enPlus: eur(collabEnPlus),
    loyers: nombre.format(MANDAT.deputesLoyersParis),
    nuits: nombre.format(MANDAT.nuitsHotel),
    allocation: centimes.format(RETOUR_EMPLOI.allocationMensuelle),
    cotisation: centimes.format(RETOUR_EMPLOI.cotisationMensuelle),
    allocataires: RETOUR_EMPLOI.allocatairesFin2025,
    lcp: eur(DOTATION_LCP),
  };

  return (
    <div className="py-12">

      {/* ① LA RÉPONSE */}
      <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: COLOR }}>
        {t('sectionAnswer')}
      </h2>
      <p className="text-lg md:text-xl font-semibold leading-relaxed mb-8">
        {t.rich('shortAnswer', {
          annee: EXERCICE,
          depense: eur(TOTAUX.depense),
          personnel: part(poste('personnel').montant),
          collaborateurs: part(poste('collaborateurs').montant),
          retraites: part(poste('retraites').montant),
          indemnites: part(poste('deputes').sousPostes.find((s) => s.cle === 'indemnites')!.montant),
          parHabitant: centimes.format(TOTAUX.depense / POPULATION),
          parMois: centimes.format(TOTAUX.depense / POPULATION / 12),
          // La chaîne reste hors des postes, dont le total est celui des comptes
          // certifiés : la réponse donne le coût complet à part.
          chaine: eur(DOTATION_LCP),
          complet: eur(TOTAUX.depense + DOTATION_LCP),
          hl,
        })}
      </p>

      {/* Quatre chiffres et non trois : sans les recettes propres, dépensé moins
          versé ne retombait pas sur le déficit et invitait à un faux calcul. */}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('heroTitle', { annee: EXERCICE })}</CardTitle>
          <CardDescription>{t('heroDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            <Figure valeur={eur(TOTAUX.depense)} label={t('heroDepense')} />
            <Figure valeur={eur(TOTAUX.dotationEtat)} label={t('heroEtat')} />
            <Figure valeur={eur(TOTAUX.recettesPropres)} label={t('heroPropres')} />
            <Figure valeur={eur(-TOTAUX.solde)} label={t('heroDeficit')} />
          </div>
        </CardContent>
      </Card>

      {/* À COMPRENDRE */}
      {titreSection('conceptsTitle')}
      <Accordion type="multiple" className="mb-12">
        {(['Perimetre', 'Circuit', 'Comptes', 'Collaborateurs', 'Dissolution'] as const).map((n) => (
          <AccordionItem key={n} value={`concept-${n}`}>
            <AccordionTrigger className="text-left">{t(`concept${n}Title` as Cle)}</AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-foreground/80">
              {t.rich(`concept${n}Body` as Cle, {
                ...valeurs,
                resultat: eur(COMPTABILITE.resultatComptable),
              })}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* ② D'OÙ VIENT L'ARGENT */}
      {titreSection('sectionResources')}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('resourcesTitle', { depense: eur(TOTAUX.depense) })}</CardTitle>
          <CardDescription>{t('resourcesDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Une seule teinte à trois intensités, chaque segment nommé et chiffré
              dessous : la couleur ne porte jamais seule l'information (D-097). */}
          <div aria-hidden className="flex w-full overflow-hidden rounded-full" style={{ height: 14 }}>
            {ressources.map((r) => (
              <div
                key={r.cle}
                style={{ width: `${(r.montant / TOTAUX.depense) * 100}%`, backgroundColor: COLOR, opacity: r.opacite }}
              />
            ))}
          </div>
          <ul className="space-y-3 mt-5">
            {ressources.map((r) => (
              <Ligne
                key={r.cle}
                label={
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="inline-block rounded-sm shrink-0" style={{ width: 10, height: 10, backgroundColor: COLOR, opacity: r.opacite }} />
                    {t(r.cle as Cle)}
                  </span>
                }
                valeur={eur(r.montant)}
              />
            ))}
          </ul>
        </CardContent>
        <div className="border-t px-6 py-4 space-y-3">
          <p className="text-sm text-foreground/70 leading-relaxed">
            {t.rich('resourcesDeficitNote', { ...valeurs, placements: eur(RESERVES.produitsPlacementDotation) })}
          </p>
          <p className="text-sm text-foreground/70 leading-relaxed">
            {t.rich('resourcesAccueilNote', {
              ...BALISES,
              sousPrevision: eur(AVENIR.depensesSousPrevision2025),
              nonDepense: eur(AVENIR.projetAccueilNonDepense2025),
              budgete: eur(AVENIR.projetAccueilBudget2025),
            })}
          </p>
          <p className="text-sm text-foreground/70 leading-relaxed">
            {t.rich('resourcesPlacementsNote', { ...valeurs, reserves: eur(RESERVES.reservesFin2025) })}
          </p>
        </div>
      </Card>

      {/* ③ OÙ VA L'ARGENT, POSTE PAR POSTE */}
      {titreSection('sectionPostes')}
      <p className="text-sm text-foreground/80 leading-relaxed mb-4">
        {t('postesIntro', {
          invest: eur(INFORMATIQUE_RAPPORT.investissement),
          prestations: eur(INFORMATIQUE_RAPPORT.prestations),
          total: eur(poste('informatique').montant),
        })}
      </p>
      {/* Toutes les dépenses sur une ligne, une couleur par poste reprise sur la
          barre de sa ligne dans la liste : c'est la légende. */}
      <PostesBarre
        label={t('sectionPostes')}
        segments={POSTES.map((p) => ({
          cle: p.cle,
          titre: t(`postes.${p.cle}.titre` as Cle),
          part: part(p.montant),
          montant: eur(p.montant),
          valeur: p.montant,
          couleur: couleurPoste(p.cle),
        }))}
      />
      <p className="text-xs text-muted-foreground mt-3 mb-5">{t('postesBarreLegende')}</p>
      {/* Les barres de ligne sont à l'échelle du total, comme le pourcentage écrit
          à côté et la barre d'ensemble : à l'échelle du plus gros poste, le
          personnel (24,1 %) remplissait toute la ligne et contredisait son propre
          chiffre. Les plus petits postes gardent 3 px pour rester visibles. */}
      <Accordion type="multiple" className="mb-12">
        {POSTES.map((p) => (
          <AccordionItem key={p.cle} value={p.cle}>
            <AccordionTrigger className="text-left hover:no-underline">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{t(`postes.${p.cle}.titre` as Cle)}</span>
                  {/* Montant en gras dans la teinte de la page, comme les montants
                      des sous-postes qu'il additionne ; la part du total en retrait. */}
                  <span className="tabular-nums shrink-0">
                    <span className="text-muted-foreground font-normal">{part(p.montant)} · </span>
                    <span className="font-semibold" style={{ color: COLOR }}>{eur(p.montant)}</span>
                  </span>
                </div>
                <div aria-hidden className="mt-2 rounded-full bg-muted overflow-hidden" style={{ height: 6 }}>
                  <div style={{ width: `${(p.montant / TOTAUX.sommeArticles) * 100}%`, minWidth: 3, height: '100%', backgroundColor: couleurPoste(p.cle) }} />
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed space-y-4">
              <p className="text-foreground/80">{t.rich(`postes.${p.cle}.desc` as Cle, valeurs)}</p>
              <ul className="space-y-2">
                {p.sousPostes.map((s) => (
                  <Fragment key={s.cle}>
                    <Ligne label={t(`sousPostes.${s.cle}` as Cle)} valeur={eur(s.montant)} />
                    {/* La dotation matérielle est la seule partie des frais
                        courants dont le rapport publie le détail, en arrondi. */}
                    {s.cle === 'dotationMaterielle' && (
                      <li>
                        <ul className="space-y-2 pl-5">
                          <Ligne label={<span className="text-muted-foreground">{t('fraisCourrier')}</span>} valeur={eur(MANDAT.courrierM * 1_000_000)} />
                          <Ligne label={<span className="text-muted-foreground">{t('fraisImpressions')}</span>} valeur={eur(MANDAT.impressionsM * 1_000_000)} />
                          <Ligne label={<span className="text-muted-foreground">{t('fraisTaxi')}</span>} valeur={eur(MANDAT.taxiM * 1_000_000)} />
                          <Ligne label={<span className="text-muted-foreground">{t('fraisEquipement')}</span>} valeur={eur(MANDAT.equipementM * 1_000_000)} />
                        </ul>
                      </li>
                    )}
                  </Fragment>
                ))}
              </ul>
              {p.cle === 'fraisMandat' && (
                <p className="text-foreground/70">{t.rich('materielNote', BALISES)}</p>
              )}
              {/* La chaîne est montrée là où le lecteur la cherche, mais en gris et
                  sous un filet : elle n'entre ni dans le poste ni dans le total,
                  qui restent ceux des comptes certifiés. */}
              {p.cle === 'communication' && (
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-4 text-muted-foreground">
                    <span>{t('chaineHorsTotal')}</span>
                    <span className="tabular-nums shrink-0">{eur(DOTATION_LCP)}</span>
                  </div>
                  <p className="text-foreground/70">{t('chaineHorsTotalNote')}</p>
                </div>
              )}

              {/* Les retraites et les groupes gardent leur détail dans leur volet :
                  en sections séparées, ils répétaient un poste déjà listé. */}
              {p.cle === 'retraites' && (
                <div className="space-y-3 text-foreground/80">
                  <p>
                    {t('retraitesCouverture', {
                      couvDeputes: pourcent.format(RETRAITES.cotisationsDeputes / RETRAITES.pensionsAnciensDeputes),
                      couvTotale: pourcent.format(RETRAITES.couvertureAvecContribution),
                      pensions: eur(RETRAITES.pensionsAnciensDeputes),
                      beneficiaires: nombre.format(RETRAITES.beneficiairesAnciensDeputes),
                    })}
                  </p>
                  <p>
                    {t('retraitesContractuels', {
                      couv2019: pourcent.format(RETRAITES.couverturePersonnel2019),
                      couv2025: pourcent.format(RETRAITES.couverturePersonnel2025),
                      part2021: pourcent.format(AGENTS.partContractuels2021),
                      part2025: pourcent.format(AGENTS.partContractuels),
                      subvention: eur(RETRAITES.subventionEquilibrePersonnel),
                      hausse: pourcent.format(RETRAITES.hausseSubventionPersonnel),
                    })}
                  </p>
                  <p>
                    {t.rich('retraitesEngagements', {
                      ...BALISES,
                      deputes: eur(RETRAITES.engagementsAnciensDeputes),
                      personnel: eur(RETRAITES.engagementsPersonnel),
                      annees: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
                        (RETRAITES.engagementsAnciensDeputes + RETRAITES.engagementsPersonnel) / TOTAUX.depense,
                      ),
                    })}
                  </p>
                </div>
              )}
              {p.cle === 'groupes' && (
                <div className="space-y-3">
                  <p className="font-medium">{t('groupesListeTitre')}</p>
                  {/* En euros exacts : en notation compacte, « 1,1 M € » voisinait
                      avec « 900 148 € » et les groupes ne se comparaient plus. */}
                  <ul className="space-y-2">
                    {GROUPES.map((g) => (
                      <Ligne key={g.nom} label={g.nom} valeur={exact.format(g.annuel)} />
                    ))}
                  </ul>
                  <p className="text-foreground/70">{t('groupesNote')}</p>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* QUI TRAVAILLE À L'ASSEMBLÉE */}
      {titreSection('sectionEffectifs')}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('effectifsTitle')}</CardTitle>
          <CardDescription>{t('effectifsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Chaque chiffre à côté de son explication : trois chiffres en tête
              et cinq constats dessous ne se répondaient pas. On n'additionne pas
              les lignes, le rapport compte les collaborateurs en contrats de
              travail et non en personnes. */}
          <ul className="divide-y">
            {[
              {
                valeur: AGENTS.deputesFin2025,
                label: t('effectifsDeputesLabel'),
                texte: t.rich('effectifsDeputes', { ...BALISES, sieges: SIEGES }),
              },
              {
                valeur: AGENTS.fonctionnaires,
                label: t('effectifsFonctionnairesLabel'),
                texte: t.rich('effectifsFonctionnaires', {
                  ...BALISES,
                  en2017: nombre.format(AGENTS.fonctionnaires2017),
                  departs: AGENTS.departsFonctionnaires,
                  entrees: AGENTS.entreesFonctionnaires,
                }),
              },
              {
                valeur: AGENTS.contractuels,
                label: t('effectifsContractuelsLabel'),
                texte: t.rich('effectifsContractuels', {
                  ...BALISES,
                  agents: nombre.format(AGENTS.fonctionnaires + AGENTS.contractuels),
                  part: pourcent.format(AGENTS.partContractuels),
                  hausse: AGENTS.hausseContractuels5Ans,
                  recrutements: AGENTS.recrutementsContractuels,
                  remplacements: AGENTS.remplacementsFonctionnaires,
                  cabinet: AGENTS.cabinetPresidence,
                }),
              },
              { valeur: MANDAT.contratsCollaborateurs, label: t('effectifsCollabLabel'), texte: t.rich('effectifsCollaborateurs', BALISES) },
            ].map((ligne) => (
              <li key={ligne.label} className="grid grid-cols-1 sm:grid-cols-[13rem_1fr] gap-x-6 gap-y-2 py-4 first:pt-0">
                <Figure valeur={nombre.format(ligne.valeur)} label={ligne.label} />
                <p className="text-sm leading-relaxed text-foreground/80 sm:pt-2">{ligne.texte}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm leading-relaxed text-foreground/80 border-t pt-4">
            {t.rich('effectifsRenforts', {
              ...BALISES,
              gardes: AGENTS.gardesRepublicains,
              interim: eur(sousPoste('personnel', 'interim')),
              apprentis: AGENTS.apprentis,
              stagiaires: AGENTS.stagiaires,
            })}
          </p>
        </CardContent>
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{t.rich('effectifsNote', BALISES)}</p>
        </div>
      </Card>

      {/* ④ LES FRAIS DES DÉPUTÉS */}
      {titreSection('sectionFrais')}
      <p className="text-sm text-foreground/80 leading-relaxed mb-4">{t('fraisIntro')}</p>
      <div className="grid grid-cols-1 gap-6 mb-12">
        {/* La rémunération et les moyens de la fonction ne s'additionnent
            jamais : un total unique passait pour la paie du député, alors que
            seule la rémunération lui revient. Pour la même raison, les deux
            chiffres sont posés l'un sous l'autre, sans signe « + » qui les
            ferait lire comme une somme. Les trois enveloppes, elles,
            s'additionnent en « moyens » (l'avance à son montant officiel, le reste
            en moyenne par siège), pour que le chiffre de tête retombe sur les
            chiffres des lignes. La page
            raconte l'exercice 2025 : les montants 2026 ne paraissent que dans
            l'encadré de l'enveloppe 1 et dans l'enveloppe 2. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('dotationTitle')}</CardTitle>
            <CardDescription>{t('dotationDesc', { sieges: SIEGES })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-6 pb-6 border-b">
              {/* La légende nuance « la seule somme qui revient au député » : les
                  titulaires d'une fonction particulière touchent une indemnité en plus. */}
              <Figure
                valeur={centimes.format(INDEMNITE_BRUTE)}
                label={t('resumeRemuneration', {
                  min: centimes.format(INDEMNITE_SPECIALE.min),
                  max: centimes.format(INDEMNITE_SPECIALE.max),
                })}
              />
              <Figure
                valeur={exact.format(moyensFonction)}
                label={t('resumeMoyens')}
              />
            </div>
            <p className="text-sm font-semibold">{t('detailMoyens', { total: exact.format(moyensFonction) })}</p>
            <ul className="divide-y">
              {[
                {
                  cle: 'frais',
                  // Le grand chiffre additionne les deux parties de l'enveloppe, et
                  // chacune a sa ligne dessous : l'avance au montant officiel, versé
                  // en entier chaque mois ; la dotation matérielle, sans montant
                  // publié par député, en moyenne par siège. Les lignes arrondies à
                  // l'euro retombent sur le total.
                  figures: [
                    {
                      valeur: exact.format(AVANCE_MENSUELLE_2025.metropoleOutreMer + parSiegeMois(dotationMaterielle)),
                      label: t('enveloppeFraisTitre'),
                    },
                  ],
                  label: t('enveloppeFraisLabel', { avant: exact.format(AVANCE_MENSUELLE_2025.avantMai) }),
                  lignes: [
                    { label: t('enveloppeFraisAvanceTitre'), valeur: exact.format(AVANCE_MENSUELLE_2025.metropoleOutreMer) },
                    { label: t('enveloppeFraisMaterielTitre'), valeur: exact.format(parSiegeMois(dotationMaterielle)) },
                  ],
                  textes: [
                    t.rich('enveloppeFrais', {
                      ...BALISES,
                      avance: exact.format(AVANCE_MENSUELLE_2025.metropoleOutreMer),
                      avant: exact.format(AVANCE_MENSUELLE_2025.avantMai),
                      pacifique: exact.format(AVANCE_MENSUELLE_2025.pacifique),
                      etranger: exact.format(AVANCE_MENSUELLE_2025.etranger),
                    }),
                    t.rich('enveloppeFraisMaterielTexte', {
                      ...BALISES,
                      moyenne: exact.format(parSiegeMois(dotationMaterielle)),
                      total: eur(dotationMaterielle),
                      sieges: SIEGES,
                    }),
                  ],
                  // L'encadré dit pourquoi aucun détail n'est publié : d'abord le
                  // contrôle de l'avance (justifiée mais jamais additionnée), puis ce
                  // que la fusion de 2026 rend invisible de la dotation matérielle. Il
                  // se lit à côté des deux parties concernées, pas dans une carte à part.
                  encadre: [
                    t.rich('fraisControle', {
                      ...BALISES,
                      plafond: exact.format(CONTROLE.plafondSansJustificatif),
                    }),
                    t.rich('fraisInvisible', {
                      ...BALISES,
                      dotation: centimes.format(DOTATION_MENSUELLE.metropole),
                      horsEurope: centimes.format(DOTATION_MENSUELLE.horsEurope),
                      materiel: eur(dotationMaterielle),
                      total: eur(fraisCourants2025),
                    }),
                  ],
                },
                {
                  cle: 'collaborateurs',
                  // Coût réel moyen en grand, pour que les moyens s'additionnent ; le
                  // crédit mensuel, qui ne couvre que les salaires bruts et dont les
                  // reliquats se reportent, en ligne.
                  figures: [{ valeur: exact.format(parSiegeMois(poste('collaborateurs').montant)), label: t('enveloppeCollabTitre') }],
                  label: t('enveloppeCollabLabel'),
                  lignes: [
                    { label: t('enveloppeCollabCout'), valeur: exact.format(MANDAT.creditCollaborateurMensuel) },
                  ],
                  textes: [
                    t.rich('enveloppeCollaborateurs', BALISES),
                    t('enveloppeCollab2026', {
                      credit: exact.format(REFORME.creditCollaborateur2026),
                      transfert: exact.format(REFORME.transfertCollaborateurMensuel),
                    }),
                  ],
                },
                {
                  cle: 'directe',
                  figures: [{ valeur: exact.format(parSiegeMois(enveloppe3)), label: t('enveloppeDirecteTitre') }],
                  label: t('enveloppeDirecteLabel'),
                  lignes: [],
                  textes: [
                    t.rich('enveloppeDirecte', {
                      ...BALISES,
                      loyers: nombre.format(MANDAT.deputesLoyersParis),
                      nuits: nombre.format(MANDAT.nuitsHotel),
                      residence: nombre.format(MANDAT.nuitsResidence),
                    }),
                  ],
                },
              ].map((bloc) => (
                // Même mise en ligne que « Qui travaille à l'Assemblée » : les
                // chiffres et leur nom à gauche, ce qu'ils recouvrent à droite.
                <li key={bloc.cle} className="grid grid-cols-1 sm:grid-cols-[13rem_1fr] gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
                  <div className="space-y-4">
                    {bloc.figures.map((f) => (
                      <Figure key={f.label} valeur={f.valeur} label={f.label} petit />
                    ))}
                  </div>
                  <div className="space-y-3 sm:pt-2">
                    <p className="text-sm text-muted-foreground">{bloc.label}</p>
                    {bloc.lignes.length > 0 && (
                      <ul className="space-y-2">
                        {bloc.lignes.map((l) => (
                          <Ligne key={l.label} label={l.label} valeur={l.valeur} />
                        ))}
                      </ul>
                    )}
                    {bloc.textes.map((texte, n) => (
                      <p key={n} className="text-sm leading-relaxed text-foreground/80">{texte}</p>
                    ))}
                    {bloc.encadre && (
                      <div className="rounded-lg bg-muted p-4 text-sm leading-relaxed space-y-3">
                        {bloc.encadre.map((texte, n) => (
                          <p key={n}>{texte}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
          <div className="border-t px-6 py-4">
            <p className="text-sm text-foreground/70 leading-relaxed">
              {t.rich('dotationNote', BALISES)}
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('reglesTitle')}</CardTitle>
            <CardDescription>{t('reglesDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Constats
              items={[
                t.rich('regleSansJustificatif', {
                  ...BALISES,
                  plafond: exact.format(CONTROLE.plafondSansJustificatif),
                  propose: exact.format(CONTROLE.plafondPropose),
                  avant: exact.format(CONTROLE.plafondProposeAvant),
                }),
                t.rich('regleChant', BALISES),
                t.rich('regleBaguettes', BALISES),
                t.rich('regleAvocat', BALISES),
                t.rich('regleAmitie', BALISES),
                t.rich('regleProches', BALISES),
              ]}
            />
          </CardContent>
          <div className="border-t px-6 py-4">
            <p className="text-sm text-foreground/70 leading-relaxed">{t.rich('reglesNote', BALISES)}</p>
          </div>
        </Card>
      </div>

      {/* ⑤ QUI CONTRÔLE, ET AVEC QUELLES FAILLES */}
      {titreSection('sectionControle')}
      <div className="grid grid-cols-1 gap-6 mb-12">
        <Card>
          <CardHeader>
            <CardTitle>{t('controleTitle')}</CardTitle>
            <CardDescription>{t('controleDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Constats
              items={[
                t.rich('controleDecision', BALISES),
                t.rich('controleCommission', BALISES),
                t.rich('controleCour', { ...BALISES, nb: TRANSPARENCE.recommandationsCour }),
                t.rich('controleDeontologue', BALISES),
              ]}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2">
              <Figure valeur={nombre.format(CONTROLE.deputesControles)} label={t('controleDeputes')} />
              <Figure valeur={eur(CONTROLE.soldesRestitues)} label={t('controleRestitues')} />
              <Figure valeur={eur(CONTROLE.montantReversements)} label={t('controleReversements', { deputes: CONTROLE.demandesReversement })} />
            </div>
            <div className="text-sm leading-relaxed text-foreground/80 space-y-3">
              <p>{t('controleMotifs', { demandes: CONTROLE.demandesRenseignements })}</p>
              <p>{t('controleExemple', { exclusions: CONTROLE.exclusions, montant: exact.format(CONTROLE.exempleRembourse) })}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('faillesTitle')}</CardTitle>
            <CardDescription>{t('faillesDesc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Constats
              items={[
                t.rich('faillePayer', BALISES),
                t.rich('failleRembourser', BALISES),
                t.rich('failleTirage', BALISES),
                t.rich('failleCour', BALISES),
                t.rich('failleConvention', BALISES),
                t.rich('failleAnonymisation', {
                  ...BALISES,
                  jours: nombre.format(CONTROLE.joursAnonymisation),
                  releves: nombre.format(CONTROLE.relevesAnnee),
                }),
                t.rich('failleConges', { ...BALISES, part: pourcent.format(CONTROLE.partCongesDeclares) }),
                t.rich('failleAudit', BALISES),
              ]}
            />
          </CardContent>
          <div className="border-t px-6 py-4">
            <p className="text-sm text-foreground/70 leading-relaxed">{t.rich('faillesNote', BALISES)}</p>
          </div>
        </Card>
      </div>

      {/* ⑥ CE QUI RESTE DANS L'OMBRE */}
      {titreSection('sectionOmbre')}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('ombreTitle')}</CardTitle>
          <CardDescription>{t('ombreDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Constats
            items={[
              t.rich('ombreParDepute', BALISES),
              t.rich('ombreStatistiques', BALISES),
              t.rich('ombreRecommandations', { ...BALISES, nb: TRANSPARENCE.recommandationsCour }),
              t.rich('ombrePatrimoine', {
                ...BALISES,
                bilan: eur(PLACEMENTS.fondsValeurBilan),
                reelle: eur(PLACEMENTS.fondsValeurReelle),
                gain: eur(PLACEMENTS.fondsValeurReelle - PLACEMENTS.fondsValeurBilan),
              }),
              t.rich('ombreRetraites', {
                ...BALISES,
                total: eur(RETRAITES.engagementsAnciensDeputes + RETRAITES.engagementsPersonnel),
                deputes: eur(RETRAITES.engagementsAnciensDeputes),
                personnel: eur(RETRAITES.engagementsPersonnel),
              }),
              t.rich('ombreBail', {
                ...BALISES,
                avant: eur(TRANSPARENCE.engagementsHorsBilan2024),
                apres: eur(TRANSPARENCE.engagementsHorsBilan2025),
              }),
              t.rich('ombreRegistres', {
                ...BALISES,
                deports: TRANSPARENCE.deports,
                cadeaux: TRANSPARENCE.declarationsCadeaux2025,
                voyages: TRANSPARENCE.voyages2025,
                taiwan: TRANSPARENCE.voyagesTaiwan,
                qatar: TRANSPARENCE.voyagesQatar,
              }),
              t.rich('ombreErreurs', {
                ...BALISES,
                caisse1: eur(ERREURS_SOURCE.caissePersonnel[0]),
                caisse2: eur(ERREURS_SOURCE.caissePersonnel[1]),
                prevu1: eur(-ERREURS_SOURCE.deficitPrevu[0]),
                prevu2: eur(-ERREURS_SOURCE.deficitPrevu[1]),
                inv1: pourcent.format(ERREURS_SOURCE.tauxInvestissement[0]),
                inv2: pourcent.format(ERREURS_SOURCE.tauxInvestissement[1]),
                reco1: ERREURS_SOURCE.recommandations2024[0],
                reco2: ERREURS_SOURCE.recommandations2024[1],
                nb: TRANSPARENCE.recommandationsCour,
              }),
            ]}
          />
        </CardContent>
      </Card>

      {/* ⑦ CE QUI ATTEND L'ASSEMBLÉE */}
      {titreSection('sectionAvenir')}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('avenirTitle')}</CardTitle>
          <CardDescription>{t('avenirDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Constats
            items={[
              t.rich('avenirReserves', {
                ...BALISES,
                plancher: eur(RESERVES.plancherPrudentiel),
                rythme: eur(RESERVES.deficitHypothese),
                prevu: eur(-RESERVES.deficitPrevu2026),
                annee: RESERVES.anneeEpuisementTheorique,
              }),
              t.rich('avenirTravaux', { ...BALISES, invest: eur(AVENIR.investissementAnnuelRecent) }),
              t.rich('avenirAccueil', {
                ...BALISES,
                projet: eur(AVENIR.projetAccueilBudget),
                paye: eur(AVENIR.projetAccueilPaye),
              }),
              t.rich('avenirPensions', {
                ...BALISES,
                min: exact.format(AVENIR.gelPensionsEconomieMin),
                max: exact.format(AVENIR.gelPensionsEconomieMax),
              }),
            ]}
          />
        </CardContent>
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{t.rich('avenirNote', BALISES)}</p>
        </div>
      </Card>

      {/* ⑧ 2020-2025 */}
      {titreSection('sectionHistorique')}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('historiqueTitle')}</CardTitle>
          <CardDescription>
            {t('historiqueDesc', {
              deficits: HISTORIQUE.filter((h) => h.solde < 0).length,
              annees: HISTORIQUE.length,
              cumul: eur(-HISTORIQUE.reduce((somme, h) => somme + h.solde, 0)),
              epuisement: RESERVES.anneeEpuisementTheorique,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HistoriqueGraphique
            libelleDepenses={t('historiqueDepenses')}
            libelleRecettes={t('historiqueRecettes')}
            libelleDeficit={t('historiqueLegendeDeficit')}
            libelleExcedent={t('historiqueLegendeExcedent')}
            annees={HISTORIQUE.map((h) => ({
              annee: h.annee,
              depense: h.depense,
              solde: h.solde,
              depenseTexte: eur(h.depense),
              recettesTexte: eur(h.depense + h.solde),
              soldeTexte: t(h.solde >= 0 ? 'historiqueExcedent' : 'historiqueDeficit', { montant: eur(Math.abs(h.solde)) }),
              evenement: h.evenement ? t(`evenement_${h.evenement}` as Cle) : null,
            }))}
          />
          <p className="text-xs text-muted-foreground mt-3">{t('historiqueLecture')}</p>
        </CardContent>
      </Card>

      {/* ⑨ MÉTHODOLOGIE */}
      <Separator className="mb-8" />
      <h2 id="methodologie" className="text-xs font-bold uppercase tracking-widest mb-5 scroll-mt-24" style={{ color: COLOR }}>
        {t('methodologyTitle')}
      </h2>
      <div className="text-sm leading-relaxed text-foreground/80 space-y-4 mb-16">
        <p className="flex gap-3">
          <Target className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t.rich('methodologyPerimetre', BALISES)}</span>
        </p>
        <p className="flex gap-3">
          <FileSearch className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t.rich('methodologyLecture', BALISES)}</span>
        </p>
        <p className="flex gap-3">
          <Filter className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t.rich('methodologyDecoupage', BALISES)}</span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>
            {t('methodologyArrondis', {
              officiel: exact.format(TOTAUX.depense),
              articles: exact.format(TOTAUX.sommeArticles),
              ecart: exact.format(TOTAUX.depense - TOTAUX.sommeArticles),
            })}
          </span>
        </p>
        <p className="flex gap-3">
          <Scale className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>{t('methodologyLimites')}</span>
        </p>
      </div>

      {/* ⑩ EXPLORER */}
      <ExploreSection color={COLOR} currentHref={PATH} locale={locale} />
    </div>
  );
}
