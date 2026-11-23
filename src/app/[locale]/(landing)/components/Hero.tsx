import { getTranslations } from "next-intl/server"
import { HeroSearch, type SujetHero } from "./HeroSearch"

/**
 * Premier écran de la landing, sur une seule colonne centrée : titre, présentation,
 * recherche, cinq sujets et quatre preuves (`HeroSearch`). Appelé par
 * `(landing)/page.tsx`, qui pose dessous « Les lois dans l'actualité » (`ActualiteLois`).
 *
 * Serveur pour une seule raison : les libellés des sujets viennent du namespace
 * `themesDossiers`, que l'accueil n'envoie pas au navigateur (seul `landing` l'est,
 * `messages-client.ts`). Ils sont donc lus ici et passés en props.
 */

/**
 * Les cinq sujets du quotidien, chacun relié au filtre Thème de la liste des textes.
 * `slug` est la valeur que lit `#theme=` : le thème en base passé par le `slugify` de
 * `lib/search/dossier-index.ts` (« Logement et urbanisme » → `logement_et_urbanisme`).
 * `cle` est sa clé de `themesDossiers`, pour le libellé.
 */
const SUJETS = [
  { cle: "logementUrbanisme", slug: "logement_et_urbanisme", icone: "logement" },
  { cle: "travail", slug: "travail", icone: "travail" },
  { cle: "questionsSocialesSante", slug: "questions_sociales_et_sante", icone: "sante" },
  { cle: "economieFinances", slug: "economie_et_finances_fiscalite", icone: "argent" },
  { cle: "famille", slug: "famille", icone: "famille" },
] as const

export async function Hero({ locale }: { locale: string }) {
  const tThemes = await getTranslations({ locale, namespace: "themesDossiers" })
  const sujets: SujetHero[] = SUJETS.map(({ cle, slug, icone }) => ({ slug, icone, libelle: tThemes(cle) }))
  return (
    <section>
      <div
        className="max-w-[90rem] mx-auto px-10 lg:px-20"
        style={{
          // En haut, 5,5rem au moins : sur mobile, le menu fixe (78 px) déborde de 22 px
          // sur la marge que `layout.tsx` lui réserve (3,5rem), et le titre y collait.
          paddingTop: "clamp(5.5rem, 9vw, 8rem)",
          // En bas, peu : la section suivante pose sa propre marge haute.
          paddingBottom: "clamp(1rem, 2vw, 1.5rem)",
        }}
      >
        <HeroSearch sujets={sujets} />
      </div>
    </section>
  )
}
