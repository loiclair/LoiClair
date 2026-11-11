// Page « Nous aider », dans cet ordre : appel aux particuliers, fondations et
// mécènes, engagement de neutralité sur les financements, autres façons de
// contribuer (partage et adhésion compris), et ce que coûte LoiClair en bas.
// Atteinte depuis le bouton du pied de page et la carte de clôture de /about. Mise en page volontairement calquée sur /mentions-legales (deux
// tailles de texte, pas d'icônes) : une version à icônes et gros titres a été
// jugée moins lisible.
//
// Pas encore de bouton de don : l'association qui édite le site peut encaisser
// des dons (D-194), mais aucune plateforme n'est branchée. Le contact passe
// donc par email en attendant.

import type { Metadata } from "next"
import { Link } from "@/i18n/navigation"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { buildAlternates, buildOpenGraph } from "@/lib/og-metadata"
import SignalerLigne from "./SignalerLigne"
import FooterShare from "@/components/FooterShare"
import AdhesionBouton from "@/components/AdhesionBouton"
import { ASSOCIATION } from "@/lib/association"

export const revalidate = 86400
export const dynamic = 'force-static'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'nousAider' })
  // Pas de suffixe « — LoiClair » comme sur les autres pages : le titre
  // contient déjà le nom, et le suffixe porte un tiret cadratin.
  const title = t('pageTitle')
  const description = t('pageDescription')
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/nous-aider'),
    openGraph: buildOpenGraph(locale, '/nous-aider', title, description),
  }
}

const SECTION_TITLE = "text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3"

export default async function NousAiderPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'nousAider' })

  // L'objet traduit porte des espaces : la syntaxe mailto (RFC 6068) exige
  // qu'ils soient encodés dans l'URL.
  const mailto = `mailto:contact@loiclair.fr?subject=${encodeURIComponent(t('mailSubject'))}`

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="max-w-3xl">

        {/* Titre et accroche vivent dans l'en-tête commun (`usePageHero`). */}
        <div className="space-y-10">

          <section>
            <h2 className={SECTION_TITLE}>{t('sectionMecenes')}</h2>
            <p className="text-sm leading-relaxed">{t('mecenesBody')}</p>
            {/* `target="_blank"` comme tous les liens vers contact@loiclair.fr,
                pour qu'ils se comportent pareil. Il ne change rien au brouillon qui ne
                s'ouvre qu'au premier clic : constaté aussi en collant l'adresse
                dans la barre de Chrome ou de Safari, donc hors du site. */}
            <a
              href={mailto}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-4 text-primary font-semibold border-b-2 border-primary pb-0.5 hover:opacity-80"
              style={{ fontSize: "0.9375rem" }}
            >
              {t('mecenesCta')}
            </a>
          </section>

          <section>
            <h2 className={SECTION_TITLE}>{t('sectionEngagement')}</h2>
            <p className="text-sm leading-relaxed">
              {t.rich('engagementBody', {
                statuts: (chunks) => (
                  <a href={ASSOCIATION.statuts} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{chunks}</a>
                ),
              })}
            </p>
            {/* L'article 7 des statuts impose de publier chaque soutien accepté,
                avec son montant ou sa nature. Le premier remplacera « aucun »
                par une liste. */}
            <p className="text-sm leading-relaxed mt-3">
              <strong>{t('soutiensLabel')}</strong> {t('soutiensAucun')}
            </p>
          </section>

          <section>
            <h2 className={SECTION_TITLE}>{t('sectionAutres')}</h2>
            <ul className="text-sm leading-relaxed space-y-1">
              <li className="pb-2">
                <p>{t('autresPartager')}</p>
                <div className="mt-2">
                  <FooterShare />
                </div>
              </li>
              <li>
                <AdhesionBouton className="underline underline-offset-2 cursor-pointer text-left">{t('autresMembre')}</AdhesionBouton>
              </li>
              <li>
                <Link href="/newsletter" className="underline underline-offset-2">{t('autresNewsletter')}</Link>
              </li>
              <li>
                <SignalerLigne className="underline underline-offset-2 cursor-pointer text-left">{t('autresSignaler')}</SignalerLigne>
              </li>
            </ul>
          </section>

          <section>
            <h2 className={SECTION_TITLE}>{t('sectionCouts')}</h2>
            <div className="text-sm leading-relaxed space-y-2">
              <p><strong>{t('coutIaTitre')}</strong> {t('coutIaDesc')}</p>
              <p><strong>{t('coutDomaineTitre')}</strong> {t('coutDomaineDesc')}</p>
              <p><strong>{t('coutHebergementTitre')}</strong> {t('coutHebergementDesc')}</p>
              <p>{t('coutsConclusion')}</p>
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
