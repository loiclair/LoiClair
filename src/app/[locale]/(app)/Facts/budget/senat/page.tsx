export const revalidate = 172800; // Rafraîchie chaque nuit par /api/revalidate : les 48 h ne sont qu'un filet.
export const dynamic = 'force-static';

/**
 * /Facts/budget/senat : d'où est venu l'argent du Sénat en 2025, où il est allé,
 * qui y travaille, comment les sénateurs utilisent leurs frais, qui contrôle et
 * avec quelles failles, ce qui reste invisible et ce qui attend l'institution.
 * Chapitre 2 de la série « Budget des chambres », même structure que le
 * chapitre 1 (/Facts/budget/assemblee-nationale) ; coût d'un siège à venir.
 * Aucune requête : tous les chiffres viennent de `lib/budget-senat.ts`, saisis
 * depuis les documents officiels sur les comptes 2025.
 */

import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { buildAlternates, buildOpenGraph } from '@/lib/og-metadata';
import {
  AGENTS,
  AVENIR,
  COMPTABILITE,
  CONTROLE,
  DECOUPAGE,
  DOCUMENTS,
  ENTITES,
  ERREURS_SOURCE,
  EXERCICE,
  GROUPES,
  HISTORIQUE,
  INDEMNITE,
  MANDAT,
  POPULATION,
  POSTES,
  PUBLIC_SENAT,
  RETRAITES,
  SIEGES,
  TOTAUX,
  TRANSPARENCE,
} from '@/lib/budget-senat';
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

const PATH = '/Facts/budget/senat';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'answerBudgetSenat' });
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
 * Mêmes teintes qu'au chapitre 1 pour les mêmes clés, « senateurs » reprenant
 * celle de « deputes » : un poste garde sa couleur d'une chambre à l'autre. Au
 * Sénat, les frais de mandat passent devant les retraites et le Jardin entre
 * dans les huit plus gros postes ; ce jeu et cet ordre passent le validateur de
 * la skill `dataviz` sur le fond clair (#ffffff) comme sur le fond sombre
 * (#181513), mêmes hex dans les deux thèmes (séparation daltonienne ΔE 10,3,
 * contraste >= 3:1). Ne pas changer une teinte ni l'ordre sans le relancer. Le
 * vert du Jardin est trop proche du vert de l'informatique du chapitre 1 pour
 * figurer à côté de lui : un graphique qui réunit les deux chambres devra le
 * revalider. Les cinq derniers postes pèsent chacun moins de 2 % du total et
 * partagent un gris, comme au chapitre 1.
 */
const COULEURS_POSTES: Record<string, string> = {
  personnel: '#e8590c',
  collaborateurs: '#6366f1',
  fraisMandat: '#b8862b',
  retraites: '#db2777',
  senateurs: '#0891b2',
  batiments: '#dc2626',
  groupes: '#8b5cf6',
  jardinMusee: '#65a30d',
};
const GRIS_PETITS_POSTES = '#8a847e';
const couleurPoste = (cle: string) => COULEURS_POSTES[cle] ?? GRIS_PETITS_POSTES;

/** Documents liés dans les textes (`t.rich` ignore les balises absentes d'un message). */
const LIENS = [
  'rapport', 'certification', 'controle', 'indemnite', 'moyens', 'fraisMandat', 'arreteBureau', 'arreteQuesture',
  'circulaire', 'deontologie', 'plf2026', 'rapport2024', 'bureau', 'groupes', 'agas', 'deports', 'cadeaux', 'insee', 'csv',
] as const;

/**
 * Les documents que la page cite, liés à leur source : un lecteur doit pouvoir
 * retrouver chaque chiffre. `b` met en gras l'intitulé d'un constat.
 */
const BALISES = {
  ...Object.fromEntries(
    LIENS.map((cle) => [
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

export default async function BudgetSenatPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'answerBudgetSenat' });
  type Cle = Parameters<typeof t>[0];

  // Mêmes formats qu'au chapitre 1 : compact au-dessus du million, euro exact
  // en dessous.
  const compact = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 2 });
  const exact = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const centimes = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const eur = (n: number) => (Math.abs(n) >= 1_000_000 ? compact.format(n) : exact.format(n));
  const pourcent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
  const pourcentPrecis = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nombre = new Intl.NumberFormat(locale);

  // Les parts se calculent sur la somme des lignes du découpage, pour que les
  // treize postes fassent 100 % ; l'écart de 4 € avec le total officiel est dit
  // dans la méthodologie.
  const partFormat = new Intl.NumberFormat(locale, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const part = (montant: number) => partFormat.format(montant / TOTAUX.sommeLignes);
  const poste = (cle: string) => POSTES.find((p) => p.cle === cle)!;
  const sousPoste = (posteCle: string, cle: string) => poste(posteCle).sousPostes.find((s) => s.cle === cle)!.montant;

  // Montant 2025 ramené à un sénateur et à un mois, pour les moyens sans montant
  // fixe publié : la page dit que ce sont des moyennes.
  const parSiegeMois = (montant: number) => montant / SIEGES / 12;
  const avancesSpecifiques =
    sousPoste('fraisMandat', 'hebergement') + sousPoste('fraisMandat', 'avanceInformatique') + sousPoste('fraisMandat', 'representation');
  // Les trois blocs de moyens tels que la carte les affiche : l'avance générale
  // à son montant officiel, le reste en moyenne par siège. Chaque bloc est arrondi
  // à l'euro avant l'addition, pour que le total affiché retombe sur les blocs
  // affichés (arrondi après coup, il valait 1 € de plus).
  const blocFrais = Math.round(MANDAT.avanceGenerale + parSiegeMois(avancesSpecifiques));
  const blocCollaborateurs = Math.round(parSiegeMois(poste('collaborateurs').montant));
  const blocDirecte = Math.round(parSiegeMois(CONTROLE.prisesEnChargeDirectes));
  const moyensFonction = blocFrais + blocCollaborateurs + blocDirecte;

  // Une seule teinte à deux intensités : l'excédent n'est pas une ressource mais
  // ce qui en reste, il se lit dessous et non comme un segment de la barre.
  const ressources = [
    { cle: 'ressourceEtat', montant: TOTAUX.dotationEtat, opacite: 1 },
    { cle: 'ressourcePropres', montant: TOTAUX.recettesPropres, opacite: 0.45 },
  ];
  const totalRessources = TOTAUX.dotationEtat + TOTAUX.recettesPropres;

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
  // n'utilise pas. Aucun nom ne doit reprendre celui d'une balise de LIENS : la
  // valeur écraserait la balise et next-intl lèverait FORMATTING_ERROR.
  const valeurs = {
    ...BALISES,
    initial: eur(TOTAUX.budgetInitial),
    reparti: eur(TOTAUX.budgetReparti),
    verse: eur(TOTAUX.dotationEtat),
    hausse: eur(TOTAUX.hausseAbandonnee),
    reserve: eur(TOTAUX.miseEnReserve),
    depense: eur(TOTAUX.depense),
    excedent: eur(TOTAUX.solde),
    resultat: eur(COMPTABILITE.resultatComptable),
    charges: eur(COMPTABILITE.chargesTotales),
    senat: eur(ENTITES.senat),
    jardin: eur(ENTITES.jardin),
    musee: exact.format(ENTITES.musee),
    publicSenat: eur(PUBLIC_SENAT),
    subventionAgas: eur(MANDAT.subventionAgas),
    agas2023: eur(MANDAT.subventionAgas2023),
    credit: centimes.format(MANDAT.creditCollaborateur),
    max: MANDAT.collaborateursMax,
    fonctionnaires: nombre.format(AGENTS.fonctionnaires),
    contractuels: nombre.format(AGENTS.contractuels),
    contrats: nombre.format(MANDAT.contratsCollaborateurs),
    avion: eur(sousPoste('fraisMandat', 'avion')),
    caisseSenateurs: eur(sousPoste('retraites', 'anciensSenateurs')),
    caissePersonnel: eur(sousPoste('retraites', 'anciensFonctionnaires')),
    versRetraites: eur(DECOUPAGE.jardinVersRetraites),
    sieges: SIEGES,
    base: centimes.format(INDEMNITE.base),
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
          indemnites: part(sousPoste('senateurs', 'indemnites')),
          parHabitant: centimes.format(TOTAUX.depense / POPULATION),
          parMois: centimes.format(TOTAUX.depense / POPULATION / 12),
          // La chaîne reste hors des postes, dont le total est celui des comptes
          // certifiés : la réponse donne le coût complet à part.
          chaine: eur(PUBLIC_SENAT),
          complet: eur(TOTAUX.depense + PUBLIC_SENAT),
          hl,
        })}
      </p>

      {/* Quatre chiffres : versé plus recettes propres moins dépensé retombe sur
          l'excédent. */}
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
            <Figure valeur={eur(TOTAUX.solde)} label={t('heroExcedent')} />
          </div>
        </CardContent>
      </Card>

      {/* À COMPRENDRE */}
      {titreSection('conceptsTitle')}
      <Accordion type="multiple" className="mb-12">
        {(['Perimetre', 'Circuit', 'Comptes', 'Collaborateurs', 'Renouvellement'] as const).map((n) => (
          <AccordionItem key={n} value={`concept-${n}`}>
            <AccordionTrigger className="text-left">{t(`concept${n}Title` as Cle)}</AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-foreground/80">
              {t.rich(`concept${n}Body` as Cle, valeurs)}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* ② D'OÙ VIENT L'ARGENT */}
      {titreSection('sectionResources')}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('resourcesTitle', { total: eur(totalRessources) })}</CardTitle>
          <CardDescription>{t('resourcesDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Chaque segment nommé et chiffré dessous : la couleur ne porte
              jamais seule l'information (D-097). */}
          <div aria-hidden className="flex w-full overflow-hidden rounded-full" style={{ height: 14 }}>
            {ressources.map((r) => (
              <div
                key={r.cle}
                style={{ width: `${(r.montant / totalRessources) * 100}%`, backgroundColor: COLOR, opacity: r.opacite }}
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
          <ul className="space-y-3 mt-5 pt-4 border-t">
            <Ligne label={t('ressourceDepense')} valeur={eur(TOTAUX.depense)} />
            <Ligne label={t('ressourceExcedent')} valeur={eur(TOTAUX.solde)} />
          </ul>
        </CardContent>
        <div className="border-t px-6 py-4 space-y-3">
          <p className="text-sm text-foreground/70 leading-relaxed">
            {t.rich('resourcesPrelevementNote', {
              ...valeurs,
              prevu: eur(TOTAUX.prelevementPrevu),
              caisses: exact.format(TOTAUX.excedentCaissesSecu),
            })}
          </p>
          <p className="text-sm text-foreground/70 leading-relaxed">
            {t.rich('resourcesReserveNote', {
              ...valeurs,
              reserveBilan: eur(AVENIR.reserveBilan2025),
              reserveMarche: eur(AVENIR.reserveMarche2025),
            })}
          </p>
        </div>
      </Card>

      {/* ③ OÙ VA L'ARGENT, POSTE PAR POSTE */}
      {titreSection('sectionPostes')}
      <p className="text-sm text-foreground/80 leading-relaxed mb-4">{t('postesIntro', { avion: valeurs.avion })}</p>
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
      {/* Barres de ligne à l'échelle du total, comme le pourcentage écrit à côté
          (même règle qu'au chapitre 1). */}
      <Accordion type="multiple" className="mb-12">
        {POSTES.map((p) => (
          <AccordionItem key={p.cle} value={p.cle}>
            <AccordionTrigger className="text-left hover:no-underline">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">{t(`postes.${p.cle}.titre` as Cle)}</span>
                  <span className="tabular-nums shrink-0">
                    <span className="text-muted-foreground font-normal">{part(p.montant)} · </span>
                    <span className="font-semibold" style={{ color: COLOR }}>{eur(p.montant)}</span>
                  </span>
                </div>
                <div aria-hidden className="mt-2 rounded-full bg-muted overflow-hidden" style={{ height: 6 }}>
                  <div style={{ width: `${(p.montant / TOTAUX.sommeLignes) * 100}%`, minWidth: 3, height: '100%', backgroundColor: couleurPoste(p.cle) }} />
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed space-y-4">
              <p className="text-foreground/80">{t.rich(`postes.${p.cle}.desc` as Cle, valeurs)}</p>
              <ul className="space-y-2">
                {p.sousPostes.map((s) => (
                  <Ligne key={s.cle} label={t(`sousPostes.${s.cle}` as Cle)} valeur={eur(s.montant)} />
                ))}
              </ul>
              {/* La chaîne est montrée là où le lecteur la cherche, mais en gris et
                  sous un filet : elle n'entre ni dans le poste ni dans le total,
                  qui restent ceux des comptes certifiés. */}
              {p.cle === 'communication' && (
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-4 text-muted-foreground">
                    <span>{t('chaineHorsTotal')}</span>
                    <span className="tabular-nums shrink-0">{eur(PUBLIC_SENAT)}</span>
                  </div>
                  <p className="text-foreground/70">{t('chaineHorsTotalNote')}</p>
                </div>
              )}

              {/* Ce qui distingue le Sénat de l'Assemblée se lit dans le volet des
                  retraites : les déficits des caisses sont payés hors budget. */}
              {p.cle === 'retraites' && (
                <div className="space-y-3 text-foreground/80">
                  <p>
                    {t('retraitesCaisses', {
                      pensionsSenateurs: eur(RETRAITES.pensionsAnciensSenateurs),
                      pensionnes: nombre.format(RETRAITES.pensionnesSenateurs),
                      cotisationsSenateurs: eur(RETRAITES.cotisationsCaisseSenateurs),
                      pensionsPersonnel: eur(RETRAITES.pensionsPersonnel),
                      cotisationsPersonnel: eur(RETRAITES.cotisationsCaissePersonnel),
                      deficits: eur(RETRAITES.deficitCaisseSenateurs + RETRAITES.deficitCaissePersonnel),
                    })}
                  </p>
                  <p>
                    {t.rich('retraitesPlacements', {
                      ...BALISES,
                      marche: eur(RETRAITES.placementsMarche),
                      couvSenateurs: pourcent.format(RETRAITES.placementsMarcheSenateurs / RETRAITES.engagementsRetraiteSenateurs),
                      couvPersonnel: pourcent.format(RETRAITES.placementsMarchePersonnel / RETRAITES.engagementsRetraitePersonnel),
                    })}
                  </p>
                  <p>{t('retraitesComparaison')}</p>
                </div>
              )}
              {p.cle === 'groupes' && (
                <div className="space-y-3">
                  <p className="font-medium">{t('groupesListeTitre')}</p>
                  {/* En milliers d'euros, l'unité du tableau publié : convertir en
                      euros exacts inventerait une précision absente de la source. */}
                  <ul className="space-y-2">
                    {GROUPES.map((g) => (
                      <Ligne key={g.nom} label={g.nom} valeur={nombre.format(g.milliers)} />
                    ))}
                  </ul>
                  <p className="text-foreground/70">{t.rich('groupesNote', BALISES)}</p>
                </div>
              )}
              {p.cle === 'jardinMusee' && (
                <p className="text-foreground/70">
                  {t('jardinNote', {
                    dotation: eur(ENTITES.dotationJardin),
                    concessions: exact.format(ENTITES.concessionsJardin),
                    redevance: exact.format(ENTITES.redevanceMusee),
                    versRetraites: eur(DECOUPAGE.jardinVersRetraites),
                  })}
                </p>
              )}
              {p.cle === 'collaborateurs' && (
                <p className="text-foreground/70">
                  {t('collaborateursNote', {
                    agents: MANDAT.agentsMisADisposition,
                    coutAgents: exact.format(MANDAT.agentsMisADispositionCout),
                    locaux: exact.format(MANDAT.locauxAgas),
                    conges: eur(MANDAT.congesNonPris),
                  })}
                </p>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* QUI TRAVAILLE AU SÉNAT */}
      {titreSection('sectionEffectifs')}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('effectifsTitle')}</CardTitle>
          <CardDescription>{t('effectifsDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Chaque chiffre à côté de son explication ; on n'additionne pas les
              lignes, les collaborateurs sont comptés en contrats et à une autre
              date. */}
          <ul className="divide-y">
            {[
              { valeur: AGENTS.senateurs, label: t('effectifsSenateursLabel'), texte: t.rich('effectifsSenateurs', BALISES) },
              {
                valeur: AGENTS.fonctionnaires,
                label: t('effectifsFonctionnairesLabel'),
                texte: t.rich('effectifsFonctionnaires', {
                  ...BALISES,
                  texte2024: nombre.format(AGENTS.fonctionnaires2024Texte),
                  annexe2024: nombre.format(AGENTS.fonctionnaires2024Annexe),
                }),
              },
              {
                valeur: AGENTS.contractuels,
                label: t('effectifsContractuelsLabel'),
                texte: t.rich('effectifsContractuels', { ...BALISES, en2024: AGENTS.contractuels2024 }),
              },
              {
                valeur: MANDAT.contratsCollaborateurs,
                label: t('effectifsCollabLabel'),
                texte: t.rich('effectifsCollaborateurs', { ...BALISES, personnes: nombre.format(MANDAT.personnesCollaborateurs) }),
              },
            ].map((ligne) => (
              <li key={ligne.label} className="grid grid-cols-1 sm:grid-cols-[13rem_1fr] gap-x-6 gap-y-2 py-4 first:pt-0">
                <Figure valeur={nombre.format(ligne.valeur)} label={ligne.label} />
                <p className="text-sm leading-relaxed text-foreground/80 sm:pt-2">{ligne.texte}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm leading-relaxed text-foreground/80 border-t pt-4">
            {t.rich('effectifsRetraites', {
              ...BALISES,
              senateurs: nombre.format(RETRAITES.pensionnesSenateurs),
              personnel: nombre.format(RETRAITES.retraitesPersonnel),
            })}
          </p>
        </CardContent>
        <div className="border-t px-6 py-4">
          <p className="text-sm text-foreground/70 leading-relaxed">{t.rich('effectifsNote', BALISES)}</p>
        </div>
      </Card>

      {/* ④ LES FRAIS DES SÉNATEURS */}
      {titreSection('sectionFrais')}
      <p className="text-sm text-foreground/80 leading-relaxed mb-4">{t('fraisIntro')}</p>
      <div className="grid grid-cols-1 gap-6 mb-12">
        {/* Rémunération et moyens de la fonction ne s'additionnent jamais, comme
            au chapitre 1 : seule l'indemnité revient au sénateur. Les deux chiffres
            sont donc posés l'un sous l'autre, sans signe « + ». Les trois blocs
            de moyens s'additionnent, pour que le chiffre de tête retombe sur les
            chiffres des lignes. */}
        <Card>
          <CardHeader>
            <CardTitle>{t('dotationTitle')}</CardTitle>
            <CardDescription>{t('dotationDesc', { sieges: SIEGES })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-6 pb-6 border-b">
              <Figure
                valeur={centimes.format(INDEMNITE.brute)}
                label={t('resumeRemuneration', {
                  fonctionMin: centimes.format(INDEMNITE.fonctionParticuliereMin),
                  fonctionMax: centimes.format(INDEMNITE.fonctionParticuliereMax),
                })}
              />
              <Figure valeur={exact.format(moyensFonction)} label={t('resumeMoyens')} />
            </div>
            <p className="text-sm text-muted-foreground">
              {t('remunerationDetail', {
                base: centimes.format(INDEMNITE.base),
                residence: centimes.format(INDEMNITE.residence),
                fonction: centimes.format(INDEMNITE.fonction),
                nette: centimes.format(INDEMNITE.nette),
              })}
            </p>
            <p className="text-sm font-semibold">{t('detailMoyens', { total: exact.format(moyensFonction) })}</p>
            <ul className="divide-y">
              {[
                {
                  cle: 'frais',
                  valeur: exact.format(blocFrais),
                  titre: t('blocFraisTitre'),
                  label: t('blocFraisLabel'),
                  lignes: [
                    { label: t('blocFraisAvance'), valeur: exact.format(MANDAT.avanceGenerale) },
                    { label: t('blocFraisSpecifiques'), valeur: exact.format(parSiegeMois(avancesSpecifiques)) },
                  ],
                  textes: [
                    t.rich('blocFraisAvanceTexte', {
                      ...BALISES,
                      avance: exact.format(MANDAT.avanceGenerale),
                      avant: exact.format(MANDAT.avanceGeneraleAvant2024),
                      outreMer: exact.format(MANDAT.majorationOutreMer),
                      etranger: exact.format(MANDAT.majorationEtranger),
                      depense: eur(sousPoste('fraisMandat', 'afm')),
                      report: exact.format(MANDAT.reportMax),
                    }),
                    t.rich('blocFraisSpecifiquesTexte', {
                      ...BALISES,
                      hebergement: exact.format(MANDAT.avanceHebergementMax),
                      representation: exact.format(MANDAT.avanceRepresentationMax),
                      informatique: exact.format(MANDAT.avanceInformatiqueTroisAns),
                      total: eur(avancesSpecifiques),
                      sieges: SIEGES,
                    }),
                  ],
                  encadre: t.rich('fraisSansJustificatif', {
                    ...BALISES,
                    plafond: exact.format(MANDAT.sansJustificatifAnnuel),
                    mensuel: exact.format(MANDAT.sansJustificatifMensuel),
                    creances: eur(MANDAT.creancesDiverses),
                  }),
                },
                {
                  cle: 'collaborateurs',
                  valeur: exact.format(blocCollaborateurs),
                  titre: t('blocCollabTitre'),
                  label: t('blocCollabLabel'),
                  lignes: [{ label: t('blocCollabCredit'), valeur: centimes.format(MANDAT.creditCollaborateur) }],
                  textes: [t.rich('blocCollabTexte', { ...BALISES, max: MANDAT.collaborateursMax })],
                },
                {
                  cle: 'directe',
                  valeur: exact.format(blocDirecte),
                  titre: t('blocDirecteTitre'),
                  label: t('blocDirecteLabel'),
                  lignes: [],
                  textes: [
                    t.rich('blocDirecteTexte', {
                      ...BALISES,
                      passages: MANDAT.passagesAvion,
                      taxis: exact.format(MANDAT.taxisAnnuel),
                      taxisMax: exact.format(MANDAT.taxisAnnuelMaxFonctions),
                      telephone: exact.format(MANDAT.telephoneAnnuel),
                      total: eur(CONTROLE.prisesEnChargeDirectes),
                    }),
                  ],
                },
              ].map((bloc) => (
                <li key={bloc.cle} className="grid grid-cols-1 sm:grid-cols-[13rem_1fr] gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0">
                  <div>
                    <Figure valeur={bloc.valeur} label={bloc.titre} petit />
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
                    {'encadre' in bloc && (
                      <div className="rounded-lg bg-muted p-4 text-sm leading-relaxed">{bloc.encadre}</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
          <div className="border-t px-6 py-4">
            <p className="text-sm text-foreground/70 leading-relaxed">{t.rich('dotationNote', BALISES)}</p>
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
                t.rich('regleSecheLinge', BALISES),
                t.rich('regleSport', BALISES),
                t.rich('regleTrottinette', BALISES),
                t.rich('regleRolandGarros', BALISES),
                t.rich('regleMicroOndes', BALISES),
                t.rich('regleIA', BALISES),
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
                t.rich('controleCommission', { ...BALISES, membres: CONTROLE.membresCommissionSpeciale }),
                t.rich('controleCour', { ...BALISES, nb: CONTROLE.recommandationsCour, avant: CONTROLE.recommandationsCour2024 }),
                t.rich('controleComite', { ...BALISES, membres: CONTROLE.membresComite }),
              ]}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2">
              <Figure valeur={nombre.format(CONTROLE.senateursControles)} label={t('controleSenateurs')} />
              <Figure valeur={eur(CONTROLE.fraisDeclares)} label={t('controleDeclares')} />
              <Figure valeur={pourcent.format(CONTROLE.tauxControleMoyen)} label={t('controleTaux')} />
            </div>
            <p className="text-sm leading-relaxed text-foreground/80">
              {t('controleMethode', {
                approfondis: CONTROLE.controlesApprofondis,
                transversaux: CONTROLE.controlesTransversaux,
                justificatifs: nombre.format(CONTROLE.justificatifs),
                max: pourcent.format(CONTROLE.tauxControleMax),
              })}
            </p>
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
                t.rich('failleEntreSoi', { ...BALISES, membres: CONTROLE.membresComite }),
                t.rich('failleMontants', BALISES),
                t.rich('failleDirectes', { ...BALISES, total: eur(CONTROLE.prisesEnChargeDirectes) }),
                t.rich('failleSecret', BALISES),
                t.rich('failleCour', BALISES),
                t.rich('failleQuesture', BALISES),
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
              t.rich('ombreParSenateur', BALISES),
              t.rich('ombrePatrimoine', BALISES),
              t.rich('ombrePlusValues', {
                ...BALISES,
                achat: eur(RETRAITES.placementsAchat),
                marche: eur(RETRAITES.placementsMarche),
                latentes: eur(RETRAITES.plusValuesLatentes),
                interets: eur(RETRAITES.interetsARecevoir),
              }),
              t.rich('ombreRetraites', {
                ...BALISES,
                total: eur(RETRAITES.engagementsTotaux),
                avant: eur(RETRAITES.engagementsTotaux2024),
                baisse: eur(RETRAITES.engagementsTotaux2024 - RETRAITES.engagementsTotaux),
                // Deux décimales : arrondis au dixième, 3,41 % et 4,02 % devenaient
                // « 3,4 % » et « 4 % », qui ne sont pas les taux publiés.
                taux2024: pourcentPrecis.format(RETRAITES.tauxActualisation2024),
                taux2025: pourcentPrecis.format(RETRAITES.tauxActualisation2025),
              }),
              t.rich('ombreCapitalInvestissement', { ...BALISES, montant: eur(RETRAITES.capitalRestantAAppeler) }),
              t.rich('ombreRecommandations', { ...BALISES, nb: CONTROLE.recommandationsCour }),
              t.rich('ombreRegistres', {
                ...BALISES,
                nbDeports: TRANSPARENCE.deports2025,
                nbCadeaux: TRANSPARENCE.cadeaux2025,
                deplacements: TRANSPARENCE.deplacements2025,
              }),
              t.rich('ombreErreurs', {
                ...BALISES,
                avion1: exact.format(ERREURS_SOURCE.avion[0]),
                avion2: exact.format(ERREURS_SOURCE.avion[1]),
                ratp1: exact.format(ERREURS_SOURCE.ratp[0]),
                ratp2: exact.format(ERREURS_SOURCE.ratp[1]),
                groupes1: exact.format(ERREURS_SOURCE.groupes[0]),
                groupes2: exact.format(ERREURS_SOURCE.groupes[1]),
                reserve1: eur(ERREURS_SOURCE.reserve[0]),
                reserve2: eur(ERREURS_SOURCE.reserve[1]),
              }),
            ]}
          />
        </CardContent>
      </Card>

      {/* ⑦ CE QUI ATTEND LE SÉNAT */}
      {titreSection('sectionAvenir')}
      <Card className="mb-12">
        <CardHeader>
          <CardTitle>{t('avenirTitle')}</CardTitle>
          <CardDescription>{t('avenirDesc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Constats
            items={[
              t.rich('avenirReserve', {
                ...BALISES,
                fin2026: eur(AVENIR.reserveFin2026),
                fin2027: eur(AVENIR.reserveFin2027),
                fin2028: eur(AVENIR.reserveFin2028),
                mois: AVENIR.moisDeDepensesRequis,
                prevu2025: eur(AVENIR.prelevementPrevu2025ParLeRapport),
              }),
              t.rich('avenirTravaux', {
                ...BALISES,
                inv2026: eur(AVENIR.investissement2026),
                inv2027: eur(AVENIR.investissement2027),
                inv2028: eur(AVENIR.investissement2028),
                prelevement: eur(AVENIR.prelevementPrevu2026),
              }),
              t.rich('avenirDotation', {
                ...BALISES,
                dotation: eur(AVENIR.dotation2027),
                depenses: eur(AVENIR.depenses2027),
              }),
              t.rich('avenirAutonomie', { ...BALISES, annee: AVENIR.anneeAutonomieMenacee }),
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
              hausse: eur(HISTORIQUE[HISTORIQUE.length - 1].depense - HISTORIQUE[0].depense),
              cumul: eur(HISTORIQUE.reduce((somme, h) => somme + h.solde, 0)),
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
          <span>
            {t.rich('methodologyDecoupage', {
              ...BALISES,
              cotisation: exact.format(DECOUPAGE.cotisationCaissePersonnel),
              jardin: exact.format(DECOUPAGE.cotisationCaissePersonnelJardin),
              reste: exact.format(DECOUPAGE.restePersonnelSansDetail),
            })}
          </span>
        </p>
        <p className="flex gap-3">
          <Calculator className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          <span>
            {t('methodologyArrondis', {
              officiel: exact.format(TOTAUX.depense),
              lignes: exact.format(TOTAUX.sommeLignes),
              ecart: exact.format(TOTAUX.depense - TOTAUX.sommeLignes),
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
