"use client";

// src/app/[locale]/(app)/Month/MonthBar.tsx
// Barre du fil d'actualité : le mois qu'on est en train de lire, son volume,
// deux flèches et un sélecteur de mois.
//
// Composant de présentation pur. Il ne connaît ni `loadMonthAction` ni l'état du
// fil : il reçoit ce qu'il affiche et remonte les intentions, comme
// `BarreAncres` ignore comment ses sections sont chargées.
//
// Elle défile avec la page et ne colle plus sous l'en-tête, comme la barre
// d'ancres des fiches : une barre collante ne peut pas suivre un en-tête qui se
// replie sans se décaler, et Safari ne recalcule jamais le `top` d'un
// `position: sticky` une fois la contrainte posée. Le mois lu reste donné par
// les séparateurs de jour du fil et par `?mois=` dans l'URL, et
// `BoutonRemonter` ramène ici en un geste.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { capitaliser, libelleMoisCourt, libelleMoisLong } from "./monthKeys";

const HAUTEUR_BARRE = "2.875rem";
/** Où colle le rail de filtres, seul élément encore collant de la page : sous
 *  l'en-tête déployé. L'en-tête replié lui laisse cette hauteur libre au-dessus,
 *  ce qui ne recouvre rien, une colonne n'ayant pas de contenu qui défile
 *  derrière elle. */
export const SOUS_BARRE = "calc(4.5rem + 6px)";
/** Ligne de référence du balayage au défilement de MonthFeedClient : le bas de
 *  l'en-tête déployé. */
export const LIGNE_DE_REFERENCE_MOIS = 78;

/** Bouton rond des deux flèches. Le survol passe par l'état React et un style
 *  inline : `hover:` et `group-hover:` ne sont pas fiables sur Safari
 *  (`ARCHITECTURE.md` §Pièges Tailwind v4). */
function FlecheMois({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: "prev" | "next";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  const [survol, setSurvol] = useState(false);
  const Icone = direction === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      style={{
        width: "1.875rem",
        height: "1.875rem",
        flex: "none",
        display: "grid",
        placeItems: "center",
        borderRadius: "9999px",
        border: `1px solid ${!disabled && survol ? "var(--primary)" : "var(--border)"}`,
        backgroundColor: "var(--card)",
        color: !disabled && survol ? "var(--primary)" : "var(--muted-foreground)",
        opacity: disabled ? 0.3 : 1,
        cursor: disabled ? "default" : "pointer",
        transition: "border-color 0.15s ease, color 0.15s ease",
      }}
    >
      <Icone size={14} strokeWidth={2} />
    </button>
  );
}

/** Une case du sélecteur. Survol en état React, même raison que FlecheMois. */
function CaseMois({
  cle,
  locale,
  actif,
  onClick,
}: {
  cle: string;
  locale: string;
  actif: boolean;
  onClick: () => void;
}) {
  const [survol, setSurvol] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setSurvol(true)}
      onMouseLeave={() => setSurvol(false)}
      aria-current={actif ? "true" : undefined}
      style={{
        padding: "0.5rem 0.375rem",
        borderRadius: "0.625rem",
        border: `1px solid ${actif ? "var(--primary)" : "transparent"}`,
        backgroundColor: actif
          ? "color-mix(in srgb, var(--primary) 10%, transparent)"
          : survol
            ? "var(--muted)"
            : "transparent",
        color: actif ? "var(--primary)" : "var(--foreground)",
        fontSize: "0.78125rem",
        fontWeight: actif ? 700 : 500,
        cursor: "pointer",
        transition: "background-color 0.12s ease",
      }}
    >
      {libelleMoisCourt(cle, locale)}
    </button>
  );
}

export function MonthBar({
  moisLu,
  nbEvenements,
  enCours,
  moisDisponibles,
  peutPrecedent,
  peutSuivant,
  occupe,
  onPrecedent,
  onSuivant,
  onChoisir,
  badge,
}: {
  /** Clé `YYYY-MM` du mois actuellement sous la barre. */
  moisLu: string;
  nbEvenements: number;
  /** Vrai quand `moisLu` est le mois en cours, qui n'est pas encore complet. */
  enCours: boolean;
  /** Clés décroissantes, du mois courant au plancher de la législature. */
  moisDisponibles: string[];
  peutPrecedent: boolean;
  peutSuivant: boolean;
  /** Un chargement est en vol : les commandes sont gelées. */
  occupe: boolean;
  onPrecedent: () => void;
  onSuivant: () => void;
  onChoisir: (cle: string) => void;
  /** Posé juste après le sélecteur, hors du bouton : le badge IA est un lien. */
  badge?: ReactNode;
}) {
  const t = useTranslations("month");
  const locale = useLocale();
  const [ouvert, setOuvert] = useState(false);
  const [survolPastille, setSurvolPastille] = useState(false);

  // Le sélecteur groupe par année, dans le sens de lecture du fil : années et
  // mois décroissants. Une `Map` et non un objet : « 2024 » ressemble à un index
  // de tableau, et `Object.entries` réordonne ce genre de clés en croissant,
  // ce qui remonterait 2024 en tête.
  const parAnnee = new Map<string, string[]>();
  for (const cle of moisDisponibles) {
    const an = cle.slice(0, 4);
    const liste = parAnnee.get(an);
    if (liste) liste.push(cle);
    else parAnnee.set(an, [cle]);
  }

  return (
    <div
      style={{
        height: HAUTEUR_BARRE,
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0 1rem",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <FlecheMois direction="prev" label={t("prevMonth")} disabled={!peutPrecedent || occupe} onClick={onPrecedent} />
      <FlecheMois direction="next" label={t("nextMonth")} disabled={!peutSuivant || occupe} onClick={onSuivant} />

      <Popover open={ouvert} onOpenChange={setOuvert}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("chooseMonth")}
            disabled={occupe}
            onMouseEnter={() => setSurvolPastille(true)}
            onMouseLeave={() => setSurvolPastille(false)}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.4375rem",
              minWidth: 0,
              padding: "0.3125rem 0.625rem",
              borderRadius: "0.625rem",
              border: `1px solid ${ouvert || survolPastille ? "var(--border)" : "transparent"}`,
              backgroundColor: ouvert || survolPastille ? "var(--muted)" : "transparent",
              color: "var(--foreground)",
              cursor: occupe ? "default" : "pointer",
              opacity: occupe ? 0.6 : 1,
              transition: "background-color 0.15s ease",
            }}
          >
            <span style={{ fontSize: "0.90625rem", fontWeight: 700, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
              {capitaliser(libelleMoisLong(moisLu, locale))}
            </span>
            {/* Le compte est collé au nom : c'est ce qui dit qu'il qualifie le
                mois. Il tombe le premier sous 640 px, où la place manque. */}
            <span
              className="max-sm:hidden"
              style={{
                fontSize: "0.75rem",
                color: "var(--muted-foreground)",
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              · {t("daySeparator.eventCount", { count: nbEvenements })}
            </span>
            {enCours && (
              <span
                className="max-sm:hidden"
                style={{ fontSize: "0.6875rem", fontWeight: 600, color: "var(--primary)", whiteSpace: "nowrap" }}
              >
                · {t("inProgress")}
              </span>
            )}
            <ChevronDown size={13} strokeWidth={2} style={{ color: "var(--muted-foreground)", alignSelf: "center" }} />
          </button>
        </PopoverTrigger>

        {/* Le portail de Radix est indispensable : un panneau en absolu serait
            prisonnier de la colonne du fil, qui le couperait. */}
        <PopoverContent
          align="start"
          sideOffset={6}
          className="p-4"
          style={{ width: "min(22rem, calc(100vw - 2rem))", maxHeight: "min(70vh, 30rem)", overflowY: "auto" }}
        >
          {[...parAnnee].map(([an, cles]) => (
            <div key={an}>
              <p
                style={{
                  margin: "0.75rem 0 0.5rem",
                  fontSize: "0.6875rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--muted-foreground)",
                }}
              >
                {an}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.375rem" }}>
                {cles.map((cle) => (
                  <CaseMois
                    key={cle}
                    cle={cle}
                    locale={locale}
                    actif={cle === moisLu}
                    onClick={() => {
                      setOuvert(false);
                      onChoisir(cle);
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </PopoverContent>
      </Popover>
      {badge}
    </div>
  );
}
