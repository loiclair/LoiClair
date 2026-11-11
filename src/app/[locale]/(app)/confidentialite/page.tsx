/**
 * /confidentialite : politique de confidentialité, rendue statiquement.
 * Textes dans le namespace `confidentialite` ; le §2 a un bloc par traitement
 * (newsletter, signalements, navigation, élus).
 */
import type { Metadata } from "next"
import { Link } from "@/i18n/navigation"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { buildAlternates, buildOpenGraph } from "@/lib/og-metadata"

export const revalidate = 86400
export const dynamic = 'force-static'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'confidentialite' })
  const title = `${t('pageTitle')} — LoiClair`
  const description = t('pageDescription')
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/confidentialite'),
    openGraph: buildOpenGraph(locale, '/confidentialite', title, description),
  }
}

/**
 * Sous-traitants du §4. Le nom et l'URL restent côté code — ce sont des noms
 * propres et des adresses, rien à traduire ; le rôle et le détail vivent dans
 * les messages, sous les clés `section4<Nom>Role` et `section4<Nom>Detail`.
 */
const SOUS_TRAITANTS = [
  { cle: 'Resend', nom: 'Resend', lien: 'https://resend.com/legal/privacy-policy' },
  // Le serveur du site et sa base (D-325, D-326) : OVH US LLC, pas OVH SAS, d'où
  // la politique du site américain.
  { cle: 'Ovh', nom: 'OVHcloud', lien: 'https://us.ovhcloud.com/legal/privacy-policy/' },
  { cle: 'Cloudflare', nom: 'Cloudflare', lien: 'https://www.cloudflare.com/privacypolicy/' },
  // Absent de la liste jusqu'en septembre 2026 alors que `lib/rate-limit.ts` lui
  // envoie l'adresse IP de chaque appel aux formulaires et à plusieurs routes d'API.
  { cle: 'Upstash', nom: 'Upstash', lien: 'https://upstash.com/trust/privacy.pdf' },
  { cle: 'Github', nom: 'GitHub', lien: 'https://docs.github.com/fr/site-policy/privacy-policies/github-general-privacy-statement' },
  { cle: 'Mammouth', nom: 'Mammouth AI', lien: 'https://info.mammouth.ai/docs/privacy-with-model-providers/' },
  // Les trois usages hors Mammouth : la fiche courte des dossiers
  // (`generate_search_summaries.py`), « Ce qui me concerne » (`classer_articles.py`)
  // et les titres anglais des dossiers (`traduire_titres.py`).
  { cle: 'Anthropic', nom: 'Anthropic', lien: 'https://www.anthropic.com/legal/privacy' },
  // La boîte où arrivent contact@ et admin@loiclair.fr, par la redirection
  // Cloudflare Email Routing : adhésions, signalements avec email, messages.
  { cle: 'Proton', nom: 'Proton Mail', lien: 'https://proton.me/legal/privacy' },
] as const

/** Les six droits du §6, dans l'ordre où le RGPD les énumère. */
const DROITS = ['Acces', 'Rectification', 'Effacement', 'Portabilite', 'Opposition', 'Retrait'] as const

export default async function ConfidentialitePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'confidentialite' })

  // `target="_blank"` comme tous les liens vers contact@loiclair.fr, pour
  // qu'ils se comportent pareil.
  const mailLink = (chunks: React.ReactNode) => (
    <a href="mailto:contact@loiclair.fr" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{chunks}</a>
  )
  const bold = (chunks: React.ReactNode) => <strong>{chunks}</strong>

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="max-w-3xl">

        {/* Le titre vit dans l'en-tête commun (`usePageHero`) ; la date de mise à
            jour reste ici, propre à cette page. */}
        <p className="text-sm text-muted-foreground mb-10">{t('lastUpdate')}</p>

        <div className="space-y-10">

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section1Title')}</h2>
            <p className="text-sm leading-relaxed">{t('section1Body')}</p>
            <p className="text-sm leading-relaxed mt-2">
              <strong>{t('section1SiteLabel')}</strong> <Link href="/" className="underline underline-offset-2">loiclair.fr</Link> — <strong>{t('section1ContactLabel')}</strong> <a href="mailto:contact@loiclair.fr" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">contact@loiclair.fr</a>
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section2Title')}</h2>
            <div className="space-y-4 text-sm leading-relaxed">
              <div>
                <p className="font-medium mb-1">{t('section2NewsletterTitle')}</p>
                <p>{t('section2NewsletterBody')}</p>
              </div>
              <div>
                <p className="font-medium mb-1">{t('section2SignalementTitle')}</p>
                <p>{t('section2SignalementBody')}</p>
              </div>
              {/* La demande part du client mail du visiteur (lien de /nous-aider), et
                  peut révéler une fonction politique : donnée sensible (article 9 du
                  RGPD), d'où le consentement explicite écrit dans le brouillon. */}
              <div>
                <p className="font-medium mb-1">{t('section2AdhesionTitle')}</p>
                <p>{t('section2AdhesionBody')}</p>
              </div>
              <div>
                <p className="font-medium mb-1">{t('section2NavigationTitle')}</p>
                <p>
                  {t.rich('section2NavigationCookie', {
                    code: (chunks) => <code className="text-xs">{chunks}</code>,
                  })}
                </p>
                {/* Stockage local, stockage de session et IndexedDB : ce qui reste
                    dans le navigateur. Recensé le 2026-10-28 depuis les appelants de
                    `lib/stockage-navigateur.ts`, `lib/search/idb.ts` et next-themes. */}
                <p className="mt-2">{t('section2NavigationStockage')}</p>
                <p className="mt-2">{t('section2NavigationAudience')}</p>
                <p className="mt-2">{t('section2NavigationLogs')}</p>
                <p className="mt-2">{t('section2NavigationPortraits')}</p>
                {/* Les logos de la revue de presse de la fiche dossier
                    (`ResumeIAClient`, `t0.gstatic.com/faviconV2`) : même cas que les
                    portraits, une image chargée par le navigateur chez un tiers. */}
                <p className="mt-2">{t('section2NavigationLogos')}</p>
              </div>
              {/* Ces données ne viennent pas du visiteur mais de sources publiques : c'est
                  ce bloc qui porte l'information due au titre de l'article 14 du RGPD. */}
              <div>
                <p className="font-medium mb-1">{t('section2ElusTitle')}</p>
                <p>{t('section2ElusBody')}</p>
                <p className="mt-2">{t('section2ElusSources')}</p>
                <p className="mt-2">{t('section2ElusBase')}</p>
                {/* La durée de conservation est due au titre de l'article 14.2.a. Les
                    fiches d'anciens élus ne sont jamais supprimées en base. La déclaration HATVP,
                    les mandats locaux (import mensuel) et les registres du Sénat ne gardent que
                    les élus en exercice ; ceux de l'Assemblée gardent toute la législature. */}
                <p className="mt-2">{t('section2ElusDuree')}</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section3Title')}</h2>
            <p className="text-sm leading-relaxed">{t('section3Body')}</p>
            <p className="text-sm leading-relaxed mt-2">{t('section3Elus')}</p>
            <p className="text-sm leading-relaxed mt-2">{t('section3Signalement')}</p>
            <p className="text-sm leading-relaxed mt-2">{t('section3Adhesion')}</p>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section4Title')}</h2>
            <p className="text-sm leading-relaxed mb-4">{t('section4Intro')}</p>
            <div className="space-y-4 text-sm leading-relaxed">
              {SOUS_TRAITANTS.map(({ cle, nom, lien }) => (
                <div key={cle} className="grid grid-cols-[120px_1fr] gap-4 items-start">
                  <div>
                    <p className="font-medium">{nom}</p>
                    <p className="text-xs text-muted-foreground">{t(`section4${cle}Role`)}</p>
                  </div>
                  <div>
                    {/* `t.rich` : un détail peut nommer un cookie en <code>
                        (Cloudflare et `cf_clearance`), qu'un `t` simple refuse. */}
                    <p>{t.rich(`section4${cle}Detail`, {
                      code: (chunks) => <code className="text-xs">{chunks}</code>,
                    })}</p>
                    <a href={lien} target="_blank" rel="noopener noreferrer" className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground mt-1 inline-block">{t('section4LinkLabel')}</a>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section5Title')}</h2>
            <p className="text-sm leading-relaxed">{t('section5Body')}</p>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section6Title')}</h2>
            <p className="text-sm leading-relaxed mb-3">{t('section6Intro')}</p>
            <ul className="text-sm space-y-1 leading-relaxed">
              {DROITS.map((droit) => (
                <li key={droit} className="flex gap-2">
                  <span className="font-medium shrink-0">{t(`section6${droit}Label`)} —</span>
                  <span className="text-muted-foreground">{t(`section6${droit}Desc`)}.</span>
                </li>
              ))}
            </ul>
            <p className="text-sm leading-relaxed mt-3">
              {t.rich('section6Exercer', { mail: mailLink })}
            </p>
            <p className="text-sm leading-relaxed mt-2">
              {t.rich('section6Portabilite', { mail: mailLink, b: bold })}
            </p>
            <p className="text-sm leading-relaxed mt-2">{t('section6Elus')}</p>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section7Title')}</h2>
            <p className="text-sm leading-relaxed">
              {t.rich('section7Body', {
                b: bold,
                link: (chunks) => (
                  <a href="https://www.cnil.fr" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{chunks}</a>
                ),
              })}
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section8Title')}</h2>
            <p className="text-sm leading-relaxed">{t('section8Body')}</p>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('section9Title')}</h2>
            <p className="text-sm leading-relaxed">{t('section9Body')}</p>
          </section>

        </div>
      </div>
    </div>
  )
}
