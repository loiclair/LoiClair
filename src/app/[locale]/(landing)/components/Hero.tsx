import { getTranslations } from "next-intl/server"
import { sql } from "@/lib/db"
import { HeroSearch, type SujetHero } from "./HeroSearch"

/**
 * Premier écran de la landing, sur une seule colonne centrée : titre, présentation,
 * recherche, cinq sujets et la pastille « Tous les thèmes » (`HeroSearch`). Appelé par
 * `(landing)/page.tsx`, qui pose dessous « Les lois dans l'actualité » (`ActualiteLois`).
 *
 * Serveur pour deux raisons : le nom complet de chaque thème, montré en infobulle, vient
 * du namespace `themesDossiers`, que l'accueil n'envoie pas au navigateur (seul
 * `landing` l'est, `messages-client.ts`), et le nombre de thèmes se lit en base. Les deux
 * sont passés en props, avec les libellés courts (`landing.hero.sujet*`).
 */

/**
 * Les cinq sujets du quotidien, chacun relié au filtre Thème de la liste des textes.
 * `slug` est la valeur que lit `#theme=` : le thème en base passé par le `slugify` de
 * `lib/search/dossier-index.ts` (« Logement et urbanisme » → `logement_et_urbanisme`).
 * `court` est le libellé de la pastille (`landing.hero.sujet*`) : les noms complets du
 * thème, longs, empilaient les pastilles une par ligne sur mobile (retour d'Alex du
 * 2026-11-23). `cle`, sa clé de `themesDossiers`, donne le nom complet en infobulle.
 */
const SUJETS = [
  { cle: "logementUrbanisme", court: "sujetLogement", slug: "logement_et_urbanisme", icone: "logement" },
  { cle: "travail", court: "sujetTravail", slug: "travail", icone: "travail" },
  { cle: "questionsSocialesSante", court: "sujetSante", slug: "questions_sociales_et_sante", icone: "sante" },
  { cle: "economieFinances", court: "sujetArgent", slug: "economie_et_finances_fiscalite", icone: "argent" },
  { cle: "famille", court: "sujetFamille", slug: "famille", icone: "famille" },
] as const

/**
 * Nombre de thèmes du filtre Thème de la liste des textes, pour la pastille « Tous les
 * thèmes ». Même source que ce filtre (`dossiers_themes_distincts`, lue par
 * `dossiers-legislatifs/page.tsx`), pour que le nombre annoncé soit celui du menu. Une
 * base injoignable rend `null` : la pastille s'affiche alors sans nombre plutôt que de
 * faire tomber le premier écran.
 */
async function nombreDeThemes(): Promise<number | null> {
  try {
    const [ligne] = await sql<{ n: number }[]>`select count(distinct theme)::int as n from dossiers_themes_distincts`
    return ligne?.n || null
  } catch (e) {
    console.error("[Hero] nombre de thèmes", e)
    return null
  }
}

export async function Hero({ locale }: { locale: string }) {
  const [tThemes, tHero, nbThemes] = await Promise.all([
    getTranslations({ locale, namespace: "themesDossiers" }),
    getTranslations({ locale, namespace: "landing.hero" }),
    nombreDeThemes(),
  ])
  const sujets: SujetHero[] = SUJETS.map(({ cle, court, slug, icone }) => ({
    slug,
    icone,
    libelle: tHero(court),
    nomComplet: tThemes(cle),
  }))
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
        <HeroSearch sujets={sujets} nbThemes={nbThemes} />
      </div>
    </section>
  )
}
