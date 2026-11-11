"use client";

// Partie interactive de `/processus-legislatif` : les acteurs (cartes et modale),
// le parcours d'une loi en étapes dépliables, puis les types de textes. Le
// contenu des deux premières sections arrive en props depuis `page.tsx`.

import { useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUpRight, Building2, Check, ChevronDown, Download, ExternalLink, Flag, Landmark, Scale, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface GroupeRow {
  nom: string;
  effectif: number;
  pctRepresentation?: number;
  couleur?: string;
}

interface FactsLink {
  href: string;
  label: string;
}

interface Institution {
  key: string;
  name: string;
  role: string;
  content: string;
  modeElection: string;
  siteOfficielUrl: string;
  groupes?: GroupeRow[];
  factsLinks?: FactsLink[];
}

interface Step {
  number: number;
  label: string;
  title: string;
  description: string;
  details: string;
}

interface ProcessClientProps {
  institutions: Institution[];
  acteursHeading: string;
  acteursIntro: string;
  parcoursHeading: string;
  parcoursIntro: string;
  /** Affiche PDF a telecharger. Absente hors francais : le document n'existe
   *  qu'en francais, on ne le propose donc pas aux autres locales. */
  poster?: { heading: string; desc: string; cta: string };
  steps: Step[];
  roleHeading: string;
  modeElectionHeading: string;
  groupesHeading: string;
  factsLinksHeading: string;
  siteOfficielLabel: string;
  typesHeading: string;
}

/** Carte d'un organe dans la grille des acteurs ; ouvre sa modale. Un bouton, pour
 *  s'atteindre au clavier (Tab) et s'ouvrir par Entrée ou Espace. Un bouton centre
 *  son contenu en hauteur, d'où la colonne flex qui le remet en haut : sans elle, les
 *  titres d'une même rangée, étirée à la carte la plus haute, ne s'alignaient plus.
 *  Des `span` et non `h3`/`p`, qu'un bouton n'admet pas. */
function InstitutionCard({
  institution,
  onSelect,
}: {
  institution: Institution;
  /** Reçoit la carte elle-même, à qui la modale rend le focus en se fermant. */
  onSelect: (carte: HTMLButtonElement) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      className="group w-full text-left rounded-xl overflow-hidden border border-border bg-card cursor-pointer hover:border-primary/40"
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        transition: "box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease",
        WebkitTransition: "box-shadow 0.25s ease, transform 0.25s ease, border-color 0.25s ease",
        boxShadow: hovered
          ? "0 10px 24px rgba(0,0,0,0.12)"
          : "0 1px 3px rgba(0,0,0,0.05)",
        transform: hovered ? "translateY(-3px)" : "translateY(0)",
      }}
      onClick={(e) => onSelect(e.currentTarget)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ padding: "14px 12px" }}>
        <span
          className="block font-semibold"
          style={{ fontSize: "clamp(0.8125rem, 2vw, 0.9375rem)", lineHeight: 1.3 }}
        >
          {institution.name}
        </span>
        <span
          className="block text-muted-foreground"
          style={{ fontSize: "0.75rem", lineHeight: 1.4, marginTop: "0.25rem" }}
        >
          {institution.role}
        </span>
      </div>
    </button>
  );
}

type SectionAccent = { color: string; heading: string };

/** Titre d'une rubrique de `InstitutionModal`, suivi d'un point à la couleur de l'organe. */
function SectionHeading({ accent }: { accent: SectionAccent }) {
  return (
    <h4
      style={{
        fontSize: "17px",
        fontWeight: 800,
        lineHeight: 1.2,
        letterSpacing: "-0.015em",
        color: "var(--foreground)",
        margin: "0 0 0.75rem",
      }}
    >
      {accent.heading}
      <span style={{ color: accent.color }}>.</span>
    </h4>
  );
}

/** Fiche détaillée d'un organe, ouverte depuis `InstitutionCard`. Rendue dans le
 *  `Dialog` de `ProcessClient` : Radix donne le rôle de dialogue, la fermeture par
 *  Échap ou par un clic à côté, le focus gardé dans la fiche puis rendu à la carte,
 *  et le défilement de la page bloqué. */
function InstitutionModal({
  institution,
  roleHeading,
  modeElectionHeading,
  groupesHeading,
  factsLinksHeading,
  siteOfficielLabel,
  onClose,
  rendreFocus,
}: {
  institution: Institution;
  roleHeading: string;
  modeElectionHeading: string;
  groupesHeading: string;
  factsLinksHeading: string;
  siteOfficielLabel: string;
  onClose: () => void;
  /** Remet le focus sur la carte d'origine. Radix ne le rend qu'à un `DialogTrigger`,
   *  et les cartes n'en sont pas : un seul `Dialog` sert les cinq. */
  rendreFocus: () => void;
}) {
  // `percent` place l'espace avant le signe en français et le colle en anglais.
  const locale = useLocale();
  const tCommon = useTranslations("common");
  const pourcent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });

  const domain = institution.siteOfficielUrl.replace(/^https?:\/\//, "");

  const accents = {
    role: { color: "#d4a54a", heading: roleHeading },
    mode: { color: "#16a34a", heading: modeElectionHeading },
    groupes: { color: "#8b5cf6", heading: groupesHeading },
    facts: { color: "#06b6d4", heading: factsLinksHeading },
  } as const;

  return (
    // Le rendu d'avant le passage à Radix est gardé en style en ligne : fond de carte,
    // coins, ombre, hauteur bornée et défilement interne, sans le `p-6` ni la grille
    // de `DialogContent`. La largeur suit `largeurMax`, bornée à `100% - 2rem`.
    <DialogContent
      showCloseButton={false}
      largeurMax="84rem"
      onCloseAutoFocus={(e) => { e.preventDefault(); rendreFocus(); }}
      className="bg-card border-border rounded-xl"
      style={{
        display: "block",
        padding: 0,
        maxHeight: "90vh",
        // L'horizontal reste masqué, comme avant le passage à Radix : laissé libre, il
        // passe en `auto` à côté d'un `overflowY` en `auto`, et un mot du titre (40 px,
        // marges de 48 px) plus large que la fiche la ferait glisser de côté.
        overflowX: "hidden",
        overflowY: "auto",
        boxShadow: "0 8px 32px rgba(0,0,0,0.2)",
      }}
    >
        <DialogClose
          className="absolute bg-muted hover:bg-accent rounded-full flex items-center justify-center transition-colors"
          style={{
            top: "24px",
            right: "24px",
            width: "32px",
            height: "32px",
            zIndex: 1,
          }}
          aria-label={tCommon("close")}
        >
          <X className="text-foreground" style={{ width: "18px", height: "18px" }} />
        </DialogClose>

        <div style={{ padding: "48px 48px 52px" }}>
          {/* Kicker — titre — sous-titre (style newsletter) */}
          <DialogTitle asChild>
          <h3
            style={{
              fontSize: "40px",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              lineHeight: 1.05,
              color: "var(--foreground)",
              margin: 0,
              paddingRight: "3rem",
            }}
          >
            {institution.name}
            <span style={{ color: "#d4a54a" }}>.</span>
          </h3>
          </DialogTitle>
          <DialogDescription asChild>
          <p
            style={{
              marginTop: "10px",
              marginBottom: "2rem",
              fontSize: "17px",
              lineHeight: 1.45,
              fontStyle: "italic",
              fontFamily: "Georgia, 'Times New Roman', serif",
              color: "var(--muted-foreground)",
              maxWidth: "44rem",
            }}
          >
            {institution.role}
          </p>
          </DialogDescription>

          {/* Rôle (description) */}
          <section style={{ marginBottom: "1.75rem" }}>
            <SectionHeading accent={accents.role} />
            <p
              className="text-[15px] text-muted-foreground"
              style={{ lineHeight: 1.75 }}
            >
              {institution.content}
            </p>
          </section>

          {/* Divider fin */}
          <div
            style={{
              height: "1px",
              background: "var(--border)",
              margin: "0 0 3rem",
            }}
          />

          <section style={{ marginBottom: "1.75rem" }}>
            <SectionHeading accent={accents.mode} />
            <p className="text-[15px] text-muted-foreground" style={{ lineHeight: 1.75 }}>
              {institution.modeElection}
            </p>
          </section>

          {institution.groupes && institution.groupes.length > 0 && (
            <>
              <div style={{ height: "1px", background: "var(--border)", margin: "0 0 1.75rem" }} />
              <section style={{ marginBottom: "1.75rem" }}>
                <SectionHeading accent={accents.groupes} />
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-2.5">
                  {institution.groupes.map((g) => (
                    <li
                      key={g.nom}
                      className="flex items-center gap-3 text-[15px] py-1"
                    >
                      <span className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          className="inline-block rounded-full shrink-0"
                          style={{
                            width: "10px",
                            height: "10px",
                            backgroundColor: g.couleur ?? "#A8A29E",
                          }}
                        />
                        <span className="text-foreground truncate">{g.nom}</span>
                      </span>
                      <span
                        className="text-foreground font-semibold tabular-nums shrink-0 text-right"
                        style={{ minWidth: "2.75rem" }}
                      >
                        {g.effectif}
                      </span>
                      {g.pctRepresentation !== undefined && (
                        <span
                          className="text-xs text-muted-foreground tabular-nums shrink-0 text-right"
                          style={{ minWidth: "3.25rem" }}
                        >
                          {pourcent.format(g.pctRepresentation / 100)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {institution.factsLinks && institution.factsLinks.length > 0 && (
            <>
              <div style={{ height: "1px", background: "var(--border)", margin: "0 0 1.75rem" }} />
              <section style={{ marginBottom: "1.75rem" }}>
                <SectionHeading accent={accents.facts} />
                <div className="flex flex-wrap gap-3">
                  {institution.factsLinks.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={onClose}
                      className="inline-flex items-center gap-1.5 transition-colors"
                      style={{
                        padding: "10px 20px",
                        borderRadius: "9999px",
                        border: `2px solid ${accents.facts.color}`,
                        color: accents.facts.color,
                        fontWeight: 600,
                        fontSize: "14px",
                        background: "transparent",
                      }}
                    >
                      {link.label}
                      <span aria-hidden>→</span>
                    </Link>
                  ))}
                </div>
              </section>
            </>
          )}

          <div style={{ height: "1px", background: "var(--border)", margin: "0 0 2rem" }} />

          <a
            href={institution.siteOfficielUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 hover:bg-muted hover:border-primary/40 transition-colors"
            style={{ padding: "18px 22px" }}
          >
            <span className="flex items-center gap-4 min-w-0">
              <span className="flex items-center justify-center rounded-md bg-primary/10 text-primary shrink-0" style={{ width: "40px", height: "40px" }}>
                <ExternalLink className="h-4 w-4" />
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-foreground">
                  {siteOfficielLabel}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {domain}
                </span>
              </span>
            </span>
            <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
          </a>
        </div>
    </DialogContent>
  );
}

/** Une carte de la section des types de textes. `cle` est une clé du namespace `definitions`. */
type TexteType = {
  cle: string;
  peutDevenirLoi: boolean;
  /** Ajoute la liste « Procédure renforcée » sous la définition. */
  renforcee?: boolean;
  /** Clé de `textTypes.titres`, à la place du terme du glossaire. */
  titre?: string;
};

// Classement par auteur du texte. Organique et constitutionnelle figurent dans
// les deux premières listes : la base ne distingue pas projet et proposition
// (« Projet ou proposition de loi organique »), et le lecteur cherche la carte
// du côté de l'auteur qu'il a en tête. La définition reste commune, seul le
// titre dit « Proposition » ou « Projet » selon la liste.
const TEXTES_PARLEMENTAIRES: TexteType[] = [
  { cle: "propositionLoiOrdinaire", peutDevenirLoi: true },
  { cle: "projetLoiOrganique", peutDevenirLoi: true, renforcee: true, titre: "propositionLoiOrganique" },
  { cle: "projetLoiConstitutionnelle", peutDevenirLoi: true, titre: "propositionLoiConstitutionnelle" },
  { cle: "propositionLoiReferendaire", peutDevenirLoi: true },
  { cle: "commissionEnquete", peutDevenirLoi: false },
  { cle: "missionInformation", peutDevenirLoi: false },
  { cle: "rapportInformation", peutDevenirLoi: false },
  { cle: "amendement", peutDevenirLoi: false },
  { cle: "resolution", peutDevenirLoi: false },
  { cle: "resolutionArticle34", peutDevenirLoi: false },
];

const TEXTES_GOUVERNEMENTAUX: TexteType[] = [
  { cle: "projetLoiOrdinaire", peutDevenirLoi: true },
  { cle: "projetLoiOrganique", peutDevenirLoi: true, titre: "projetLoiOrganique" },
  { cle: "projetLoiConstitutionnelle", peutDevenirLoi: true, titre: "projetLoiConstitutionnelle" },
  { cle: "projetFinancesAnnee", peutDevenirLoi: true },
  { cle: "projetFinancesRectificative", peutDevenirLoi: true },
  { cle: "projetFinancementSecu", peutDevenirLoi: true },
  { cle: "projetRatificationTraites", peutDevenirLoi: true },
  { cle: "projetApprobationComptes", peutDevenirLoi: true },
  { cle: "ordonnance", peutDevenirLoi: false },
  { cle: "decret", peutDevenirLoi: false },
  { cle: "engagementResponsabilite", peutDevenirLoi: false },
];

const PROCEDURES_INSTITUTIONNELLES: TexteType[] = [
  { cle: "allocutionPresident", peutDevenirLoi: false },
  { cle: "petitions", peutDevenirLoi: false },
  { cle: "responsabilitePenale", peutDevenirLoi: false },
];

/** Carte d'un type de texte, rendue par `TypesTextesSection` pour chaque entrée de liste. */
function TexteCard({ texte }: { texte: TexteType }) {
  const t = useTranslations("textTypes");
  const tDef = useTranslations("definitions");

  return (
    <div className="rounded-lg bg-muted/50 p-4">
      <div className="flex items-start justify-between gap-2 mb-1">
        <h4 className="text-sm font-semibold">
          {texte.titre ? t(`titres.${texte.titre}`) : tDef(`${texte.cle}.term`)}
        </h4>
        {texte.peutDevenirLoi && (
          <Badge
            variant="outline"
            className="border-teal-600 text-teal-700 dark:text-teal-400 text-[10px] shrink-0"
          >
            {t("legendLabel")}
          </Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{tDef(`${texte.cle}.definition`)}</p>
      {texte.renforcee && (
        <>
          <p className="mt-2 text-sm font-medium">{t("procedureRenforcee.label")}</p>
          <ul className="list-disc pl-5 text-sm mt-1 space-y-1 text-muted-foreground">
            <li>{t("procedureRenforcee.item1")}</li>
            <li>{t("procedureRenforcee.item2")}</li>
            <li>{t("procedureRenforcee.item3")}</li>
            <li>{t("procedureRenforcee.item4")}</li>
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">{t("procedureRenforcee.examples")}</p>
        </>
      )}
    </div>
  );
}

/**
 * Section « Les types de textes » de `/processus-legislatif`, en trois listes.
 * Les définitions viennent du namespace `definitions`, celui des infobulles des
 * fiches dossier et élu : un même mot n'a qu'un seul texte sur le site.
 * `textTypes` ne garde que les titres de section, la légende, la liste de la
 * procédure renforcée et les titres propres à chaque liste (`titres`). Le glossaire n'affiche pas ces termes : il renvoie ici
 * par l'ancre `#types-de-textes`, donc chaque procédure de `DEFINITION_KEYS`
 * doit avoir sa carte dans l'une des trois listes, sans quoi elle n'est
 * définie nulle part.
 */
function TypesTextesSection({ heading }: { heading: string }) {
  const t = useTranslations("textTypes");

  return (
    <section id="types-de-textes" style={{ marginTop: "3rem", scrollMarginTop: "78px" }}>
      <h2
        className="font-semibold text-foreground"
        style={{
          fontSize: "clamp(1.125rem, 3vw, 1.5rem)",
          marginBottom: "1rem",
        }}
      >
        {heading}
      </h2>

      <div className="flex flex-wrap items-center gap-2 mb-8 text-sm text-muted-foreground">
        <Badge variant="outline" className="border-teal-600 text-teal-700 dark:text-teal-400 text-[10px]">
          {t("legendLabel")}
        </Badge>
        <span>{t("legendDesc")}</span>
      </div>

      <section className="mb-10">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          <Landmark className="h-3.5 w-3.5" />
          {t("sectionParlementaire")}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">{t("sectionParlementaireDesc")}</p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {TEXTES_PARLEMENTAIRES.map((texte) => (
            <TexteCard key={texte.cle} texte={texte} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          <Building2 className="h-3.5 w-3.5" />
          {t("sectionGouvernemental")}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">{t("sectionGouvernementalDesc")}</p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {TEXTES_GOUVERNEMENTAUX.map((texte) => (
            <TexteCard key={texte.cle} texte={texte} />
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-1">
          <Scale className="h-3.5 w-3.5" />
          {t("sectionInstitutionnel")}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">{t("sectionInstitutionnelDesc")}</p>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {PROCEDURES_INSTITUTIONNELLES.map((texte) => (
            <TexteCard key={texte.cle} texte={texte} />
          ))}
        </div>
      </section>
    </section>
  );
}

/** Rendue par `page.tsx`, qui lui passe les libellés traduits côté serveur. */
export default function ProcessClient({
  institutions,
  acteursHeading,
  acteursIntro,
  parcoursHeading,
  parcoursIntro,
  poster,
  steps,
  roleHeading,
  modeElectionHeading,
  groupesHeading,
  factsLinksHeading,
  siteOfficielLabel,
  typesHeading,
}: ProcessClientProps) {
  const [selectedInstitution, setSelectedInstitution] = useState<string | null>(null);
  const [expandedStep, setExpandedStep] = useState<number | null>(null);
  const carteOuvrante = useRef<HTMLButtonElement | null>(null);

  const selected = institutions.find((i) => i.key === selectedInstitution);

  return (
    <>
      {/* Section 1: Les Acteurs */}
      <section style={{ marginBottom: "3rem" }}>
        <h2
          className="font-semibold text-foreground"
          style={{
            fontSize: "clamp(1.125rem, 3vw, 1.5rem)",
            marginBottom: "0.75rem",
          }}
        >
          {acteursHeading}
        </h2>
        <p
          className="text-muted-foreground"
          style={{
            fontSize: "0.95rem",
            lineHeight: 1.65,
            marginBottom: "1.75rem",
            maxWidth: "52rem",
          }}
        >
          {acteursIntro}
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {institutions.map((inst) => (
            <InstitutionCard
              key={inst.key}
              institution={inst}
              onSelect={(carte) => { carteOuvrante.current = carte; setSelectedInstitution(inst.key); }}
            />
          ))}
        </div>
      </section>

      <Dialog open={!!selected} onOpenChange={(ouvert) => { if (!ouvert) setSelectedInstitution(null); }}>
        {selected && (
          <InstitutionModal
            institution={selected}
            roleHeading={roleHeading}
            modeElectionHeading={modeElectionHeading}
            groupesHeading={groupesHeading}
            factsLinksHeading={factsLinksHeading}
            siteOfficielLabel={siteOfficielLabel}
            onClose={() => setSelectedInstitution(null)}
            rendreFocus={() => carteOuvrante.current?.focus()}
          />
        )}
      </Dialog>

      {/* Section 2: Le Parcours d'une loi */}
      <section>
        <h2
          className="font-semibold text-foreground"
          style={{
            fontSize: "clamp(1.125rem, 3vw, 1.5rem)",
            marginBottom: "0.75rem",
          }}
        >
          {parcoursHeading}
        </h2>
        <p
          className="text-muted-foreground"
          style={{
            fontSize: "0.95rem",
            lineHeight: 1.65,
            marginBottom: "1.75rem",
            maxWidth: "52rem",
          }}
        >
          {parcoursIntro}
        </p>

        <div style={{ maxWidth: "40rem" }}>
          <div className="flex flex-col gap-0">
            {steps.map((step, i) => {
              const isLast = i === steps.length - 1;
              const isExpanded = expandedStep === step.number;
              const isDecrets = step.number === 8;

              return (
                <div key={step.number} className="flex gap-3">
                  <div
                    className="flex flex-col items-center"
                    style={{ width: "14px" }}
                  >
                    <div
                      className="relative shrink-0"
                      style={{
                        width: "14px",
                        height: "14px",
                        marginTop: "3px",
                      }}
                    >
                      {isDecrets ? (
                        <div
                          className="absolute flex items-center justify-center rounded-full bg-primary"
                          style={{
                            top: "0px",
                            left: "0px",
                            width: "14px",
                            height: "14px",
                          }}
                        >
                          <Flag
                            className="text-primary-foreground"
                            style={{ width: "9px", height: "9px" }}
                          />
                        </div>
                      ) : step.number === 7 ? (
                        <div
                          className="absolute flex items-center justify-center rounded-full bg-primary"
                          style={{
                            top: "0px",
                            left: "0px",
                            width: "14px",
                            height: "14px",
                          }}
                        >
                          <Check
                            className="text-primary-foreground"
                            style={{ width: "10px", height: "10px" }}
                          />
                        </div>
                      ) : (
                        <div
                          className="absolute rounded-full border-2 border-primary bg-primary"
                          style={{
                            top: "2px",
                            left: "2px",
                            width: "10px",
                            height: "10px",
                          }}
                        />
                      )}
                    </div>
                    {!isLast && (
                      <div
                        className="border-primary"
                        style={{
                          flex: 1,
                          minHeight: "28px",
                          borderLeftWidth: "2px",
                          borderLeftStyle: "solid",
                        }}
                      />
                    )}
                  </div>

                  <div
                    className="flex flex-col flex-1"
                    style={{ paddingBottom: isLast ? 0 : "8px" }}
                  >
                    {/* Un bouton, pour déplier l'étape au clavier ; `aria-expanded`
                        dit aux lecteurs d'écran si le détail est affiché. */}
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      className="flex items-baseline gap-2 cursor-pointer text-left"
                      style={{ background: "none", border: "none", padding: 0 }}
                      onClick={() =>
                        setExpandedStep(isExpanded ? null : step.number)
                      }
                    >
                      <span className="text-xs text-muted-foreground font-medium">
                        {step.label}
                      </span>
                      <span className="text-sm font-medium text-foreground">
                        {step.title}
                      </span>
                      <ChevronDown
                        className="shrink-0 text-muted-foreground"
                        style={{
                          width: "12px",
                          height: "12px",
                          transform: isExpanded
                            ? "rotate(180deg)"
                            : "rotate(0deg)",
                          transition: "transform 0.2s ease",
                          WebkitTransition: "transform 0.2s ease",
                        }}
                      />
                    </button>

                    <p
                      className="text-xs text-muted-foreground"
                      style={{ marginTop: "2px" }}
                    >
                      {step.description}
                    </p>

                    {isExpanded && (
                      <p
                        className="text-sm text-muted-foreground"
                        style={{
                          marginTop: "6px",
                          lineHeight: 1.6,
                          opacity: 0.85,
                        }}
                      >
                        {step.details}
                      </p>
                    )}

                    {!isLast && (
                      <div style={{ minHeight: "8px" }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {poster && (
            <div
              className="border-t border-border"
              style={{ marginTop: "2rem", paddingTop: "1.25rem" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3
                    className="font-semibold text-foreground"
                    style={{ fontSize: "1rem", marginBottom: "0.125rem" }}
                  >
                    {poster.heading}
                  </h3>
                  <p
                    className="text-muted-foreground"
                    style={{ fontSize: "0.875rem", lineHeight: 1.55 }}
                  >
                    {poster.desc}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <a href="/parcours-dune-loi.pdf" download>
                    <Download aria-hidden="true" />
                    {poster.cta}
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Section 3: Types de textes */}
      <TypesTextesSection heading={typesHeading} />
    </>
  );
}
