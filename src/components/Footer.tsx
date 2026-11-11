import { LastUpdateBadge } from "@/components/LastUpdateBadge"
import FooterLink from "@/components/FooterLink"
import LocaleToggle from "@/components/LocaleToggle"
import ThemeToggleSwitch from "@/components/ThemeToggleSwitch"
import FooterOuvreTiroir from "@/components/FooterOuvreTiroir"
import FooterShare from "@/components/FooterShare"
import FeedbackVote from "@/components/FeedbackVote"
import { getTranslations } from "next-intl/server"
import { Link } from "@/i18n/navigation"
import LogoLc from "@/components/LogoLc"

/**
 * Pied de page du site : bandeau de mission, partage, plan du site en trois
 * colonnes, puis mentions et réglages. Rendu par les layouts de l'app et de
 * l'accueil, et par `MonthFeedClient`.
 *
 * Les colonnes suivent les groupes du menu du haut (`lib/navigation.tsx`) :
 * Explorer réunit Fil d'actu, la newsletter, Textes, Élus et les pages de
 * Chiffres, Comprendre reprend son menu et déplie les pages IA. Les trois
 * colonnes portent sept liens chacune : en ajouter un appelle à en déplacer un
 * autre. Le journal des corrections n'a d'entrée de navigation qu'ici, dans Le
 * projet. Deux entrées de Le projet
 * ouvrent un tiroir au lieu d'une page (champ `evenement`) : le signalement
 * et l'adhésion.
 */
export default async function Footer({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: "footer" })
  const tCommon = await getTranslations({ locale, namespace: "common" })

  const columns = [
    {
      title: t("explore"),
      links: [
        { label: t("news"), href: "/Month" },
        { label: t("newsletter"), href: "/newsletter" },
        { label: t("dossiers"), href: "/dossiers-legislatifs" },
        { label: t("elus"), href: "/les-elus" },
        { label: t("etatDesLieux"), href: "/etat-des-lieux" },
        { label: t("facts"), href: "/Facts" },
        { label: t("activite"), href: "/Activite" },
      ],
    },
    {
      title: t("understand"),
      links: [
        { label: t("legislativeProcess"), href: "/processus-legislatif" },
        { label: t("glossary"), href: "/documentation/glossaire" },
        { label: t("quiz"), href: "/Quiz" },
        { label: t("choixModeleIA"), href: "/documentation/choix-modele-ia" },
        { label: t("promptsIA"), href: "/documentation/prompts-ia" },
        { label: t("aiCompliance"), href: "/documentation/conformite-ia" },
        { label: t("mcp"), href: "/documentation/mcp" },
      ],
    },
    {
      title: t("project"),
      links: [
        { label: t("about"), href: "/about" },
        { label: t("corrections"), href: "/documentation/corrections" },
        { label: tCommon("feedback"), href: "#feedback", evenement: "open-signaler" as const },
        { label: t("contact"), href: "mailto:contact@loiclair.fr", external: true },
        { label: t("github"), href: "https://github.com/loiclair/LoiClair", external: true },
        { label: t("helpUs"), href: "/nous-aider" },
        { label: t("becomeMember"), href: "#adhesion", evenement: "open-adhesion" as const },
      ],
    },
  ]

  return (
    <footer>
      {/* Section 1 — Mission banner */}
      <div
        style={{
          backgroundColor: "var(--footer-bg)",
          color: "var(--footer-heading)",
          paddingTop: "8rem",
          paddingBottom: "5rem",
        }}
      >
        <div className="max-w-[90rem] mx-auto px-6 sm:px-10 lg:px-20">
          {/* Le logo complet (348, 577, LoiClair) au-dessus de la phrase de
              mission, l'un des rares endroits assez grands pour lui. 80 px sur
              téléphone, où 104 écrasait le bandeau, jusqu'à 104 sur grand écran.
              Il hérite par `currentColor` de la couleur du bandeau,
              `--footer-heading`. */}
          <LogoLc variante="complet" taille="clamp(80px, 5vw + 60px, 104px)" style={{ marginBottom: "2rem" }} />
          <p
            style={{
              fontSize: "clamp(1.5rem, 2.5vw + 0.4rem, 2rem)",
              lineHeight: 1.4,
              fontWeight: 600,
              margin: 0,
              maxWidth: "none",
            }}
          >
            {/* La phrase de mission ouvre sa propre ligne, dans les deux
                langues : le `<br></br>` est dans la traduction. */}
            {t.rich("missionText", { br: () => <br /> })}
          </p>
          {/* « En savoir plus » reste le bouton plein ; « Nous aider » est
              secondaire (bordure seule) pour ne pas lui disputer l'attention.
              Le flexWrap les empile quand la largeur manque au lieu de déborder. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "2.5rem" }}>
            <Link
              href="/about"
              className="hover:opacity-80 transition-opacity"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.5rem 1.25rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "#1C1917",
                backgroundColor: "var(--primary)",
                borderRadius: "9999px",
                textDecoration: "none",
              }}
            >
              {t("learnMore")}
            </Link>
            <Link
              href="/nous-aider"
              className="hover:opacity-80 transition-opacity"
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "0.5rem 1.25rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                color: "var(--footer-heading)",
                backgroundColor: "transparent",
                border: "1px solid var(--footer-border)",
                borderRadius: "9999px",
                textDecoration: "none",
              }}
            >
              {t("helpUs")}
            </Link>
          </div>
        </div>
      </div>

      {/* Section 2 — Links + Share */}
      <div
        style={{
          paddingTop: "0",
          paddingBottom: "3rem",
          fontSize: "0.875rem",
          color: "var(--footer-fg)",
          backgroundColor: "var(--footer-bg)",
        }}
      >
        <div className="max-w-[90rem] mx-auto px-6 sm:px-10 lg:px-20">
          <div style={{ position: "relative", borderTop: "1px solid var(--footer-border)", paddingTop: "5rem", paddingBottom: "3rem" }}>
            {/* Largeur bornée à celle du pied de page : en position absolue, le bloc
                prenait la largeur de son contenu insécable, et débordait de l'écran
                (342 px à 320 px de large en anglais, et dans les deux langues une fois
                le « merci » affiché). Bornés, ses boutons passent à la ligne. */}
            <div style={{ position: "absolute", top: 0, left: "50%", transform: "translate(-50%, -50%)", backgroundColor: "var(--footer-bg)", padding: "0 1.5rem", width: "max-content", maxWidth: "100%" }}>
              <FeedbackVote />
            </div>
          {/* Deux colonnes dès le téléphone : empilés, Partager et les trois
              blocs de sept liens rendaient le pied de page très long. Dans une
              demi-colonne, les ronds de partage passent en carré 2×2
              (`FooterShare`), et l'écart horizontal est réduit sous 640 px pour
              que « Dossiers législatifs » tienne sur une ligne. */}
          <div className="grid grid-cols-2 lg:grid-cols-[1.75fr_1fr_1fr_1fr] gap-x-6 gap-y-10 sm:gap-x-10">
            {/* Share */}
            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <div>
                <h3
                  style={{
                    marginBottom: "0.75rem",
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--footer-heading)",
                  }}
                >
                  {t("share")}
                </h3>
                <p style={{ margin: 0, maxWidth: "28rem", lineHeight: 1.6 }}>
                  {t("shareText")}
                </p>
              </div>
              <FooterShare />
            </div>

            {/* Link columns */}
            {columns.map((col) => (
              <div key={col.title}>
                <h3
                  style={{
                    marginBottom: "0.75rem",
                    fontSize: "0.65rem",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--footer-heading)",
                  }}
                >
                  {col.title}
                </h3>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {col.links.map((link) => (
                    <li key={link.href}>
                      {"evenement" in link && link.evenement ? (
                        <FooterOuvreTiroir label={link.label} evenement={link.evenement} />
                      ) : (
                        <FooterLink
                          href={link.href}
                          label={link.label}
                          external={(link as { external?: boolean }).external}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          </div>

          {/* Bottom row */}
          <div
            className="mt-10 pt-6 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
            style={{ fontSize: "0.75rem" }}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
              <span>{t("publicData")} &copy; {new Date().getFullYear()}</span>
              <LastUpdateBadge locale={locale} />
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <Link href="/mentions-legales" className="hover:opacity-80 transition-opacity" style={{ color: "inherit", textDecoration: "none" }}>
                  {t("mentionsLegales")}
                </Link>
                <Link href="/confidentialite" className="hover:opacity-80 transition-opacity" style={{ color: "inherit", textDecoration: "none" }}>
                  {t("privacy")}
                </Link>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {/* Vers les tickets publics, où le formulaire du site publie les
                  signalements. Pas « Contribuer » : le code est publié pour être
                  lu et audité, sans pull requests (voir « Statut du code » du README). */}
              <a
                href="https://github.com/loiclair/LoiClair/issues"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.375rem",
                  padding: "0.25rem 0.625rem",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  color: "var(--footer-pill-fg)",
                  backgroundColor: "var(--footer-pill-bg)",
                  borderRadius: "9999px",
                  textDecoration: "none",
                }}
              >
                <svg style={{ width: "0.75rem", height: "0.75rem" }} viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                {t("signalements")}
              </a>
              <LocaleToggle />
              <ThemeToggleSwitch />
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
