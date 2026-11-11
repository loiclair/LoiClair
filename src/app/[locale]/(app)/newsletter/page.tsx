/**
 * /newsletter : présentation de la lettre hebdomadaire et formulaire d'inscription.
 * Titre et phrase sont dans le bandeau commun (`PAGES_ACCUEIL` de `lib/navigation`).
 * Sous lui, la carte d'inscription (`CarteInscription`, formulaire `NewsletterForm` en
 * variante `carte`) et ce que contient la lettre, avec un renvoi vers Ce qui me
 * concerne : la lettre est la même pour tous, la situation du lecteur ne quitte pas
 * son navigateur (D-243).
 */
import type { Metadata } from "next"
import NewsletterForm from "@/components/NewsletterForm"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { buildAlternates, buildOpenGraph } from "@/lib/og-metadata"
import { AIBadge } from "@/app/[locale]/(app)/dossiers-legislatifs/[uid]/resume-ia/AICardElements"
import { Link } from "@/i18n/navigation"
import { sql } from "@/lib/db"
import CarteInscription from "./CarteInscription"
import { FLECHE, STYLE_LIEN, TEXTE_DOUX } from "./EtatParcours"

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "newsletter" })
  const title = `${t("pageTitle")} — LoiClair`
  const description = t("pageDescription")
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/newsletter'),
    openGraph: buildOpenGraph(locale, '/newsletter', title, description),
  }
}

/**
 * Sous ce nombre d'abonnés confirmés, le compteur ne s'affiche pas : « Rejoignez
 * les 12 lecteurs » dissuaderait plus qu'il n'encourage. Choix d'Alex.
 */
const SEUIL_COMPTEUR = 100

/** Les cinq rubriques de la lettre, dans l'ordre de l'e-mail (`api/newsletter/send`). */
const RUBRIQUES = ["rubrique1", "rubrique2", "rubrique3", "rubrique4", "rubrique5"] as const
/** « Qui est concerné », numéro en or plus soutenu : le lien avec Ce qui me concerne. */
const RUBRIQUE_MISE_EN_AVANT = "rubrique3"

/**
 * Abonnés confirmés, ou `null` si la base ne répond pas : la page s'affiche alors
 * sans compteur plutôt que de tomber. Relu au rythme du `revalidate` du layout (24 h).
 * Sans les désabonnements en attente (`desabonnement_demande_le`), que l'envoi du
 * lundi écarte puis supprime (`api/newsletter/send`) : ils ne lisent plus la lettre.
 */
async function nombreAbonnes(): Promise<number | null> {
  try {
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from newsletter_subscribers
      where confirmed = true and desabonnement_demande_le is null`
    return n
  } catch (err) {
    console.error("[newsletter] comptage des abonnés impossible", err)
    return null
  }
}

export default async function NewsletterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "newsletter" })
  const abonnes = await nombreAbonnes()

  const compteur = abonnes !== null && abonnes >= SEUIL_COMPTEUR
    ? t.rich("compteur", { n: new Intl.NumberFormat(locale).format(abonnes), b: (chunks) => <b>{chunks}</b> })
    : undefined

  // La carte vient en premier dans le document : sur téléphone, elle passe juste
  // sous le bandeau ; dès 820 px, la grille la range à droite (`.nl-grille`).
  return (
    <div className="nl-page">
      <div className="nl-grille">
        <CarteInscription
          titre={t("carteTitre")}
          sousTitre={t("carteSous")}
          compteur={compteur}
        >
          <NewsletterForm variant="carte" />
        </CarteInscription>

        <div className="nl-contenu">
          <p style={{ fontSize: "0.8125rem", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted-foreground)", margin: "0 0 8px" }}>
            {t("dansChaqueLettre")}
          </p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {RUBRIQUES.map((cle, i) => (
              <li
                key={cle}
                style={{
                  display: "flex", gap: 10, alignItems: "baseline", padding: "12px 0",
                  borderBottom: i < RUBRIQUES.length - 1 ? "1px solid var(--border)" : "none",
                  fontSize: "0.9375rem", fontWeight: 500, color: "var(--foreground)",
                }}
              >
                <span aria-hidden="true" style={{ width: 14, flexShrink: 0, fontSize: "0.8125rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", color: cle === RUBRIQUE_MISE_EN_AVANT ? "var(--nl-or-fort)" : "var(--gold)" }}>
                  {i + 1}
                </span>
                <span>{t(cle)}</span>
              </li>
            ))}
          </ol>

          {/* La lettre part seule chaque lundi, sans relecture humaine : on le dit avant
              l'inscription, pas seulement dans les e-mails. Le badge IA du site (D-002) et
              « Notre méthode » mènent aux instructions de la newsletter (#nl), comme le lien
              des e-mails. Sans infobulle : la sienne parle du texte affiché, pas des e-mails.
              Badge court : le libellé complet passe sur deux lignes à 390 px. */}
          <p style={{ fontSize: "0.78125rem", lineHeight: 1.6, color: TEXTE_DOUX, margin: "18px 0 0" }}>
            <span style={{ marginRight: "0.375rem" }}><AIBadge usage="nl" court infobulle={false} /></span>
            {t.rich("mentionIa", {
              lien: (chunks) => (
                <Link href="/documentation/prompts-ia#nl" style={{ color: "inherit", textDecoration: "underline" }}>{chunks}</Link>
              ),
            })}
          </p>

          <section style={{ marginTop: 40, paddingTop: 28, borderTop: "1px solid var(--border)" }}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 600, lineHeight: 1.35, letterSpacing: "-0.01em", color: "var(--foreground)", margin: "0 0 6px" }}>
              {t("pourVousTitre")}
            </h2>
            <p style={{ fontSize: "0.9375rem", lineHeight: 1.6, color: TEXTE_DOUX, margin: "0 0 12px" }}>
              {t("pourVousTexte")}
            </p>
            <Link href="/ce-qui-me-concerne" style={STYLE_LIEN}>{t("pourVousLien")}{FLECHE}</Link>
          </section>
        </div>
      </div>
    </div>
  )
}
