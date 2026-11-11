import type { Metadata } from "next"
import { Link } from "@/i18n/navigation"
import { getTranslations, setRequestLocale } from "next-intl/server"
import { buildAlternates, buildOpenGraph } from "@/lib/og-metadata"
import { ASSOCIATION, PRESIDENT } from "@/lib/association"
import { SOURCES_OFFICIELLES, SOURCES_TIERCES, type Source } from "@/lib/sources"

export const revalidate = 86400
export const dynamic = 'force-static'

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'mentionsLegales' })
  const title = `${t('pageTitle')} — LoiClair`
  const description = t('pageDescription')
  return {
    title,
    description,
    alternates: buildAlternates(locale, '/mentions-legales'),
    openGraph: buildOpenGraph(locale, '/mentions-legales', title, description),
  }
}

export default async function MentionsLegalesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'mentionsLegales' })
  const tAccueil = await getTranslations({ locale, namespace: 'landing' })

  // Noms courts, chacun une fois (les trois sources de l'Assemblée n'en font
  // qu'un), joints à la façon de la langue : « A, B et C », « A, B and C ». `en-GB`
  // et non `en`, qui ajoute la virgule américaine avant « and » (D-311).
  const listeSources = (sources: readonly Source[]) =>
    new Intl.ListFormat(locale === 'en' ? 'en-GB' : locale, { type: 'conjunction' }).format(
      [...new Set(sources.map((s) => s.accueil))].map((cle) => tAccueil(cle)),
    )

  return (
    <div className="container mx-auto py-6 max-w-[90rem]">
      <div className="max-w-3xl">

        {/* Titre et référence à la LCEN vivent dans l'en-tête commun (`usePageHero`). */}
        <div className="space-y-10">

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('sectionEditeur')}</h2>
            <div className="text-sm leading-relaxed space-y-1">
              {/* Éditeur personne morale depuis le 13 octobre 2026 (association
                  déclarée, JO annonce n° 2090). La LCEN (article 1-1 depuis la
                  loi SREN de 2024, ancien 6 III) lui impose dénomination, siège,
                  téléphone et nom du directeur de la publication, qui est de
                  droit le représentant légal, ici le président. L'anonymat de
                  l'éditeur non professionnel est écrit pour un particulier :
                  ne pas remettre de pseudonyme ici. Le téléphone manque tant
                  que l'association n'en a pas. */}
              <p><strong>{t('editeurDenominationLabel')}</strong> {ASSOCIATION.nom}</p>
              <p><strong>{t('editeurStatutLabel')}</strong> {t('editeurStatutValue')}</p>
              <p><strong>{t('editeurRnaLabel')}</strong> {ASSOCIATION.rna}</p>
              <p><strong>{t('editeurSiegeLabel')}</strong> {t('editeurSiegeValue')}</p>
              <p><strong>{t('editeurContactLabel')}</strong> <a href="mailto:contact@loiclair.fr" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">contact@loiclair.fr</a></p>
              <p><strong>{t('editeurDirecteurLabel')}</strong> {PRESIDENT.nom}, {t('editeurDirecteurRole')}</p>
              <p>
                <strong>{t('editeurDocumentsLabel')}</strong>{' '}
                <a href={ASSOCIATION.statuts} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t('editeurStatutsLien')}</a>
                {' · '}
                <a href={ASSOCIATION.annonceJo} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{t('editeurJoLien')}</a>
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('sectionHebergeur')}</h2>
            <div className="text-sm leading-relaxed space-y-1">
              {/* Adresse relevée le 2026-11-05 dans la politique de confidentialité
                  d'OVH US (us.ovhcloud.com/legal/privacy-policy, en vigueur au
                  20 janvier 2026, section « Contact Us »). La LCEN demande aussi le
                  téléphone de l'hébergeur : ni cette page, ni les conditions
                  d'utilisation, ni les pages « company » et « contact » n'en donnent. */}
              <p><strong>{t('hebergeurSocieteLabel')}</strong> OVH US LLC</p>
              <p><strong>{t('hebergeurAdresseLabel')}</strong> {t('hebergeurAdresseValue')}</p>
              <p><strong>{t('hebergeurSiteLabel')}</strong> <a href="https://us.ovhcloud.com" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">us.ovhcloud.com</a></p>
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('sectionDonnees')}</h2>
            <p className="text-sm leading-relaxed">
              {t.rich('donneesBody', {
                link: (chunks) => (
                  <Link href="/confidentialite" className="underline underline-offset-2">{chunks}</Link>
                ),
              })}
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('sectionNatureDonnees')}</h2>
            {/* Les sources se lisent dans la liste unique (`lib/sources.ts`), par
                leur nom court de l'accueil, officielles puis tierces : écrites à la
                main, elles avaient perdu HATVP, la presse et le Conseil
                constitutionnel. */}
            <p className="text-sm leading-relaxed">
              {t.rich('natureDonneesBody', {
                officielles: listeSources(SOURCES_OFFICIELLES),
                tierces: listeSources(SOURCES_TIERCES),
                link: (chunks) => (
                  <Link href="/documentation/corrections" className="underline underline-offset-2">{chunks}</Link>
                ),
              })}
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('sectionPropriete')}</h2>
            {/* Trois titulaires distincts (D-312) : le code à son auteur, sous
                AGPL-3.0, le site à l'association éditrice, les résumés IA à
                personne. Le lien mène au texte officiel de la licence chez la
                FSF : le dépôt est encore privé, son fichier LICENSE rendrait une
                erreur 404 au visiteur. */}
            <p className="text-sm leading-relaxed">
              {t.rich('proprieteBody', {
                source: (chunks) => (
                  <a href="https://github.com/loiclair/LoiClair" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{chunks}</a>
                ),
                link: (chunks) => (
                  <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{chunks}</a>
                ),
              })}
            </p>
          </section>

          {/* Dernière section de la page : c'est la voie de recours, et elle
              s'appuie sur la nature des données posée plus haut. */}
          <section>
            <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t('sectionDroitReponse')}</h2>
            <p className="text-sm leading-relaxed">
              {t('droitReponseBody')}
            </p>
          </section>

        </div>
      </div>
    </div>
  )
}
