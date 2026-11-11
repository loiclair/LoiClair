"use client";

// Fil d'activité de `/Month` : cartes d'événements séparées par jour, rendues par
// `page.tsx` avec le mois d'arrivée. Les autres mois (mois précédent, saut à un
// mois) arrivent côté client par la Server Action `loadMonthAction`.

import { Fragment, useState, useRef, useEffect, useMemo, useCallback } from "react";
import { affichageScrutin, type PositionScrutin } from "@/lib/scrutin-affichage";
import { Link } from "@/i18n/navigation";
import { motion } from "framer-motion";
import {
  FileText,
  FileSearch,
  FileCheck2,
  BarChart3,
  ArrowLeftRight,
  Handshake,
  AlertTriangle,
  Megaphone,
  Gavel,
  Scale,
  CheckCircle2,
  PartyPopper,
  CalendarX,
  Activity,
  Info,
  Loader2,
  Trophy,
  MoreHorizontal,
  ArrowRight,
  Search,
} from "lucide-react";
import { RiSparkling2Fill } from "react-icons/ri";
import { AIBadgeTitre } from "@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements";
import { cn } from "@/lib/utils";
import { getStatusBadgeClass } from "@/lib/status-mapping";
import { statutCC } from "@/lib/statut";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { loadMonthAction } from "./actions";
import { cleStatut } from "./monthLibelles";
import { MonthBar, LIGNE_DE_REFERENCE_MOIS, SOUS_BARRE } from "./MonthBar";
import BoutonRemonter from "@/components/BoutonRemonter";
import { useSortieDeLEcran } from "@/hooks/useSortieDeLEcran";
import { defilementProgramme, marquerDefilementProgramme } from "@/lib/defilement-programme";
import VoileFlou from "@/components/VoileFlou";
import {
  MOIS_PLANCHER,
  appelleElision,
  estMoisValide,
  libelleMoisLong,
  moisEntre,
  moisPrecedent,
  moisSuivant,
} from "./monthKeys";
import { useTranslations, useLocale } from "next-intl";
import type {
  FeedEvent,
  FeedEventType,
  GroupedFeedEvent,
  MonthKpis,
  ScrutinItem,
} from "./page";

// ── Config 11 types + fallback ──────────────────────────────

const EVENT_CONFIG: Record<
  FeedEventType,
  { icon: typeof FileText; labelKey: string; color: string; iconBg: string; colorStyle?: React.CSSProperties; iconBgStyle?: React.CSSProperties }
> = {
  DEPOT_TEXTE: { icon: FileText, labelKey: "eventType.newText", color: "text-primary", iconBg: "bg-primary/10" },
  DEPOT_RAPPORT: { icon: FileSearch, labelKey: "eventType.report", color: "text-slate-600 dark:text-slate-300", iconBg: "bg-slate-500/10" },
  DECISION: { icon: BarChart3, labelKey: "eventType.decision", color: "text-violet-600 dark:text-violet-400", iconBg: "bg-violet-100 dark:bg-violet-900/50" },
  NAVETTE: { icon: ArrowLeftRight, labelKey: "eventType.shuttle", color: "text-stone-500 dark:text-stone-400", iconBg: "bg-stone-100 dark:bg-stone-800/50" },
  CMP_CONVOCATION: { icon: Handshake, labelKey: "eventType.cmpConvocation", color: "text-[#F39C12]", iconBg: "bg-[#F39C12]/10" },
  CMP_RAPPORT: { icon: FileSearch, labelKey: "eventType.report", color: "text-slate-600 dark:text-slate-300", iconBg: "bg-slate-500/10" },
  MOTION_CENSURE: { icon: AlertTriangle, labelKey: "eventType.motionCensure", color: "text-[#E74C3C]", iconBg: "bg-[#E74C3C]/10" },
  DECL_GOUVERNEMENT: { icon: Megaphone, labelKey: "eventType.govDeclaration", color: "text-[#F39C12]", iconBg: "bg-[#F39C12]/10" },
  MOTION_VOTE: { icon: Gavel, labelKey: "eventType.motionVote", color: "text-[#E74C3C]", iconBg: "bg-[#E74C3C]/10" },
  CC_SAISINE: { icon: Scale, labelKey: "eventType.ccSaisine", color: "text-[#F39C12] dark:text-[#F1C40F]", iconBg: "bg-[#F39C12]/10" },
  PROMULGATION: { icon: CheckCircle2, labelKey: "eventType.promulgation", color: "text-[#27AE60] dark:text-[#2ECC71]", iconBg: "bg-[#27AE60]/10" },
  DECRET: { icon: FileCheck2, labelKey: "eventType.decree", color: "text-[#B45309]", iconBg: "bg-[#B45309]/10" },
  LOI_APPLIQUEE: { icon: Trophy, labelKey: "eventType.lawApplied", color: "", iconBg: "", colorStyle: { color: '#D4A017' }, iconBgStyle: { backgroundColor: 'rgba(212, 160, 23, 0.1)' } },
  COMMISSION_CREA: { icon: Search, labelKey: "eventType.commissionCrea", color: "text-[#0891B2] dark:text-[#22D3EE]", iconBg: "bg-[#0891B2]/10" },
  COMMISSION_RAPPORT: { icon: Search, labelKey: "eventType.commissionCrea", color: "text-[#0891B2] dark:text-[#22D3EE]", iconBg: "bg-[#0891B2]/10" },
  COMMISSION_RAPPORT_PUBLIE: { icon: Search, labelKey: "eventType.commissionRapportPublie", color: "text-[#0891B2] dark:text-[#22D3EE]", iconBg: "bg-[#0891B2]/10" },
  AUTRE: { icon: Activity, labelKey: "eventType.other", color: "text-muted-foreground", iconBg: "bg-muted" },
};

const FILTER_PILLS: { value: string; labelKey: string; icon: typeof Activity; color: string; colorStyle?: React.CSSProperties }[] = [
  { value: "tous", labelKey: "filter.all", icon: Activity, color: "text-primary" },
  { value: "DEPOT_TEXTE", labelKey: "filter.texts", icon: FileText, color: "text-primary" },
  { value: "DECISION", labelKey: "filter.decisions", icon: BarChart3, color: "text-violet-600 dark:text-violet-400" },
  { value: "DEPOT_RAPPORT", labelKey: "filter.reports", icon: FileSearch, color: "text-slate-600 dark:text-slate-300" },
  { value: "NAVETTE", labelKey: "filter.shuttles", icon: ArrowLeftRight, color: "text-stone-500 dark:text-stone-400" },
  { value: "CMP", labelKey: "filter.cmp", icon: Handshake, color: "text-[#F39C12]" },
  { value: "CC_SAISINE", labelKey: "filter.ccSaisine", icon: Scale, color: "text-[#F39C12] dark:text-[#F1C40F]" },
  { value: "PROMULGATION", labelKey: "filter.promulgations", icon: CheckCircle2, color: "text-[#27AE60] dark:text-[#2ECC71]" },
  { value: "DECRET", labelKey: "filter.decrees", icon: FileCheck2, color: "text-[#B45309]" },
  { value: "LOI_APPLIQUEE", labelKey: "filter.appliedLaws", icon: Trophy, color: "", colorStyle: { color: '#D4A017' } },
  { value: "MOTION", labelKey: "filter.motions", icon: AlertTriangle, color: "text-[#E74C3C]" },
  { value: "COMMISSION_CREA", labelKey: "filter.commissionCrea", icon: Search, color: "text-[#0891B2] dark:text-[#22D3EE]" },
];

/** Le groupe passe-t-il les filtres actifs ? Reçoit le groupe entier, et non son
 *  seul type, pour le cas des lois d'application directe : elles n'ont qu'une carte
 *  « Promulgation » (badge « Application directe »), jamais de carte « Loi appliquée »,
 *  qui ne naît qu'au dernier décret d'une loi qui en attendait. Le filtre « Lois
 *  appliquées » les montre aussi, comme l'infolettre, qui les compte appliquées et
 *  renvoie vers ce filtre : sans cela, un mois sans décret final rendait un filtre vide. */
function matchesFilters(groupe: GroupedFeedEvent, filters: Set<string>): boolean {
  if (filters.has("tous")) return true;
  const type = groupe.type;
  for (const f of filters) {
    // La première promulgation du groupe, celle dont `PosterCard` affiche le badge :
    // le filtre ne retient que les cartes qui portent « Application directe ».
    if (f === "LOI_APPLIQUEE" && type === "PROMULGATION"
      && groupe.events.find(e => e.type === "PROMULGATION")?.applicationDirecte) return true;
    if (f === "DEPOT_RAPPORT" && (type === "DEPOT_RAPPORT" || type === "CMP_RAPPORT")) return true;
    if (f === "COMMISSION_CREA" && (type === "COMMISSION_RAPPORT" || type === "COMMISSION_RAPPORT_PUBLIE")) return true;
    if (f === "CMP" && type === "CMP_CONVOCATION") return true;
    if (f === "MOTION" && type === "MOTION_CENSURE") return true;
    if (type === f) return true;
  }
  return false;
}

type TFunction = ReturnType<typeof useTranslations<"month">>;

function institutionName(codeType: string | null, fallback: string | null, t: TFunction): string | null {
  if (codeType === "ASSEMBLEE") return t("institution.assemblee");
  if (codeType === "SENAT") return t("institution.senat");
  if (codeType === "CMP") return t("institution.cmp");
  if (codeType === "CONSTITU") return t("institution.cconstit");
  if (codeType === "GOUVERNEMENT") return t("institution.gouvernement");
  return fallback;
}

function formatDaySeparator(dateStr: string, locale: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const s = d.toLocaleDateString(locale, {
    weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Gradient + avatar tokens per event type ─────────────────

function gradToken(type: FeedEventType): string {
  switch (type) {
    case "PROMULGATION": return "pro";
    case "DECISION": return "dec";
    case "NAVETTE": return "nav";
    case "DEPOT_TEXTE": return "text";
    case "DEPOT_RAPPORT":
    case "CMP_RAPPORT": return "rep";
    case "MOTION_CENSURE":
    case "MOTION_VOTE": return "mot";
    case "LOI_APPLIQUEE": return "law";
    case "DECRET": return "decr";
    case "CC_SAISINE":
    case "CMP_CONVOCATION":
    case "DECL_GOUVERNEMENT": return "amb";
    case "COMMISSION_CREA":
    case "COMMISSION_RAPPORT":
    case "COMMISSION_RAPPORT_PUBLIE": return "com";
    default: return "neutral";
  }
}

function posterAvatarLabel(type: FeedEventType, e: FeedEvent): string {
  if (type === "PROMULGATION" || type === "LOI_APPLIQUEE" || type === "DECRET" || type === "DECL_GOUVERNEMENT") return "GV";
  if (type === "MOTION_CENSURE" || type === "COMMISSION_CREA" || type === "COMMISSION_RAPPORT" || type === "COMMISSION_RAPPORT_PUBLIE") return "AN";
  if (e.organeCodeType === "ASSEMBLEE" || e.organeCodeType === "COMASSE") return "AN";
  if (e.organeCodeType === "SENAT" || e.organeCodeType === "COMSENAT") return "SN";
  if (e.organeCodeType === "CONSTITU") return "CC";
  if (e.organeCodeType === "CMP") return "CMP";
  if (type === "DEPOT_TEXTE" && e.auteurChambre) {
    if (e.auteurChambre === "AN") return "AN";
    if (e.auteurChambre === "SENAT") return "SN";
    if (e.auteurChambre === "GOUV") return "GV";
  }
  return "•";
}

// ── VoteBar ─────────────────────────────────────────────────

type VoteData = { typeVoteCode?: string | null; votePour?: number | null; voteContre?: number | null; voteAbstentions?: number | null; voteVotants?: number | null; voteNonVotants?: number | null; voteSuffragesRequis?: number | null; chambre?: string | null };

// Teinte pleine d'un segment ; le reste neutre suit le thème, d'où le null.
const VOTE_COULEUR: Record<PositionScrutin, string | null> = {
  pour: "#27AE60",
  contre: "#E74C3C",
  abstentions: "#A8A29E",
  nonVotants: "#F39C12",
  absents: null,
  nonRecenses: null,
};

// Clé de traduction du libellé de chaque segment, dans le namespace `month`.
const VOTE_LABEL_KEY: Record<PositionScrutin, string> = {
  pour: "vote.for",
  contre: "vote.against",
  abstentions: "vote.abstentions",
  nonVotants: "vote.nonVoting",
  absents: "vote.absent",
  nonRecenses: "vote.notRecorded",
};
function VoteBar({ event }: { event: VoteData }) {
  const t = useTranslations("month");
  if (event.votePour == null) return null;
  // `affichageScrutin` décide des segments : la carte de la fiche dossier lit le même
  // module, pour qu'un vote ne se raconte pas de deux façons selon la page.
  const { total, segments, majoritePct, participationPct, estMotionCensure } = affichageScrutin({
    typeVoteCode: event.typeVoteCode ?? null,
    pour: event.votePour ?? 0,
    contre: event.voteContre ?? 0,
    abstentions: event.voteAbstentions ?? 0,
    nonVotants: event.voteNonVotants ?? 0,
    votants: event.voteVotants ?? 0,
    suffragesRequis: event.voteSuffragesRequis ?? 0,
    chambre: event.chambre ?? null,
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex flex-col gap-1.5 pointer-events-auto">
          <div className="relative h-2 rounded-full overflow-hidden" style={{ display: "flex", backgroundColor: "rgba(28,25,23,0.08)", WebkitMaskImage: "-webkit-radial-gradient(white, black)" }}>
            {segments.map(({ cle, valeur }) => {
              const couleur = VOTE_COULEUR[cle];
              if (couleur === null) {
                return (
                  <Fragment key={cle}>
                    <div style={{ flex: "1 1 auto", backgroundColor: "#C9C4BC" }} className="h-full dark:hidden" />
                    <div style={{ flex: "1 1 auto", backgroundColor: "#57534E" }} className="h-full hidden dark:block" />
                  </Fragment>
                );
              }
              return (
                <div
                  key={cle}
                  style={{ width: `${(valeur / total) * 100}%`, backgroundColor: couleur, minWidth: valeur > 0 ? "2px" : "0" }}
                  className="h-full"
                />
              );
            })}
            {majoritePct > 0 && <div className="absolute top-0 h-full w-px bg-foreground/70" style={{ left: `${majoritePct}%` }} />}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] tabular-nums">
            {segments.map(({ cle, valeur }) => (
              <span
                key={cle}
                className={cn("inline-flex items-center gap-1.5", VOTE_COULEUR[cle] === null && "text-foreground/40")}
                style={VOTE_COULEUR[cle] ? { color: VOTE_COULEUR[cle] as string } : undefined}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                {t(VOTE_LABEL_KEY[cle] as Parameters<typeof t>[0], { count: valeur })}
              </span>
            ))}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {participationPct !== null && t("vote.participation", { percent: participationPct, count: event.voteVotants ?? 0, total })}
            {participationPct !== null && (event.voteSuffragesRequis ?? 0) > 0 && " \u00b7 "}
            {(event.voteSuffragesRequis ?? 0) > 0 && t("vote.majorityRequired", { count: event.voteSuffragesRequis ?? 0 })}
          </div>
          {estMotionCensure && (
            <div className="text-[11px] text-muted-foreground">{t("vote.motionCensureNote")}</div>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <div className="space-y-0.5">
          {segments.map(({ cle, valeur }) => (
            <div key={cle} className="flex items-center gap-2">
              {VOTE_COULEUR[cle] === null
                ? <div className="w-2 h-2 rounded-full shrink-0 bg-[#F0EDEA] dark:bg-[#44403C]" />
                : <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: VOTE_COULEUR[cle] as string }} />}
              {t(VOTE_LABEL_KEY[cle] as Parameters<typeof t>[0], { count: valeur })}
            </div>
          ))}
          {(event.voteSuffragesRequis ?? 0) > 0 && <div className="pt-1 border-t mt-1 text-muted-foreground">{t("vote.majorityRequired", { count: event.voteSuffragesRequis ?? 0 })}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ── Status badge ────────────────────────────────────────────

/**
 * Étiquette d'un statut de conclusion dans la langue de la page. En français, la
 * valeur de la base telle quelle ; sur /en, une décision du Conseil constitutionnel
 * passe par `statutCC`, le reste par `month.statut.*` (`monthLibelles.ts`), et une
 * valeur inconnue sort brute.
 */
function useLibelleStatut() {
  const locale = useLocale();
  const t = useTranslations("month");
  const tIA = useTranslations("resumeIA");
  return (statut: string): string => {
    if (locale === "fr") return statut;
    const cc = statutCC(statut, tIA);
    if (cc.libelle !== statut) return cc.libelle;
    const cle = cleStatut(statut);
    return cle ? t(`statut.${cle}` as Parameters<typeof t>[0]) : statut;
  };
}

/** Badge d'un statut : la couleur suit la valeur brute, l'étiquette `libelle` ou,
 *  à défaut, sa traduction. */
function StatusBadge({ statut, libelle }: { statut: string | null; libelle?: string }) {
  const libelleStatut = useLibelleStatut();
  if (!statut) return null;
  return (
    <span className={cn(
      "inline-block text-[11px] font-medium px-2 py-1 rounded-md leading-relaxed",
      getStatusBadgeClass(statut)
    )} style={{ maxWidth: '66%' }}>
      {libelle ?? libelleStatut(statut)}
    </span>
  );
}

// ── VoteBlock (type + objet + badge + barre) ────────────────

function VoteBlock({ scrutin }: { scrutin: ScrutinItem }) {
  const parts = [
    scrutin.typeVoteLibelle ? scrutin.typeVoteLibelle.charAt(0).toUpperCase() + scrutin.typeVoteLibelle.slice(1) : null,
    scrutin.typeMajorite,
  ].filter(Boolean);
  const typeLabel = parts.length > 0 ? parts.join(' · ') : null;
  return (
    <div className="space-y-1">
      {typeLabel && <p className="text-xs text-muted-foreground">{typeLabel}</p>}
      {scrutin.votePour != null && <VoteBar event={scrutin} />}
      <StatusBadge statut={scrutin.statutConclusion} />
    </div>
  );
}

/** Le vote qu'affiche la carte d'une décision ou d'une motion : celui retenu par le
 *  serveur (`voteLePlusRecent`), pas le premier de la liste, qui garde l'ordre stocké
 *  de `vote_refs`, non chronologique. Lu par `EventBody` (le bloc du vote) et par
 *  `PosterCard` (le bouton vers sa page), qui doivent désigner le même vote. */
function scrutinRetenu(e: FeedEvent): ScrutinItem | null {
  return e.scrutins.find(s => s.uid === e.scrutinUid) ?? e.scrutins[0] ?? null;
}

function ccSaisineLabel(codeActe: string | null, t: TFunction): string | null {
  switch (codeActe) {
    case 'CC-SAISIE-AN': return t('ccSaisine.AN');
    case 'CC-SAISIE-SN': return t('ccSaisine.SN');
    case 'CC-SAISIE-PM': return t('ccSaisine.PM');
    case 'CC-SAISIE-DROIT': return t('ccSaisine.auto');
    default: return null;
  }
}

// ── Type-specific card body ─────────────────────────────────

function EventBody({ group }: { group: GroupedFeedEvent }) {
  const t = useTranslations("month");
  const tIA = useTranslations("resumeIA");
  const { type, events } = group;
  const e = events[0];

  switch (type) {
    case "DEPOT_TEXTE":
      return null;

    case "DEPOT_RAPPORT":
    case "CMP_RAPPORT":
    case "COMMISSION_CREA":
    case "COMMISSION_RAPPORT":
    case "COMMISSION_RAPPORT_PUBLIE":
      return null;

    case "DECISION":
    case "MOTION_CENSURE": {
      const scrutin = scrutinRetenu(e);
      if (!scrutin) {
        if (!e.statutConclusion) return null;
        // Décision du Conseil constitutionnel : badge + explication générique uniquement
        if (e.organeCodeType === "CONSTITU") {
          const cc = statutCC(e.statutConclusion, tIA);
          return (
            <div className="mt-1.5 space-y-1.5">
              <StatusBadge statut={e.statutConclusion} libelle={cc.libelle} />
              {cc.explication && (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {cc.explication}
                </p>
              )}
            </div>
          );
        }
        return <div className="mt-1.5"><StatusBadge statut={e.statutConclusion} /></div>;
      }
      return <div className="mt-1.5 space-y-1.5"><VoteBlock scrutin={scrutin} /></div>;
    }

    case "NAVETTE":
      return null;

    case "CMP_CONVOCATION":
      return null;

    case "DECL_GOUVERNEMENT":
      return null;

    case "CC_SAISINE": {
      const label = ccSaisineLabel(e.codeActe, t);
      return label ? <p className="text-xs text-muted-foreground mt-1">{label}</p> : null;
    }

    case "PROMULGATION": {
      const loiCode = e.codeLoi ?? (() => {
        const m = e.texteUid?.match(/^LOI(\d{4})(\d+)$/);
        return m ? `${m[1]}-${parseInt(m[2], 10)}` : null;
      })();
      return (
        <div className="flex flex-col items-center gap-2 mt-3 mb-1">
          <div className="w-16 h-16 rounded-full bg-[#27AE60]/10 flex items-center justify-center">
            <PartyPopper className="w-8 h-8 text-[#27AE60]" />
          </div>
          {loiCode && <span className="text-sm font-semibold text-[#27AE60]">{t("lawNumber", { code: loiCode })}</span>}
          {e.applicationDirecte && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: '#D4A017', backgroundColor: 'rgba(212, 160, 23, 0.1)' }}>
              <Trophy className="w-3 h-3" />
              {t("directApplication")}
            </span>
          )}
        </div>
      );
    }

    case "LOI_APPLIQUEE": {
      const daysSince = e.datePromulgation
        ? Math.round((new Date(group.date + 'T12:00:00').getTime() - new Date(e.datePromulgation).getTime()) / 86400000)
        : null;
      const delayLabel = daysSince != null && daysSince > 0
        ? daysSince >= 60
          ? t("monthsAfterPromulgation", { count: Math.round(daysSince / 30) })
          : t("daysAfterPromulgation", { count: daysSince })
        : null;

      return (
        <div className="flex flex-col items-center gap-2 mt-3 mb-1">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: 'rgba(212, 160, 23, 0.1)' }}>
            <Trophy className="w-8 h-8" style={{ color: '#D4A017' }} />
          </div>
          <span className="text-sm font-semibold" style={{ color: '#D4A017' }}>
            {t("allDecreesPublished")}
          </span>
          {e.nbMesuresAttendues != null && (
            <span className="text-xs text-muted-foreground">
              {t("measuresApplied", { count: e.nbMesuresAttendues })}
              {e.nbDecrets != null && ` · ${t("decreeCount", { count: e.nbDecrets })}`}
            </span>
          )}
          {delayLabel && (
            <span className="text-xs text-muted-foreground">{delayLabel}</span>
          )}
        </div>
      );
    }

    case "DECRET":
      return null;

    default:
      return null;
  }
}

// ── Card title helper ────────────────────────────────────────

function CardTitle({ group, e }: { group: GroupedFeedEvent; e: FeedEvent }) {
  const t = useTranslations("month");
  const type = group.type;

  if (type === "DEPOT_TEXTE") {
    const prefix: React.ReactNode[] = [];
    if (e.organeName) prefix.push(<span key="o" className="text-foreground/75">{e.organeName} · </span>);
    if (e.libelleActe) prefix.push(<span key="l" className="text-foreground/75">{e.libelleActe}</span>);
    return (
      <div className="space-y-1.5">
        {prefix.length > 0 && <p className="text-[13px] leading-snug">{prefix}</p>}
        <p className="text-base leading-snug font-bold">{e.texteTitre || e.texteDenomination || group.dossierTitre || e.titre}</p>
      </div>
    );
  }
  if (type === "MOTION_CENSURE") {
    return (
      <p className="text-sm leading-snug mb-0.5">
        {group.dossierTitre || e.texteTitre || e.texteDenomination || e.titre}
      </p>
    );
  }
  if (type === "DECRET") {
    const loiRef = e.texteDenomination ? t("forThe", { denomination: e.texteDenomination }) : null;
    const loiTitre = e.texteTitre ?? null;
    const line1 = [loiRef, loiTitre].filter(Boolean).join(' ');
    const line2 = e.texteAdopteTitre || e.titreLoi || e.dossierTitre || null;
    return (
      <div className="space-y-1.5">
        {line1 && <p className="text-[12px] text-foreground/75 leading-snug">{line1}</p>}
        {line2 && <p className="text-base leading-snug font-bold">{line2}</p>}
      </div>
    );
  }
  if (type === "LOI_APPLIQUEE") {
    const titre = e.titreLoi
      ? e.titreLoi.charAt(0).toUpperCase() + e.titreLoi.slice(1)
      : (group.dossierTitre || e.titre);
    return <p className="text-sm leading-snug mb-0.5">{titre}</p>;
  }
  if (type === "PROMULGATION") {
    const titre = e.titreLoi
      ? e.titreLoi.charAt(0).toUpperCase() + e.titreLoi.slice(1)
      : (group.dossierTitre || e.titre);
    return <p className="text-sm leading-snug mb-0.5">{titre}</p>;
  }
  if (type === "NAVETTE") {
    return (
      <p className="text-sm leading-snug mb-0.5">
        <span>{e.texteTitre || group.dossierTitre || e.titre}</span>
      </p>
    );
  }
  if (type === "COMMISSION_CREA" || type === "COMMISSION_RAPPORT") {
    const titre = group.dossierTitre || e.titre;
    const sublabel = type === "COMMISSION_RAPPORT" ? t("eventType.commissionRapportVote") : e.libelleActe;
    const rapporteurLine = e.rapporteurName ? (
      <p className="text-xs text-foreground/75 mt-2">
        <span>{t("rapporteur")}</span>
        <span className="font-bold text-foreground">{e.rapporteurName}</span>
        {e.rapporteurGroupe && <span>/{e.rapporteurGroupe}</span>}
      </p>
    ) : null;
    return (
      <div className="space-y-1">
        <p className="text-[13px] text-foreground/75 leading-snug">{sublabel}</p>
        <p className="text-sm leading-snug">{titre}</p>
        {rapporteurLine}
      </div>
    );
  }
  if (type === "COMMISSION_RAPPORT_PUBLIE") {
    const titre = e.texteTitre || group.dossierTitre || e.titre;
    const rapporteurLine = e.rapporteurName ? (
      <p className="text-xs text-foreground/75 mt-2">
        <span>{t("rapporteur")}</span>
        <span className="font-bold text-foreground">{e.rapporteurName}</span>
        {e.rapporteurGroupe && <span>/{e.rapporteurGroupe}</span>}
        {e.rapporteurIsMultiple && <span> {t("andColleagues")}</span>}
      </p>
    ) : null;
    return (
      <div className="space-y-1">
        <p className="text-sm leading-snug">{titre}</p>
        {rapporteurLine}
      </div>
    );
  }
  if (type === "DEPOT_RAPPORT" || type === "CMP_RAPPORT") {
    const isSingle = group.events.length === 1;
    const ownTitle = isSingle ? (e.texteTitre || e.texteDenomination) : null;
    const fallbackTitle = group.dossierTitre || e.titre;
    const usesFallback = !ownTitle;
    const titre = ownTitle || fallbackTitle;

    let rapporteurLine: React.ReactNode = null;
    if (isSingle && e.rapporteurName) {
      rapporteurLine = (
        <p className="text-xs text-foreground/75 mt-2">
          <span>{t("rapporteur")}</span>
          <span className="font-bold text-foreground">{e.rapporteurName}</span>
          {e.rapporteurGroupe && <span>/{e.rapporteurGroupe}</span>}
          {e.rapporteurIsMultiple && <span> {t("andColleagues")}</span>}
        </p>
      );
    } else if (!isSingle && type === "CMP_RAPPORT") {
      const an = group.events.find(ev => ev.organeCodeType === "ASSEMBLEE");
      const sn = group.events.find(ev => ev.organeCodeType === "SENAT");
      if (an?.rapporteurName || sn?.rapporteurName) {
        rapporteurLine = (
          <p className="text-xs text-foreground/75 mt-2 flex flex-wrap gap-x-3">
            {an?.rapporteurName && (
              <span>
                {t("institution.assemblee")} : <span className="font-bold text-foreground">{an.rapporteurName}</span>
                {an.rapporteurGroupe && <span>/{an.rapporteurGroupe}</span>}
                {an.rapporteurIsMultiple && <span> {t("andColleagues")}</span>}
              </span>
            )}
            {sn?.rapporteurName && (
              <span>
                {t("institution.senat")} : <span className="font-bold text-foreground">{sn.rapporteurName}</span>
                {sn.rapporteurGroupe && <span>/{sn.rapporteurGroupe}</span>}
                {sn.rapporteurIsMultiple && <span> {t("andColleagues")}</span>}
              </span>
            )}
          </p>
        );
      }
    }

    return (
      <>
        <p className="text-sm leading-snug mb-0.5">
          {usesFallback && <span className="text-foreground/75">{t("reportOn")} </span>}
          {titre}
        </p>
        {rapporteurLine}
      </>
    );
  }
  if (type === "DECISION") {
    const isMulti = e.scrutins.length > 1;
    // « sur » ouvre les titres de scrutins du Sénat, « on » leur traduction anglaise.
    const scrutinTitre = !isMulti && e.scrutinTitre
      ? e.scrutinTitre.replace(/^(sur|on)\s+/i, '').replace(/^(.)/, c => c.toUpperCase())
      : null;
    return (
      <p className="text-sm leading-snug mb-0.5">
        {scrutinTitre || e.texteTitre || e.texteDenomination || group.dossierTitre || e.titre}
      </p>
    );
  }
  if (type === "CMP_CONVOCATION" || type === "CC_SAISINE") {
    return (
      <p className="text-sm leading-snug mb-0.5">
        {e.texteTitre || e.texteDenomination || group.dossierTitre || e.titre}
      </p>
    );
  }
  return (
    <p className="text-sm leading-snug mb-0.5">
      {group.dossierTitre || e.titre}
    </p>
  );
}

// ── Context info helper ─────────────────────────────────────
// Ligne en gras de l'en-tête d'une carte : qui dépose, vers quelle chambre part
// la navette, quelle institution décide. Sans cas propre au type, rend le nom de
// l'organe, ou null.

function getContextInfo(type: FeedEventType, e: FeedEvent, multi: boolean, events: FeedEvent[], t: TFunction) {
  if (type === "DEPOT_TEXTE") {
    if (!e.auteur) return null;
    // « GOUV » ne vient que du texte déposé (projet de loi, déclaration), jamais
    // du rôle actuel de la personne : le dépôt s'attribue au Gouvernement, le
    // ministre n'est que celui qui le porte. D'où « Gouvernement · Nom » et non
    // un titre personnel comme l'ancien « Min. ».
    const prefix = e.auteurChambre === 'AN' ? t("prefixDep") : e.auteurChambre === 'SENAT' ? t("prefixSen") : e.auteurChambre === 'GOUV' ? `${t("institution.gouvernement")} · ` : '';
    return <>
      <span className="font-bold text-foreground shrink-0">
        {prefix}
        {e.auteurUid ? <Link href={`/les-elus/${e.auteurUid}`} prefetch={false} className="hover:underline pointer-events-auto">{e.auteur}</Link> : e.auteur}
      </span>
    </>;
  }
  if (type === "NAVETTE") {
    const direction = e.organeCodeType === "SENAT" ? t("shuttleToSenat")
      : e.organeCodeType === "ASSEMBLEE" ? t("shuttleToAssemblee")
      : e.organeName;
    return direction ? <span className="font-bold text-foreground shrink-0">{direction}</span> : null;
  }
  if (type === "DECISION") {
    const isCmpVote = (ev: FeedEvent) => ev.codeActe?.startsWith('CMP-DEBATS');
    if (multi) {
      const insts = [...new Set(events.map(ev => {
        const name = institutionName(ev.organeCodeType, ev.organeName, t);
        return name ? (isCmpVote(ev) ? `${t("texteCMP")} · ${name}` : name) : null;
      }).filter((v): v is string => v !== null))];
      return insts.length > 0 ? <span className="font-bold text-foreground shrink-0">{insts.join(' + ')}</span> : null;
    }
    const inst = institutionName(e.organeCodeType, e.organeName, t);
    const prefix = isCmpVote(e) ? `${t("texteCMP")} · ` : '';
    return inst ? <span className="font-bold text-foreground shrink-0">{prefix}{inst}</span> : null;
  }
  if (type === "DEPOT_RAPPORT") {
    const chambre = e.organeCodeType === "COMSENAT" ? t("institution.senat") : t("institution.assemblee");
    return <span className="font-bold text-foreground shrink-0">{chambre}</span>;
  }
  if (type === "CMP_RAPPORT") {
    return <span className="font-bold text-foreground shrink-0">{t("institution.cmp")}</span>;
  }
  if (type === "MOTION_CENSURE" || type === "COMMISSION_CREA" || type === "COMMISSION_RAPPORT" || type === "COMMISSION_RAPPORT_PUBLIE") {
    return <span className="font-bold text-foreground shrink-0">{t("institution.assemblee")}</span>;
  }
  if (type === "CMP_CONVOCATION") return null;
  if (type === "DECRET" || type === "LOI_APPLIQUEE") {
    return <span className="font-bold text-foreground shrink-0">{t("institution.gouvernement")}</span>;
  }
  if (type === "CC_SAISINE") {
    const inst = institutionName(e.organeCodeType, e.organeName, t);
    return inst ? <span className="shrink-0">/{inst}</span> : null;
  }
  return e.organeName ? <span className="truncate">{e.organeName}</span> : null;
}

// ── Poster head (avatar + who + debug menu) ─────────────────

function PosterHead({ group, e }: { group: GroupedFeedEvent; e: FeedEvent }) {
  const t = useTranslations("month");
  const cfg = EVENT_CONFIG[group.type];
  const Icon = cfg.icon;
  const avatarInitials = posterAvatarLabel(group.type, e);
  const multi = group.events.length > 1;
  const context = getContextInfo(group.type, e, multi, group.events.filter(ev => ev.type === group.type), t);

  const typesInGroup = [...new Set(group.events.map(ev => ev.type))];
  const baseLabel = group.type === "CC_SAISINE" && e.libelleActe ? e.libelleActe : t(cfg.labelKey);
  const tagLabel = typesInGroup.length > 1
    ? typesInGroup.map(ty => t(EVENT_CONFIG[ty].labelKey)).join(" + ")
    : baseLabel;

  return (
    <div className="flex items-center gap-2.5">
      <div className="w-9 h-9 rounded-full bg-white/95 dark:bg-white/90 grid place-items-center shrink-0 shadow-sm">
        {avatarInitials === "•" ? (
          <Icon className={cn("w-4 h-4", cfg.color)} style={cfg.colorStyle} />
        ) : (
          <span className="text-[11px] font-bold tracking-tight text-stone-900">{avatarInitials}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-foreground leading-tight truncate">
          {context ?? e.organeName ?? t(cfg.labelKey)}
        </div>
        {group.type === "DEPOT_TEXTE" && e.groupeAbrege && (
          <div className="text-[12px] text-foreground/70 leading-tight truncate mt-0.5">
            {e.groupeAbrege}
          </div>
        )}
      </div>
      <div
        className={cn(
          "inline-flex items-center rounded-full text-[10px] font-bold uppercase tracking-wide bg-white/90 dark:bg-zinc-900/80 shadow-sm backdrop-blur shrink-0 max-w-[55%]",
          !cfg.colorStyle && cfg.color,
        )}
        style={cfg.colorStyle ?? undefined}
      >
        <span className={cn("inline-flex items-center gap-1 pl-2.5 py-1 min-w-0", AFFICHER_DEBUG ? "pr-1" : "pr-2.5")}>
          <span aria-hidden="true">●</span>
          <span className="truncate">{tagLabel}</span>
        </span>
        {AFFICHER_DEBUG && (
          <>
            <span className="h-3 w-px bg-current opacity-20" aria-hidden="true" />
            <DebugMenu group={group} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Debug popover menu (⋯ in top-right of card) ─────────────

/**
 * Le menu ⋯ expose les identifiants bruts (dossier, actes, scrutins) : utile pour
 * relier une carte à la base pendant le développement, du bruit incompréhensible
 * pour un lecteur. Next remplace `process.env.NODE_ENV` au build, donc le menu
 * n'existe que sous `next dev`.
 */
const AFFICHER_DEBUG = process.env.NODE_ENV === "development";

function DebugMenu({ group }: { group: GroupedFeedEvent }) {
  const acteUids = group.events.map(ev => ev.id.replace(/^(acte|scrutin)-/, ""));
  const texteUids = [...new Set(group.events.map(ev => ev.texteUid).filter(Boolean))];
  const texteAdopteUids = [...new Set(group.events.map(ev => ev.texteAdopteUid).filter(Boolean))];
  const scrutinUids = [...new Set(group.events.map(ev => ev.scrutinUid).filter(Boolean))];
  const codeActes = [...new Set(group.events.map(ev => ev.codeActe).filter(Boolean))];

  return (
    <details className="relative shrink-0 group pointer-events-auto">
      <summary className="list-none cursor-pointer h-full px-2 py-1 grid place-items-center rounded-r-full hover:bg-current/10 transition-colors">
        <MoreHorizontal className="w-3.5 h-3.5" />
      </summary>
      <div className="absolute right-0 top-full mt-1 z-20 bg-popover text-popover-foreground border rounded-lg p-2.5 text-[10px] w-72 shadow-lg font-mono space-y-0.5">
        <div><span className="opacity-50">dossier: </span>{group.dossierUid ?? "—"}</div>
        <div><span className="opacity-50">actes:   </span>{acteUids.join(", ") || "—"}</div>
        {codeActes.length > 0 && <div><span className="opacity-50">codes:   </span>{codeActes.join(", ")}</div>}
        {texteUids.length > 0 && <div><span className="opacity-50">textes:  </span>{texteUids.join(", ")}</div>}
        {texteAdopteUids.length > 0 && <div><span className="opacity-50">adopté:  </span>{texteAdopteUids.join(", ")}</div>}
        {scrutinUids.length > 0 && <div><span className="opacity-50">scrutins:</span>{scrutinUids.join(", ")}</div>}
      </div>
    </details>
  );
}

// ── Data block wrapper (white 82% + blur) ───────────────────

function DataBlock({ children, variant }: { children: React.ReactNode; variant?: "applied" }) {
  return (
    <div
      className={cn(
        "rounded-[14px] p-4 flex flex-col gap-3 shadow-sm backdrop-blur-sm",
        "bg-white/80 dark:bg-zinc-900/70",
        variant === "applied" && "ring-1 ring-inset ring-amber-500/20",
      )}
    >
      {children}
    </div>
  );
}

// ── Sub-event (merged same-dossier same-day, different type) ───

function SubEvent({ event }: { event: FeedEvent }) {
  const t = useTranslations("month");
  const libelleStatut = useLibelleStatut();
  const cfg = EVENT_CONFIG[event.type];
  const SubIcon = cfg.icon;

  let headline: React.ReactNode = null;
  let detail: React.ReactNode = null;

  if (event.type === "NAVETTE") {
    const direction = event.organeCodeType === "SENAT"
      ? t("shuttleToSenat")
      : event.organeCodeType === "ASSEMBLEE"
        ? t("shuttleToAssemblee")
        : event.organeName;
    headline = direction;
    detail = event.texteTitre ?? event.texteDenomination ?? null;
  } else if (event.type === "DECRET") {
    headline = event.texteTitre ?? event.texteAdopteTitre ?? event.dossierTitre ?? event.titre;
    detail = event.texteAdopteDenomination ?? null;
  } else if (event.type === "DECISION" || event.type === "MOTION_CENSURE") {
    headline = event.scrutinTitre ?? event.texteTitre ?? event.titre;
    detail = event.statutConclusion && libelleStatut(event.statutConclusion);
  } else if (event.type === "CC_SAISINE") {
    headline = event.libelleActe ?? t(cfg.labelKey);
    detail = event.texteTitre ?? event.texteDenomination ?? null;
  } else if (event.type === "PROMULGATION") {
    headline = event.titreLoi ?? event.texteTitre ?? event.dossierTitre ?? event.titre;
    detail = event.codeLoi ? t("lawNumber", { code: event.codeLoi }) : null;
  } else if (event.type === "LOI_APPLIQUEE") {
    headline = event.titreLoi ?? event.dossierTitre ?? event.titre;
    detail = event.nbMesuresAttendues != null ? t("measuresApplied", { count: event.nbMesuresAttendues }) : null;
  } else if (event.type === "COMMISSION_RAPPORT") {
    headline = t("eventType.commissionRapportVote");
    detail = event.dossierTitre ?? event.titre;
  } else if (event.type === "COMMISSION_RAPPORT_PUBLIE") {
    headline = t("eventType.commissionRapportPublie");
    detail = event.texteTitre ?? event.dossierTitre ?? event.titre;
  } else {
    headline = event.texteTitre ?? event.dossierTitre ?? event.titre;
  }

  const isRapport = event.type === "DEPOT_RAPPORT" || event.type === "CMP_RAPPORT";
  const chambre = isRapport
    ? (event.organeCodeType === "SENAT" || event.organeCodeType === "COMSENAT")
      ? t("institution.senat")
      : (event.organeCodeType === "ASSEMBLEE" || event.organeCodeType === "COMASSEMBLEE")
        ? t("institution.assemblee")
        : null
    : null;

  return (
    <div className="flex items-start gap-2.5">
      <div
        className={cn("w-7 h-7 rounded-lg grid place-items-center shrink-0", cfg.iconBg)}
        style={cfg.iconBgStyle}
      >
        <SubIcon className={cn("w-3.5 h-3.5", cfg.color)} style={cfg.colorStyle} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap text-[13px] font-semibold text-foreground leading-snug">
          <span className={cn("text-[10px] uppercase tracking-wide font-bold", cfg.color)} style={cfg.colorStyle}>
            {t(cfg.labelKey)}{chambre && ` · ${chambre}`}
          </span>
          {headline && <span className="min-w-0 break-words">{headline}</span>}
        </div>
        {detail && (
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug break-words">
            {detail}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Poster card (Instagram-like) ────────────────────────────

function PosterCard({ group, index }: { group: GroupedFeedEvent; index: number }) {
  const t = useTranslations("month");

  const primaryTypeEvents = group.events.filter(ev => ev.type === group.type);
  const otherTypeEventsRaw = group.events.filter(ev => ev.type !== group.type);
  const otherTypeEvents = (() => {
    const seen = new Set<string>();
    return otherTypeEventsRaw.filter(ev => {
      const sig = `${ev.type}|${ev.organeCodeType ?? ''}|${ev.texteUid ?? ev.texteTitre ?? ev.texteDenomination ?? ''}`;
      if (seen.has(sig)) return false;
      seen.add(sig);
      return true;
    });
  })();
  const primaryGroup: GroupedFeedEvent = { ...group, events: primaryTypeEvents };
  const e = primaryTypeEvents[0];

  const gradKey = gradToken(group.type);
  const sepLabel = group.type === "LOI_APPLIQUEE" ? t("merged.triggeredBy") : t("merged.thenSameDay");

  const bodyHasContent =
    group.type === "DECISION" || group.type === "MOTION_CENSURE" ||
    group.type === "CC_SAISINE" || group.type === "PROMULGATION" ||
    group.type === "LOI_APPLIQUEE" ||
    (group.type === "DEPOT_TEXTE" && !!e.texteAdopteUid && e.texteAdopteUid !== e.texteUid);
  const needsDataBlock = bodyHasContent || otherTypeEvents.length > 0;

  const isLearnMore = group.type === "CMP_CONVOCATION" || group.type === "CC_SAISINE";
  const dossierHref = group.dossierUid && !isLearnMore
    ? `/dossiers-legislatifs/${group.dossierUid}/resume-ia`
    : null;
  const showNoSummaryBadge = dossierHref !== null && !group.dossierHasTexte;
  // Page du vote affiché par la carte. Chaque vote cité par un acte a une liste
  // nominative, donc une page. Pas de bouton sans chiffres : la page n'aurait rien
  // de plus à montrer que la carte.
  const scrutinVote = group.type === "DECISION" || group.type === "MOTION_CENSURE"
    ? scrutinRetenu(e)
    : null;
  const voteHref = scrutinVote && scrutinVote.votePour != null
    ? `/Scrutins/${scrutinVote.uid}`
    : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03, duration: 0.25 }}
      className={cn(
        "mx-3 sm:mx-0 mb-5 rounded-[22px] overflow-hidden border bg-card relative",
        dossierHref && "transition-shadow hover:shadow-md",
      )}
    >
      {dossierHref && (
        <Link
          href={dossierHref}
          prefetch={false}
          target="_blank"
          aria-label={t("aiSummary")}
          className="absolute inset-0"
        />
      )}

      <div
        className={cn(
          "relative px-5 py-5 pb-5 flex flex-col gap-4 text-foreground",
          dossierHref && "pointer-events-none",
        )}
        style={{ background: `var(--grad-${gradKey})` }}
      >
        <PosterHead group={group} e={e} />

        <div className="text-[16px] font-bold leading-snug tracking-tight">
          <PosterTitleInner group={primaryGroup} e={e} />
        </div>

        {group.type === "DEPOT_TEXTE" && e.texteAdopteUid && e.texteAdopteUid !== e.texteUid && (
          <p className="text-[13px] leading-snug -mt-2 text-foreground/85">
            {e.texteAdopteDenomination && <span className="text-foreground/70">{e.texteAdopteDenomination} — </span>}
            <span>{e.texteAdopteTitre || t("adoptedTextFallback")}</span>
          </p>
        )}

        {needsDataBlock && (
          <DataBlock variant={group.type === "LOI_APPLIQUEE" ? "applied" : undefined}>
            {bodyHasContent && <EventBody group={primaryGroup} />}
            {otherTypeEvents.length > 0 && (
              <>
                <div className="flex items-center gap-2.5 text-[10px] uppercase tracking-wide font-bold text-foreground/60 my-0.5">
                  <span className="flex-1 h-px bg-foreground/15" />
                  <span>{sepLabel}</span>
                  <span className="flex-1 h-px bg-foreground/15" />
                </div>
                {otherTypeEvents.map(ev => (
                  <SubEvent key={ev.id} event={ev} />
                ))}
              </>
            )}
          </DataBlock>
        )}

        {(dossierHref || voteHref) && (
          <div className="flex flex-wrap items-center justify-end gap-2 mt-1 -mb-1">
            {/* Seul vrai lien de la rangée : le bouton du dossier n'est qu'un dessin,
                c'est le calque `absolute inset-0` de la carte qui mène au dossier.
                `pointer-events-auto` le rend cliquable au-dessus de ce calque. */}
            {voteHref && (
              <Link
                href={voteHref}
                prefetch={false}
                target="_blank"
                className="inline-flex items-center gap-1.5 rounded-full bg-white/95 dark:bg-zinc-900/90 px-3.5 py-1.5 font-semibold text-foreground shadow-sm backdrop-blur-sm pointer-events-auto hover:underline"
                style={{ fontSize: 13 }}
              >
                <BarChart3 aria-hidden className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" style={{ flex: 'none' }} />
                {t("voirVote")}
              </Link>
            )}
            {!dossierHref ? null : showNoSummaryBadge ? (
              <span className="inline-flex items-center gap-1.5 px-1 py-1.5 text-[13px] text-foreground/60">
                {t("noSummary")}
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            ) : (
              // L'étincelle du badge IA (`AIBadge`) : le dossier ouvert porte un résumé écrit par l'IA.
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 dark:bg-zinc-900/90 px-3.5 py-1.5 text-[13px] font-semibold text-foreground shadow-sm backdrop-blur-sm">
                <RiSparkling2Fill aria-hidden size={14} className="text-primary" style={{ flex: 'none' }} />
                {t("aiSummary")}
                <ArrowRight className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        )}
      </div>

      {isLearnMore && (
        <div className="relative bg-card px-4 py-2.5">
          <Link
            href="/processus-legislatif"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <Info className="w-3 h-3" />
            {t("learnMore")}
          </Link>
        </div>
      )}
    </motion.article>
  );
}

// Renamed + thin wrapper around existing CardTitle to keep rapporteur + title logic.
function PosterTitleInner({ group, e }: { group: GroupedFeedEvent; e: FeedEvent }) {
  return <CardTitle group={group} e={e} />;
}

// Day separator between groups of different dates
function DaySeparator({ date, dossierCount, eventCount }: { date: string; dossierCount: number; eventCount: number }) {
  const t = useTranslations("month");
  const locale = useLocale();
  return (
    <div className="flex items-baseline gap-3 px-5 sm:px-2 pt-6 pb-1">
      <span className="text-[15px] font-bold tracking-tight text-foreground">
        {formatDaySeparator(date, locale)}
      </span>
      <span className="flex-1 h-px bg-border" />
      <span className="text-[11px] text-muted-foreground font-semibold">
        {dossierCount > 1 && dossierCount !== eventCount
          ? t("daySeparator.mergedDossierCount", { dossiers: dossierCount, events: eventCount })
          : t("daySeparator.eventCount", { count: eventCount })}
      </span>
    </div>
  );
}

/** Coupure entre deux mois du fil. Volontairement plus discrète que le
 *  séparateur de jour : la barre collante porte déjà le mois en permanence,
 *  cette ligne ne fait que marquer l'endroit où il bascule. */
function MonthSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-5 sm:px-2 pt-9 pb-1">
      <span
        className="text-muted-foreground"
        style={{ fontSize: "0.75rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}
      >
        {label}
      </span>
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

// Render a list of groups with inline day separators. `showDaySeparators` defaults true.
function GroupsWithDaySeparators({
  groups,
  showDaySeparators,
}: {
  groups: GroupedFeedEvent[];
  showDaySeparators: boolean;
}) {
  const nodes: React.ReactNode[] = [];
  let lastDate: string | null = null;

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (showDaySeparators && g.date !== lastDate) {
      // Count groups + events for this date
      const sameDayGroups = groups.filter(gg => gg.date === g.date);
      const dossierCount = new Set(sameDayGroups.map(gg => gg.dossierUid ?? gg.key)).size;
      const eventCount = sameDayGroups.reduce((sum, gg) => sum + gg.events.length, 0);
      nodes.push(
        <DaySeparator key={`sep-${g.date}`} date={g.date} dossierCount={dossierCount} eventCount={eventCount} />
      );
      lastDate = g.date;
    }
    nodes.push(<PosterCard key={g.key} group={g} index={i} />);
  }

  return <>{nodes}</>;
}

// ── Main component ──────────────────────────────────────────

type MonthBlock = {
  monthKey: string;
  monthFormatted: string;
  groupedEvents: GroupedFeedEvent[];
  kpis: MonthKpis;
};

interface MonthFeedClientProps {
  groupedEvents: GroupedFeedEvent[];
  kpis: MonthKpis;
  monthFormatted: string;
  initialMonthKey: string;
  initialPrevMonthKey: string;
  isCurrentOrFutureMonth: boolean;
  initialFilterType?: string;
}

export function MonthFeedClient({
  groupedEvents,
  kpis,
  monthFormatted,
  initialMonthKey,
  initialPrevMonthKey,
  isCurrentOrFutureMonth,
  initialFilterType,
}: MonthFeedClientProps) {
  const t = useTranslations("month");
  const tErrors = useTranslations("errors");
  const locale = useLocale();

  const [activeFilters, setActiveFilters] = useState<Set<string>>(() =>
    initialFilterType && FILTER_PILLS.some(pill => pill.value === initialFilterType)
      ? new Set([initialFilterType])
      : new Set(["tous"])
  );
  // /Month est mis en cache statique (dynamic = 'force-static'), donc searchParams
  // n'atteint jamais le serveur : on relit ?type= côté navigateur pour les liens profonds.
  useEffect(() => {
    const typeFromUrl = new URLSearchParams(window.location.search).get("type");
    if (typeFromUrl && FILTER_PILLS.some(pill => pill.value === typeFromUrl)) {
      queueMicrotask(() => setActiveFilters(new Set([typeFromUrl])));
    }
  }, []);
  const toggleFilter = useCallback((value: string) => {
    setActiveFilters(prev => {
      if (value === "tous") return new Set(["tous"]);
      const next = new Set(prev);
      next.delete("tous");
      if (next.has(value)) {
        next.delete(value);
        return next.size === 0 ? new Set(["tous"]) : next;
      }
      next.add(value);
      return next;
    });
  }, []);

  // ── Multi-month state ──
  const blocInitial = useMemo<MonthBlock>(() => ({
    monthKey: initialMonthKey,
    monthFormatted,
    groupedEvents,
    kpis,
  }), [initialMonthKey, monthFormatted, groupedEvents, kpis]);

  const [months, setMonths] = useState<MonthBlock[]>([blocInitial]);
  const [nextLoadKey, setNextLoadKey] = useState(initialPrevMonthKey);
  const [isLoadingMonth, setIsLoadingMonth] = useState(false);
  const [moisLu, setMoisLu] = useState(initialMonthKey);
  // La barre de mois défile avec la page : sa sortie commande le bouton de remontée.
  const barreRef = useRef<HTMLDivElement>(null);
  const barreSortie = useSortieDeLEcran(barreRef);
  /** Un geste de défilement a eu lieu depuis le dernier mois chargé. Voir la
   *  section « Chargement au défilement » plus bas. */
  const [aDefile, setADefile] = useState(false);
  /** Mois vers lequel un saut est en vol, `null` sinon. La destination et non
   *  un simple booléen : c'est elle que le voile annonce, et `moisLu` désigne
   *  encore le mois qu'on quitte. Distinct de `isLoadingMonth`, qui couvre aussi
   *  le chargement au défilement : celui-ci s'annonce déjà tout seul, en bas du
   *  fil, et flouter la page pendant qu'on défile serait insupportable. */
  const [sautVers, setSautVers] = useState<string | null>(null);
  /** Échec du dernier ajout en bas du fil, et échec du dernier saut de mois, tenus
   *  à part : ce sont deux chargements indépendants. Avec un seul état, un saut
   *  effaçait l'échec de l'ajout, ou un ajout la bannière du saut, et la sentinelle
   *  revenait sans observateur. `nb` est le nombre d'appels à l'action serveur ratés
   *  d'affilée, ajouts et sauts confondus (voir `EchecMois`). `null` tant que rien
   *  n'a échoué, ou depuis la réussite. */
  const [echecAjout, setEchecAjout] = useState<{ cle: string; nb: number } | null>(null);
  const [echecSaut, setEchecSaut] = useState<{ cle: string; nb: number } | null>(null);
  // Un seul compteur pour les deux chargements : ce qu'il mesure, c'est que l'action
  // serveur répond ou non, et n'importe quelle réussite le prouve. Une ref, parce que
  // l'état d'échec est remis à null au début de chaque essai, et le compte non.
  const echecsDeSuite = useRef(0);

  // Seule borne du fil : le début de la législature. Il n'y a pas de plafond de
  // mois chargés, on descend jusqu'à juillet 2024 en ajoutant.
  const peutRemonter = nextLoadKey >= MOIS_PLANCHER;

  const filRef = useRef<HTMLDivElement | null>(null);
  // Un état et non une ref : la sentinelle disparaît à l'échec d'un ajout et revient
  // dans un nouveau nœud. Un changement d'état relance l'effet de l'observateur, qui
  // surveillait sinon l'ancien nœud détaché, et « Chargement de … » tournait sans fin.
  const [sentinelle, setSentinelle] = useState<HTMLDivElement | null>(null);
  // Garde posée de façon synchrone : `isLoadingMonth` est un état, donc en
  // retard d'un rendu, et l'observateur peut se déclencher deux fois avant lui.
  const chargementEnVol = useRef(false);
  const derniereUrl = useRef<string | null>(null);

  // ── Mois lu : balayage au défilement ──
  // Un parcours plutôt qu'un IntersectionObserver, pour la même raison que
  // `BarreAncres` : l'observateur n'a pas de réponse en bas de page, où plus
  // aucun bloc ne croise sa bande de détection, et le mois affiché s'y fige.
  // Cet effet est le seul écrivain de `moisLu` : il repasse après chaque
  // changement de `months`, donc un saut de mois n'a aucune course à gérer.
  useEffect(() => {
    let frame = 0;
    const balayer = () => {
      frame = 0;
      const blocs = filRef.current?.querySelectorAll<HTMLElement>("[data-month]");
      if (!blocs?.length) return;
      let courant = blocs[0].dataset.month ?? initialMonthKey;
      for (const bloc of blocs) {
        if (bloc.getBoundingClientRect().top <= LIGNE_DE_REFERENCE_MOIS) {
          courant = bloc.dataset.month ?? courant;
        }
      }
      setMoisLu(courant);

      // L'URL garde son préfixe de langue (`localePrefix: 'always'`) et ses
      // autres paramètres, `?type=` en tête. Elle n'est réécrite qu'au
      // changement de mois : Safari étrangle `replaceState` au-delà d'une
      // centaine d'appels par demi-minute, et le balayage tourne à chaque trame.
      const params = new URLSearchParams(window.location.search);
      if (courant === initialMonthKey && isCurrentOrFutureMonth) params.delete("mois");
      else params.set("mois", courant);
      const requete = params.toString();
      const url = window.location.pathname + (requete ? `?${requete}` : "");
      if (url !== derniereUrl.current) {
        derniereUrl.current = url;
        window.history.replaceState(null, "", url);
      }
    };
    const auDefilement = () => {
      if (!frame) frame = requestAnimationFrame(balayer);
    };
    balayer();
    window.addEventListener("scroll", auDefilement, { passive: true });
    window.addEventListener("resize", auDefilement);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", auDefilement);
      window.removeEventListener("resize", auDefilement);
    };
  }, [months, initialMonthKey, isCurrentOrFutureMonth]);

  // ── Charger le mois précédent (append) ──
  const handleLoadPreviousMonth = useCallback(async () => {
    if (chargementEnVol.current || !peutRemonter) return;
    chargementEnVol.current = true;
    setIsLoadingMonth(true);
    setEchecAjout(null);
    try {
      const data = await loadMonthAction(nextLoadKey, locale);
      setMonths(prev => [...prev, {
        monthKey: data.monthKey,
        monthFormatted: data.monthFormatted,
        groupedEvents: data.groupedEvents,
        kpis: data.kpis,
      }]);
      setNextLoadKey(data.prevMonthKey);
      setADefile(false);
      echecsDeSuite.current = 0;
      // Le mois qu'un saut n'avait pas pu charger vient d'arriver par le bas : sa
      // bannière part. Sinon elle reste, mais l'action répond : son bouton redevient
      // « Réessayer » plutôt que de recharger la page.
      setEchecSaut((e) => (!e || e.cle === data.monthKey ? null : { ...e, nb: 0 }));
    } catch {
      echecsDeSuite.current += 1;
      setEchecAjout({ cle: nextLoadKey, nb: echecsDeSuite.current });
    } finally {
      chargementEnVol.current = false;
      setIsLoadingMonth(false);
    }
  }, [peutRemonter, nextLoadKey, locale]);

  // ── Sauter à un mois : le fil repart de ce seul mois ──
  // C'est un chargement client, pas une navigation : `/Month` est en
  // `force-static`, un lien `?mois=` rendrait toujours le mois courant.
  const sauterAuMois = useCallback(async (cle: string) => {
    if (chargementEnVol.current || cle === moisLu) return;
    // Le fil repart d'un seul mois, donc le chargement au défilement se désarme
    // comme après un ajout, et la remontée se marque comme défilement de la page :
    // comptée comme geste, elle réarmait l'observateur, et sur un mois plus court
    // que l'écran (filtre étroit) le mois d'avant se chargeait sans demande.
    const remonter = () => {
      setADefile(false);
      marquerDefilementProgramme();
      window.scrollTo({ top: 0 });
    };
    // Revenir au mois d'arrivée ne coûte rien : ses données sont déjà là.
    // Le fil repart de zéro : un échec d'ajout en bas ne le concerne plus.
    if (cle === initialMonthKey) {
      setEchecSaut(null);
      setEchecAjout(null);
      setMonths([blocInitial]);
      setNextLoadKey(initialPrevMonthKey);
      remonter();
      return;
    }
    chargementEnVol.current = true;
    setIsLoadingMonth(true);
    setSautVers(cle);
    setEchecSaut(null);
    try {
      const data = await loadMonthAction(cle, locale);
      setMonths([{
        monthKey: data.monthKey,
        monthFormatted: data.monthFormatted,
        groupedEvents: data.groupedEvents,
        kpis: data.kpis,
      }]);
      setNextLoadKey(data.prevMonthKey);
      // Le fil repart de ce mois : l'échec d'un ajout sous l'ancien fil ne vaut plus.
      setEchecAjout(null);
      echecsDeSuite.current = 0;
      remonter();
    } catch {
      // Le fil reste sur le mois qu'on voulait quitter : il est encore juste.
      echecsDeSuite.current += 1;
      setEchecSaut({ cle, nb: echecsDeSuite.current });
    } finally {
      chargementEnVol.current = false;
      setIsLoadingMonth(false);
      setSautVers(null);
    }
  }, [moisLu, initialMonthKey, initialPrevMonthKey, blocInitial, locale]);

  // ── Chargement au défilement ──
  // Ici l'IntersectionObserver est le bon outil : la sentinelle est un point,
  // pas une zone, et on veut l'anticipation que donne `rootMargin`.
  //
  // La sentinelle ne s'arme qu'après un geste de défilement, et le drapeau
  // retombe à chaque mois chargé : un geste ne peut donc ajouter qu'un mois.
  // C'est le seul garde-fou qui reste depuis que le fil descend sans plafond
  // jusqu'à juillet 2024. Sans lui, un filtre étroit (« Motions ») rend des mois
  // plus courts que l'écran : la page ne s'allonge pas, la sentinelle reste
  // visible, et les vingt-six mois de la législature s'enchaînent d'un coup,
  // soit plus de quatre cents requêtes. Un défilement continu, lui, produit des
  // événements en rafale et réarme aussitôt : la lecture reste fluide.
  useEffect(() => {
    if (aDefile) return;
    // Un défilement que la page a déclenché elle-même ne compte pas : le bouton
    // de remontée, cliqué depuis le bas du fil, réarmait l'observateur alors que
    // la sentinelle était encore à portée, et chargeait un mois de plus au moment
    // où le lecteur demandait à partir.
    const marquer = () => { if (!defilementProgramme()) setADefile(true); };
    window.addEventListener("scroll", marquer, { passive: true });
    return () => window.removeEventListener("scroll", marquer);
  }, [aDefile]);

  useEffect(() => {
    if (!sentinelle || !aDefile) return;
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) void handleLoadPreviousMonth(); },
      { rootMargin: "260px" },
    );
    observer.observe(sentinelle);
    return () => observer.disconnect();
  }, [handleLoadPreviousMonth, sentinelle, aDefile]);

  // ── Lien profond ?mois= ──
  // Même contournement que `?type=` juste au-dessus, et pour la même raison :
  // en rendu statique les searchParams n'atteignent pas le serveur. Répare les
  // liens de l'infolettre, qui envoyaient jusqu'ici sur le mois courant.
  //
  // Le paramètre est capté au premier rendu, avant le moindre effet : le
  // balayage ci-dessus réécrit l'URL dès son premier passage et effacerait
  // `?mois=` avant qu'on ait pu le lire.
  const moisDemande = useRef<string | null | undefined>(undefined);
  if (moisDemande.current === undefined) {
    moisDemande.current = typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("mois");
  }
  useEffect(() => {
    const demande = moisDemande.current;
    if (demande && estMoisValide(demande) && demande < initialMonthKey) {
      // `queueMicrotask` pour la même raison que le contournement `?type=`
      // ci-dessus : poser l'état de façon synchrone dans un effet déclenche une
      // cascade de rendus.
      queueMicrotask(() => void sauterAuMois(demande));
    }
    // Au montage seulement : ensuite c'est le balayage qui écrit l'URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Libellé « Chargement de mars 2025… », avec l'élision que réclament avril,
   *  août et octobre. Partagé par le voile du saut et la sentinelle du bas. */
  const libelleChargement = useCallback((cle: string) => {
    const mois = libelleMoisLong(cle, locale);
    return t("loadingMonth", { month: mois, elide: appelleElision(mois) ? "oui" : "non" });
  }, [locale, t]);

  const moisDisponibles = useMemo(
    () => moisEntre(MOIS_PLANCHER, initialMonthKey),
    [initialMonthKey],
  );
  const blocLu = months.find(m => m.monthKey === moisLu) ?? months[0];

  // ── Global filter counts across all loaded months ──
  const allGroupedEvents = useMemo(() => months.flatMap(m => m.groupedEvents), [months]);
  const filterCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pill of FILTER_PILLS) {
      map[pill.value] = pill.value === "tous"
        ? allGroupedEvents.length
        : allGroupedEvents.filter(g => matchesFilters(g, new Set([pill.value]))).length;
    }
    return map;
  }, [allGroupedEvents]);

  // ── Month mode with infinite scroll ──
  return (
    <ShellWithSidebar
      sidebar={
        <FilterPills activeFilters={activeFilters} onFilter={toggleFilter} counts={filterCounts} variant="vertical" />
      }
    >
    {sautVers && <VoileFlou label={libelleChargement(sautVers)} />}
    {/* La ref est portée par l'appelant et non par `MonthBar`, qui reste un
        composant de présentation sans attache au DOM de la page. */}
    <div ref={barreRef}>
    <MonthBar
      moisLu={blocLu.monthKey}
      nbEvenements={blocLu.kpis.totalEvents}
      enCours={blocLu.monthKey === initialMonthKey && isCurrentOrFutureMonth}
      moisDisponibles={moisDisponibles}
      peutPrecedent={moisPrecedent(blocLu.monthKey) >= MOIS_PLANCHER}
      peutSuivant={blocLu.monthKey < initialMonthKey}
      occupe={isLoadingMonth}
      onPrecedent={() => void sauterAuMois(moisPrecedent(blocLu.monthKey))}
      onSuivant={() => void sauterAuMois(moisSuivant(blocLu.monthKey))}
      onChoisir={(cle) => void sauterAuMois(cle)}
      // Sur /en, les titres de dossiers, de lois et de scrutins du fil sont traduits
      // par l'IA : un badge à côté du mois, chaque carte étant tout entière un lien.
      badge={locale === "en" ? <AIBadgeTitre pluriel /> : undefined}
    />
    </div>
    {/* Le relais de la barre de mois, qui défile avec la page : sans lui il
        faudrait remonter tout le fil à la main pour changer de mois. */}
    <BoutonRemonter visible={barreSortie} />
    <div className="py-6">
      {echecSaut && (
        <EchecMois
          message={t("chargementEchec")}
          libelleBouton={tErrors("retry")}
          libelleRecharger={t("rechargerPage")}
          nbEchecs={echecSaut.nb}
          moisARecharger={echecSaut.cle}
          onReessayer={() => void sauterAuMois(echecSaut.cle)}
        />
      )}
      <FilterPillsLayout activeFilters={activeFilters} onFilter={toggleFilter} counts={filterCounts} />

      {allGroupedEvents.length === 0 ? (
        <EmptyState />
      ) : allGroupedEvents.filter(g => matchesFilters(g, activeFilters)).length === 0 ? (
        <NoFilterResults onReset={() => setActiveFilters(new Set(["tous"]))} />
      ) : (
        <div ref={filRef}>
          {(() => {
            // La coupure de mois s'appuie sur le rang parmi les blocs
            // *rendus*, pas sur l'index dans `months` : un filtre peut effacer
            // un bloc, et le premier bloc visible hériterait d'une coupure.
            const blocsRendus = months
              .map(block => ({
                block,
                filtered: block.groupedEvents.filter(g => matchesFilters(g, activeFilters)),
              }))
              .filter(({ filtered }) => filtered.length > 0 || activeFilters.has("tous"));

            return blocsRendus.map(({ block, filtered }, rang) => (
              <div key={block.monthKey} data-month={block.monthKey}>
                {rang > 0 && <MonthSeparator label={block.monthFormatted} />}
                {filtered.length === 0 ? (
                  <p className="text-center text-sm text-muted-foreground py-4">
                    {t("noEventsOfType", { month: block.monthFormatted })}
                  </p>
                ) : (
                  <GroupsWithDaySeparators groups={filtered} showDaySeparators={true} />
                )}
              </div>
            ));
          })()}
        </div>
      )}

      {/* L'échec remplace la sentinelle : l'observateur n'a plus rien à voir, et ne
          relance donc rien de lui-même. Seul le bouton retente. */}
      {echecAjout ? (
        <EchecMois
          message={t("chargementEchec")}
          libelleBouton={tErrors("retry")}
          libelleRecharger={t("rechargerPage")}
          nbEchecs={echecAjout.nb}
          onReessayer={() => void handleLoadPreviousMonth()}
        />
      ) : !peutRemonter ? (
        <p className="text-center text-xs text-muted-foreground py-8">
          {t("feedStart", { month: libelleMoisLong(MOIS_PLANCHER, locale) })}
        </p>
      ) : (
        // Tant qu'aucun geste n'a armé l'observateur (D-113), rien ne charge : une roue
        // mentirait. Une page plus courte que l'écran (filtre étroit, mois vide) ne
        // peut pas défiler, donc ne s'armait jamais, et « Chargement de … » tournait
        // sans fin. Le bouton charge le mois d'un clic, qui vaut geste ; un défilement
        // arme l'observateur, et le bouton montre alors la roue. C'est le même nœud
        // dans tous les états (`aria-disabled` et non `disabled`, qui lui ôterait le
        // focus) : remplacé, il renvoyait le focus clavier en haut du document, et le
        // lecteur perdait sa place. Atteindre le bouton à la touche Tab le fait défiler
        // à l'écran, ce qui arme déjà l'observateur.
        <div
          ref={setSentinelle}
          className="flex justify-center items-center gap-2.5 py-8 text-[13px] text-muted-foreground"
        >
          <button
            type="button"
            aria-disabled={aDefile || isLoadingMonth}
            onClick={() => { if (!aDefile) void handleLoadPreviousMonth(); }}
            className={cn(
              "inline-flex items-center gap-2.5",
              aDefile || isLoadingMonth ? "cursor-default" : "font-medium text-primary hover:underline",
            )}
          >
            {aDefile || isLoadingMonth ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {libelleChargement(nextLoadKey)}
              </>
            ) : (
              t("chargerMois", { month: libelleMoisLong(nextLoadKey, locale) })
            )}
          </button>
        </div>
      )}

      <Footer />
    </div>
    </ShellWithSidebar>
  );
}

// ── Shared small components ─────────────────────────────────

/** Message d'un mois qui n'a pas pu être chargé, avec son bouton pour réessayer.
 *  Rendu en haut du fil après un saut raté, à la place de la sentinelle après un
 *  ajout raté. Dès le deuxième échec consécutif (`nbEchecs`), le bouton recharge la
 *  page : `/Month` est statique et charge ses mois par une action serveur, dont
 *  l'identifiant change à chaque mise en ligne. Un onglet ouvert avant une mise en
 *  ligne appelle une action qui n'existe plus, et réessayer échouerait à chaque clic.
 *  Hors ligne, le bouton reste « Réessayer » : recharger mènerait à la page d'erreur
 *  du navigateur et perdrait le fil. Après un saut raté, le rechargement va au mois
 *  demandé (`moisARecharger`, lu par le lien profond `?mois=`), et non à celui qu'on
 *  quittait, que l'adresse porte encore. */
function EchecMois({ message, libelleBouton, libelleRecharger, nbEchecs, moisARecharger, onReessayer }: {
  message: string;
  libelleBouton: string;
  libelleRecharger: string;
  nbEchecs: number;
  moisARecharger?: string;
  onReessayer: () => void;
}) {
  // Lu au rendu : un échec rend toujours un nouveau rendu, qui reprend l'état du réseau.
  const recharger = nbEchecs >= 2 && (typeof navigator === 'undefined' || navigator.onLine);
  // Un vrai rechargement, jamais le routeur de Next : la navigation client garderait
  // le code de l'ancienne version, celui qui appelle l'action disparue.
  const rechargerPage = () => {
    if (moisARecharger) {
      const params = new URLSearchParams(window.location.search);
      params.set('mois', moisARecharger);
      window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    }
    window.location.reload();
  };
  return (
    <div role="alert" className="py-6 text-center" style={{ fontSize: '0.875rem' }}>
      <p className="text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={recharger ? rechargerPage : onReessayer}
        style={{ marginTop: '0.75rem', border: 'none', background: 'none', padding: 0, color: 'var(--primary)', fontWeight: 500, cursor: 'pointer' }}
      >
        {recharger ? libelleRecharger : libelleBouton}
      </button>
    </div>
  );
}

function FilterPills({
  activeFilters,
  onFilter,
  counts,
  variant = "horizontal",
}: {
  activeFilters: Set<string>;
  onFilter: (v: string) => void;
  counts?: Record<string, number>;
  variant?: "horizontal" | "vertical";
}) {
  const t = useTranslations("month");
  return (
    <div
      className={cn(
        variant === "vertical"
          ? "flex flex-col items-start gap-1.5"
          : "flex flex-wrap gap-2",
      )}
    >
      {FILTER_PILLS.map(pill => {
        const count = counts?.[pill.value] ?? 0;
        const isActive = activeFilters.has(pill.value);
        const PillIcon = pill.icon;
        return (
          <button
            key={pill.value}
            onClick={() => onFilter(pill.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition-colors text-sm",
              isActive
                ? "border-foreground/30 bg-muted text-foreground font-semibold"
                : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground",
            )}
          >
            <PillIcon className={cn("w-3.5 h-3.5", pill.color)} style={pill.colorStyle} />
            <span>{t(pill.labelKey)}</span>
            {counts && count > 0 && (
              <span className="text-xs tabular-nums opacity-60">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Pills horizontales en haut sur mobile/tablette ; sur xl+ la colonne verticale
 *  est rendue par ShellWithSidebar, donc on masque cette version-ci au-dessus de xl. */
function FilterPillsLayout(props: { activeFilters: Set<string>; onFilter: (v: string) => void; counts?: Record<string, number> }) {
  return (
    <div className="px-4 sm:px-0 mb-4 xl:hidden">
      <FilterPills {...props} variant="horizontal" />
    </div>
  );
}

/** Layout desktop xl+ : feed 640 à gauche (avec bordures) + colonne sticky de pills à droite.
 *  Sur <xl, la sidebar est masquée et le feed reprend sa largeur max-w-[640px] via le parent. */
function ShellWithSidebar({ children, sidebar }: { children: React.ReactNode; sidebar: React.ReactNode }) {
  return (
    <div className="xl:flex xl:gap-6">
      <div className="flex-1 min-w-0 xl:max-w-[640px] px-0 sm:px-4 sm:border-x sm:border-border sm:min-h-[calc(100vh-4rem)]">
        {children}
      </div>
      <aside className="hidden xl:block w-56 shrink-0 pt-6">
        {/* Collé sous l'en-tête déployé : la barre de mois, elle, défile avec la
            page. Quand l'en-tête se replie, ce rail garde donc sa hauteur libre
            au-dessus de lui, ce qui ne recouvre rien, une colonne n'ayant pas de
            contenu qui défile derrière elle. Style inline plutôt que
            `sticky top-20`, le positionnement en classe Tailwind n'étant pas
            fiable sur Safari (`ARCHITECTURE.md` §Pièges Tailwind v4). */}
        <div style={{ position: "sticky", top: SOUS_BARRE }}>{sidebar}</div>
      </aside>
    </div>
  );
}

function NoFilterResults({ onReset }: { onReset: () => void }) {
  const t = useTranslations("month");
  return (
    <div className="text-center py-16">
      <p className="text-muted-foreground text-sm">{t("noEventsType")}</p>
      <button onClick={onReset} className="mt-2 text-sm text-primary hover:underline">
        {t("viewAll")}
      </button>
    </div>
  );
}

function EmptyState() {
  const t = useTranslations("month");
  return (
    <div className="text-center py-20">
      <CalendarX className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
      <h2 className="text-base font-semibold mb-1">{t("quietMonth")}</h2>
      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
        {t("noEventsRecorded")}
      </p>
    </div>
  );
}

function Footer() {
  const t = useTranslations("month");
  return (
    <p className="flex flex-wrap justify-center items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground mt-10 pb-4">
      {t("source")}{" "}
      <a href="https://data.assemblee-nationale.fr/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        data.assemblee-nationale.fr
      </a>
      <span>·</span>
      <a href="https://data.senat.fr/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        data.senat.fr
      </a>
    </p>
  );
}
